// BLAME floor module — the megastructure void, as a self-contained folder.
//
// THE FOLDER IS THE MODULE ([floors.md] §Module folders), same law as padic:
//
//   blame.h          — this manifest: name, kind, explicit floor number, and
//                      the catalog registration.
//   blame_gen.cpp    — the 128^3 geometry generator (sculpted mass pipeline).
//   blame_module.cpp — registration + everything non-geometry the floor grows.
//
// WHY THIS FLOOR EXISTS: it is the engine's technodemo — the floor whose whole
// job is to answer "why a 256 m isotropic TORUS and not a wide flat pancake".
// Padic proves density (a repeating dormitory warren); blame proves VOID. Step
// out of a two-metre corridor onto a grated catwalk and there are a hundred
// metres of nothing below, a hundred above, cyclopean concrete walls to either
// side — and every one of those axes wraps, so the fall is bottomless, the
// canyon is endless, and no direction ever shows a seam.
//
// THE GEOMETRY IS SCULPTED, NOT PLANNED (owner's direction, 2026-08-17): the
// generator lays big masses first, carves voids out of them like clay, and only
// then dresses the resulting SURFACES with a grammar of elements (bridges,
// serpentine stairs, cornices, a terraced town, labyrinth mouths that open
// straight onto the abyss). Elements respond to local geometry, never to a
// floorplan grid — see blame_gen.cpp's stage comments.
//
// Modularity beats DRY on purpose (padic.h states the law): the sub-voxel
// stamping helpers are spelled out again in blame_gen.cpp rather than shared,
// so either folder stays independently editable and deletable. The only things
// this module touches outside its folder are (a) one registration call in
// build_default_floor_catalog and (b) its data rows in floor_gen.cpp's per-kind
// dispatch — rows, not branches.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include "game/floor_spec.h" // FloorKind, FloorSpec
#include "world/gravity.h"   // GravityRegime — the module declares its frame

namespace giga {
class World;
}

namespace giga::game {

class FloorCatalog;

// The number this module claims outright. The pattern chain would make 5
// Commercial (5 % 3 == 2); the claim beats it, one module per number
// ([floor_catalog.h], red-tested in suite_floorcatalog.inl).
inline constexpr int kBlameFloorNumber = 5;

// The module's declared gravity frame: the megastructure hangs its voids along
// -Z like the padic tower. The ENGINE stays isotropic — the drama of this floor
// is exactly that all three axes wrap identically; gravity is the one emergent
// asymmetry, and it is this module's choice ([world/gravity.h]).
inline constexpr GravityRegime kBlameGravity = GravityRegime::NegZ;

// The arrival/standing coordinate along the gravity axis. Deliberately EQUAL to
// the padic module's ground storey: save.h pins kArrivalCoord = 3 for every
// inter-floor ride, and the global frame helpers ([floor_gen.h]) still export
// one module's constants. The generator guarantees standable lobbies at z = 3
// on every lattice node (blame_gen.cpp, lobby bands).
inline constexpr int kBlameGroundCoord = 3;

// Register the module's catalog rows (currently: the claim on number 5).
bool register_blame_floor(FloorCatalog& cat);

// The module's LAWS, before any geometry: gravity frame + sub-material
// registry. Runs on every floor entry, generated or restored. Idempotent.
void blame_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed);

// The module's rules ON TOP of finished geometry (generated or restored).
// Blame currently only zeroes the fluid fields a recycled World slot may still
// carry from its previous floor. Deterministic in (seed, number).
void blame_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed);

// The geometry: sculpted megastructure — see blame_gen.cpp's stage pipeline.
// Clears the grid (and stale sub-material pages) first per the generate_floor
// contract ([floor_gen.h]). Pure function of (number, seed).
void generate_blame_floor(World& world, int number, const FloorSpec& spec,
                          unsigned seed);

// Объявить комнаты модуля (rooms-object C, S12.1): лобби решётки — 16 узлов
// x 16 бэндов, гарантированное воздушное ядро 5x5x2, тег hermetic
// ([blame.md]: «лобби — герметичная комната под городом»). Чистая функция;
// вызывающий делает rooms_reset. Возвращает число объявленных комнат.
struct FloorRooms;
std::uint32_t blame_rooms(int number, unsigned seed, FloorRooms& out);

} // namespace giga::game
