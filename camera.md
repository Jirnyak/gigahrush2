# Camera — view derived from the ECS

The camera is **not a singleton object**; it is read off whichever entity holds
a `CameraTag` each frame. Move the tag to another entity and the view follows.

- **Code:** [src/sim/camera.h](src/sim/camera.h) /
  [camera.cpp](src/sim/camera.cpp)
- **Test:** `tests/world_test.cpp` (`test_camera_component_is_movable`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L2

## Model

`compute_camera(reg, aspect)` finds the first `view<Transform, CameraTag>`
entity and returns `CameraMatrices { view, proj, eye, forward, valid }`:

- `eye = Transform::pos + CameraTag::eyeOffset`. For an embodied character the
  `eyeOffset.z` is derived from the record's `height_mm` at embodiment
  ([npcs.md](npcs.md)), so the view sits at that body's stature — switching into
  a shorter or taller character (or respawning into a new body) immediately looks
  from the new eye height.
- `forward = camera_forward(yaw, pitch)` — the shared yaw/pitch → direction
  function, so mouselook, movement, and rendering agree.
- `view = lookAt(eye, eye + forward, +Z)`; `proj = perspective(fovY, aspect, …)`
  with **Y flipped** (`proj.m[5] = -proj.m[5]`) for Vulkan's +Y-down clip space.
- `valid = false` when no camera entity exists (renderer falls back gracefully).

## Clip-space note

`mat4_perspective` in [core/math.h](src/core/math.h) currently emits GL-style
`[-1, 1]` depth while the render pass clears depth to `1.0` with `LESS`. If far
geometry renders behind the clear plane, map projected z to `[0, 1]` here or in
the shared math. Tracked in [render.md](render.md).

## Connections

Reads `CameraTag`/`Transform` ([ecs.md](ecs.md)); shares the forward basis with
[controller.md](controller.md); output feeds the [renderer](render.md) each
frame.
