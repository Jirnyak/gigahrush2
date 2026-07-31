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
`kSubDim` to 16 grows the mask automatically via `kSubMaskWords`. **Why 128 and
not 256:** 128³ is the deliberate active-floor size — one floor is live at a time
and depth comes from the W-stack, so a bigger N buys floor *size*, not more
simulation, while the renderer's O(N³) surface scan and sub-voxel RAM (138 MB →
1.11 GB at 256) break first. See [performance.md](performance.md) §Active-floor
sizing.

## Dense, not sparse

The grid is fully dense SoA — every one of the 2 M cells is stored, whether solid
or air. That is deliberate: it is branch-free to index, cache-friendly to scan,
and trivially serializable (save the whole world verbatim). With disk unlimited
and 8 GB RAM, there is no reason to sparsify. New world state (fields, stains)
follows the same dense shape — **at macro resolution**. The 8³ sub-voxel layer is
the exception: it stays a *sparse* per-cell blocker mask, never a second dense
1024³ simulation grid (≈ 1 GB/field — the wall in
[performance.md](performance.md) §The compute split). Macro = dense; sub-voxel =
sparse mask. See [performance.md](performance.md).

## Rendering

The **cube pass** walks the grid once per rebuild, **surface-culls** cells whose
six neighbours are all solid (interior cells emit nothing), and issues a single
**instanced draw** — one instance per visible cell, coloured by `CellType` and
tinted by the `fluid` field. Instance count scales with visible *area*, not
volume. See [render.md](render.md).

**Partial cells are meshed, not enumerated.** A cell whose mask is not full
renders its actual bits through two composed merges
([render/sub_mesh.h], [render/cube_pass.cpp]): greedy **3D boxes** inside the
8³ mask (a 1-sub-voxel floor slab is ONE box, a 2-sub-voxel-thick wall is ONE
box regardless of orientation), then runs of **byte-identical partial cells**
stretch along one axis under the same AO-exactness conditions as the full-cell
merge (`run_length` with `kPartialFlag`). This is what lets a floor built
almost entirely at sub-voxel resolution — the padic module's thin walls and
slabs on 43 stacked levels — fit the 2,097,152-instance buffer with room to
spare: measured on the real padic floor, 23.6 M dropped x-runs (whole regions
invisible) became 68,625 instances, total, no drops.

**The most expensive pattern in the game, per cell drawn, is the 2D
checkerboard** (the padic grate: `(sx+sy)%2` on one sub-layer). Every solid
voxel is isolated, so no mesher can merge it — 32 boxes per cell, forever. A
3D checkerboard would be 256. It survives because grate cells are few
(~200/level); do not build large surfaces out of it. Stripes (1×8 bars) look
like a grate and merge to ~4 boxes.

## Data-driven extension

Add a cell type → pick an id and add a colour row in the cube pass. No engine
branch. Carving detail = clearing/setting sub-voxel bits; physics picks it up
for free because collision reads the same masks.

## Destruction

Carving is no longer hypothetical: [destruct.md](destruct.md) is the ONE
universal way sub-voxels leave the grid at runtime — probabilistic
hardness-vs-power rolls per material ([world/material_props.h]), layered
per-sub-voxel materials via the sparse `SubField` registry
([world/subfield.h]), and a bounded connectivity sweep that deletes loose
components and hands them to the renderer as debris. Physics picks every hole
up for free (collision reads the same masks); baked overlays are repaid via
`CarveResult::dirtyCells`. The renderer draws the holes honestly too: full
cells stay one merged box (the macro optimisation), partial cells render
their actual bits as greedy 3D boxes of 0.25 m sub-voxels (§Rendering above;
[destruct.md] §Рендер). Cells carrying a per-sub-voxel material page never
stretch across cell boundaries — carved geometry is rare and local, so the
safe default costs nothing measurable.

## Connections

Consumed by [physics.md](physics.md) (swept-AABB vs. masks),
[fluid.md](fluid.md) (downward-flow blocking), and the renderer. Overlaid by
runtime [fields.md](fields.md). Mutated at runtime only through
[destruct.md](destruct.md) and doors ([game/door.h]).
