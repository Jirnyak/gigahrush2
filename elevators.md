# Elevators — Floor traversal & fast travel

> **Status: adjacent travel built** (game layer, `src/game` / `giga_game`), on
> top of [floors.md](floors.md) / [world.md](world.md). The `±1` ride with
> load-on-demand is implemented and wired to `[` / `]`; the **`4×4×4` = 64-node
> fast-travel lattice** is designed (below) but not yet built.
>
> - **Code:** [src/game/elevator.h](src/game/elevator.h) /
>   [.cpp](src/game/elevator.cpp) (`ride_elevator`), driven load-first by
>   [src/game/floor_stream.h](src/game/floor_stream.h) (`FloorStreamer::travel`).
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) (`test_elevator`,
>   `test_floor_travel`).

Elevators are how entities move along **W** — between floors. Because W does not
wrap ([world.md](world.md)), travel is bounded by the top and bottom of the
stack.

- **Substrate:** [world.md](world.md) (`above`/`below`), [floors.md](floors.md)
  (number indirection)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Two travel modes (hybrid boarding — owner 2026-07-28)

- **Transition (`±1`) — built.** Ordinary lifts move one floor at a time and may
  be ridden **from anywhere** on the floor. From floor 0 you reach −1 or +1.
  `ride_elevator` resolves the target **number** to its resident module/layer
  through the `FloorRegistry`, folds the rider's record back on the departed
  floor, and re-embodies it on the destination — carrying the player's camera
  yaw/pitch/fov + fly mode across the fresh body. The rider keeps x/y and lands
  at the **mirrored position** on the adjacent floor. `FloorStreamer::travel`
  wraps it to **load the destination on demand first** (see below).
- **Fast travel — the `4×4×4` lattice (designed, not built).** A **teleport** to
  any *already-unlocked* `(floor number, lattice node)`, skipping intermediate
  floors — usable **only while standing on a lattice node** (the "cabins"). A
  floor joins the fast-travel network the first time you open a fast elevator
  while on it (**discovery-unlock**); the start floor is pre-unlocked. Resolves
  the destination number through the same `FloorRegistry` chain.

## Elevators target *numbers*, not slots

An elevator stores a destination **floor number**. At use time the game resolves
`number → ModuleId → resident LayerId` through the `FloorRegistry`
([floors.md](floors.md)). If floors have been renumbered/reshuffled, the same
elevator naturally leads to whatever module now holds that number — the elevator
definition never changes.

## The 4×4×4 lattice

A **fixed, seed-independent** lattice of **64 nodes** per floor module, at cell
spacing 32 (centres `{16, 48, 80, 112}` on each axis). Because 32 divides every
`FloorKind`'s storey height (4/8/16/4) and room stride (8/16/32/8), a node always
lands on a slab + room line, so the generator can carve a guaranteed shaft + lobby
at every node on every floor kind. The lattice is stamped **identically on every
floor** (like the reference's fast-elevator cabins), so a player always knows
where the hubs are, and fast-travel between the same node on different floors is
positionally stable.

The same 64 nodes are **also the coarse graph for navigation.** The lattice is a
cyclic `(Z/4)³` torus graph (each node has 6 wrapped neighbours), which is exactly
what lets baked pathfinding avoid the reference's spanning-tree "seam" bug on the
3-torus — a tree cut over a torus produces 240-step antipode detours. See the nav
bake design in `master_prompt.md` §7 (#11) / agent memory `torus-nav-baking`.

## Transition mechanics

**Resolved (adjacent travel):**

- **Landing.** The rider keeps its x/y and drops to the destination's arrival
  storey (a cell z known to be air on every floor kind); the player's view
  direction and fly mode are preserved across the body swap.
- **Unloaded destination.** `ride_elevator` alone no-ops if the target floor
  isn't resident; `FloorStreamer::travel` closes this by calling `ensure_loaded`
  on the destination **first**, then riding, then `keep_only` to unload the floor
  just left ([floors.md](floors.md) streaming).

**Resolved (design, 2026-07-28):**

- **Two-mode + boarding.** Transition = ride-from-anywhere, mirrored-x/y landing;
  fast = teleport from a lattice node to any unlocked `(number, node)`.
- **Fast-travel lattice.** Fixed 4×4×4 = 64 nodes; doubles as the nav coarse-graph.

**Still to design / build:**

- Fast-lift **discovery-unlock** set + its UI (a menu of unlocked floors/nodes),
  and whether the set persists across a `samosbor` world-wipe.
- Gravity/rule changes on arrival ([gravity.md](gravity.md),
  [floors.md](floors.md) rule-set).
- The **baked navigation** over the lattice (`master_prompt.md` §7 #11).

## Connections

Drives navigation over [world.md](world.md); resolves through the
[floors.md](floors.md) registry. Moves entities' `Transform::layer`
([ecs.md](ecs.md)).
