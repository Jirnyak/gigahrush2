// Rich interactive NPC Dialogue Window for GigaHrush 2.
#pragma once

#include <cstdint>
#include "ecs/registry.h"
#include "game/contract.h"
#include "game/dialogue.h"
#include "game/faction.h"
#include "game/npc_pool.h"
#include "game/quest.h"
#include "game/role.h"
#include "game/speech.h"

namespace giga {

enum class DialogueAction : std::uint8_t {
    None = 0,
    AskRumours,
    AskWarSituation,
    AcceptContract,
    AcceptQuest,
    OpenTrade,
    Possess,
    Close
};

struct DialogueSession {
    bool active = false;
    game::NpcId speaker = game::kInvalidNpc;
    game::Faction faction = game::Faction::Citizens;
    game::RoleId role = game::RoleId::Resident;
    game::SpeechSituation situation = game::SpeechSituation::Ambient;
    game::DialogueAttitude attitude = game::DialogueAttitude::Neutral;
    char speakerName[64] = {};
    char speechText[320] = {};
    char rumourText[256] = {};
    char warReportText[320] = {};
    game::Contract contractOffer{};
    char contractText[200] = {};
    game::QuestId questOffer = game::kInvalidQuest;
    game::NpcId questOfferGiver = game::kInvalidNpc;
    char questText[320] = {};
    std::int16_t speakerHp = 100;
    std::int16_t speakerMaxHp = 100;
    bool traderNear = false;
    bool canPossess = false;
};

// Draw interactive NPC Dialogue Window.
void draw_dialogue_window_ui(DialogueSession& session, DialogueAction& outAction);

} // namespace giga
