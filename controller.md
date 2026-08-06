# Controller — intent to velocity

Turns input intent (`Controller::wishDir`, expressed in the camera's local
frame) into world-space velocity. The same system steers whichever entity holds
`CameraTag` **and** `Controller` — the player today, a possessed resident
tomorrow, or a debug free-cam. It is camera-holder-only BY CONSTRUCTION
(`view<Transform, Velocity, Controller, CameraTag>`): an NPC handed a
`Controller` alone is silently skipped, and the crowd's locomotion is written
straight to `Velocity` by `ai_step`/`wander_step`, which skip the camera holder
for exactly this reason.

- **Code:** [src/sim/controller.h](src/sim/controller.h) /
  [controller.cpp](src/sim/controller.cpp)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2

## Model

`controller_step(reg, dt)` iterates `view<Transform, Velocity, Controller,
CameraTag>`:

- Builds a horizontal forward/right basis from `CameraTag::yaw` (world up = +Z).
- `wishDir` components: x = forward, y = right, z = up (each in [-1, 1]),
  normalized so diagonals aren't faster.
- **Walk** (`fly == false`): drives horizontal velocity only; the vertical axis
  is left to [physics.md](physics.md) (gravity + jump).
- **Fly** (`fly == true`): full 6DoF, drives all three axes; gravity ignored by
  leaving `GravityAffected` off the entity.

`wishDir` is populated every frame by the input layer ([README.md](README.md)
controls). Yaw convention matches [camera.md](camera.md) so movement and view
agree on "forward".

## Connections

Downstream of [input](README.md), upstream of [physics.md](physics.md). Shares
the yaw/forward convention with [camera.md](camera.md).
