#include "game/light_vis_bake.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <thread>

#include "core/jobs.h"
#include "core/wrap.h"

namespace giga::game {

namespace {

// Полудиагональ макроклетки: граница флуда — вывод в заголовке.
constexpr float kHalfDiagMacro = 1.7320508f; // sqrt(3) · kCellSize/2

// Тороидальная wrap-дельта той же формы, что light_grid.comp::wrap_delta —
// скор обязан считаться той же математикой, что у шейдера, иначе оракул
// «вытеснен честно» сверял бы два разных мира.
inline float shader_wrap_delta(float a, float b, float L) {
    const float d = b - a;
    return d - L * std::floor((d + L * 0.5f) / L);
}

// (лампа, клетка света, вклад) — сырая пара флуда до транспонирования.
struct LampCellHit {
    std::uint32_t cell;
    std::uint32_t lamp;
    float score;
};

// Флуд одной лампы. scratch-буферы переиспользуются воркером между лампами.
struct FloodScratch {
    std::vector<std::uint8_t> visited;   // локальный бокс макроклеток
    std::vector<std::int32_t> stack;     // BFS-стек локальных индексов
    std::vector<std::uint8_t> lightSeen; // локальный бокс клеток светосетки
};

void flood_one_lamp(const WalkBits& pass, const LightVisLamp& lamp,
                    std::uint32_t lampId, FloodScratch& sc,
                    std::vector<LampCellHit>& out) {
    const float R = lamp.radiusM;
    if (R <= 0.0f) return;
    const float boundR = R + kHalfDiagMacro; // вывод в заголовке
    const float boundR2 = boundR * boundR;

    // Локальный бокс: макроклетки с центром в шаре boundR вокруг лампы.
    const int br = static_cast<int>(std::ceil(boundR / kCellSize));
    const int side = 2 * br + 1;
    const std::size_t boxCells =
        static_cast<std::size_t>(side) * side * side;
    sc.visited.assign(boxCells, 0);
    sc.stack.clear();

    // Бокс клеток светосетки, покрывающий макробокс (дедуп достигнутых).
    const int lamp_mx = static_cast<int>(std::floor(lamp.pos.x / kCellSize));
    const int lamp_my = static_cast<int>(std::floor(lamp.pos.y / kCellSize));
    const int lamp_mz = static_cast<int>(std::floor(lamp.pos.z / kCellSize));
    const int lLo[3] = {(lamp_mx - br) >> 1, (lamp_my - br) >> 1,
                        (lamp_mz - br) >> 1};
    const int lHi[3] = {(lamp_mx + br) >> 1, (lamp_my + br) >> 1,
                        (lamp_mz + br) >> 1};
    const int lSide[3] = {lHi[0] - lLo[0] + 1, lHi[1] - lLo[1] + 1,
                          lHi[2] - lLo[2] + 1};
    sc.lightSeen.assign(static_cast<std::size_t>(lSide[0]) * lSide[1] *
                            lSide[2],
                        0);

    auto local_index = [side, br](int dx, int dy, int dz) {
        return static_cast<std::size_t>(dx + br) +
               static_cast<std::size_t>(dy + br) * side +
               static_cast<std::size_t>(dz + br) * side * side;
    };
    // Центр макроклетки (lamp_m + d) против позиции лампы, без врапа: бокс
    // мал (R + sqrt(3) << полупериода), локальные дельты честны сами по себе.
    auto centre_in_bound = [&](int dx, int dy, int dz) {
        const float cx =
            (static_cast<float>(lamp_mx + dx) + 0.5f) * kCellSize - lamp.pos.x;
        const float cy =
            (static_cast<float>(lamp_my + dy) + 0.5f) * kCellSize - lamp.pos.y;
        const float cz =
            (static_cast<float>(lamp_mz + dz) + 0.5f) * kCellSize - lamp.pos.z;
        return cx * cx + cy * cy + cz * cz <= boundR2;
    };
    auto passable = [&](int dx, int dy, int dz) {
        const std::size_t gi =
            macro_index(wrap_macro(lamp_mx + dx), wrap_macro(lamp_my + dy),
                        wrap_macro(lamp_mz + dz));
        return pass.at(gi);
    };

    // Затравка — клетка лампы, проходима принудительно (вывод в заголовке).
    sc.visited[local_index(0, 0, 0)] = 1;
    sc.stack.push_back(0); // упакованные локальные (dx,dy,dz) со смещением br
    auto pack = [br, side](int dx, int dy, int dz) {
        return (dx + br) + (dy + br) * side + (dz + br) * side * side;
    };
    auto unpack = [br, side](std::int32_t v, int& dx, int& dy, int& dz) {
        dx = v % side - br;
        v /= side;
        dy = v % side - br;
        dz = v / side - br;
    };
    sc.stack[0] = pack(0, 0, 0);

    while (!sc.stack.empty()) {
        const std::int32_t cur = sc.stack.back();
        sc.stack.pop_back();
        int dx, dy, dz;
        unpack(cur, dx, dy, dz);

        // Достигнутая макроклетка -> её клетка светосетки (дедуп локальным
        // битом; глобальный индекс и скор — при первом касании).
        {
            const int lx = (lamp_mx + dx) >> 1, ly = (lamp_my + dy) >> 1,
                      lz = (lamp_mz + dz) >> 1;
            const std::size_t li =
                static_cast<std::size_t>(lx - lLo[0]) +
                static_cast<std::size_t>(ly - lLo[1]) * lSide[0] +
                static_cast<std::size_t>(lz - lLo[2]) * lSide[0] * lSide[1];
            if (!sc.lightSeen[li]) {
                sc.lightSeen[li] = 1;
                const float s = light_cell_score(lamp.pos, R, lx, ly, lz);
                if (s <= 1.0f) {
                    out.push_back(LampCellHit{
                        static_cast<std::uint32_t>(
                            light_vis_index(lx, ly, lz)),
                        lampId, s});
                }
            }
        }

        static constexpr int kD[6][3] = {
            {1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
            {0, -1, 0}, {0, 0, 1}, {0, 0, -1},
        };
        for (const auto& d : kD) {
            const int nx = dx + d[0], ny = dy + d[1], nz = dz + d[2];
            if (nx < -br || nx > br || ny < -br || ny > br || nz < -br ||
                nz > br)
                continue;
            const std::size_t li = local_index(nx, ny, nz);
            if (sc.visited[li]) continue;
            sc.visited[li] = 1; // помечаем и непроходимые — второй раз не смотрим
            if (!centre_in_bound(nx, ny, nz)) continue;
            if (!passable(nx, ny, nz)) continue;
            sc.stack.push_back(pack(nx, ny, nz));
        }
    }
}

} // namespace

void build_light_pass_bits(const MacroGrid& grid, WalkBits& out) {
    const std::vector<SubMask>& masks = grid.masks();
    const std::vector<CellType>& types = grid.types();
    out.build([&](int x, int y, int z) {
        const std::size_t i = macro_index(x, y, z);
        return light_passes_cell(masks[i], types[i]);
    });
}

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

void bake_light_visibility(const WalkBits& passBits, const LightVisLamp* lamps,
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
            FloodScratch sc;
            for (std::size_t i = lo; i < hi; ++i) {
                if (cancel &&
                    cancel->load(std::memory_order_relaxed))
                    return; // результат отменённого бейка — мусор по контракту
                flood_one_lamp(passBits, lamps[i],
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
