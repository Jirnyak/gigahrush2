// Interactive Quest Log & Contract UI for GigaHrush 2.
#pragma once

#include <cstdint>
#include "game/contract.h"
#include "game/quest.h"

namespace giga {

struct QuestUIState {
    bool open = false;
    int selectedTab = 0;          // 0: Active assignments, 1: Contract board, 2: History & archive
    int selectedQuestId = -1;     // currently viewed QuestId (1..19)
    int selectedContractSlot = -1;// currently viewed contract slot (0..2)
};

// Draw interactive multi-tab Quest Log UI.
void draw_quest_log_ui(QuestUIState& state, const game::QuestLog& quests, const game::ContractBook& contracts);

} // namespace giga
