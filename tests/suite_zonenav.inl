// НАВ ПО ЗОНАМ, ЯРУС 1 — граф зон и таблица «зона → зона».
//
// Включается в game_test.cpp: CHECK-макрос и using-декларации оттуда. Всё,
// кроме входной точки test_zonenav_all(), живёт в namespace zonenav_test.
//
// Этаж НАСТОЯЩИЙ, не игрушка: предмет гейта — смежность зон на реальной
// геометрии, а на двух кубиках она тождественна.
//
// ЧТО ПИНИТСЯ, И ПОЧЕМУ ИМЕННО ЭТО
//
//   1. СМЕЖНОСТЬ == НЕЗАВИСИМЫЙ ПЕРЕСЧЁТ. Эталон считается ЗДЕСЬ, своими
//      циклами, из закона, переписанного независимо от продакшн-кода («есть
//      пара касающихся клеток разных зон, чью грань тело пролезает»). Сьют,
//      строящий эталон вызовом кода под тестом, доказал бы лишь согласие кода
//      с самим собой.
//   2. СИММЕТРИЧНОСТЬ. Ребро неориентированное; односторонняя запись дала бы
//      «отсюда туда можно, оттуда сюда нельзя» — и толпа ходила бы в одну
//      сторону.
//   3. ГЛУХАЯ КЛАДКА НЕ РЕБРО. Прямая мутация закона: если убрать проверку
//      клиренса, рёбер становится БОЛЬШЕ. Гейт держит это неравенством, а не
//      точным числом, — точное число было бы пином геометрии этажа, а не закона.
//   4. ДВУХУРОВНЕВАЯ ТАБЛИЦА: S = floor((Z²/2)^(1/3)), связность и баланс
//      секторов (гейт на S² + ΣZ_s² против идеала и потолок <= 2 МиБ на
//      этаже 0), точность intraDist, метрика sectorDist, порталы, и симметричная
//      нижняя оценка `dist.at` при sA != sB.
//   5. zone_next ВЕДЁТ, А НЕ КРУЖИТ: строгий лексикографический спуск по
//      (sectorDist, intraDist) между сотнями случайных достижимых пар без
//      единого цикла за конечное число шагов.
#include <algorithm>
#include <cmath>
#include <vector>

#include "game/floor_gen.h"   // generate_floor
#include "game/floor_spec.h"  // FloorKind, floor_spec
#include "game/room.h"        // FloorRooms, roomAt, kNoRoom
#include "game/zone_nav.h"    // предмет
#include "world/clearance.h"  // face_clearance_at — закон, переписанный независимо
#include "world/macro_grid.h"
#include "world/types.h"
#include "world/world.h"

namespace zonenav_test {

// Эталон смежности, собранный НЕЗАВИСИМО: множество пар (a,b), a<b. Никакой
// CSR, никакого дедупа через сортировку — наивный set поверх вектора флагов по
// паре был бы Z², поэтому пары собираются и сортируются, но ЗАКОН переписан
// здесь своими руками.
std::vector<std::uint32_t> ref_pairs(const ZonePartition& part,
                                     const ClearanceField& oracle, int size,
                                     bool requireClearance) {
    std::vector<std::uint32_t> p;
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                const RoomId a = part.cell(x, y, z);
                if (a == kNoRoom) continue;
                for (int axis = 0; axis < 3; ++axis) {
                    const RoomId b = part.cell(x + (axis == 0 ? 1 : 0),
                                               y + (axis == 1 ? 1 : 0),
                                               z + (axis == 2 ? 1 : 0));
                    if (b == kNoRoom || b == a) continue;
                    if (requireClearance &&
                        oracle.at(x, y, z, 2 * axis + 1) < size)
                        continue;
                    const RoomId lo = a < b ? a : b;
                    const RoomId hi = a < b ? b : a;
                    p.push_back((static_cast<std::uint32_t>(lo) << 16) | hi);
                }
            }
    std::sort(p.begin(), p.end());
    p.erase(std::unique(p.begin(), p.end()), p.end());
    return p;
}

void graph_equals_independent_recount(const World& w, const ZonePartition& part,
                                      const ClearanceField& oracle) {
    ZoneGraph g;
    bake_zone_graph(part, oracle, kBodyClearanceSub, g);
    CHECK(g.built());
    CHECK(g.zones == part.zones);

    const std::vector<std::uint32_t> ref =
        ref_pairs(part, oracle, kBodyClearanceSub, /*requireClearance=*/true);
    CHECK(!ref.empty()); // этаж в самом деле дал смежные зоны

    // 1. Каждое ребро продакшна есть в эталоне, и наоборот — через счёт и
    // через проверку вхождения. Счёт рёбер = половина записей CSR.
    CHECK(g.nbr.size() == ref.size() * 2u);
    std::size_t found = 0;
    for (std::uint32_t z = 0; z < g.zones; ++z)
        for (const RoomId* it = g.begin(z); it != g.end(z); ++it) {
            const RoomId a = static_cast<RoomId>(z + 1);
            const RoomId b = *it;
            CHECK(b != kNoRoom);
            CHECK(b != a); // петель нет
            const RoomId lo = a < b ? a : b;
            const RoomId hi = a < b ? b : a;
            const std::uint32_t key = (static_cast<std::uint32_t>(lo) << 16) | hi;
            if (std::binary_search(ref.begin(), ref.end(), key)) ++found;
        }
    CHECK(found == g.nbr.size()); // ни одного ребра сверх эталона

    // 2. Симметричность — поштучно.
    std::size_t asym = 0;
    for (std::uint32_t z = 0; z < g.zones; ++z)
        for (const RoomId* it = g.begin(z); it != g.end(z); ++it) {
            const std::uint32_t o = static_cast<std::uint32_t>(*it) - 1u;
            bool back = false;
            for (const RoomId* jt = g.begin(o); jt != g.end(o); ++jt)
                if (static_cast<std::uint32_t>(*jt) - 1u == z) back = true;
            if (!back) ++asym;
        }
    CHECK(asym == 0);

    // 3. ГЛУХАЯ КЛАДКА НЕ РЕБРО. Тот же обход БЕЗ проверки клиренса обязан дать
    // пар СТРОГО больше: значит проверка в продакшне не декорация. Это мутация
    // закона, прогнанная самим гейтом, а не обещание в комментарии.
    const std::vector<std::uint32_t> refTouch =
        ref_pairs(part, oracle, kBodyClearanceSub, /*requireClearance=*/false);
    CHECK(refTouch.size() > ref.size());
}

// БЛИЗКАЯ ЦЕЛЬ БЕРЁТСЯ ОБХОДОМ, А НЕ ОТБОРОМ — и этот блок есть ГЕЙТ НА ЗАМЕР,
// опровергнувший первую редакцию обоих ходоков (§88/F.2).
//
// Наряд и прогулка брали `kTries` РАВНОМЕРНЫХ кандидатов среди всех зон этажа и
// отбрасывали тех, что дальше предела. Замер, этаж 0, 13818 зон, секунда сима:
// 119 попыток, 952 кандидата, выборов НОЛЬ. Утверждение, купленное замером,
// обязано иметь гейт — иначе следующая редакция купит его снова, и купит той же
// ценой: прибор показывал бы «не доходят» там, где тела не выбирали цель вовсе.
//
// Поэтому гейт НЕ просто проверяет обход. Он считает ДОЛЮ УСПЕХА обоих способов
// на одном и том же настоящем графе и печатает оба числа: отбор обязан быть
// почти всегда пустым, обход — почти всегда полным. Это мутация закона,
// прогнанная самим гейтом, а не обещание в комментарии.
void near_pick_walks_the_graph(const ZonePartition& part,
                               const ClearanceField& oracle) {
    ZoneNav zn;
    bake_zone_graph(part, oracle, kBodyClearanceSub, zn.graph);
    bake_zone_dist(zn.graph, zn.dist, /*threads=*/2);
    zn.part = part;
    CHECK(zn.graph.built());
    CHECK(zn.dist.built());

    // Предел берётся ТОЙ ЖЕ дверью, которой его берёт прод: бюджет в метрах,
    // прыжки считает бейк. Литерал здесь был бы вторым ответом на вопрос
    // «сколько прыжков», и разошёлся бы с продом на первом же модуле с другими
    // зонами — ровно тем, что решение владельца 2026-10-12 и называет нормой.
    const std::uint16_t kLeg = zone_hops_for_metres(part, kWanderLegMetres);
    constexpr std::uint32_t kTriesOld = 8; // сколько пробовала первая редакция
    CHECK(kLeg >= 1);                      // ноль прыжков = цель «сам в себе»
    std::fprintf(stderr, "[zonenav] поперёк зоны %.1f м -> предел ноги %u прыжков\n",
                 static_cast<double>(zone_span_m(part)), kLeg);
    // Независимый ограниченный BFS на графе глубиной <= kLeg для проверки
    // предела при внутрисекторном шорткате через другой сектор.
    auto graph_within_hops = [&](std::uint32_t src, std::uint32_t dst,
                                 std::uint16_t maxHops) -> bool {
        if (src == dst) return true;
        std::vector<std::pair<std::uint32_t, std::uint16_t>> q;
        std::vector<std::uint32_t> vis;
        q.push_back({src, 0u});
        vis.push_back(src);
        for (std::size_t h = 0; h < q.size(); ++h) {
            const std::uint32_t u = q[h].first;
            const std::uint16_t d = q[h].second;
            if (d >= maxHops) continue;
            for (const RoomId* it = zn.graph.begin(u); it != zn.graph.end(u); ++it) {
                const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                if (v == dst) return true;
                if (std::find(vis.begin(), vis.end(), v) == vis.end()) {
                    vis.push_back(v);
                    q.push_back({v, static_cast<std::uint16_t>(d + 1u)});
                }
            }
        }
        return false;
    };

    std::uint32_t sampled = 0, walkFound = 0, rejectFound = 0, overLimit = 0;
    std::uint32_t isolated = 0, nondet = 0, selfPick = 0;
    for (std::uint32_t z = 0; z < zn.graph.zones; z += 37) {
        const RoomId from = static_cast<RoomId>(z + 1u);
        ++sampled;
        if (zn.graph.degree(z) == 0) ++isolated;

        // СПОСОБ 1 — обход графа (живой).
        const RoomId got = zone_pick_near(zn, from, 0x51ee7u ^ z, kLeg);
        if (got != kNoRoom) {
            ++walkFound;
            if (got == from) ++selfPick;
            const std::uint32_t gi = static_cast<std::uint32_t>(got) - 1u;
            const std::uint16_t d = zn.dist.at(z, gi);
            // Предел соблюдён по графу, а межсекторная нижняя оценка не
            // завышает истинного расстояния и не отдаёт kZoneUnreachable.
            if (d == kZoneUnreachable ||
                (zn.dist.sectorOf[z] != zn.dist.sectorOf[gi] && d > kLeg) ||
                !graph_within_hops(z, gi, kLeg)) {
                ++overLimit;
            }
        }
        // Детерминизм: та же соль — тот же ответ. Иначе тело меняло бы цель на
        // каждом визите и стаггер пере-выбора терял бы смысл.
        if (zone_pick_near(zn, from, 0x51ee7u ^ z, kLeg) != got) ++nondet;

        // СПОСОБ 2 — ОТБОР ИЗ РАВНОМЕРНОЙ ВЫБОРКИ, дословно первая редакция.
        const std::uint32_t h = hash_u32(0x51ee7u ^ z);
        for (std::uint32_t k = 0; k < kTriesOld; ++k) {
            const std::uint32_t cand = (h + k * 2654435761u) % zn.graph.zones;
            if (cand == z) continue;
            const std::uint16_t d = zn.dist.at(z, cand);
            if (d == kZoneUnreachable || d > kLeg) continue;
            ++rejectFound;
            break;
        }
    }
    std::fprintf(stderr,
                 "[zonenav] близкая цель на %u зонах: обход нашёл %u/%u, "
                 "ОТБОР (8 равномерных кандидатов) нашёл %u/%u, изолированных %u\n",
                 zn.graph.zones, walkFound, sampled, rejectFound, sampled,
                 isolated);

    CHECK(sampled > 100);          // выборка не вырождена
    CHECK(nondet == 0);            // чистая функция от (граф, соль, предел)
    CHECK(overLimit == 0);         // предел соблюдён, и это проверено ТАБЛИЦЕЙ
    CHECK(selfPick == 0);          // цель «сам в себе» = мгновенное прибытие
    // ОБХОД НАХОДИТ ПОЧТИ ВСЕГДА: неудача законна только у изолированной зоны.
    CHECK(walkFound + isolated >= sampled);
    // А ОТБОР — ПОЧТИ НИКОГДА, и вот это число и есть опровергнутая редакция.
    // Доля зон в пределах двух рёбер есть десятки из десятков тысяч.
    CHECK(rejectFound * 10u < walkFound);
}

void table_is_a_metric(const World& w, const ZonePartition& part,
                       const ClearanceField& oracle) {
    (void)w;
    ZoneGraph g;
    bake_zone_graph(part, oracle, kBodyClearanceSub, g);
    ZoneDist dist;
    bake_zone_dist(g, dist, /*threads=*/2);
    CHECK(dist.built());
    CHECK(dist.zones == g.zones);
    CHECK(dist.sectors >= 1u && dist.sectors <= g.zones);

    // 1. ГЕЙТ ФОРМУЛЫ И БАЛАНСА СЕКТОРОВ (S = floor((Z²/2)^(1/3)), нет жирного хаба).
    // Считаем S² + ΣZ_s² независимо прямо по dist.sectorOf и сверяем с идеалом.
    const std::uint32_t Z = g.zones;
    const std::uint32_t sTarget = std::clamp(
        static_cast<std::uint32_t>(
            std::floor(std::cbrt(static_cast<double>(Z) * Z * 0.5))),
        1u, Z);
    const std::uint32_t idealCap =
        std::max<std::uint32_t>(1u, (Z + sTarget - 1u) / sTarget);

    std::vector<std::uint32_t> secCnt(dist.sectors, 0u);
    for (std::uint32_t z = 0; z < Z; ++z) {
        CHECK(dist.sectorOf[z] < dist.sectors);
        ++secCnt[dist.sectorOf[z]];
    }
    std::size_t sumSq = 0;
    std::uint32_t maxSec = 0, badSecCount = 0;
    for (std::uint32_t s = 0; s < dist.sectors; ++s) {
        if (secCnt[s] == 0u || secCnt[s] != dist.sectorSize[s]) ++badSecCount;
        sumSq += static_cast<std::size_t>(secCnt[s]) * secCnt[s];
        if (secCnt[s] > maxSec) maxSec = secCnt[s];
    }
    const std::size_t actualCost =
        static_cast<std::size_t>(dist.distSectors) * dist.distSectors + sumSq;
    const std::size_t idealCost =
        static_cast<std::size_t>(sTarget) * sTarget +
        (static_cast<std::size_t>(Z) * Z) / sTarget;
    std::fprintf(stderr,
                 "[zone-nav] зон %u | секторов %u (связн %u, цель %u) | "
                 "D²+ΣZ_s² %zu vs идеал %zu (%.2fx) | макс_сектор %u (идеал %u) | "
                 "рёбер %zu | таблица %.2f МиБ\n",
                 Z, dist.sectors, dist.distSectors, sTarget, actualCost, idealCost,
                 idealCost ? static_cast<double>(actualCost) /
                                 static_cast<double>(idealCost)
                           : 0.0,
                 maxSec, idealCap, g.nbr.size() / 2u,
                 static_cast<double>(dist.bytes()) / (1024.0 * 1024.0));

    CHECK(badSecCount == 0u);
    CHECK(dist.bytes() <= 2u * 1024u * 1024u); // <= 2 МиБ на худшем этаже 0
    CHECK(actualCost * 10u <= idealCost * 16u); // кривое деление с хабом краснеет
    CHECK(maxSec <= std::max<std::uint32_t>(4u, idealCap * 2u));

    // 2. КАЖДЫЙ СЕКТОР СВЯЗЕН ВНУТРИ СЕБЯ, а intraDist — точная метрика подграфа.
    std::vector<std::vector<std::uint32_t>> secVerts(dist.sectors);
    for (std::uint32_t z = 0; z < Z; ++z)
        secVerts[dist.sectorOf[z]].push_back(z);
    int intraUnreach = 0, intraAsym = 0, intraDiag = 0, intraTri = 0;
    for (std::uint32_t s = 0; s < dist.sectors; ++s) {
        const std::uint32_t sz = dist.sectorSize[s];
        const std::uint32_t off = dist.intraOffset[s];
        for (std::uint32_t i = 0; i < sz; ++i) {
            if (dist.intraDist[off + static_cast<std::size_t>(i) * sz + i] != 0u)
                ++intraDiag;
            for (std::uint32_t j = 0; j < sz; ++j) {
                const std::uint16_t d =
                    dist.intraDist[off + static_cast<std::size_t>(i) * sz + j];
                if (d == kZoneUnreachable) ++intraUnreach;
                if (dist.intraDist[off + static_cast<std::size_t>(j) * sz + i] != d)
                    ++intraAsym;
                if (i != j && d != kZoneUnreachable) {
                    const std::uint32_t u = secVerts[s][i];
                    std::uint16_t best = kZoneUnreachable;
                    for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                        const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                        if (dist.sectorOf[v] != s) continue;
                        const std::uint16_t dn =
                            dist.intraDist[off +
                                           static_cast<std::size_t>(dist.localIdx[v]) * sz +
                                           j];
                        if (dn < best) best = dn;
                    }
                    if (best == kZoneUnreachable || best + 1u != d) ++intraTri;
                }
            }
        }
    }
    CHECK(intraDiag == 0);
    CHECK(intraUnreach == 0); // ни одного несвязного сектора
    CHECK(intraAsym == 0);
    CHECK(intraTri == 0);

    // 3. ПОРТАЛЫ И ГРАФ СЕКТОРОВ: каждый портал лежит в sA и имеет соседа в sNext,
    //    а sectorDist удовлетворяет метрике на графе секторов.
    int badPortal = 0, secDiag = 0, secAsym = 0, secTri = 0;
    for (std::uint32_t sA = 0; sA < dist.sectors; ++sA) {
        if (dist.sector_dist(static_cast<std::uint16_t>(sA),
                             static_cast<std::uint16_t>(sA)) != 0u)
            ++secDiag;
        for (std::uint32_t e = dist.sectorOffset[sA]; e < dist.sectorOffset[sA + 1u]; ++e) {
            const std::uint16_t sN = dist.sectorNbr[e];
            const RoomId p = dist.sectorPortal[e];
            if (p == kNoRoom || p > Z || dist.sectorOf[p - 1u] != sA) {
                ++badPortal;
                continue;
            }
            bool touchesSN = false;
            for (const RoomId* it = g.begin(p - 1u); it != g.end(p - 1u); ++it) {
                if (dist.sectorOf[static_cast<std::uint32_t>(*it) - 1u] == sN) {
                    touchesSN = true;
                    break;
                }
            }
            if (!touchesSN) ++badPortal;
        }
        for (std::uint32_t sB = 0; sB < dist.sectors; sB += 7) {
            const std::uint16_t sd = dist.sector_dist(
                static_cast<std::uint16_t>(sA), static_cast<std::uint16_t>(sB));
            if (dist.sector_dist(static_cast<std::uint16_t>(sB),
                                 static_cast<std::uint16_t>(sA)) != sd)
                ++secAsym;
            if (sA != sB && sd != kZoneUnreachable) {
                std::uint16_t best = kZoneUnreachable;
                for (std::uint32_t e = dist.sectorOffset[sA];
                     e < dist.sectorOffset[sA + 1u]; ++e) {
                    const std::uint16_t sN = dist.sectorNbr[e];
                    const std::uint16_t d =
                        dist.sector_dist(sN, static_cast<std::uint16_t>(sB));
                    if (d < best) best = d;
                }
                if (best == kZoneUnreachable || best + 1u != sd) ++secTri;
            }
        }
    }
    CHECK(badPortal == 0);
    CHECK(secDiag == 0);
    CHECK(secAsym == 0);
    CHECK(secTri == 0);

    // 4. ПУБЛИЧНАЯ ТАБЛИЦА `dist.at`: ноль на диагонали, симметрия, неравенство
    //    треугольника между секторами (sA != sB).
    int checkedDiag = 0, asym = 0, triBad = 0, reach = 0;
    for (std::uint32_t a = 0; a < Z; a += 97) {
        CHECK(dist.at(a, a) == 0); // 4. ноль на диагонали
        ++checkedDiag;
        for (std::uint32_t b = 0; b < Z; b += 89) {
            const std::uint16_t ab = dist.at(a, b);
            if (dist.at(b, a) != ab) ++asym;
            if (ab != kZoneUnreachable) ++reach;
            if (ab != kZoneUnreachable && dist.sectorOf[a] != dist.sectorOf[b]) {
                for (const RoomId* it = g.begin(a); it != g.end(a); ++it) {
                    const std::uint16_t dn =
                        dist.at(static_cast<std::uint32_t>(*it) - 1u, b);
                    if (dn == kZoneUnreachable || ab > dn + 1u) ++triBad;
                }
            }
        }
    }
    CHECK(checkedDiag > 0);
    CHECK(asym == 0);
    CHECK(triBad == 0);
    CHECK(reach > 0); // таблица не вся недостижима — иначе всё выше тождественно

    // 4b. СВЯЗНОСТЬ ОСНОВНОЙ ХОДОВОЙ КОМПОНЕНТЫ: полный обход компонент ZoneGraph,
    //     чтобы найти крупнейшую компоненту (отдельные замкнутые помещения в начале
    //     индексации не искажают замер) и сверить достижимость с `dist.at`.
    std::uint32_t bestSeed = Z;
    std::size_t bestSize = 0u;
    std::vector<std::uint8_t> compVis(Z, 0u);
    std::vector<std::uint32_t> bfsQ;
    bfsQ.reserve(Z);
    for (std::uint32_t start = 0; start < Z; ++start) {
        if (compVis[start] || g.degree(start) == 0u) continue;
        bfsQ.clear();
        compVis[start] = 1u;
        bfsQ.push_back(start);
        for (std::size_t h = 0; h < bfsQ.size(); ++h) {
            const std::uint32_t u = bfsQ[h];
            for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                if (!compVis[v]) {
                    compVis[v] = 1u;
                    bfsQ.push_back(v);
                }
            }
        }
        if (bfsQ.size() > bestSize) {
            bestSize = bfsQ.size();
            bestSeed = start;
        }
    }
    CHECK(bestSeed < Z);
    std::vector<std::uint8_t> bfsVis(Z, 0u);
    bfsQ.clear();
    if (bestSeed < Z) {
        bfsVis[bestSeed] = 1u;
        bfsQ.push_back(bestSeed);
        for (std::size_t h = 0; h < bfsQ.size(); ++h) {
            const std::uint32_t u = bfsQ[h];
            for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                if (!bfsVis[v]) {
                    bfsVis[v] = 1u;
                    bfsQ.push_back(v);
                }
            }
        }
    }
    std::uint32_t compReachMismatch = 0u;
    std::uint32_t compLeakMismatch = 0u;
    if (bestSeed < Z) {
        for (std::uint32_t z = 0; z < Z; ++z) {
            const std::uint16_t d = dist.at(bestSeed, z);
            if (bfsVis[z]) {
                if (d == kZoneUnreachable) ++compReachMismatch;
            } else {
                if (d != kZoneUnreachable) ++compLeakMismatch;
            }
        }
    }
    std::fprintf(stderr,
                 "[zone-nav] главная компонента от %u: %zu/%u зон "
                 "(недост %u, утечек %u)\n",
                 bestSeed, bfsQ.size(), Z,
                 compReachMismatch, compLeakMismatch);
    // Главная компонента обязана накрывать многократно больше одного сектора
    // (в многоярусном Residential 128³ ~18 изолированных палуб по ~800 зон).
    CHECK(bfsQ.size() > static_cast<std::size_t>(idealCap) * 4u);
    CHECK(compReachMismatch == 0u);
    CHECK(compLeakMismatch == 0u);

    // 5. zone_next ВЕДЁТ, А НЕ КРУЖИТ: строгий спуск лексикографического
    //    потенциала (sectorDist, intraDist до портала или цели) на 256+
    //    разнородных достижимых парах, без единого цикла.
    auto lyapunov_pair = [&](std::uint32_t u, std::uint32_t t)
        -> std::pair<std::uint16_t, std::uint16_t> {
        const std::uint16_t sU = dist.sectorOf[u];
        const std::uint16_t sT = dist.sectorOf[t];
        const std::uint32_t sz = dist.sectorSize[sU];
        const std::uint32_t off = dist.intraOffset[sU];
        if (sU == sT) {
            return {0u, dist.intraDist[off +
                                       static_cast<std::size_t>(dist.localIdx[u]) * sz +
                                       dist.localIdx[t]]};
        }
        const std::uint16_t sd = dist.sector_dist(sU, sT);
        RoomId portal = kNoRoom;
        for (std::uint32_t e = dist.sectorOffset[sU]; e < dist.sectorOffset[sU + 1u]; ++e) {
            const std::uint16_t sN = dist.sectorNbr[e];
            const std::uint16_t nsd = dist.sector_dist(sN, sT);
            if (nsd != kZoneUnreachable && nsd + 1u == sd) {
                portal = dist.sectorPortal[e];
                break;
            }
        }
        const std::uint32_t p = static_cast<std::uint32_t>(portal) - 1u;
        return {sd, dist.intraDist[off +
                                   static_cast<std::size_t>(dist.localIdx[u]) * sz +
                                   dist.localIdx[p]]};
    };

    int walked = 0, badStep = 0, nonMono = 0, notReached = 0;
    const int stepCap = static_cast<int>(Z) + 1;
    for (std::uint32_t i = 0; i < 16384u && walked < 280; ++i) {
        const std::uint32_t a = (i * 2654435761u) % Z;
        const std::uint32_t b = ((i + 17u) * 2246822519u + 13u) % Z;
        if (a == b || dist.at(a, b) == kZoneUnreachable) continue;
        RoomId cur = static_cast<RoomId>(a + 1u);
        const RoomId dst = static_cast<RoomId>(b + 1u);
        int steps = 0;
        while (cur != dst && steps < stepCap) {
            const RoomId nxt = zone_next(g, dist, cur, dst);
            if (nxt == kNoRoom) {
                ++badStep;
                break;
            }
            if (zone_nbr_slot(g, cur, nxt) < 0) {
                ++badStep;
                break;
            }
            const auto before = lyapunov_pair(static_cast<std::uint32_t>(cur) - 1u, b);
            const auto after = lyapunov_pair(static_cast<std::uint32_t>(nxt) - 1u, b);
            if (!(after < before)) ++nonMono; // потенциал обязан строго убывать
            cur = nxt;
            ++steps;
        }
        if (cur != dst) ++notReached;
        ++walked;
    }
    CHECK(walked >= 256);
    CHECK(badStep == 0);
    CHECK(nonMono == 0);
    CHECK(notReached == 0);
}

// ПОЛЯ ВНУТРИ ЗОНЫ (инкремент C). Четыре утверждения, и каждое о своём законе.
void flow_is_clipped_and_leads_out(const World& w, const ZonePartition& part,
                                   const ZoneGraph& g,
                                   const ClearanceField& oracle) {
    ZoneFlow flow;
    bake_zone_flow(part, g, oracle, kBodyClearanceSub, w.gravity().regime, flow);
    CHECK(flow.built());

    // Плоскостей ровно столько, какова МАКСИМАЛЬНАЯ степень зоны: это не кап, а
    // следствие обрезки — k-е поля всех зон не пересекаются по клеткам.
    std::uint32_t maxDeg = 0;
    for (std::uint32_t z = 0; z < g.zones; ++z)
        if (g.degree(z) > maxDeg) maxDeg = g.degree(z);
    CHECK(flow.planes == maxDeg);
    std::fprintf(stderr,
                 "[zone-nav] плоскостей %u (макс. степень зоны) | поля %.1f МиБ\n",
                 flow.planes,
                 static_cast<double>(flow.bytes()) / (1024.0 * 1024.0));

    // 1. ОБРЕЗКА ЗОНОЙ. Значение в плоскости k может стоять только у клетки,
    // чья зона в самом деле имеет k-ю соседку. Залив, перетёкший в соседку,
    // ломает это первым же номером — и это главный сторож всей раскладки
    // плоскостями: без обрезки поля разных зон начали бы драться за клетку.
    std::size_t leaked = 0, covered = 0;
    for (std::uint32_t k = 0; k < flow.planes; ++k)
        for (std::size_t c = 0; c < kMacroCells; c += 7) {
            if (flow.at(static_cast<int>(k), c) == kZoneFlowNone) continue;
            ++covered;
            const RoomId z = part.at[c];
            if (z == kNoRoom || g.degree(static_cast<std::uint32_t>(z) - 1u) <= k)
                ++leaked;
        }
    CHECK(leaked == 0);
    CHECK(covered > 0); // поля не пусты — иначе утверждение выше тождественно

    // 2+3. СПУСК ПРИХОДИТ НА ГРАНИЦУ, НЕ ВЫХОДЯ ИЗ ЗОНЫ, и граница — настоящий
    // выход: у клетки `kZoneFlowArrived` есть ПРОХОДИМЫЙ сосед из целевой зоны.
    int walked = 0, badArrive = 0, wrongZone = 0, noArrive = 0;
    for (std::uint32_t z = 0; z < g.zones && walked < 64; z += 211) {
        const std::uint32_t deg = g.degree(z);
        for (std::uint32_t k = 0; k < deg && walked < 64; ++k) {
            const RoomId target = g.nbr[g.offset[z] + k];
            // Любая клетка этой зоны, покрытая полем.
            for (std::size_t c = 0; c < kMacroCells && walked < 64; c += 3) {
                if (part.at[c] != static_cast<RoomId>(z + 1)) continue;
                if (flow.at(static_cast<int>(k), c) == kZoneFlowNone) continue;
                std::size_t cur = c;
                int steps = 0;
                const int cap = static_cast<int>(kMacroCells);
                bool crossed = false, bad = false;
                while (steps++ <= cap) {
                    const std::uint8_t d = flow.at(static_cast<int>(k), cur);
                    if (d == kZoneFlowNone) { ++noArrive; bad = true; break; }
                    const int cx = static_cast<int>(cur % kMacroDim);
                    const int cy = static_cast<int>((cur / kMacroDim) % kMacroDim);
                    const int cz = static_cast<int>(cur / (kMacroDim * kMacroDim));
                    // Шаг обязан быть ПРОХОДИМЫМ — поле не ведёт в стену.
                    const int axis = d >> 1;
                    const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
                    const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
                    const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
                    const std::uint8_t cl =
                        (d & 1) != 0 ? oracle.at(cx, cy, cz, 2 * axis + 1)
                                     : oracle.at(nx, ny, nz, 2 * axis + 1);
                    if (cl < kBodyClearanceSub) { ++badArrive; bad = true; break; }
                    const std::size_t nn = macro_index(nx, ny, nz);
                    if (part.at[nn] == target) { crossed = true; break; }
                    if (part.at[nn] != static_cast<RoomId>(z + 1)) {
                        ++wrongZone; // вышли, но НЕ в целевую зону
                        bad = true;
                        break;
                    }
                    cur = nn;
                }
                if (!bad && !crossed) ++noArrive; // повис в пределах зоны
                ++walked;
            }
        }
    }
    CHECK(walked > 0);      // спуск в самом деле прогнан
    CHECK(wrongZone == 0);  // спуск вывел ИМЕННО в целевую зону, не куда попало
    CHECK(noArrive == 0);   // ни один спуск не повис и не оборвался
    CHECK(badArrive == 0);  // ни один шаг поля не ведёт в стену
}

// ВЕС И КАСАНИЕ (инкремент D). Три утверждения, и они о трёх разных законах.
void weight_prefers_support_and_gravity_is_only_price(const World& w,
                                                      const ZonePartition& part,
                                                      const ZoneGraph& g, const ClearanceField& oracle) {
    // A. КАСАНИЕ — ЗАКОННОСТЬ: в разбивке нет ни одной клетки, за которую не
    // держатся. Это и есть запрет полёта, выраженный отсутствием, а не правилом.
    std::size_t airborne = 0, inPart = 0;
    for (std::size_t c = 0; c < kMacroCells; c += 11) {
        if (part.at[c] == kNoRoom) continue;
        ++inPart;
        const int x = static_cast<int>(c % kMacroDim);
        const int y = static_cast<int>((c / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(c / (kMacroDim * kMacroDim));
        if (!oracle.touching(x, y, z, kBodyClearanceSub)) ++airborne;
    }
    CHECK(inPart > 0);
    CHECK(airborne == 0);

    ZoneFlow fg;
    bake_zone_flow(part, g, oracle, kBodyClearanceSub, w.gravity().regime, fg);
    ZoneFlow f0;
    bake_zone_flow(part, g, oracle, kBodyClearanceSub, GravityRegime::Zero, f0);

    // B. ГРАВИТАЦИЯ МЕНЯЕТ ЦЕНУ, А НЕ ЗАКОННОСТЬ. Множество покрытых клеток
    // обязано СОВПАСТЬ между осевой гравитацией и нулевой: лазать можно всюду,
    // и вес решает лишь КАК идти, а не КУДА можно. Если это утверждение падает,
    // значит вес начал запрещать — ровно та ошибка, которой §88 стоил дня.
    CHECK(fg.planes == f0.planes);
    std::size_t coverDiff = 0, coverBoth = 0;
    for (std::uint32_t k = 0; k < fg.planes; ++k)
        for (std::size_t c = 0; c < kMacroCells; c += 5) {
            const bool a = fg.at(static_cast<int>(k), c) != kZoneFlowNone;
            const bool b = f0.at(static_cast<int>(k), c) != kZoneFlowNone;
            if (a != b) ++coverDiff;
            if (a) ++coverBoth;
        }
    CHECK(coverDiff == 0);
    CHECK(coverBoth > 0); // покрытие непусто — иначе утверждение тождественно

    // C. ПОЛЕ ЕСТЬ ЛЕКСИКОГРАФИЧЕСКИЙ ОПТИМУМ, и эталон считается ЗДЕСЬ,
    // независимо: своя слоёная волна от границы, свой счёт лазаний. Спуск по
    // продакшн-полю обязан дать РОВНО столько лазаний, сколько минимум.
    int judged = 0, worse = 0;
    for (std::uint32_t z = 0; z < g.zones && judged < 24; z += 503) {
        const std::uint32_t deg = g.degree(z);
        if (deg == 0) continue;
        const RoomId mine = static_cast<RoomId>(z + 1);
        const RoomId target = g.nbr[g.offset[z]];
        // Эталон: минимум лазаний до границы, волна слоями, написана заново.
        std::vector<std::pair<std::size_t, int>> refCost; // (клетка, лазаний)
        std::vector<std::size_t> cur, nxt;
        auto push = [&](std::size_t c, int lvl) {
            for (const auto& e : refCost)
                if (e.first == c) return;
            refCost.push_back({c, lvl});
        };
        for (std::size_t c = 0; c < kMacroCells; ++c) {
            if (part.at[c] != mine) continue;
            const int x = static_cast<int>(c % kMacroDim);
            const int y = static_cast<int>((c / kMacroDim) % kMacroDim);
            const int zz = static_cast<int>(c / (kMacroDim * kMacroDim));
            for (int d = 0; d < 6; ++d) {
                const int nx = wrap_macro(x + nav::kNavDir[d][0]);
                const int ny = wrap_macro(y + nav::kNavDir[d][1]);
                const int nz = wrap_macro(zz + nav::kNavDir[d][2]);
                if (part.cell(nx, ny, nz) != target) continue;
                const int axis = d >> 1;
                const std::uint8_t cl =
                    (d & 1) != 0 ? oracle.at(x, y, zz, 2 * axis + 1)
                                 : oracle.at(nx, ny, nz, 2 * axis + 1);
                if (cl < kBodyClearanceSub) continue;
                const int lvl = oracle.supported(x, y, zz, kBodyClearanceSub,
                                                 w.gravity().regime) ? 0 : 1;
                push(c, lvl);
                if (lvl == 0) cur.push_back(c); else nxt.push_back(c);
                break;
            }
        }
        int level = 0;
        for (;;) {
            for (std::size_t h = 0; h < cur.size(); ++h) {
                const std::size_t c = cur[h];
                const int x = static_cast<int>(c % kMacroDim);
                const int y = static_cast<int>((c / kMacroDim) % kMacroDim);
                const int zz = static_cast<int>(c / (kMacroDim * kMacroDim));
                for (int d = 0; d < 6; ++d) {
                    const int nx = wrap_macro(x + nav::kNavDir[d][0]);
                    const int ny = wrap_macro(y + nav::kNavDir[d][1]);
                    const int nz = wrap_macro(zz + nav::kNavDir[d][2]);
                    const std::size_t ni = macro_index(nx, ny, nz);
                    if (part.at[ni] != mine) continue;
                    bool seen = false;
                    for (const auto& e : refCost)
                        if (e.first == ni) seen = true;
                    if (seen) continue;
                    const int axis = d >> 1;
                    const std::uint8_t cl =
                        (d & 1) != 0 ? oracle.at(x, y, zz, 2 * axis + 1)
                                     : oracle.at(nx, ny, nz, 2 * axis + 1);
                    if (cl < kBodyClearanceSub) continue;
                    const bool sup = oracle.supported(nx, ny, nz,
                                                    kBodyClearanceSub,
                                                    w.gravity().regime);
                    refCost.push_back({ni, sup ? level : level + 1});
                    if (sup) cur.push_back(ni); else nxt.push_back(ni);
                }
            }
            if (nxt.empty()) break;
            cur.swap(nxt);
            nxt.clear();
            ++level;
        }
        // Спуск по продакшн-полю и счёт лазаний на нём.
        for (const auto& e : refCost) {
            if (judged >= 24) break;
            std::size_t cur2 = e.first;
            if (fg.at(0, e.first) == kZoneFlowNone) continue;
            int clings = 0;
            const int cx0 = static_cast<int>(cur2 % kMacroDim);
            const int cy0 = static_cast<int>((cur2 / kMacroDim) % kMacroDim);
            const int cz0 = static_cast<int>(cur2 / (kMacroDim * kMacroDim));
            if (!oracle.supported(cx0, cy0, cz0, kBodyClearanceSub,
                                w.gravity().regime))
                ++clings;
            int guard = 0;
            while (guard++ < static_cast<int>(kMacroCells)) {
                const std::uint8_t d = fg.at(0, cur2);
                if (d == kZoneFlowNone) break;
                const int cx = static_cast<int>(cur2 % kMacroDim);
                const int cy = static_cast<int>((cur2 / kMacroDim) % kMacroDim);
                const int cz = static_cast<int>(cur2 / (kMacroDim * kMacroDim));
                const std::size_t nn =
                    macro_index(wrap_macro(cx + nav::kNavDir[d][0]),
                                wrap_macro(cy + nav::kNavDir[d][1]),
                                wrap_macro(cz + nav::kNavDir[d][2]));
                if (part.at[nn] != mine) break; // перешли границу — путь кончился
                cur2 = nn;
                const int nx = static_cast<int>(cur2 % kMacroDim);
                const int ny = static_cast<int>((cur2 / kMacroDim) % kMacroDim);
                const int nz = static_cast<int>(cur2 / (kMacroDim * kMacroDim));
                if (!oracle.supported(nx, ny, nz, kBodyClearanceSub,
                                    w.gravity().regime))
                    ++clings;
            }
            if (clings > e.second) ++worse; // поле лезет больше, чем надо
            ++judged;
        }
    }
    CHECK(judged > 0);
    CHECK(worse == 0);
}

// Вырожденные входы — ответ, а не падение.
void degenerate_inputs_answer(const World& w, const ClearanceField& oracle) {
    FloorRooms empty;
    ZonePartition part;
    bake_zone_partition(empty, oracle, kBodyClearanceSub, w.gravity().regime, part);
    CHECK(!part.built()); // зон нет — разбивки нет
    ZoneGraph g;
    bake_zone_graph(part, oracle, kBodyClearanceSub, g);
    ZoneFlow flow;
    bake_zone_flow(part, g, oracle, kBodyClearanceSub, w.gravity().regime, flow);
    CHECK(!flow.built()); // нет графа — нет полей
    CHECK(!g.built()); // зон нет — графа нет
    ZoneDist dist;
    bake_zone_dist(g, dist);
    CHECK(!dist.built());
    CHECK(zone_next(g, dist, 1, 2) == kNoRoom); // и дверь не падает
}

// Синтетический граф с циклами, хордами и двумя компонентами связности:
// проверяет отсутствие склейки компонент, баланс секторов и гарантированный
// ациклический спуск `zone_next` даже через разрезанные границами циклы.
void synthetic_cycles_and_components() {
    constexpr std::uint32_t kRing = 64u;
    constexpr std::uint32_t kZ = kRing + 2u; // + изолированная пара [64, 65]
    std::vector<std::vector<RoomId>> adj(kZ);
    auto add_edge = [&](std::uint32_t u, std::uint32_t v) {
        adj[u].push_back(static_cast<RoomId>(v + 1u));
        adj[v].push_back(static_cast<RoomId>(u + 1u));
    };
    for (std::uint32_t i = 0; i < kRing; ++i) {
        add_edge(i, (i + 1u) % kRing);
        add_edge(i, (i + 7u) % kRing);
    }
    add_edge(kRing, kRing + 1u);

    ZoneGraph g;
    g.zones = kZ;
    g.offset.assign(kZ + 1u, 0u);
    for (std::uint32_t z = 0; z < kZ; ++z) {
        std::sort(adj[z].begin(), adj[z].end());
        adj[z].erase(std::unique(adj[z].begin(), adj[z].end()), adj[z].end());
        g.offset[z + 1u] = g.offset[z] + static_cast<std::uint32_t>(adj[z].size());
    }
    g.nbr.reserve(g.offset[kZ]);
    for (std::uint32_t z = 0; z < kZ; ++z)
        g.nbr.insert(g.nbr.end(), adj[z].begin(), adj[z].end());

    ZoneDist dist;
    bake_zone_dist(g, dist, /*threads=*/2);
    CHECK(dist.built());
    // Изолированная пара — один собственный сектор, не склеенный с кольцом.
    CHECK(dist.sectorOf[kRing] == dist.sectorOf[kRing + 1u]);
    CHECK(dist.sectorOf[kRing] != dist.sectorOf[0]);
    CHECK(dist.at(0u, kRing) == kZoneUnreachable);
    CHECK(zone_next(g, dist, static_cast<RoomId>(1u),
                    static_cast<RoomId>(kRing + 1u)) == kNoRoom);

    // Все пары на кольце с хордами обязаны дойти без циклов (проверяем в т.ч.
    // пары, где кратчайший путь разрезан границами секторов).
    int failed = 0;
    for (std::uint32_t a = 0; a < kRing; a += 3u) {
        for (std::uint32_t b = 0; b < kRing; b += 5u) {
            if (a == b) continue;
            RoomId cur = static_cast<RoomId>(a + 1u);
            const RoomId dst = static_cast<RoomId>(b + 1u);
            int steps = 0;
            while (cur != dst && steps <= static_cast<int>(kRing)) {
                const RoomId nxt = zone_next(g, dist, cur, dst);
                if (nxt == kNoRoom || zone_nbr_slot(g, cur, nxt) < 0) {
                    ++failed;
                    break;
                }
                cur = nxt;
                ++steps;
            }
            if (cur != dst) ++failed;
        }
    }
    CHECK(failed == 0);
}

} // namespace zonenav_test

void test_zonenav_all() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    // Зоны объявляются ОТДЕЛЬНО от геометрии и тем же сидом: декларация —
    // чистая функция (kind, number, seed) и в снимок не едет (S18, шапка
    // `rooms_declare`). Поэтому сид здесь обязан совпадать с сидом геометрии,
    // иначе граф лёг бы на чужой этаж — и гейт мерил бы шум.
    FloorRooms fr;
    rooms_declare(fr, 0, floor_spec(FloorKind::Residential), 1337u);
    // ОРАКУЛ — вход всех четырёх бейков (§88/F): воркеру достаётся он копией по
    // значению (4 МиБ), а не мир (134), и дренаж карва держит его свежим.
    ClearanceField oracle;
    oracle.build(w.grid());
    // ТЕХНИЧЕСКИЙ ШАГ, без которого графа зон не существует: объявленные зоны —
    // интерьеры, между ними ничейные линии плана, и смежности НЕТ. Гейт меряет
    // это ЧИСЛОМ РЁБЕР до и после — то есть проверяет не «шаг отработал», а
    // «шаг сделал то, ради чего он есть».
    //
    // «До» — разбивка, равная ОБЪЯВЛЕНИЮ как есть, без раздутия.
    ZonePartition raw;
    raw.zones = static_cast<std::uint32_t>(fr.size());
    raw.at = fr.roomAt;
    ZoneGraph gBefore;
    bake_zone_graph(raw, oracle, kBodyClearanceSub, gBefore);
    const std::size_t edgesBefore = gBefore.nbr.size() / 2u;

    const std::vector<RoomId> declaredPaint = fr.roomAt;
    ZonePartition part;
    bake_zone_partition(fr, oracle, kBodyClearanceSub, w.gravity().regime, part);
    CHECK(part.built());

    // 1. `roomAt` НЕ ТРОНУТА. Это и есть то, ради чего разбивка живёт своим
    // массивом: объявление — чистая функция (kind, number, seed) по S18, а
    // разбивка перепекается на карв. Если это утверждение падает, значит
    // фоновый бейк начал писать в игровой шов.
    CHECK(fr.roomAt == declaredPaint);

    // 2. Ни одна объявленная клетка не сменила ХОЗЯИНА: раздутие только
    // добавляет, первый объявивший остаётся владельцем (S12.1). Выпасть из
    // разбивки объявленная клетка может — но ТОЛЬКО за отсутствие касания
    // (середина воздуха высокой комнаты: в ней нельзя быть). Это утверждение
    // нашёл гейт: первая редакция пускала такие клетки в разбивку, то есть
    // возвращала дефект §88 с другого конца.
    std::size_t stolen = 0, claimed = 0, droppedNoTouch = 0, droppedWrong = 0;
    for (std::size_t i = 0; i < kMacroCells; ++i) {
        if (declaredPaint[i] == kNoRoom) {
            if (part.at[i] != kNoRoom) ++claimed;
            continue;
        }
        if (part.at[i] == declaredPaint[i]) continue;
        if (part.at[i] != kNoRoom) { ++stolen; continue; }
        const int x = static_cast<int>(i % kMacroDim);
        const int y = static_cast<int>((i / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(i / (kMacroDim * kMacroDim));
        if (oracle.touching(x, y, z, kBodyClearanceSub)) ++droppedWrong;
        else ++droppedNoTouch;
    }
    CHECK(stolen == 0);
    CHECK(droppedWrong == 0);    // выпало только то, за что не держатся
    CHECK(droppedNoTouch > 0);   // и такие клетки на этаже В САМОМ ДЕЛЕ есть
    CHECK(claimed > 0);           // раздутие в самом деле состоялось
    CHECK(fr.overlapCells == 0);

    // 3. ТОЛЩА ОСТАЛАСЬ НИЧЕЙНОЙ — прямое следствие «раздуваем по проходимому»:
    // у клетки внутри кладки нет ни одной грани, которую тело пролезает, и
    // волна её не достигает. Если это падает, значит зона просочилась сквозь
    // стену, и карта путей соврёт первым же ребром.
    std::size_t solidClaimed = 0;
    for (std::size_t i = 0; i < kMacroCells; ++i) {
        if (declaredPaint[i] != kNoRoom || part.at[i] == kNoRoom) continue;
        const int x = static_cast<int>(i % kMacroDim);
        const int y = static_cast<int>((i / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(i / (kMacroDim * kMacroDim));
        bool anyOpen = false;
        for (int axis = 0; axis < 3 && !anyOpen; ++axis) {
            if (oracle.at(x, y, z, 2 * axis + 1) >= kBodyClearanceSub)
                anyOpen = true;
            if (face_clearance_at(w.grid(), x - (axis == 0), y - (axis == 1),
                                  z - (axis == 2), axis) >= kBodyClearanceSub)
                anyOpen = true;
        }
        if (!anyOpen) ++solidClaimed;
    }
    CHECK(solidClaimed == 0);

    // 4. ГЛАВНОЕ УТВЕРЖДЕНИЕ ШАГА, И ПОРОГ У НЕГО ВЫВЕДЕН, А НЕ ВЫБРАН.
    //
    // Первая редакция требовала «рёбер больше в 100 раз» — число, взятое
    // глазом, и замер его тут же опроверг: 400 -> 17534, то есть 43.8×. Порог,
    // выбранный на вкус, краснеет на верном коде — это не гейт, а лотерея.
    //
    // Выведенный порог: граф, который ОБЯЗАН быть связным (ровно то, что
    // владелец называет «связность всего мира»), не может иметь меньше Z−1
    // рёбер — это необходимое условие связности, а не оценка.
    ZoneGraph gAfter;
    bake_zone_graph(part, oracle, kBodyClearanceSub, gAfter);
    const std::size_t edgesAfter = gAfter.nbr.size() / 2u;
    std::fprintf(stderr, "[zone-nav] рёбер до раздутия %zu, после %zu\n",
                 edgesBefore, edgesAfter);
    CHECK(edgesBefore < gAfter.zones - 1u); // до раздутия связным быть НЕ МОГ
    CHECK(edgesAfter >= gAfter.zones - 1u); // после — может, и обязан

    zonenav_test::graph_equals_independent_recount(w, part, oracle);
    zonenav_test::table_is_a_metric(w, part, oracle);
    zonenav_test::near_pick_walks_the_graph(part, oracle);
    zonenav_test::flow_is_clipped_and_leads_out(w, part, gAfter, oracle);
    zonenav_test::weight_prefers_support_and_gravity_is_only_price(w, part, gAfter, oracle);
    zonenav_test::degenerate_inputs_answer(w, oracle);
    zonenav_test::synthetic_cycles_and_components();
}
