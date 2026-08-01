// Surface stains — the universal "liquids paint the world" layer.
//
// Blood from wounds, urine from relief, scorch from fire: ALL of it is one
// mechanism — a sparse per-SUB-VOXEL additive RGB field ("stain",
// [world/subfield.h]) painted onto SOLID atoms. Channels add with saturation,
// so mixing is emergent exactly like paint: piss into a blood pool and yellow
// adds into red; nothing anywhere branches on "what liquid is this".
//
// The write is data-driven end to end: damage stains take their colour from
// kChannelStain[DamageChannel] (one table row per channel — a new damage type
// brings its stain colour with it), other liquids pass their colour directly.
// The renderer reads the same pages through the voxel mirror and blends at the
// ray hit; consumers owe the mirror the dirty cells, the CarveResult contract.
//
// Storage cost is the SubField contract: nothing until painted, then one
// 512×3 B page per stained cell — dense at macro, sparse at sub-voxel,
// exactly where performance.md draws the line.
#pragma once
#include <cstdint>
#include <vector>

#include "core/math.h"

namespace giga {

class World;

// One stained atom's colour. Additive with per-channel saturation; {0,0,0} is
// the unpainted base, so a page that fades back to black folds away.
struct StainRGB {
    std::uint8_t r = 0, g = 0, b = 0;
    bool operator==(const StainRGB& o) const {
        return r == o.r && g == o.g && b == o.b;
    }
};

inline constexpr const char* kStainFieldName = "stain";

// Substance colours — the data rows of the layer. Mixing needs no rules:
// channels add, so blood-then-urine IS their blend.
inline constexpr StainRGB kStainBlood{150, 12, 10};
inline constexpr StainRGB kStainUrine{140, 120, 25};

// Saturating add of `add` into the stain of ONE global sub-voxel (1024-grid
// coordinates, toroidal). Paints only solid atoms — liquid clings to matter.
// Returns the flat macro cell index it dirtied, or UINT32_MAX if nothing was
// painted (air, or a zero add).
std::uint32_t stain_paint(World& w, int gx, int gy, int gz, StainRGB add);

// Splatter: `rays` deterministic directions out of `origin` (metres, toroidal),
// each walking up to `reach` metres of sub-voxel DDA to its first solid atom,
// painting it with `colour` scaled by distance falloff. `bias` tilts the spray
// (e.g. {0,0,-1} for a puddle, the hit direction for arterial spray; {0,0,0}
// for a uniform burst). Unique dirtied macro cells are appended to `dirty` —
// the caller owes them to the voxel mirror.
// Deterministic from `seed`: same op, same bytes, on any machine.
std::int32_t stain_splat(World& w, vec3 origin, vec3 bias, float reach,
                         int rays, StainRGB colour, std::uint32_t seed,
                         std::vector<std::uint32_t>& dirty);

} // namespace giga
