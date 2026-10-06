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
//   4. ТАБЛИЦА: ноль на диагонали, симметрия, неравенство треугольника.
//      Треугольник — то утверждение, которое ловит порчу обхода: при любой
//      ошибке в порядке посещения он ломается первым.
//   5. zone_next ВЕДЁТ, А НЕ КРУЖИТ: шаг из A к B обязан уменьшать расстояние
//      РОВНО на 1, и спуск от A до B обязан прийти за dist(A,B) шагов.
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
                                     const MacroGrid& grid, int size,
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
                        face_clearance_at(grid, x, y, z, axis) < size)
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

void graph_equals_independent_recount(const World& w, const ZonePartition& part) {
    ZoneGraph g;
    bake_zone_graph(part, w.grid(), kBodyClearanceSub, g);
    CHECK(g.built());
    CHECK(g.zones == part.zones);

    const std::vector<std::uint32_t> ref =
        ref_pairs(part, w.grid(), kBodyClearanceSub, /*requireClearance=*/true);
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
        ref_pairs(part, w.grid(), kBodyClearanceSub, /*requireClearance=*/false);
    CHECK(refTouch.size() > ref.size());
}

void table_is_a_metric(const World& w, const ZonePartition& part) {
    ZoneGraph g;
    bake_zone_graph(part, w.grid(), kBodyClearanceSub, g);
    ZoneDist dist;
    bake_zone_dist(g, dist, /*threads=*/2);
    CHECK(dist.built());
    CHECK(dist.zones == g.zones);

    // Выборка источников: Z² полной проверкой это 217 млн пар на каждое
    // утверждение. Шаг 97 взаимно прост с любым Z, не кратным 97, поэтому
    // выборка обходит остатки, а не полосу.
    int checkedDiag = 0, asym = 0, triBad = 0, reach = 0;
    for (std::uint32_t a = 0; a < g.zones; a += 97) {
        CHECK(dist.at(a, a) == 0); // 4. ноль на диагонали
        ++checkedDiag;
        for (std::uint32_t b = 0; b < g.zones; b += 89) {
            const std::uint16_t ab = dist.at(a, b);
            if (dist.at(b, a) != ab) ++asym; // симметрия
            if (ab != kZoneUnreachable) ++reach;
            // Неравенство треугольника через соседок a: dist(a,b) <=
            // 1 + dist(nbr, b), и равенство обязано достигаться хотя бы на одной
            // соседке (иначе обход пропустил кратчайший путь).
            if (ab != kZoneUnreachable && ab > 0) {
                std::uint16_t best = kZoneUnreachable;
                for (const RoomId* it = g.begin(a); it != g.end(a); ++it) {
                    const std::uint16_t dn =
                        dist.at(static_cast<std::uint32_t>(*it) - 1u, b);
                    if (dn < best) best = dn;
                }
                if (best == kZoneUnreachable || best + 1 != ab) ++triBad;
            }
        }
    }
    CHECK(checkedDiag > 0);
    CHECK(asym == 0);
    CHECK(triBad == 0);
    CHECK(reach > 0); // таблица не вся недостижима — иначе всё выше тождественно

    // 5. zone_next ВЕДЁТ. Спуск от источника к цели обязан прийти ровно за
    // dist шагов, каждый раз уменьшая расстояние на 1.
    int walked = 0;
    for (std::uint32_t a = 0; a < g.zones && walked < 32; a += 311) {
        for (std::uint32_t b = 1; b < g.zones && walked < 32; b += 433) {
            const std::uint16_t want = dist.at(a, b);
            if (want == kZoneUnreachable || want == 0) continue;
            RoomId cur = static_cast<RoomId>(a + 1);
            const RoomId dst = static_cast<RoomId>(b + 1);
            int steps = 0;
            while (cur != dst && steps <= want + 1) {
                const RoomId nxt = zone_next(g, dist, cur, dst);
                if (nxt == kNoRoom) break;
                const std::uint16_t before =
                    dist.at(static_cast<std::uint32_t>(cur) - 1u, b);
                const std::uint16_t after =
                    dist.at(static_cast<std::uint32_t>(nxt) - 1u, b);
                CHECK(after + 1 == before); // ровно на один ближе
                cur = nxt;
                ++steps;
            }
            CHECK(cur == dst);     // дошёл
            CHECK(steps == want);  // и ровно за столько, сколько обещала таблица
            ++walked;
        }
    }
    CHECK(walked > 0); // спуск в самом деле прогнан, а не пропущен весь

    // ОЗУ вслух: это та цена, которую владелец принял числом.
    std::fprintf(stderr, "[zone-nav] зон %u | рёбер %zu | таблица %.1f МиБ\n",
                 g.zones, g.nbr.size() / 2u,
                 static_cast<double>(dist.bytes()) / (1024.0 * 1024.0));
}

// ПОЛЯ ВНУТРИ ЗОНЫ (инкремент C). Четыре утверждения, и каждое о своём законе.
void flow_is_clipped_and_leads_out(const World& w, const ZonePartition& part,
                                   const ZoneGraph& g) {
    ZoneFlow flow;
    bake_zone_flow(part, g, w.grid(), kBodyClearanceSub, w.gravity().regime, flow);
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
                        (d & 1) != 0 ? face_clearance_at(w.grid(), cx, cy, cz, axis)
                                     : face_clearance_at(w.grid(), nx, ny, nz, axis);
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
                                                      const ZoneGraph& g) {
    // A. КАСАНИЕ — ЗАКОННОСТЬ: в разбивке нет ни одной клетки, за которую не
    // держатся. Это и есть запрет полёта, выраженный отсутствием, а не правилом.
    std::size_t airborne = 0, inPart = 0;
    for (std::size_t c = 0; c < kMacroCells; c += 11) {
        if (part.at[c] == kNoRoom) continue;
        ++inPart;
        const int x = static_cast<int>(c % kMacroDim);
        const int y = static_cast<int>((c / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(c / (kMacroDim * kMacroDim));
        if (!cell_touching(w.grid(), x, y, z, kBodyClearanceSub)) ++airborne;
    }
    CHECK(inPart > 0);
    CHECK(airborne == 0);

    ZoneFlow fg;
    bake_zone_flow(part, g, w.grid(), kBodyClearanceSub, w.gravity().regime, fg);
    ZoneFlow f0;
    bake_zone_flow(part, g, w.grid(), kBodyClearanceSub, GravityRegime::Zero, f0);

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
                    (d & 1) != 0 ? face_clearance_at(w.grid(), x, y, zz, axis)
                                 : face_clearance_at(w.grid(), nx, ny, nz, axis);
                if (cl < kBodyClearanceSub) continue;
                const int lvl = cell_supported(w.grid(), x, y, zz,
                                               kBodyClearanceSub,
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
                        (d & 1) != 0 ? face_clearance_at(w.grid(), x, y, zz, axis)
                                     : face_clearance_at(w.grid(), nx, ny, nz, axis);
                    if (cl < kBodyClearanceSub) continue;
                    const bool sup = cell_supported(w.grid(), nx, ny, nz,
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
            if (!cell_supported(w.grid(), cx0, cy0, cz0, kBodyClearanceSub,
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
                if (!cell_supported(w.grid(), nx, ny, nz, kBodyClearanceSub,
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
void degenerate_inputs_answer(const World& w) {
    FloorRooms empty;
    ZonePartition part;
    bake_zone_partition(empty, w.grid(), kBodyClearanceSub, w.gravity().regime, part);
    CHECK(!part.built()); // зон нет — разбивки нет
    ZoneGraph g;
    bake_zone_graph(part, w.grid(), kBodyClearanceSub, g);
    ZoneFlow flow;
    bake_zone_flow(part, g, w.grid(), kBodyClearanceSub, w.gravity().regime, flow);
    CHECK(!flow.built()); // нет графа — нет полей
    CHECK(!g.built()); // зон нет — графа нет
    ZoneDist dist;
    bake_zone_dist(g, dist);
    CHECK(!dist.built());
    CHECK(zone_next(g, dist, 1, 2) == kNoRoom); // и дверь не падает
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
    // ТЕХНИЧЕСКИЙ ШАГ, без которого графа зон не существует: объявленные зоны —
    // интерьеры, между ними ничейные линии плана, и смежности НЕТ. Гейт меряет
    // это ЧИСЛОМ РЁБЕР до и после — то есть проверяет не «шаг отработал», а
    // «шаг сделал то, ради чего он есть».
    //
    // «До» — разбивка, равная ОБЪЯВЛЕНИЮ как есть, без раздутия.
    ZonePartition raw;
    raw.zones = static_cast<std::uint32_t>(fr.list.size());
    raw.at = fr.roomAt;
    ZoneGraph gBefore;
    bake_zone_graph(raw, w.grid(), kBodyClearanceSub, gBefore);
    const std::size_t edgesBefore = gBefore.nbr.size() / 2u;

    const std::vector<RoomId> declaredPaint = fr.roomAt;
    ZonePartition part;
    bake_zone_partition(fr, w.grid(), kBodyClearanceSub, w.gravity().regime, part);
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
        if (cell_touching(w.grid(), x, y, z, kBodyClearanceSub)) ++droppedWrong;
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
            if (face_clearance_at(w.grid(), x, y, z, axis) >= kBodyClearanceSub)
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
    bake_zone_graph(part, w.grid(), kBodyClearanceSub, gAfter);
    const std::size_t edgesAfter = gAfter.nbr.size() / 2u;
    std::fprintf(stderr, "[zone-nav] рёбер до раздутия %zu, после %zu\n",
                 edgesBefore, edgesAfter);
    CHECK(edgesBefore < gAfter.zones - 1u); // до раздутия связным быть НЕ МОГ
    CHECK(edgesAfter >= gAfter.zones - 1u); // после — может, и обязан

    zonenav_test::graph_equals_independent_recount(w, part);
    zonenav_test::table_is_a_metric(w, part);
    zonenav_test::flow_is_clipped_and_leads_out(w, part, gAfter);
    zonenav_test::weight_prefers_support_and_gravity_is_only_price(w, part, gAfter);
    zonenav_test::degenerate_inputs_answer(w);
}
