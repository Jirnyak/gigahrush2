# ECS — Entities, components, systems

The engine uses **EnTT** directly, aliased to `giga::Registry` / `giga::Entity`
so call sites don't leak the third-party type. Built with `ENTT_NOEXCEPTION` to
match the core's `-fno-exceptions`.

- **Code:** [src/ecs/registry.h](src/ecs/registry.h),
  [src/ecs/components.h](src/ecs/components.h)
- **Systems:** [src/sim/](src/sim)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L0

## Universal components

These are the *engine-core* components — the minimum to move things and view
the world. All POD. A game adds its own (health, faction, inventory) alongside.

| Component | Purpose |
|-----------|---------|
| `Transform` | `pos` (world units) + `layer` (which W-layer) |
| `Velocity` | linear velocity |
| `AABB` | half-extents for collision |
| `GravityAffected` | opt-in to layer gravity; `grounded` set by physics |
| `Jump` | jump impulse + `wants_jump` request |
| `CameraTag` | yaw/pitch/fov/eyeOffset — marks the view entity |
| `Controller` | move speed, `wishDir` intent, `fly` toggle |

## The player is not special

There is no player class. The "player" is whichever entity currently holds a
`CameraTag` + `Controller` (+ physics components). Attach them to a bird, a
bullet, or a debug free-cam and it just works. `input` writes intent onto that
entity; `camera` reads the view off it; `controller` and `physics` move it.

## System conventions

- Free functions, `*_step(Registry&, …, float dt)`, over EnTT views
  (`reg.view<A, B>()`). No hidden state.
- Order per tick: `input.apply → controller_step → physics_step → fluid_step`,
  then `compute_camera` for rendering. See [ARCHITECTURE.md](ARCHITECTURE.md)
  §Simulation loop.
- Spawn via factory functions; never construct entities ad-hoc across the
  codebase.
- Data-less tags use `view<Tag>`.

## Connections

Components consumed by every system in [physics.md](physics.md),
[controller.md](controller.md), [camera.md](camera.md). Game systems
([monsters.md](monsters.md), [npcs.md](npcs.md)) add components here.
