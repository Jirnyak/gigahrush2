// The universal impact law — E = m*v^2/2, ONE formula for every hard landing.
//
// Physics (L2) reports the collision speed it killed as an `Impact` component
// ([ecs/components.h]) and knows nothing else; THIS system turns that report
// into damage over the entity's `Mass`, through the one damage entry point
// ([combat.h] apply_damage, Kinetic channel), so an impact death goes through
// the same finalizer as every other death.
//
// Owner's law (2026-08-02): mass is THE universal physical context. Fall
// damage, a prop crashing into a body, debris — all the same arithmetic:
//
//     effective v = impact speed - kImpactFreeSpeed   (a jump lands free)
//     damage      = kImpactHpPerJoule * m * v_eff^2 / 2
//
// No per-cause constants, no special cases: a heavier body falling the same
// distance takes proportionally more, exactly like the real formula says.
// Pure game-layer + core: headless-testable.
#pragma once

#include <cstdint>

#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "game/particles.h" // ParticleBurstQueue — the landing bleeds too

namespace giga::game {

// Landings at or below this speed are FREE. The jump arc peaks at 1.27 m and
// lands at ~5 m/s ([ecs/components.h] Jump, [world/gravity.h]); 6.5 leaves
// margin over it plus a step off a 2 m cell (~6.3 m/s), so normal traversal
// never bleeds.
inline constexpr float kImpactFreeSpeed = 6.5f;

// HP per joule of effective kinetic energy. Calibration on a 70 kg body:
// a 5 m drop (v = 9.9, eff 3.4) costs ~20 HP of its 100; a 10 m drop
// (v = 14.0, eff 7.5) costs ~98 — lethal, as a four-storey fall should be.
inline constexpr float kImpactHpPerJoule = 0.05f;

// Consume every Impact report: entities carrying Mass and an HP holder
// (NpcRef / MobRef) take the universal damage; every report is REMOVED either
// way, so the component never accumulates. Returns how many took damage.
// Optional `particles` flows into apply_damage — a hard landing bleeds through
// the same unified-pool writer as a bullet ([particles.h]).
std::uint32_t impact_damage_step(Registry& reg, NpcPool& pool,
                                 ParticleBurstQueue* particles = nullptr);

} // namespace giga::game
