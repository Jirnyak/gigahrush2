#include "game/light_vis_bake.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring> // memcpy — невыровненные u64-чтения хэша ключа кэша
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
        // ЛУЧ ПРОЩАЕТ ПРОЗРАЧНЫЙ МАТЕРИАЛ, НЕ СВЕТЯЩИЙСЯ (решение владельца
        // 2026-08-24): колонка light_transparent, эмиттеры и воздух выведены
        // прозрачными — стекло пропускает свет строкой CSV. Тот же закон в
        // пиксельном луче — kMatLightPass в raymarch.frag shadow_cell_occluded;
        // менять только ВМЕСТЕ, обе стороны читают одну колонку. Тип ЯЧЕЙКИ,
        // не атома (у бейка нет субматериалов — только MacroGrid): субвоксель,
        // нарисованный в ВОЗДУШНОЙ ячейке, прощается по прозрачности воздуха.
        // Это ошибка ИЗЛИШКОМ (инвариант (б)): лампа лишний раз попадёт в
        // список клетки, а честную тень по материалу атома дорисует пиксельный
        // луч (sub_mat в shadow_cell_occluded). До 2026-08-24 тут было
        // наоборот — потеря: нарисованный атомами неон блокировал сам себя.
        if (!ownCell &&
            !material_passes_light(grid.cell(hit.cx, hit.cy, hit.cz)))
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
                if (!lit) continue;
                // Прямое попадание против дилатации — В РАНГ (находка №1
                // аудита 2026-08-23): перекрытая лампа несёт бит в id и +1.0
                // к скору — все видимые выше всех перекрытых, теневой бюджет
                // пикселя уходит видимым (вывод у kLampDilatedBit в .h).
                const bool direct = sc.reached[cell_index(dx, dy, dz)] != 0;
                out.push_back(LampCellHit{
                    static_cast<std::uint32_t>(light_vis_index(cx, cy, cz)),
                    direct ? lampId : (lampId | kLampDilatedBit),
                    direct ? s : s + 1.0f});
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

    // (Синтез кластеров удалён 2026-08-23 вместе с механизмом: ссылки
    // выбрасывались биннингом, а обрезка списка до 8 честных ламп рвала
    // свет прямоугольниками по клеткам. Клетка держит top-slots честно.)

    // На клетку: сорт по вкладу (score, при равенстве — меньший id: полный
    // порядок ради детерминизма), обрезка top-slots, счёт переливов.
    out.cells.assign(kLightVisCells * stride, 0);
    std::atomic<std::uint32_t> lit{0}, overflow{0}, maxPer{0}, packed{0};
    // Параллель по клеткам: каждый индекс пишет только свои слова — контракт
    // непересекающихся записей [core/jobs.h] держится по построению.
    parallel_for(
        T,
        [&](int w) {
            const std::size_t per = (kLightVisCells + T - 1) / T;
            const std::size_t lo = static_cast<std::size_t>(w) * per;
            const std::size_t hi = std::min(lo + per, kLightVisCells);
            std::uint32_t myLit = 0, myOver = 0, myMax = 0, myPacked = 0;
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
                std::uint32_t* dst = out.cells.data() + c * stride;
                    const std::uint32_t keep =
                        std::min(n, static_cast<std::uint32_t>(slots));
                    if (n > slots) ++myOver;
                    dst[0] = keep;
                    for (std::uint32_t k = 0; k < keep; ++k)
                        dst[1 + k] = s[k].id;
                myPacked += (out.cells.data() + c * stride)[0];
            }
            // атомики только на сводку — не на горячем пути записи клеток
            lit.fetch_add(myLit, std::memory_order_relaxed);
            packed.fetch_add(myPacked, std::memory_order_relaxed);
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
    out.packedMeanPerCell =
        out.litCells > 0 ? static_cast<float>(
                               packed.load(std::memory_order_relaxed)) /
                               static_cast<float>(out.litCells)
                         : 0.0f;
    out.meanPerCell = out.litCells > 0
                          ? static_cast<float>(totalHits) /
                                static_cast<float>(out.litCells)
                          : 0.0f;
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

// --- Ход H: ключ и кодек кэша (контракт в заголовке) ------------------------

namespace {

// 8 независимых дорожек xor-mul поверх u64-слов. Последовательный FNV упёрся
// бы в зависимость по данным (~1 слово на 4-5 тактов): маски — 134 МиБ, это
// ~80 мс на ключ; восемь дорожек дают ILP и ~10 мс на тот же объём. Хвост
// короче слова доливается нулями через memcpy (детерминизм длиной: len
// вмешан в свёртку). Обе платформы little-endian — порядок байт слова общий.
std::uint64_t mix_lanes(std::uint64_t seed, const void* data,
                        std::size_t len) {
    constexpr std::uint64_t kMul = 0x9E3779B97F4A7C15ull;
    std::uint64_t lane[8];
    for (int i = 0; i < 8; ++i)
        lane[i] = seed ^ (0x517C'C1B7'2722'0A95ull * static_cast<std::uint64_t>(i + 1));
    const std::uint8_t* p = static_cast<const std::uint8_t*>(data);
    std::size_t n = len;
    while (n >= 64) {
        for (int i = 0; i < 8; ++i) {
            std::uint64_t w;
            std::memcpy(&w, p + 8 * i, 8);
            lane[i] = (lane[i] ^ w) * kMul;
        }
        p += 64;
        n -= 64;
    }
    int i = 0;
    while (n >= 8) {
        std::uint64_t w;
        std::memcpy(&w, p, 8);
        lane[i & 7] = (lane[i & 7] ^ w) * kMul;
        p += 8;
        n -= 8;
        ++i;
    }
    if (n > 0) {
        std::uint64_t w = 0;
        std::memcpy(&w, p, n);
        lane[i & 7] = (lane[i & 7] ^ w) * kMul;
    }
    std::uint64_t h = seed ^ (len * kMul);
    for (int k = 0; k < 8; ++k) h = (h ^ lane[k]) * kMul;
    h ^= h >> 32;
    h *= kMul;
    h ^= h >> 29;
    return h;
}

// Версия формата кэша: менять при ЛЮБОЙ правке алгоритма бейка или кодека —
// ключ включает её, значит старые файлы просто перестают находиться.
constexpr std::uint32_t kLightVisCacheVersion = 2; // v2: + хэш нагрузки
constexpr std::uint32_t kLightVisCacheMagic = 0x3143564Cu; // "LVC1" LE

void put_u32(std::vector<std::uint8_t>& v, std::uint32_t x) {
    const std::size_t at = v.size();
    v.resize(at + 4);
    std::memcpy(v.data() + at, &x, 4);
}
void put_u64(std::vector<std::uint8_t>& v, std::uint64_t x) {
    const std::size_t at = v.size();
    v.resize(at + 8);
    std::memcpy(v.data() + at, &x, 8);
}
void put_f32(std::vector<std::uint8_t>& v, float x) {
    const std::size_t at = v.size();
    v.resize(at + 4);
    std::memcpy(v.data() + at, &x, 4);
}

struct Reader {
    const std::uint8_t* p;
    std::size_t left;
    bool ok = true;
    std::uint32_t u32() {
        std::uint32_t x = 0;
        if (left < 4) { ok = false; return 0; }
        std::memcpy(&x, p, 4);
        p += 4;
        left -= 4;
        return x;
    }
    std::uint64_t u64() {
        std::uint64_t x = 0;
        if (left < 8) { ok = false; return 0; }
        std::memcpy(&x, p, 8);
        p += 8;
        left -= 8;
        return x;
    }
    float f32() {
        float x = 0;
        if (left < 4) { ok = false; return 0; }
        std::memcpy(&x, p, 4);
        p += 4;
        left -= 4;
        return x;
    }
};

} // namespace

std::uint64_t light_vis_cache_key(const MacroGrid& grid,
                                  const LightVisLamp* lamps,
                                  std::size_t lampCount, std::uint32_t slots) {
    static_assert(sizeof(LightVisLamp) == 7 * sizeof(float),
                  "LightVisLamp отрастил паддинг/поле — сырые байты таблицы "
                  "ламп перестали быть детерминированным входом ключа");
    std::uint64_t h = 0xC0FFEE ^ (static_cast<std::uint64_t>(
                                      kLightVisCacheVersion)
                                  << 32);
    h = mix_lanes(h, grid.types().data(),
                  grid.types().size() * sizeof(CellType));
    h = mix_lanes(h, grid.masks().data(),
                  grid.masks().size() * sizeof(SubMask));
    if (lampCount > 0)
        h = mix_lanes(h, lamps, lampCount * sizeof(LightVisLamp));
    h = (h ^ slots) * 0x9E3779B97F4A7C15ull;
    h = (h ^ lampCount) * 0x9E3779B97F4A7C15ull;
    return h;
}

void light_vis_cache_encode(const LightVisBake& b, std::uint64_t key,
                            std::vector<std::uint8_t>& out) {
    out.clear();
    const std::uint32_t stride = 1u + b.slots;
    out.reserve(64 + static_cast<std::size_t>(b.litCells) *
                         (2 + b.maxPerCell) * 4);
    put_u32(out, kLightVisCacheMagic);
    put_u64(out, key);
    // Хэш всего, что ПОСЛЕ этого поля: имя файла (ключ) доказывает «тот ли
    // это мир», хэш — «не побились ли байты». Молча скормить битый список
    // ламп — нарушение «не потерять свет»; бэкпатч в конце encode.
    const std::size_t hashAt = out.size();
    put_u64(out, 0);
    put_u32(out, b.slots);
    put_u32(out, b.lampCount);
    put_f32(out, b.rMaxM);
    put_u32(out, b.litCells);
    put_u32(out, b.overflowCells);
    put_u32(out, b.maxPerCell);
    put_f32(out, b.meanPerCell);
    put_f32(out, b.packedMeanPerCell);
    std::uint32_t entries = 0;
    const std::size_t entriesAt = out.size();
    put_u32(out, 0); // backpatch числом записанных клеток
    for (std::size_t c = 0; c < kLightVisCells; ++c) {
        const std::uint32_t* src = b.cells.data() + c * stride;
        const std::uint32_t n = src[0];
        if (n == 0) continue;
        put_u32(out, static_cast<std::uint32_t>(c));
        put_u32(out, n);
        for (std::uint32_t k = 0; k < n; ++k) put_u32(out, src[1 + k]);
        ++entries;
    }
    std::memcpy(out.data() + entriesAt, &entries, 4);
    const std::uint64_t ph =
        mix_lanes(key, out.data() + hashAt + 8, out.size() - hashAt - 8);
    std::memcpy(out.data() + hashAt, &ph, 8);
}

bool light_vis_cache_decode(const std::uint8_t* bytes, std::size_t len,
                            std::uint64_t key, LightVisBake& out) {
    Reader r{bytes, len};
    if (r.u32() != kLightVisCacheMagic) return false;
    if (r.u64() != key) return false; // имя файла врёт о содержимом — мимо
    const std::uint64_t ph = r.u64();
    if (!r.ok || ph != mix_lanes(key, r.p, r.left))
        return false; // байты побились — молча светить битым нельзя
    const std::uint32_t slots = r.u32();
    const std::uint32_t lampCount = r.u32();
    const float rMaxM = r.f32();
    const std::uint32_t litCells = r.u32();
    const std::uint32_t overflowCells = r.u32();
    const std::uint32_t maxPerCell = r.u32();
    const float meanPerCell = r.f32();
    const float packedMeanPerCell = r.f32();
    const std::uint32_t entries = r.u32();
    if (!r.ok || slots == 0 || slots > 1024 || entries > kLightVisCells)
        return false;
    const std::uint32_t stride = 1u + slots;
    std::vector<std::uint32_t> cells(kLightVisCells * stride, 0);
    for (std::uint32_t e = 0; e < entries; ++e) {
        const std::uint32_t c = r.u32();
        const std::uint32_t n = r.u32();
        if (!r.ok || c >= kLightVisCells || n == 0 || n > slots)
            return false;
        std::uint32_t* dst = cells.data() + static_cast<std::size_t>(c) * stride;
        dst[0] = n;
        for (std::uint32_t k = 0; k < n; ++k) dst[1 + k] = r.u32();
    }
    if (!r.ok || r.left != 0) return false; // хвост — обрыв или мусор
    out.cells = std::move(cells);
    out.slots = slots;
    out.lampCount = lampCount;
    out.rMaxM = rMaxM;
    out.litCells = litCells;
    out.overflowCells = overflowCells;
    out.maxPerCell = maxPerCell;
    out.meanPerCell = meanPerCell;
    out.packedMeanPerCell = packedMeanPerCell;
    out.bakeMs = 0.0f; // это чтение, не бейк; цену печатает вызывающий
    return true;
}

void bake_light_visibility_patch(const MacroGrid& grid,
                                 const LightVisLamp* lamps,
                                 std::size_t lampCount,
                                 const std::uint32_t* carvedCells,
                                 std::size_t nCarved, LightVisPatch& out,
                                 int threads,
                                 const std::atomic<bool>* cancel) {
    const auto t0 = std::chrono::steady_clock::now();
    out.hits.clear();
    out.affectedLamps = 0;
    out.bakeMs = 0.0f;
    if (lampCount == 0 || nCarved == 0) return;

    // Затронутые лампы: центр карвнутой макроклетки ближе R + полудиагонали
    // клетки (луч лампа→цель через дыру ⇒ дыра на отрезке ⇒ дыра внутри R —
    // геометрия та же, что у шара дренажа в заголовке). Скан lamps × carved —
    // тысячи × сотни, микросекунды.
    const float kHalfDiag = 0.8660254f * kCellSize; // sqrt(3)/2 · 2 м
    std::vector<std::uint32_t> affected;
    for (std::size_t i = 0; i < lampCount; ++i) {
        const float R = lamps[i].radiusM;
        if (R <= 0.0f) continue;
        const float reach = R + kHalfDiag;
        const float reach2 = reach * reach;
        for (std::size_t j = 0; j < nCarved; ++j) {
            const std::uint32_t idx = carvedCells[j];
            const float cx =
                (static_cast<float>(idx % kMacroDim) + 0.5f) * kCellSize;
            const float cy =
                (static_cast<float>((idx / kMacroDim) % kMacroDim) + 0.5f) *
                kCellSize;
            const float cz =
                (static_cast<float>(idx / (kMacroDim * kMacroDim)) + 0.5f) *
                kCellSize;
            const float dx = shader_wrap_delta(lamps[i].pos.x, cx, kWorldExtent);
            const float dy = shader_wrap_delta(lamps[i].pos.y, cy, kWorldExtent);
            const float dz = shader_wrap_delta(lamps[i].pos.z, cz, kWorldExtent);
            if (dx * dx + dy * dy + dz * dz <= reach2) {
                affected.push_back(static_cast<std::uint32_t>(i));
                break;
            }
        }
    }
    out.affectedLamps = static_cast<std::uint32_t>(affected.size());
    if (affected.empty()) {
        out.bakeMs = std::chrono::duration<float, std::milli>(
                         std::chrono::steady_clock::now() - t0)
                         .count();
        return;
    }

    // Лучи — те же чанки в порядке ламп, что у полного бейка: результат
    // бит-идентичен при любом числе потоков.
    int hw = static_cast<int>(std::thread::hardware_concurrency());
    if (hw < 1) hw = 1;
    int T = threads > 0 ? threads : hw;
    if (static_cast<std::size_t>(T) > affected.size()) T = static_cast<int>(affected.size());
    if (T < 1) T = 1;
    const std::size_t chunk = (affected.size() + T - 1) / T;
    std::vector<std::vector<LampCellHit>> hits(static_cast<std::size_t>(T));
    parallel_for(
        T,
        [&](int w) {
            const std::size_t lo = static_cast<std::size_t>(w) * chunk;
            const std::size_t hi = std::min(lo + chunk, affected.size());
            RayScratch sc;
            for (std::size_t k = lo; k < hi; ++k) {
                if (cancel && cancel->load(std::memory_order_relaxed)) return;
                const std::uint32_t id = affected[k];
                rays_one_lamp(grid, lamps[id], id, sc,
                              hits[static_cast<std::size_t>(w)]);
            }
        },
        T);
    if (cancel && cancel->load(std::memory_order_relaxed)) {
        out.hits.clear(); // результат отменённого бейка — мусор по контракту
        return;
    }

    std::size_t total = 0;
    for (const auto& h : hits) total += h.size();
    out.hits.reserve(total);
    for (const auto& h : hits)
        for (const LampCellHit& e : h)
            out.hits.push_back(LightVisPatch::Hit{e.cell, e.lamp, e.score});
    // (cell, lamp) — детерминированный порядок слияния независимо от потоков.
    std::sort(out.hits.begin(), out.hits.end(),
              [](const LightVisPatch::Hit& a, const LightVisPatch::Hit& b) {
                  return a.cell != b.cell ? a.cell < b.cell : a.lamp < b.lamp;
              });
    out.bakeMs = std::chrono::duration<float, std::milli>(
                     std::chrono::steady_clock::now() - t0)
                     .count();
}

std::size_t light_vis_apply_patch(LightVisBake& live,
                                  const LightVisPatch& patch,
                                  const LightVisLamp* lamps,
                                  std::size_t lampCount,
                                  std::vector<std::uint32_t>* changedCells) {
    if (changedCells) changedCells->clear();
    if (!live.valid() || patch.hits.empty()) return 0;
    const std::size_t stride = 1 + live.slots;
    std::size_t changed = 0;

    std::size_t i = 0;
    while (i < patch.hits.size()) {
        const std::uint32_t cell = patch.hits[i].cell;
        // Пояс границы (аудит 2026-08-27): индекс клетки рождается у
        // light_vis_index и замаскирован по построению, но это единственная
        // точка цепочки, где границу держало доверие, а не проверка.
        // ++i ОБЯЗАТЕЛЕН: единственный, кто двигает `i`, — внутренний for ниже,
        // и голый `continue` здесь крутил бы внешний while вечно на том же
        // элементе. Пояс, поставленный против выхода за границу, сам стал
        // отказом хуже того, от которого защищал (аудит 2026-09-12).
        if (cell >= kLightVisCells) { ++i; continue; }
        std::uint32_t* dst = live.cells.data() + cell * stride;
        std::uint32_t count = dst[0];
        const std::uint32_t wasCount = count;
        bool cellChanged = false;
        for (; i < patch.hits.size() && patch.hits[i].cell == cell; ++i) {
            // id несёт бит дилатации (kLampDilatedBit): тождество лампы — по
            // маске, а флаг ЖИВОЙ — карв мог открыть прямой луч (или закрыть,
            // оставив только дилатацию), и ранг обязан узнать.
            const std::uint32_t id = patch.hits[i].lamp;
            bool present = false;
            for (std::uint32_t k = 0; k < count && !present; ++k) {
                if ((dst[1 + k] & kLampIdMask) != (id & kLampIdMask)) continue;
                present = true;
                if (dst[1 + k] != id) {
                    dst[1 + k] = id;
                    cellChanged = true;
                }
            }
            if (present) continue;
            if (count < live.slots) {
                dst[1 + count++] = id;
                cellChanged = true;
                continue;
            }
            // Клетка полна: вытеснить худшего ЧЕСТНОГО (masked id < lampCount
            // — кластерные ссылки жили в верхнем регионе таблицы и не
            // вытеснялись). Скор — тот же, что у ранга: геометрия + штраф
            // дилатации, перекрытые вытесняются первыми. Тот же класс ошибки,
            // что top-K полного бейка, и так же вслух — через overflowCells.
            const int lx = static_cast<int>(cell) & (kLightVisDim - 1);
            const int ly = (static_cast<int>(cell) / kLightVisDim) &
                           (kLightVisDim - 1);
            const int lz = static_cast<int>(cell) /
                           (kLightVisDim * kLightVisDim);
            float worstScore = patch.hits[i].score;
            std::uint32_t worstK = live.slots; // «вытеснять некого»
            for (std::uint32_t k = 0; k < count; ++k) {
                const std::uint32_t raw = dst[1 + k];
                const std::uint32_t eid = raw & kLampIdMask;
                if (eid >= lampCount) continue; // кластерная ссылка
                const float s =
                    light_cell_score(lamps[eid].pos, lamps[eid].radiusM, lx,
                                     ly, lz) +
                    ((raw & kLampDilatedBit) != 0 ? 1.0f : 0.0f);
                if (s > worstScore) {
                    worstScore = s;
                    worstK = k;
                }
            }
            ++live.overflowCells;
            if (worstK < live.slots) {
                dst[1 + worstK] = id;
                cellChanged = true;
            }
        }
        if (cellChanged) {
            dst[0] = count;
            if (wasCount == 0) ++live.litCells;
            live.maxPerCell = std::max(live.maxPerCell, count);
            ++changed;
            if (changedCells) changedCells->push_back(cell);
        }
    }
    return changed;
}

} // namespace giga::game
