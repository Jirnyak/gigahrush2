// Spatial Activity Grid: 32x32 sectors of 16x16x16 macro-cells (32m^3 each).
//
// Pure DOD sector simulation and 3-tier tickrate (Spec 22 Requirement R2):
//   - HOT (125 Hz): radius <= 200m around active observers (ObserverTag, CameraTag)
//     or combat foci. Full sub-voxel physics and continuous diffusion.
//   - WARM (25 Hz): radius 200m .. 450m from foci. Macro-cell collision and 5-tick
//     gas diffusion step.
//   - COLD (MacroSim): radius > 450m. Macro-simulation with zero voxel iterations.
//
// Pure ECS symmetry: no `isPlayer` checks. Any entity holding ObserverTag,
// CameraTag or ActiveCombatTag projects HOT / WARM influence symmetrically.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"
#include "world/level_stack.h"
#include "world/types.h"

namespace giga {

enum class SectorActivity : std::uint8_t {
    Cold = 0, // MacroSim (> 450m): 0 Hz voxel / diffusion iterations
    Warm = 1, // 25 Hz (200m - 450m): macro-cell collision, 5-tick diffusion
    Hot  = 2, // 125 Hz (<= 200m): full sub-voxel physics & continuous diffusion
};

// Aliases matching uppercase names in Spec 22
inline constexpr SectorActivity HOT  = SectorActivity::Hot;
inline constexpr SectorActivity WARM = SectorActivity::Warm;
inline constexpr SectorActivity COLD = SectorActivity::Cold;

class SpatialActivityGrid {
public:
    // Sector grid dimensions (32 x 32 sectors of 16 x 16 x 16 macro-cells)
    static constexpr int kSectorCellsX = 16;
    static constexpr int kSectorCellsY = 16;
    static constexpr int kSectorCellsZ = 16;

    static constexpr int kSectorsX = 32;
    static constexpr int kSectorsY = 32;
    static constexpr int kSectorCount = kSectorsX * kSectorsY; // 1024 sectors

    // Sector physical size in metres (16 cells * 2.0 m = 32.0 m)
    static constexpr float kSectorSize = static_cast<float>(kSectorCellsX) * kCellSize;
    static constexpr float kSectorHeight = static_cast<float>(kSectorCellsZ) * kCellSize;

    // Spatial radius thresholds (Spec 22 §3.1)
    static constexpr float kHotRadius = 200.0f;
    static constexpr float kWarmRadius = 450.0f;
    static constexpr float kHotRadiusSq = kHotRadius * kHotRadius;       // 40,000 m^2
    static constexpr float kWarmRadiusSq = kWarmRadius * kWarmRadius;   // 202,500 m^2

    SpatialActivityGrid();

    // Reset all sectors to COLD
    void clear();

    // Query activity of sector (sx, sy)
    SectorActivity activity(int sx, int sy) const;

    // Set activity of sector (sx, sy)
    void set_activity(int sx, int sy, SectorActivity act);

    // Query activity at world-space position (pos in metres)
    SectorActivity activity_at(vec3 pos) const;

    // Query activity at macro-cell coordinate (cx, cy, cz)
    SectorActivity activity_at_cell(int cx, int cy, int cz) const;

    // Convenience predicates
    bool is_hot(int sx, int sy) const { return activity(sx, sy) == SectorActivity::Hot; }
    bool is_warm(int sx, int sy) const { return activity(sx, sy) == SectorActivity::Warm; }
    bool is_cold(int sx, int sy) const { return activity(sx, sy) == SectorActivity::Cold; }
    bool is_active(int sx, int sy) const { return activity(sx, sy) != SectorActivity::Cold; }

    // Should a sector step its simulation on tick `tick`?
    // HOT: 125 Hz (every tick)
    // WARM: 25 Hz (every 5 ticks: tick % 5 == 0)
    // COLD: 0 Hz (never in micro-sim)
    bool should_step(int sx, int sy, std::uint64_t tick) const {
        const SectorActivity act = activity(sx, sy);
        if (act == SectorActivity::Hot) return true;
        if (act == SectorActivity::Warm) return (tick % 5 == 0);
        return false;
    }

    // Update the activity grid by scanning all entities on `layer` with
    // ObserverTag, CameraTag, or ActiveCombatTag, plus any optional explicit foci.
    void update(const Registry& reg, LayerId layer,
                const vec3* additionalFoci = nullptr, std::size_t focusCount = 0);

    // Sector geometric helpers
    static int sector_index(int sx, int sy) { return sx + sy * kSectorsX; }
    static void sector_coords(int index, int& sx, int& sy) {
        sx = index % kSectorsX;
        sy = index / kSectorsX;
    }
    static vec3 sector_min(int sx, int sy) {
        return vec3{static_cast<float>(sx) * kSectorSize,
                    static_cast<float>(sy) * kSectorSize, 0.0f};
    }
    static vec3 sector_max(int sx, int sy) {
        return vec3{static_cast<float>(sx + 1) * kSectorSize,
                    static_cast<float>(sy + 1) * kSectorSize, kSectorHeight};
    }
    static vec3 sector_center(int sx, int sy) {
        return vec3{(static_cast<float>(sx) + 0.5f) * kSectorSize,
                    (static_cast<float>(sy) + 0.5f) * kSectorSize,
                    0.5f * kSectorHeight};
    }

    // Diagnostics / Metrics
    std::size_t hot_count() const;
    std::size_t warm_count() const;
    std::size_t cold_count() const;

    const SectorActivity* data() const { return sectors_.data(); }
    SectorActivity* data() { return sectors_.data(); }

private:
    std::array<SectorActivity, kSectorCount> sectors_{};
};

} // namespace giga
