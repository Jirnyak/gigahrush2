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
    // Seconds per substep cap. This is the last 1/120 in src/ and it stays a literal
    // deliberately rather than becoming kSimDt, which is not an oversight: physics_step
    // is called with a local dt of 1.0f / 120.0f by two test sites that predate the
    // 125 Hz move (tests/game_test.cpp and tests/suite_hunt.inl). Tightening the cap to
    // kSimDt (0.008) would make ceil(0.008333 / 0.008) == 2 there, doubling their
    // substep count and silently changing what those tests measure. Migrate those dt
    // literals first, then this becomes kSimDt in the same commit. At the live rate the
    // cap is inert either way: an 8.0 ms tick is under the 8.333 ms cap, so the ceil()
    // in physics.cpp:79 yields one substep.
    float maxStep = 1.0f / 120.0f;
};

// Advance all dynamic entities by dt seconds against their layers.
void physics_step(Registry& reg, LevelStack& stack, float dt,
                  const PhysicsParams& params = {});

// True if the AABB centered at `pos` overlaps any solid sub-voxel in `world`.
// Exposed for tests and for gameplay queries (line-of-fire, placement checks).
bool aabb_overlaps_solid(const class World& world, vec3 pos, vec3 half);

} // namespace giga
