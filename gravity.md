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

## Ballistics reads it too — and the shape of getting that wrong

A projectile launch is one vector equation. Under a constant acceleration `a`,
a shot is at `r0 + v0*T + 0.5*a*T^2`, so the launch that arrives after `T` is

    v0 = delta/T - 0.5*a*T

There is no axis in it. `spawn_projectile` carried that solution written out in
a basis where `a` is along -Z until 2026-08-13 — `sqrt(dx*dx + dy*dy)` for the
horizontal distance, `dz` for the vertical one, and the whole `+0.5*g*T`
compensation on Z. Three quantities, each meaning something the axis letter only
happens to spell under `NegZ`:

| written | actually means |
|---|---|
| `sqrt(dx*dx + dy*dy)` | length of delta projected onto the plane normal to **g** |
| `dz` | `dot(delta, up)`, where `up = -g/|g|` |
| `+0.5*g*T` on Z | the compensation along `up` |

Under `PosX` that puts the whole correction on an axis with no acceleration and
none on the axis that has it — a miss of order `0.5*g*T^2`.

**The lesson generalises past this one function, which is why it is written down
here and not only in the commit.** The isotropic form is SHORTER than the
anisotropic one: one projection instead of three separate expressions. Code that
looks longer because it "handles all three axes" is usually code that has not
found the projection yet.

**And it is not enough for the integrator to be right.** `projectile_step` had
been pulling along the real vector since 2026-08-12 while the launch still aimed
at Z, so the shot FLEW honestly and was AIMED in the wrong frame. Half a system
in the right frame reads as working, and does, on the one regime everything ships
with. Ask both halves.

## Connections

Read by [physics.md](physics.md) and by combat's launch and blast paths
([Docs/specs/09](Docs/specs/09_COMBAT_BALLISTICS_AND_RPG.md) §2.2). Owned
per-layer by [world.md](world.md); a [floor module](floors.md) may install a
`region` override as part of its rule-set.
