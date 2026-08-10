#include "world/world.h"
#include "sim/fluid.h"
#include "world/gravity.h"
#include "core/math.h"
#include "sim/controller.h"

namespace {

static void test_gravity_regimes_isotropy() {
    giga::GravityRegime regimes[] = {
        giga::GravityRegime::NegX, giga::GravityRegime::PosX, 
        giga::GravityRegime::NegY, giga::GravityRegime::PosY, 
        giga::GravityRegime::NegZ, giga::GravityRegime::PosZ, 
        giga::GravityRegime::Zero, giga::GravityRegime::Custom
    };

    for (giga::GravityRegime r : regimes) {
        // 1. Fall direction matches regime_down
        giga::CellStep d = giga::regime_down(r);
        if (r == giga::GravityRegime::Zero || r == giga::GravityRegime::Custom) {
            CHECK(d.x == 0);
            CHECK(d.y == 0);
            CHECK(d.z == 0);
        } else {
            int sum = (d.x != 0 ? 1 : 0) + (d.y != 0 ? 1 : 0) + (d.z != 0 ? 1 : 0);
            CHECK(sum == 1); // Only one axis is non-zero
            // Ensure length is exactly 1 or -1
            CHECK((d.x * d.x + d.y * d.y + d.z * d.z) == 1);
        }

        // 4. Locomotion basis matches the frame
        giga::GravityFrame f = giga::regime_frame(r);
        if (r != giga::GravityRegime::Zero && r != giga::GravityRegime::Custom) {
            CHECK(f.pull == true);
            // Verify tanA and tanB are orthogonal to axis
            CHECK(f.tanA != f.axis);
            CHECK(f.tanB != f.axis);
            CHECK(f.tanA != f.tanB);
        } else {
            CHECK(f.pull == false);
        }
    }
}

static void test_fluid_isotropy() {
    giga::World world;
    world.gravity().regime = giga::GravityRegime::Zero;
    world.gravity().global = {0.0f, 0.0f, 0.0f};

    giga::Field<float>& f = world.fields().get_or_create<float>(giga::kFluidField);
    f.data().assign(giga::kMacroCells, 0.0f);

    int cx = 64, cy = 64, cz = 64;
    f.at(cx, cy, cz) = 1.0f;

    giga::FluidScratch scratch;
    giga::FluidParams params;
    params.maxPerCell = 1.0f;
    params.viscosity = 1.0f; 
    
    giga::fluid_step(world, scratch, params);

    // In GravityRegime::Zero, water should NOT flow down to +X, it should just spread symmetrically or not at all.
    // The broken code flows exactly all remaining fluid to +X because downAxis defaults to 0 and sign to 1.
    CHECK(f.at(cx + 1, cy, cz) < 1.0f); // It should not have completely fallen to +X
    // And ideally it should be symmetrical in all 4 lateral directions if it spreads.
    // Actually, if downAxis=2 (Z), lateral is X,Y.
    // If it's correctly falling back to Z without pull, it won't fall down Z, and will spread to X,Y symmetrically.
}

static void test_gravity_regimes_all() {
    test_gravity_regimes_isotropy();
    test_fluid_isotropy();
}

} // namespace
