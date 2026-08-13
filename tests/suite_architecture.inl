#include <cstdio>
#include "core/tick.h"
#include "game/save.h"
#include "game/room_zone.h"
#include "game/ai.h"

namespace {

static void test_architecture_gates() {
    // Architecture invariant checks:
    // 1. Tick Hz is 125 Hz
    CHECK(giga::kSimHz == 125);
    // 2. Room affordance covers active intent lines
    CHECK(sizeof(giga::game::kRoomAffordance) / sizeof(giga::game::kRoomAffordance[0]) >= 6);
    // 3. AI memory has 9 kinds (including MemNone)
    CHECK(giga::game::kMemKindCount == 9);
    // 4. Save version is pinned
    CHECK(giga::game::kSaveVersion == 10);
}

} // namespace
