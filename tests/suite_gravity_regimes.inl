// suite_gravity_regimes.inl — spec2.txt §5.1, the isotropy law ([gravity.md], AGENTS.md
// "gravity is a vector").
//
// GATE: all 8 GravityRegimes tested for regime_down/regime_frame shape, fluid fall
// direction, and fluid isotropy. A failure here pinpoints a hardcoded axis letter — the
// defect class problems.md §34 documents.
//
// The spec mandates:
//  - suite_gravity_regimes.inl tests all 8 regimes (NegX..PosZ, Zero, Custom)
//  - At Zero, water does NOT flow to +X (old bug from downAxis defaulting to 0)
//  - fluid.cpp calls regime_down(), not its own classifier
#include "world/world.h"
#include "sim/fluid.h"
#include "world/gravity.h"
#include "core/math.h"
#include "sim/controller.h"
#include "world/level_stack.h"
#include "sim/physics.h"
#include "world/destruct.h"
#include "ecs/components.h"
#include "game/combat.h"
#include "game/npc_pool.h"

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

// --- §d: GATE — verify regime_down() usage and isotropy -------------------
// The isotropy properties above only hold if regime_down() is used.
// test_fluid_falls_in_regime_direction passing for ALL 6 directional
// regimes simultaneously is mathematically impossible with any single hardcoded axis.

// --- §5.1 e: Falling body follows regime_down() and no other axis ----------
static void test_falling_body_follows_regime_down() {
    for (giga::GravityRegime r : {
             giga::GravityRegime::NegX, giga::GravityRegime::PosX,
             giga::GravityRegime::NegY, giga::GravityRegime::PosY,
             giga::GravityRegime::NegZ, giga::GravityRegime::PosZ,
         }) {
        giga::LevelStack stack;
        giga::LayerId layerId = stack.push_layer();
        giga::World& world = stack.layer(layerId);
        
        world.gravity().regime = r;
        giga::CellStep d = giga::regime_down(r);
        world.gravity().global = {
            static_cast<float>(d.x) * 9.81f,
            static_cast<float>(d.y) * 9.81f,
            static_cast<float>(d.z) * 9.81f
        };
        
        giga::Registry reg;
        giga::Entity e = reg.create();
        reg.emplace<giga::Transform>(e, giga::vec3{100.0f, 100.0f, 100.0f}, layerId);
        reg.emplace<giga::Velocity>(e, giga::vec3{0.0f, 0.0f, 0.0f});
        reg.emplace<giga::GravityAffected>(e, 1.0f, false);
        reg.emplace<giga::AABB>(e, giga::vec3{0.5f, 0.5f, 0.5f});
        
        giga::PhysicsParams params;
        giga::physics_step(reg, stack, 1.0f, params);
        
        const giga::Velocity& vel = reg.get<giga::Velocity>(e);
        const giga::Transform& tf = reg.get<giga::Transform>(e);
        
        if (d.x == 0) { CHECK(vel.v.x == 0.0f); CHECK(tf.pos.x == 100.0f); }
        else { CHECK(vel.v.x * d.x > 0.0f); }
        
        if (d.y == 0) { CHECK(vel.v.y == 0.0f); CHECK(tf.pos.y == 100.0f); }
        else { CHECK(vel.v.y * d.y > 0.0f); }
        
        if (d.z == 0) { CHECK(vel.v.z == 0.0f); CHECK(tf.pos.z == 100.0f); }
        else { CHECK(vel.v.z * d.z > 0.0f); }
    }
}

// --- §5.1 f: Carving sphere remains a sphere; detachment is isotropic -----
static void test_carve_sphere_is_isotropic() {
    giga::World w;
    for (int cx = 10; cx <= 12; ++cx) {
        for (int cy = 10; cy <= 12; ++cy) {
            for (int cz = 10; cz <= 12; ++cz) {
                w.grid().fill_cell(cx, cy, cz, giga::kMatConcrete);
            }
        }
    }
    
    giga::CarveOp op;
    op.x = (11.0f * 8.0f + 4.0f) * giga::kVoxelSize;
    op.y = (11.0f * 8.0f + 4.0f) * giga::kVoxelSize;
    op.z = (11.0f * 8.0f + 4.0f) * giga::kVoxelSize;
    op.radius = 3.0f * giga::kVoxelSize;
    op.power = 0xFFFF;
    op.seed = 42;
    op.detachLimit = 1024;
    
    giga::CarveScratch scratch;
    giga::CarveResult res;
    giga::carve_sphere(w, op, scratch, res);
    
    int min_dx = 1000, max_dx = -1000;
    int min_dy = 1000, max_dy = -1000;
    int min_dz = 1000, max_dz = -1000;
    
    const int center_ax = 11 * 8 + 4;
    for (const auto& d : res.destroyed) {
        int ax = static_cast<int>(d.cell & 127u) * giga::kSubDim + (d.bit & 7);
        int ay = static_cast<int>((d.cell >> 7) & 127u) * giga::kSubDim + ((d.bit >> 3) & 7);
        int az = static_cast<int>((d.cell >> 14) & 127u) * giga::kSubDim + ((d.bit >> 6) & 7);
        
        int dx = ax - center_ax;
        int dy = ay - center_ax;
        int dz = az - center_ax;
        
        if (dx < min_dx) min_dx = dx;
        if (dx > max_dx) max_dx = dx;
        if (dy < min_dy) min_dy = dy;
        if (dy > max_dy) max_dy = dy;
        if (dz < min_dz) min_dz = dz;
        if (dz > max_dz) max_dz = dz;
    }
    
    CHECK(min_dx == min_dy);
    CHECK(min_dx == min_dz);
    CHECK(max_dx == max_dy);
    CHECK(max_dx == max_dz);
}

// --- §5.1 g: Locomotion builds basis from frame -----
static void test_locomotion_builds_basis_from_frame() {
    for (giga::GravityRegime r : {
             giga::GravityRegime::NegX, giga::GravityRegime::PosX,
             giga::GravityRegime::NegY, giga::GravityRegime::PosY,
             giga::GravityRegime::NegZ, giga::GravityRegime::PosZ,
         }) {
        giga::World world;
        world.gravity().regime = r;
        giga::CellStep d = giga::regime_down(r);
        world.gravity().global = {
            static_cast<float>(d.x) * 9.81f,
            static_cast<float>(d.y) * 9.81f,
            static_cast<float>(d.z) * 9.81f
        };
        
        giga::Registry reg;
        giga::Entity e = reg.create();
        reg.emplace<giga::Transform>(e, giga::vec3{100.0f, 100.0f, 100.0f}, static_cast<giga::LayerId>(0));
        reg.emplace<giga::Velocity>(e, giga::vec3{0.0f, 0.0f, 0.0f});
        reg.emplace<giga::Controller>(e, 6.0f, giga::vec3{1.0f, 0.0f, 0.0f}, false);
        reg.emplace<giga::CameraTag>(e, 0.0f, 0.0f, 1.2f, giga::vec3{0,0,0});
        
        giga::controller_step(reg, 1.0f, &world.gravity());
        
        const giga::Velocity& vel = reg.get<giga::Velocity>(e);
        giga::GravityFrame f = giga::regime_frame(r);
        
        if (f.axis == 0) CHECK(vel.v.x == 0.0f);
        if (f.axis == 1) CHECK(vel.v.y == 0.0f);
        if (f.axis == 2) CHECK(vel.v.z == 0.0f);
        
        CHECK(vel.v.x * vel.v.x + vel.v.y * vel.v.y + vel.v.z * vel.v.z > 0.0f);
    }
}

// --- §5.1 h: Knockback pushes backward, not up -----
static void test_knockback_pushes_backward_not_up() {
    giga::World world;
    world.gravity().regime = giga::GravityRegime::NegZ;
    world.gravity().global = {0, 0, -9.81f};
    
    giga::Registry reg;
    giga::game::NpcPool pool;
    pool.init();
    
    giga::Entity target = reg.create();
    reg.emplace<giga::Transform>(target, giga::vec3{10.0f, 10.0f, 10.0f}, static_cast<giga::LayerId>(0));
    reg.emplace<giga::Velocity>(target, giga::vec3{0.0f, 0.0f, 0.0f});
    reg.emplace<giga::Mass>(target, 70.0f);
    reg.emplace<giga::game::MobRef>(target, static_cast<std::uint8_t>(giga::game::MobKind::Zombie), (std::uint8_t)1, (std::int16_t)100, (std::int16_t)100);
    
    giga::Entity attacker = reg.create();
    reg.emplace<giga::Transform>(attacker, giga::vec3{12.0f, 10.0f, 10.0f}, static_cast<giga::LayerId>(0));
    
    giga::game::apply_damage(reg, pool, target, 50, giga::game::DamageChannel::Kinetic, attacker, nullptr, nullptr, &world.gravity());
    
    const giga::Velocity& vel = reg.get<giga::Velocity>(target);
    CHECK(vel.v.x < 0.0f);
    CHECK(vel.v.z == 0.0f);
}

// --- §d: GATE — verify regime_down() usage and isotropy -------------------
// The isotropy properties above only hold if regime_down() is used.
// test_fluid_falls_in_regime_direction passing for ALL 6 directional
// regimes simultaneously is mathematically impossible with any single hardcoded axis.

static void test_gravity_regimes_all() {
    test_gravity_regimes_isotropy();
    test_fluid_isotropy();
    test_fluid_falls_in_regime_direction();
    test_falling_body_follows_regime_down();
    test_carve_sphere_is_isotropic();
    test_locomotion_builds_basis_from_frame();
    test_knockback_pushes_backward_not_up();
}

} // namespace
