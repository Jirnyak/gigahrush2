// Audit findings, as their own ctest target.
//
// WHY THIS FILE EXISTS, AND WHY CTEST PINS THE COUNT IT PRINTS
// -----------------------------------------------------------
// tests/suite_audit.inl is a deliberately RED suite: one test per defect found by
// reading src/game and src/render, each written to fail against HEAD and to pass once
// the named defect is fixed, so the fix has a witness and the regression has a
// tripwire. That design is right. Sharing an exit code with the other ~45 game_test
// tests was not: game_test returns `g_fails == 0 ? 0 : 1`, so while any finding stood,
// ctest reported exactly one bit — "game_test failed" — identically whether the seven
// known findings were outstanding or whether somebody had additionally broken
// test_nav_fine_realfloor or test_floor_travel. Every green test in that file was
// demoted from a gate to a line of stderr for a human to diff by hand, and
// master_prompt.md's "ctest-green" became false.
//
// So the tripwires live here instead, with their own counters and their own main. The
// exit code below is still one bit, which is why ctest does NOT read it.
//
// This target used to be marked WILL_FAIL, and that inherited the exact defect it was
// meant to cure — one level up. WILL_FAIL inverts `g_fails == 0 ? 0 : 1`, i.e. it
// tests "count > 0", never the count. Six of the seven findings are CLOSED pins today,
// so regressing one of them moved the tally 2 -> 3: still non-zero, still inverted,
// still GREEN. Six guards that read as guards guarded nothing. And a crash before the
// count line prints also exits non-zero, so that was green too.
//
// CMakeLists.txt now pins the printed count with PASS_REGULAR_EXPRESSION instead. The
// test passes only if the run reached the end AND printed exactly the expected tally,
// so a regression that moves either number goes RED, and so does a crash — the line
// never gets printed. Change a check count and you must update the regex there and say
// in the commit which defect died. Read that comment before touching either number.
//
// Include block mirrors game_test.cpp because suite_audit.inl was written against that
// translation unit's headers, its CHECK macro, and `using namespace giga::game`.

#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/contract.h"
#include "game/vendor.h"
#include "game/container.h"
#include "game/save.h"
#include "game/combat.h"
#include "game/embody.h"
#include "game/elevator.h"
#include "game/event_bus.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/extraction.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/floor_spec.h"
#include "game/mob_behaviour.h"
#include "game/mob_table.h"
#include "game/item_table.h"
#include "game/loot.h"
#include "game/ranged_table.h"
#include "game/weapon_table.h"
#include "game/mob_spawn.h"
#include "game/floor_stream.h"
#include "game/inventory.h"
#include "game/npc_pool.h"
#include "game/wander.h"
#include "game/population.h"

#include "sim/physics.h"
#include "world/lattice.h"
#include "world/materials.h"
#include "world/level_stack.h"
#include "world/nav.h"
#include "world/world.h"

using namespace giga;
using namespace giga::game;

namespace {
int g_fails = 0;
int g_checks = 0;
}

#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_checks;                                                            \
        if (!(cond)) {                                                         \
            ++g_fails;                                                         \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__,       \
                         #cond);                                               \
        }                                                                      \
    } while (0)

#include "suite_audit.inl"

int main() {
    test_audit_all();
    // THE gate line. CMakeLists.txt pins this exact text with
    // PASS_REGULAR_EXPRESSION, so ctest fails if either number moves and fails if this
    // line is never reached at all. Do not reword it without updating that regex.
    std::printf("audit_test: %d checks, %d failures\n", g_checks, g_fails);
    if (g_fails == 0) {
        std::printf(
            "audit_test: every finding is GREEN. ctest will now report this target as\n"
            "            FAILED, because CMakeLists.txt pins a non-zero failure count.\n"
            "            That is the tripwire firing, not a regression: update the\n"
            "            PASS_REGULAR_EXPRESSION to the count above, and say in the\n"
            "            commit which defect is closed.\n");
    }
    // Kept honest but unread: ctest checks the printed count, not this. A pass regex
    // overrides the exit code, which is what lets a target with live findings exit 1
    // and still report green.
    return g_fails == 0 ? 0 : 1;
}
