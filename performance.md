# Performance — Resource model & the O(n) contract

The single most important framing for every design decision in gigahrush2. It is
a **native C++/Vulkan desktop game** — not a web/wasm build, not a mobile port.
That changes what "optimize" means, and the whole engine leans into it.

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Rules:** [AGENTS.md](AGENTS.md) §Performance first

## The resource budget

| Resource | Budget | Consequence |
|----------|--------|-------------|
| **Disk / storage** | Effectively unlimited | Save whole worlds verbatim (all 128³ cells + their objects), the way Dwarf Fortress / Minecraft persist explored regions. Persist progressively as the player explores. No clever save compaction needed. |
| **GPU** | Effectively unlimited — **draw *and* compute** | Push geometry, overdraw, full dynamic lighting/shadows freely — *and* run every cellular field (fluid/gas/heat/pressure/light) here as async compute (see §The compute split). The GPU is not just the renderer; it is the field-simulation engine. Do not contort the data model to save GPU. |
| **RAM** | ~8 GB to spend | Generous but finite. This is the one budget that bounds the *dense* data model below. |
| **CPU** | **The real bottleneck — spent on _agents_** | Every per-tick cost matters. CPU runs the live **agents** (player + ~16k embodied NPCs/mobs: movement, swept-AABB collision, AI) — the cellular *fields* move to the GPU (§The compute split). The agent tick must stay **O(n)** in live agents. This is the constraint the whole engine is shaped around. |
| **Load time** | **Unbounded** | Loading a world/save may take as long as it needs. Do all the expensive precomputation here, not in the tick. |

## The compute split — CPU runs agents, GPU runs fields

The active floor runs two engines at once, on the two different processors, and
the split is deliberate:

- **CPU → agents.** The player and the ~16k embodied NPCs/mobs on the live floor.
  Per tick: movement, swept-AABB collision against the sub-voxel masks
  ([physics.md](physics.md)), AI/steering, and the nav lookups baked at load.
  This is **O(n) in live agents** and it is what the 8.33 ms (120 Hz) budget is
  spent on. Measured (M2 Pro, honest crowd bench — `tests/sim_bench.cpp`): 16k
  agents wandering with the *real* `physics_step` cost **10.5 ms single-thread
  (126 % of budget → one core is not enough)** but **~1.5 ms across 8–12 threads**
  (6.5×, knee at 8 = the 6 performance cores) — ~19 % of budget, headroom for
  ~86k. So the agent tick MUST be threaded; once it is, 16k agents/floor is
  comfortable.
- **GPU → fields.** Every *cellular* field — fluid, gas, heat, pressure, light,
  destruction propagation — is a dense stencil pass over the 128³ grid and runs
  as **async compute on the GPU**, not on the frame's CPU budget. The GPU is
  "effectively unlimited" for *both* draw and compute; a 128³ field is ~2 M cells
  and a handful of passes is trivial for it. The CPU only **uploads the cells it
  dirtied** (agent actions, destruction) and **reads back the sparse subset** the
  agents need to sense. Fields never enter the O(n) agent tick.

**Everything is cells.** Fluids, gases, heat, destructibility — all of it is the
same dense macro grid ([voxels.md](voxels.md)) advanced by GPU stencils, not
bespoke systems. One uniform substrate, one code path.

**The dense sub-voxel wall.** Dense fields are cheap *at macro resolution*: 128³
= 2 M cells, 2–8 MB per field, hundreds affordable in 8 GB. They are ruinous *at
sub-voxel resolution*: a 1024³ dense field (128³ × 8³) is ~1.07 **billion** cells
— ~1 GB per byte-field and hundreds of ms per pass. So **fields live on the macro
grid**; the 8³ sub-voxel layer stays a *sparse* occupancy mask / collision
boundary / GPU-resident render detail — never a second dense simulation grid.
This, not N, is the real scaling wall (see §Active-floor sizing).

## Consequences for the data model

**Prefer dense over sparse.** With unlimited disk and an 8 GB RAM budget, the old
web-era instinct to store things sparsely (lazily-allocated per-cell buffers,
hash maps of "only the interesting cells") is the wrong default. A flat, dense,
fully-populated array is simpler, more cache-friendly, branch-free to index, and
trivially serializable. Reach for dense first; only fall back to sparse when a
dense layout genuinely blows the RAM budget.

- A `128³` scalar field is ~2 M cells. One `float` field = **8 MB**; one byte
  field = **2 MB**. You can afford *hundreds* of dense fields in 8 GB. So a new
  world quantity (temperature, fog, light, blood saturation) is just another
  dense `128³` field ([fields.md](fields.md)) — never a sparse side-table.
- **Blood/urine/stains:** the 2D reference stored a lazily-allocated 16×16 RGBA
  buffer per painted cell (sparse) because it ran in a browser. Here, store stains
  as a **dense field on the *macro* grid** (128³, ~2–8 MB) — uniform, universal,
  O(1) to read/write, serializes with everything else. Do **not** promote it to a
  dense *sub-voxel* field (1024³ ≈ 1 GB — the wall above); if you need
  under-a-cell stain detail, that is a *sparse* GPU-resident render layer, not a
  second dense grid. Same reasoning for any "only some cells have it" quantity:
  dense at macro res, never dense at sub-voxel res.
- The macro grid itself is already dense SoA ([voxels.md](voxels.md)); keep new
  world state in the same shape.

**Elegance, universality, minimalism.** Data-oriented design is the aesthetic:
one flat array, one uniform rule, no special cases. A dense field that treats
every cell identically beats a sparse structure with allocation, presence
checks, and eviction — even when "most cells are empty". Fewer branches, one code
path, trivially parallelizable.

## Consequences for algorithms — bake at load, tick in O(n)

Load time is free; tick time is sacred. So **move all expensive precomputation
into world load** and bake the results into flat memory / hash tables that the
tick reads in O(1):

- **Navigation / BFS.** Never run BFS, A*, or O(W²) pathfinding *during*
  simulation. Bake nav caches, flow fields, and distance fields **once at load**
  (a full 3D BFS over the sub-voxel space is fine — load is unbounded), store
  them densely, and let the tick do O(1) lookups. When geometry mutates there are
  **two regimes** (below): a full freeze-and-rebake at load/self-assembly, and a
  cheap approximate **dirty local re-bake** for in-play destruction — never a full
  per-tick recompute of the whole floor in the hot path.
- **Lighting.** Bake light maps at load; dynamic lighting/shadows are a GPU
  concern ([render.md](render.md)), not a CPU tick cost.
- **The tick is O(n).** Each simulation step must be linear in the number of live
  entities and active cells — a single pass over contiguous arrays via EnTT
  views. No per-entity search, no nested scans, no per-frame allocation in hot
  paths. If a feature seems to need worse than O(n) at tick time, push its cost
  into the load-time bake instead.

### Two regimes of re-bake — ideal at load, dirty in play

Baking derived caches (nav/flow/distance/light) has **two regimes**, and they are
temporally disjoint — the expensive one only ever runs while the tick is stopped:

1. **Ideal full bake — at load and after self-assembly.** Unbounded, freeze
   allowed, peg all cores. The correct, complete recompute from the new geometry.
   It runs only at *special moments*: floor load, and after a **self-assembly**
   event (below). The tick is not running, so there is no budget to blow.

2. **Dirty local re-bake — during play, for destructibility.** When the player
   blows a hole in a wall mid-tick, the live floor cannot freeze. Instead, patch
   **only the affected region** of the derived caches, cheaply and approximately.
   This re-bake is explicitly **not required to be perfect** — it only has to keep
   the caches *adequately* consistent with the new geometry, with **no stall and
   no frame hitch**. Nav may be briefly stale at the edges of the hole; that is
   acceptable. The next ideal bake (next load / next samosbor) makes it exact
   again. **Eventually-consistent, never a freeze.**

Self-assembly is the designed trigger for regime 1. Occasionally and at random a
whole block of the world restructures itself (walls reflow, rooms rearrange):

```
self-assembly fires ──► freeze sim ──► mutate the block's cells/sub-voxels
                    ──► re-bake all derived caches (nav/flow/distance/light)
                    ──► resume sim
```

Because regime-1 caches are baked, not incremental, a total restructure is
*cheaper to reason about* than incremental patching would be: throw the stale bake
away and recompute from the new geometry in one unbounded off-tick pass. The tick
never sees a half-updated cache — it runs against the old bake until the event
completes, then against the new one. In-play destruction (regime 2) never gets
that luxury, so it settles for "good enough until the next full bake" — which is
exactly why it must stay local and cheap.

## Active-floor sizing — why N = 128

Only **one** floor is live at a time ([floors.md](floors.md)); depth comes from
the W-stack of many 128³ floors, not from a bigger floor. So the question is what
single N³ the *active* floor should be. **N = 128.** The table (per live floor,
66 B/cell = 2 B `CellType` + 64 B sub-voxel mask):

| N   | cells   | world span | cell RAM | one float field | render surface scan |
|-----|---------|------------|----------|-----------------|---------------------|
| 128 | 2.10 M  | 256 m      | 138 MB   | 8.4 MB          | 2.10 M / frame      |
| 160 | 4.10 M  | 320 m      | 270 MB   | 16 MB           | 4.10 M / frame      |
| 192 | 7.08 M  | 384 m      | 467 MB   | 28 MB           | 7.08 M / frame      |
| 256 | 16.8 M  | 512 m      | 1.11 GB  | 67 MB           | 16.8 M / frame      |

**What breaks first, in order:**

1. **The renderer's O(N³) surface scan.** The cube pass walks every cell each
   frame to emit faces ([render.md](render.md)); at 256 that is 16.8 M cells ×
   60 fps. This gates before anything else, and lifting it needs a chunked /
   dirty-region mesher.
2. **Sub-voxel mask RAM.** 138 MB → 1.11 GB going 128 → 256. Fine for *one* live
   floor; fatal if several were resident.
3. *(not GPU fields)* — a dense macro field even at 256³ is 67 MB and a few GPU
   passes, so **the GPU does not gate N**. Nor do agents: 16k is a population
   choice, not an N choice (§The compute split).

So N = 128 is the sweet spot: 256 m across, 138 MB, both the render scan and the
RAM comfortable, matching the reference's proven one-floor-live model. Going to
256 is possible *only* behind a chunked renderer, and buys floor *size*, not more
simulation — which we do not need, because depth is the W-stack. The real scaling
wall is the **dense sub-voxel field** (§The compute split), not N.

## Why this matters at scale

The target is a large world (128³ macro cells × 8³ sub-voxels ≈ a billion
sub-cells) with a large NPC population ([macrosim.md](macrosim.md)). Only a dense
data model baked at load and ticked in O(n) holds 60 FPS render + a fast sim tick
on a CPU-bound machine. Every "store it sparse to save memory" or "recompute it
each frame to save load time" shortcut trades the cheap resource (disk/RAM/load)
for the scarce one (CPU tick) — exactly backwards.

## Connections

Shapes [voxels.md](voxels.md) (dense SoA grid), [fields.md](fields.md) (dense
typed fields), [macrosim.md](macrosim.md) / [npcs.md](npcs.md) (baked macro
model, O(n) tick), and the nav/lighting bakes referenced in
[floors.md](floors.md). Governed by [AGENTS.md](AGENTS.md) §Performance first.
