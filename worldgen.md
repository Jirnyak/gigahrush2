# Worldgen — Demo world modules

Enough world to prove the core (macro grid, sub-voxels, fields, fluid, toroidal
physics) renders and is walkable. **Not part of the engine contract** — a real
game replaces these with its own generators. Two modes ship, selected at launch.

- **Code:** [src/app/worldgen.cpp](src/app/worldgen.cpp) /
  [worldgen.h](src/app/worldgen.h)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Selecting a mode

```sh
./build/gigahrush2            # FloorStack (default)
./build/gigahrush2 floors     # FloorStack, explicit
./build/gigahrush2 maze       # Maze
```

Both are deterministic given the seed (xorshift32, bit-compatible with the
reference generator). Same seed → same world within a build.

## Cell scale

One macro cell is **~2 m** (`kCellSize = 2.0`, [types.h](src/world/types.h)),
matching the reference game's block scale, so a sub-voxel is 0.25 m and gravity /
move / jump speeds read as real m/s. Corridors are one cell (2 m) wide and
doorways two cells (4 m) tall — a human-sized collider fits.

## Mode: Maze (isotropy test bed)

A **fully-connected 3D labyrinth** — the isotropy proof. Every open cell is
reachable from every other, and the maze wraps on all three axes, so a corridor
running off one face re-enters from the opposite one (a true torus, not a box).

- **Lattice.** Macro cells at *even* coordinates are "rooms" (64³ of them); the
  odd cell between two rooms is the "wall" knocked out to join them. 128 is even,
  so the lattice tiles the torus seamlessly (room 63 → room 0 on wrap).
- **Carve.** Recursive-backtracker (growing-tree family, the same class the
  reference floor generator uses, lifted 2D→3D) with an explicit stack: from the
  current room pick a random unvisited neighbour along any of the 6 axial
  directions (wrapped), clear the wall between them, advance; backtrack when
  stuck. Result is a perfect maze.
- **Braiding.** ~18 % of wall cells are then opened to add loops and junctions,
  so it reads as a warren rather than a bare spanning tree.

This mode exists to make the torus and isotropy *visible*: fly any direction and
the structure looks the same; fly far enough on any axis and you wrap back into
the same connected maze.

## Mode: FloorStack (khrushchevka)

A **toroidal stack of building floors** — 2D apartment plans extruded to a fixed
height and stacked along Z. Because Z wraps, the top floor's ceiling *is* floor
0's slab: the stack has **no top and no bottom**.

- **Storeys.** `kFloorHeight = 4` cells (8 m) × `kFloorCount = 32` floors = 128.
  The height must divide `kMacroDim` so the stack tiles the torus exactly.
- **Slab.** Each storey opens with a solid concrete plane (the floor, and the
  ceiling of the storey below / the top storey on wrap).
- **Apartments.** Full-height interior walls on a `kRoomStride = 16` cell lattice
  (8×8 rooms per floor); the stride divides `kMacroDim` so walls are seamless
  across the x/y wrap. One-cell doorways (2 cells tall) join adjacent rooms, so
  each floor is a single connected apartment graph. Door offsets jitter per floor.
- **Stairwells.** A few 2×2 vertical shafts are punched through every slab across
  the full Z column, connecting storeys — and, via the Z wrap, the top floor back
  to floor 0.

> **Note — this is demo geometry, not the floor *module* system.** Real floors
> are chartered modules with number↔slot indirection, rule-sets, and per-floor
> content, and travel between them is via elevators along the **W** axis (which
> does *not* wrap). See [floors.md](floors.md) / [elevators.md](elevators.md).
> This mode just stacks storeys inside one 128³ world along Z to exercise the
> grid; do not confuse the Z-stack demo with the W-axis floor architecture.

## Fields

Both modes seed a little `fluid` field ([fields.md](fields.md)) near the spawn so
the fluid sim ([fluid.md](fluid.md)) and HUD controls have something to move.

## Connections

Writes the [voxels.md](voxels.md) grid and [fields.md](fields.md); exercised by
[physics.md](physics.md) (toroidal collision + position wrap). Superseded by the
game-layer generators behind [floors.md](floors.md).
