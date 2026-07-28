# Fluid — Cellular liquid

Liquid stored as a runtime **field** and stepped with a deterministic,
**mass-conserving** cellular rule that pools on sub-voxel terrain.

- **Code:** [src/sim/fluid.h](src/sim/fluid.h) / [fluid.cpp](src/sim/fluid.cpp)
- **Test:** `tests/world_test.cpp` (`test_fluid_conserves_mass`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2

## Model

`fluid_step(world, params)` advances the named `float` field (default `"fluid"`)
one step:

1. Each cell sends what it can **straight down** (toward −gravity's opposite);
   solid sub-voxels below block the flow, so liquid rests on terrain instead of
   falling through it.
2. Any remainder **spreads** to lower/equal neighbours, scaled by `viscosity`.

The rule is **double-buffered** — reads one buffer, writes another — so the
result is independent of iteration order and reproducible across runs (within a
build). `minFlow` ignores sub-threshold dribbles.

## Tunables (`FluidParams`)

`field` (which float field), `maxPerCell` (a full cell of liquid), `minFlow`,
`viscosity` (fraction of excess that spreads per step).

## Why a field, not a fixed grid

Fluid is just a registered [field](fields.md) — proving the field system carries
real simulation state, not only static overlays. A game can run several
independent fluids (water, lava, gas) by naming different fields.

**Where it runs.** `fluid_step` is the CPU prototype (throttled, maze demo only).
As a *cellular field* it belongs on the **GPU as an async-compute stencil** like
every other field — fluids, gases, and heat share the same substrate and the same
destination ([performance.md](performance.md) §The compute split). The CPU agent
tick never pays for it.

## Connections

Uses [fields.md](fields.md) for storage, [voxels.md](voxels.md) masks for
blocking, and [gravity.md](gravity.md) for flow direction. The cube pass tints
cells by this field ([render.md](render.md)).
