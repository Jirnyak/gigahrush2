# Elevators — Floor traversal & fast travel

> **Status: adjacent travel built, fast travel built on the PLANAR lattice**
> (game layer, `src/game` / `giga_game`), on top of [floors.md](floors.md) /
> [world.md](world.md). The `±1` ride with load-on-demand is implemented and
> wired to `[` / `]`. Fast travel ships as **16 planar hub cabins** (the `4×4`
> xy face of the lattice) with a discovery-unlock set and a console command; the
> full **`4×4×4` = 64-node** version — boarding a hub at a specific `iz` rather
> than any storey — is still the design below.
>
> - **Code:** [src/game/elevator.h](src/game/elevator.h) /
>   [.cpp](src/game/elevator.cpp) (`ride_elevator`, `landHub`), driven load-first
>   by [src/game/floor_stream.h](src/game/floor_stream.h)
>   (`FloorStreamer::travel` / `::teleport`);
>   [src/game/fast_travel.h](src/game/fast_travel.h) /
>   [.cpp](src/game/fast_travel.cpp) (`FastTravelState`, `fast_travel_gate`,
>   `on_fast_hub`, `fast_hub_cell`); console `fasttravel` / `ft`
>   ([src/game/console.cpp](src/game/console.cpp)).
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) (`test_elevator`,
>   `test_floor_travel`, `test_fast_travel`),
>   [tests/suite_console.inl](tests/suite_console.inl) (the gate's refusal set).

Elevators are how entities move along **W** — between floors. Because W does not
wrap ([world.md](world.md)), travel is bounded by the top and bottom of the
stack.

- **Substrate:** [world.md](world.md) (`above`/`below`), [floors.md](floors.md)
  (number indirection)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Two travel modes (hybrid boarding — owner 2026-07-28)

- **Transition (a DIRECTION, not `±1`) — built.** `FloorStreamer::travel` resolves
  the direction to the **nearest labelled floor** on that side
  (`next_labelled_floor`); on the shipped building, down from 0 reaches −8.
  Ordinary lifts may
  be ridden **from anywhere** on the floor. From floor 0 you reach −1 or +1.
  `ride_elevator` resolves the target **number** to its resident module/layer
  through the `FloorRegistry`, folds the rider's record back on the departed
  floor, and re-embodies it on the destination — carrying the player's camera
  yaw/pitch/fov + fly mode across the fresh body. The rider keeps x/y and lands
  at the **mirrored position** on the adjacent floor. `FloorStreamer::travel`
  wraps it to **load the destination on demand first** (see below).
- **Fast travel — the planar `4×4` cabins (built 2026-08-04).** A **teleport** to
  any *already-unlocked* floor number, skipping intermediate floors — usable
  **only while standing on a hub cabin** (`on_fast_hub`, an exact lattice centre
  in the two coordinates tangent to the module's gravity axis). A floor joins the
  network the first time you board a cabin on it (**discovery-unlock**, a dense
  bitset over `FloorRegistry` labels); the start floor is pre-unlocked, and the
  destination of a successful ride is unlocked too. Resolves the destination
  number through the same `FloorRegistry` chain. The landing plants the rider on
  the **same hub index** on the destination floor, so a fast ride is
  positionally stable up and down the stack. Refusals are a typed enum
  (`NotOnHub` / `Locked` / `NoFloor` / `SameFloor`), not a bool.
  Still design-only: boarding a *specific* `iz` node rather than the storey the
  rider is on, and the unlocked-floor UI menu.

## Elevators target *numbers*, not slots

An elevator stores a destination **floor number**. At use time the game resolves
`number → ModuleId → resident LayerId` through the `FloorRegistry`
([floors.md](floors.md)). If floors have been renumbered/reshuffled, the same
elevator naturally leads to whatever module now holds that number — the elevator
definition never changes.

## The 4×4×4 lattice

A **fixed, seed-independent** lattice of **64 nodes** per floor module, at cell
spacing 32 (centres `{16, 48, 80, 112}` on each axis). The geometry MODULE is what
guarantees a shaft + lobby at every node: `stamp_lattice` walks the lattice itself
and lays the corridors along its lines. Since the generic per-kind generator was
purged there is ONE room stride (4) and ONE storey height (3 cells) for every
`FloorKind` — the per-kind arithmetic below described that deleted generator.
Historically: because 32 divides every
`FloorKind`'s storey height (4/8/16/4) and room stride (8/16/32/8), a node always
lands on a slab + room line, so the generator can carve a guaranteed shaft + lobby
at every node on every floor kind. The lattice is stamped **identically on every
floor** (like the reference's fast-elevator cabins), so a player always knows
where the hubs are, and fast-travel between the same node on different floors is
positionally stable.

The same 64 nodes are **also the coarse graph for navigation** — and that half is
**built** ([nav.md](nav.md)). The lattice is a cyclic `(Z/4)³` torus graph (each
node has 6 wrapped neighbours), which is exactly what lets the baked pathfinding
avoid the reference's spanning-tree "seam" bug on the 3-torus — a tree cut over a
torus produces 240-step antipode detours. The bake (coarse graph + 64 flow fields
+ `route_step`) already runs on every floor load. The *fast-travel teleport* now
rides the planar `4×4` face of the same lattice (see the status note); only the
per-`iz` node version is still unbuilt. Full design + history:
[nav.md](nav.md), `master_prompt.md` §7 (#11), agent memory `torus-nav-baking`.

## Transition mechanics

**Resolved (adjacent travel):**

- **Landing.** The rider keeps the two coordinates tangent to the module's
  gravity axis and drops to the destination's arrival storey — a cell known to be
  air on every floor kind, written along whichever axis `floor_gravity_regime()`
  calls down ([gravity.md](gravity.md); x/y/z are equal citizens). The player's
  view direction and fly mode are preserved across the body swap.
- **Unloaded destination.** `ride_elevator` alone no-ops if the target floor
  isn't resident; `FloorStreamer::travel` closes this by calling `ensure_loaded`
  on the destination **first**, then riding, then `keep_only` to unload the floor
  just left ([floors.md](floors.md) streaming).

**Resolved (fast travel, 2026-08-04):**

- **Two-mode + boarding.** Transition = ride-from-anywhere, mirrored landing;
  fast = teleport from a hub cabin to any unlocked floor number, landing on the
  same hub index there. `landHub = -1` on every non-fast path keeps the mirrored
  coordinates, so the `±1` ride is bit-for-bit what it was.
- **Discovery-unlock.** `FastTravelState` — a 32-byte dense bitset over floor
  labels, no heap and no tick work. Boarding is the discover act; the start floor
  is pre-unlocked.
- **The gate is pure.** `fast_travel_gate` mutates nothing and hands back the
  boarding hub; the app performs the ride. Same client-proposes/app-disposes
  shape as the rest of the console seam.

**Built 2026-08-12 — the shaft menu (`L`), and the layout decision behind it.**

The manifesto ([ARCHITECTURE.md](ARCHITECTURE.md) §Манифест п.4) asked for **48
columns**: 4×4 fixed fast-travel, 4×4 procedural down, 4×4 procedural up. Owner's
decision: **keep the 16 that exist and let each column offer all three.** Three
KINDS of transition do not require three SETS of columns.

That is also the only version that leaves the lattice alone, and the number is
worth stating because it is not small: `nav::kNodes == kLatticeCount ==
kLatticeDim³`, so five nodes per axis would take the fine nav bake from **128 MiB
to 250 MiB** and break the nav-cache wire pin (`kNavCoarseWire == 13056`, sized at
64 nodes). Three separate sets would have needed a second lattice constant.

The window is rows of **console lines** — `ride down`, `ride up`, `ft <N>` — all of
which existed before it and are unchanged by it, exactly like the pause menu. It
adds a place to CHOOSE, not a mechanism, so console, keybind and window cannot
drift apart, and the ride still goes through the deferred request drain rather
than happening mid-frame. `[` and `]` keep working from anywhere.

Two seams had to be made honest first:

- `on_fast_hub` accepts only the exact centre cell — correct for *landing*
  (`fast_hub_cell` inverts it), useless for *"is the player in the shaft"*, since a
  body is 0.8 m wide in a 6 m column. Hence `fast_hub_near`, a second question with
  its own answer rather than a loosened first one.
- The shaft radii were **locals in `padic_gen.cpp`** while the gameplay test lived
  in `fast_travel.h`, so geometry and gameplay agreed at one cell out of nine by
  coincidence. They are now one constant, and a test asks the generated grid
  whether every cell the menu accepts is really air (`144 cells across 16 shafts`).

**Still to design / build:**

- Whether the unlock set survives a `samosbor` world-wipe. (It survives a SAVE
  since version 10 / SAVCLOCK — 32 bytes in `run.sav`; the older claim here that it
  "lives in `main`, not in the save" was true when written and is not now.)
- Boarding a specific **`iz` node** instead of the storey the rider is standing
  on, i.e. the third axis of the 4×4×4 lattice.
- Gravity/rule changes on arrival ([gravity.md](gravity.md),
  [floors.md](floors.md) rule-set).

## Connections

Shares its 64-node lattice with the baked [nav.md](nav.md) coarse graph; moves
along [world.md](world.md) `W`; resolves through the [floors.md](floors.md)
registry. Moves entities' `Transform::layer` ([ecs.md](ecs.md)).
