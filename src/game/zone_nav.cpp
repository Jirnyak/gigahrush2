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

void bake_zone_graph(const FloorRooms& fr, const MacroGrid& grid, int size,
                     ZoneGraph& out) {
    out = ZoneGraph{};
    const std::size_t zones = fr.list.size();
    if (zones == 0 || fr.roomAt.empty()) return;
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
    const RoomId* zoneOf = fr.roomAt.data();
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

} // namespace giga::game
