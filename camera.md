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

**Resolved — do not "fix" this again.** `mat4_perspective` in
[core/math.h](src/core/math.h) emits **Vulkan `[0, 1]` depth**:
`m[10] = zf / (zn - zf)`, `m[14] = (zn * zf) / (zn - zf)`, so the near plane maps
to `z_ndc = 0` and the far plane to `1.0` — matching a depth buffer cleared to
`1.0` with `VK_COMPARE_OP_LESS`. The caller flips Y once (`proj.m[5] = -proj.m[5]`)
for Vulkan's +Y-down clip space, so world +Z renders up.

This paragraph used to say the projection "currently emits GL-style `[-1, 1]`
depth" and asked the next reader to convert it. That was stale, and the ask was
the dangerous half: converting an already-correct matrix inverts the depth test.

## Connections

Reads `CameraTag`/`Transform` ([ecs.md](ecs.md)); shares the forward basis with
[controller.md](controller.md); output feeds the [renderer](render.md) each
frame.
