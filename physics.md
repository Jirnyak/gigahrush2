# Physics — Vector gravity, jump, swept-AABB collision

Integrates entities against the world they live on and resolves collisions
**one axis at a time** (Quake-style sweep) against sub-voxel masks, so entities
slide along walls and land flush on sub-voxel surfaces.

- **Code:** [src/sim/physics.h](src/sim/physics.h) /
  [physics.cpp](src/sim/physics.cpp)
- **Test:** `tests/world_test.cpp` (`test_physics_lands_on_floor`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2

## Model

`physics_step(reg, stack, dt, params)` iterates
`view<Transform, Velocity>(entt::exclude<SelfIntegrating>)` — anything that
integrates its own motion (projectiles) carries that tag and must NOT be moved
twice; until the exclusion existed they ran at double speed and double gravity:

1. **Substep** `dt` (up to `maxSubsteps`, capped at `maxStep`) so fast movers
   don't tunnel through thin sub-voxel walls.
2. **Gravity + jump** (only if `GravityAffected`): `vel += gravity.at(pos) *
   scale * dt`; "up" = `normalize(-accel)`, so jump impulse and ground detection
   work under any gravity direction.
3. **Sweep** each axis independently, binary-searching back to the last
   non-overlapping position on collision, then zeroing that velocity component.
4. **Ground check:** a collision on the axis most aligned with "up", while
   descending, sets `GravityAffected::grounded`.
5. **Toroidal wrap:** after integration, the entity's position is wrapped back
   into `[0, kWorldExtent)` on **all three axes** (`wrapf`, [core/wrap.h](src/core/wrap.h)).
   This is what makes the torus real for the *agent*, not just for collision
   queries — walk or fall off any face and you seamlessly re-enter from the
   opposite one (top↔bottom, left↔right, front↔back). Isotropy by construction.

Collision queries go through `aabb_overlaps_solid(world, pos, half)` — voxelize
the box's span and test each global voxel against the macro grid's sub-voxel
masks. Exposed for gameplay queries too (line-of-fire, placement checks).

## Scale

`kCellSize = 2.0` ([voxels.md](voxels.md)), so gravity, jump impulse, and move
speed are in real m/s² / m/s over a 256 m torus (`kWorldExtent`). The wrap period
is `kWorldExtent = kMacroDim · kCellSize`; keep any world-space distance math on
the torus going through `wrap_delta` so it respects the seam.

## Where the tick actually goes (measured 2026-08-05)

Profiled on floor 0 with ~270 bodies (`/usr/bin/sample` on a long `--shot`):
**`physics_step` is 77% of the main thread**, and effectively all of it is
`sweep_axis → aabb_overlaps_solid → voxel_solid`. The arithmetic explains it —
`aabb_overlaps_solid` tests **every sub-voxel** the box covers (a 0.6×0.6×1.8 m
walker ≈ 3×3×8 = 72), and a blocked `sweep_axis` then re-tests the whole box **12
more times** in its binary search: up to ~950 voxel probes per axis, ×3 axes ×270
bodies ×125 Hz ≈ 10⁸ probes/s, each doing three `wrapi`, three div/mod and a mask
lookup. It stays inside the frame budget in Release and is nowhere near it in
Debug (see [performance.md](performance.md)).

Nothing here is a bug — it is the honest cost of the naive loop, and these are the
levers, cheapest first, none of them yet taken:

1. **Hoist the cell.** `voxel_solid` re-derives the macro cell (3 wraps + index)
   per VOXEL, while a body's box spans one or two cells. Resolve the cell once per
   cell-run and the wrap math nearly vanishes.
2. **Test a ROW, not a voxel.** Within a cell the x-run of sub-voxels is a
   contiguous bit range of one `SubMask` word — one AND replaces up to 8 probes.
3. **Skip empty/full cells whole.** `SubMask::empty()`/`full()` answer for 512
   sub-voxels at once; an air cell needs no inner loop at all.
4. **Drop the binary search.** A swept DDA marching voxel planes finds the contact
   directly instead of 12 full-box re-tests, and it is the same loop for every
   axis.
5. **Test only the leading slab.** A step shorter than a sub-voxel can only newly
   touch the face it moved into, not the whole box.

Do these in that order, and re-measure with the slope method each time — the
profile above is the baseline to beat.

## Tunables

All on components, nothing baked into the solver: `AABB::half`, `Jump::impulse`,
`GravityAffected::scale`. Solver knobs (`maxSubsteps`, `maxStep`) live in
`PhysicsParams`.

## Connections

Reads [gravity.md](gravity.md) and the sub-voxel masks ([voxels.md](voxels.md)).
Vertical axis is owned here; horizontal velocity comes from
[controller.md](controller.md). Operates per-layer via
[world.md](world.md)/`LevelStack`.
