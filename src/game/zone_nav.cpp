#include "game/zone_nav.h"

#include <algorithm>

#include "core/jobs.h"        // parallel_for — бейк жмёт ядра
#include "world/clearance.h"  // face_clearance_at — ЕДИНСТВЕННЫЙ закон проходимости
#include "world/macro_grid.h"
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

} // namespace

RoomId ZonePartition::cell(int x, int y, int z) const {
    return at[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
}

void bake_zone_partition(const FloorRooms& fr, const MacroGrid& grid, int size,
                         GravityRegime gravity, ZonePartition& out) {
    (void)gravity; // раздутие о гравитации не знает: касание её не спрашивает
    out = ZonePartition{};
    if (fr.roomAt.empty() || fr.list.empty()) return;
    out.zones = static_cast<std::uint32_t>(fr.list.size());
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
        if (!cell_touching(grid, x, y, z, size)) continue;
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
            const int axis = d >> 1;
            const std::uint8_t c = (d & 1) != 0
                                       ? face_clearance_at(grid, cx, cy, cz, axis)
                                       : face_clearance_at(grid, nx, ny, nz, axis);
            if (c < size) continue;
            // КАСАНИЕ: клетка без опоры И без стенки рядом не достаётся никому —
            // в ней не может быть ни человека, ни паука (§88). Разбивка есть
            // разбивка ПРОХОДИМОГО, а не объёма.
            if (!cell_touching(grid, nx, ny, nz, size)) continue;
            at[ni] = owner;
            q.push_back(static_cast<std::uint32_t>(ni));
        }
    }
}

void bake_zone_graph(const ZonePartition& part, const MacroGrid& grid, int size,
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
                    if (face_clearance_at(grid, x, y, z, axis) < size) continue;
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
    if (!g.built()) return;
    const std::uint32_t Z = g.zones;
    out.zones = Z;
    out.d.assign(static_cast<std::size_t>(Z) * Z, kZoneUnreachable);
    std::uint16_t* base = out.d.data();

    // Обход в ширину из каждой зоны. Рёбра единичные, значит FIFO посещает
    // узлы в порядке неубывания расстояния, и первое присвоение окончательно —
    // перепроверять, как делал бы Дейкстра, не нужно.
    parallel_for(static_cast<int>(Z), [&g, base, Z, cancel](int src) {
        if (cancel != nullptr && cancel->load(std::memory_order_relaxed)) return;
        std::uint16_t* row = base + static_cast<std::size_t>(src) * Z;
        std::vector<std::uint32_t> q;
        q.reserve(Z);
        row[src] = 0;
        q.push_back(static_cast<std::uint32_t>(src));
        for (std::size_t head = 0; head < q.size(); ++head) {
            const std::uint32_t u = q[head];
            const std::uint16_t du = row[u];
            // Потолок — чтобы недостижимость осталась ЕДИНСТВЕННЫМ значением
            // 0xFFFF: путь длиной 65534 рёбер на 15 тысячах узлов невозможен,
            // но закон «сентинел не достигается арифметикой» держим явно.
            if (du + 1 >= kZoneUnreachable) continue;
            for (const RoomId* it = g.begin(u); it != g.end(u); ++it) {
                const std::uint32_t v = static_cast<std::uint32_t>(*it) - 1u;
                if (row[v] != kZoneUnreachable) continue;
                row[v] = static_cast<std::uint16_t>(du + 1);
                q.push_back(v);
            }
        }
    }, threads);
}

RoomId zone_next(const ZoneGraph& g, const ZoneDist& dist, RoomId from,
                 RoomId to) {
    if (!g.built() || !dist.built()) return kNoRoom;
    if (from == kNoRoom || to == kNoRoom || from == to) return kNoRoom;
    const std::uint32_t f = static_cast<std::uint32_t>(from) - 1u;
    const std::uint32_t t = static_cast<std::uint32_t>(to) - 1u;
    if (f >= g.zones || t >= g.zones) return kNoRoom;
    const std::uint16_t here = dist.at(f, t);
    if (here == kZoneUnreachable) return kNoRoom; // другая компонента
    RoomId best = kNoRoom;
    std::uint16_t bestD = here;
    for (const RoomId* it = g.begin(f); it != g.end(f); ++it) {
        const std::uint16_t d = dist.at(static_cast<std::uint32_t>(*it) - 1u, t);
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
                    const MacroGrid& grid, int size, GravityRegime gravity,
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
                    const std::uint8_t cl =
                        (d & 1) != 0 ? face_clearance_at(grid, cx, cy, cz, axis)
                                     : face_clearance_at(grid, nx, ny, nz, axis);
                    if (cl < size) continue;
                    plane[c] = kZoneFlowArrived;
                    // Семя ложится в слой по СВОЕЙ цене: опёртое — в текущий,
                    // висящее — в следующий. Иначе лексикографический порядок
                    // сломался бы на первом же шаге.
                    if (cell_supported(grid, cx, cy, cz, size, gravity))
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
                        const int axis = d >> 1;
                        const std::uint8_t cl =
                            (d & 1) != 0 ? face_clearance_at(grid, cx, cy, cz, axis)
                                         : face_clearance_at(grid, nx, ny, nz, axis);
                        if (cl < size) continue;
                        // Шли c -> ni в направлении d, значит из ni обратно ведёт
                        // (d ^ 1) — тот же закон обратного шага, что у нава.
                        plane[ni] = static_cast<std::uint8_t>(d ^ 1);
                        // ЦЕНА РЕШАЕТ СЛОЙ: опёртая клетка дописывается в ТЕКУЩУЮ
                        // очередь (значит внутри слоя порядок по длине — FIFO), а
                        // висящая откладывается в следующий. Это и есть
                        // «лексикографически: сначала лазание, потом длина».
                        if (cell_supported(grid, nx, ny, nz, size, gravity))
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

} // namespace giga::game
