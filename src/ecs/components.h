// Engine-core ECS components.
//
// These are the *universal* components the core needs to move things and view
// the world. They are all POD. A game adds its own components (health, faction,
// inventory) alongside these without touching the engine.
//
// Design pillar: the camera and the controller are components you attach to any
// entity. The "player" is not special — it is simply the entity that currently
// owns a CameraTag and a Controller. Hand those components to a bird, a bullet,
// or a debug free-cam and it just works.
#pragma once
#include <cstdint>

#include "core/math.h"
#include "world/level_stack.h"

namespace giga {

// Position in world units, plus which level-stack layer (W) the entity is on.
struct Transform {
    vec3 pos{0, 0, 0};
    LayerId layer = 0;
};

struct Velocity {
    vec3 v{0, 0, 0};
};

// Axis-aligned bounding box, expressed as half-extents around Transform::pos.
struct AABB {
    vec3 half{0.4f, 0.4f, 0.9f};
};

// Marks an entity as subject to the layer's gravity field.
struct GravityAffected {
    float scale = 1.0f;   // multiplier on the gravity vector
    bool grounded = false; // set by the physics system each step
};

// Jump parameters + request. Set `wants_jump` from input; the physics system
// consumes it when grounded and applies `impulse` along -gravity.
struct Jump {
    float impulse = 5.0f;
    bool wants_jump = false;
};

// Attach to the entity that should drive the view. Only one is expected to be
// active; the camera system picks the first it finds.
struct CameraTag {
    float yaw = 0.0f;    // radians, around world +Z (up)
    float pitch = 0.0f;  // radians, clamped to +/- ~89 deg
    float fovY = 1.2f;   // radians
    vec3 eyeOffset{0, 0, 0.7f}; // eye relative to Transform::pos
};

// Attach to make an entity respond to input. The input layer writes movement
// intent here; the controller system turns it into velocity.
struct Controller {
    float moveSpeed = 6.0f;
    // Movement intent in the entity's local frame (forward/right/up), each in
    // [-1, 1]. Populated by the input layer every frame.
    vec3 wishDir{0, 0, 0};
    bool fly = false; // true = 6DoF free-cam; false = walk + gravity
};

// Cosmetic body colour for the render layer. Any entity that also carries a
// Transform + AABB is drawn by the body pass as one lit box, sized to the AABB
// half-extents and tinted by `color`. Purely a render skin: data flows
// sim -> render only, so the sim never reads this — adding or removing it
// changes pixels, never outcomes. The game sets the colour at embody time (e.g.
// by faction). Kept in the core so the render pass depends only on core
// components, never on the game layer.
struct Renderable {
    vec3 color{0.80f, 0.80f, 0.82f};
};

} // namespace giga
