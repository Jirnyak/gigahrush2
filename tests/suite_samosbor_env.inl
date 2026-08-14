// suite_samosbor_env.inl — tests for samosbor_environmental_step.
//
// Included into game_test.cpp; uses its CHECK macro and
// `using namespace giga::game`.
//
// WHAT THIS TESTS:
//   * Unsheltered bodies accumulate hpDebt at 0.5 HP/s during Active phase.
//   * Sheltered bodies (within 4 cells of a shut hermetic door) are NOT drained.
//   * Variant-specific need drains land on the right channel:
//       Meat    -> water drain
//       Electric -> sleep drain
//       Veretar -> extra hpDebt (0.3 HP/s on top of 0.5)
//   * No drain occurs during Idle / Warning / Aftermath phases.
//   * hpDebt does NOT exceed 1.0 before spill (checked via
//     pool.needs().hpDebt < 1.0f after a sub-spill tick).
//
// The test harness is deliberately thin: no floor gen, no nav bake.
// It builds Registry + NpcPool directly, places entities at known world
// positions, and builds a DoorSet with one hermetic door.

#include "ecs/components.h"
#include "game/combat.h"
#include "game/door.h"
#include "game/embody.h"  // NpcRef
#include "game/needs.h"
#include "game/npc_pool.h"
#include "game/samosbor.h"
#include "world/types.h"  // kCellSize, kMacroDim

namespace samosbor_env_detail {

// Build a SamosborState parked in the Active phase.
inline giga::game::SamosborState active_sam(giga::game::SamosborVariant v) {
    giga::game::SamosborState st;
    st.phase    = static_cast<std::uint8_t>(giga::game::SamosborPhase::Active);
    st.variant  = static_cast<std::uint8_t>(v);
    st.phaseMs  = 30u * 1000u;
    st.phaseTotalMs = 60u * 1000u;
    st.activeMs = 60u * 1000u;
    st.sealed   = false;
    return st;
}

// Build a SamosborState in Idle (no drain must occur).
inline giga::game::SamosborState idle_sam() {
    giga::game::SamosborState st;
    st.phase = static_cast<std::uint8_t>(giga::game::SamosborPhase::Idle);
    return st;
}

// Spawn one NPC entity onto Registry + NpcPool and return (entity, NpcId).
struct SpawnedBody {
    giga::Entity e;
    giga::game::NpcId id;
};

inline SpawnedBody spawn_body(giga::Registry& reg, giga::game::NpcPool& pool,
                               giga::LayerId layer, giga::vec3 pos) {
    // NpcPool requires init() to allocate its eager backing arrays before any
    // spawn or field access. Safe to call multiple times — already-init'd pools
    // are detected internally, but in this test every call gets a fresh pool.
    pool.init();
    const giga::game::NpcId id = pool.spawn();
    pool.set_embodied(id, true);
    // Seed needs so hpDebt starts at zero.
    giga::game::Needs& n = pool.needs(id);
    n.food  = 100.0f;
    n.water = 100.0f;
    n.sleep = 100.0f;
    n.hpDebt = 0.0f;
    n.seeded = 1;
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;

    giga::Entity e = reg.create();
    reg.emplace<giga::Transform>(e, giga::vec3{pos.x, pos.y, pos.z}, layer);
    reg.emplace<giga::game::NpcRef>(e, id);
    return {e, id};
}

// Build a minimal DoorSet with ONE shut hermetic door at cell (dcx, dcy, dcz).
inline giga::game::DoorSet make_door_set(int dcx, int dcy, int dcz, bool hermetic,
                                          bool shut) {
    giga::game::DoorSet ds;
    giga::game::Door d;
    d.cx       = static_cast<std::uint8_t>(dcx & 0xFF);
    d.cy       = static_cast<std::uint8_t>(dcy & 0xFF);
    d.cz       = static_cast<std::uint8_t>(dcz & 0xFF);
    d.h        = 2;
    d.hermetic = hermetic ? 1u : 0u;
    d.hp       = 120;
    d.state    = static_cast<std::uint8_t>(
        shut ? giga::game::DoorState::Shut : giga::game::DoorState::Open);
    ds.doors.push_back(d);
    return ds;
}

// Empty DoorSet (no shelter anywhere).
inline giga::game::DoorSet no_doors() { return {}; }

} // namespace samosbor_env_detail

static void test_samosbor_env_all() {
    using namespace samosbor_env_detail;
    using giga::game::SamosborVariant;

    constexpr giga::LayerId kLayer = 0;
    // 1 tick = 8 ms = kSimDt
    constexpr float dt = 1.0f / static_cast<float>(kSimHz);

    { // ---- env_idle_phase_no_drain --------------------------------------------
        // During Idle phase: no drain even if unsheltered.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {64.0f, 64.0f, 4.0f});
        const auto sam = idle_sam();
        const auto ds  = no_doors();

        giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        CHECK(n.hpDebt < 1e-6f);
        CHECK(n.water >= 100.0f - 1e-6f);
        CHECK(n.sleep >= 100.0f - 1e-6f);
    }

    { // ---- env_active_unsheltered_base_drain ----------------------------------
        // Active, no doors: 0.5 HP/s drain accumulates in hpDebt.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {64.0f, 64.0f, 4.0f});
        const auto sam = active_sam(SamosborVariant::Classic);
        const auto ds  = no_doors();

        // Run 4 ticks, expect hpDebt = 0.5 * 4 * dt = 2 * dt ~= 0.016 HP
        // Well below 1.0, so no spill occurs.
        for (int i = 0; i < 4; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        const float expected_debt = 0.5f * 4.0f * dt;
        CHECK(std::fabs(n.hpDebt - expected_debt) < 1e-4f);
        // HP must not yet be touched (debt < 1.0).
        CHECK(pool.hp(id) == 100);
    }

    { // ---- env_active_sheltered_no_drain --------------------------------------
        // Body within 4 cells of a shut hermetic door: no drain.
        giga::Registry reg;
        giga::game::NpcPool pool;
        // Body at cell (10, 10, 2), door at cell (11, 10, 2) — distance 1 cell.
        const float bx = 10.0f * giga::kCellSize + 1.0f;
        const float by = 10.0f * giga::kCellSize + 1.0f;
        const float bz =  2.0f * giga::kCellSize + 0.9f;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {bx, by, bz});
        const auto sam = active_sam(SamosborVariant::Classic);
        const auto ds  = make_door_set(11, 10, 2, /*hermetic=*/true, /*shut=*/true);

        for (int i = 0; i < 8; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        CHECK(n.hpDebt < 1e-6f);
        CHECK(pool.hp(id) == 100);
    }

    { // ---- env_active_open_door_no_shelter ------------------------------------
        // An OPEN hermetic door does NOT shelter.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const float bx = 10.0f * giga::kCellSize + 1.0f;
        const float by = 10.0f * giga::kCellSize + 1.0f;
        const float bz =  2.0f * giga::kCellSize + 0.9f;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {bx, by, bz});
        const auto sam = active_sam(SamosborVariant::Classic);
        const auto ds  = make_door_set(11, 10, 2, /*hermetic=*/true, /*shut=*/false);

        for (int i = 0; i < 4; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        const float expected_debt = 0.5f * 4.0f * dt;
        CHECK(std::fabs(n.hpDebt - expected_debt) < 1e-4f);
    }

    { // ---- env_active_distant_door_no_shelter ---------------------------------
        // Door > 4 cells away: not sheltered.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const float bx = 10.0f * giga::kCellSize + 1.0f;
        const float by = 10.0f * giga::kCellSize + 1.0f;
        const float bz =  2.0f * giga::kCellSize + 0.9f;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {bx, by, bz});
        const auto sam = active_sam(SamosborVariant::Classic);
        // Door at cell (20, 10, 2) — 10 cells away. dx^2 = 100 > 16.
        const auto ds = make_door_set(20, 10, 2, true, true);

        for (int i = 0; i < 4; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        const float expected_debt = 0.5f * 4.0f * dt;
        CHECK(std::fabs(n.hpDebt - expected_debt) < 1e-4f);
    }

    { // ---- env_variant_meat_drains_water --------------------------------------
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {64.0f, 64.0f, 4.0f});
        const auto sam = active_sam(SamosborVariant::Meat);
        const auto ds  = no_doors();

        const int ticks = 100;
        for (int i = 0; i < ticks; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        const float expected_water_lost = 0.1f * static_cast<float>(ticks) * dt;
        const float actual_water_lost   = 100.0f - n.water;
        CHECK(std::fabs(actual_water_lost - expected_water_lost) < 1e-3f);
        // sleep must be untouched
        CHECK(n.sleep >= 100.0f - 1e-4f);
    }

    { // ---- env_variant_electric_drains_sleep ----------------------------------
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {64.0f, 64.0f, 4.0f});
        const auto sam = active_sam(SamosborVariant::Electric);
        const auto ds  = no_doors();

        const int ticks = 100;
        for (int i = 0; i < ticks; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        const float expected_sleep_lost = 0.1f * static_cast<float>(ticks) * dt;
        const float actual_sleep_lost   = 100.0f - n.sleep;
        CHECK(std::fabs(actual_sleep_lost - expected_sleep_lost) < 1e-3f);
        // water must be untouched
        CHECK(n.water >= 100.0f - 1e-4f);
    }

    { // ---- env_variant_veretar_extra_debt -------------------------------------
        // Veretar: 0.5 + 0.3 = 0.8 HP/s. After 4 ticks hpDebt = 0.8 * 4 * dt.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {64.0f, 64.0f, 4.0f});
        const auto sam = active_sam(SamosborVariant::Veretar);
        const auto ds  = no_doors();

        for (int i = 0; i < 4; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        const float expected_debt = 0.8f * 4.0f * dt;
        CHECK(std::fabs(n.hpDebt - expected_debt) < 1e-4f);
    }

    { // ---- env_hpdbt_spill_reduces_pool_hp ------------------------------------
        // Run enough ticks that hpDebt >= 1.0 → spill via apply_damage.
        // At 0.5 HP/s and 125 Hz, 1 HP spills after 250 ticks.
        // We run 260 ticks: expect hp drop by at least 1.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, kLayer, {64.0f, 64.0f, 4.0f});
        const auto sam = active_sam(SamosborVariant::Classic);
        const auto ds  = no_doors();

        for (int i = 0; i < 260; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, kLayer, sam, dt);

        // hpDebt must be fractional (< 1.0) after spill.
        const giga::game::Needs& n = pool.needs(id);
        CHECK(n.hpDebt < 1.0f);
        // At least 1 HP was billed.
        CHECK(pool.hp(id) < 100);
    }

    { // ---- env_wrong_layer_ignored -------------------------------------------
        // Entity on a different layer must not be drained.
        giga::Registry reg;
        giga::game::NpcPool pool;
        const auto [e, id] = spawn_body(reg, pool, /*layer=*/1, {64.0f, 64.0f, 4.0f});
        const auto sam = active_sam(SamosborVariant::Classic);
        const auto ds  = no_doors();

        for (int i = 0; i < 4; ++i)
            giga::game::samosbor_environmental_step(reg, pool, ds, /*layer=*/0, sam, dt);

        const giga::game::Needs& n = pool.needs(id);
        CHECK(n.hpDebt < 1e-6f);
    }
}
