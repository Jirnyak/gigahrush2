# World & Level Stack — the 4th coordinate

A `World` is one 128³ layer; the `LevelStack` stacks layers along **W**, the 4th
coordinate. Where (x, y, z) locate a voxel inside one world, **W selects which
world**.

- **Code:** [src/world/world.h](src/world/world.h),
  [src/world/level_stack.h](src/world/level_stack.h)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L1

## World

Owns the simulation state local to one layer:

- `grid()` — the macro grid ([voxels.md](voxels.md))
- `fields()` — runtime typed fields ([fields.md](fields.md))
- `gravity()` — this layer's gravity vector ([gravity.md](gravity.md))
- `subfields()` — sparse SUB-VOXEL typed fields, the sanctioned exception to
  macro-only density; the canonical residents are `"sub_material"`
  ([destruct.md](destruct.md)) and the stain layer

Entities do **not** live in the world; they live in the shared ECS registry and
reference their layer by `Transform::layer` ([ecs.md](ecs.md)).

## LevelStack

Ordered layers indexed by `LayerId` (a storage slot). Navigation:

- `push_layer()` → append a fresh `World`, return its slot.
- `above(w)` / `below(w)` → adjacent layers, or `kInvalidLayer` at the ends.
- **x/y/z wrap (torus); W does not.** The stack has genuine top and bottom.

## Storage slot ≠ floor number

`LayerId` is a raw array index. The in-game **floor number** is a separate,
mutable label the game layer assigns — elevators travel to a *number*, which
resolves to whatever module currently occupies it, and floors can be reshuffled
at runtime. The engine's `LevelStack` deliberately knows nothing about floor
numbers, modules, or rules; that indirection lives in the game layer. See
[floors.md](floors.md).

## Planned seams (not yet built)

- **Streaming.** The engine's `LevelStack` never grows or shrinks: the game layer
  pre-allocates a small pool of slots and RECYCLES them, keeping ONE live floor at
  a time ([floors.md](floors.md), `FloorStreamer`). Genuinely async load/unload of
  distant layers is still a later seam.
- **Nested scale.** W+1 can hold a sub-world that one macro cell of layer W
  "opens into" — the level stack is the substrate for that.

## Connections

The substrate under [floors.md](floors.md). Iterated by
[physics.md](physics.md) (entities collide against `stack.layer(tr.layer)`).
