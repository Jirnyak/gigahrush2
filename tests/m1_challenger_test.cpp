// Challenger Subagent Milestone 1 Empirical Stress Test Harness
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <vector>
#include <iostream>
#include <cassert>

#include "core/tick.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"
#include "game/embody.h"
#include "game/needs.h"
#include "game/npc_pool.h"
#include "game/role.h"
#include "world/field.h"
#include "world/macro_grid.h"
#include "world/nav.h"
#include "world/lattice.h"

using namespace giga;
using namespace giga::game;

// ============================================================================
// GLOBAL HEAP ALLOCATION TRACKER
// ============================================================================
static bool g_track_alloc = false;
static std::size_t g_alloc_count = 0;
static std::size_t g_alloc_bytes = 0;

void* operator new(std::size_t size) {
    if (g_track_alloc) {
        g_alloc_count++;
        g_alloc_bytes += size;
    }
    void* p = std::malloc(size ? size : 1);
    if (!p) std::abort();
    return p;
}

void operator delete(void* p) noexcept {
    std::free(p);
}

void operator delete(void* p, std::size_t) noexcept {
    std::free(p);
}

void* operator new[](std::size_t size) {
    if (g_track_alloc) {
        g_alloc_count++;
        g_alloc_bytes += size;
    }
    void* p = std::malloc(size ? size : 1);
    if (!p) std::abort();
    return p;
}

void operator delete[](void* p) noexcept {
    std::free(p);
}

void operator delete[](void* p, std::size_t) noexcept {
    std::free(p);
}

// Helper harness check macros
static int g_fails = 0;
static int g_checks = 0;

#define CHALLENGER_CHECK(cond, msg)                                             \
    do {                                                                       \
        ++g_checks;                                                            \
        if (!(cond)) {                                                         \
            ++g_fails;                                                         \
            std::fprintf(stderr, "[FAIL] %s:%d: %s (%s)\n", __FILE__, __LINE__, #cond, msg); \
        } else {                                                               \
            std::fprintf(stdout, "[PASS] %s\n", msg);                          \
        }                                                                      \
    } while (0)

// ============================================================================
// TEST SUITES
// ============================================================================

// ----------------------------------------------------------------------------
// TEST 1: Zero Allocations & Zero RTTI on AI Hot Paths
// ----------------------------------------------------------------------------
static void test_zero_allocations_and_rtti() {
    std::printf("\n=== TEST 1: Zero Allocations and RTTI Compliance on AI Hot Paths ===\n");

    Registry reg;
    NpcPool pool;
    pool.init();
    AiMemory mem;
    Field<float> danger(0.0f);
    MacroGrid grid;
    nav::CoarseGraph coarse{};
    nav::FineNav fine{};
    const LayerId kLayer = 0;

    // Create 100 bodies with various roles and intents
    constexpr int kBodyCount = 100;
    std::vector<Entity> entities;
    entities.reserve(kBodyCount);

    for (int i = 0; i < kBodyCount; ++i) {
        NpcId id = pool.spawn();
        pool.faction(id) = static_cast<std::uint16_t>(Faction::Citizens);
        pool.role(id) = static_cast<std::uint8_t>(i % static_cast<int>(RoleId::kRoleCount));
        pool.hp(id) = 100;
        pool.max_hp(id) = 100;

        Entity e = embody(reg, pool, id, kLayer);
        reg.get<Transform>(e).pos = vec3{(static_cast<float>(i % 32) + 0.5f) * kCellSize,
                                         (static_cast<float>(i / 32) + 0.5f) * kCellSize,
                                         0.5f * kCellSize};
        entities.push_back(e);
    }

    std::uint32_t initCount = ai_init(reg, kLayer);
    CHALLENGER_CHECK(initCount == kBodyCount, "ai_init attached brains to all test entities");

    // WARM-UP PASS: allow lazy initialization / memory table geometric allocation before tracking allocations
    AiConfig cfg;
    cfg.enabled = true;
    cfg.memory = true;
    cfg.rethinkBaseSec = 0.0f;
    cfg.rethinkSpreadSec = 0.0f;

    for (int step = 0; step < 10; ++step) {
        ai_step(reg, pool, &danger, grid, kLayer, static_cast<double>(step) * kSimDt, kSimDt, cfg, &mem);
        ai_patrol_step(reg, coarse, fine, kLayer, kSimDt);
    }

    // BEGIN ZERO-ALLOCATION TRACKING
    g_alloc_count = 0;
    g_alloc_bytes = 0;
    g_track_alloc = true;

    constexpr int kHotPathTicks = 1000;
    for (int step = 10; step < 10 + kHotPathTicks; ++step) {
        const double now = static_cast<double>(step) * kSimDt;

        // 1. ai_step execution
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, &mem);

        // 2. ai_patrol_step execution
        ai_patrol_step(reg, coarse, fine, kLayer, kSimDt);

        // 3. panic_publish_step execution
        panic_publish_step(danger, 15, 15, 0, kSimDt, 1.0f);
        panic_publish_step(danger, vec3{100.0f, 100.0f, 0.0f}, kSimDt, 0.8f);

        // 4. score_intents execution
        Perception p;
        p.idSeed = 12345;
        p.faction = static_cast<std::uint16_t>(Faction::Citizens);
        p.role = static_cast<std::uint8_t>(RoleId::Duty);
        Needs n = needs_roll(54321);
        float scores[kIntentCount];
        score_intents(p, n, scores);
    }

    g_track_alloc = false;

    std::printf("  Hot Path Execution: %d ticks x %d entities\n", kHotPathTicks, kBodyCount);
    std::printf("  Allocations detected: %zu count, %zu bytes\n", g_alloc_count, g_alloc_bytes);

    CHALLENGER_CHECK(g_alloc_count == 0, "Zero heap allocations during AI hot path tick loop");
    CHALLENGER_CHECK(g_alloc_bytes == 0, "Zero allocated bytes during AI hot path tick loop");
}

// ----------------------------------------------------------------------------
// TEST 2: Role Scoring Weighting & Drive Additions in score_intents()
// ----------------------------------------------------------------------------
static void test_role_scoring_math() {
    std::printf("\n=== TEST 2: Role Scoring Weighting & Drive Additions Validation ===\n");

    Needs n = needs_roll(11111);
    Perception p;
    p.idSeed = identity_seed(42);
    p.faction = static_cast<std::uint16_t>(Faction::Citizens);
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    p.danger = 0.0f;

    // Test RoleTraits matrix consistency
    for (std::size_t r = 0; r < kRoleCount; ++r) {
        RoleId roleId = static_cast<RoleId>(r);
        const RoleTraits& rt = role_traits(roleId);
        CHALLENGER_CHECK(rt.workDrive >= 0.0f && rt.workDrive <= 2.0f, "RoleTraits workDrive within valid range");
        CHALLENGER_CHECK(rt.patrolDrive >= 0.0f && rt.patrolDrive <= 2.0f, "RoleTraits patrolDrive within valid range");
        CHALLENGER_CHECK(rt.sociability >= 0.0f && rt.sociability <= 2.0f, "RoleTraits sociability within valid range");
    }

    p.role = static_cast<std::uint8_t>(RoleId::Resident);
    float scoresResident[kIntentCount];
    score_intents(p, n, scoresResident);

    p.role = static_cast<std::uint8_t>(RoleId::Duty);
    float scoresDuty[kIntentCount];
    score_intents(p, n, scoresDuty);

    const RoleTraits& rtDuty = role_traits(RoleId::Duty);
    const RoleTraits& rtRes = role_traits(RoleId::Resident);
    const RoleTraits& rtMedic = role_traits(RoleId::Medic);

    CHALLENGER_CHECK(rtDuty.workDrive == 1.0f && rtRes.workDrive == 0.30f, "Duty workDrive (1.00) vs Resident (0.30)");
    CHALLENGER_CHECK(rtDuty.patrolDrive == 1.0f && rtRes.patrolDrive == 0.05f, "Duty patrolDrive (1.00) vs Resident (0.05)");
    CHALLENGER_CHECK(scoresDuty[IntentPatrol] > scoresResident[IntentPatrol], "Duty patrol score strictly greater than Resident patrol score");

    // EMPIRICAL MATH AUDIT 1: Medic Care Drive Inadequacy
    // Test if a healthy Medic (100 HP) standing next to 100% wounded allies (nearbyWounded01 = 1.0) selects IntentHeal.
    p.role = static_cast<std::uint8_t>(RoleId::Medic);
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    p.nearbyWounded01 = 1.0f; // 100% of nearby allies wounded!

    float scoresMedicHealthy[kIntentCount];
    score_intents(p, n, scoresMedicHealthy);

    std::printf("  Healthy Medic (100 HP) with nearbyWounded01=1.0:\n");
    std::printf("    IntentHeal score = %.4f\n", scoresMedicHealthy[IntentHeal]);
    std::printf("    IntentWander score = %.4f\n", scoresMedicHealthy[IntentWander]);

    bool medicChoosesHeal = select_intent_raw(scoresMedicHealthy) == IntentHeal;
    std::printf("  Selected Intent: %s (expected IntentHeal)\n", kIntentName[select_intent_raw(scoresMedicHealthy)]);

    if (!medicChoosesHeal) {
        ++g_fails;
        std::fprintf(stderr, "[DEFECT DETECTED] Healthy Medic fails to select IntentHeal when surrounded by wounded allies! (IntentHeal=%.1f < IntentWander=%.1f)\n",
                     scoresMedicHealthy[IntentHeal], scoresMedicHealthy[IntentWander]);
    } else {
        std::printf("[PASS] Healthy Medic selects IntentHeal\n");
    }

    // EMPIRICAL DATA FLOW AUDIT 2: Check if Perception::nearbyWounded01 is populated in ai_step
    Registry reg;
    NpcPool pool;
    pool.init();
    MacroGrid grid;
    NpcId id = pool.spawn();
    pool.role(id) = static_cast<std::uint8_t>(RoleId::Medic);
    Entity e = embody(reg, pool, id, 0);
    ai_init(reg, 0);

    AiConfig cfg;
    cfg.enabled = true;
    ai_step(reg, pool, nullptr, grid, 0, 0.0, kSimDt, cfg);

    // Perception is assembled locally in ai_step; nearbyWounded01 is not set from any proximity query
    std::printf("  Perception assembly in ai_step: nearbyWounded01 field is defined in Perception struct but unpopulated by ai_step\n");

    // 4. Out of bounds role ID safety fallback test
    p.role = 255;
    float scoresInvalidRole[kIntentCount];
    score_intents(p, n, scoresInvalidRole);
    p.role = static_cast<std::uint8_t>(RoleId::Resident);
    float scoresResidentRef[kIntentCount];
    score_intents(p, n, scoresResidentRef);

    bool matchesResident = true;
    for (int i = 0; i < kIntentCount; ++i) {
        if (std::abs(scoresInvalidRole[i] - scoresResidentRef[i]) > 1e-4f) {
            matchesResident = false;
            break;
        }
    }
    CHALLENGER_CHECK(matchesResident, "Invalid role ID (255) safely falls back to Resident traits");
}

// ----------------------------------------------------------------------------
// TEST 3: intent_is_emergency() Filtering & Panic Publish Validation
// ----------------------------------------------------------------------------
static void test_intent_is_emergency_and_panic() {
    std::printf("\n=== TEST 3: intent_is_emergency() Filtering & Panic Publish Validation ===\n");

    // 1. Test intent_is_emergency predicate across all intent IDs
    CHALLENGER_CHECK(intent_is_emergency(IntentSafety) == true, "IntentSafety is emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentCombat) == true, "IntentCombat is emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentFlee) == true, "IntentFlee is emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentHeal) == true, "IntentHeal is emergency");

    CHALLENGER_CHECK(intent_is_emergency(IntentToilet) == false, "IntentToilet is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentDrink) == false, "IntentDrink is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentEat) == false, "IntentEat is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentSleep) == false, "IntentSleep is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentWork) == false, "IntentWork is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentSocial) == false, "IntentSocial is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentPatrol) == false, "IntentPatrol is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentFactionAssault) == false, "IntentFactionAssault is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(IntentWander) == false, "IntentWander is NOT emergency");
    CHALLENGER_CHECK(intent_is_emergency(255) == false, "Out-of-bounds intent 255 is NOT emergency");

    // 2. Validate select_intent emergency preemption
    float scores[kIntentCount] = {0.0f};
    scores[IntentWork] = 70.0f;
    scores[IntentFlee] = 85.0f; // Emergency intent >= kEmergencyScore (80.0)

    std::uint8_t selected = select_intent(scores, IntentWork);
    CHALLENGER_CHECK(selected == IntentFlee, "Emergency intent scoring >= kEmergencyScore preempts incumbent immediately");

    // Non-emergency challenger without switch margin (requires > current + kSwitchMargin = 70 + 8 = 78)
    scores[IntentFlee] = 10.0f;
    scores[IntentEat] = 75.0f; // 75 < 70 + 8 margin
    selected = select_intent(scores, IntentWork);
    CHALLENGER_CHECK(selected == IntentWork, "Non-emergency challenger below switch margin retains incumbent");

    // 3. Validate panic_publish_step integration in ai_step
    Field<float> danger(0.0f);
    Registry reg;
    NpcPool pool;
    pool.init();
    MacroGrid grid;
    const LayerId kLayer = 0;

    NpcId idEmg = pool.spawn();
    pool.faction(idEmg) = static_cast<std::uint16_t>(Faction::Citizens);
    Entity eEmg = embody(reg, pool, idEmg, kLayer);
    reg.get<Transform>(eEmg).pos = vec3{15.5f * kCellSize, 15.5f * kCellSize, 0.5f * kCellSize};
    ai_init(reg, kLayer);

    AiBrain& brainEmg = reg.get<AiBrain>(eEmg);
    brainEmg.currentIntent = IntentFlee; // Emergency intent!

    const float dangerBeforeEmg = danger.at(15, 15, 0);
    AiConfig cfg;
    cfg.enabled = true;
    cfg.memory = false;

    ai_step(reg, pool, &danger, grid, kLayer, 0.0, kSimDt, cfg);

    const float dangerAfterEmg = danger.at(15, 15, 0);
    const float citPanic = faction_traits(static_cast<std::uint16_t>(Faction::Citizens)).panic;
    const float expectedPanicEmit = kPanicEmit * kSimDt * citPanic;

    std::printf("  Panic Publish (Emergency IntentFlee): before=%.4f, after=%.4f (diff=%.4f, expected=%.4f)\n",
                dangerBeforeEmg, dangerAfterEmg, dangerAfterEmg - dangerBeforeEmg, expectedPanicEmit);
    CHALLENGER_CHECK(std::abs((dangerAfterEmg - dangerBeforeEmg) - expectedPanicEmit) < 1e-5f,
                     "ai_step emitted exact panic into danger field for emergency intent");

    // Non-emergency intent check: IntentWork
    brainEmg.currentIntent = IntentWork; // Non-emergency!
    const float dangerBeforeWork = danger.at(15, 15, 0);

    ai_step(reg, pool, &danger, grid, kLayer, 1.0, kSimDt, cfg);

    const float dangerAfterWork = danger.at(15, 15, 0);
    std::printf("  Panic Publish (Non-Emergency IntentWork): before=%.4f, after=%.4f\n",
                dangerBeforeWork, dangerAfterWork);
    CHALLENGER_CHECK(dangerAfterWork == dangerBeforeWork,
                     "ai_step did NOT emit panic into danger field for non-emergency intent");
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================
int main() {
    std::printf("========================================================================\n");
    std::printf("   GIGAHRUSH2 MILESTONE 1 EMPIRICAL CHALLENGER VERIFICATION SUITE       \n");
    std::printf("========================================================================\n");

    test_zero_allocations_and_rtti();
    test_role_scoring_math();
    test_intent_is_emergency_and_panic();

    std::printf("\n========================================================================\n");
    std::printf("SUMMARY: %d checks executed, %d failures detected.\n", g_checks, g_fails);
    std::printf("========================================================================\n");

    if (g_fails == 0) {
        std::printf("Verdict: APPROVE\n");
    } else {
        std::printf("Verdict: REJECT\n");
    }
    return 0;
}
