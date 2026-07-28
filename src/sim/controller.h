// Controller system: turns input intent (Controller::wishDir, expressed in the
// camera's local frame) into world-space velocity.
//
// Walk mode (fly == false): horizontal wish drives horizontal velocity; the
// physics system owns the vertical axis (gravity + jump). Fly mode: full 6DoF,
// wish drives all three axes and gravity is ignored by leaving it off the
// entity. This is the same system whether it steers the player, an NPC given a
// Controller, or a debug free-cam.
#pragma once

#include "ecs/registry.h"

namespace giga {

void controller_step(Registry& reg, float dt);

} // namespace giga
