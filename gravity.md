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

## Uses

Per-layer gravity (each `World` owns its own `GravityField`) means a floor
module can flip or tilt gravity as its own rule. Radial gravity (planetoids),
sideways gravity (wall-walking), or zero-g (leave `GravityAffected` off the
entity) all fall out of the same vector.

## Connections

Read by [physics.md](physics.md). Owned per-layer by [world.md](world.md); a
[floor module](floors.md) may install a `region` override as part of its
rule-set.
