# Navigation — Baked lattice, flow fields & routing

> **Status: built AND consumed** (сверка 2026-08-23; строки про «no runtime
> consumer» были ложью с эпохи #12). Потребители ходят по nav каждый тик:
> `src/game/wander.cpp:120,382` (`coarse_next` + `fine.at`) и
> `src/game/ai.cpp:1103` `ai_patrol_step(reg, coarse, fine, …)`. Fast-travel
> подключён (`src/game/fast_travel.cpp`). «Dirty local re-bake» построен другой
> формой: полный фоновый ребейк со свапом — `RebakeScheduler`
> (`src/game/rebake.h`, могила `nav::AsyncBake`). `master_prompt.md` удалён —
> см. CANON.md + markoaudit/plans/.
>
> - **Code:** [src/world/lattice.h](src/world/lattice.h) (the fixed node set),
>   [src/world/nav.h](src/world/nav.h) / [.cpp](src/world/nav.cpp) (the bake +
>   query + `route_step`), [src/core/jobs.h](src/core/jobs.h) (`parallel_for`,
>   the bake-time job system), [src/game/nav_cache.h](src/game/nav_cache.h) /
>   [.cpp](src/game/nav_cache.cpp) (disk memoization),
>   [src/game/floor_stream.h](src/game/floor_stream.h) (`FloorNav`, `nav_at`,
>   `set_nav_cache_dir`).
> - **Tests:** [tests/world_test.cpp](tests/world_test.cpp) (`test_parallel_for`,
>   `test_nav_coarse` + `test_nav_fine` — all-air no-seam bakes, determinism) and
>   [tests/game_test.cpp](tests/game_test.cpp) (`test_nav_realfloor`,
>   `test_nav_fine_realfloor`, `test_route_realfloor`, `test_streamed_nav`,
>   `test_nav_cache_roundtrip`, `test_streamed_nav_cache`).
> - **Design rationale + history:** `master_prompt.md` §7 (#11) and agent memory
>   `torus-nav-baking` (the full decision log).

Pathfinding is **baked at load and O(1) per tick** — the resource model
([performance.md](performance.md)) forbids running BFS/A\* in the hot path. A
floor's geometry is a pure `fn(seed, number, kind)`, so its nav is too: bake once
per load (peg all cores, load time is unbounded), then every agent reads flat
arrays.

- **Substrate:** [voxels.md](voxels.md) (the `8³` sub-voxel masks that define
  walkability), [floors.md](floors.md) (streaming — the only bake boundary today),
  [elevators.md](elevators.md) (the same 64 nodes are the fast-travel hub set).
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2 (baked fields).

## The 4×4×4 lattice — one structure, two jobs

A **fixed, seed-independent** set of **64 nodes** per floor at cell spacing 32
(centres `{16, 48, 80, 112}` on each axis). Because 32 divides every `FloorKind`'s
storey height (4/8/16/4) and room stride (8/16/32/8), a node always lands on a
slab + room line — so `floor_gen` can carve a guaranteed shaft + lobby at every
node on every kind. Pure `constexpr` in [src/world/lattice.h](src/world/lattice.h)
(dependency-free core geometry); the game layer attaches "elevator hub" meaning
([elevators.md](elevators.md)).

The lattice is a **cyclic `(Z/4)³` torus graph** — each node has 6 wrapped
neighbours (`lattice_neighbor(id, dir)`, dirs `0..5 = −x,+x,−y,+y,−z,+z`). That
cyclic shape is load-bearing: it is exactly what lets the baked pathfinding avoid
the reference's spanning-tree **"seam" bug** (a tree/forest cut over a 3-torus
severs every cycle, so antipodal point-pairs detour ~240 cells through the tree
root, and re-picking the tree flaps the path). See **Torus rules** below.

## Three baked layers

### L0 — carve (in `floor_gen`)
`generate_floor` carves the 64 nodes deterministically on every kind: a shaft
through the full height (Z wraps, so the top storey links back to storey 0), a
lobby opening, and coloured hub pads at the four lattice z-levels. This replaced
the old *random* shafts, so the lattice is identical on every floor.

### L1 — coarse graph (`bake_coarse` → `CoarseGraph`)
`bake_coarse(grid, out)` runs **64 wrapped BFS** (one per node, parallel across
nodes via `parallel_for`) through the *real* geometry to get edge weights, then
Floyd–Warshall for all-pairs shortest paths. Result (`src/world/nav.h`):

```
CoarseGraph { Dist edge[64][6];  Dist dist[64][64];  uint8 next[64][64]; }
```

`Dist = uint16`, `kUnreachable = 0xFFFF`. Query `coarse_next(g, from, to)` → the
next **node** to step to (O(1)). A few KB total. Walkable ≡ `!mask.full()` (a
fully-solid macro cell blocks; anything partially carved is passable — the same
rule diffusion and physics use).

### L2 — fine flow fields + nearest-node (`bake_fine` → `FineNav`)
`bake_fine(grid, out)` produces, in one parallel pass:

- **64 flow fields**, node-major `uint8 flow[64 · 128³]` = **128 MiB**. Each byte
  is the *direction of the next step toward that node*: `0..5` indexes
  `kNavDir[6][3]` (`−x,+x,−y,+y,−z,+z`; `reverse(d) == d^1`), `kFlowArrived = 6`
  at the node cell, `kFlowNone = 0xFF` for wall/unreachable. Because each field is
  a BFS **parent chain**, following the arrows strictly shortens distance and
  always arrives — no cycles, no A\* at runtime. Query `FineNav::at(node, x, y, z)`
  (wraps coords).
- **A nearest-node field**, `uint16 nearest[128³]` = **2 MiB**: one multi-source
  BFS painting every open cell with its closest node id (a geodesic Voronoi
  anchor). `FineNav::nearest_node(x, y, z)`. This is what lets an agent standing
  **anywhere** enter the route without knowing which hub it is near.

Total L2 ≈ **130 MiB/floor** — precisely the reference's wished-for "64-anchor
packed flow fields" that it abandoned for browser memory. On native + ~8 GB RAM
(one floor live) we can afford it.

## `route_step` — the O(1)/tick entry point

```cpp
uint8_t d = nav::route_step(coarse, fine, fromCell, toCell);
// d ∈ 0..5  → step kNavDir[d]     (a −x/+x/−y/+y/−z/+z move)
// d == kFlowArrived (6)           → already at / adjacent to the goal hub
// d == kFlowNone   (0xFF)         → unreachable from here
```

It composes the two layers: find the goal's **nearest anchor** node, guard on
coarse **reachability** (`dist != kUnreachable`), then either follow the coarse
`next`-hop chain toward that anchor (while still crossing hub cells) or descend
the current anchor's fine flow field. A move macro-AI (#12) calls this per agent
per tick — a single array lookup, no search.

`test_route_realfloor` proves the contract on a real floor: every node cell's
`nearest_node` is itself; routes connect on a dense Residential floor; and on a
sparse Derelict floor `route_step` reaches the goal **iff** the coarse graph says
it is reachable (`dist != kUnreachable`) — otherwise it honestly returns
`kFlowNone`.

## Where the bake runs — streaming integration

The only bake boundary today is **floor load**. `FloorStreamer::ensure_loaded`
([floors.md](floors.md)), right after `generate_floor`, builds a per-module

```cpp
struct FloorNav { nav::CoarseGraph coarse; nav::FineNav fine; };
```

held by `std::unique_ptr` (the streamer is stack-allocated; 256 × ~13 KB coarse
graphs would bloat it — the ~130 MiB fine field is heap either way). `unload`
frees it; `nav_at(reg, number)` returns it (or `nullptr` if the floor isn't
resident). Bake cost is a few hundred ms of all-core BFS off the hot path.

**Opt-in disk cache** ([src/game/nav_cache.h](src/game/nav_cache.h)): call
`FloorStreamer::set_nav_cache_dir(dir)` (empty = disabled, the default) and each
cold load first tries `load_nav_cache`, baking + `save_nav_cache` only on a miss.
The blob is a versioned binary (`nav_f%d_k%u_s%08x.bin`, magic `GHNAVBK1`) whose
header validates `(number, kind, seed, nodes, section sizes)` — any mismatch is
rejected and the floor re-bakes. This is memoization the browser reference could
never do (sandbox); geometry is a pure function, so a floor need be baked **once
ever**. It is `-fno-exceptions`-clean (C stdio + `std::filesystem` `ec`-overloads).

## Determinism

Every bake is **bit-identical on re-run**. The 64 BFS are parallelized *across*
nodes, never *inside* one BFS, and each writes a disjoint slice (its own row of
`edge`/`dist`, its own flow field), so the result is independent of thread
scheduling. `world_test` re-bakes and `memcmp`s; `test_streamed_nav` proves the
streamer's bake is bit-identical to a standalone one; `test_streamed_nav_cache`
proves the *read* path by doctoring a sentinel (`dist[0][1] = 0x0BAD`, impossible
for adjacent connected nodes) into the cache file and asserting it survives reload.

## Torus rules (do not break these)

The reference proved these the hard way (its `problems.md`, `[RESOLVED]`):

1. **Never a tree/forest over the torus** — only the cyclic lattice graph +
   per-source BFS fields. A spanning tree cuts cycles → antipode detours + path
   flapping.
2. **Never re-bake structure per tick** — bake at boundaries (load, post-samosbor
   stitch); a consumer smooths staleness with hysteresis, it does not re-bake.
3. **The toroidal `wrap_delta` heuristic is for A\* ordering only** — never a path
   metric. At the antipode the "shortest arrow" lies; the baked BFS fields carry
   the truth.

## Connectivity caveat (honest)

The L0 carve guarantees **vertical** node links (the shafts, intact even on a
decayed Derelict floor). Full **horizontal** 64-node connectivity relies on the
floor's own rooms/lobbies: proven fully connected on dense Residential, **not**
structurally guaranteed on sparse/Derelict — where the coarse graph then correctly
reports `kUnreachable` and `route_step` honestly returns `kFlowNone`. That is
*sound* for nav, but may not be the gameplay-desired "every hub reachable." The
deferred fix (owner's call) is to carve thin corridors along lattice edges in
`floor_gen` — a geometry/visual change.

## Still to build

- **Dirty local re-bake** — the cheap, approximate in-play patch for
  destructibility: re-bake only the cells a geometry mutation touched, no freeze,
  eventually-consistent until the next full bake ([performance.md](performance.md)
  §Two regimes). The one unbuilt piece of the bake story.
- **The consumer (#12).** Utility-AI that actually calls `route_step` +
  [diffusion.md](diffusion.md)'s flee gradient, making the visible crowd move.
- **Fast-travel elevator hookup** — teleport between unlocked lattice nodes
  ([elevators.md](elevators.md)); the node set is baked, the travel is not wired.

## Connections

Reads [voxels.md](voxels.md) masks for walkability; baked at the
[floors.md](floors.md) streaming boundary; shares its 64 nodes with
[elevators.md](elevators.md); feeds the future utility-AI alongside the
[diffusion.md](diffusion.md) flee field. Uses [src/core/jobs.h](src/core/jobs.h)
for the all-core bake, off the sacred agent tick ([performance.md](performance.md)).
