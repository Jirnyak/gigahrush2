#include "game/item_table.h"
#include "game/craft.h"
#include "game/quest.h"
#include "game/mob_table.h"
#include <iostream>

using namespace giga;

int main() {
    std::cout << "--- CRAFT ---" << std::endl;
    std::uint32_t axis[craft::kNumMaterialAxes] = {0};
    for (int i = 1; i <= kItemCount; ++i) {
        if (!craft::is_recipe(i)) continue;
        const auto& comp = craft::composition_of(i);
        for (const auto& kv : comp) {
            axis[craft::material_axis_of(kv.item)] += kv.count;
        }
    }
    for(int i = 0; i < 6; i++) std::cout << "axis[" << i << "] = " << axis[i] << std::endl;

    std::cout << "--- QUEST ---" << std::endl;
    int chained = 0, timed = 0;
    for (int i = 0; i < kQuestCount; ++i) {
        if (kQuestTable[i].chainNext != kInvalidQuest) chained++;
        if (kQuestTable[i].timeLimit > 0) timed++;
    }
    std::cout << "chained = " << chained << std::endl;
    std::cout << "timed = " << timed << std::endl;

    std::cout << "--- MONSTER ---" << std::endl;
    std::uint32_t wetSpawn = 0;
    std::uint32_t baitKinds = 0;
    std::uint32_t baitOnly = 0;
    for (int i = 0; i < kMobKindCount; ++i) {
        const auto& kd = kMobTable[i];
        if (kd.flags & MobFlag::SpawnWater) wetSpawn++;
        if (kd.aiFlags & AiFlag::FoodBait) {
            baitKinds++;
            if (!(kd.aiFlags & ~AiFlag::FoodBait)) baitOnly++;
        }
    }
    std::cout << "wetSpawn = " << wetSpawn << std::endl;
    std::cout << "baitKinds = " << baitKinds << std::endl;
    std::cout << "baitOnly = " << baitOnly << std::endl;
    
    return 0;
}
