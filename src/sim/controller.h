// Controller system: turns input intent (Controller::wishDir, expressed in the
// camera's local frame) into world-space velocity.
//
// Walk mode (fly == false): the wish drives the velocity component PERPENDICULAR
// to gravity; the physics system owns the component along it (gravity + jump).
// Fly mode: full 6DoF, wish drives all three axes and gravity is ignored by
// leaving it off the entity. This is the same system whether it steers the
// player, an NPC given a Controller, or a debug free-cam.
#pragma once

#include "ecs/registry.h"
#include "world/gravity.h"

namespace giga {

// Optional `gravity`: names which axis is vertical, so "walk" means the plane
// perpendicular to the pull rather than the XY plane. Null keeps the Z-up frame,
// which is correct under the shipping NegZ regime and wrong under every other.
void controller_step(Registry& reg, float dt,
                     const GravityField* gravity = nullptr);

} // namespace giga

} // namespace giga
