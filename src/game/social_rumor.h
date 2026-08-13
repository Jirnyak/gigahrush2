// Social & Reputation Rumor System — 1-level deep rumor exchange and single-writer ECS integration.
#pragma once

#include <cstdint>
#include <vector>

#include "core/math.h"
#include "core/tick.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"
#include "game/faction_relations.h"
#include "game/npc_pool.h"
#include "game/rumour.h"
#include "world/level_stack.h"

namespace giga::game {

struct GossipTickResult {
    std::uint32_t exchanges = 0;
    std::uint32_t rumors_transferred = 0;
    std::uint32_t relations_shifted = 0;
};

// Default proximity range for rumor exchange between embodied NPCs (metres)
inline constexpr float kRumorExchangeRadius = 4.0f;

// Single-threaded rumor exchange step adhering strictly to Single-Writer rule (R2).
// Iterates embodied NPCs on the current layer, exchanges non-propagated rumors (propagated == false),
// transfers them to listeners with propagated = true (R1 1-level limit), and updates relations.
GossipTickResult rumour_exchange_step(const Registry& reg,
                                     NpcPool& pool,
                                     FactionRelations& relations,
                                     LayerId layer,
                                     std::uint64_t tick,
                                     float radius = kRumorExchangeRadius);

// Direct single-threaded rumor exchange between speaker and listener NPCs.
// Returns true if a rumor was successfully transferred.
bool rumour_exchange_pair(NpcPool& pool,
                          FactionRelations& relations,
                          NpcId speakerId,
                          NpcId listenerId,
                          std::uint64_t tick);

} // namespace giga::game
