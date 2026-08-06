# Diffusion — Danger / scent fields

A scalar `float` field (default `"danger"`) that **spreads and fades** over the
macro grid: a deterministic, double-buffered diffusion step relaxes each cell
toward its open neighbours (the discrete heat equation) while a fraction
evaporates every step. A source — spilled blood, a gunshot's noise, a fear
pheromone — bleeds outward through the walkable void and dies away, giving agents
a **gradient to flee up or seek down** with *no pathfinding*.

- **Code:** [src/sim/diffusion.h](src/sim/diffusion.h) /
  [.cpp](src/sim/diffusion.cpp)
- **Test:** [tests/world_test.cpp](tests/world_test.cpp) (`test_diffusion`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2

It is the sibling of [fluid.md](fluid.md): the same field substrate, the same
deterministic double-buffered pattern — but relaxation + decay instead of gravity
+ mass conservation.

## Model

`diffusion_step(world, params)` advances the named field one step:

1. Read the whole field from one buffer, write the next into a second — so the
   result is **independent of iteration order** (reproducible across runs and
   platforms, `master_prompt.md` §11). Buffers swap at the end.
2. For each **open** cell (`!mask.full()`, the same walkability
   [nav.md](nav.md) uses): a discrete Laplacian over its 6 wrapped neighbours,
   `acc += Σ (neighbour − c)`, then `next = (c + rate·acc) · (1 − decay)`.
3. A **wall** (fully-solid cell) is held at 0 and skipped in every neighbour sum —
   which is exactly a **no-flux (Neumann) boundary**: danger cannot cross
   structure, so it **pools in rooms and leaks through doorways** instead of
   bleeding through walls.
4. Values below `minLevel` clamp to 0, keeping the field tidy (no infinite
   residue tail).

All three axes **wrap** — the field is periodic on the torus like everything else
([world.md](world.md)).

## Stability

Explicit 6-neighbour diffusion is stable only while `rate · 6 ≤ 1`, so keep
`rate ≤ ~1/6 (0.166)`. The default **`0.15`** leaves headroom against the
checkerboard mode (worst-case per-step update factor 0.8 < 1), so the field can
never blow up. `test_diffusion` asserts monotone non-increasing total mass over 50
steps as the guardrail.

## Tunables (`DiffusionParams`)

| Field | Default | Meaning |
|-------|---------|---------|
| `field` | `"danger"` | which `float` field to diffuse (run several by name) |
| `rate` | `0.15` | diffusion coefficient per step — larger spreads faster; keep ≤ ~1/6 |
| `decay` | `0.02` | fraction that evaporates per step (the scent fades) |
| `minLevel` | `1e-4` | clamp residues below this to 0 |

## The gradient — how agents use it

```cpp
vec3 g = diffusion_gradient(field, grid, x, y, z);
// danger rises along +g  →  an agent FLEES along −g
```

A wrapped central difference over **open** neighbours per axis, falling back to a
one-sided difference when one side is walled (that side carries no flux) and to 0
when both sides are walls. Cheap and allocation-free — safe to call per agent on
the tick. This is the flee vector the utility-AI (#12) is *written* to steer by — but
nothing wires `diffusion_tick` into the app loop, so `danger` is **null in the
shipped game**, the threat term reads 0 and no body ever flees
([src/app/main.cpp](src/app/main.cpp) says so at the call site).

## What it is *not*

Three distinct notions of "danger" must not be conflated:

- **This diffusion field** — a *dynamic, spatial, runtime* scalar that spreads and
  fades. The flee/seek gradient.
- **Baked navigation** ([nav.md](nav.md)) — *static* shortest-path flow fields.
  Diffusion is emphatically **not** pathfinding; it has no goal and no route.
- **The authored per-floor danger *rating*** (`FloorSpec.hostility`,
  [floors.md](floors.md)) — a *designer constant* that scales mob spawn count/tier.
  Nothing to do with the field.

## Where it runs

`diffusion_step` runs on a coarse cadence derived FROM the sim tick, not per
tick: `kDiffusionSweepTicks = 25` at `kSimHz = 125` is exactly **5 sweeps/s**
([src/sim/diffusion.h](src/sim/diffusion.h)). The reference's `danger_field.ts`
runs ~2×/s, but 125 has only the divisors 1, 5, 25 and 125, so 5/s is the
nearest cadence that stays integral and keeps every decay figure exact. Not per
frame. As a *cellular field* it belongs, like fluid/gas/heat, on the **GPU as an
async-compute stencil** ([performance.md](performance.md) §The compute split); the
current CPU implementation is the deterministic reference the GPU port must match.
The sacred CPU agent tick never pays for the diffusion sweep.

## Connections

Stored as a [fields.md](fields.md) `float` field; blocked by [voxels.md](voxels.md)
masks (no-flux walls); periodic on the [world.md](world.md) torus; the gradient
feeds the future utility-AI (#12) alongside the [nav.md](nav.md) flow fields.
Deterministic double-buffering mirrors [fluid.md](fluid.md).
