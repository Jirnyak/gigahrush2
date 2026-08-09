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

} // namespace
