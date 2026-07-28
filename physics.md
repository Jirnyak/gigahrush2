# Physics — Vector gravity, jump, swept-AABB collision

Integrates entities against the world they live on and resolves collisions
**one axis at a time** (Quake-style sweep) against sub-voxel masks, so entities
slide along walls and land flush on sub-voxel surfaces.

- **Code:** [src/sim/physics.h](src/sim/physics.h) /
  [physics.cpp](src/sim/physics.cpp)
- **Test:** `tests/world_test.cpp` (`test_physics_lands_on_floor`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2

## Model

`physics_step(reg, stack, dt, params)` iterates `view<Transform, Velocity>`:

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

## Tunables

All on components, nothing baked into the solver: `AABB::half`, `Jump::impulse`,
`GravityAffected::scale`. Solver knobs (`maxSubsteps`, `maxStep`) live in
`PhysicsParams`.

## Connections

Reads [gravity.md](gravity.md) and the sub-voxel masks ([voxels.md](voxels.md)).
Vertical axis is owned here; horizontal velocity comes from
[controller.md](controller.md). Operates per-layer via
[world.md](world.md)/`LevelStack`.
