// suite_gravity_regimes.inl — the isotropy law, pinned ([gravity.md], AGENTS.md
// "gravity is a vector").
//
// GATE: all 8 GravityRegimes tested for regime_down/regime_frame shape and for
// fluid fall direction. A failure here pinpoints a hardcoded axis letter — the
// defect class problems.md §34 documents. The structural argument is in §d at
// the bottom: passing for all 6 directional regimes at once is impossible with
// any single hardcoded axis, so no source grep is needed.
#include "world/world.h"
#include "world/gravity.h"
#include "world/macro_grid.h"
#include "world/nav.h"
#include "core/math.h"
#include "game/embody.h"
#include "game/npc_pool.h"
#include "game/wander.h"
#include "sim/controller.h"

namespace {

// --- §5.1 a: regime_down() correctness for all 8 regimes -------------------

static void test_gravity_regimes_isotropy() {
    giga::GravityRegime regimes[] = {
        giga::GravityRegime::NegX, giga::GravityRegime::PosX,
        giga::GravityRegime::NegY, giga::GravityRegime::PosY,
        giga::GravityRegime::NegZ, giga::GravityRegime::PosZ,
        giga::GravityRegime::Zero, giga::GravityRegime::Custom
    };

    for (giga::GravityRegime r : regimes) {
        giga::CellStep d = giga::regime_down(r);
        if (r == giga::GravityRegime::Zero || r == giga::GravityRegime::Custom) {
            CHECK(d.x == 0);
            CHECK(d.y == 0);
            CHECK(d.z == 0);
        } else {
            // Exactly one axis non-zero, magnitude 1.
            int nonzero = (d.x != 0 ? 1 : 0) + (d.y != 0 ? 1 : 0) + (d.z != 0 ? 1 : 0);
            CHECK(nonzero == 1);
            CHECK((d.x * d.x + d.y * d.y + d.z * d.z) == 1);
        }

        // Frame check: pull==true for directional regimes, false for Zero/Custom.
        giga::GravityFrame f = giga::regime_frame(r);
        if (r != giga::GravityRegime::Zero && r != giga::GravityRegime::Custom) {
            CHECK(f.pull == true);
            CHECK(f.tanA != f.axis);
            CHECK(f.tanB != f.axis);
            CHECK(f.tanA != f.tanB);
        } else {
            CHECK(f.pull == false);
        }
    }

    // Cross-check: regime_down returns the DOWN direction, which is OPPOSITE to upSign.
    // NegZ: down = {0,0,-1}, frame.axis=2, upSign=+1 (up is +Z). Correct.
    {
        giga::CellStep d = giga::regime_down(giga::GravityRegime::NegZ);
        giga::GravityFrame f = giga::regime_frame(giga::GravityRegime::NegZ);
        CHECK(d.z == -1); // down is -Z
        CHECK(f.axis == 2); // Z axis
        CHECK(f.upSign == 1); // +Z is up
    }
    // PosZ: down = {0,0,+1}, frame.axis=2, upSign=-1 (up is -Z). Flipped world.
    {
        giga::CellStep d = giga::regime_down(giga::GravityRegime::PosZ);
        giga::GravityFrame f = giga::regime_frame(giga::GravityRegime::PosZ);
        CHECK(d.z == 1); // down is +Z
        CHECK(f.axis == 2);
        CHECK(f.upSign == -1); // -Z is up
    }
    // NegX: down = {-1,0,0}, frame.axis=0.
    {
        giga::CellStep d = giga::regime_down(giga::GravityRegime::NegX);
        CHECK(d.x == -1);
        CHECK(d.y == 0);
        CHECK(d.z == 0);
    }
    // PosX: down = {+1,0,0}.
    {
        giga::CellStep d = giga::regime_down(giga::GravityRegime::PosX);
        CHECK(d.x == 1);
        CHECK(d.y == 0);
        CHECK(d.z == 0);
    }
    // NegY: down = {0,-1,0}.
    {
        giga::CellStep d = giga::regime_down(giga::GravityRegime::NegY);
        CHECK(d.y == -1);
    }
    // PosY: down = {0,+1,0}.
    {
        giga::CellStep d = giga::regime_down(giga::GravityRegime::PosY);
        CHECK(d.y == 1);
    }
}

// --- §5.1 b/c: fluid.cpp УМЕР (чистка 2026-08-24) — изотропия материи по
// фреймам живёт теперь в medium_test (test_regime_isotropy, настоящий
// SPIR-V мира-автомата: Zero не двигает, каждый из 6 режимов роняет воду
// строго по regime_down).

// --- §5.1 d: Knockback impulse strips gravity component across all 6 directional regimes
// In game/combat.cpp apply_damage:
//   const vec3 up = g * (-1.0f / gLen);
//   d = d - up * dot(d, up);
// Velocity must be STRICTLY orthogonal to the gravity vector for all regimes.

#include "game/combat.h"
#include "ecs/components.h"

static void test_knockback_all_gravity_regimes() {
    const giga::GravityRegime regimes[] = {
        giga::GravityRegime::NegZ, giga::GravityRegime::PosZ,
        giga::GravityRegime::NegY, giga::GravityRegime::PosY,
        giga::GravityRegime::NegX, giga::GravityRegime::PosX,
    };

    for (giga::GravityRegime r : regimes) {
        giga::CellStep d = giga::regime_down(r);
        const giga::vec3 gVec{
            static_cast<float>(d.x) * 9.81f,
            static_cast<float>(d.y) * 9.81f,
            static_cast<float>(d.z) * 9.81f
        };

        giga::GravityField gf;
        gf.regime = r;
        gf.global = gVec;

        giga::Registry reg;
        giga::game::NpcPool pool;
        pool.init();

        // Source at (10, 10, 10), Target at (12, 13, 15) — arbitrary non-axis-aligned vector
        giga::Entity src = reg.create();
        reg.emplace<giga::Transform>(src, giga::vec3{10.0f, 10.0f, 10.0f}, giga::LayerId{0});

        giga::Entity tgt = reg.create();
        reg.emplace<giga::Transform>(tgt, giga::vec3{12.0f, 13.0f, 15.0f}, giga::LayerId{0});
        reg.emplace<giga::Velocity>(tgt, giga::vec3{0.0f, 0.0f, 0.0f});

        const giga::game::NpcId id = pool.spawn();
        pool.hp(id) = 100;
        pool.max_hp(id) = 100;
        reg.emplace<giga::game::NpcRef>(tgt, id);

        // Apply physical damage with gravity field
        giga::game::apply_damage(reg, pool, tgt, 20, giga::game::DamageChannel::Kinetic,
                                 src, nullptr, nullptr, &gf);

        const giga::Velocity& v = reg.get<giga::Velocity>(tgt);
        // Knockback velocity must be non-zero (hit applied)
        const float speedSq = v.v.x * v.v.x + v.v.y * v.v.y + v.v.z * v.v.z;
        CHECK(speedSq > 0.001f);

        // The dot product with the gravity vector must be strictly zero (perpendicular).
        const float dotWithG = v.v.x * gVec.x + v.v.y * gVec.y + v.v.z * gVec.z;
        CHECK(std::fabs(dotWithG) < 1e-4f);

        // Under NegZ/PosZ: vertical component v.z must be 0
        if (r == giga::GravityRegime::NegZ || r == giga::GravityRegime::PosZ) {
            CHECK(std::fabs(v.v.z) < 1e-5f);
        }
        // Under NegX/PosX: lateral component v.x must be 0
        if (r == giga::GravityRegime::NegX || r == giga::GravityRegime::PosX) {
            CHECK(std::fabs(v.v.x) < 1e-5f);
        }
        // Under NegY/PosY: lateral component v.y must be 0
        if (r == giga::GravityRegime::NegY || r == giga::GravityRegime::PosY) {
            CHECK(std::fabs(v.v.y) < 1e-5f);
        }
    }
}

// --- §f: wander_step isotropy across all 6 directional regimes -------------
static void test_wander_isotropy_all_gravity_regimes() {
    const giga::GravityRegime regimes[] = {
        giga::GravityRegime::NegZ, giga::GravityRegime::PosZ,
        giga::GravityRegime::NegY, giga::GravityRegime::PosY,
        giga::GravityRegime::NegX, giga::GravityRegime::PosX,
    };

    giga::MacroGrid grid;

    giga::nav::CoarseGraph coarse{};
    giga::nav::FineNav fine;
    fine.flow.assign(giga::nav::kNodes * giga::kMacroCells, 0xFF);
    fine.nearest.assign(giga::kMacroCells, 0);

    for (giga::GravityRegime r : regimes) {
        const giga::CellStep d = giga::regime_down(r);
        const giga::vec3 gVec{
            static_cast<float>(d.x) * 9.81f,
            static_cast<float>(d.y) * 9.81f,
            static_cast<float>(d.z) * 9.81f
        };

        giga::GravityField gf;
        gf.regime = r;
        gf.global = gVec;

        giga::Registry reg;
        giga::game::NpcPool pool;
        pool.init();

        giga::Entity e = reg.create();
        reg.emplace<giga::Transform>(e, giga::vec3{16.0f, 16.0f, 16.0f}, giga::LayerId{0});
        reg.emplace<giga::Velocity>(e, giga::vec3{0.0f, 0.0f, 0.0f});
        reg.emplace<giga::game::WanderTarget>(e, giga::game::WanderTarget{0, 0, 0});

        const giga::game::NpcId id = pool.spawn();
        reg.emplace<giga::game::NpcRef>(e, id);

        // Step wander
        giga::game::wander_step(reg, grid, pool, coarse, fine, 0, 0, &gf);

        const giga::Velocity& v = reg.get<giga::Velocity>(e);
        // The dot product of velocity with the gravity vector must be strictly zero (orthogonal to gravity).
        const float dotWithG = v.v.x * gVec.x + v.v.y * gVec.y + v.v.z * gVec.z;
        CHECK(std::fabs(dotWithG) < 1e-4f);

        // Under NegZ/PosZ: vertical component v.z must be 0
        if (r == giga::GravityRegime::NegZ || r == giga::GravityRegime::PosZ) {
            CHECK(std::fabs(v.v.z) < 1e-5f);
        }
        // Under NegX/PosX: lateral component v.x must be 0
        if (r == giga::GravityRegime::NegX || r == giga::GravityRegime::PosX) {
            CHECK(std::fabs(v.v.x) < 1e-5f);
        }
        // Under NegY/PosY: lateral component v.y must be 0
        if (r == giga::GravityRegime::NegY || r == giga::GravityRegime::PosY) {
            CHECK(std::fabs(v.v.y) < 1e-5f);
        }
    }
}

// --- §e: the gate itself ---------------------------------------------------
// No source grep: the isotropy properties above only hold if regime_down() is
// used. test_fluid_falls_in_regime_direction, test_knockback_all_gravity_regimes,
// and test_wander_isotropy_all_gravity_regimes passing for ALL 6 directional regimes
// simultaneously is impossible with any single hardcoded axis.

static void test_gravity_regimes_all() {
    test_gravity_regimes_isotropy();
    test_knockback_all_gravity_regimes();
    test_wander_isotropy_all_gravity_regimes();
}

} // namespace
