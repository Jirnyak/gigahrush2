// Wander locomotion — the first consumer of the baked navigation.
//
// The nav bake ([nav.h], master_prompt #11) has existed complete and tested with
// **no consumer at all**: 64 coarse nodes, an all-pairs next-hop table, and 64
// dense flow fields, none of which moved anything. This is the seam that connects
// them to visible behaviour, and it is the foundation the full utility-AI
// (master_prompt #12) later steers instead of replaces.
//
// The whole point of the bake is that steering costs **O(1) per agent** and no
// search: read one byte out of the target node's flow field at the agent's own
// cell, and that byte IS the next step along a shortest wrapped path. No A*, no
// per-agent path memory, nothing that scales with crowd size beyond the crowd
// itself.
//
// Cost is further divided by an **identity-hash stagger**: an agent is visited
// once every `kWanderPeriod` ticks, selected by its own entity id, so the per-tick
// cost is O(n / period) and there is *zero* per-agent scheduling state — no
// timers, no queues, no next-update field. That is the trick that lets the crowd
// grow without the tick growing with it.
#pragma once

#include <cstdint>

#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/nav.h"

namespace giga::game {

// The lattice node this agent is currently walking toward. Two bytes: an agent's
// entire navigation state. Everything else is in the shared baked fields.
struct WanderTarget {
    std::uint8_t node;      // lattice node 0..63
    std::uint8_t cooldown;  // staggered visits to wait before repathing
};

// Visit each agent once every N ticks. 8 at the 120 Hz sim step means ~15
// steering decisions per agent per second, which is far finer than a walking
// body needs and still costs an eighth of the naive sweep.
inline constexpr std::uint32_t kWanderPeriod = 8;

// Give every mob and embodied NPC on `layer` a wander target. Call after a floor
// is populated (embody + mob spawn); entities that already have a target keep it.
// The player is skipped — it holds CameraTag and is steered by input.
std::uint32_t wander_init(Registry& reg, LayerId layer, std::uint32_t seed);

// One staggered steering pass. Sets horizontal velocity from the baked flow
// field; gravity and collision are left to physics_step, which runs after.
//
// Agents whose flow byte is a VERTICAL step do not move: a walking body cannot
// step up a storey, and stairwell/elevator traversal is not wired yet. They
// repath instead of grinding into the ceiling, which is honest but does mean the
// crowd currently explores only what is reachable on its own storey.
// `grid` is read only for the wall-adjacency test AiFlag::WallBias needs: four
// cardinal cell reads, and only for a mob already aggroed and already in its
// stagger slot — so 4 reads for roughly 1/8 of the hostiles per pass.
// `pool` is read to resolve the camera holder's faction: monsters do not hunt a body
// they do not consider prey ([faction_relations.h] kMobVsFaction).
void wander_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                 const nav::CoarseGraph& coarse,
                 const nav::FineNav& fine, LayerId layer, std::uint64_t tick);

} // namespace giga::game
