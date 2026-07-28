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
| **GPU** | Effectively unlimited | Push geometry, overdraw, full dynamic lighting/shadows freely. The renderer is *not* the bottleneck; do not contort the data model to save GPU. |
| **RAM** | ~8 GB to spend | Generous but finite. This is the one budget that bounds the *dense* data model below. |
| **CPU** | **The real bottleneck** | Every per-tick cost matters. The simulation must stay **O(n)** in the live entity/cell count. This is the constraint the whole engine is shaped around. |
| **Load time** | **Unbounded** | Loading a world/save may take as long as it needs. Do all the expensive precomputation here, not in the tick. |

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
  buffer per painted cell (sparse) because it ran in a browser. Here, prefer a
  **dense sub-voxel stain field** over the grid — uniform, universal, O(1) to
  read/write, and it serializes with everything else. Same reasoning for any
  "only some cells have it" quantity.
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
  them densely, and let the tick do O(1) lookups. When geometry mutates, **freeze
  the sim, re-bake, then resume** — never incremental per-tick recompute in the
  hot path.

### Self-assembly — the deliberate re-bake event

Geometry mutation is not just an edge case here — it is a **designed
phenomenon**. Occasionally and at random, a **self-assembly** event fires: a
whole block of the world dynamically restructures itself (walls reflow, rooms
rearrange). This is exactly the re-bake trigger above, by design:

```
self-assembly fires ──► freeze sim ──► mutate the block's cells/sub-voxels
                    ──► re-bake all derived caches (nav/flow/distance/light)
                    ──► resume sim
```

Because the caches are baked, not incremental, a total restructure is *cheaper to
reason about* than incremental patching would be: throw the stale bake away and
recompute from the new geometry in one unbounded off-tick pass. The tick never
sees a half-updated cache — it runs against the old bake until the event
completes, then against the new one. Scope the re-bake to the affected region
where possible, but a full re-bake is always the correct fallback.
- **Lighting.** Bake light maps at load; dynamic lighting/shadows are a GPU
  concern ([render.md](render.md)), not a CPU tick cost.
- **The tick is O(n).** Each simulation step must be linear in the number of live
  entities and active cells — a single pass over contiguous arrays via EnTT
  views. No per-entity search, no nested scans, no per-frame allocation in hot
  paths. If a feature seems to need worse than O(n) at tick time, push its cost
  into the load-time bake instead.

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
