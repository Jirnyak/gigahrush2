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
| `CameraTag` | yaw/pitch/`fovY`/eyeOffset — marks the view entity |
| `Controller` | move speed, `wishDir` intent, `fly` toggle |
| `Mass` | kg — THE universal physical context (`E = mv²/2`, `p = mv`) |
| `Impact` | the speed a collision killed this step; the game layer consumes and removes it |
| `SelfIntegrating` | tag: "I move myself" — `physics_step` EXCLUDES these (projectiles) |
| `NoClip` | tag: integrate + wrap, no gravity, no jump, no sweep (debug) |
| `Renderable` | cosmetic body colour for the body pass; the sim never reads it |
| `AngularVelocity` / `Rotation` | tumbling spin, integrated by `physics_step` |
| `StaticPropTag` / `DynamicBodyTag` / `PropMeshTag` | prop render-path filters |

Ten of those seventeen were missing from this table until 2026-08-06, and three
of them (`SelfIntegrating`, `NoClip`, `Impact`) change what `physics_step` does —
so the table is the contract, not a sample.

## The player is not special

There is no player class. The "player" is whichever entity currently holds a
`CameraTag` + `Controller` (+ physics components). Attach them to a bird, a
bullet, or a debug free-cam and it just works. `input` writes intent onto that
entity; `camera` reads the view off it; `controller` and `physics` move it.

## System conventions

- Free functions, `*_step(Registry&, …, float dt)`, over EnTT views
  (`reg.view<A, B>()`). No hidden state.
- Order per tick: `input.apply → controller_step → physics_step`,
  (`fluid_step` is NOT in the tick — see [fluid.md](fluid.md)),
  then `compute_camera` for rendering. See [ARCHITECTURE.md](ARCHITECTURE.md)
  §Simulation loop.
- Spawn via factory functions; never construct entities ad-hoc across the
  codebase.
- Data-less tags use `view<Tag>`.

## Connections

Components consumed by every system in [physics.md](physics.md),
[controller.md](controller.md), [camera.md](camera.md). Game systems
([monsters.md](monsters.md), [npcs.md](npcs.md)) add components here.
