// suite_gravity_regimes.inl — the isotropy law, pinned ([gravity.md], AGENTS.md
// "gravity is a vector").
//
// GATE: all 8 GravityRegimes tested for regime_down/regime_frame shape and for
// fluid fall direction. A failure here pinpoints a hardcoded axis letter — the
// defect class problems.md §34 documents. The structural argument is in §d at
// the bottom: passing for all 6 directional regimes at once is impossible with
// any single hardcoded axis, so no source grep is needed.
#include "world/world.h"
#include "sim/fluid.h"
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

// --- §5.1 b: fluid.cpp uses regime_down — Zero-regime gate -----------------
// SPEC: At GravityRegime::Zero, water must NOT flow to +X.
// The broken pre-fix code had `downAxis = 0, sign = 1` as default, causing +X flow.
// This test CATCHES that bug if it ever regresses.

static void test_fluid_isotropy() {
    giga::World world;
    world.gravity().regime = giga::GravityRegime::Zero;
    world.gravity().global  = {0.0f, 0.0f, 0.0f};

    giga::Field<float>& f = world.fields().get_or_create<float>(giga::kFluidField);
    f.data().assign(giga::kMacroCells, 0.0f);

    const int cx = 64, cy = 64, cz = 64;
    f.at(cx, cy, cz) = 1.0f;

    giga::FluidScratch scratch;
    giga::FluidParams params;
    params.maxPerCell = 1.0f;
    params.viscosity  = 1.0f;

    giga::fluid_step(world, scratch, params);

    // The single-cell drop at (cx,cy,cz) must NOT have entirely moved to +X.
    // With Zero gravity and no pull, fluid may spread symmetrically but cannot
    // flow directionally. A full move to +X (value == 1) is the pre-fix bug.
    const float xPlus  = f.at(cx + 1, cy, cz);
    const float xMinus = f.at(cx - 1, cy, cz);
    const float yPlus  = f.at(cx, cy + 1, cz);
    const float yMinus = f.at(cx, cy - 1, cz);
    // None of the 4 laterals should have received the full initial amount.
    CHECK(xPlus  < 1.0f); // old bug: this was 1.0f (all fluid fell to +X)
    CHECK(xMinus < 1.0f);
    CHECK(yPlus  < 1.0f);
    CHECK(yMinus < 1.0f);
    // Symmetry: if the solver is isotropic under Zero, ±X and ±Y get equal shares.
    // Allow small float epsilon for rounding.
    const float eps = 1e-5f;
    CHECK(xPlus < xMinus + eps && xMinus < xPlus + eps); // ±X equal
    CHECK(yPlus < yMinus + eps && yMinus < yPlus + eps); // ±Y equal
}

// --- §5.1 c: fluid direction matches regime for each directional regime ----
// Place a cell of fluid; after one step it should have moved toward regime_down.

static void test_fluid_falls_in_regime_direction() {
    const giga::GravityRegime regimes[] = {
        giga::GravityRegime::NegZ, giga::GravityRegime::PosZ,
        giga::GravityRegime::NegY, giga::GravityRegime::PosY,
        giga::GravityRegime::NegX, giga::GravityRegime::PosX,
    };

    for (giga::GravityRegime r : regimes) {
        giga::World world;
        world.gravity().regime = r;
        giga::CellStep d = giga::regime_down(r);
        // Build a representative global vec from the step.
        world.gravity().global = {
            static_cast<float>(d.x) * 9.81f,
            static_cast<float>(d.y) * 9.81f,
            static_cast<float>(d.z) * 9.81f
        };

        giga::Field<float>& f = world.fields().get_or_create<float>(giga::kFluidField);
        f.data().assign(giga::kMacroCells, 0.0f);

        const int cx = 64, cy = 64, cz = 64;
        f.at(cx, cy, cz) = 1.0f;

        giga::FluidScratch scratch;
        giga::FluidParams params;
        params.maxPerCell = 1.0f;
        params.viscosity  = 1.0f;

        giga::fluid_step(world, scratch, params);

        // The "below" neighbour (in the down direction) must have GAINED fluid.
        const int nx = cx + d.x, ny = cy + d.y, nz = cz + d.z;
        const float below = f.at(nx, ny, nz);
        // At least some flow should have moved toward down.
        CHECK(below > 0.0f);
        // The origin cell must have LOST fluid (it fell).
        CHECK(f.at(cx, cy, cz) < 1.0f);
    }
}

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
                                 src, nullptr, nullptr, &gf, nullptr);

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
    test_fluid_isotropy();
    test_fluid_falls_in_regime_direction();
    test_knockback_all_gravity_regimes();
    test_wander_isotropy_all_gravity_regimes();
}

} // namespace
