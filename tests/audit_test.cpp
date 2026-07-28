// Audit findings, as their own ctest target.
//
// WHY THIS FILE EXISTS AND WHY ITS TEST IS EXPECTED TO FAIL
// --------------------------------------------------------
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
// So the tripwires live here instead, with their own counters and their own main, and
// CMakeLists marks the `audit_findings` test WILL_FAIL. Consequences worth knowing:
//
//   * While findings stand, this target exits non-zero, WILL_FAIL inverts that, and
//     ctest is GREEN. game_test is a clean regression gate again.
//   * The moment somebody fixes the last finding, this target exits 0, WILL_FAIL
//     inverts THAT, and ctest goes RED. That is intentional: it forces whoever closed
//     the finding to come here, delete the fixed test or drop WILL_FAIL, and state in
//     the commit which defect is gone. A tripwire that silently stops tripping is
//     worthless.
//   * Honest limitation: WILL_FAIL cannot tell "failed the assertion I expected" from
//     "crashed on startup". If this target ever segfaults, ctest still reports green.
//     Read the count line it prints before trusting the colour.
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
    std::printf("audit_test: %d checks, %d failures\n", g_checks, g_fails);
    if (g_fails == 0) {
        std::printf(
            "audit_test: every finding is GREEN. ctest will now report this target as\n"
            "            FAILED because CMakeLists marks it WILL_FAIL. That is the\n"
            "            tripwire firing, not a regression: remove the fixed tests or\n"
            "            drop WILL_FAIL, and say in the commit which defect is closed.\n");
    }
    return g_fails == 0 ? 0 : 1;
}
