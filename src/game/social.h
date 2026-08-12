#pragma once

#include <cstdint>
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "game/faction_relations.h"
#include "game/ai.h"
#include "game/speech.h"
#include "world/level_stack.h"

namespace giga::game {

// Track ongoing social exchange state for an NPC
struct NpcSocial {
    NpcId partner = kInvalidNpc;
    std::uint64_t cooldownUntilTick = 0;
};

struct SocialTick {
    std::uint32_t pairsFormed = 0;
    std::uint32_t alliesFormed = 0;
    std::uint32_t cellMemoriesExchanged = 0;
};

// Evaluates NPCs with IntentSocial, steers them towards valid partners, and
// exchanges MemAlly / MemFood / MemDanger upon physical proximity.
// Strictly obeys the Single-Writer Rule via MotionOwner::Ai.
SocialTick social_step(Registry& reg, NpcPool& pool, const FactionRelations& rel,
                       AiMemory& mem, SpeechMemory& speechMem, LayerId layer,
                       double now, std::uint64_t tick);

// Attaches NpcSocial to bodies on the floor that do not have one.
std::uint32_t social_init(Registry& reg, LayerId layer);

} // namespace giga::game
