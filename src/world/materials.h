// Cell material ids — the shared vocabulary between the generators that WRITE
// cells and the render pass that gives them a colour.
//
// `CellType` is an opaque `uint16` to the engine ([voxels.md]); these constants
// are the game's meanings for it. They live in `world/` rather than `game/` for
// one reason: the render pass needs them and render must never include `game/`
// ([ARCHITECTURE.md] layering). Nothing here is behaviour — a material id is a
// label, and the only code that branches on it is the colour table in
// `render/cube_pass.cpp`.
//
// Adding a material is one id here plus one row there, per the data-driven rule in
// [AGENTS.md] — never an `if` in the generator.
#pragma once

#include "world/macro_grid.h"  // CellType, kCellAir

namespace giga {

// --- The original demo vocabulary -------------------------------------------
// Used by the maze test bed (`app/worldgen.cpp`). Kept at their historical ids so
// existing saves and the maze mode keep rendering as they did.
inline constexpr CellType kMatConcrete = 1;  // generic grey wall / stone
inline constexpr CellType kMatSoil = 2;
inline constexpr CellType kMatWaterMark = 3;
inline constexpr CellType kMatSlabTan = 4;   // generic tan slab
inline constexpr CellType kMatHubPad = 7;    // nav / fast-travel pad (cyan)

// --- Khrushchevka materials, one pair per FloorKind -------------------------
// Before these existed every floor kind wrote kMatConcrete + kMatSlabTan, so an
// Industrial pillar plate and a Residential warren rendered in identical grey and
// tan — the maze demo's palette, on a Soviet apartment block.
//
// Albedos for the metal/industrial half are **measured** off real 2K photographs
// (Poly Haven, CC0; see data/materials.csv for the per-material source URL and the
// measured luminance variance). The residential half is authored, because the pack
// contains no wallpaper, parquet, plaster or linoleum — that is the honest split:
// harvest where a real material exists, author where none does.
inline constexpr CellType kMatPlaster = 8;      // Residential wall  (authored)
inline constexpr CellType kMatParquet = 9;      // Residential slab  (authored)
inline constexpr CellType kMatShopShutter = 10; // Commercial wall   (measured)
inline constexpr CellType kMatLino = 11;        // Commercial slab   (measured)
inline constexpr CellType kMatFactoryWall = 12; // Industrial wall   (measured)
inline constexpr CellType kMatTread = 13;       // Industrial slab   (measured)
inline constexpr CellType kMatRust = 14;        // Derelict wall     (measured)
inline constexpr CellType kMatRubble = 15;      // Derelict slab     (measured)

// One past the last id in use. The colour table is sized from this, so adding a
// material without extending the table fails the build rather than rendering as
// an unremarkable default.
inline constexpr CellType kMatCount = 16;

} // namespace giga
