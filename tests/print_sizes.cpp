#include <cstdio>
#include "game/save.h"

int main() {
    using namespace giga::game;
    std::printf("kLedgerWire = %zu\n", kLedgerWire);
    std::printf("kBookWire = %zu\n", kBookWire);
    std::printf("kPlayerWire = %zu\n", kPlayerWire);
    std::printf("kRpgWire = %zu\n", kRpgWire);
    std::printf("kCraftingWire = %zu\n", kCraftingWire);
    std::printf("kCombatSaveWire = %zu\n", kCombatSaveWire);
    std::printf("kStatusWire = %zu\n", kStatusWire);
    std::printf("kQuestLogWire = %zu\n", kQuestLogWire);
    std::printf("kSamosborWire = %zu\n", kSamosborWire);
    std::printf("kSaveFixedWire = %zu\n", kSaveFixedWire);
    return 0;
}
