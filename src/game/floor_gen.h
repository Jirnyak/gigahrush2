// Per-floor generator — builds a floor MODULE's 128^3 World as a pure function
// of (seed, floor number, FloorSpec).
//
// floors.md / macrosim.md: a floor is a self-contained module whose geometry is
// fully determined by its number and the world seed. That determinism is what
// lets a streamed-out floor be torn down and regenerated bit-for-bit on return
// (increment #9), so nothing about a floor's layout has to be persisted.
//
// GEOMETRY COMES FROM MODULES ([floors.md] — the folder is the module). This
// file is only the dispatch seam (kind -> module generator row) plus the room
// TAXONOMY the content tables key on. The floor's *character* (its FloorKind,
// carried in the FloorSpec) themes CONTENT — population, mobs, loot, room mix —
// never geometry branches.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "game/floor_spec.h"
#include "world/gravity.h" // GravityRegime — the module's declared frame

namespace giga {
class World;
class MacroGrid;
}

namespace giga::game {

// Build `world`'s grid into the floor labelled `number`, themed by `spec`.
//
// The world is cleared to air first, so the result depends only on
// (number, spec.kind, seed) and NOT on any prior contents of `world` — call it
// again with the same arguments (even on a recycled World slot) and you get an
// identical grid. `number` is the in-game floor label (signed, floors.md); it is
// mixed into the RNG so two floors of the same kind still differ.
// A FLOOR ENTRY IS THREE STEPS, NOT ONE. Generation and rules used to be fused
// inside the module generator; splitting them is what lets a VISITED floor come
// back from its snapshot instead of being rebuilt ([floors.md], [problems.md] §42):
//
//   1. floor_declare_rules  — the module's LAWS. Gravity frame, registries.
//                             ALWAYS, before any geometry exists. The frame is a
//                             property of the MODULE, never of the saved bytes,
//                             which is exactly why a restored floor still needs
//                             this and why the snapshot does not carry it.
//   2. generate_floor  OR  a snapshot restore — the GEOMETRY. One or the other:
//                             first visit builds it from (seed, number), a
//                             revisit reads it back verbatim.
//   3. floor_apply_rules    — the module's rules laid ON TOP of whichever
//                             geometry step ran: fluids, seeded content.
//                             ALWAYS, after geometry is final.
//
// Steps 1 and 3 are idempotent and deterministic in (seed, number), like the
// geometry itself. A module supplies all three as data rows in floor_gen.cpp's
// dispatch tables — never a branch.
void floor_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed);

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed);

void floor_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed);

// Объявить комнаты этажа (rooms-object, канон S12.1): rooms_reset + диспетч
// в объявитель модуля (строка данных, как генератор). Зовётся на КАЖДОМ входе
// на этаж — generate и restore (закон масок S18: декларация — чистая функция
// (kind, number, seed), в снимок не едет). Печатает счёт вслух; пересечение
// зон или отказ объявления — WARN, гейт в suite_rooms_object.
struct FloorRooms;
void rooms_declare(FloorRooms& rooms, int number, const FloorSpec& spec,
                   unsigned seed);

// --- Лифтовые столбы (elevators-2x2.md, решения владельца 2026-08-27) -------
// Узел лифта = ЗАМКНУТЫЙ столб: кольцо стен 3×3 через весь тор (z
// заворачивается — у столба нет ни начала, ни конца), шахта 1 клетка в
// центре. Кабина НЕ движется: на этаже входа в шахте стоит пол (клетка под
// storey входа), «приезд кабины» — иллюзия поездки. ВХОД — один проём в
// кольце: storey называет МОДУЛЬ этажа (S10 — политика в модуле; сегодня все
// три модуля называют свой ходовой ground), сторону — хеш (сид, этаж, узел).
// От этой структуры считают ВСЕ потребители: посадка ride_elevator, кнопка
// вызова, панель кабины — второй копии закона не существует.
struct LiftEntrance {
    int h;    // walkable storey клетки входа (и пола кабины под ней)
    int side; // 0..3 = +x, -x, +y, -y — сторона проёма в кольце
};
// node — лифтовый хаб [0, kFastHubsPerFloor) из fast_travel.h.
LiftEntrance lift_entrance(FloorKind kind, int number, int node, unsigned seed);

// Проштамповать 4 столба поверх ЛЮБОГО модуля — generate_floor зовёт это
// сам после генератора. В снимок ревизита столбы входят обычными клетками,
// restore-ветка ничего не перештамповывает.
void stamp_lift_pillars(World& world, int number, const FloorSpec& spec,
                        unsigned seed);

// ЩИТ лифтов ([world/protect.h], решение владельца 2026-08-27): весь объём
// каждого столба 3×3 через все z — защищённая область (кольцо, шахта, пол
// кабины, проём — ни карв, ни детач, ни будущий самосбор их не меняют;
// лифт — ключевая механика). Маска НЕ в снимке — чистая функция сетки, её
// штампует ensure_loaded/Prebuild на КАЖДОМ входе, обеими ветками
// (build_world_half). Чистит маску слота и кладёт свою.
void stamp_lift_protection(World& world);

// ---------------------------------------------------------------------------
// Gravity frame — the module's declared regime, and axis-generic ground queries
// ---------------------------------------------------------------------------
// The engine is ISOTROPIC (x/y/z equal citizens on the torus); gravity is the
// one emergent asymmetry, and it is the MODULE's to declare ([world/gravity.h]
// GravityRegime — 8 values, one of which is Zero). Every consumer that puts a
// body or a crate "on the ground" goes through these instead of naming an axis.
GravityRegime floor_gravity_regime();

// The standing coordinate along the gravity axis (the module's ground storey).
// Meaningless under Zero (any air cell is ground) — callers branch on regime.
int floor_ground_coord();

// A standing cell: air, with solid one cell toward -g. Under Zero every air
// cell qualifies. Wraps on all axes. Reads the WORLD's live regime
// (world.gravity().regime — runtime state the game may flip mid-run), never the
// module's generation-time constant.
bool floor_standable(const World& w, int x, int y, int z);

// Compose a cell from two TANGENT coordinates (the two non-gravity axes in
// x,y,z order) and a HEIGHT coordinate `h` along the gravity axis. No storey is
// special: spawn draws h over the whole axis and filters with floor_standable —
// the torus has no privileged coordinate.
void floor_cell(const World& w, int u, int v, int h, int& x, int& y, int& z);

// floor_cell at the module's default ground coordinate — the ARRIVAL storey
// (elevator pads), not a spawn privilege.
void floor_ground_cell(const World& w, int u, int v, int& x, int& y, int& z);

// Legacy projection: the ground coordinate, valid while the registered module's
// regime is +-Z. Prefer the frame helpers above in new code.
int floor_ground_z();

// ---------------------------------------------------------------------------
// РЕШЁТОЧНАЯ ТАКСОНОМИЯ КОМНАТ УМЕРЛА (rooms-object F, 2026-08-28): хеш
// «вида» по (kind, number, rx, ry) заменён НАСТОЯЩИМИ комнатами модуля —
// game/room.h (RoomId, roomAt, теги, глаголы). floor_room_mask/stride/
// bit_index и RoomBit не существуют; грепный гейт в check_source_rules.
// ---------------------------------------------------------------------------

// One opening this generator punches through an interior wall — the cell a DOOR
// occupies ([door.h]). Positions are macro cells, so a byte each.
//
// `axis` says which wall line the opening is IN, which is the only thing a
// consumer cannot re-derive from the cell alone once the wall has decayed:
//   0 -> the wall line x == cx, so the jambs are at (cx, cy+-1)
//   1 -> the wall line y == cy, so the jambs are at (cx+-1, cy)
struct Doorway {
    std::uint8_t cx = 0;   // opening cell, X
    std::uint8_t cy = 0;   // opening cell, Y
    std::uint8_t cz = 0;   // BOTTOM cell of the opening
    std::uint8_t h = 0;    // opening height in cells, >= 1
    std::uint8_t axis = 0; // which wall line holds it (see above)
};

// Enumerate every doorway `generate_floor(world, number, spec, seed)` punches,
// appending to `out`; returns how many were added. Empty for a pillar-mode kind
// (an open plate has no wall segments to open).
//
// Exported so a second consumer has to
// agree with the generator EXACTLY. door.cpp needs the doorway cells at floor
// load, and the two ways to get them are both traps —
//
//   * re-deriving them from the finished grid guesses, and guesses wrong on a
//     Derelict floor, where `gapPct` has knocked 38% of the wall out and a
//     collapsed hole is indistinguishable from an architectural opening;
//   * replaying the generator's xorshift stream couples the replay to the ORDER
//     every other loop in generate_floor draws numbers in — the same silent,
//     seed-dependent drift the note above warns about for the stride table.
//
// So the offset of an opening inside its wall segment is a pure HASH of
// (seed, number, storey, room, axis), and this function and the generator call
// the same one. A hash has no order to get wrong.
std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out);

// MODULE antourage on top of the generic bake: after bake_antourage reads the
// finished grid, the floor's own module may append instances/wires/cloths it
// can only lay out from its plan (khrushi strings wires between its street
// poles). Per-kind table row in floor_gen.cpp — a row, never a branch; kinds
// without module dressing have a null row and this is a no-op. Deterministic
// in (grid, number, seed) like the generic bake, and it obeys the same law:
// READ the grid, never write it.
struct AntourageBake;
void floor_antourage_extra(const World& world, int number,
                           const FloorSpec& spec, unsigned seed,
                           AntourageBake& out);

} // namespace giga::game
