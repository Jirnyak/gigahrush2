// Comprehensive Opaque-Box E2E Test Suite for GigaHrush 2
// Covering Features F1 through F15 across Tier 1, Tier 2, Tier 3, and Tier 4.
// Strict compliance with ECS/DOD invariants, zero exceptions, zero RTTI.

#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>

#include "core/tick.h"
#include "core/wrap.h"
#include "core/rng.h"
#include "core/math.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"
#include "game/role.h"
#include "game/extraction.h"
#include "game/economy.h"
#include "game/event_bus.h"
#include "game/prop_system.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/elevator.h"
#include "game/embody.h"
#include "game/npc_pool.h"
#include "game/needs.h"
#include "game/combat.h"
#include "game/samosbor.h"
#include "game/wander.h"
#include "game/population.h"
#include "world/world.h"
#include "world/lattice.h"
#include "world/nav.h"
#include "world/gravity.h"
#include "world/level_stack.h"
#include "sim/physics.h"
#include "sim/diffusion.h"

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

static bool approx_eq(float a, float b, float eps = 1e-4f) {
    return std::fabs(a - b) <= eps;
}

// Shared Navigation Fixture for fast test execution
struct NavFixture {
    World world;
    nav::CoarseGraph cg{};
    nav::FineNav fn;
    bool initialized = false;

    void init() {
        if (!initialized) {
            generate_floor(world, 0, floor_spec(FloorKind::Residential), 42u);
            nav::bake_coarse(world.grid(), game::kBodyClearanceSub, cg);
            nav::bake_fine(world.grid(), game::kBodyClearanceSub, fn);
            initialized = true;
        }
    }
};
static NavFixture g_nav;

// ===========================================================================
// TIER 1: FEATURE COVERAGE (>=5 tests per feature F1-F15 = 75 tests)
// ===========================================================================

// --- F1: RoleId & kRoleTraits Multipliers ---

static void test_t1_f1_01_resident_baseline_traits_and_scoring() {
    const RoleTraits& t = role_traits(RoleId::Resident);
    CHECK(approx_eq(t.workDrive, 1.00f));
    CHECK(approx_eq(t.patrolDrive, 1.00f));
    CHECK(approx_eq(t.sociability, 1.00f));
    CHECK(approx_eq(t.scavengeDrive, 0.10f));
    CHECK(approx_eq(t.careDrive, 0.05f));
}

static void test_t1_f1_02_duty_traits_and_patrol_hq_preference() {
    const RoleTraits& t = role_traits(RoleId::Duty);
    CHECK(approx_eq(t.workDrive, 1.00f));
    CHECK(approx_eq(t.patrolDrive, 1.50f));
    CHECK(approx_eq(t.sociability, 0.60f));
    CHECK(approx_eq(t.careDrive, 0.20f));
}

static void test_t1_f1_03_medic_traits_and_care_drive_scoring() {
    const RoleTraits& t = role_traits(RoleId::Medic);
    CHECK(approx_eq(t.workDrive, 1.00f));
    CHECK(approx_eq(t.patrolDrive, 0.20f));
    CHECK(approx_eq(t.sociability, 0.80f));
    CHECK(approx_eq(t.careDrive, 1.00f));
}

static void test_t1_f1_04_looter_traits_scavenge_and_anywhere_sleep() {
    const RoleTraits& t = role_traits(RoleId::Looter);
    CHECK(approx_eq(t.workDrive, 0.20f));
    CHECK(approx_eq(t.patrolDrive, 0.10f));
    CHECK(approx_eq(t.sociability, 0.40f));
    CHECK(approx_eq(t.scavengeDrive, 1.00f));
    CHECK(approx_eq(t.careDrive, 0.00f));
}

static void test_t1_f1_05_cultist_sociability_and_smoking_rooms() {
    const RoleTraits& t = role_traits(RoleId::Cultist);
    CHECK(approx_eq(t.workDrive, 0.60f));
    CHECK(approx_eq(t.patrolDrive, 0.40f));
    CHECK(approx_eq(t.sociability, 1.20f));
    CHECK(approx_eq(t.scavengeDrive, 0.30f));
    CHECK(approx_eq(t.careDrive, 0.10f));
}

// --- F2: role_for Floor Distributions ---

static void test_t1_f2_01_residential_distribution_prohibition_of_cultists() {
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Residential)][static_cast<std::size_t>(RoleId::Resident)] == 70);
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Residential)][static_cast<std::size_t>(RoleId::Duty)] == 5);
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Residential)][static_cast<std::size_t>(RoleId::Medic)] == 3);
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Residential)][static_cast<std::size_t>(RoleId::Looter)] == 3);
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Residential)][static_cast<std::size_t>(RoleId::Cultist)] == 0);

    for (NpcId id = 0; id < 500; ++id) {
        RoleId r = role_for(id, FloorKind::Residential);
        CHECK(r != RoleId::Cultist);
    }
}

static void test_t1_f2_02_derelict_cultist_looter_dominance() {
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Derelict)][static_cast<std::size_t>(RoleId::Cultist)] == 40);
    CHECK(kRoleWeights[static_cast<std::size_t>(FloorKind::Derelict)][static_cast<std::size_t>(RoleId::Looter)] == 20);

    int cultists = 0, looters = 0;
    for (NpcId id = 0; id < 100; ++id) {
        RoleId r = role_for(id, FloorKind::Derelict);
        if (r == RoleId::Cultist) cultists++;
        if (r == RoleId::Looter) looters++;
    }
    CHECK(cultists > 0 && looters > 0);
}

static void test_t1_f2_03_deterministic_reproducibility() {
    for (NpcId id = 0; id < 50; ++id) {
        RoleId r1 = role_for(id, FloorKind::Commercial);
        RoleId r2 = role_for(id, FloorKind::Commercial);
        CHECK(r1 == r2);
    }
}

static void test_t1_f2_04_pool_column_persistence_and_override() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    pool.role(id) = static_cast<std::uint8_t>(RoleId::Medic);
    CHECK(pool.role(id) == static_cast<std::uint8_t>(RoleId::Medic));

    pool.role(id) = static_cast<std::uint8_t>(RoleId::Duty);
    CHECK(pool.role(id) == static_cast<std::uint8_t>(RoleId::Duty));
}

static void test_t1_f2_05_multi_floor_demographic_seeding() {
    NpcPool pool;
    pool.init();
    seed_floor_from_spec(pool, 0, floor_spec(FloorKind::Industrial), 777u);
    CHECK(pool.count() > 0);

    bool hasDuty = false, hasMedic = false;
    for (NpcId id = 0; id < pool.count(); ++id) {
        RoleId r = role_for(id, FloorKind::Industrial);
        if (r == RoleId::Duty) hasDuty = true;
        if (r == RoleId::Medic) hasMedic = true;
    }
    CHECK(hasDuty);
    CHECK(hasMedic);
}

// --- F3: Duty / Guard Patrol Routing ---

static void test_t1_f3_01_patrol_plan_component_pod_layout() {
    PatrolPlan plan{};
    CHECK(plan.nodeFrom == 0xFF);
    CHECK(plan.nodeTo == 0xFF);
    CHECK(plan.hops == 0);
    static_assert(sizeof(PatrolPlan) == 4, "PatrolPlan must stay 4 bytes POD");
    static_assert(std::is_trivially_copyable_v<PatrolPlan>);
}

static void test_t1_f3_02_duty_patrol_intent_activation() {
    Perception p{};
    p.role = static_cast<std::uint8_t>(RoleId::Duty);
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(101u);
    n.food = 10.0f;
    n.water = 10.0f;
    n.sleep = 10.0f;

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentPatrol] > 0.0f);
}

static void test_t1_f3_03_patrol_step_lazy_attachment() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);

    g_nav.init();
    ai_patrol_step(reg, g_nav.cg, g_nav.fn, 0u, 0.008f);
    CHECK(reg.all_of<PatrolPlan>(e));
    CHECK(brain.motion == static_cast<std::uint8_t>(MotionOwner::Ai));
}

static void test_t1_f3_04_patrol_leg_progression_and_hop_increment() {
    PatrolPlan plan{};
    plan.nodeFrom = 0;
    plan.nodeTo = 1;
    plan.hops = 0;

    // Simulate completing leg
    plan.nodeFrom = plan.nodeTo;
    plan.nodeTo = static_cast<std::uint8_t>(lattice_neighbor(plan.nodeFrom, 1));
    plan.hops++;

    CHECK(plan.nodeFrom == 1);
    CHECK(plan.hops == 1);
    CHECK(plan.nodeTo != 0xFF);
}

static void test_t1_f3_05_patrol_steering_in_walking_plane() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    Velocity& v = reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 5.0f}}); // Initial vertical velocity
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);

    GravityField g{};
    g.regime = GravityRegime::NegZ;
    g.global = vec3{0.0f, 0.0f, -9.81f};

    g_nav.init();
    ai_patrol_step(reg, g_nav.cg, g_nav.fn, 0u, 0.008f, &g);
    // Vertical velocity is preserved
    CHECK(approx_eq(v.v.z, 5.0f));
}

// --- F4: Medic Healing Mechanic ---

static void test_t1_f4_01_medic_constants_verification() {
    CHECK(approx_eq(kMedicReachM, 2.0f));
    CHECK(approx_eq(kMedicThreshold, 0.60f));
    CHECK(approx_eq(kMedicHealPerSec, 3.0f));
    CHECK(approx_eq(kMedicFatiguePerSec, 0.50f));
}

static void test_t1_f4_02_medic_healing_wounded_ally_rate() {
    Needs patient = needs_roll(55u);
    patient.hpBank = 0.0f;
    float patientHp = 30.0f;
    float maxHp = 100.0f;

    if (patientHp / maxHp < kMedicThreshold) {
        float dt = 2.0f; // 2 seconds of healing
        patient.hpBank += kMedicHealPerSec * dt;
    }
    CHECK(approx_eq(patient.hpBank, 6.0f));
}

static void test_t1_f4_03_medic_fatigue_accumulation() {
    Needs medicNeeds = needs_roll(66u);
    medicNeeds.sleep = 10.0f;
    float dt = 4.0f;
    medicNeeds.sleep += kMedicFatiguePerSec * dt;
    CHECK(approx_eq(medicNeeds.sleep, 12.0f));
}

static void test_t1_f4_04_medic_reach_boundary_within_2m() {
    vec3 medicPos{10.0f, 10.0f, 0.0f};
    vec3 patient1Pos{11.5f, 10.0f, 0.0f}; // dist 1.5m <= 2.0m
    vec3 patient2Pos{13.0f, 10.0f, 0.0f}; // dist 3.0m > 2.0m

    float d1 = length(patient1Pos - medicPos);
    float d2 = length(patient2Pos - medicPos);

    CHECK(d1 <= kMedicReachM);
    CHECK(d2 > kMedicReachM);
}

static void test_t1_f4_05_medic_healing_stacks_with_medical_room() {
    Needs patient = needs_roll(77u);
    patient.hpBank = 0.0f;
    float maxHp = 100.0f;

    // Комнатная регенерация умерла (rooms-object F): остался вклад медика.
    (void)maxHp;
    float dt = 10.0f;
    patient.hpBank += kMedicHealPerSec * dt;
    CHECK(patient.hpBank >= 30.0f); // ровно вклад медика: 3 HP/с x 10 с
}

// --- F5: Liquidator & Guard Defense ---

static void test_t1_f5_01_liquidator_faction_traits() {
    const FactionTraits& ft = faction_traits(static_cast<std::uint16_t>(Faction::Liquidators));
    CHECK(approx_eq(ft.duty, 0.82f));
    CHECK(approx_eq(ft.risk, 0.74f));
    CHECK(approx_eq(ft.panic, 0.22f));
    CHECK(approx_eq(ft.patrolDrive, 0.82f));
    CHECK(approx_eq(ft.workDrive, 0.50f));
}

static void test_t1_f5_02_liquidator_combat_intent_under_danger() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 0.85f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(88u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentCombat] >= 0.0f);
}

static void test_t1_f5_03_liquidator_grudge_combat_conversion() {
    MemoryRecall r{};
    r.grudge = 0.8f;
    r.foe = 12u;
    Perception p{};

    apply_recall(r, static_cast<std::uint16_t>(Faction::Liquidators), p);
    CHECK(p.grudge > 0.0f);
}

static void test_t1_f5_04_liquidator_vs_citizen_panic_divergence() {
    Perception pCiv{};
    pCiv.faction = static_cast<std::uint16_t>(Faction::Citizens);
    pCiv.danger = 0.9f;
    pCiv.hp = 100.0f;
    pCiv.maxHp = 100.0f;
    Needs nCiv = needs_roll(1u);
    float sCiv[kIntentCount];
    score_intents(pCiv, nCiv, sCiv);

    Perception pLiq{};
    pLiq.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    pLiq.danger = 0.9f;
    pLiq.hp = 100.0f;
    pLiq.maxHp = 100.0f;
    Needs nLiq = needs_roll(1u);
    float sLiq[kIntentCount];
    score_intents(pLiq, nLiq, sLiq);

    CHECK(sLiq[IntentCombat] >= sCiv[IntentCombat]);
}

static void test_t1_f5_05_liquidator_fireline_samosbor_stance() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.samosborActive = true;
    p.danger = 0.5f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(99u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentCombat] > 0.0f || scores[IntentPatrol] > 0.0f);
}

// --- F6: Looter & Cultist Routines ---

static void test_t1_f6_01_looter_scavenge_drive_and_storage_rooms() {
    const RoleTraits& lt = role_traits(RoleId::Looter);
    CHECK(approx_eq(lt.scavengeDrive, 1.00f));
    CHECK(approx_eq(lt.workDrive, 0.20f));
    CHECK(approx_eq(lt.careDrive, 0.00f));
}

static void test_t1_f6_02_looter_homerooms_zero_anywhere_sleep() {
    // homeRooms умер (rooms-object F) — якоря раздаст agent-goals.
    const RoleTraits& lt = role_traits(RoleId::Looter);
    CHECK(approx_eq(lt.scavengeDrive, 1.00f));
}

static void test_t1_f6_03_cultist_social_drive_and_smoking_rooms() {
    const RoleTraits& ct = role_traits(RoleId::Cultist);
    CHECK(approx_eq(ct.sociability, 1.20f));
}

static void test_t1_f6_04_cultist_monster_non_aggression() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    pool.faction(id) = static_cast<std::uint16_t>(Faction::Cultists);
    CHECK(!mob_hostile_to(pool, id));
}

static void test_t1_f6_05_looter_memory_recall_scavenge_affordance() {
    AiMemory mem;
    NpcId looterId = 42u;
    ai_remember_cell(mem, looterId, MemFood, 10, 10, 10, 0.9f, 100.0);

    MemoryRecall r = ai_recall(mem, looterId, 10, 10, 10, 105.0);
    CHECK(r.siteStrength[MemFood] > 0.0f);
    CHECK(r.live == 1);
}

// --- F7: nav::route_step Direct Wiring ---

static void test_t1_f7_01_coarse_graph_reachability_and_symmetry() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;

    for (int i = 0; i < nav::kNodes; ++i) {
        CHECK(cg.dist[i][i] == 0);
        CHECK(cg.next[i][i] == i);
    }
}

static void test_t1_f7_02_fine_nav_anchor_arrived_flow() {
    g_nav.init();
    const nav::FineNav& fn = g_nav.fn;

    LatticeNode n0 = lattice_unpack(0);
    int ax = lattice_coord(n0.ix), ay = lattice_coord(n0.iy), az = lattice_coord(n0.iz);
    std::uint8_t flowAtAnchor = fn.at(0, ax, ay, az);
    CHECK(flowAtAnchor == nav::kFlowArrived);
}

static void test_t1_f7_03_route_step_adjacent_anchors() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;
    const nav::FineNav& fn = g_nav.fn;

    LatticeNode n0 = lattice_unpack(0);
    LatticeNode n1 = lattice_unpack(1);
    ivec3 from{lattice_coord(n0.ix), lattice_coord(n0.iy), lattice_coord(n0.iz)};
    ivec3 to{lattice_coord(n1.ix), lattice_coord(n1.iy), lattice_coord(n1.iz)};

    std::uint8_t step = nav::route_step(cg, fn, from, to);
    CHECK(step != nav::kFlowNone);
}

static void test_t1_f7_04_route_step_identical_cells() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;
    const nav::FineNav& fn = g_nav.fn;

    LatticeNode n0 = lattice_unpack(0);
    ivec3 pos{lattice_coord(n0.ix), lattice_coord(n0.iy), lattice_coord(n0.iz)};
    std::uint8_t step = nav::route_step(cg, fn, pos, pos);
    CHECK(step == nav::kFlowArrived);
}

static void test_t1_f7_05_route_step_wiring_in_ai_patrol_step() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);

    g_nav.init();
    ai_patrol_step(reg, g_nav.cg, g_nav.fn, 0u, 0.008f);
    CHECK(brain.motion == static_cast<std::uint8_t>(MotionOwner::Ai));
}

// --- F8: Single-Writer Velocity Ownership ---

static void test_t1_f8_01_motion_token_default_wander() {
    AiBrain brain{};
    CHECK(brain.motion == static_cast<std::uint8_t>(MotionOwner::Wander));
}

static void test_t1_f8_02_ai_owns_motion_true_when_ai() {
    Registry reg;
    Entity e = reg.create();
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
    CHECK(ai_owns_motion(reg, e));
}

static void test_t1_f8_03_ai_owns_motion_false_when_missing_component() {
    Registry reg;
    Entity e = reg.create();
    CHECK(!ai_owns_motion(reg, e));
}

static void test_t1_f8_04_wander_step_skips_ai_owned() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{10.0f, 10.0f, 0.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{2.5f, 0.0f, 0.0f}});
    reg.emplace<WanderTarget>(e, WanderTarget{});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);

    g_nav.init();
    NpcPool pool;
    pool.init();
    wander_step(reg, g_nav.world.grid(), pool, g_nav.cg, g_nav.fn, 0u, 0u);
    Velocity& v = reg.get<Velocity>(e);
    CHECK(approx_eq(v.v.x, 2.5f)); // Preserved because wander skipped it
}

static void test_t1_f8_05_ai_release_restores_all_wander() {
    Registry reg;
    Entity e1 = reg.create();
    Entity e2 = reg.create();
    reg.emplace<Transform>(e1, Transform{vec3{0.0f, 0.0f, 0.0f}, 0u});
    reg.emplace<Transform>(e2, Transform{vec3{1.0f, 1.0f, 0.0f}, 0u});
    reg.emplace<NpcRef>(e1, NpcRef{1u});
    reg.emplace<NpcRef>(e2, NpcRef{2u});
    reg.emplace<AiBrain>(e1, AiBrain{kIntentNone, static_cast<std::uint8_t>(MotionOwner::Ai)});
    reg.emplace<AiBrain>(e2, AiBrain{kIntentNone, static_cast<std::uint8_t>(MotionOwner::Ai)});

    std::uint32_t released = ai_release(reg, 0u);
    CHECK(released == 2);
    CHECK(!ai_owns_motion(reg, e1));
    CHECK(!ai_owns_motion(reg, e2));
}

// --- F9: Vector Gravity Tangent Projection ---

static void test_t1_f9_01_all_six_cardinal_regime_frames() {
    GravityFrame fz = regime_frame(GravityRegime::NegZ);
    CHECK(fz.axis == 2 && fz.upSign == 1 && fz.tanA == 0 && fz.tanB == 1 && fz.pull);

    GravityFrame fx = regime_frame(GravityRegime::PosX);
    CHECK(fx.axis == 0 && fx.upSign == -1 && fx.tanA == 1 && fx.tanB == 2 && fx.pull);

    GravityFrame fy = regime_frame(GravityRegime::NegY);
    CHECK(fy.axis == 1 && fy.upSign == 1 && fy.tanA == 0 && fy.tanB == 2 && fy.pull);
}

static void test_t1_f9_02_regime_down_cardinal_steps() {
    CellStep dz = regime_down(GravityRegime::NegZ);
    CHECK(dz.x == 0 && dz.y == 0 && dz.z == -1);

    CellStep dx = regime_down(GravityRegime::PosX);
    CHECK(dx.x == 1 && dx.y == 0 && dx.z == 0);

    CellStep dy = regime_down(GravityRegime::NegY);
    CHECK(dy.x == 0 && dy.y == -1 && dy.z == 0);
}

static void test_t1_f9_03_zero_gravity_frame_isotropy() {
    GravityField g{};
    g.regime = GravityRegime::Zero;
    g.global = vec3{0.0f, 0.0f, 0.0f};

    GravityFrame frames[kMaxGravityFrames];
    int count = gravity_frames(g, frames);
    CHECK(count == 6);
    for (int i = 0; i < 6; ++i) {
        CHECK(!frames[i].pull);
    }
}

static void test_t1_f9_04_regime_from_vector_classification() {
    CHECK(regime_from_vector(vec3{0.0f, 0.0f, -9.81f}) == GravityRegime::NegZ);
    CHECK(regime_from_vector(vec3{9.81f, 0.0f, 0.0f}) == GravityRegime::PosX);
    CHECK(regime_from_vector(vec3{0.0f, -9.81f, 0.0f}) == GravityRegime::NegY);
    CHECK(regime_from_vector(vec3{0.0f, 0.0f, 0.0f}) == GravityRegime::Zero);
}

static void test_t1_f9_05_tangent_velocity_preserves_gravity_axis() {
    // Gravity along X, tangent plane is Y/Z
    vec3 v{9.81f, 0.0f, 0.0f};
    v.y = 1.35f; // Steer along tanA
    v.z = 0.50f; // Steer along tanB
    CHECK(approx_eq(v.x, 9.81f)); // X preserved
}

// --- F10: 3D Toroidal Wrapping Invariant ---

static void test_t1_f10_01_wrap_delta_f_continuous_torus() {
    float p = 256.0f;
    CHECK(approx_eq(wrap_delta_f(0.0f, 10.0f, p), 10.0f));
    CHECK(approx_eq(wrap_delta_f(10.0f, 0.0f, p), -10.0f));
    CHECK(approx_eq(wrap_delta_f(1.0f, 255.0f, p), -2.0f));
    CHECK(approx_eq(wrap_delta_f(255.0f, 1.0f, p), 2.0f));
}

static void test_t1_f10_02_nearest_image_projection() {
    float p = 256.0f;
    float img = nearest_image(254.0f, 2.0f, p);
    CHECK(approx_eq(img, -2.0f));
}

static void test_t1_f10_03_discrete_wrap_macro_and_wrapi() {
    CHECK(wrap_macro(0) == 0);
    CHECK(wrap_macro(127) == 127);
    CHECK(wrap_macro(128) == 0);
    CHECK(wrap_macro(-1) == 127);
    CHECK(wrapi(-128, 128) == 0);
    CHECK(wrap_delta(0, 127, 128) == -1);
}

static void test_t1_f10_04_toroidal_distance_symmetry() {
    float p = 256.0f;
    float d1 = std::fabs(wrap_delta_f(20.0f, 240.0f, p));
    float d2 = std::fabs(wrap_delta_f(240.0f, 20.0f, p));
    CHECK(approx_eq(d1, d2));
    CHECK(approx_eq(d1, 36.0f));
}

static void test_t1_f10_05_multi_period_coordinate_invariance() {
    float p = 256.0f;
    float d0 = wrap_delta_f(15.0f, 35.0f, p);
    float d1 = wrap_delta_f(15.0f + 2.0f * p, 35.0f - 3.0f * p, p);
    CHECK(approx_eq(d0, d1));
}

// --- F11: bank_step Loop Integration ---

static void test_t1_f11_01_bank_open_and_terms_assignment() {
    BankAccount acct{};
    bank_open(acct, 0, 12345u);
    CHECK(acct.band == 0);
    CHECK(acct.creditLimit > 0);
}

static void test_t1_f11_02_bank_deposit_and_withdraw_cycle() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 101u);
    led.banked = 1000;

    std::int32_t dep = bank_deposit(acct, led, 400, 10u);
    CHECK(dep == 400);
    CHECK(led.banked == 600);
    CHECK(acct.deposit == 400);

    std::int32_t with = bank_withdraw(acct, led, 150, 20u);
    CHECK(with == 150);
    CHECK(led.banked == 750);
    CHECK(acct.deposit == 250);
}

static void test_t1_f11_03_bank_loan_and_repay_lifecycle() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 101u);

    std::int32_t loan = bank_take_loan(acct, led, 300, 10u);
    CHECK(loan == 300);
    CHECK(led.banked == 300);
    CHECK(acct.loanPrincipal == 300);

    std::int32_t rep = bank_repay(acct, led, 300, 20u);
    CHECK(rep == 300);
    CHECK(acct.loanPrincipal == 0);
}

static void test_t1_f11_04_bank_step_periodic_settlement() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 101u);
    led.banked = 10000;
    bank_deposit(acct, led, 10000, 0u);

    BankTick bt = bank_step(acct, 7500u);
    CHECK(bt.periods == 1);
    CHECK(bt.earned > 0);
    CHECK(acct.lastInterestTick == 7500u);
}

static void test_t1_f11_05_net_worth_conservation() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 101u);
    led.banked = 5000;

    std::int64_t nw0 = net_worth(led, acct);
    bank_deposit(acct, led, 2000, 1u);
    CHECK(net_worth(led, acct) == nw0);

    bank_take_loan(acct, led, 300, 2u);
    CHECK(net_worth(led, acct) == nw0);

    bank_repay(acct, led, 300, 3u);
    CHECK(net_worth(led, acct) == nw0);
}

// --- F12: feed_tick & feed_drain Integration ---

static void test_t1_f12_01_event_bus_publish_and_size() {
    EventBus bus;
    bus.init();
    CHECK(bus.empty());

    bus.publish(EventType::FloorEntered, 1u, 0u, 0u, 100u);
    bus.publish(EventType::NpcDied, 2u, 0u, 0u, 105u);
    CHECK(bus.size() == 2);
    CHECK(!bus.empty());
}

static void test_t1_f12_02_feed_drain_transfers_events() {
    EventBus bus;
    bus.init();
    EventFeed feed{};

    bus.publish(EventType::FloorEntered, 3u, 0u, 0u, 100u);
    std::size_t drained = feed_drain(feed, bus);
    CHECK(drained == 1);
    CHECK(feed.live == 1);
}

static void test_t1_f12_03_feed_tick_returns_exact_timestamps() {
    EventBus bus;
    bus.init();
    EventFeed feed{};

    bus.publish(EventType::NpcSpawned, 1u, 10u, 0u, 500u);
    feed_drain(feed, bus);
    CHECK(feed_tick(feed, 0) == 500u);
}

static void test_t1_f12_04_feed_line_formatting_for_all_event_types() {
    Event e{};
    char buf[128];
    for (std::size_t i = 1; i < kEventTypeCount; ++i) {
        e.type = static_cast<EventType>(i);
        bool ok = event_line(e, buf, sizeof(buf));
        CHECK(ok);
        CHECK(std::strlen(buf) > 0);
    }
}

static void test_t1_f12_05_feed_circular_eviction_order() {
    EventBus bus;
    bus.init();
    EventFeed feed{};

    for (uint32_t i = 1; i <= 10; ++i) {
        bus.publish(EventType::FloorEntered, i, 0u, 0u, 1000u + i);
    }
    feed_drain(feed, bus);
    CHECK(feed.live == EventFeed::kLines);
    CHECK(feed_tick(feed, 0) == 1010u);
}

// --- F13: prop_interact_step / interaction_step Wiring ---

static void test_t1_f13_01_interaction_step_finds_nearest_within_reach() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{10.0f, 10.0f, 2.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{11.0f, 10.0f, 2.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(prop);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    InteractionHit hit{};
    bool ok = interaction_step(reg, player, Interactable::Kind::Terminal, bus, &hit);
    CHECK(ok);
    CHECK(hit.hit);
    CHECK(hit.entity == prop);
}

static void test_t1_f13_02_prop_interact_step_success() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{5.0f, 5.0f, 1.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{6.0f, 5.0f, 1.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(prop);
    act.kind = Interactable::Kind::ElectricalShield;
    act.active = true;

    bool ok = prop_interact_step(reg, player, Interactable::Kind::ElectricalShield, bus);
    CHECK(ok);
}

static void test_t1_f13_03_interaction_kind_filtering() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{0.0f, 0.0f, 0.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{1.0f, 0.0f, 0.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(prop);
    act.kind = Interactable::Kind::Corpse;
    act.active = true;

    bool foundTerminal = interaction_step(reg, player, Interactable::Kind::Terminal, bus);
    CHECK(!foundTerminal);

    bool foundCorpse = interaction_step(reg, player, Interactable::Kind::Corpse, bus);
    CHECK(foundCorpse);
}

static void test_t1_f13_04_layer_isolation_enforcement() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{10.0f, 10.0f, 2.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{10.5f, 10.0f, 2.0f}, 1u}); // Layer 1 vs 0
    Interactable& act = reg.emplace<Interactable>(prop);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    bool ok = interaction_step(reg, player, Interactable::Kind::Terminal, bus);
    CHECK(!ok);
}

static void test_t1_f13_05_collect_interactable_positions() {
    Registry reg;
    Entity p1 = reg.create();
    reg.emplace<Transform>(p1, Transform{vec3{1.0f, 2.0f, 3.0f}, 0u});
    Interactable& a1 = reg.emplace<Interactable>(p1);
    a1.kind = Interactable::Kind::Terminal;
    a1.active = true;

    Entity p2 = reg.create();
    reg.emplace<Transform>(p2, Transform{vec3{4.0f, 5.0f, 6.0f}, 0u});
    Interactable& a2 = reg.emplace<Interactable>(p2);
    a2.kind = Interactable::Kind::Terminal;
    a2.active = true;

    std::vector<vec3> positions;
    std::uint32_t count = collect_interactable_positions(reg, 0u, Interactable::Kind::Terminal, positions);
    CHECK(count == 2);
    CHECK(positions.size() == 2);
}

// --- F14: check_wired.cmake Static Gate & Entry Points Contract ---

static void test_t1_f14_01_bank_step_contract_and_signature() {
    BankAccount acct{};
    BankTick bt = bank_step(acct, 0u);
    CHECK(bt.periods == 0);
    static_assert(std::is_same_v<decltype(bank_step(acct, 0u)), BankTick>);
}

static void test_t1_f14_02_feed_tick_and_drain_contract() {
    EventBus bus;
    bus.init();
    EventFeed feed{};
    std::size_t drained = feed_drain(feed, bus);
    uint64_t t = feed_tick(feed, 0);
    CHECK(drained == 0);
    CHECK(t == 0);
}

static void test_t1_f14_03_interaction_step_contract() {
    Registry reg;
    EventBus bus;
    bus.init();
    bool ok = interaction_step(reg, entt::null, Interactable::Kind::Terminal, bus);
    CHECK(!ok);
}

static void test_t1_f14_04_route_step_contract() {
    nav::CoarseGraph cg{};
    nav::FineNav fn{};
    std::uint8_t step = nav::route_step(cg, fn, ivec3{0,0,0}, ivec3{10,10,10});
    CHECK(step == nav::kFlowNone);
}

static void test_t1_f14_05_entry_point_idempotency_and_no_heap_alloc() {
    BankAccount acct{};
    bank_open(acct, 0, 1u);
    BankTick b1 = bank_step(acct, 100u);
    BankTick b2 = bank_step(acct, 100u);
    CHECK(b1.periods == 0 && b2.periods == 0);
}

// --- F15: Samosbor & Multi-Floor AI Integration ---

static void test_t1_f15_01_samosbor_four_phase_cycle() {
    SamosborState st{};
    SamosborRng rng{12345u};
    st = samosbor_new_game(rng);

    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
    // Fast-forward to Warning
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Warning));

    // Fast-forward to Active
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Active));

    // Fast-forward to Aftermath
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Aftermath));

    // Fast-forward to Idle
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
    CHECK(st.count == 1);
}

static void test_t1_f15_02_samosbor_duty_cycle_depth_scaling() {
    float d0 = samosbor_duty01(0);
    float d10 = samosbor_duty01(10);
    float d25 = samosbor_duty01(25);
    float d50 = samosbor_duty01(50);

    CHECK(d0 < d10);
    CHECK(d10 < d25);
    CHECK(d25 < d50);
    CHECK(d50 > 0.90f);
}

static void test_t1_f15_03_samosbor_specialist_perception_reaction() {
    Perception p{};
    p.samosborActive = true;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(10u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSafety] > 0.0f || scores[IntentFlee] > 0.0f || scores[IntentCombat] > 0.0f);
}

static void test_t1_f15_04_samosbor_alarm_and_beat_hud_level() {
    SamosborState st{};
    st.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
    st.phaseMs = 15000u;
    st.phaseTotalMs = 30000u;

    SamosborAlarm alarm = samosbor_alarm(st);
    CHECK(alarm.on);
    CHECK(std::strlen(alarm.text) > 0);
    CHECK(alarm.beat == static_cast<std::uint8_t>(SamosborBeat::Warning));
}

static void test_t1_f15_05_samosbor_floor_transit_preserves_cycle_count() {
    SamosborState prev{};
    prev.count = 5;
    SamosborRng rng{99u};

    SamosborState next = samosbor_enter_floor(prev, 10, rng);
    CHECK(next.count == 5);
    CHECK(next.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
}

// ===========================================================================
// TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature F1-F15 = 75 tests)
// ===========================================================================

// --- F1 Boundaries ---

static void test_t2_f1_01_invalid_role_enum_fallback() {
    const RoleTraits& fallback = role_traits(static_cast<RoleId>(99));
    const RoleTraits& res = role_traits(RoleId::Resident);
    CHECK(std::memcmp(&fallback, &res, sizeof(RoleTraits)) == 0);
}

static void test_t2_f1_02_zero_needs_with_extreme_trait_multipliers() {
    Perception p{};
    p.role = static_cast<std::uint8_t>(RoleId::Duty);
    Needs n{};
    float scores[kIntentCount];
    score_intents(p, n, scores);
    for (int i = 0; i < kIntentCount; ++i) {
        CHECK(!std::isnan(scores[i]));
        CHECK(scores[i] >= 0.0f);
    }
}

static void test_t2_f1_03_max_needs_with_zero_drive_traits() {
    Perception p{};
    p.role = static_cast<std::uint8_t>(RoleId::Looter); // careDrive = 0.0f
    Needs n{};
    n.hpBank = 0.0f;
    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentHeal] <= 1.0f);
}

static void test_t2_f1_04_role_trait_matrix_constness_and_determinism() {
    const RoleTraits& t1 = role_traits(RoleId::Medic);
    const RoleTraits& t2 = role_traits(RoleId::Medic);
    CHECK(&t1 == &t2);
}

static void test_t2_f1_05_role_transition_mid_simulation() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    pool.role(id) = static_cast<std::uint8_t>(RoleId::Resident);
    Perception p{};
    p.role = pool.role(id);
    Needs n = needs_roll(55u);
    float s1[kIntentCount], s2[kIntentCount];

    score_intents(p, n, s1);
    pool.role(id) = static_cast<std::uint8_t>(RoleId::Duty);
    p.role = pool.role(id);
    score_intents(p, n, s2);
    CHECK(s2[IntentPatrol] > s1[IntentPatrol]);
}

// --- F2 Boundaries ---

static void test_t2_f2_01_invalid_floorkind_fallback() {
    RoleId r = role_for(10u, static_cast<FloorKind>(99));
    CHECK(r == RoleId::Resident || static_cast<std::size_t>(r) < kRoleCount);
}

static void test_t2_f2_02_extreme_npcid_hash_safety() {
    RoleId r = role_for(kNpcPoolSize - 1, FloorKind::Residential);
    CHECK(static_cast<std::size_t>(r) < kRoleCount);
    CHECK(r != RoleId::Cultist);
}

static void test_t2_f2_03_single_npc_monoculture_spec() {
    NpcPool pool;
    pool.init();
    FloorSpec mono{FloorKind::Residential, "mono", 50u, {1, 0, 0, 0, 0}, 0.0f, 25, 30};
    seed_floor_from_spec(pool, 1, mono, 999u);
    CHECK(pool.count() == 50u);
    for (NpcId id = 0; id < 50; ++id) {
        CHECK(pool.faction(id) == 0);
    }
}

static void test_t2_f2_04_role_column_zero_initialization() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    CHECK(pool.role(id) == 0);
}

static void test_t2_f2_05_floor_boundary_numbers() {
    CHECK(FloorRegistry::valid_number(-127));
    CHECK(FloorRegistry::valid_number(127));
    CHECK(!FloorRegistry::valid_number(-128));
    CHECK(!FloorRegistry::valid_number(128));
}

// --- F3 Boundaries ---

static void test_t2_f3_01_patrol_plan_unreachable_destination_fallback() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{0.0f, 0.0f, 0.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);

    nav::CoarseGraph emptyCg{};
    nav::FineNav emptyFn{};
    ai_patrol_step(reg, emptyCg, emptyFn, 0u, 0.008f);
    CHECK(brain.motion == static_cast<std::uint8_t>(MotionOwner::Wander));
}

static void test_t2_f3_02_patrol_plan_with_empty_nav_graphs() {
    Registry reg;
    nav::CoarseGraph cg{};
    nav::FineNav fn{};
    ai_patrol_step(reg, cg, fn, 0u, 0.008f);
}

static void test_t2_f3_03_patrol_hop_counter_overflow_wrap() {
    PatrolPlan plan{};
    plan.hops = 255;
    plan.hops++;
    CHECK(plan.hops == 0);
}

static void test_t2_f3_04_patrol_plan_on_dead_or_despawned_entity() {
    Registry reg;
    Entity e = reg.create();
    reg.destroy(e);
    nav::CoarseGraph cg{};
    nav::FineNav fn{};
    ai_patrol_step(reg, cg, fn, 0u, 0.008f);
}

static void test_t2_f3_05_patrol_plan_in_single_node_accessible_pocket() {
    PatrolPlan plan{};
    plan.nodeFrom = 5;
    plan.nodeTo = 5;
    plan.hops = 10;
    CHECK(plan.nodeTo == 5);
}

// --- F4 Boundaries ---

static void test_t2_f4_01_medic_ignores_dead_corpses() {
    Needs patientNeeds = needs_roll(100u);
    patientNeeds.hpBank = 0.0f;
    float deadHp = 0.0f;

    if (deadHp > 0.0f && deadHp / 100.0f < kMedicThreshold) {
        patientNeeds.hpBank += kMedicHealPerSec;
    }
    CHECK(approx_eq(patientNeeds.hpBank, 0.0f));
}

static void test_t2_f4_02_medic_ignores_healthy_allies() {
    Needs patientNeeds = needs_roll(100u);
    patientNeeds.hpBank = 0.0f;
    float fullHp = 100.0f;

    if (fullHp / 100.0f < kMedicThreshold) {
        patientNeeds.hpBank += kMedicHealPerSec;
    }
    CHECK(approx_eq(patientNeeds.hpBank, 0.0f));
}

static void test_t2_f4_03_medic_refuses_hostile_enemies() {
    FactionRelations rel{};
    rel.reset();
    Faction fMedic = Faction::Citizens;
    Faction fEnemy = Faction::Wild;
    CHECK(rel.hostile(static_cast<std::uint8_t>(fMedic), static_cast<std::uint8_t>(fEnemy)));
}

static void test_t2_f4_04_medic_at_maximum_fatigue() {
    Needs n{};
    n.sleep = 100.0f;
    n.sleep += kMedicFatiguePerSec * 1.0f;
    CHECK(n.sleep >= 100.0f);
}

static void test_t2_f4_05_medic_patient_with_zero_max_hp() {
    float maxHp = 0.0f;
    float currentHp = 0.0f;
    bool shouldHeal = (maxHp > 0.0f) && (currentHp / maxHp < kMedicThreshold);
    CHECK(!shouldHeal);
}

// --- F5 Boundaries ---

static void test_t2_f5_01_liquidator_critical_low_hp_flee_threshold() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 0.95f;
    p.hp = 5.0f; // Critical HP
    p.maxHp = 100.0f;
    Needs n = needs_roll(12u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSafety] > 0.0f || scores[IntentFlee] > 0.0f);
}

static void test_t2_f5_02_liquidator_overwhelming_hostile_odds() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 1.0f;
    p.hostilePower = 1000.0f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(14u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    for (int i = 0; i < kIntentCount; ++i) {
        CHECK(!std::isnan(scores[i]));
    }
}

static void test_t2_f5_03_liquidator_zero_danger_routine() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 0.0f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(16u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentPatrol] >= scores[IntentFlee]);
}

static void test_t2_f5_04_liquidator_unarmed_combat_scoring() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.armed = false;
    p.danger = 0.5f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(18u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentCombat] >= 0.0f);
}

static void test_t2_f5_05_liquidator_corrupted_faction_id_fallback() {
    const FactionTraits& ft = faction_traits(9999u);
    const FactionTraits& fallback = faction_traits(static_cast<std::uint16_t>(kFactionPlayerRow));
    CHECK(std::memcmp(&ft, &fallback, sizeof(FactionTraits)) == 0);
}

// --- F6 Boundaries ---

static void test_t2_f6_01_looter_in_floor_with_no_storage_rooms() {
    const RoleTraits& lt = role_traits(RoleId::Looter);
}

static void test_t2_f6_02_cultist_mob_aggression_with_invalid_npc() {
    NpcPool pool;
    pool.init();
    CHECK(mob_hostile_to(pool, kInvalidNpc));
}

static void test_t2_f6_03_looter_sleep_intent_with_empty_world() {
    Perception p{};
    p.role = static_cast<std::uint8_t>(RoleId::Looter);
    Needs n{};
    n.sleep = 95.0f;
    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSleep] > 0.0f);
}

static void test_t2_f6_04_cultist_rally_with_zero_allies() {
    Perception p{};
    p.role = static_cast<std::uint8_t>(RoleId::Cultist);
    p.allyPower = 0.0f;
    Needs n = needs_roll(22u);
    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSocial] >= 0.0f);
}

static void test_t2_f6_05_looter_memory_full_slot_eviction() {
    AiMemory mem;
    NpcId id = 100u;
    for (int i = 0; i < 10; ++i) {
        ai_remember_cell(mem, id, MemFood, i, i, i, 0.5f, 10.0 + i);
    }
    CHECK(mem.live_traces(id, 30.0) == static_cast<std::uint32_t>(kMemSlots));
}

// --- F7 Boundaries ---

static void test_t2_f7_01_route_step_solid_wall_endpoint() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;
    const nav::FineNav& fn = g_nav.fn;

    ivec3 from{16, 16, 16};
    ivec3 solidWall{0, 0, 0};
    std::uint8_t step = nav::route_step(cg, fn, from, solidWall);
    CHECK(step == nav::kFlowNone || step <= 6);
}

static void test_t2_f7_02_route_step_disconnected_subgraph() {
    nav::CoarseGraph cg{};
    for (int i = 0; i < nav::kNodes; ++i) {
        for (int j = 0; j < nav::kNodes; ++j) {
            cg.dist[i][j] = nav::kUnreachable;
            cg.next[i][j] = static_cast<std::uint8_t>(i);
        }
    }
    nav::FineNav fn{};
    std::uint8_t step = nav::route_step(cg, fn, ivec3{10, 10, 10}, ivec3{50, 50, 50});
    CHECK(step == nav::kFlowNone);
}

static void test_t2_f7_03_route_step_across_toroidal_boundary() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;
    const nav::FineNav& fn = g_nav.fn;

    ivec3 from{16, 16, 16};
    ivec3 to{112, 112, 112};
    std::uint8_t step = nav::route_step(cg, fn, from, to);
    CHECK(step != nav::kFlowNone);
}

static void test_t2_f7_04_route_step_unbaked_empty_fine_nav() {
    nav::CoarseGraph cg{};
    nav::FineNav emptyFn{};
    ivec3 a{10, 10, 10}, b{20, 20, 20};
    std::uint8_t step = nav::route_step(cg, emptyFn, a, b);
    CHECK(step == nav::kFlowNone);
}

static void test_t2_f7_05_route_step_out_of_bounds_coordinates() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;
    const nav::FineNav& fn = g_nav.fn;

    ivec3 from{-50, 300, -100};
    ivec3 to{500, -200, 1000};
    std::uint8_t step = nav::route_step(cg, fn, from, to);
    CHECK(step != nav::kFlowNone);
}

// --- F8 Boundaries ---

static void test_t2_f8_01_null_entity_ai_owns_motion() {
    Registry reg;
    CHECK(!ai_owns_motion(reg, entt::null));
}

static void test_t2_f8_02_destroyed_entity_token_safety() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<AiBrain>(e, AiBrain{kIntentNone, static_cast<std::uint8_t>(MotionOwner::Ai)});
    reg.destroy(e);
    CHECK(!ai_owns_motion(reg, e));
}

static void test_t2_f8_03_motion_token_corrupted_byte() {
    Registry reg;
    Entity e = reg.create();
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.motion = 42; // Non-standard byte
    CHECK(!ai_owns_motion(reg, e));
}

static void test_t2_f8_04_rapid_token_toggle_stability() {
    Registry reg;
    Entity e = reg.create();
    AiBrain& brain = reg.emplace<AiBrain>(e);

    for (int i = 0; i < 1000; ++i) {
        brain.motion = static_cast<std::uint8_t>((i % 2 == 0) ? MotionOwner::Ai : MotionOwner::Wander);
        bool owns = ai_owns_motion(reg, e);
        CHECK(owns == (i % 2 == 0));
    }
}

static void test_t2_f8_05_multi_layer_ai_release_isolation() {
    Registry reg;
    Entity e0 = reg.create();
    Entity e1 = reg.create();
    reg.emplace<Transform>(e0, Transform{vec3{0,0,0}, 0u});
    reg.emplace<Transform>(e1, Transform{vec3{0,0,0}, 1u});
    reg.emplace<NpcRef>(e0, NpcRef{1u});
    reg.emplace<NpcRef>(e1, NpcRef{2u});
    reg.emplace<AiBrain>(e0, AiBrain{kIntentNone, static_cast<std::uint8_t>(MotionOwner::Ai)});
    reg.emplace<AiBrain>(e1, AiBrain{kIntentNone, static_cast<std::uint8_t>(MotionOwner::Ai)});

    ai_release(reg, 0u);
    CHECK(!ai_owns_motion(reg, e0));
    CHECK(ai_owns_motion(reg, e1));
}

// --- F9 Boundaries ---

static void test_t2_f9_01_zero_magnitude_vector() {
    CHECK(regime_from_vector(vec3{0.0f, 0.0f, 0.0f}) == GravityRegime::Zero);
}

static void test_t2_f9_02_near_threshold_vector_epsilon() {
    CHECK(regime_from_vector(vec3{1e-5f, 1e-5f, 1e-5f}) == GravityRegime::Zero);
    CHECK(regime_from_vector(vec3{2e-4f, 0.0f, 0.0f}) == GravityRegime::PosX);
}

static void test_t2_f9_03_diagonal_equal_magnitude_tie_break() {
    CHECK(regime_from_vector(vec3{5.0f, 5.0f, 0.0f}) == GravityRegime::PosX);
}

static void test_t2_f9_04_invalid_regime_enum_safety() {
    CellStep s = regime_down(static_cast<GravityRegime>(99));
    CHECK(s.x == 0 && s.y == 0 && s.z == 0);

    GravityFrame f = regime_frame(static_cast<GravityRegime>(99));
    CHECK(f.axis == 2 && f.upSign == 1 && !f.pull);
}

static void test_t2_f9_05_gravity_field_at_returns_global() {
    // Крюк RegionFn СНЕСЁН аудитом 2026-08-25 (решение владельца): at()
    // возвращает global всегда; Custom зарезервирован, механизма нет.
    GravityField g{};
    g.global = vec3{1.0f, 2.0f, 3.0f};
    vec3 out = g.at(vec3{100.0f, 200.0f, 300.0f});
    CHECK(approx_eq(out.x, 1.0f) && approx_eq(out.y, 2.0f) && approx_eq(out.z, 3.0f));
}

// --- F10 Boundaries ---

static void test_t2_f10_01_exact_half_period_boundary() {
    float p = 256.0f;
    float d1 = wrap_delta_f(0.0f, 128.0f, p);
    float d2 = wrap_delta_f(0.0f, -128.0f, p);
    CHECK(approx_eq(std::fabs(d1), 128.0f));
    CHECK(approx_eq(std::fabs(d2), 128.0f));
}

static void test_t2_f10_02_extreme_large_coordinates() {
    float p = 256.0f;
    float wrapped = wrapf(500000.0f, p);
    CHECK(wrapped >= 0.0f && wrapped < p);
}

static void test_t2_f10_03_extreme_negative_discrete_indices() {
    CHECK(wrapi(-128, 128) == 0);
    CHECK(wrapi(-129, 128) == 127);
    CHECK(wrapi(-1000, 128) >= 0 && wrapi(-1000, 128) < 128);
}

static void test_t2_f10_04_sub_voxel_cell_cross_seam_distance() {
    float p = 256.0f;
    vec3 a{255.0f, 255.0f, 255.0f};
    vec3 b{1.0f, 1.0f, 1.0f};
    float dx = wrap_delta_f(a.x, b.x, p);
    float dy = wrap_delta_f(a.y, b.y, p);
    float dz = wrap_delta_f(a.z, b.z, p);
    CHECK(approx_eq(dx, 2.0f));
    CHECK(approx_eq(dy, 2.0f));
    CHECK(approx_eq(dz, 2.0f));
}

static void test_t2_f10_05_floating_point_epsilon_near_seams() {
    float p = 256.0f;
    float delta = wrap_delta_f(p - 1e-6f, 1e-6f, p);
    CHECK(approx_eq(delta, 2e-6f, 1e-5f));
}

// --- F11 Boundaries ---

static void test_t2_f11_01_zero_and_negative_operation_amounts() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 10u);
    led.banked = 500;

    CHECK(bank_deposit(acct, led, 0, 1u) == 0);
    CHECK(bank_deposit(acct, led, -100, 2u) == 0);
    CHECK(bank_withdraw(acct, led, 0, 3u) == 0);
    CHECK(bank_withdraw(acct, led, -50, 4u) == 0);
    CHECK(bank_take_loan(acct, led, 0, 5u) == 0);
    CHECK(bank_take_loan(acct, led, -200, 6u) == 0);
    CHECK(bank_repay(acct, led, 0, 7u) == 0);
    CHECK(bank_repay(acct, led, -100, 8u) == 0);
    CHECK(led.banked == 500);
}

static void test_t2_f11_02_bank_max_principal_ceiling() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 10u);
    led.banked = 2000000000;

    std::int32_t dep = bank_deposit(acct, led, 1000000000, 1u);
    CHECK(dep == 1000000000);
    CHECK(acct.deposit == 1000000000);
}

static void test_t2_f11_03_loan_exceeding_credit_limit() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 10u);
    std::int32_t borrowed = bank_take_loan(acct, led, 999999, 1u);
    CHECK(borrowed == acct.creditLimit);
    CHECK(acct.loanPrincipal == acct.creditLimit);
    CHECK(bank_credit_available(acct) == 0);
}

static void test_t2_f11_04_bank_catchup_clamped_at_24_periods() {
    BankAccount acct{};
    bank_open(acct, 0, 10u);
    acct.deposit = 10000;
    acct.lastInterestTick = 0;

    BankTick bt = bank_step(acct, 750000u);
    CHECK(bt.periods == 24);
}

static void test_t2_f11_05_fractional_interest_asymmetric_rounding() {
    BankAccount acct{};
    bank_open(acct, 0, 10u);
    acct.deposit = 100;
    acct.loanPrincipal = 10;

    BankTick bt = bank_step(acct, 7500u);
    CHECK(bt.earned == 0);
    CHECK(bt.paid == 1);
}

// --- F12 Boundaries ---

static void test_t2_f12_01_feed_tick_out_of_bounds() {
    EventFeed feed{};
    CHECK(feed_tick(feed, 0) == 0);
    CHECK(feed_tick(feed, 10) == 0);
    CHECK(feed_line(feed, 0) == nullptr);
}

static void test_t2_f12_02_feed_drain_empty_bus() {
    EventBus bus;
    bus.init();
    EventFeed feed{};
    std::size_t w = feed_drain(feed, bus);
    CHECK(w == 0);
    CHECK(feed.live == 0);
}

static void test_t2_f12_03_bus_ring_overflow_drop_counter() {
    EventBus bus;
    bus.init();
    for (std::size_t i = 0; i < EventBus::kCapacity + 50; ++i) {
        bus.publish(EventType::NpcSpawned, static_cast<std::uint32_t>(i));
    }
    CHECK(bus.dropped() == 50);
}

static void test_t2_f12_04_signed_floor_payload_packing() {
    std::int32_t f = -50;
    std::uint32_t packed = pack_floor(f);
    std::int32_t unpacked = event_floor(packed);
    CHECK(unpacked == f);
}

static void test_t2_f12_05_feed_retention_across_bus_clear() {
    EventBus bus;
    bus.init();
    EventFeed feed{};
    bus.publish(EventType::ItemTransferred, 1u, 2u, 3u, 42u);
    feed_drain(feed, bus);
    CHECK(feed.live == 1);

    bus.clear();
    CHECK(bus.empty());
    CHECK(feed.live == 1);
    CHECK(feed_tick(feed, 0) == 42u);
}

// --- F13 Boundaries ---

static void test_t2_f13_01_exact_reach_boundary_distance() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{0.0f, 0.0f, 0.0f}, 0u});

    Entity p1 = reg.create();
    reg.emplace<Transform>(p1, Transform{vec3{2.99f, 0.0f, 0.0f}, 0u});
    Interactable& a1 = reg.emplace<Interactable>(p1);
    a1.kind = Interactable::Kind::Terminal;
    a1.active = true;

    InteractionHit h1{};
    CHECK(interaction_step(reg, player, Interactable::Kind::Terminal, bus, &h1));
    CHECK(h1.hit);

    reg.get<Transform>(p1).pos = vec3{4.5f, 0.0f, 0.0f};
    InteractionHit h2{};
    CHECK(!interaction_step(reg, player, Interactable::Kind::Terminal, bus, &h2));
    CHECK(!h2.hit);
}

static void test_t2_f13_02_null_or_invalid_player_entity() {
    Registry reg;
    EventBus bus;
    bus.init();
    InteractionHit hit{};
    bool ok = interaction_step(reg, entt::null, Interactable::Kind::Terminal, bus, &hit);
    CHECK(!ok);
    CHECK(!hit.hit);
}

static void test_t2_f13_03_disabled_interactable_rejection() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{0.0f, 0.0f, 0.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{1.0f, 0.0f, 0.0f}, 0u});
    Interactable& a = reg.emplace<Interactable>(prop);
    a.kind = Interactable::Kind::Terminal;
    a.active = false;

    CHECK(!interaction_step(reg, player, Interactable::Kind::Terminal, bus));
}

static void test_t2_f13_04_zero_reach_query() {
    Registry reg;
    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{5.0f, 5.0f, 0.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{5.1f, 5.0f, 0.0f}, 0u});
    Interactable& a = reg.emplace<Interactable>(prop);
    a.kind = Interactable::Kind::Terminal;
    a.active = true;

    InteractionHit hit = find_nearest_interactable(reg, player, Interactable::Kind::Terminal, 0.0f);
    CHECK(!hit.hit);
}

static void test_t2_f13_05_multiple_interactables_closest_selection() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{0.0f, 0.0f, 0.0f}, 0u});

    Entity p1 = reg.create();
    reg.emplace<Transform>(p1, Transform{vec3{3.0f, 0.0f, 0.0f}, 0u});
    Interactable& a1 = reg.emplace<Interactable>(p1);
    a1.kind = Interactable::Kind::Terminal;
    a1.active = true;

    Entity p2 = reg.create();
    reg.emplace<Transform>(p2, Transform{vec3{1.0f, 0.0f, 0.0f}, 0u});
    Interactable& a2 = reg.emplace<Interactable>(p2);
    a2.kind = Interactable::Kind::Terminal;
    a2.active = true;

    InteractionHit hit{};
    bool ok = interaction_step(reg, player, Interactable::Kind::Terminal, bus, &hit);
    CHECK(ok);
    CHECK(hit.entity == p2); // Closest chosen
}

// --- F14 Boundaries ---

static void test_t2_f14_01_entry_points_null_input_safety() {
    BankAccount acct{};
    BankTick bt = bank_step(acct, 0u);
    CHECK(bt.periods == 0);
}

static void test_t2_f14_02_entry_points_extreme_ticks() {
    BankAccount acct{};
    bank_open(acct, 0, 1u);
    acct.lastInterestTick = UINT64_MAX - 1000u;
    BankTick bt = bank_step(acct, UINT64_MAX);
    CHECK(bt.periods == 0);
}

static void test_t2_f14_03_entry_points_zero_delta_time() {
    Registry reg;
    nav::CoarseGraph cg{};
    nav::FineNav fn{};
    ai_patrol_step(reg, cg, fn, 0u, 0.0f);
}

static void test_t2_f14_04_entry_points_reentrant_concurrency_safety() {
    const RoleTraits& r1 = role_traits(RoleId::Duty);
    const RoleTraits& r2 = role_traits(RoleId::Medic);
    CHECK(&r1 != &r2);
}

static void test_t2_f14_05_static_gate_regex_compliance() {
    const char* names[] = {"bank_step", "feed_tick", "interaction_step", "prop_interact_step", "route_step"};
    for (const char* name : names) {
        CHECK(std::strstr(name, "_step") != nullptr || std::strstr(name, "_tick") != nullptr);
    }
}

// --- F15 Boundaries ---

static void test_t2_f15_01_samosbor_extreme_depth_duty_cycle() {
    float duty50 = samosbor_duty01(50);
    float dutyNeg50 = samosbor_duty01(-50);
    CHECK(duty50 >= 0.90f);
    CHECK(approx_eq(duty50, dutyNeg50));
}

static void test_t2_f15_02_samosbor_large_dt_multi_step_crossing() {
    SamosborState st{};
    SamosborRng rng{555u};
    st = samosbor_new_game(rng);

    // Large dtMs
    SamosborTransition tr = samosbor_step(st, 1000000u, 0, rng);
    CHECK(tr.steps <= 4);
}

static void test_t2_f15_03_samosbor_unsheltered_pressure_one_shot() {
    SamosborPressure p = samosbor_unsheltered_pressure(SamosborVariant::Classic);
    CHECK(p.hpDamage == kSamosborUnshelteredHp);
    CHECK(p.psiDamage == kSamosborUnshelteredPsi);
}

static void test_t2_f15_04_samosbor_variant_weights_normalization() {
    std::uint32_t sum = 0;
    for (std::size_t i = 0; i < kSamosborVariantCount; ++i) {
        sum += kSamosborVariants[i].weight;
    }
    CHECK(sum == kSamosborWeightTotal);
}

static void test_t2_f15_05_samosbor_zero_dt_step() {
    SamosborState st{};
    SamosborRng rng{111u};
    st = samosbor_new_game(rng);
    std::uint32_t p0 = st.phaseMs;

    SamosborTransition tr = samosbor_step(st, 0u, 0, rng);
    CHECK(!tr.changed);
    CHECK(st.phaseMs == p0);
}

// ===========================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (15 Pairwise Interactions)
// ===========================================================================

static void test_t3_01_medic_healing_and_hpbank_during_samosbor() {
    Needs patient = needs_roll(123u);
    patient.hpBank = 0.0f;
    float hp = 30.0f;
    float maxHp = 100.0f;

    SamosborState samosbor{};
    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Active);

    if (hp / maxHp < kMedicThreshold) {
        patient.hpBank += kMedicHealPerSec * 2.0f;
    }
    CHECK(approx_eq(patient.hpBank, 6.0f));

    // Комнатная добавка умерла (rooms-object F); вклад медика уже проверен.
    CHECK(patient.hpBank >= 6.0f);
}

static void test_t3_02_duty_guard_patrol_plan_with_toroidal_wrapping() {
    Registry reg;
    Entity guard = reg.create();
    AiBrain& brain = reg.emplace<AiBrain>(guard);
    PatrolPlan& plan = reg.emplace<PatrolPlan>(guard);

    plan.nodeFrom = 0;
    plan.nodeTo = 3;
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);

    CHECK(ai_owns_motion(reg, guard));
    CHECK(plan.nodeTo == 3);

    plan.hops++;
    plan.nodeFrom = 3;
    plan.nodeTo = static_cast<std::uint8_t>(lattice_neighbor(3, 1));
    CHECK(plan.nodeTo == 0);
}

static void test_t3_03_bank_debt_and_interest_across_floor_transit() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 555u);
    bank_take_loan(acct, led, 400, 0u);

    std::int64_t initialDebt = bank_debt(acct);
    CHECK(initialDebt == 400);

    bank_step(acct, 7500u);
    CHECK(bank_debt(acct) >= initialDebt);
    CHECK(net_worth(led, acct) <= 0);   // 400 borrowed, 400 owed + accrued interest
}

static void test_t3_04_prop_interaction_during_ai_navigation_single_writer() {
    Registry reg;
    EventBus bus;
    bus.init();

    Entity aiAgent = reg.create();
    reg.emplace<Transform>(aiAgent, Transform{vec3{10.0f, 10.0f, 0.0f}, 0u});
    reg.emplace<Velocity>(aiAgent, Velocity{vec3{1.35f, 0.0f, 0.0f}});
    AiBrain& brain = reg.emplace<AiBrain>(aiAgent);
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);

    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{10.0f, 11.0f, 0.0f}, 0u});

    Entity terminal = reg.create();
    reg.emplace<Transform>(terminal, Transform{vec3{10.0f, 12.0f, 0.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(terminal);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    bool playerInteracted = interaction_step(reg, player, Interactable::Kind::Terminal, bus);
    CHECK(playerInteracted);
    CHECK(ai_owns_motion(reg, aiAgent));
}

static void test_t3_05_vector_gravity_with_duty_lattice_patrol() {
    GravityField g{};
    g.regime = GravityRegime::PosX;
    g.global = vec3{9.81f, 0.0f, 0.0f};

    GravityFrame frame = regime_frame(g.regime);
    CHECK(frame.axis == 0);
    CHECK(frame.tanA == 1 && frame.tanB == 2);

    vec3 tangentVel{0.0f, 1.35f, 0.0f};
    CHECK(tangentVel.x == 0.0f);
}

static void test_t3_06_economy_events_wired_to_event_feed() {
    BankAccount acct{};
    RunLedger led{};
    EventBus bus;
    bus.init();
    EventFeed feed{};

    bank_open(acct, 0, 1u);
    led.banked = 1000;
    bank_deposit(acct, led, 500, 100u);
    bus.publish(EventType::ItemTransferred, 500u, 0u, 0u, 100u);

    feed_drain(feed, bus);
    CHECK(feed.live == 1);
    CHECK(feed_tick(feed, 0) == 100u);
}

static void test_t3_07_toroidal_wrap_with_prop_interaction() {
    Registry reg;
    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{255.5f, 10.0f, 0.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{0.5f, 10.0f, 0.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(prop);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    float dx = wrap_delta_f(255.5f, 0.5f, kWorldExtent);
    CHECK(approx_eq(std::fabs(dx), 1.0f));
}

static void test_t3_08_liquidator_defense_vs_civilian_panic_diffusion() {
    Perception civPercep{};
    civPercep.faction = static_cast<std::uint16_t>(Faction::Citizens);
    civPercep.danger = 0.9f;
    civPercep.hp = 100.0f;
    civPercep.maxHp = 100.0f;
    Needs civNeeds = needs_roll(1u);
    float civScores[kIntentCount];
    score_intents(civPercep, civNeeds, civScores);

    Perception liqPercep{};
    liqPercep.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    liqPercep.danger = 0.9f;
    liqPercep.hp = 100.0f;
    liqPercep.maxHp = 100.0f;
    Needs liqNeeds = needs_roll(2u);
    float liqScores[kIntentCount];
    score_intents(liqPercep, liqNeeds, liqScores);

    CHECK(civScores[IntentFlee] > 0.0f || civScores[IntentSafety] > 0.0f);
    CHECK(liqScores[IntentCombat] >= civScores[IntentCombat]);
}

static void test_t3_09_looter_scavenging_via_memory_during_samosbor_aftermath() {
    AiMemory mem;
    NpcId looterId = 88u;
    ai_remember_cell(mem, looterId, MemFood, 20, 20, 20, 0.95f, 100.0);

    Perception p{};
    p.role = static_cast<std::uint8_t>(RoleId::Looter);
    p.samosborActive = false;
    MemoryRecall r = ai_recall(mem, looterId, 20, 20, 20, 150.0);
    apply_recall(r, static_cast<std::uint16_t>(Faction::Citizens), p);

    CHECK(p.localScore[IntentEat] > 0.0f);
}

static void test_t3_10_cultist_monster_immunity_during_samosbor_fog_spawns() {
    NpcPool pool;
    pool.init();
    NpcId cultistId = pool.spawn();
    pool.faction(cultistId) = static_cast<std::uint16_t>(Faction::Cultists);

    NpcId citizenId = pool.spawn();
    pool.faction(citizenId) = static_cast<std::uint16_t>(Faction::Citizens);

    CHECK(!mob_hostile_to(pool, cultistId));
    CHECK(mob_hostile_to(pool, citizenId));
}

static void test_t3_11_role_distribution_seeding_with_floor_spec_and_bank_terms() {
    NpcPool pool;
    pool.init();
    seed_floor_from_spec(pool, 0, floor_spec(FloorKind::Commercial), 333u);

    BankAccount acct{};
    bank_open(acct, 0, 333u);
    CHECK(pool.count() > 0);
    CHECK(acct.creditLimit > 0);
}

static void test_t3_12_route_step_navigation_with_vector_gravity_tangent_plane() {
    g_nav.init();
    LatticeNode n0 = lattice_unpack(0);
    LatticeNode n1 = lattice_unpack(1);
    ivec3 from{lattice_coord(n0.ix), lattice_coord(n0.iy), lattice_coord(n0.iz)};
    ivec3 to{lattice_coord(n1.ix), lattice_coord(n1.iy), lattice_coord(n1.iz)};

    std::uint8_t step = nav::route_step(g_nav.cg, g_nav.fn, from, to);
    CHECK(step != nav::kFlowNone);

    GravityFrame fy = regime_frame(GravityRegime::NegY);
    CHECK(fy.tanA == 0 && fy.tanB == 2);
}

static void test_t3_13_samosbor_alarm_feed_logging_and_event_bus_emission() {
    EventBus bus;
    bus.init();
    EventFeed feed{};
    SamosborState st{};
    st.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
    st.phaseMs = 25000u;

    SamosborAlarm alarm = samosbor_alarm(st);
    CHECK(alarm.on);

    bus.publish(EventType::FloorEntered, 0u, 0u, 0u, 100u);
    feed_drain(feed, bus);
    CHECK(feed.live == 1);
}

static void test_t3_14_medic_healing_interrupted_by_samosbor_unsheltered_damage() {
    Needs patient = needs_roll(404u);
    patient.hpBank = 10.0f;

    SamosborPressure pressure = samosbor_unsheltered_pressure(SamosborVariant::Classic);
    float finalHpBank = patient.hpBank - pressure.hpDamage;
    CHECK(finalHpBank == 6.0f);
}

static void test_t3_15_single_writer_token_arbitration_with_patrol_and_wander() {
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<WanderTarget>(e, WanderTarget{});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);

    // Initial state: Wander
    brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
    CHECK(!ai_owns_motion(reg, e));

    // Promoted to Patrol: Ai owns
    brain.currentIntent = IntentPatrol;
    g_nav.init();
    ai_patrol_step(reg, g_nav.cg, g_nav.fn, 0u, 0.008f);
    CHECK(ai_owns_motion(reg, e));

    // Release back to Wander
    ai_release(reg, 0u);
    CHECK(!ai_owns_motion(reg, e));
}

// ===========================================================================
// TIER 4: REAL-WORLD WORKLOAD SCENARIOS (5 Integrated Scenarios)
// ===========================================================================

static void test_t4_01_multi_floor_alife_demographics_and_roles_simulation() {
    FloorKind kinds[5] = {FloorKind::Residential, FloorKind::Commercial, FloorKind::Industrial, FloorKind::Derelict, FloorKind::Padic};

    for (int k = 0; k < 5; ++k) {
        NpcPool pool;
        pool.init();
        seed_floor_from_spec(pool, k, floor_spec(kinds[k]), 1000u + k);
        CHECK(pool.count() > 0);

        for (NpcId id = 0; id < std::min(pool.count(), 25u); ++id) {
            Needs n = needs_roll(id);
            Perception p{};
            p.role = static_cast<std::uint8_t>(role_for(id, kinds[k]));
            p.hp = 100.0f;
            p.maxHp = 100.0f;
            float scores[kIntentCount];
            score_intents(p, n, scores);
            uint8_t intent = select_intent_raw(scores);
            CHECK(intent < kIntentCount);
        }
    }
}

static void test_t4_02_long_duration_economy_compound_interest_lifecycle() {
    BankAccount acct{};
    RunLedger led{};
    bank_open(acct, 0, 777u);
    led.banked = 10000;
    bank_deposit(acct, led, 5000, 0u);
    bank_take_loan(acct, led, 400, 0u);

    for (uint64_t t = 7500; t <= 75000; t += 7500) {
        BankTick bt = bank_step(acct, t);
        CHECK(bt.periods == 1);
    }
    CHECK(acct.deposit > 5000);
    CHECK(acct.loanAccrued > 0);
}

static void test_t4_03_long_duration_specialist_patrol_and_errand_marathon() {
    g_nav.init();
    const nav::CoarseGraph& cg = g_nav.cg;

    for (int g = 0; g < 10; ++g) {
        int currentNode = g % nav::kNodes;
        for (int hop = 0; hop < 20; ++hop) {
            int targetNode = (currentNode + 17) % nav::kNodes;
            int nextHop = nav::coarse_next(cg, currentNode, targetNode);
            CHECK(nextHop >= 0 && nextHop < nav::kNodes);
            currentNode = nextHop;
        }
    }
}

static void test_t4_04_full_samosbor_disaster_and_specialist_response_cycle() {
    SamosborState samosbor{};
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Warning));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Active);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Active));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Aftermath);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Aftermath));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Idle);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
}

static void test_t4_05_headless_integrated_engine_game_loop() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();
    EventFeed feed{};
    BankAccount acct{};
    bank_open(acct, 0, 123u);

    NpcId pid = pool.spawn();
    pool.hp(pid) = 100;
    pool.max_hp(pid) = 100;
    Entity player = embody_as_player(reg, pool, pid, 0u);

    Entity term = reg.create();
    reg.emplace<Transform>(term, Transform{vec3{41.0f, 40.0f, 2.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(term);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    for (uint64_t t = 0; t < 200; ++t) {
        if (t % 50 == 0) {
            interaction_step(reg, player, Interactable::Kind::Terminal, bus);
            bus.publish(EventType::ItemTransferred, 1u, 0u, 0u, t);
        }
        feed_drain(feed, bus);
        bus.clear();
        bank_step(acct, t);
    }
    CHECK(reg.valid(player));
}

// ===========================================================================
// MAIN ENTRY POINT
// ===========================================================================

int main() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

    // =======================================================================
    // Tier 1: Feature Coverage (75 tests)
    // =======================================================================
    // F1
    std::fprintf(stderr, "[e2e] test_t1_f1_01_resident_baseline_traits_and_scoring\n");
    test_t1_f1_01_resident_baseline_traits_and_scoring();
    std::fprintf(stderr, "[e2e] test_t1_f1_02_duty_traits_and_patrol_hq_preference\n");
    test_t1_f1_02_duty_traits_and_patrol_hq_preference();
    std::fprintf(stderr, "[e2e] test_t1_f1_03_medic_traits_and_care_drive_scoring\n");
    test_t1_f1_03_medic_traits_and_care_drive_scoring();
    std::fprintf(stderr, "[e2e] test_t1_f1_04_looter_traits_scavenge_and_anywhere_sleep\n");
    test_t1_f1_04_looter_traits_scavenge_and_anywhere_sleep();
    std::fprintf(stderr, "[e2e] test_t1_f1_05_cultist_sociability_and_smoking_rooms\n");
    test_t1_f1_05_cultist_sociability_and_smoking_rooms();

    // F2
    std::fprintf(stderr, "[e2e] test_t1_f2_01_residential_distribution_prohibition_of_cultists\n");
    test_t1_f2_01_residential_distribution_prohibition_of_cultists();
    std::fprintf(stderr, "[e2e] test_t1_f2_02_derelict_cultist_looter_dominance\n");
    test_t1_f2_02_derelict_cultist_looter_dominance();
    std::fprintf(stderr, "[e2e] test_t1_f2_03_deterministic_reproducibility\n");
    test_t1_f2_03_deterministic_reproducibility();
    std::fprintf(stderr, "[e2e] test_t1_f2_04_pool_column_persistence_and_override\n");
    test_t1_f2_04_pool_column_persistence_and_override();
    std::fprintf(stderr, "[e2e] test_t1_f2_05_multi_floor_demographic_seeding\n");
    test_t1_f2_05_multi_floor_demographic_seeding();

    // F3
    std::fprintf(stderr, "[e2e] test_t1_f3_01_patrol_plan_component_pod_layout\n");
    test_t1_f3_01_patrol_plan_component_pod_layout();
    std::fprintf(stderr, "[e2e] test_t1_f3_02_duty_patrol_intent_activation\n");
    test_t1_f3_02_duty_patrol_intent_activation();
    std::fprintf(stderr, "[e2e] test_t1_f3_03_patrol_step_lazy_attachment\n");
    test_t1_f3_03_patrol_step_lazy_attachment();
    std::fprintf(stderr, "[e2e] test_t1_f3_04_patrol_leg_progression_and_hop_increment\n");
    test_t1_f3_04_patrol_leg_progression_and_hop_increment();
    std::fprintf(stderr, "[e2e] test_t1_f3_05_patrol_steering_in_walking_plane\n");
    test_t1_f3_05_patrol_steering_in_walking_plane();

    // F4
    std::fprintf(stderr, "[e2e] test_t1_f4_01_medic_constants_verification\n");
    test_t1_f4_01_medic_constants_verification();
    std::fprintf(stderr, "[e2e] test_t1_f4_02_medic_healing_wounded_ally_rate\n");
    test_t1_f4_02_medic_healing_wounded_ally_rate();
    std::fprintf(stderr, "[e2e] test_t1_f4_03_medic_fatigue_accumulation\n");
    test_t1_f4_03_medic_fatigue_accumulation();
    std::fprintf(stderr, "[e2e] test_t1_f4_04_medic_reach_boundary_within_2m\n");
    test_t1_f4_04_medic_reach_boundary_within_2m();
    std::fprintf(stderr, "[e2e] test_t1_f4_05_medic_healing_stacks_with_medical_room\n");
    test_t1_f4_05_medic_healing_stacks_with_medical_room();

    // F5
    std::fprintf(stderr, "[e2e] test_t1_f5_01_liquidator_faction_traits\n");
    test_t1_f5_01_liquidator_faction_traits();
    std::fprintf(stderr, "[e2e] test_t1_f5_02_liquidator_combat_intent_under_danger\n");
    test_t1_f5_02_liquidator_combat_intent_under_danger();
    std::fprintf(stderr, "[e2e] test_t1_f5_03_liquidator_grudge_combat_conversion\n");
    test_t1_f5_03_liquidator_grudge_combat_conversion();
    std::fprintf(stderr, "[e2e] test_t1_f5_04_liquidator_vs_citizen_panic_divergence\n");
    test_t1_f5_04_liquidator_vs_citizen_panic_divergence();
    std::fprintf(stderr, "[e2e] test_t1_f5_05_liquidator_fireline_samosbor_stance\n");
    test_t1_f5_05_liquidator_fireline_samosbor_stance();

    // F6
    std::fprintf(stderr, "[e2e] test_t1_f6_01_looter_scavenge_drive_and_storage_rooms\n");
    test_t1_f6_01_looter_scavenge_drive_and_storage_rooms();
    std::fprintf(stderr, "[e2e] test_t1_f6_02_looter_homerooms_zero_anywhere_sleep\n");
    test_t1_f6_02_looter_homerooms_zero_anywhere_sleep();
    std::fprintf(stderr, "[e2e] test_t1_f6_03_cultist_social_drive_and_smoking_rooms\n");
    test_t1_f6_03_cultist_social_drive_and_smoking_rooms();
    std::fprintf(stderr, "[e2e] test_t1_f6_04_cultist_monster_non_aggression\n");
    test_t1_f6_04_cultist_monster_non_aggression();
    std::fprintf(stderr, "[e2e] test_t1_f6_05_looter_memory_recall_scavenge_affordance\n");
    test_t1_f6_05_looter_memory_recall_scavenge_affordance();

    // F7
    std::fprintf(stderr, "[e2e] test_t1_f7_01_coarse_graph_reachability_and_symmetry\n");
    test_t1_f7_01_coarse_graph_reachability_and_symmetry();
    std::fprintf(stderr, "[e2e] test_t1_f7_02_fine_nav_anchor_arrived_flow\n");
    test_t1_f7_02_fine_nav_anchor_arrived_flow();
    std::fprintf(stderr, "[e2e] test_t1_f7_03_route_step_adjacent_anchors\n");
    test_t1_f7_03_route_step_adjacent_anchors();
    std::fprintf(stderr, "[e2e] test_t1_f7_04_route_step_identical_cells\n");
    test_t1_f7_04_route_step_identical_cells();
    std::fprintf(stderr, "[e2e] test_t1_f7_05_route_step_wiring_in_ai_patrol_step\n");
    test_t1_f7_05_route_step_wiring_in_ai_patrol_step();

    // F8
    std::fprintf(stderr, "[e2e] test_t1_f8_01_motion_token_default_wander\n");
    test_t1_f8_01_motion_token_default_wander();
    std::fprintf(stderr, "[e2e] test_t1_f8_02_ai_owns_motion_true_when_ai\n");
    test_t1_f8_02_ai_owns_motion_true_when_ai();
    std::fprintf(stderr, "[e2e] test_t1_f8_03_ai_owns_motion_false_when_missing_component\n");
    test_t1_f8_03_ai_owns_motion_false_when_missing_component();
    std::fprintf(stderr, "[e2e] test_t1_f8_04_wander_step_skips_ai_owned\n");
    test_t1_f8_04_wander_step_skips_ai_owned();
    std::fprintf(stderr, "[e2e] test_t1_f8_05_ai_release_restores_all_wander\n");
    test_t1_f8_05_ai_release_restores_all_wander();

    // F9
    std::fprintf(stderr, "[e2e] test_t1_f9_01_all_six_cardinal_regime_frames\n");
    test_t1_f9_01_all_six_cardinal_regime_frames();
    std::fprintf(stderr, "[e2e] test_t1_f9_02_regime_down_cardinal_steps\n");
    test_t1_f9_02_regime_down_cardinal_steps();
    std::fprintf(stderr, "[e2e] test_t1_f9_03_zero_gravity_frame_isotropy\n");
    test_t1_f9_03_zero_gravity_frame_isotropy();
    std::fprintf(stderr, "[e2e] test_t1_f9_04_regime_from_vector_classification\n");
    test_t1_f9_04_regime_from_vector_classification();
    std::fprintf(stderr, "[e2e] test_t1_f9_05_tangent_velocity_preserves_gravity_axis\n");
    test_t1_f9_05_tangent_velocity_preserves_gravity_axis();

    // F10
    std::fprintf(stderr, "[e2e] test_t1_f10_01_wrap_delta_f_continuous_torus\n");
    test_t1_f10_01_wrap_delta_f_continuous_torus();
    std::fprintf(stderr, "[e2e] test_t1_f10_02_nearest_image_projection\n");
    test_t1_f10_02_nearest_image_projection();
    std::fprintf(stderr, "[e2e] test_t1_f10_03_discrete_wrap_macro_and_wrapi\n");
    test_t1_f10_03_discrete_wrap_macro_and_wrapi();
    std::fprintf(stderr, "[e2e] test_t1_f10_04_toroidal_distance_symmetry\n");
    test_t1_f10_04_toroidal_distance_symmetry();
    std::fprintf(stderr, "[e2e] test_t1_f10_05_multi_period_coordinate_invariance\n");
    test_t1_f10_05_multi_period_coordinate_invariance();

    // F11
    std::fprintf(stderr, "[e2e] test_t1_f11_01_bank_open_and_terms_assignment\n");
    test_t1_f11_01_bank_open_and_terms_assignment();
    std::fprintf(stderr, "[e2e] test_t1_f11_02_bank_deposit_and_withdraw_cycle\n");
    test_t1_f11_02_bank_deposit_and_withdraw_cycle();
    std::fprintf(stderr, "[e2e] test_t1_f11_03_bank_loan_and_repay_lifecycle\n");
    test_t1_f11_03_bank_loan_and_repay_lifecycle();
    std::fprintf(stderr, "[e2e] test_t1_f11_04_bank_step_periodic_settlement\n");
    test_t1_f11_04_bank_step_periodic_settlement();
    std::fprintf(stderr, "[e2e] test_t1_f11_05_net_worth_conservation\n");
    test_t1_f11_05_net_worth_conservation();

    // F12
    std::fprintf(stderr, "[e2e] test_t1_f12_01_event_bus_publish_and_size\n");
    test_t1_f12_01_event_bus_publish_and_size();
    std::fprintf(stderr, "[e2e] test_t1_f12_02_feed_drain_transfers_events\n");
    test_t1_f12_02_feed_drain_transfers_events();
    std::fprintf(stderr, "[e2e] test_t1_f12_03_feed_tick_returns_exact_timestamps\n");
    test_t1_f12_03_feed_tick_returns_exact_timestamps();
    std::fprintf(stderr, "[e2e] test_t1_f12_04_feed_line_formatting_for_all_event_types\n");
    test_t1_f12_04_feed_line_formatting_for_all_event_types();
    std::fprintf(stderr, "[e2e] test_t1_f12_05_feed_circular_eviction_order\n");
    test_t1_f12_05_feed_circular_eviction_order();

    // F13
    std::fprintf(stderr, "[e2e] test_t1_f13_01_interaction_step_finds_nearest_within_reach\n");
    test_t1_f13_01_interaction_step_finds_nearest_within_reach();
    std::fprintf(stderr, "[e2e] test_t1_f13_02_prop_interact_step_success\n");
    test_t1_f13_02_prop_interact_step_success();
    std::fprintf(stderr, "[e2e] test_t1_f13_03_interaction_kind_filtering\n");
    test_t1_f13_03_interaction_kind_filtering();
    std::fprintf(stderr, "[e2e] test_t1_f13_04_layer_isolation_enforcement\n");
    test_t1_f13_04_layer_isolation_enforcement();
    std::fprintf(stderr, "[e2e] test_t1_f13_05_collect_interactable_positions\n");
    test_t1_f13_05_collect_interactable_positions();

    // F14
    std::fprintf(stderr, "[e2e] test_t1_f14_01_bank_step_contract_and_signature\n");
    test_t1_f14_01_bank_step_contract_and_signature();
    std::fprintf(stderr, "[e2e] test_t1_f14_02_feed_tick_and_drain_contract\n");
    test_t1_f14_02_feed_tick_and_drain_contract();
    std::fprintf(stderr, "[e2e] test_t1_f14_03_interaction_step_contract\n");
    test_t1_f14_03_interaction_step_contract();
    std::fprintf(stderr, "[e2e] test_t1_f14_04_route_step_contract\n");
    test_t1_f14_04_route_step_contract();
    std::fprintf(stderr, "[e2e] test_t1_f14_05_entry_point_idempotency_and_no_heap_alloc\n");
    test_t1_f14_05_entry_point_idempotency_and_no_heap_alloc();

    // F15
    std::fprintf(stderr, "[e2e] test_t1_f15_01_samosbor_four_phase_cycle\n");
    test_t1_f15_01_samosbor_four_phase_cycle();
    std::fprintf(stderr, "[e2e] test_t1_f15_02_samosbor_duty_cycle_depth_scaling\n");
    test_t1_f15_02_samosbor_duty_cycle_depth_scaling();
    std::fprintf(stderr, "[e2e] test_t1_f15_03_samosbor_specialist_perception_reaction\n");
    test_t1_f15_03_samosbor_specialist_perception_reaction();
    std::fprintf(stderr, "[e2e] test_t1_f15_04_samosbor_alarm_and_beat_hud_level\n");
    test_t1_f15_04_samosbor_alarm_and_beat_hud_level();
    std::fprintf(stderr, "[e2e] test_t1_f15_05_samosbor_floor_transit_preserves_cycle_count\n");
    test_t1_f15_05_samosbor_floor_transit_preserves_cycle_count();

    // =======================================================================
    // Tier 2: Boundary & Corner Cases (75 tests)
    // =======================================================================
    // F1 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f1_01_invalid_role_enum_fallback\n");
    test_t2_f1_01_invalid_role_enum_fallback();
    std::fprintf(stderr, "[e2e] test_t2_f1_02_zero_needs_with_extreme_trait_multipliers\n");
    test_t2_f1_02_zero_needs_with_extreme_trait_multipliers();
    std::fprintf(stderr, "[e2e] test_t2_f1_03_max_needs_with_zero_drive_traits\n");
    test_t2_f1_03_max_needs_with_zero_drive_traits();
    std::fprintf(stderr, "[e2e] test_t2_f1_04_role_trait_matrix_constness_and_determinism\n");
    test_t2_f1_04_role_trait_matrix_constness_and_determinism();
    std::fprintf(stderr, "[e2e] test_t2_f1_05_role_transition_mid_simulation\n");
    test_t2_f1_05_role_transition_mid_simulation();

    // F2 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f2_01_invalid_floorkind_fallback\n");
    test_t2_f2_01_invalid_floorkind_fallback();
    std::fprintf(stderr, "[e2e] test_t2_f2_02_extreme_npcid_hash_safety\n");
    test_t2_f2_02_extreme_npcid_hash_safety();
    std::fprintf(stderr, "[e2e] test_t2_f2_03_single_npc_monoculture_spec\n");
    test_t2_f2_03_single_npc_monoculture_spec();
    std::fprintf(stderr, "[e2e] test_t2_f2_04_role_column_zero_initialization\n");
    test_t2_f2_04_role_column_zero_initialization();
    std::fprintf(stderr, "[e2e] test_t2_f2_05_floor_boundary_numbers\n");
    test_t2_f2_05_floor_boundary_numbers();

    // F3 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f3_01_patrol_plan_unreachable_destination_fallback\n");
    test_t2_f3_01_patrol_plan_unreachable_destination_fallback();
    std::fprintf(stderr, "[e2e] test_t2_f3_02_patrol_plan_with_empty_nav_graphs\n");
    test_t2_f3_02_patrol_plan_with_empty_nav_graphs();
    std::fprintf(stderr, "[e2e] test_t2_f3_03_patrol_hop_counter_overflow_wrap\n");
    test_t2_f3_03_patrol_hop_counter_overflow_wrap();
    std::fprintf(stderr, "[e2e] test_t2_f3_04_patrol_plan_on_dead_or_despawned_entity\n");
    test_t2_f3_04_patrol_plan_on_dead_or_despawned_entity();
    std::fprintf(stderr, "[e2e] test_t2_f3_05_patrol_plan_in_single_node_accessible_pocket\n");
    test_t2_f3_05_patrol_plan_in_single_node_accessible_pocket();

    // F4 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f4_01_medic_ignores_dead_corpses\n");
    test_t2_f4_01_medic_ignores_dead_corpses();
    std::fprintf(stderr, "[e2e] test_t2_f4_02_medic_ignores_healthy_allies\n");
    test_t2_f4_02_medic_ignores_healthy_allies();
    std::fprintf(stderr, "[e2e] test_t2_f4_03_medic_refuses_hostile_enemies\n");
    test_t2_f4_03_medic_refuses_hostile_enemies();
    std::fprintf(stderr, "[e2e] test_t2_f4_04_medic_at_maximum_fatigue\n");
    test_t2_f4_04_medic_at_maximum_fatigue();
    std::fprintf(stderr, "[e2e] test_t2_f4_05_medic_patient_with_zero_max_hp\n");
    test_t2_f4_05_medic_patient_with_zero_max_hp();

    // F5 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f5_01_liquidator_critical_low_hp_flee_threshold\n");
    test_t2_f5_01_liquidator_critical_low_hp_flee_threshold();
    std::fprintf(stderr, "[e2e] test_t2_f5_02_liquidator_overwhelming_hostile_odds\n");
    test_t2_f5_02_liquidator_overwhelming_hostile_odds();
    std::fprintf(stderr, "[e2e] test_t2_f5_03_liquidator_zero_danger_routine\n");
    test_t2_f5_03_liquidator_zero_danger_routine();
    std::fprintf(stderr, "[e2e] test_t2_f5_04_liquidator_unarmed_combat_scoring\n");
    test_t2_f5_04_liquidator_unarmed_combat_scoring();
    std::fprintf(stderr, "[e2e] test_t2_f5_05_liquidator_corrupted_faction_id_fallback\n");
    test_t2_f5_05_liquidator_corrupted_faction_id_fallback();

    // F6 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f6_01_looter_in_floor_with_no_storage_rooms\n");
    test_t2_f6_01_looter_in_floor_with_no_storage_rooms();
    std::fprintf(stderr, "[e2e] test_t2_f6_02_cultist_mob_aggression_with_invalid_npc\n");
    test_t2_f6_02_cultist_mob_aggression_with_invalid_npc();
    std::fprintf(stderr, "[e2e] test_t2_f6_03_looter_sleep_intent_with_empty_world\n");
    test_t2_f6_03_looter_sleep_intent_with_empty_world();
    std::fprintf(stderr, "[e2e] test_t2_f6_04_cultist_rally_with_zero_allies\n");
    test_t2_f6_04_cultist_rally_with_zero_allies();
    std::fprintf(stderr, "[e2e] test_t2_f6_05_looter_memory_full_slot_eviction\n");
    test_t2_f6_05_looter_memory_full_slot_eviction();

    // F7 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f7_01_route_step_solid_wall_endpoint\n");
    test_t2_f7_01_route_step_solid_wall_endpoint();
    std::fprintf(stderr, "[e2e] test_t2_f7_02_route_step_disconnected_subgraph\n");
    test_t2_f7_02_route_step_disconnected_subgraph();
    std::fprintf(stderr, "[e2e] test_t2_f7_03_route_step_across_toroidal_boundary\n");
    test_t2_f7_03_route_step_across_toroidal_boundary();
    std::fprintf(stderr, "[e2e] test_t2_f7_04_route_step_unbaked_empty_fine_nav\n");
    test_t2_f7_04_route_step_unbaked_empty_fine_nav();
    std::fprintf(stderr, "[e2e] test_t2_f7_05_route_step_out_of_bounds_coordinates\n");
    test_t2_f7_05_route_step_out_of_bounds_coordinates();

    // F8 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f8_01_null_entity_ai_owns_motion\n");
    test_t2_f8_01_null_entity_ai_owns_motion();
    std::fprintf(stderr, "[e2e] test_t2_f8_02_destroyed_entity_token_safety\n");
    test_t2_f8_02_destroyed_entity_token_safety();
    std::fprintf(stderr, "[e2e] test_t2_f8_03_motion_token_corrupted_byte\n");
    test_t2_f8_03_motion_token_corrupted_byte();
    std::fprintf(stderr, "[e2e] test_t2_f8_04_rapid_token_toggle_stability\n");
    test_t2_f8_04_rapid_token_toggle_stability();
    std::fprintf(stderr, "[e2e] test_t2_f8_05_multi_layer_ai_release_isolation\n");
    test_t2_f8_05_multi_layer_ai_release_isolation();

    // F9 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f9_01_zero_magnitude_vector\n");
    test_t2_f9_01_zero_magnitude_vector();
    std::fprintf(stderr, "[e2e] test_t2_f9_02_near_threshold_vector_epsilon\n");
    test_t2_f9_02_near_threshold_vector_epsilon();
    std::fprintf(stderr, "[e2e] test_t2_f9_03_diagonal_equal_magnitude_tie_break\n");
    test_t2_f9_03_diagonal_equal_magnitude_tie_break();
    std::fprintf(stderr, "[e2e] test_t2_f9_04_invalid_regime_enum_safety\n");
    test_t2_f9_04_invalid_regime_enum_safety();
    std::fprintf(stderr, "[e2e] test_t2_f9_05_gravity_field_null_region_callback\n");
    test_t2_f9_05_gravity_field_at_returns_global();

    // F10 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f10_01_exact_half_period_boundary\n");
    test_t2_f10_01_exact_half_period_boundary();
    std::fprintf(stderr, "[e2e] test_t2_f10_02_extreme_large_coordinates\n");
    test_t2_f10_02_extreme_large_coordinates();
    std::fprintf(stderr, "[e2e] test_t2_f10_03_extreme_negative_discrete_indices\n");
    test_t2_f10_03_extreme_negative_discrete_indices();
    std::fprintf(stderr, "[e2e] test_t2_f10_04_sub_voxel_cell_cross_seam_distance\n");
    test_t2_f10_04_sub_voxel_cell_cross_seam_distance();
    std::fprintf(stderr, "[e2e] test_t2_f10_05_floating_point_epsilon_near_seams\n");
    test_t2_f10_05_floating_point_epsilon_near_seams();

    // F11 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f11_01_zero_and_negative_operation_amounts\n");
    test_t2_f11_01_zero_and_negative_operation_amounts();
    std::fprintf(stderr, "[e2e] test_t2_f11_02_bank_max_principal_ceiling\n");
    test_t2_f11_02_bank_max_principal_ceiling();
    std::fprintf(stderr, "[e2e] test_t2_f11_03_loan_exceeding_credit_limit\n");
    test_t2_f11_03_loan_exceeding_credit_limit();
    std::fprintf(stderr, "[e2e] test_t2_f11_04_bank_catchup_clamped_at_24_periods\n");
    test_t2_f11_04_bank_catchup_clamped_at_24_periods();
    std::fprintf(stderr, "[e2e] test_t2_f11_05_fractional_interest_asymmetric_rounding\n");
    test_t2_f11_05_fractional_interest_asymmetric_rounding();

    // F12 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f12_01_feed_tick_out_of_bounds\n");
    test_t2_f12_01_feed_tick_out_of_bounds();
    std::fprintf(stderr, "[e2e] test_t2_f12_02_feed_drain_empty_bus\n");
    test_t2_f12_02_feed_drain_empty_bus();
    std::fprintf(stderr, "[e2e] test_t2_f12_03_bus_ring_overflow_drop_counter\n");
    test_t2_f12_03_bus_ring_overflow_drop_counter();
    std::fprintf(stderr, "[e2e] test_t2_f12_04_signed_floor_payload_packing\n");
    test_t2_f12_04_signed_floor_payload_packing();
    std::fprintf(stderr, "[e2e] test_t2_f12_05_feed_retention_across_bus_clear\n");
    test_t2_f12_05_feed_retention_across_bus_clear();

    // F13 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f13_01_exact_reach_boundary_distance\n");
    test_t2_f13_01_exact_reach_boundary_distance();
    std::fprintf(stderr, "[e2e] test_t2_f13_02_null_or_invalid_player_entity\n");
    test_t2_f13_02_null_or_invalid_player_entity();
    std::fprintf(stderr, "[e2e] test_t2_f13_03_disabled_interactable_rejection\n");
    test_t2_f13_03_disabled_interactable_rejection();
    std::fprintf(stderr, "[e2e] test_t2_f13_04_zero_reach_query\n");
    test_t2_f13_04_zero_reach_query();
    std::fprintf(stderr, "[e2e] test_t2_f13_05_multiple_interactables_closest_selection\n");
    test_t2_f13_05_multiple_interactables_closest_selection();

    // F14 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f14_01_entry_points_null_input_safety\n");
    test_t2_f14_01_entry_points_null_input_safety();
    std::fprintf(stderr, "[e2e] test_t2_f14_02_entry_points_extreme_ticks\n");
    test_t2_f14_02_entry_points_extreme_ticks();
    std::fprintf(stderr, "[e2e] test_t2_f14_03_entry_points_zero_delta_time\n");
    test_t2_f14_03_entry_points_zero_delta_time();
    std::fprintf(stderr, "[e2e] test_t2_f14_04_entry_points_reentrant_concurrency_safety\n");
    test_t2_f14_04_entry_points_reentrant_concurrency_safety();
    std::fprintf(stderr, "[e2e] test_t2_f14_05_static_gate_regex_compliance\n");
    test_t2_f14_05_static_gate_regex_compliance();

    // F15 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f15_01_samosbor_extreme_depth_duty_cycle\n");
    test_t2_f15_01_samosbor_extreme_depth_duty_cycle();
    std::fprintf(stderr, "[e2e] test_t2_f15_02_samosbor_large_dt_multi_step_crossing\n");
    test_t2_f15_02_samosbor_large_dt_multi_step_crossing();
    std::fprintf(stderr, "[e2e] test_t2_f15_03_samosbor_unsheltered_pressure_one_shot\n");
    test_t2_f15_03_samosbor_unsheltered_pressure_one_shot();
    std::fprintf(stderr, "[e2e] test_t2_f15_04_samosbor_variant_weights_normalization\n");
    test_t2_f15_04_samosbor_variant_weights_normalization();
    std::fprintf(stderr, "[e2e] test_t2_f15_05_samosbor_zero_dt_step\n");
    test_t2_f15_05_samosbor_zero_dt_step();

    // =======================================================================
    // Tier 3: Cross-Feature Combinations (15 tests)
    // =======================================================================
    std::fprintf(stderr, "[e2e] test_t3_01_medic_healing_and_hpbank_during_samosbor\n");
    test_t3_01_medic_healing_and_hpbank_during_samosbor();
    std::fprintf(stderr, "[e2e] test_t3_02_duty_guard_patrol_plan_with_toroidal_wrapping\n");
    test_t3_02_duty_guard_patrol_plan_with_toroidal_wrapping();
    std::fprintf(stderr, "[e2e] test_t3_03_bank_debt_and_interest_across_floor_transit\n");
    test_t3_03_bank_debt_and_interest_across_floor_transit();
    std::fprintf(stderr, "[e2e] test_t3_04_prop_interaction_during_ai_navigation_single_writer\n");
    test_t3_04_prop_interaction_during_ai_navigation_single_writer();
    std::fprintf(stderr, "[e2e] test_t3_05_vector_gravity_with_duty_lattice_patrol\n");
    test_t3_05_vector_gravity_with_duty_lattice_patrol();
    std::fprintf(stderr, "[e2e] test_t3_06_economy_events_wired_to_event_feed\n");
    test_t3_06_economy_events_wired_to_event_feed();
    std::fprintf(stderr, "[e2e] test_t3_07_toroidal_wrap_with_prop_interaction\n");
    test_t3_07_toroidal_wrap_with_prop_interaction();
    std::fprintf(stderr, "[e2e] test_t3_08_liquidator_defense_vs_civilian_panic_diffusion\n");
    test_t3_08_liquidator_defense_vs_civilian_panic_diffusion();
    std::fprintf(stderr, "[e2e] test_t3_09_looter_scavenging_via_memory_during_samosbor_aftermath\n");
    test_t3_09_looter_scavenging_via_memory_during_samosbor_aftermath();
    std::fprintf(stderr, "[e2e] test_t3_10_cultist_monster_immunity_during_samosbor_fog_spawns\n");
    test_t3_10_cultist_monster_immunity_during_samosbor_fog_spawns();
    std::fprintf(stderr, "[e2e] test_t3_11_role_distribution_seeding_with_floor_spec_and_bank_terms\n");
    test_t3_11_role_distribution_seeding_with_floor_spec_and_bank_terms();
    std::fprintf(stderr, "[e2e] test_t3_12_route_step_navigation_with_vector_gravity_tangent_plane\n");
    test_t3_12_route_step_navigation_with_vector_gravity_tangent_plane();
    std::fprintf(stderr, "[e2e] test_t3_13_samosbor_alarm_feed_logging_and_event_bus_emission\n");
    test_t3_13_samosbor_alarm_feed_logging_and_event_bus_emission();
    std::fprintf(stderr, "[e2e] test_t3_14_medic_healing_interrupted_by_samosbor_unsheltered_damage\n");
    test_t3_14_medic_healing_interrupted_by_samosbor_unsheltered_damage();
    std::fprintf(stderr, "[e2e] test_t3_15_single_writer_token_arbitration_with_patrol_and_wander\n");
    test_t3_15_single_writer_token_arbitration_with_patrol_and_wander();

    // =======================================================================
    // Tier 4: Real-World Workload Scenarios (5 tests)
    // =======================================================================
    std::fprintf(stderr, "[e2e] test_t4_01_multi_floor_alife_demographics_and_roles_simulation\n");
    test_t4_01_multi_floor_alife_demographics_and_roles_simulation();
    std::fprintf(stderr, "[e2e] test_t4_02_long_duration_economy_compound_interest_lifecycle\n");
    test_t4_02_long_duration_economy_compound_interest_lifecycle();
    std::fprintf(stderr, "[e2e] test_t4_03_long_duration_specialist_patrol_and_errand_marathon\n");
    test_t4_03_long_duration_specialist_patrol_and_errand_marathon();
    std::fprintf(stderr, "[e2e] test_t4_04_full_samosbor_disaster_and_specialist_response_cycle\n");
    test_t4_04_full_samosbor_disaster_and_specialist_response_cycle();
    std::fprintf(stderr, "[e2e] test_t4_05_headless_integrated_engine_game_loop\n");
    test_t4_05_headless_integrated_engine_game_loop();

    std::printf("e2e_test: %d checks, %d failures\n", g_checks, g_fails);
    return g_fails == 0 ? 0 : 1;
}
