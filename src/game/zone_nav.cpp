#include "game/zone_nav.h"

#include <algorithm>
#include <cmath>   // cbrt, floor — оптимум числа секторов S = floor((Z²/2)^(1/3))
#include <cstdio>  // размер зоны вслух: из него выводятся ОБА предела ноги
#include <vector>

#include "core/jobs.h"        // parallel_for — бейк жмёт ядра
#include "core/rng.h"         // hash3 — выбор соседки в блуждании `zone_pick_near`
#include "world/types.h"      // kMacroDim, kMacroCells, macro_index, wrap_macro

namespace giga::game {
namespace {

// Пара зон одним словом: (меньшая << 16) | большая. Ключ сортировки и дедупа.
// RoomId — u16, поэтому пара влезает в u32 без остатка, и это НЕ совпадение:
// тот же u16 держит `roomAt`, то есть кап зон у них общий (см. асёрт в бейке).
inline std::uint32_t pack_pair(RoomId a, RoomId b) {
    return a < b ? (static_cast<std::uint32_t>(a) << 16) | b
                 : (static_cast<std::uint32_t>(b) << 16) | a;
}

// Целевое число секторов, минимизирующее память S² + Z²/S:
// d/dS (S² + Z²/S) = 2S − Z²/S² = 0 => S = floor((Z²/2)^(1/3)), зажато в [1, Z].
inline std::uint32_t target_sector_count(std::uint32_t z) {
    if (z <= 1u) return z;
    const double sRaw =
        std::cbrt(static_cast<double>(z) * static_cast<double>(z) * 0.5);
    std::uint32_t s = static_cast<std::uint32_t>(std::floor(sRaw));
    if (s < 1u) s = 1u;
    if (s > z) s = z;
    return s;
}

// Проверка связности сектора `t` после удаления из него вершины `dropV`.
// Работает на O(|t|) без аллокаций: `verts` содержит вершины сектора `t`.
bool sector_connected_without(const ZoneGraph& g,
                              const std::vector<std::uint32_t>& secId,
                              std::uint32_t t,
                              const std::vector<std::uint32_t>& verts,
                              std::uint32_t dropV,
                              std::vector<std::uint32_t>& stamp,
                              std::uint32_t& curStamp,
                              std::vector<std::uint32_t>& bfsQ) {
    if (verts.size() <= 2u) return verts.size() == 2u; // 1 оставшаяся вершина всегда связна
    std::uint32_t start = UINT32_MAX;
    for (std::uint32_t u : verts) {
        if (u != dropV) {
            start = u;
            break;
        }
    }
    if (start == UINT32_MAX) return false;
    ++curStamp;
    if (curStamp == 0u) {
        std::fill(stamp.begin(), stamp.end(), 0u);
        curStamp = 1u;
    }
    bfsQ.clear();
    stamp[start] = curStamp;
    bfsQ.push_back(start);
    for (std::size_t h = 0; h < bfsQ.size(); ++h) {
        const std::uint32_t u = bfsQ[h];
        for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
            const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
            if (v == dropV || secId[v] != t || stamp[v] == curStamp) continue;
            stamp[v] = curStamp;
            bfsQ.push_back(v);
        }
    }
    return bfsQ.size() == verts.size() - 1u;
}

// Детерминированная разбивка `ZoneGraph` на связные сбалансированные секторы.
// Возвращает число секторов S и плотный `sectorOf[0..Z-1]` в [0..S-1].
std::uint32_t partition_zone_graph(const ZoneGraph& g,
                                   std::vector<std::uint16_t>& outSectorOf) {
    const std::uint32_t Z = g.zones;
    outSectorOf.assign(Z, 0u);
    if (Z == 0u) return 0u;

    const std::uint32_t sTarget = target_sector_count(Z);
    const std::uint32_t idealCap =
        std::max<std::uint32_t>(1u, (Z + sTarget - 1u) / sTarget);

    std::vector<std::uint32_t> secId(Z, UINT32_MAX);
    std::vector<std::vector<std::uint32_t>> secVerts;
    std::vector<std::uint8_t> secIsIsolated;
    secVerts.reserve(sTarget + 64u);
    secIsIsolated.reserve(sTarget + 64u);
    std::uint32_t bigZ = 0u;

    // Временные буферы переиспользуются по всем компонентам.
    std::vector<std::uint8_t> compVisited(Z, 0u);
    std::vector<std::uint8_t> inFrontier(Z, 0u);
    std::vector<std::uint32_t> comp;
    std::vector<std::uint32_t> frontier;
    std::vector<std::uint32_t> sq;
    std::vector<std::uint32_t> stamp(Z, 0u);
    std::vector<std::uint32_t> bfsQ;
    std::uint32_t curStamp = 1u;

    for (std::uint32_t root = 0; root < Z; ++root) {
        if (compVisited[root]) continue;
        // 1. Выделяем связную компоненту в BFS-порядке.
        comp.clear();
        compVisited[root] = 1u;
        comp.push_back(root);
        for (std::size_t h = 0; h < comp.size(); ++h) {
            const std::uint32_t u = comp[h];
            for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                if (!compVisited[v]) {
                    compVisited[v] = 1u;
                    comp.push_back(v);
                }
            }
        }

        const std::uint32_t K = static_cast<std::uint32_t>(comp.size());
        // Маленькую компоненту целиком кладём в один изолированный сектор:
        // она не имеет внешних рёбер и не попадает в матрицу `sectorDist`.
        if (sTarget == 1u || K <= idealCap + idealCap / 2u) {
            const std::uint32_t sid = static_cast<std::uint32_t>(secVerts.size());
            secVerts.emplace_back(comp.begin(), comp.end());
            secIsIsolated.push_back(1u);
            for (std::uint32_t v : comp) secId[v] = sid;
            continue;
        }
        bigZ += K;

        // 2. Крупная компонента: целимся в kK сбалансированных кусков по ~capK зон.
        const std::uint32_t kK =
            std::max<std::uint32_t>(2u, (K + idealCap / 2u) / idealCap);
        const std::uint32_t capK =
            std::max<std::uint32_t>(2u, (K + kK - 1u) / kK);
        const std::uint32_t minK = std::max<std::uint32_t>(2u, capK / 2u);
        const std::uint32_t maxK =
            std::max<std::uint32_t>(capK + 2u, (capK * 3u) / 2u);

        const std::uint32_t firstSec = static_cast<std::uint32_t>(secVerts.size());
        frontier.clear();
        std::size_t frontierHead = 0;
        std::size_t compCursor = 0;
        std::uint32_t assigned = 0;

        // Фаза А: связное BFS-выращивание по фронту с капом capK.
        while (assigned < K) {
            std::uint32_t seed = UINT32_MAX;
            std::uint32_t bestDeg = UINT32_MAX;
            std::size_t checked = 0;
            while (frontierHead < frontier.size() &&
                   secId[frontier[frontierHead]] != UINT32_MAX) {
                ++frontierHead;
            }
            for (std::size_t i = frontierHead;
                 i < frontier.size() && checked < 512u; ++i) {
                const std::uint32_t cand = frontier[i];
                if (secId[cand] != UINT32_MAX) continue;
                ++checked;
                std::uint32_t freeDeg = 0;
                for (const RoomId* it = g.begin(cand); it != g.end(cand); ++it) {
                    if (secId[static_cast<std::uint32_t>(*it) - 1u] == UINT32_MAX)
                        ++freeDeg;
                }
                if (freeDeg < bestDeg) {
                    bestDeg = freeDeg;
                    seed = cand;
                    if (bestDeg <= 1u) break;
                }
            }
            if (seed == UINT32_MAX) {
                while (compCursor < comp.size() &&
                       secId[comp[compCursor]] != UINT32_MAX) {
                    ++compCursor;
                }
                seed = comp[compCursor++];
            }

            const std::uint32_t sid = static_cast<std::uint32_t>(secVerts.size());
            sq.clear();
            secId[seed] = sid;
            sq.push_back(seed);
            for (std::size_t h = 0; h < sq.size() && sq.size() < capK; ++h) {
                const std::uint32_t u = sq[h];
                for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                    const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                    if (secId[v] != UINT32_MAX) continue;
                    secId[v] = sid;
                    sq.push_back(v);
                    if (sq.size() >= capK) break;
                }
            }
            for (std::uint32_t u : sq) {
                for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                    const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                    if (secId[v] == UINT32_MAX && !inFrontier[v]) {
                        inFrontier[v] = 1u;
                        frontier.push_back(v);
                    }
                }
            }
            assigned += static_cast<std::uint32_t>(sq.size());
            secVerts.emplace_back(sq.begin(), sq.end());
            secIsIsolated.push_back(0u);
        }

        const std::uint32_t endSec = static_cast<std::uint32_t>(secVerts.size());

        // Фаза Б: слияние мелких хвостов (< minK) с наименьшим смежным сектором в пределах maxK.
        bool mergedAny = true;
        while (mergedAny) {
            mergedAny = false;
            for (std::uint32_t s = firstSec; s < endSec; ++s) {
                const std::size_t sz = secVerts[s].size();
                if (sz == 0u || sz >= minK) continue;
                std::uint32_t bestT = UINT32_MAX;
                std::size_t bestSize = SIZE_MAX;
                for (std::uint32_t u : secVerts[s]) {
                    for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                        const std::uint32_t t =
                            secId[static_cast<std::uint32_t>(*it) - 1u];
                        if (t == s || t < firstSec || t >= endSec) continue;
                        const std::size_t tz = secVerts[t].size();
                        if (tz == 0u || sz + tz > maxK) continue;
                        if (tz < bestSize || (tz == bestSize && t < bestT)) {
                            bestSize = tz;
                            bestT = t;
                        }
                    }
                }
                if (bestT != UINT32_MAX) {
                    for (std::uint32_t u : secVerts[s]) {
                        secId[u] = bestT;
                        secVerts[bestT].push_back(u);
                    }
                    secVerts[s].clear();
                    mergedAny = true;
                }
            }
        }

        // Фаза В: перетягивание неартикуляционных граничных вершин от крупных соседей
        // в оставшиеся мелкие секторы (< minK), не допуская разрыва связности донора.
        for (std::uint32_t s = firstSec; s < endSec; ++s) {
            while (!secVerts[s].empty() && secVerts[s].size() < minK) {
                std::uint32_t bestV = UINT32_MAX;
                std::uint32_t bestT = UINT32_MAX;
                std::size_t bestTSize = secVerts[s].size() + 1u;
                for (std::uint32_t u : secVerts[s]) {
                    for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                        const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                        const std::uint32_t t = secId[v];
                        if (t == s || t < firstSec || t >= endSec) continue;
                        const std::size_t tz = secVerts[t].size();
                        if (tz <= bestTSize) continue;
                        if (!sector_connected_without(g, secId, t, secVerts[t],
                                                      v, stamp, curStamp, bfsQ))
                            continue;
                        bestTSize = tz;
                        bestT = t;
                        bestV = v;
                    }
                }
                if (bestV == UINT32_MAX) break;
                secId[bestV] = s;
                secVerts[s].push_back(bestV);
                auto& tv = secVerts[bestT];
                for (std::size_t i = 0; i < tv.size(); ++i) {
                    if (tv[i] == bestV) {
                        tv[i] = tv.back();
                        tv.pop_back();
                        break;
                    }
                }
            }
        }

    }

    // Глобальные раунды жадного агломерационного слияния смежных секторов:
    // сначала в мягком потолке 1.5*idealCap (не создавая гигантов раньше
    // времени), затем в полном потолке 2*idealCap, с перетягиванием границ.
    const std::uint32_t sDistTarget = bigZ ? target_sector_count(bigZ) : 0u;
    const std::uint32_t softMax =
        std::max<std::uint32_t>(4u, (idealCap * 3u) / 2u);
    const std::uint32_t hardMax = std::max<std::uint32_t>(4u, idealCap * 2u);
    const std::uint32_t totalS = static_cast<std::uint32_t>(secVerts.size());
    std::vector<std::uint8_t> secBusy;
    struct MergeCand {
        std::uint32_t prod;
        std::uint32_t sum;
        std::uint32_t a;
        std::uint32_t b;
    };
    std::vector<MergeCand> cands;
    auto merge_rounds = [&](std::uint32_t capSum, int maxRounds) {
        for (int round = 0; round < maxRounds; ++round) {
            std::uint32_t liveSec = 0u;
            for (std::uint32_t s = 0u; s < totalS; ++s)
                if (!secVerts[s].empty() && !secIsIsolated[s]) ++liveSec;
            if (liveSec <= sDistTarget) break;
            cands.clear();
            for (std::uint32_t s = 0u; s < totalS; ++s) {
                if (secIsIsolated[s]) continue;
                const std::uint32_t sz =
                    static_cast<std::uint32_t>(secVerts[s].size());
                if (sz == 0u) continue;
                for (std::uint32_t u : secVerts[s]) {
                    for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                        const std::uint32_t t =
                            secId[static_cast<std::uint32_t>(*it) - 1u];
                        if (t <= s || secIsIsolated[t]) continue;
                        const std::uint32_t tz =
                            static_cast<std::uint32_t>(secVerts[t].size());
                        if (tz == 0u || sz + tz > capSum) continue;
                        if (2u * sz * tz >= 2u * liveSec - 1u) continue;
                        cands.push_back(MergeCand{sz * tz, sz + tz, s, t});
                    }
                }
            }
            if (cands.empty()) break;
            std::sort(cands.begin(), cands.end(),
                      [](const MergeCand& x, const MergeCand& y) {
                          if (x.prod != y.prod) return x.prod < y.prod;
                          if (x.sum != y.sum) return x.sum < y.sum;
                          if (x.a != y.a) return x.a < y.a;
                          return x.b < y.b;
                      });
            secBusy.assign(totalS, 0u);
            bool anyMerged = false;
            for (const MergeCand& c : cands) {
                if (secBusy[c.a] || secBusy[c.b]) continue;
                if (secVerts[c.a].empty() || secVerts[c.b].empty()) continue;
                const std::uint32_t sz =
                    static_cast<std::uint32_t>(secVerts[c.a].size());
                const std::uint32_t tz =
                    static_cast<std::uint32_t>(secVerts[c.b].size());
                if (sz + tz > capSum) continue;
                if (2u * sz * tz >= 2u * liveSec - 1u) continue;
                std::uint32_t keep = c.a;
                std::uint32_t drop = c.b;
                if (tz > sz) std::swap(keep, drop);
                for (std::uint32_t u : secVerts[drop]) {
                    secId[u] = keep;
                    secVerts[keep].push_back(u);
                }
                secVerts[drop].clear();
                secBusy[keep] = 1u;
                secBusy[drop] = 1u;
                --liveSec;
                anyMerged = true;
                if (liveSec <= sDistTarget) break;
            }
            if (!anyMerged) break;
        }
    };
    merge_rounds(softMax, 12);
    merge_rounds(hardMax, 16);
    // Перетягиваем граничные неартикуляционные вершины от более крупных соседей
    // к более мелким (уменьшая ΣZ_s²) и добиваем возможные слияния.
    for (int pass = 0; pass < 2; ++pass) {
        bool movedAny = false;
        for (std::uint32_t s = 0u; s < totalS; ++s) {
            if (secIsIsolated[s]) continue;
            while (!secVerts[s].empty() && secVerts[s].size() < idealCap) {
                std::uint32_t bestV = UINT32_MAX;
                std::uint32_t bestT = UINT32_MAX;
                std::size_t bestTSize = secVerts[s].size() + 2u;
                for (std::uint32_t u : secVerts[s]) {
                    for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                        const std::uint32_t v =
                            static_cast<std::uint32_t>(*it) - 1u;
                        const std::uint32_t t = secId[v];
                        if (t == s) continue;
                        const std::size_t tz = secVerts[t].size();
                        if (tz < bestTSize) continue;
                        if (!sector_connected_without(g, secId, t, secVerts[t],
                                                      v, stamp, curStamp, bfsQ))
                            continue;
                        bestTSize = tz;
                        bestT = t;
                        bestV = v;
                    }
                }
                if (bestV == UINT32_MAX) break;
                secId[bestV] = s;
                secVerts[s].push_back(bestV);
                auto& tv = secVerts[bestT];
                for (std::size_t i = 0; i < tv.size(); ++i) {
                    if (tv[i] == bestV) {
                        tv[i] = tv.back();
                        tv.pop_back();
                        break;
                    }
                }
                movedAny = true;
            }
        }
        if (!movedAny) break;
    }
    merge_rounds(hardMax, 8);

    // Компактизация непустых секторов в плотный диапазон [0..S-1] в порядке зон 0..Z-1.
    std::vector<std::uint32_t> remap(secVerts.size(), UINT32_MAX);
    std::uint32_t S = 0u;
    for (std::uint32_t z = 0; z < Z; ++z) {
        const std::uint32_t raw = secId[z];
        if (remap[raw] == UINT32_MAX) remap[raw] = S++;
        outSectorOf[z] = static_cast<std::uint16_t>(remap[raw]);
    }
    return S;
}

struct SectorEdge {
    std::uint16_t fromSec;
    std::uint16_t toSec;
    RoomId portal;
};

} // namespace

RoomId ZonePartition::cell(int x, int y, int z) const {
    return at[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
}

void bake_zone_partition(const FloorRooms& fr, const ClearanceField& oracle, int size,
                         GravityRegime gravity, ZonePartition& out) {
    (void)gravity; // раздутие о гравитации не знает: касание её не спрашивает
    out = ZonePartition{};
    if (fr.roomAt.empty() || fr.empty()) return;
    out.zones = static_cast<std::uint32_t>(fr.size());
    out.at.assign(kMacroCells, kNoRoom);
    RoomId* at = out.at.data();

    // Направления — ЕДИНСТВЕННЫЙ словарь дерева (`nav::kNavDir`), не свой.
    // Второй словарь направлений здесь уже стоил тихо неверной грани (S20.7), и
    // порядок важен отдельно: он и есть правило «кто пришёл раньше» при ничьей.
    std::vector<std::uint32_t> q;
    q.reserve(kMacroCells);
    // СЕМЕНА ТОЖЕ ПРОХОДЯТ ЗАКОН КАСАНИЯ, и это нашёл гейт, а не рассуждение:
    // объявленная клетка посреди воздуха высокой комнаты касания не имеет — в
    // ней нельзя БЫТЬ, тело из неё упадёт на пол той же комнаты. Пропустить её в
    // разбивку значило бы объявить проходимой середину воздуха, то есть вернуть
    // ровно тот дефект §88, из-за которого поля вели толпу по воздуху.
    // `roomAt` при этом неприкосновенна: объявление остаётся объявлением, в
    // разбивку просто не попадает то, по чему не ходят.
    for (std::size_t i = 0; i < kMacroCells; ++i) {
        if (fr.roomAt[i] == kNoRoom) continue;
        const int x = static_cast<int>(i % kMacroDim);
        const int y = static_cast<int>((i / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(i / (kMacroDim * kMacroDim));
        if (!oracle.touching(x, y, z, size)) continue;
        at[i] = fr.roomAt[i];
        q.push_back(static_cast<std::uint32_t>(i));
    }
    if (q.empty()) return;

    const int W = kMacroDim;
    for (std::size_t head = 0; head < q.size(); ++head) {
        const std::uint32_t ci = q[head];
        const int cz = static_cast<int>(ci) / (W * W);
        const int cy = (static_cast<int>(ci) / W) % W;
        const int cx = static_cast<int>(ci) % W;
        const RoomId owner = at[ci];
        for (int d = 0; d < 6; ++d) {
            const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
            const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
            const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
            const std::size_t ni = macro_index(nx, ny, nz);
            if (at[ni] != kNoRoom) continue; // уже чья-то — ничья решена раньше
            // Грань берётся у МЛАДШЕЙ клетки перехода: плюс-направления
            // спрашивают себя, минус — соседа ([world/clearance.h]).
            // Нибл берётся ОДНОЙ дверью оракула: `at` сам решает, чья это грань
            // (плюс-направление — своя, минус — соседа), и разводить это здесь
            // значило бы списать закон во второй раз.
            if (oracle.at(cx, cy, cz, d) < size) continue;
            // КАСАНИЕ: клетка без опоры И без стенки рядом не достаётся никому —
            // в ней не может быть ни человека, ни паука (§88). Разбивка есть
            // разбивка ПРОХОДИМОГО, а не объёма.
            if (!oracle.touching(nx, ny, nz, size)) continue;
            at[ni] = owner;
            q.push_back(static_cast<std::uint32_t>(ni));
        }
    }
    // Клеток в разбивке — это ровно длина очереди: каждая попавшая клетка
    // входит в неё однажды и никогда не выходит. Считать вторым проходом по
    // 2 млн клеток было бы той же работой заново.
    out.cells = static_cast<std::uint32_t>(q.size());
}

void bake_zone_graph(const ZonePartition& part, const ClearanceField& oracle, int size,
                     ZoneGraph& out) {
    out = ZoneGraph{};
    const std::size_t zones = part.zones;
    if (!part.built()) return;
    // Кап зон — тот же u16, что у `roomAt` и `RoomId`. Переполнение здесь
    // свернуло бы таблицу МОЛЧА (зона 65536 стала бы зоной 0 = kNoRoom),
    // поэтому оно обязано быть названо вслух, а не обнаружено по странной
    // толпе. Зон на этаже 0 сегодня 14742 — запас 4.4x.
    if (zones >= kZoneUnreachable) return; // не бейкуем ложь; вызывающий увидит !built()
    out.zones = static_cast<std::uint32_t>(zones);

    // ПЕРВЫЙ ПРОХОД — собрать пары. Обход по +осям, а не по шести
    // направлениям: каждая грань тора принадлежит ровно одной клетке со
    // МЛАДШЕЙ стороны, поэтому каждая пара видится один раз, а не дважды.
    // Заворот держит `face_clearance_at` сам.
    std::vector<std::uint32_t> pairs;
    pairs.reserve(1u << 16);
    const RoomId* zoneOf = part.at.data();
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                const RoomId a = zoneOf[macro_index(x, y, z)];
                if (a == kNoRoom) continue;
                for (int axis = 0; axis < 3; ++axis) {
                    const int nx = axis == 0 ? wrap_macro(x + 1) : x;
                    const int ny = axis == 1 ? wrap_macro(y + 1) : y;
                    const int nz = axis == 2 ? wrap_macro(z + 1) : z;
                    const RoomId b = zoneOf[macro_index(nx, ny, nz)];
                    if (b == kNoRoom || b == a) continue;
                    // СМЕЖНЫ ⟺ ТЕЛО ПРОЛЕЗАЕТ. Касание через глухую кладку
                    // ребром не является: ярус 2 повёл бы агента на границу,
                    // которую не перейти.
                    if (oracle.at(x, y, z, 2 * axis + 1) < size) continue;
                    pairs.push_back(pack_pair(a, b));
                }
            }

    // Дедуп: одна пара зон касается во многих местах, ребро одно.
    std::sort(pairs.begin(), pairs.end());
    pairs.erase(std::unique(pairs.begin(), pairs.end()), pairs.end());

    // ВТОРОЙ ПРОХОД — степени, префиксная сумма, заполнение. Ребро
    // неориентированное, поэтому каждая пара даёт ДВЕ записи.
    out.offset.assign(zones + 1, 0);
    for (std::uint32_t p : pairs) {
        ++out.offset[static_cast<RoomId>(p >> 16) - 1 + 1];
        ++out.offset[static_cast<RoomId>(p & 0xFFFFu) - 1 + 1];
    }
    for (std::size_t i = 1; i <= zones; ++i) out.offset[i] += out.offset[i - 1];
    out.nbr.assign(out.offset[zones], kNoRoom);
    std::vector<std::uint32_t> cursor(out.offset.begin(), out.offset.end() - 1);
    for (std::uint32_t p : pairs) {
        const RoomId a = static_cast<RoomId>(p >> 16);
        const RoomId b = static_cast<RoomId>(p & 0xFFFFu);
        out.nbr[cursor[a - 1]++] = b;
        out.nbr[cursor[b - 1]++] = a;
    }
    // Соседки каждой зоны — по возрастанию: пары шли отсортированными, но
    // записи ложились в две строки, поэтому порядок внутри строки надо
    // восстановить. Это не косметика: детерминизм обхода яруса 1 опирается на
    // порядок соседок.
    for (std::size_t i = 0; i < zones; ++i)
        std::sort(out.nbr.begin() + out.offset[i],
                  out.nbr.begin() + out.offset[i + 1]);
}

void bake_zone_dist(const ZoneGraph& g, ZoneDist& out, int threads,
                    const std::atomic<bool>* cancel) {
    out = ZoneDist{};
    if (!g.built() || g.zones >= kZoneUnreachable) return;
    if (cancel != nullptr && cancel->load(std::memory_order_relaxed)) return;

    const std::uint32_t Z = g.zones;
    out.zones = Z;
    out.sectors = partition_zone_graph(g, out.sectorOf);
    const std::uint32_t S = out.sectors;
    if (S == 0u || S >= kZoneUnreachable) {
        out = ZoneDist{};
        return;
    }

    // 1. Локальные индексы зон внутри своих секторов и CSR сектор -> зоны.
    out.sectorSize.assign(S, 0u);
    out.localIdx.assign(Z, 0u);
    for (std::uint32_t z = 0; z < Z; ++z) {
        const std::uint16_t s = out.sectorOf[z];
        out.localIdx[z] = out.sectorSize[s]++;
    }

    std::vector<std::uint32_t> secVertOff(S + 1u, 0u);
    out.intraOffset.assign(S + 1u, 0u);
    for (std::uint32_t s = 0; s < S; ++s) {
        const std::uint32_t sz = out.sectorSize[s];
        secVertOff[s + 1u] = secVertOff[s] + sz;
        out.intraOffset[s + 1u] = out.intraOffset[s] + sz * sz;
    }
    std::vector<std::uint32_t> secVerts(Z, 0u);
    for (std::uint32_t z = 0; z < Z; ++z) {
        const std::uint16_t s = out.sectorOf[z];
        secVerts[secVertOff[s] + out.localIdx[z]] = z;
    }

    // 2. Собираем межсекторные рёбра и канонические порталы + флаг границы.
    std::vector<std::uint8_t> isBorder(Z, 0u);
    std::vector<SectorEdge> edges;
    edges.reserve(g.nbr.size() / 4u + 16u);
    for (std::uint32_t u = 0; u < Z; ++u) {
        const std::uint16_t sU = out.sectorOf[u];
        for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
            const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
            const std::uint16_t sV = out.sectorOf[v];
            if (sU == sV) continue;
            isBorder[u] = 1u;
            edges.push_back(SectorEdge{sU, sV, static_cast<RoomId>(u + 1u)});
        }
    }
    std::sort(edges.begin(), edges.end(),
              [](const SectorEdge& a, const SectorEdge& b) {
                  if (a.fromSec != b.fromSec) return a.fromSec < b.fromSec;
                  if (a.toSec != b.toSec) return a.toSec < b.toSec;
                  return a.portal < b.portal;
              });
    edges.erase(std::unique(edges.begin(), edges.end(),
                            [](const SectorEdge& a, const SectorEdge& b) {
                                return a.fromSec == b.fromSec &&
                                       a.toSec == b.toSec;
                            }),
                edges.end());

    out.sectorOffset.assign(S + 1u, 0u);
    for (const SectorEdge& e : edges) ++out.sectorOffset[e.fromSec + 1u];
    for (std::uint32_t s = 1u; s <= S; ++s)
        out.sectorOffset[s] += out.sectorOffset[s - 1u];
    out.sectorNbr.resize(edges.size());
    out.sectorPortal.resize(edges.size());
    for (std::size_t i = 0; i < edges.size(); ++i) {
        out.sectorNbr[i] = edges[i].toSec;
        out.sectorPortal[i] = edges[i].portal;
    }

    // 3. Внутрисекторные таблицы кратчайших расстояний (строго в подграфе сектора)
    //    и расстояние от каждой зоны до ближайшей границы своего сектора.
    out.intraDist.assign(out.intraOffset[S], kZoneUnreachable);
    out.borderDist.assign(Z, 0u);
    parallel_for(
        static_cast<int>(S),
        [&g, &out, &secVertOff, &secVerts, &isBorder, cancel](int si) {
            if (cancel != nullptr && cancel->load(std::memory_order_relaxed))
                return;
            const std::uint32_t s = static_cast<std::uint32_t>(si);
            const std::uint32_t sz = out.sectorSize[s];
            const std::uint32_t vBeg = secVertOff[s];
            std::uint16_t* mat = out.intraDist.data() + out.intraOffset[s];

            std::vector<std::uint32_t> q;
            q.reserve(sz);

            // Матрица внутри сектора s.
            for (std::uint32_t srcLoc = 0; srcLoc < sz; ++srcLoc) {
                std::uint16_t* row = mat + static_cast<std::size_t>(srcLoc) * sz;
                row[srcLoc] = 0u;
                q.clear();
                q.push_back(secVerts[vBeg + srcLoc]);
                for (std::size_t h = 0; h < q.size(); ++h) {
                    const std::uint32_t u = q[h];
                    const std::uint16_t du = row[out.localIdx[u]];
                    for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                        const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                        if (out.sectorOf[v] != s) continue;
                        const std::uint16_t lv = out.localIdx[v];
                        if (row[lv] != kZoneUnreachable) continue;
                        row[lv] = static_cast<std::uint16_t>(du + 1u);
                        q.push_back(v);
                    }
                }
            }

            // Многоисточниковый BFS от всех граничных зон сектора s.
            q.clear();
            bool hasBorder = false;
            for (std::uint32_t loc = 0; loc < sz; ++loc) {
                const std::uint32_t z = secVerts[vBeg + loc];
                if (isBorder[z]) {
                    hasBorder = true;
                    out.borderDist[z] = 0u;
                    q.push_back(z);
                } else {
                    out.borderDist[z] = kZoneUnreachable;
                }
            }
            if (!hasBorder) {
                // Изолированный сектор без выходов: оставляем 0 (для иных секторов unreachable).
                for (std::uint32_t loc = 0; loc < sz; ++loc)
                    out.borderDist[secVerts[vBeg + loc]] = 0u;
                return;
            }
            for (std::size_t h = 0; h < q.size(); ++h) {
                const std::uint32_t u = q[h];
                const std::uint16_t du = out.borderDist[u];
                for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                    const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                    if (out.sectorOf[v] != s) continue;
                    if (out.borderDist[v] != kZoneUnreachable) continue;
                    out.borderDist[v] = static_cast<std::uint16_t>(du + 1u);
                    q.push_back(v);
                }
            }
        },
        threads);

    // 4. Межсекторная матрица расстояний D × D только для связных секторов
    //    с внешними рёбрами: изолированные компоненты не имеют переходов и
    //    отсекаются за O(1) до чтения матрицы.
    out.sectorDistId.assign(S, kZoneUnreachable);
    std::vector<std::uint16_t> connSectors;
    connSectors.reserve(S);
    for (std::uint32_t s = 0u; s < S; ++s) {
        if (out.sectorOffset[s + 1u] > out.sectorOffset[s]) {
            out.sectorDistId[s] =
                static_cast<std::uint16_t>(connSectors.size());
            connSectors.push_back(static_cast<std::uint16_t>(s));
        }
    }
    const std::uint32_t D = static_cast<std::uint32_t>(connSectors.size());
    out.distSectors = D;
    out.sectorDist.assign(static_cast<std::size_t>(D) * D, kZoneUnreachable);
    if (D > 0u) {
        parallel_for(
            static_cast<int>(D),
            [&out, &connSectors, D, cancel](int srcIdx) {
                if (cancel != nullptr &&
                    cancel->load(std::memory_order_relaxed))
                    return;
                std::uint16_t* row =
                    out.sectorDist.data() +
                    static_cast<std::size_t>(srcIdx) * D;
                std::vector<std::uint16_t> q;
                q.reserve(D);
                const std::uint16_t d0 = static_cast<std::uint16_t>(srcIdx);
                row[d0] = 0u;
                q.push_back(connSectors[srcIdx]);
                for (std::size_t h = 0; h < q.size(); ++h) {
                    const std::uint16_t u = q[h];
                    const std::uint16_t dU = out.sectorDistId[u];
                    const std::uint16_t du = row[dU];
                    if (du + 1u >= kZoneUnreachable) continue;
                    const std::uint32_t eBeg = out.sectorOffset[u];
                    const std::uint32_t eEnd = out.sectorOffset[u + 1u];
                    for (std::uint32_t e = eBeg; e < eEnd; ++e) {
                        const std::uint16_t v = out.sectorNbr[e];
                        const std::uint16_t dV = out.sectorDistId[v];
                        if (dV == kZoneUnreachable ||
                            row[dV] != kZoneUnreachable)
                            continue;
                        row[dV] = static_cast<std::uint16_t>(du + 1u);
                        q.push_back(v);
                    }
                }
            },
            threads);
    }
}

RoomId zone_next(const ZoneGraph& g, const ZoneDist& dist, RoomId from,
                 RoomId to) {
    if (!g.built() || !dist.built()) return kNoRoom;
    if (from == kNoRoom || to == kNoRoom || from == to) return kNoRoom;
    const std::uint32_t f = static_cast<std::uint32_t>(from) - 1u;
    const std::uint32_t t = static_cast<std::uint32_t>(to) - 1u;
    if (f >= g.zones || t >= g.zones || f >= dist.zones || t >= dist.zones)
        return kNoRoom;

    const std::uint16_t sA = dist.sectorOf[f];
    const std::uint16_t sB = dist.sectorOf[t];

    // Случай 1: обе зоны в одном связном секторе -> строгий спуск по intraDist[sA].
    if (sA == sB) {
        const std::uint32_t sz = dist.sectorSize[sA];
        const std::uint32_t off = dist.intraOffset[sA];
        const std::uint16_t locT = dist.localIdx[t];
        const std::uint16_t curD =
            dist.intraDist[off + static_cast<std::size_t>(dist.localIdx[f]) * sz +
                           locT];
        if (curD == kZoneUnreachable || curD == 0u) return kNoRoom;
        RoomId best = kNoRoom;
        std::uint16_t bestD = curD;
        for (const RoomId* it = g.begin(f); it != g.end(f); ++it) {
            const std::uint32_t n = static_cast<std::uint32_t>(*it) - 1u;
            if (dist.sectorOf[n] != sA) continue;
            const std::uint16_t d =
                dist.intraDist[off + static_cast<std::size_t>(dist.localIdx[n]) * sz +
                               locT];
            if (d < bestD) {
                bestD = d;
                best = *it;
            }
        }
        return best;
    }

    // Случай 2: разные секторы -> сначала проверяем достижимость на графе секторов.
    const std::uint16_t sd = dist.sector_dist(sA, sB);
    if (sd == kZoneUnreachable) return kNoRoom; // другая компонента связности

    // 2a. Если у `from` уже есть сосед в секторе с меньшим sectorDist до sB,
    //     шагаем прямо туда — секторное расстояние строго убывает (>= 1).
    {
        RoomId bestCross = kNoRoom;
        std::uint16_t bestSd = sd;
        for (const RoomId* it = g.begin(f); it != g.end(f); ++it) {
            const std::uint32_t n = static_cast<std::uint32_t>(*it) - 1u;
            const std::uint16_t sN = dist.sectorOf[n];
            if (sN == sA) continue;
            const std::uint16_t nsd = dist.sector_dist(sN, sB);
            if (nsd < bestSd) {
                bestSd = nsd;
                bestCross = *it;
            }
        }
        if (bestCross != kNoRoom) return bestCross;
    }

    // 2б. Иначе идём внутри sA к каноническому порталу portal(sA, sNext),
    //     где sNext — первый (по возрастанию) соседний сектор с sectorDist == sd - 1.
    RoomId portal = kNoRoom;
    const std::uint32_t eBeg = dist.sectorOffset[sA];
    const std::uint32_t eEnd = dist.sectorOffset[sA + 1u];
    for (std::uint32_t e = eBeg; e < eEnd; ++e) {
        const std::uint16_t sN = dist.sectorNbr[e];
        const std::uint16_t nsd = dist.sector_dist(sN, sB);
        if (nsd != kZoneUnreachable && nsd + 1u == sd) {
            portal = dist.sectorPortal[e];
            break;
        }
    }
    if (portal == kNoRoom) return kNoRoom;

    const std::uint32_t p = static_cast<std::uint32_t>(portal) - 1u;
    const std::uint32_t sz = dist.sectorSize[sA];
    const std::uint32_t off = dist.intraOffset[sA];
    const std::uint16_t locP = dist.localIdx[p];
    const std::uint16_t curD =
        dist.intraDist[off + static_cast<std::size_t>(dist.localIdx[f]) * sz +
                       locP];
    if (curD == kZoneUnreachable || curD == 0u) return kNoRoom;
    RoomId best = kNoRoom;
    std::uint16_t bestD = curD;
    for (const RoomId* it = g.begin(f); it != g.end(f); ++it) {
        const std::uint32_t n = static_cast<std::uint32_t>(*it) - 1u;
        if (dist.sectorOf[n] != sA) continue;
        const std::uint16_t d =
            dist.intraDist[off + static_cast<std::size_t>(dist.localIdx[n]) * sz +
                           locP];
        if (d < bestD) {
            bestD = d;
            best = *it;
        }
    }
    return best;
}

int zone_nbr_slot(const ZoneGraph& g, RoomId zone, RoomId nbr) {
    if (!g.built() || zone == kNoRoom || nbr == kNoRoom) return -1;
    const std::uint32_t z = static_cast<std::uint32_t>(zone) - 1u;
    if (z >= g.zones) return -1;
    const RoomId* b = g.begin(z);
    const RoomId* e = g.end(z);
    const RoomId* it = std::lower_bound(b, e, nbr);
    if (it == e || *it != nbr) return -1;
    return static_cast<int>(it - b);
}

void bake_zone_flow(const ZonePartition& part, const ZoneGraph& g,
                    const ClearanceField& oracle, int size, GravityRegime gravity,
                    ZoneFlow& out) {
    out = ZoneFlow{};
    if (!part.built() || !g.built()) return;
    const std::uint32_t Z = g.zones;

    // Плоскостей — ровно максимальная степень зоны. Не кап и не вкус: k-е поля
    // всех зон не пересекаются по клеткам (каждое обрезано своей зоной),
    // поэтому плоскостей нужно столько, сколько соседок у самой связной зоны.
    std::uint32_t planes = 0;
    for (std::uint32_t z = 0; z < Z; ++z)
        if (g.degree(z) > planes) planes = g.degree(z);
    if (planes == 0) return; // граф без рёбер — вести некуда
    out.planes = planes;
    out.dir.assign(static_cast<std::size_t>(planes) * kMacroCells, kZoneFlowNone);

    // Клетки по зонам, CSR: обход зоны обязан стоить размер ЗОНЫ, а не размер
    // тора, — иначе бейк стал бы Z × 2M и съел бы весь смысл обрезки.
    std::vector<std::uint32_t> cellOff(Z + 1, 0);
    for (std::size_t i = 0; i < kMacroCells; ++i)
        if (part.at[i] != kNoRoom) ++cellOff[part.at[i] - 1 + 1];
    for (std::uint32_t z = 1; z <= Z; ++z) cellOff[z] += cellOff[z - 1];
    std::vector<std::uint32_t> cellsOf(cellOff[Z]);
    {
        std::vector<std::uint32_t> cur(cellOff.begin(), cellOff.end() - 1);
        for (std::size_t i = 0; i < kMacroCells; ++i)
            if (part.at[i] != kNoRoom)
                cellsOf[cur[part.at[i] - 1]++] = static_cast<std::uint32_t>(i);
    }

    const int W = kMacroDim;
    std::vector<std::uint32_t> q, next;
    q.reserve(1u << 12);
    next.reserve(1u << 12);
    for (std::uint32_t z = 0; z < Z; ++z) {
        const RoomId mine = static_cast<RoomId>(z + 1);
        const std::uint32_t deg = g.degree(z);
        for (std::uint32_t k = 0; k < deg; ++k) {
            const RoomId target = g.nbr[g.offset[z] + k];
            std::uint8_t* plane = out.dir.data() + static_cast<std::size_t>(k) * kMacroCells;
            q.clear();
            next.clear();
            // СЕМЕНА — ВСЯ ГРАНИЦА: свои клетки, у которых есть проходимый
            // сосед из целевой зоны. Их много, и это не недостаток, а то самое
            // третье чтение прототипа, которого здесь нет.
            for (std::uint32_t ci = cellOff[z]; ci < cellOff[z + 1]; ++ci) {
                const std::uint32_t c = cellsOf[ci];
                const int cz = static_cast<int>(c) / (W * W);
                const int cy = (static_cast<int>(c) / W) % W;
                const int cx = static_cast<int>(c) % W;
                for (int d = 0; d < 6; ++d) {
                    const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
                    const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
                    const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
                    const std::size_t ni = macro_index(nx, ny, nz);
                    if (part.at[ni] != target) continue;
                    const int axis = d >> 1;
                    const std::uint8_t cl = oracle.at(cx, cy, cz, d);
                    (void)axis;
                    if (cl < size) continue;
                    // Направление ПЕРЕХОДА, а не отметка: из этой клетки шаг `d`
                    // уже выводит в целевую зону.
                    plane[c] = static_cast<std::uint8_t>(d);
                    // Семя ложится в слой по СВОЕЙ цене: опёртое — в текущий,
                    // висящее — в следующий. Иначе лексикографический порядок
                    // сломался бы на первом же шаге.
                    if (oracle.supported(cx, cy, cz, size, gravity))
                        q.push_back(c);
                    else
                        next.push_back(c);
                    break;
                }
            }
            // Залив ВНУТРЬ зоны, СЛОЯМИ ПО ЛАЗАНИЮ (0-1 BFS). Обрезка — одна
            // строка (`part.at[ni] != mine`), и она же есть причина, по которой
            // поле стоит размер зоны. Касание проверять не надо: клетка, попавшая
            // в разбивку, уже касается по построению.
            for (;;) {
                for (std::size_t head = 0; head < q.size(); ++head) {
                    const std::uint32_t c = q[head];
                    const int cz = static_cast<int>(c) / (W * W);
                    const int cy = (static_cast<int>(c) / W) % W;
                    const int cx = static_cast<int>(c) % W;
                    for (int d = 0; d < 6; ++d) {
                        const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
                        const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
                        const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
                        const std::size_t ni = macro_index(nx, ny, nz);
                        if (part.at[ni] != mine) continue;       // ОБРЕЗКА ЗОНОЙ
                        if (plane[ni] != kZoneFlowNone) continue; // уже достигнута
                        if (oracle.at(cx, cy, cz, d) < size) continue;
                        // Шли c -> ni в направлении d, значит из ni обратно ведёт
                        // (d ^ 1) — тот же закон обратного шага, что у нава.
                        plane[ni] = static_cast<std::uint8_t>(d ^ 1);
                        // ЦЕНА РЕШАЕТ СЛОЙ: опёртая клетка дописывается в ТЕКУЩУЮ
                        // очередь (значит внутри слоя порядок по длине — FIFO), а
                        // висящая откладывается в следующий. Это и есть
                        // «лексикографически: сначала лазание, потом длина».
                        if (oracle.supported(nx, ny, nz, size, gravity))
                            q.push_back(static_cast<std::uint32_t>(ni));
                        else
                            next.push_back(static_cast<std::uint32_t>(ni));
                    }
                }
                if (next.empty()) break;
                q.swap(next);
                next.clear();
            }
        }
    }
}

void bake_zone_nav(const FloorRooms& fr, const ClearanceField& oracle, int size,
                   GravityRegime gravity, ZoneNav& out, int threads) {
    out = ZoneNav{};
    bake_zone_partition(fr, oracle, size, gravity, out.part);
    bake_zone_graph(out.part, oracle, size, out.graph);
    bake_zone_dist(out.graph, out.dist, threads);
    bake_zone_flow(out.part, out.graph, oracle, size, gravity, out.flow);

    // РАЗМЕР ЗОНЫ ВСЛУХ, И ЭТО НЕ ОТЛАДКА. Из него выводятся ОБА предела
    // дальности ноги — `kWanderLegMetres` ([game/wander.h]) и `kPatrolLegMetres`
    // ([game/patrol.h]), — а до 2026-10-12 числа в дереве не было вовсе: оба
    // предела опирались на ПРОЗУ «зона порядка 5 клеток, то есть 10 м». Прозу
    // нельзя пересчитать на другом модуле, и первый же боковой этаж сделал бы
    // оба предела тихо неверными. Печатается здесь, а не у потребителя, потому
    // что здесь оно ИЗВЕСТНО: ровно один проход по готовой разбивке.
    //
    // Плюс ОЗУ по капу тем же тактом — «бейк без замера прячет свою регрессию».
    if (out.part.built()) {
        const std::size_t owned = out.part.cells;
        const double perZone =
            out.part.zones ? static_cast<double>(owned) /
                                 static_cast<double>(out.part.zones)
                           : 0.0;
        const double edges =
            out.graph.built() ? static_cast<double>(out.graph.nbr.size()) / 2.0 : 0.0;
        const std::uint32_t sTarget = target_sector_count(out.part.zones);
        std::size_t sumSq = 0;
        std::uint16_t maxSec = 0;
        std::uint32_t isoSec = 0;
        for (std::uint32_t s = 0; s < out.dist.sectors; ++s) {
            const std::uint16_t zs = out.dist.sectorSize[s];
            sumSq += static_cast<std::size_t>(zs) * zs;
            if (zs > maxSec) maxSec = zs;
            if (out.dist.sectorOffset[s + 1u] == out.dist.sectorOffset[s])
                ++isoSec;
        }
        const std::size_t actualCost =
            static_cast<std::size_t>(out.dist.distSectors) *
                out.dist.distSectors +
            sumSq;
        const std::size_t idealCost =
            static_cast<std::size_t>(sTarget) * sTarget +
            (sTarget ? (static_cast<std::size_t>(out.part.zones) * out.part.zones) /
                           sTarget
                     : 0u);
        std::fprintf(stderr,
                     "[zones] зон %u | секторов %u (связн %u, изол %u, цель %u, макс %u) | "
                     "D²+ΣZ_s² %zu vs идеал %zu | dist %.2f МиБ | "
                     "клеток %zu (%.1f/зону ~%.1f м) | рёбер %.0f (ст %.1f) | "
                     "плоск %u | ОЗУ %.1f МиБ\n",
                     out.part.zones, out.dist.sectors, out.dist.distSectors,
                     isoSec, sTarget, maxSec,
                     actualCost, idealCost,
                     static_cast<double>(out.dist.bytes()) / (1024.0 * 1024.0),
                     owned, perZone, static_cast<double>(zone_span_m(out.part)),
                     edges,
                     out.part.zones ? 2.0 * edges / static_cast<double>(out.part.zones)
                                    : 0.0,
                     out.flow.planes,
                     static_cast<double>(out.bytes()) / (1024.0 * 1024.0));
    }
}

RoomId zone_of_body(const ZoneNav& zn, int cx, int cy, int cz) {
    if (!zn.part.built()) return kNoRoom;
    const RoomId own = zn.part.cell(cx, cy, cz);
    if (own != kNoRoom) return own;
    for (int d = 0; d < 6; ++d) {
        const RoomId n = zn.part.cell(cx + nav::kNavDir[d][0],
                                      cy + nav::kNavDir[d][1],
                                      cz + nav::kNavDir[d][2]);
        if (n != kNoRoom) return n;
    }
    return kNoRoom;
}

float zone_span_m(const ZonePartition& part) {
    if (!part.built() || part.zones == 0 || part.cells == 0) return 0.0f;
    const double perZone = static_cast<double>(part.cells) /
                           static_cast<double>(part.zones);
    return static_cast<float>(std::cbrt(perZone) * static_cast<double>(kCellSize));
}

std::uint16_t zone_hops_for_metres(const ZonePartition& part, float metres) {
    const float span = zone_span_m(part);
    if (span <= 0.0f || metres <= 0.0f) return 1;
    const double hops = static_cast<double>(metres) / static_cast<double>(span);
    // Вверх, а не вниз: бюджет есть ПОТОЛОК времени, и нога чуть длиннее
    // бюджета честнее ноги в ноль прыжков (та была бы «цель — своя зона»).
    const double up = hops < 1.0 ? 1.0 : std::ceil(hops);
    // Кап — не «на всякий случай»: блуждание стоит O(прыжков) чтений на ВЫБОР,
    // и бюджет, поделённый на микроскопическую зону чужого модуля, превратил бы
    // константу шага в функцию размера мира — то есть сломал бы ровно тот
    // ЗАКОН, которым нав по зонам объявлен. 64 выведено как диаметр
    // 6-связного тора по одной оси ([world/nav.h] kLatticeDim * 16 = 64):
    // дальше любого осмысленного обхода внутри этажа.
    return static_cast<std::uint16_t>(up > 64.0 ? 64.0 : up);
}

RoomId zone_pick_near(const ZoneNav& zn, RoomId from, std::uint32_t salt,
                      std::uint16_t legZones) {
    if (!zn.graph.built() || from == kNoRoom) return kNoRoom;
    const std::uint32_t fromIdx = static_cast<std::uint32_t>(from) - 1u;
    if (fromIdx >= zn.graph.zones) return kNoRoom;

    // Соль отдельная от соли наряда (`kPatrolSalt`, [game/patrol.h]): два
    // разных решения об одном теле не должны коррелировать по построению.
    // (Прежде этот довод ссылался на соль ролей; роли снесены 2026-11-08,
    // довод — нет, он про НЕЗАВИСИМОСТЬ хешей, а не про архетипы.)
    constexpr std::uint32_t kZoneWalkSalt = 0x7A6F6E65u; // "zone"

    RoomId at = from;
    RoomId last = kNoRoom; // последняя зона, ОТЛИЧНАЯ от стартовой
    for (std::uint16_t step = 0; step < legZones; ++step) {
        const std::uint32_t idx = static_cast<std::uint32_t>(at) - 1u;
        const std::uint32_t deg = zn.graph.degree(idx);
        if (deg == 0) break; // тупик: дальше идти нечем
        // Шаг зависит от НОМЕРА ШАГА, а не только от соли: иначе блуждание из
        // одной зоны с одной солью топталось бы по одному ребру туда-обратно.
        const std::uint32_t h = hash3(salt, step, kZoneWalkSalt);
        at = zn.graph.begin(idx)[h % deg];
        if (at != from) last = at;
    }
    // Вернулись в себя — отдаём последнюю чужую зону пути. Цель «сам в себе»
    // была бы мгновенным прибытием и прибор врал бы прибытиями на ровном месте.
    if (at == from) return last;
    return at;
}

std::uint8_t zone_walk_dir(const ZoneNav& zn, RoomId myZone, RoomId target,
                           int cx, int cy, int cz, int gravityAxis) {
    if (!zn.built() || myZone == kNoRoom || target == kNoRoom) return kZoneFlowNone;
    if (myZone == target) return kZoneFlowNone; // уже на месте — шага нет
    const RoomId nextZone = zone_next(zn.graph, zn.dist, myZone, target);
    if (nextZone == kNoRoom) return kZoneFlowNone; // другая компонента
    const int slot = zone_nbr_slot(zn.graph, myZone, nextZone);
    if (slot < 0) return kZoneFlowNone;

    int x = wrap_macro(cx), y = wrap_macro(cy), z = wrap_macro(cz);
    // Предел взгляда вперёд — kSubDim: подъём на целую клетку. Дальше ступенька
    // перестаёт быть ступенькой, и честнее отказать, чем вести тело в уступ.
    for (int guard = 0; guard <= kSubDim; ++guard) {
        const std::uint8_t d = zn.flow.at(slot, macro_index(x, y, z));
        if (d == kZoneFlowNone) return kZoneFlowNone;
        if (gravityAxis < 0 || (d >> 1) != gravityAxis) return d; // ходьба тратит
        x = wrap_macro(x + nav::kNavDir[d][0]);
        y = wrap_macro(y + nav::kNavDir[d][1]);
        z = wrap_macro(z + nav::kNavDir[d][2]);
        if (zn.part.cell(x, y, z) != myZone) return d; // ступенька и есть выход
    }
    return kZoneFlowNone;
}

} // namespace giga::game
