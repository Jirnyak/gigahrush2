// KHRUSHI module registration + ЕГО РАССТАНОВКА СОДЕРЖИМОГО: street lamps on
// the pole hooks, подъезд bulbs on every stairwell landing, a bulb over every
// entrance — и МЕБЕЛЬ КВАРТИР, по объявленным глаголам комнат.
//
// Всё здесь — КОНТЕНТ, то есть политика этого этажа: какие вещи, сколько, в
// каких комнатах, какой стороной. Механика живёт глаголами постановки
// ([game/prop_system.h] place_prop_hanging / place_prop_standing /
// room_stand_spots), и ни одна из них не знает слова «койка».
#include "game/floors/khrushi/khrushi.h"

#include "core/rng.h"   // hash_u32 — выбор строки моба и клетки на крыше
#include "core/wrap.h"
#include "game/floor_catalog.h"
#include "game/mob_spawn.h"  // spawn_mob_at — ЕДИНАЯ дверь рождения моба
#include "game/prop_system.h"
#include "game/room.h"     // FloorRooms/Room — объявленные глаголы комнат
#include "world/anchor.h"
#include "world/surface.h"
#include "world/types.h"
#include "world/world.h"

#include <cstddef>

namespace giga::game {

bool register_khrushi_floor(FloorCatalog& cat) {
    return cat.claim(kKhrushiFloorNumber, {"khrushi", FloorKind::Khrushi});
}

namespace {

// Storey rise in sub-voxels — re-derived, not copied: 2.5 m ceiling + 0.5 m
// slab at 0.25 m sub-voxels (same derivation as khrushi_gen.cpp kStoreyRise).
constexpr int kRise = 12;
constexpr int kFlats = 10;

// ---- МЕБЕЛЬ ХРУЩЁВКИ — СТРОКИ МОДУЛЯ -------------------------------------
// Список, а не словарь «комната → вещь»: вида комнаты не существует (S12.2),
// и место вещи решает ГЛАГОЛ — `prop_fits_room` сверяет колонку verbs строки
// props.csv с `Room::declared`, которое объявил `khrushi_rooms`. Что из этого
// выходит на сегодняшних данных (считано, не предположено):
//
//   спальня (sleep 30)            — койка (sleep 17)
//   зал     (sleep 10, social 12) — ДИВАН (sleep 10 — ровно по объявлению) и
//                                   стол (social 3); КОЙКИ НЕТ: зал глаголом
//                                   «спать» живёт ВПОЛСИЛЫ, и ровно это
//                                   вполсилы диван и даёт
//   кухня   (eat 12)              — ГОДЯТСЯ плита (eat 12) и стол (eat 4),
//                                   но ВСТАЁТ ОДНА ПЛИТА (см. ниже)
//   санузел (toilet 20)           — унитаз (toilet 19)
//   кладовка (store 15)           — ничего из этого списка
//
// ПОРЯДОК ЗНАЧИМ и он тоже контент: место с лучшим хешем достаётся первой
// подошедшей строке, поэтому в кухне плита забирает единственное место, а
// стол остаётся залу.
//
// КУХОННЫЙ СТОЛ НЕ ВСТАЁТ НИКОГДА, и это измерено, а не предположено: кухня
// объявлена прямоугольником 1×1 клетка (`kFlatRooms` в khrushi_gen.cpp), по
// вертикали это одна-две клетки, а стоять можно только в НИЖНЕЙ (у верхней
// под ногами воздух) — значит `room_stand_spots` отдаёт ровно одно место на
// кухню. Замер этажа 6: заказано 5700 вещей, встало 4560, недобор 1140 =
// ровно число квартир, то есть по одному столу на кухню. Строка оставлена в
// списке намеренно: она живая для ЗАЛА, а расширится кухня — стол приедет в
// неё сам, без правки кода.
//
// ЯЩИК (store 20) в списке НЕ УЧАСТВУЕТ, и причина не в пороге: до
// `prop_fits_room` он не доходит вовсе, потому что его здесь нет. Тару сеет
// `spawn_floor_containers`, и она сегодня ГЛАГОЛОСЛЕПА — комнату берёт
// равномерным хешем по всему списку (`fr->list[h % size]`, container.cpp),
// `declared` не спрашивает, так что ящик одинаково часто попадает в спальню и
// в кладовку. Это долг ТОЙ сеялки (ровно тот класс, что закрыт здесь для
// мебели), и чинить его надо там, а не дублированием ящика в этот список.
constexpr PropId kKhrushiFurniture[] = {
    PropId::BedCot,       // койка — спальня
    PropId::ToiletPan,    // унитаз — санузел
    PropId::KitchenStove, // плита — кухня
    PropId::Sofa,         // диван — зал (sleep 10 ровно по объявлению зала)
    PropId::KitchenTable, // стол — кухня и зал
};
static_assert(std::size(kKhrushiFurniture) <= kMaxStandSpots,
              "строк мебели больше, чем мест отдаёт room_stand_spots за один "
              "обход комнаты: либо режь список, либо поднимай kMaxStandSpots");

// ---- МОБЫ НА КРЫШАХ — СТРОКИ МОДУЛЯ --------------------------------------
// Условие расстановки — «по мобу на каждую крышу» — ЦЕЛИКОМ внутри модуля:
// общий код про крыши не знает ни строки, а единственная дверь рождения —
// `spawn_mob_at` ([mob_spawn.h]), та же, которой пользуются сеялка этажа и
// консоль. Другой модуль напишет «по комнатам с тегом гнезда», «по лестничным
// шахтам», «по любому своему условию» — и ему не понадобится ни одной правки
// в системах.
//
// СПИСОК — КОНТЕНТ, как и мебель: чердачная нечисть панельного микрорайона.
// Таблица мобов — чистая дата (68 строк), модуль берёт из неё что хочет.
constexpr MobKind kKhrushiRoofMobs[] = {
    MobKind::Krysnozhka, // крысоножка — чердачная
    MobKind::PomoynyRoy, // помойный рой
    MobKind::TonkayaTen, // тонкая тень
    MobKind::Rzhavnik,   // ржавник — по жести кровли
};

} // namespace

std::uint32_t khrushi_place(const FloorPlaceCtx& ctx) {
    std::uint32_t count = 0;
    const World& world = ctx.world;
    const MacroGrid& grid = world.grid();
    const LayerId layer = ctx.layer;
    Registry& reg = ctx.reg;

    // ---- ОБВЕС ГОРОДА ----------------------------------------------------
    // Street lamps: one under every pole hook. The hook is the pole's top
    // sub-layer, so its cell derives from kKhrushiPoleTopH — one source.
    //
    // ПОДВЕС — ОБЩИЙ ГЛАГОЛ: локальная `hang_from_ceiling` (запрос
    // поверхности + якорь руками + метры руками) умерла 2026-11-08, она была
    // третьей копией той же арифметики (две другие — в padic_module.cpp и
    // внутри seed_ceiling_lights).
    //
    // РАЗМЕН НАЗВАН ЧЕСТНО, И ОН НЕ ОДНОСТОРОННИЙ. Копия вешала лампу по
    // ПРЕДСТАВИТЕЛЬНОЙ КОЛОНКЕ грани (`cx*kCellSize + (su+0.5)*…`), общий
    // глагол — по ЦЕНТРУ КЛЕТКИ ОПОРЫ:
    //   * лампочкам подъездов это ЛЕЧЕНИЕ: площадка — широкая плита, и
    //     колонка на её краю вешала лампу в угол, к той стене, с которой
    //     делила колонку (ровно дефект, который общая сеялка плафонов лечила
    //     центром клетки и называла в своём комментарии);
    //   * ФОНАРЮ НА СТОЛБЕ — УТРАТА: крюк это ОДНА субвоксельная линия
    //     (`kKhrushiPoleTopH`, рукав шириной в субвоксель), и центр клетки
    //     уводит меш с рукава примерно на 12.5 см по касательной, оставляя
    //     ЯКОРЬ на рукаве. Тонкая опора — не плита, и «центр клетки» для неё
    //     неверен так же, как «колонка» неверна для плиты.
    // Правильный ответ — не третья копия, а умение глагола принять ТОЧКУ
    // подвеса, когда опора тонкая; это уже форма примитива, и она ждёт
    // владельца (CANON S23, долги).
    const std::uint8_t downFace = anchor_face_pack(2, -1); // нижняя грань опоры
    std::vector<KhrushiPole> poles;
    khrushi_poles(ctx.seed, ctx.number, poles);
    const int hookZ = kKhrushiGroundCoord + ((kKhrushiPoleTopH - 1) >> 3);
    for (const KhrushiPole& p : poles)
        if (place_prop_hanging(reg, world, layer, p.x + p.dx, p.y + p.dy, hookZ,
                               downFace, PropId::StreetLamp,
                               /*dropM=*/0.2f) != entt::null)
            ++count;

    // Подъезды: a bulb on every stairwell landing (the entrance facade cell
    // IS the landing column), hung from each storey's slab, and one over the
    // entrance opening outside, anchored into the facade panel.
    std::vector<KhrushiEntrance> doors;
    khrushi_entrances(ctx.seed, ctx.number, doors);
    for (const KhrushiEntrance& e : doors) {
        for (int s = 0; s < kFlats; ++s) {
            const int ceilH = s * kRise + kRise - 2; // this storey's slab
            const int cz = kKhrushiGroundCoord + (ceilH >> 3);
            if (place_prop_hanging(reg, world, layer, e.x, e.y, cz, downFace,
                                   PropId::BareBulb,
                                   /*dropM=*/0.45f) != entt::null)
                ++count;
        }
        // Over-entrance bulb: anchored into the facade wall band one cell up.
        // АВТОРСКИЕ МЕТРЫ, поэтому не глагол постановки: 0.3 м от грани фасада
        // и высота перемычки 2.4 м — это рисунок модуля, а не «по центру
        // клетки заподлицо». Запись якоря берётся у движка
        // (`anchor_from_surface`) — здесь стояло условие по БУКВЕ ОСИ, верное
        // для X/Y и молча неверное для Z.
        const int axis = e.dx != 0 ? 0 : 1;
        const int dir = e.dx + e.dy;
        const int wallZ = kKhrushiGroundCoord + 1;
        const std::uint8_t face = anchor_face_pack(axis, dir);
        const int wx = wrap_macro(e.x), wy = wrap_macro(e.y);
        const SurfaceFace sf = surface_face_at(grid, wx, wy, wallZ, face);
        if (sf.columns == 0) continue;
        const vec3 pos{
            (static_cast<float>(e.x) + 0.5f) * kCellSize +
                static_cast<float>(e.dx) * (kCellSize * 0.5f + 0.3f),
            (static_cast<float>(e.y) + 0.5f) * kCellSize +
                static_cast<float>(e.dy) * (kCellSize * 0.5f + 0.3f),
            static_cast<float>(kKhrushiGroundCoord) * kCellSize + 2.4f};
        if (spawn_prop_from_id(reg, world, pos, anchor_from_surface(sf),
                               PropId::BareBulb, layer, 0.0f) != entt::null)
            ++count;
    }

    // ---- МЕБЕЛЬ КВАРТИР --------------------------------------------------
    // Комнаты объявил `khrushi_rooms` этого же прибытия, и хук их ВИДИТ
    // (решение владельца: «хук идёт после объявления комнат»). Обход по
    // объявленным зонам, а не по плану города второй раз: план и мебель
    // иначе разъехались бы молча при первой правке планировки — тот же довод,
    // по которому проёмы перечисляет сам модуль, а не угадывает потребитель.
    //
    // СОЛЬ своя (не сид этажа как есть): мебель не должна коррелировать с
    // плафонами и панелями той же клетки.
    const std::uint32_t salt = ctx.seed ^ 0x6B687275u; // 'khru'
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
        for (PropId p : kKhrushiFurniture)
            if (prop_fits_room(p, r)) ++want;
        if (want == 0) continue;
        wanted += static_cast<std::uint32_t>(want);
        const int n = room_stand_spots(world, ctx.rooms, id, salt, spots, want);
        if (n == 0) ++noSpot;
        int si = 0;
        for (PropId p : kKhrushiFurniture) {
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
    // ---- ПО МОБУ НА КРЫШУ ------------------------------------------------
    // Уровень берётся у ТАБЛИЦЫ, а не назначается: `floor_mob_tier` — та же
    // V-образная кривая глубины, по которой живёт весь этажный спавн
    // ([floor_spec.h]), так что крышная нечисть не выпадает из баланса этажа.
    // Клетка — центр футпринта, смещённый хешем крыши: ровно по центру
    // читалось бы решёткой, как «первая годная клетка» у мебели.
    std::vector<KhrushiRoof> roofs;
    khrushi_roofs(ctx.seed, ctx.number, roofs);
    const std::uint8_t lvl =
        static_cast<std::uint8_t>(floor_mob_tier(ctx.number));
    std::uint32_t onRoof = 0;
    for (std::size_t i = 0; i < roofs.size(); ++i) {
        const KhrushiRoof& rf = roofs[i];
        const std::uint32_t h = hash_u32(
            ctx.seed ^ (static_cast<std::uint32_t>(i) * 0x9E3779B9u));
        const MobKind kind =
            kKhrushiRoofMobs[h % std::size(kKhrushiRoofMobs)];
        const int cx = wrap_macro(rf.x0 + static_cast<int>((h >> 8) % rf.lenX));
        const int cy = wrap_macro(rf.y0 + static_cast<int>((h >> 16) % rf.lenY));
        if (spawn_mob_at(ctx.reg, ctx.layer, kind, lvl, cx, cy, rf.z,
                         /*salt=*/h, ctx.tick) != entt::null)
            ++onRoof;
    }
    std::printf("[khrushi] крыши: %u мобов на %zu крышах, уровень %u\n", onRoof,
                roofs.size(), lvl);

    std::printf("[khrushi] мебель: %u вещей из %u заказанных, зон %zu, из них без места %u\n",
                furnished, wanted, ctx.rooms.list.size(), noSpot);
    return count + onRoof;
}

} // namespace giga::game
