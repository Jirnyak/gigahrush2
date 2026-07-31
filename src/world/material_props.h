// Physical material properties — the SIMULATION side of the material
// vocabulary in world/materials.h.
//
// materials.h declares that a CellType id is a label and the only code
// branching on it is the colour table. Destruction adds a second, equally
// data-driven consumer: a hardness row per id, sized from kMatCount with the
// same drift guard as the colour table — add a material without a hardness and
// the build fails rather than the material silently inheriting one.
//
// Hardness is the integer resistance a hit's `power` is rolled against
// ([destruct.h]): a hit at power == hardness removes the sub-voxel with
// certainty, at power == hardness/2 with probability 1/2, and so on. Two
// sentinels bracket the scale:
//   * 0               — removed by any touch (air never rolls; a 0 row means
//                       "cosmetic dust");
//   * kHardnessUnbreakable — never removed by carving. This is how
//     INFRASTRUCTURE is protected as DATA, not as if-chains: doors carry their
//     own HP state machine ([door.h]) that a carve must not desync, and the
//     hub/extract pads are the nav lattice's ground truth, so all three are
//     unbreakable rows here rather than special cases in the carve loop.
#pragma once
#include <cstdint>

#include "world/materials.h"

namespace giga {

inline constexpr std::uint16_t kHardnessUnbreakable = 0xFFFF;

// Indexed by CellType. Scale is anchored on concrete = 256 (a power-of-two
// mid-anchor per [jirnyak.md] §1); a hand pick swings ~64–128, explosives push
// thousands at the epicentre.
inline constexpr std::uint16_t kMatHardness[kMatCount] = {
    0,                     // kCellAir        — never rolled
    256,                   // kMatConcrete
    64,                    // kMatSoil
    96,                    // kMatWaterMark
    192,                   // kMatSlabTan
    kHardnessUnbreakable,  // kMatExtract     — bank pad: infrastructure
    kHardnessUnbreakable,  // kMatDoor        — owned by the door state machine
    kHardnessUnbreakable,  // kMatHubPad      — nav lattice ground truth
    32,                    // kMatPlaster     — the "paint" of the paint→concrete example
    48,                    // kMatParquet
    128,                   // kMatShopShutter
    40,                    // kMatLino
    256,                   // kMatFactoryWall
    320,                   // kMatTread       — steel plate
    112,                   // kMatRust        — corroded, weaker than fresh steel
    24,                    // kMatRubble      — already broken once
    384,                   // kMatElectricGrate
    16,                    // kMatAcidPool
    16,                    // kMatFireCell
};

static_assert(sizeof(kMatHardness) / sizeof(kMatHardness[0]) == kMatCount,
              "every material needs a hardness row (see header note)");

inline std::uint16_t material_hardness(CellType t) {
    return t < kMatCount ? kMatHardness[t] : kHardnessUnbreakable;
}

} // namespace giga
