#include "game/light_vis_bake.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <thread>

#include "core/jobs.h"
#include "core/wrap.h"
#include "world/los.h" // sub_march — единственный субвоксельный марш (S11)

namespace giga::game {

namespace {

// Тороидальная wrap-дельта той же формы, что light_grid.comp::wrap_delta —
// скор обязан считаться той же математикой, что у шейдера, иначе оракул
// «вытеснен честно» сверял бы два разных мира.
inline float shader_wrap_delta(float a, float b, float L) {
    const float d = b - a;
    return d - L * std::floor((d + L * 0.5f) / L);
}

// (лампа, клетка света, вклад) — сырая пара бейка до транспонирования.
struct LampCellHit {
    std::uint32_t cell;
    std::uint32_t lamp;
    float score;
};

// Скретч лучевого бейка одной лампы; буферы переиспользуются воркером.
struct RayScratch {
    std::vector<std::uint8_t> reached; // бокс клеток светосетки: прямая видимость
    std::vector<std::uint8_t> corner;  // мемо углов: 0 не считан / 1 чист / 2 блок
};

} // namespace

bool light_ray_passes(const MacroGrid& grid, const vec3& from, const vec3& to,
                      float stopShortM) {
    vec3 rd{to.x - from.x, to.y - from.y, to.z - from.z};
    const float len = std::sqrt(rd.x * rd.x + rd.y * rd.y + rd.z * rd.z);
    const float dist = len - stopShortM;
    if (dist <= 1e-6f) return true;
    const vec3 dir{rd.x / len, rd.y / len, rd.z / len};
    const vec3 end{from.x + dir.x * dist, from.y + dir.y * dist,
                   from.z + dir.z * dist};
    // Клетка лампы — проходима принудительно (вывод в шапке .h).
    const int lampC[3] = {wrap_macro(static_cast<int>(std::floor(from.x / kCellSize))),
                          wrap_macro(static_cast<int>(std::floor(from.y / kCellSize))),
                          wrap_macro(static_cast<int>(std::floor(from.z / kCellSize)))};
    vec3 a = from;
    // Перезапуск марша за прощённым препятствием (эмиссив, клетка лампы).
    // Предел — страховка от вырожденного цикла; исчерпание = «свет прошёл»:
    // ошибка обязана быть излишком, не потерей (инвариант (б)).
    for (int guard = 0; guard < 64; ++guard) {
        SubRayHit hit;
        if (!sub_march(grid, a, end, hit)) return true;
        const bool ownCell =
            hit.cx == lampC[0] && hit.cy == lampC[1] && hit.cz == lampC[2];
        if (!ownCell &&
            !material_emits_light(grid.cell(hit.cx, hit.cy, hit.cz)))
            return false;
        // Шаг за прощённый субвоксель: продолжить чуть дальше касания.
        // 0.125 м (полсубвокселя) гарантирует выход из текущего; доля
        // считается от ТЕКУЩЕГО отрезка [a,end] — он укорачивается с каждым
        // перезапуском.
        const vec3 seg{end.x - a.x, end.y - a.y, end.z - a.z};
        const float curLen =
            std::sqrt(seg.x * seg.x + seg.y * seg.y + seg.z * seg.z);
        if (curLen <= 1e-4f) return true;
        const float adv = hit.t + 0.125f / curLen;
        if (adv >= 1.0f) return true;
        a = vec3{a.x + seg.x * adv, a.y + seg.y * adv, a.z + seg.z * adv};
    }
    return true;
}

namespace {

// Одна лампа: 9-лучевая прямая видимость + дилатация на 1 клетку светосетки
// (решение владельца 2026-08-20, замена строгого флуда — вывод в заголовке
// light_vis_bake.h). На каждую клетку в радиусе — луч к центру и к 8 углам
// (клетка достижима, если хоть один чист); углы решётки общие для 8 клеток и
// МЕМОИЗИРУЮТСЯ (~2.1 луча на клетку вместо 9). Дилатация — страховка
// сэмплирования: канал уже 4 м может пройти между 9 лучами; расширение на
// клетку покрывает промах размером до полного шага решётки сэмплов. Это
// инженерная ставка, и потому она ЖИВЁТ ПОД ОРАКУЛОМ «не потерять свет»
// (suite_lightvis, обратная полярность в самом тесте).
void rays_one_lamp(const MacroGrid& grid, const LightVisLamp& lamp,
                   std::uint32_t lampId, RayScratch& sc,
                   std::vector<LampCellHit>& out) {
    const float R = lamp.radiusM;
    if (R <= 0.0f) return;

    // Бокс клеток светосетки вокруг клетки лампы: кандидаты — score <= 1
    // (AABB клетки в радиусе R); +1 — поле под дилатацию.
    const int lc[3] = {
        static_cast<int>(std::floor(lamp.pos.x / kLightVisCellM)),
        static_cast<int>(std::floor(lamp.pos.y / kLightVisCellM)),
        static_cast<int>(std::floor(lamp.pos.z / kLightVisCellM))};
    const int br = static_cast<int>(std::ceil(R / kLightVisCellM)) + 1;
    const int side = 2 * br + 1;
    const int cside = side + 1; // решётка углов
    sc.reached.assign(static_cast<std::size_t>(side) * side * side, 0);
    sc.corner.assign(static_cast<std::size_t>(cside) * cside * cside, 0);

    auto cell_index = [side, br](int dx, int dy, int dz) {
        return static_cast<std::size_t>(dx + br) +
               static_cast<std::size_t>(dy + br) * side +
               static_cast<std::size_t>(dz + br) * side * side;
    };
    // Угол (gx,gy,gz) — узел решётки границ клеток: мировая точка
    // (lc - br + g) * 4 м, без врапа (бокс мал, цель — ближайший образ по
    // построению; врап только в чтении битсета внутри DDA).
    auto corner_clear = [&](int gx, int gy, int gz) {
        const std::size_t gi = static_cast<std::size_t>(gx) +
                               static_cast<std::size_t>(gy) * cside +
                               static_cast<std::size_t>(gz) * cside * cside;
        if (sc.corner[gi] == 0) {
            const vec3 p{(lc[0] - br + gx) * kLightVisCellM,
                         (lc[1] - br + gy) * kLightVisCellM,
                         (lc[2] - br + gz) * kLightVisCellM};
            // Гасим луч за 5 см до угла: угол лежит на границе восьми клеток
            // и «своей» не имеет — судим только путь до него.
            sc.corner[gi] =
                light_ray_passes(grid, lamp.pos, p, 0.05f) ? 1 : 2;
        }
        return sc.corner[gi] == 1;
    };

    for (int dz = -br; dz <= br; ++dz)
        for (int dy = -br; dy <= br; ++dy)
            for (int dx = -br; dx <= br; ++dx) {
                const int cx = lc[0] + dx, cy = lc[1] + dy, cz = lc[2] + dz;
                if (light_cell_score(lamp.pos, R, cx, cy, cz) > 1.0f)
                    continue;
                // Центр — полный луч (клетка точки судится, как в референсе
                // оракула); углы — мемоизированные.
                const vec3 cpt{(cx + 0.5f) * kLightVisCellM,
                               (cy + 0.5f) * kLightVisCellM,
                               (cz + 0.5f) * kLightVisCellM};
                bool ok = light_ray_passes(grid, lamp.pos, cpt, 0.0f);
                for (int k = 0; k < 8 && !ok; ++k) {
                    ok = corner_clear(dx + br + (k & 1),
                                      dy + br + ((k >> 1) & 1),
                                      dz + br + ((k >> 2) & 1));
                }
                if (ok) sc.reached[cell_index(dx, dy, dz)] = 1;
            }

    // Дилатация на 1 клетку + эмиссия: клетка попадает в список, если она
    // сама или любой из 26 соседей достигнут лучом — и она в радиусе.
    for (int dz = -br; dz <= br; ++dz)
        for (int dy = -br; dy <= br; ++dy)
            for (int dx = -br; dx <= br; ++dx) {
                const int cx = lc[0] + dx, cy = lc[1] + dy, cz = lc[2] + dz;
                const float s = light_cell_score(lamp.pos, R, cx, cy, cz);
                if (s > 1.0f) continue;
                bool lit = false;
                for (int nz = -1; nz <= 1 && !lit; ++nz)
                    for (int ny = -1; ny <= 1 && !lit; ++ny)
                        for (int nx = -1; nx <= 1 && !lit; ++nx) {
                            const int ax = dx + nx, ay = dy + ny, az = dz + nz;
                            if (ax < -br || ax > br || ay < -br || ay > br ||
                                az < -br || az > br)
                                continue;
                            lit = sc.reached[cell_index(ax, ay, az)] != 0;
                        }
                if (lit)
                    out.push_back(LampCellHit{
                        static_cast<std::uint32_t>(
                            light_vis_index(cx, cy, cz)),
                        lampId, s});
            }
}

} // namespace

float light_cell_score(const vec3& lampPos, float radiusM, int cx, int cy,
                       int cz) {
    // Бит-в-бит с light_grid.comp::dist_sq_point_aabb_toroidal.
    const float mn[3] = {cx * kLightVisCellM, cy * kLightVisCellM,
                         cz * kLightVisCellM};
    float d2 = 0.0f;
    const float p[3] = {lampPos.x, lampPos.y, lampPos.z};
    for (int a = 0; a < 3; ++a) {
        const float centre = mn[a] + kLightVisCellM * 0.5f;
        const float half = kLightVisCellM * 0.5f;
        float d = shader_wrap_delta(centre, p[a], kWorldExtent);
        d = std::fabs(d) - half;
        if (d > 0.0f) d2 += d * d;
    }
    return d2 / (radiusM * radiusM);
}

void bake_light_visibility(const MacroGrid& grid, const LightVisLamp* lamps,
                           std::size_t lampCount, std::uint32_t slots,
                           LightVisBake& out, int threads,
                           const std::atomic<bool>* cancel) {
    const auto t0 = std::chrono::steady_clock::now();
    const std::size_t stride = 1 + slots;

    out.slots = slots;
    out.lampCount = static_cast<std::uint32_t>(lampCount);
    out.rMaxM = 0.0f;
    out.litCells = 0;
    out.overflowCells = 0;
    out.maxPerCell = 0;
    for (std::size_t i = 0; i < lampCount; ++i)
        out.rMaxM = std::max(out.rMaxM, lamps[i].radiusM);

    // Чанки ламп — та же арифметика, что parallel_for ([core/jobs.h]):
    // непрерывные диапазоны, выход склеивается в порядке воркеров = порядке
    // ламп, поэтому результат бит-идентичен при ЛЮБОМ числе потоков (сильнее
    // контракта jobs, где идентичность обещана при фиксированных threads).
    int hw = static_cast<int>(std::thread::hardware_concurrency());
    if (hw < 1) hw = 1;
    int T = threads > 0 ? threads : hw;
    if (static_cast<std::size_t>(T) > lampCount && lampCount > 0)
        T = static_cast<int>(lampCount);
    if (T < 1) T = 1;
    const std::size_t chunk = lampCount == 0 ? 0 : (lampCount + T - 1) / T;

    std::vector<std::vector<LampCellHit>> hits(static_cast<std::size_t>(T));
    parallel_for(
        T,
        [&](int w) {
            const std::size_t lo = static_cast<std::size_t>(w) * chunk;
            const std::size_t hi = std::min(lo + chunk, lampCount);
            RayScratch sc;
            for (std::size_t i = lo; i < hi; ++i) {
                if (cancel &&
                    cancel->load(std::memory_order_relaxed))
                    return; // результат отменённого бейка — мусор по контракту
                rays_one_lamp(grid, lamps[i],
                              static_cast<std::uint32_t>(i), sc,
                              hits[static_cast<std::size_t>(w)]);
            }
        },
        T);
    if (cancel && cancel->load(std::memory_order_relaxed)) {
        out.cells.clear();
        return;
    }

    // Транспонирование в CSR клетка->лампы. Счёт -> префикс -> заполнение в
    // порядке ламп (конкатенация чанков в порядке воркеров).
    std::vector<std::uint32_t> cellCount(kLightVisCells, 0);
    std::size_t totalHits = 0;
    for (const auto& h : hits) {
        totalHits += h.size();
        for (const LampCellHit& e : h) ++cellCount[e.cell];
    }
    std::vector<std::uint32_t> cellStart(kLightVisCells + 1, 0);
    for (std::size_t i = 0; i < kLightVisCells; ++i)
        cellStart[i + 1] = cellStart[i] + cellCount[i];
    struct IdScore {
        std::uint32_t id;
        float score;
    };
    std::vector<IdScore> csr(totalHits);
    {
        std::vector<std::uint32_t> cursor(cellStart.begin(),
                                          cellStart.end() - 1);
        for (const auto& h : hits)
            for (const LampCellHit& e : h)
                csr[cursor[e.cell]++] = IdScore{e.lamp, e.score};
    }

    // На клетку: сорт по вкладу (score, при равенстве — меньший id: полный
    // порядок ради детерминизма), обрезка top-slots, счёт переливов.
    out.cells.assign(kLightVisCells * stride, 0);
    std::atomic<std::uint32_t> lit{0}, overflow{0}, maxPer{0};
    // Параллель по клеткам: каждый индекс пишет только свои слова — контракт
    // непересекающихся записей [core/jobs.h] держится по построению.
    parallel_for(
        T,
        [&](int w) {
            const std::size_t per = (kLightVisCells + T - 1) / T;
            const std::size_t lo = static_cast<std::size_t>(w) * per;
            const std::size_t hi = std::min(lo + per, kLightVisCells);
            std::uint32_t myLit = 0, myOver = 0, myMax = 0;
            for (std::size_t c = lo; c < hi; ++c) {
                const std::uint32_t b = cellStart[c];
                const std::uint32_t n = cellCount[c];
                if (n == 0) continue;
                ++myLit;
                myMax = std::max(myMax, n);
                IdScore* s = csr.data() + b;
                std::sort(s, s + n, [](const IdScore& a, const IdScore& r) {
                    return a.score != r.score ? a.score < r.score
                                              : a.id < r.id;
                });
                const std::uint32_t keep =
                    std::min(n, static_cast<std::uint32_t>(slots));
                if (n > slots) ++myOver;
                std::uint32_t* dst = out.cells.data() + c * stride;
                dst[0] = keep;
                for (std::uint32_t k = 0; k < keep; ++k)
                    dst[1 + k] = s[k].id;
            }
            // атомики только на сводку — не на горячем пути записи клеток
            lit.fetch_add(myLit, std::memory_order_relaxed);
            overflow.fetch_add(myOver, std::memory_order_relaxed);
            std::uint32_t prev = maxPer.load(std::memory_order_relaxed);
            while (prev < myMax &&
                   !maxPer.compare_exchange_weak(prev, myMax,
                                                 std::memory_order_relaxed)) {
            }
        },
        T);
    out.litCells = lit.load(std::memory_order_relaxed);
    out.overflowCells = overflow.load(std::memory_order_relaxed);
    out.maxPerCell = maxPer.load(std::memory_order_relaxed);
    out.meanPerCell = out.litCells > 0
                          ? static_cast<float>(totalHits) /
                                static_cast<float>(out.litCells)
                          : 0.0f;
    // --- Синтез кластеров (light-cluster.md шаг 1) ---------------------
    // Бакетизация ВСЕХ ламп по 8-м блокам; занятый бакет = кластер. Порядок
    // кластеров и членов — возрастание индексов: детерминизм без сортировок.
    out.clusters.clear();
    out.clusterMembers.clear();
    if (lampCount > 0) {
        constexpr std::size_t kBuckets = static_cast<std::size_t>(
            kClusterGridDim) * kClusterGridDim * kClusterGridDim;
        const float bucketM = kLightVisCellM * kClusterBucketCells; // 8 м
        std::vector<std::uint32_t> bucketOf(lampCount);
        std::vector<std::uint32_t> perBucket(kBuckets, 0);
        for (std::size_t i = 0; i < lampCount; ++i) {
            const vec3& p = lamps[i].pos;
            const int bx = static_cast<int>(std::floor(p.x / bucketM)) &
                           (kClusterGridDim - 1);
            const int by = static_cast<int>(std::floor(p.y / bucketM)) &
                           (kClusterGridDim - 1);
            const int bz = static_cast<int>(std::floor(p.z / bucketM)) &
                           (kClusterGridDim - 1);
            bucketOf[i] = static_cast<std::uint32_t>(
                bx + by * kClusterGridDim +
                bz * kClusterGridDim * kClusterGridDim);
            ++perBucket[bucketOf[i]];
        }
        std::vector<std::uint32_t> clusterIdx(kBuckets, 0xFFFFFFFFu);
        out.clusterMembers.resize(lampCount);
        std::uint32_t cursor = 0;
        for (std::size_t b = 0; b < kBuckets; ++b) {
            if (perBucket[b] == 0) continue;
            clusterIdx[b] = static_cast<std::uint32_t>(out.clusters.size());
            LightVisCluster c;
            c.memberStart = cursor;
            c.memberCount = perBucket[b];
            cursor += perBucket[b];
            out.clusters.push_back(c);
        }
        std::vector<std::uint32_t> fill(out.clusters.size(), 0);
        for (std::size_t i = 0; i < lampCount; ++i) {
            const std::uint32_t ci = clusterIdx[bucketOf[i]];
            out.clusterMembers[out.clusters[ci].memberStart + fill[ci]++] =
                static_cast<std::uint32_t>(i);
        }
        // Поля кластера: центроид/цвет по весу radiusM² (флюкс-прокси, шапка
        // LightVisLamp), радиус — охват. Центроид считается В СИСТЕМЕ ПЕРВОГО
        // ЧЛЕНА через тор-дельты: бакет у шва иначе дал бы центр в полумире.
        for (LightVisCluster& c : out.clusters) {
            const vec3 origin = lamps[out.clusterMembers[c.memberStart]].pos;
            vec3 sumD{0.0f, 0.0f, 0.0f};
            vec3 sumCol{0.0f, 0.0f, 0.0f};
            float sumW = 0.0f;
            for (std::uint32_t k = 0; k < c.memberCount; ++k) {
                const LightVisLamp& L =
                    lamps[out.clusterMembers[c.memberStart + k]];
                const float w = std::max(L.radiusM * L.radiusM, 1e-4f);
                sumD.x += w * shader_wrap_delta(origin.x, L.pos.x, kWorldExtent);
                sumD.y += w * shader_wrap_delta(origin.y, L.pos.y, kWorldExtent);
                sumD.z += w * shader_wrap_delta(origin.z, L.pos.z, kWorldExtent);
                sumCol = sumCol + L.color * w;
                sumW += w;
            }
            c.pos = origin + sumD * (1.0f / sumW);
            c.color = sumCol * (1.0f / sumW);
            float reach = 0.0f;
            for (std::uint32_t k = 0; k < c.memberCount; ++k) {
                const LightVisLamp& L =
                    lamps[out.clusterMembers[c.memberStart + k]];
                const float dx =
                    shader_wrap_delta(c.pos.x, L.pos.x, kWorldExtent);
                const float dy =
                    shader_wrap_delta(c.pos.y, L.pos.y, kWorldExtent);
                const float dz =
                    shader_wrap_delta(c.pos.z, L.pos.z, kWorldExtent);
                reach = std::max(reach,
                                 std::sqrt(dx * dx + dy * dy + dz * dz) +
                                     L.radiusM);
            }
            c.radiusM = reach;
        }
    }

    out.bakeMs = std::chrono::duration<float, std::milli>(
                     std::chrono::steady_clock::now() - t0)
                     .count();
}

std::uint64_t light_vis_fnv(const LightVisBake& b) {
    // FNV-1a по словам содержимого — тот же приём, что верле-пин.
    std::uint64_t h = 1469598103934665603ull;
    for (std::uint32_t w : b.cells) {
        h ^= w;
        h *= 1099511628211ull;
    }
    return h;
}

} // namespace giga::game
