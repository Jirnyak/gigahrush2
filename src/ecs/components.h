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

// Mass in kilograms — THE universal physical context (owner, 2026-08-02). One
// number, two laws everywhere: E = m*v^2/2 and p = m*v. Filled from the content
// tables at spawn (mobs.csv mass_kg, props.csv mass_kg, materials.csv density
// for debris via material_subvoxel_mass_kg, height for NPC bodies). Fall
// damage, a thrown prop's punch and a ragdoll's swing are all the same
// arithmetic over this one component — never a per-system constant.
struct Mass {
    float kg = 70.0f;
};

// The physics system's impact report: the collision speed the sweep KILLED this
// step (m/s over the axes that hit). Written by physics_step whenever it zeroes
// velocity components above a small threshold; consumed and REMOVED by the game
// layer's impact law (damage = k * m * v^2 / 2 over Mass). A POD seam, so L2
// physics never knows what HP is.
struct Impact {
    float speed = 0.0f;
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

// "Something else owns my motion — physics_step, keep out."
//
// **This closes a real double-integration bug.** `physics_step` iterates
// `<Transform, Velocity>` and integrates everything it finds. Projectiles carry both,
// and `projectile_step` ALSO integrates them — so every shot in the game moved twice per
// tick, at double speed AND double gravity. An audit measured a projectile authored at
// 30 m/s covering 6.000 m in 12 ticks where 3.000 m was intended: ratio exactly 2.00.
//
// A TAG in the core rather than a `Projectile` check inside physics_step, because
// `src/sim` may not include `src/game` ([AGENTS.md] layering). Anything that integrates
// its own motion carries this.
struct SelfIntegrating {};

// "Move me, but let me pass through everything" — debug/console noclip.
//
// physics_step still integrates velocity and wraps the torus for a carrier, but
// skips gravity, jumping and the swept-AABB collision entirely, so the body
// flies through walls instead of backing out of them. A TAG in the core for the
// same layering reason as SelfIntegrating: the console that toggles it lives in
// the game layer, and `src/sim` may not include `src/game`.
struct NoClip {};

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

// Angular motion for ragdoll / tumbling props ([jirnyak.md] section 18).
//
// Lives in the CORE — not the game layer — for the same reason as
// SelfIntegrating / NoClip: `physics_step` (src/sim) must integrate them, and
// src/sim may not include src/game. The game attaches these on RagdollRoll
// detach; physics_step advances Rotation from AngularVelocity each substep.
//
// Rotation is Euler (radians, XYZ) for now: core/math.h has no quat type yet.
// A later pass can swap to quat without changing the attachment contract.
struct AngularVelocity {
    vec3 w{0.0f, 0.0f, 0.0f}; // rad/s
};

struct Rotation {
    vec3 euler{0.0f, 0.0f, 0.0f}; // radians, XYZ
};

// Prop render-path filter tags ([jirnyak.md] section 18).
//
// Live in the CORE — not the game layer — for the same reason as CameraTag /
// Renderable: BodyPass (src/render) must filter StaticPropTag so static
// furniture is PropPass-only, and src/render may not include src/game. The
// game attaches these at spawn; on detach it swaps StaticPropTag ->
// DynamicBodyTag without destroying the entity. PropMeshTag marks entities
// that carry a GPU mesh skin payload (the payload itself stays in game).
struct StaticPropTag {};
struct DynamicBodyTag {};
struct PropMeshTag {};

} // namespace giga
