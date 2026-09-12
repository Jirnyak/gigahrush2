// PADIC floor module — the 4D spectrum fractal floor, as a self-contained folder.
//
// THE FOLDER IS THE MODULE ([floors.md] §Module folders). Everything specific to
// this floor lives under src/game/floors/padic/ and nowhere else:
//
//   padic.h          — this manifest: the module's name, kind, explicit floor
//                      number, and its catalog registration.
//   padic_gen.cpp    — the 128^3 geometry generator (tiered slab fractal).
//   padic_module.cpp — the registration + everything non-geometry the floor
//                      ships (special loot, carvers, story NPCs, quests, events,
//                      interactive objects — added HERE as the module grows).
//
// Modularity beats DRY on purpose: a floor folder spells its content out in
// full even where it repeats another folder's pattern, so modules stay
// independently editable, deletable, and copy-pasteable as templates. The only
// things a module touches outside its folder are (a) one registration call from
// build_default_floor_catalog and (b) one generator row in floor_gen.cpp's
// per-kind dispatch — both data rows, not branches.
//
// The module CLAIMS floor number 4 explicitly. The default pattern chain would
// make 4 Industrial (4 % 5 == 4), so this claim is the standing proof that an
// explicit number beats a pattern ([floor_catalog.h]); the padic patterns
// (|n| >= 25, |n| % 11 == 10) still hand the kind out elsewhere as defaults.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <vector>
#include "game/floor_spec.h" // FloorKind, FloorSpec
#include "ecs/registry.h"
#include "world/gravity.h"   // GravityRegime — the module declares its frame
#include "world/level_stack.h"
#include "game/event_bus.h"

namespace giga {
class World;
}

namespace giga::game {

class FloorCatalog;

// The number this module claims outright. A claim, not a pattern: exactly one
// module may hold it, and a second claimant is a refused registration + a red
// test ([suite_floorcatalog.inl]).
inline constexpr int kPadicFloorNumber = 4;

// This module's declared gravity frame ([world/gravity.h] GravityRegime): the
// dormitory tower stacks its storeys against -Z. The ENGINE is isotropic — a
// sister module could build against -X and every consumer keyed on the regime
// would follow it; the asymmetry is the module's emergent choice, never the
// engine's.
inline constexpr GravityRegime kPadicGravity = GravityRegime::NegZ;

// The ground-storey STANDING coordinate along the gravity axis: storeys are
// 3-cell (air at b, b+1; two-slab sandwich at b+2), so the first standing cell
// (air with a solid floor one step toward -g) sits at coordinate 3 — storey 1's
// air over storey 0's ceiling sandwich. Content placement (crates, mob packs)
// keys on this through the floor_gen frame helpers, never on a literal.
inline constexpr int kPadicGroundCoord = 3;

// Register the module's catalog rows (currently: the claim on number 4).
// Returns false if the claim was refused — another module took the number.
bool register_padic_floor(FloorCatalog& cat);

// The geometry: the dormitory tower (см. схему владельца, 2026-07-31) — 3-cell
// storeys with a two-slab ceiling/floor sandwich, 2-cell corridors along the
// lattice lines, BSP apartment blocks with room doors, real two-flight stair
// shafts (11 steps + landing = 12 risers per flight), bar grates, ragged floor
// holes, plus the mandatory 4x4x4 elevator lattice ([torus-nav-baking]). The
// plan is a pure function of (number, seed) — safe because the app has ONE
// seed per floor (streamer.floor_seed_of), which door_build now uses too; the
// short-lived separate "door seed" put walls and doors in two different
// buildings. Clears the grid (and stale sub-material pages) first like every
// floor generator ([floor_gen.h] generate_floor contract). Dispatched by kind
// from floor_gen.cpp's generator table.
// The module's LAWS, declared before any geometry: gravity frame + the
// sub-material registry. Runs on every floor entry, generated or restored —
// the frame is a property of the module, not of the saved bytes, so a floor
// rebuilt from a snapshot still gets it. Idempotent.
void padic_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed);

// The module's rules laid ON TOP of finished geometry: water in the lattice
// pits and stair sumps, buoyant gas in the shafts. Runs after generation OR
// after a snapshot restore, so a revisited floor gets its fluids back even
// though the snapshot carries geometry only. Deterministic in (seed, number).
void padic_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed);

void generate_padic_floor(World& world, int number, const FloorSpec& spec,
                          unsigned seed);

// Retrieve doorway locations for the Padic geometry (called by floor_doorways).
struct Doorway;
std::uint32_t padic_doorways(int number, unsigned seed, std::vector<Doorway>& out);

// Объявить комнаты модуля (rooms-object C, канон S12.1: комнаты объявляет
// МОДУЛЬ при генерации): все BSP-листья плана — жилые, санузлы, ниши,
// кладовки — на каждом из 42 ярусов, свой RoomId на ярус. Чистая функция
// (number, seed), как padic_doorways; вызывающий делает rooms_reset.
// Возвращает число объявленных комнат.
struct FloorRooms;
std::uint32_t padic_rooms(int number, unsigned seed, FloorRooms& out);

// Seed props and test-balls for the Padic floor (ceiling lightbulbs & rolling/anchored
// test-balls). layer tags Transform so a recycled LayerId slot can be cleared on the
// next arrival ([prop_system.h]).
std::uint32_t seed_padic_props(Registry& reg, const World& world, LayerId layer,
                               int number, unsigned seed, EventBus& bus);

} // namespace giga::game
