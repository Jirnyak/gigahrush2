// PADIC module registration — the module's rows in the floor catalog.
//
// One claim today: floor number 4 ([padic.h] — the explicit-beats-pattern
// proof). As the module grows, its special loot tables, carvers, story NPCs,
// quests, events and interactive objects register from THIS file, so deleting
// the folder deletes the floor cleanly and nothing else has to know.
#include "game/floors/padic/padic.h"
#include "game/floor_catalog.h"
#include "game/prop_system.h"
#include "game/room.h" // FloorRooms/Room — объявленные глаголы BSP-листьев
#include "ecs/components.h"
#include "core/wrap.h"
#include "world/anchor.h"
#include "world/lattice.h" // kLatticeDim/kLatticeSpacing/kLatticeHalf — НАСТОЯЩИЕ
#include "world/surface.h"
#include "world/types.h"
#include "world/world.h"

#include <cstddef>
#include <cstdio>

namespace giga::game {

bool register_padic_floor(FloorCatalog& cat) {
    return cat.claim(kPadicFloorNumber, {"padic", FloorKind::Padic});
}

namespace {

// ---- МЕБЕЛЬ ПАДИКА — СТРОКИ МОДУЛЯ ---------------------------------------
// Тот же список, что у хрущей, и он ПОВТОРЁН НАМЕРЕННО, а не вынесен: папка
// есть модуль ([padic.h] — «modularity beats DRY on purpose»), и смысл этого
// закона ровно в том, чтобы падик мог обеднеть или обрасти своей мебелью, не
// задев хрущи. Общего здесь — предикат `prop_fits_room` (механика сверки
// глаголов), а не содержимое списка.
//
// Что выходит на объявлениях `padic_rooms` (считано, не предположено):
//   жилая   (sleep 30)  — койка (sleep 17)
//   санузел (toilet 20) — унитаз (toilet 19)
//   ниша    (eat 12)    — плита (eat 12) И стол (eat 4): у падика лист BSP
//                         никогда не уже minSpan, а зона яруса — три клетки,
//                         то есть мест заведомо больше одного (у хрущей та же
//                         пара не влезает — там кухня одноклеточная)
//   полоса  (store 15)  — ничего из этого списка
//
// ЯЩИК (store 20) здесь НЕ УЧАСТВУЕТ, и причина не в пороге: до
// `prop_fits_room` он не доходит, его просто нет в списке. Тару сеет
// `spawn_floor_containers`, и она глаголослепа (комната — равномерный хеш по
// всему списку, `declared` не спрашивается) — это её долг, не этого прохода.
constexpr PropId kPadicFurniture[] = {
    PropId::BedCot,
    PropId::ToiletPan,
    PropId::KitchenStove,
    PropId::KitchenTable,
};
static_assert(std::size(kPadicFurniture) <= kMaxStandSpots,
              "строк мебели больше, чем мест отдаёт room_stand_spots за один "
              "обход комнаты: либо режь список, либо поднимай kMaxStandSpots");

} // namespace

std::uint32_t padic_place(const FloorPlaceCtx& ctx) {
    std::uint32_t count = 0;
    Registry& reg = ctx.reg;
    const World& world = ctx.world;
    const LayerId layer = ctx.layer;

    const MacroGrid& grid = world.grid();

    // Match padic_gen.cpp PlanStair lattice exactly:
    //   hasStair when ((bi+bj)&1)==0
    //   sx = bx+13, sy = by+1  (flight A); flight B is sy+1
    //   storey bases b = 0,3,...,123; sandwich ceiling lives in cell b+2
    //   (kCeilW = sz=6 inside that cell). Shaft has no full sandwich, but
    //   stamp_stair puts an entry-strip slab at (sx, sy / sy+1, b+2).
    // Corridor mouth is (sx, by=sy-1) with opening — use a normal ceiling
    // neighbor when solid, else hang from the entry strip solid bits.
    //
    // ТЕНЕВЫЕ КОПИИ КОНСТАНТ РЕШЁТКИ СНЕСЕНЫ (2026-11-08). Здесь стояли
    // `kCorr0 = 16 /* kLatticeHalf */`, `kLatticeSpacing = 32` и
    // `kLatticeDim = 4` — три локальных числа вместо инклюда
    // [world/lattice.h], и именно на этот случай указывает предупреждение в
    // [game/fast_travel.h] («a second copy is how padic_module.cpp ended up
    // shadowing kLatticeDim with its own local 4»). Копия тем и опасна, что
    // сходится с настоящей решёткой ровно сегодня: правка kLatticeDim
    // развела бы сеялку лампочек с геометрией лестниц молча, без единой
    // красной строки. Теперь обе читают одни константы — `kCorr0` живёт в
    // padic_gen.cpp как `kLatticeHalf`, и колонка ниже считается тем же
    // `kLatticeHalf + bi * kLatticeSpacing`.
    constexpr int kStorey = 3;
    constexpr int kLastBase = 123;

    // ПОДВЕС — ОБЩИЙ ГЛАГОЛ `place_prop_hanging` ([game/prop_system.h]):
    // запрос поверхности, запись якоря, плоскость грани в метрах и центр
    // клетки по касательным живут там, одной копией на дерево. Здесь осталось
    // ОДНО решение, которое и есть падиковское: ОПОРУ ВЫБИРАЕТ МОДУЛЬ —
    // сэндвич потолка, а если его грань не экспонирована (шахта без полного
    // сэндвича), то ЛЕПКА ВНУТРИ СВОЕЙ ЖЕ воздушной клетки (входная полоса
    // stamp_stair). Ручной lowest_layer_centre, добор точного бита и
    // специальный тест скульпт-бита (2,4,6) умерли ещё раньше — примитив
    // поверхностей находит экспонированную колонку в обоих случаях.
    const std::uint8_t downFace = anchor_face_pack(2, -1); // нижняя грань опоры
    auto try_spawn_bulb = [&](int cx, int cy, int airZ) -> bool {
        const int ceilZ = airZ + 1;
        const int supZ =
            surface_face_at(grid, cx, cy, ceilZ, downFace).columns > 0 ? ceilZ
                                                                      : airZ;
        // Corded bulb: 0.45 m of flex below the face it hangs from — грань
        // считается от НАЙДЕННОГО слоя найденной клетки, лампы полного
        // потолка (layer 0 в ceilZ) не сдвинулись ни на мм.
        return place_prop_hanging(reg, world, layer, cx, cy, supZ, downFace,
                                  PropId::PadicStairBulb,
                                  /*dropM=*/0.45f) != entt::null;
    };

    for (int b = 0; b <= kLastBase; b += kStorey) {
        for (int bj = 0; bj < kLatticeDim; ++bj) {
            for (int bi = 0; bi < kLatticeDim; ++bi) {
                if (((bi + bj) & 1) != 0) continue;
                const int bx = kLatticeHalf + bi * kLatticeSpacing + 2;
                const int by = kLatticeHalf + bj * kLatticeSpacing + 2;
                const int sx = bx + 13;
                const int sy = by + 1; // PlanStair.y — flight A row

                const int airZ = b + 1;
                if (try_spawn_bulb(sx, by, airZ)) ++count;       // corridor mouth
                if (try_spawn_bulb(sx, sy, airZ)) ++count;       // flight A
                if (try_spawn_bulb(sx, sy + 1, airZ)) ++count;   // flight B
            }
        }
    }

    // ---- МЕБЕЛЬ BSP-ЛИСТЬЕВ ----------------------------------------------
    // `padic_rooms` этого же прибытия объявил каждый лист плана на каждом из
    // 42 ярусов и сказал, чем лист ЖИВЁТ (`declared`): жилая — спать 30,
    // санузел — сортир 20, ниша — есть 12, полоса — хранить 15. Мебель едет по
    // ГЛАГОЛУ (`prop_fits_room`), поэтому ни одного «если это жилая комната»
    // здесь нет, и правка планировки мебель не ломает.
    //
    // ПЯТЬ ВИДОВ ЭТАЖА НА ОДНОЙ РАССТАНОВКЕ, и это намеренно: Residential,
    // Commercial, Industrial, Derelict и Padic дispatch'атся в эту геометрию,
    // значит и в эту расстановку. Заброшенный ярус с койкой и унитазом — это и
    // есть руина жилого фонда; ПУСТАЯ руина читалась бы декорацией.
    const std::uint32_t salt = ctx.seed ^ 0x70616469u; // 'padi'
    StandSpot spots[kMaxStandSpots];
    std::uint32_t furnished = 0;
    // ЧТО НЕ ВСТАЛО — ВСЛУХ (S11: молчаливого обрезания нет). Два разных
    // отказа, и путать их нельзя: «в зоне негде стоять» — свойство ГЕОМЕТРИИ
    // модуля (нет опоры, нет стены), «глагол отказал» — свойство строки.
    std::uint32_t noSpot = 0, wanted = 0;
    for (std::size_t i = 0; i < ctx.rooms.list.size(); ++i) {
        const Room& r = ctx.rooms.list[i];
        const RoomId id = static_cast<RoomId>(i + 1); // RoomId = индекс + 1
        int want = 0;
        for (PropId p : kPadicFurniture)
            if (prop_fits_room(p, r)) ++want;
        if (want == 0) continue;
        wanted += static_cast<std::uint32_t>(want);
        const int n = room_stand_spots(world, ctx.rooms, id, salt, spots, want);
        if (n == 0) ++noSpot;
        int si = 0;
        for (PropId p : kPadicFurniture) {
            if (si >= n) break; // мест меньше, чем вещей — честно, не падение
            if (!prop_fits_room(p, r)) continue;
            const StandSpot& s = spots[si];
            if (place_prop_standing(reg, world, layer, s.cx, s.cy, s.cz,
                                    s.floorFace, s.backFace, p) != entt::null) {
                ++count;
                ++furnished;
            }
            ++si;
        }
    }
    std::printf("[padic] мебель: %u вещей из %u заказанных, зон %zu, из них "
                "без места %u\n",
                furnished, wanted, ctx.rooms.list.size(), noSpot);
    return count;
}

} // namespace giga::game
