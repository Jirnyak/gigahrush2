# Gravity — Vector gravity

Gravity is a **3D acceleration vector**, not a scalar "down". Invert it, tilt
it, or make it radial per region.

- **Code:** [src/world/gravity.h](src/world/gravity.h)
- **Consumer:** [src/sim/physics.cpp](src/sim/physics.cpp)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L1

## Model

```cpp
struct GravityField {
    vec3 global{0, 0, -9.81f};                 // default downward pull
    RegionFn region = nullptr;                 // optional per-position override
    vec3 at(vec3 pos) const;                   // region ? region(*this,pos) : global
};
```

- `region` is a plain function pointer (not `std::function`) to stay
  allocation- and exception-free. Default returns `global` everywhere.
- Physics reads `world.gravity().at(pos)` and integrates
  `vel += accel * scale * dt`. "Up" for jump and ground detection is derived as
  `normalize(-accel)`, so jumping and standing work under *any* gravity
  direction, not just −Z.

## The quantized frame — what a module DECLARES

Physics integrates the full vector, but most systems only need to know *which
way is down*, cheaply and identically everywhere. That is `GravityRegime`: eight
values (`±X`, `±Y`, `±Z`, `Zero`, `Custom`). A floor module **declares** its
regime; a consumer resolves "down" once and keeps its arithmetic axis-generic.
Two resolvers live beside the enum:

| Helper | Gives | Used by |
|---|---|---|
| `regime_down(r)` | one cell STEP toward down | ground probes, fluid, nav |
| `regime_frame(r)` | the frame by AXIS NUMBER: `{axis, upSign, tanA, tanB, pull}` | anything that hugs a face — antourage's walkers |
| `gravity_frames(field, out)` | every frame the field declares, 1 or 6 | bakers that can dress more than one face |

`pull` is the honest half: **geometry is a frame question, sag is a force.**
Which face a pipe hugs or a curtain is nailed to is answerable in any regime;
whether a cable *sags* is not — under `Zero` it hangs straight, and its rest
length is the segment itself so the verlet has nothing to buckle.

`Zero` declares no axis at all. Rather than decreeing one (the silent mistake
frame-blind code makes), `gravity_frames` hands back **all six faces**: with no
pull, "ceiling" and "floor" are the same word. A consumer that spends a budget
per frame divides it by the count — the same total dressing spread over the
faces the world actually has, never six times as much of it. `Custom` does what
its own doc-comment demands and falls back to the vector: its dominant axis
names the frame (a genuinely still `Custom` field lands on the six-face answer).

The law this serves is isotropy: x/y/z are equal citizens on the torus, and
gravity is the only thing that ever breaks the symmetry — emergently, never
structurally. See [antourage.md](antourage.md) for the first module written this
way, and `floor_cell` ([floors.md](floors.md)) for the placement half.

## Uses

Per-layer gravity (each `World` owns its own `GravityField`) means a floor
module can flip or tilt gravity as its own rule. Radial gravity (planetoids),
sideways gravity (wall-walking), or zero-g (leave `GravityAffected` off the
entity) all fall out of the same vector.

## Connections

Read by [physics.md](physics.md). Owned per-layer by [world.md](world.md); a
[floor module](floors.md) may install a `region` override as part of its
rule-set.
