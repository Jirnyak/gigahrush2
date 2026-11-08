// KHRUSHI floor module — the open microdistrict, as a self-contained folder.
//
// THE FOLDER IS THE MODULE ([floors.md] §Module folders), same law as padic
// and blame:
//
//   khrushi.h          — this manifest: name, kind, explicit floor number, and
//                        the catalog registration.
//   khrushi_gen.cpp    — the 128^3 geometry generator (city-plan pipeline).
//   khrushi_module.cpp — registration + everything non-geometry the floor grows
//                        (street lamps, stairwell bulbs, apartment dressing).
//
// WHY THIS FLOOR EXISTS: padic proves density (a warren filling the whole
// volume), blame proves void (a canyon through sculpted mass). Khrushi proves
// the OPEN GROUND PLANE: a city plan seen from above — avenues, sidewalks,
// courtyards and squares on a street slab, with free-standing ten-storey
// khrushchevka blocks rising out of it. The sky needs no ceiling: z wraps, so
// the UNDERSIDE of the street slab IS the sky seen from the courtyards, far
// overhead (owner's direction, 2026-08-27). That is also why the slab is a
// FULL CELL of concrete, not a one-sub-voxel crust — both of its faces are
// real surfaces the player will see.
//
// THE GEOMETRY IS PLANNED, NOT SCULPTED: a city is authored top-down. The
// generator lays the street grid first (quarters pitched to the fast-travel
// lattice), places building footprints per quarter with seed jitter, then
// raises each block storey by storey — panel walls, glass windows, stair
// cores taken from padic's one proven trick (sloped concrete flights with a
// mid landing), khrushchevka apartment plans. Interiors are fully built: every
// block is enterable floor to roof.
//
// Modularity beats DRY on purpose (padic.h states the law): the sub-voxel
// stamping helpers are spelled out again in khrushi_gen.cpp rather than
// shared, so either folder stays independently editable and deletable. The
// only things this module touches outside its folder are (a) one registration
// call in build_default_floor_catalog and (b) its data rows in floor_gen.cpp's
// per-kind dispatch — rows, not branches.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <cstdint>
#include <vector>

#include "ecs/registry.h"
#include "game/floor_gen.h"  // FloorPlaceCtx — контекст хука расстановки
#include "game/floor_spec.h" // FloorKind, FloorSpec
#include "world/gravity.h"   // GravityRegime — the module declares its frame
#include "world/level_stack.h"

namespace giga {
class World;
}

namespace giga::game {

class FloorCatalog;

// The number this module claims outright. The pattern chain would make 6
// Derelict (6 % 7 == 6); the claim beats it, one module per number
// ([floor_catalog.h], red-tested in suite_floorcatalog.inl).
inline constexpr int kKhrushiFloorNumber = 6;

// The module's declared gravity frame: streets lie flat under -Z like every
// residential module so far. The ENGINE stays isotropic; the open sky above
// the city is the same torus that puts the slab's underside overhead.
inline constexpr GravityRegime kKhrushiGravity = GravityRegime::NegZ;

// The arrival/standing coordinate along the gravity axis. Равна она не
// падику, как тут было написано, а ОБЩЕЙ координате прибытия лифта
// ([floor_gen.h] kFloorArrivalCoord): поездка планирует её заранее, одной на
// весь столб. Вывод модуля: плита улицы — полная клетка z = 2, значит первая
// воздушная клетка, в которой тело стоит, — z = 3, поверхность улицы.
// Равенство контракту утверждает floor_gen.cpp.
inline constexpr int kKhrushiGroundCoord = 3;

// The street slab cell (one FULL cell of concrete, both faces real surfaces —
// the top is the street, the bottom is the "sky" of the wrapped torus).
inline constexpr int kKhrushiSlabZ = 2;

// Register the module's catalog rows (currently: the claim on number 6).
bool register_khrushi_floor(FloorCatalog& cat);

// The module's LAWS, before any geometry: gravity frame + sub-material
// registry. Runs on every floor entry, generated or restored. Idempotent.
void khrushi_declare_rules(World& world, int number, const FloorSpec& spec,
                           unsigned seed);

// The module's rules ON TOP of finished geometry (generated or restored).
// Deterministic in (seed, number).
void khrushi_apply_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed);

// The geometry: the open microdistrict — see khrushi_gen.cpp's stage pipeline.
// Clears the grid (and stale sub-material pages) first per the generate_floor
// contract ([floor_gen.h]). Pure function of (number, seed).
void generate_khrushi_floor(World& world, int number, const FloorSpec& spec,
                            unsigned seed);

// ПРОЁМЫ МОДУЛЯ (строка в kDoorwayEnumerators, [floor_gen.h] floor_doorways).
// Сегодня НОЛЬ — и это ответ модуля, а не отсутствие ответа: квартирные планы
// уже построены, но дверных отверстий с наличниками под полотно в них пока
// нет. Подъезды (`khrushi_entrances` выше уже знает их клетки) и квартирные
// двери — следующий инкремент модуля, и наполнится ТЕЛО этой функции, а
// таблица в общем коде не шевельнётся. Жил этот ноль веткой
// `if (kind == Khrushi)` в общем коде, вместе с причиной.
struct Doorway;
std::uint32_t khrushi_doorways(int number, unsigned seed,
                               std::vector<Doorway>& out);

// Объявить комнаты модуля (rooms-object C, S12.1): спальня/зал/кухня/санузел/
// кладовка на секцию-сторону-ярус по фиксированной раскладке квартиры;
// прихожая и коридор — проход, не комнаты. Полуторный ярус — внутреннее дело
// модуля: клетка достаётся ярусу её центра (решение владельца 2026-08-28:
// «комнаты строго по клеткам, модуль сам разбирается»). Чистая функция;
// вызывающий делает rooms_reset. Возвращает число объявленных комнат.
struct FloorRooms;
std::uint32_t khrushi_rooms(int number, unsigned seed, FloorRooms& out);

// A street-lamp pole: a voxel pipe column on the kerb with a hook arm over
// the road; (dx,dy) is the unit step towards the road. The lamp prop hangs
// from the hook's under-face; wires run pole to pole. ONE function is the
// source of every pole position — the generator stamps them, the module
// seeder hangs lamps on them, the antourage hook strings wires between them
// (the padic lesson: a local copy of layout constants is a standing defect).
struct KhrushiPole {
    std::uint8_t x, y;  // kerb cell of the pole
    std::int8_t dx, dy; // unit step towards the road (the hook direction)
};

// Pole height in sub-voxels (5 m): the hook arm is its top sub-layer, so the
// lamp seeder and the wire hook both derive the hook cell from THIS.
inline constexpr int kKhrushiPoleTopH = 20;

// A подъезд: the facade cell holding the entrance opening, and the outward
// step into the courtyard. One per section, emitted in building order.
struct KhrushiEntrance {
    std::uint8_t x, y;
    std::int8_t dx, dy;
};

// Deterministic replay of the plan's entrance list (same law as the poles:
// one source, no local copies).
std::uint32_t khrushi_entrances(unsigned seed, int number,
                                std::vector<KhrushiEntrance>& out);

// Deterministic in (seed, number) like the geometry. Returns count appended.
std::uint32_t khrushi_poles(unsigned seed, int number,
                            std::vector<KhrushiPole>& out);

// КРЫША ДОМА — футпринт и ходовая клетка над плитой. Та же форма экспорта,
// что у столбов и подъездов: план — один источник, локальных копий нет.
//
// `z` ВЫВЕДЕН, а не назначен: плита крыши лежит в субвысотах
// [kBldgTopH − kSlabThick, kBldgTopH), её верх приходится ровно на
// kBldgTopH, значит первая клетка НАД плитой — `kKhrushiGroundCoord +
// kBldgTopH / kSubDim`. Парапет поднимается ещё на два субвокселя внутри
// этой же клетки, то есть тело стоит в коробке с бортиком.
struct KhrushiRoof {
    std::uint8_t x0, y0;   // min-corner клетки футпринта
    std::uint8_t lenX, lenY; // размеры футпринта в клетках
    std::uint8_t z;        // ходовая клетка над плитой
};
std::uint32_t khrushi_roofs(unsigned seed, int number,
                            std::vector<KhrushiRoof>& out);

// Module antourage (dispatched by floor_antourage_extra's per-kind table):
// wires strung hook to hook along every kerb line, sagging over the road.
// READS the grid law: appends to the bake, never writes voxels.
struct AntourageBake;
void khrushi_bake_antourage(const World& world, int number, unsigned seed,
                            AntourageBake& out);

// РАССТАНОВКА СОДЕРЖИМОГО МОДУЛЯ — строка `kContentPlacers` в floor_gen.cpp,
// хук после объявления комнат ([floor_gen.h] FloorPlaceCtx). Две части, и
// обе — политика ЭТОГО этажа:
//   * обвес города: уличные фонари под крюками столбов, лампочка на каждой
//     площадке подъезда и над каждым входом;
//   * МЕБЕЛЬ КВАРТИР по строкам `kKhrushiFurniture` (koйka, плита, стол,
//     унитаз) — по объявленным глаголам комнат, см. .cpp.
// Общие сеялки (плафоны, настенные панели, напольные станции) работают по
// полосам строки этажа отдельно и этого хука не касаются.
std::uint32_t khrushi_place(const FloorPlaceCtx& ctx);

} // namespace giga::game
