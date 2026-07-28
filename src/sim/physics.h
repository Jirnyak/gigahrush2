// Physics: vector gravity, jump, and swept-AABB collision against the macro
// grid's sub-voxel masks.
//
// The system iterates entities with Transform + Velocity and integrates them
// against the world they live on (via Transform::layer). Collision resolves one
// axis at a time (classic Quake-style sweep) so an entity slides along walls
// and lands cleanly on sub-voxel surfaces. All tunables live on the components
// (AABB half-extents, Jump impulse, GravityAffected scale) — nothing is baked
// into the solver.
#pragma once

#include "ecs/registry.h"
#include "world/level_stack.h"

namespace giga {

struct PhysicsParams {
    // Substeps keep fast movers from tunneling through thin sub-voxel walls.
    int maxSubsteps = 4;
    float maxStep = 1.0f / 120.0f; // seconds per substep cap
};

// Advance all dynamic entities by dt seconds against their layers.
void physics_step(Registry& reg, LevelStack& stack, float dt,
                  const PhysicsParams& params = {});

// True if the AABB centered at `pos` overlaps any solid sub-voxel in `world`.
// Exposed for tests and for gameplay queries (line-of-fire, placement checks).
bool aabb_overlaps_solid(const class World& world, vec3 pos, vec3 half);

} // namespace giga
