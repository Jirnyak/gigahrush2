// Dynamic Dialogue Response Adaptation Engine for GigaHrush 2.
//
// Generates grounded, contextual dialogue options, speaker attitudes, and responses
// based on:
//   - Propagated social rumours (Player Heroics vs Atrocities)
//   - Dynamic faction territorial disputes and war states (Peace / Skirmish / OpenWar / Ceasefire)
//   - Speaker's faction, role, and current situation (Campfire / Break / Common room / Combat)
//   - Faction relations & player standing
#pragma once

#include <cstddef>
#include <cstdint>

#include "ecs/registry.h"
#include "game/contract.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/npc_pool.h"
#include "game/quest.h"
#include "game/role.h"
#include "game/rumour.h"
#include "game/speech.h"

namespace giga::game {

enum class DialogueAttitude : std::uint8_t {
    HeroVeneration = 0, // Revered for heroic acts (beast slayer, survivor savior)
    Friendly,           // High faction standing (+30..+100)
    Neutral,            // Standard baseline (-20..+29)
    Wary,               // Suspicious (-49..-21)
    Hostile,            // Hostile standing (<= -50)
    AtrocityTerror,     // Paralyzed by fear of player's butcher reputation
    AtrocityVengeful,   // Burning with rage over player slaughtering their faction
    WarAnxious          // Deeply agitated by active faction warfare on the floor
};

const char* dialogue_attitude_name(DialogueAttitude att);

struct DialoguePrompt {
    DialogueAttitude attitude = DialogueAttitude::Neutral;
    char greeting[320] = {};
    char rumourResponse[320] = {};
    char warResponse[320] = {};
    char tradeModifierDesc[128] = {};
    float priceMultiplier = 1.0f; // 0.80f (hero discount) to 2.0f (war/hostility penalty)
    bool willTrade = true;
    bool willOfferQuests = true;
    bool willFlee = false;
};

// Build rich contextual dialogue responses based on live world, social, and rumour state.
DialoguePrompt generate_dialogue_prompt(
    const Registry& reg,
    const NpcPool& pool,
    NpcId speaker,
    std::int16_t floorZ,
    const FactionRelations& rel,
    const SamosborState& samosbor,
    const RumourNetwork* rumourNet = nullptr,
    const TerritoryWarManager* territoryMgr = nullptr);

// Formatted greeting for campfire / break leisure routine
void dialogue_campfire_greeting(char* out, std::size_t cap, Faction f, RoleId role, DialogueAttitude att);

} // namespace giga::game
