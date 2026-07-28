# Voxels — Macro grid & sub-voxel masks

The single source of truth for world occupancy: a flat **128³ macro grid** of
typed cells, each subdivided into an **8³ sub-voxel** blocker mask.

- **Code:** [src/world/macro_grid.h](src/world/macro_grid.h) /
  [macro_grid.cpp](src/world/macro_grid.cpp),
  [src/world/types.h](src/world/types.h)
- **Renderer:** [src/render/cube_pass.cpp](src/render/cube_pass.cpp)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L1

## Model

- **Macro cell** carries a `CellType` (game-defined `uint16_t`: 0 = air) and a
  `SubMask` (occupancy). Stored **structure-of-arrays**: `types_` and `masks_`
  in separate contiguous vectors, so a system that only cares about occupancy
  never touches type memory.
- **SubMask** = `kSubVoxels` (512) bits packed into `kSubMaskWords` (8) ×
  `uint64_t`. `test/set/clear` are bit ops; `intersects` is the collision fast
  path (bitwise-AND the two masks). A fully solid cell and a half-carved one
  cost the same to query.
- **Toroidal.** Every accessor runs coordinates through `wrap_macro`
  ([core/wrap.h](src/core/wrap.h)); there are no edges. Global voxel space is
  `kMacroDim × kSubDim = 1024` voxels per axis, also wrapping.

## Tunables

Three knobs, all in [types.h](src/world/types.h): `kMacroDim` (128), `kSubDim`
(8), and `kCellSize` (**2.0** — one macro cell is ~2 m, matching the reference
game's block scale, so a sub-voxel is 0.25 m). `kCellSize` ties grid space to ECS
`Transform` space 1:1, and `kWorldExtent = kMacroDim · kCellSize` (256 m) is the
torus period entity positions wrap against ([physics.md](physics.md)). Flipping
`kSubDim` to 16 grows the mask automatically via `kSubMaskWords`.

## Dense, not sparse

The grid is fully dense SoA — every one of the 2 M cells is stored, whether solid
or air. That is deliberate: it is branch-free to index, cache-friendly to scan,
and trivially serializable (save the whole world verbatim). With disk unlimited
and 8 GB RAM, there is no reason to sparsify. New world state (fields, stains)
follows the same dense shape. See [performance.md](performance.md).

## Rendering

The **cube pass** walks the grid once per frame, **surface-culls** cells whose
six neighbours are all solid (interior cells emit nothing), and issues a single
**instanced draw** — one instance per visible cell, coloured by `CellType` and
tinted by the `fluid` field. Instance count scales with visible *area*, not
volume. See [render.md](render.md).

## Data-driven extension

Add a cell type → pick an id and add a colour row in the cube pass. No engine
branch. Carving detail = clearing/setting sub-voxel bits; physics picks it up
for free because collision reads the same masks.

## Connections

Consumed by [physics.md](physics.md) (swept-AABB vs. masks),
[fluid.md](fluid.md) (downward-flow blocking), and the renderer. Overlaid by
runtime [fields.md](fields.md).
