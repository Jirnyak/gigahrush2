#include "sim/spatial_activity.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"

namespace giga {

SpatialActivityGrid::SpatialActivityGrid() {
    clear();
}

void SpatialActivityGrid::clear() {
    sectors_.fill(SectorActivity::Cold);
}

SectorActivity SpatialActivityGrid::activity(int sx, int sy) const {
    if (sx < 0 || sx >= kSectorsX || sy < 0 || sy >= kSectorsY) {
        return SectorActivity::Cold;
    }
    return sectors_[static_cast<std::size_t>(sx + sy * kSectorsX)];
}

void SpatialActivityGrid::set_activity(int sx, int sy, SectorActivity act) {
    if (sx >= 0 && sx < kSectorsX && sy >= 0 && sy < kSectorsY) {
        sectors_[static_cast<std::size_t>(sx + sy * kSectorsX)] = act;
    }
}

SectorActivity SpatialActivityGrid::activity_at(vec3 pos) const {
    const int sx = static_cast<int>(std::floor(pos.x / kSectorSize));
    const int sy = static_cast<int>(std::floor(pos.y / kSectorSize));
    return activity(sx, sy);
}

SectorActivity SpatialActivityGrid::activity_at_cell(int cx, int cy, int cz) const {
    if (!in_bounds(cx, cy, cz)) {
        return SectorActivity::Cold;
    }
    const int sx = cx / kSectorCellsX;
    const int sy = cy / kSectorCellsY;
    return activity(sx, sy);
}

void SpatialActivityGrid::update(const Registry& reg, LayerId layer,
                                const vec3* additionalFoci,
                                std::size_t focusCount) {
    clear();

    std::vector<vec3> foci;
    foci.reserve(16 + focusCount);

    // 1. Collect active observers (ObserverTag) on this layer
    for (auto e : reg.view<Transform, ObserverTag>()) {
        const auto& tr = reg.get<Transform>(e);
        if (tr.layer == layer) {
            foci.push_back(tr.pos);
        }
    }

    // 2. Collect camera holders (CameraTag) on this layer
    for (auto e : reg.view<Transform, CameraTag>()) {
        const auto& tr = reg.get<Transform>(e);
        if (tr.layer == layer) {
            foci.push_back(tr.pos);
        }
    }

    // 3. Collect active combat foci (ActiveCombatTag) on this layer
    for (auto e : reg.view<Transform, ActiveCombatTag>()) {
        const auto& tr = reg.get<Transform>(e);
        if (tr.layer == layer) {
            foci.push_back(tr.pos);
        }
    }

    // 4. Append any extra foci
    if (additionalFoci != nullptr && focusCount > 0) {
        for (std::size_t i = 0; i < focusCount; ++i) {
            foci.push_back(additionalFoci[i]);
        }
    }

    // If no observers or combat foci are present on this floor, all sectors stay COLD
    if (foci.empty()) {
        return;
    }

    // 5. Evaluate distance from each sector (AABB) to closest focus
    for (int sy = 0; sy < kSectorsY; ++sy) {
        const float minY = static_cast<float>(sy) * kSectorSize;
        const float maxY = minY + kSectorSize;

        for (int sx = 0; sx < kSectorsX; ++sx) {
            const float minX = static_cast<float>(sx) * kSectorSize;
            const float maxX = minX + kSectorSize;
            constexpr float minZ = 0.0f;
            constexpr float maxZ = kSectorHeight;

            float minDistSq = 1e30f;
            const float secMidX = minX + 0.5f * kSectorSize;
            const float secMidY = minY + 0.5f * kSectorSize;
            for (const vec3& f : foci) {
                const float fx = nearest_image(f.x, secMidX, kWorldExtentX);
                const float fy = nearest_image(f.y, secMidY, kWorldExtentY);
                const float cx = std::clamp(fx, minX, maxX);
                const float cy = std::clamp(fy, minY, maxY);
                const float cz = std::clamp(f.z, minZ, maxZ);

                const float dx = fx - cx;
                const float dy = fy - cy;
                const float dz = f.z - cz;
                const float d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < minDistSq) {
                    minDistSq = d2;
                }
            }

            const std::size_t idx = static_cast<std::size_t>(sx + sy * kSectorsX);
            if (minDistSq <= kHotRadiusSq) {
                sectors_[idx] = SectorActivity::Hot;
            } else if (minDistSq <= kWarmRadiusSq) {
                sectors_[idx] = SectorActivity::Warm;
            } else {
                sectors_[idx] = SectorActivity::Cold;
            }
        }
    }
}

std::size_t SpatialActivityGrid::hot_count() const {
    return static_cast<std::size_t>(
        std::count(sectors_.begin(), sectors_.end(), SectorActivity::Hot));
}

std::size_t SpatialActivityGrid::warm_count() const {
    return static_cast<std::size_t>(
        std::count(sectors_.begin(), sectors_.end(), SectorActivity::Warm));
}

std::size_t SpatialActivityGrid::cold_count() const {
    return static_cast<std::size_t>(
        std::count(sectors_.begin(), sectors_.end(), SectorActivity::Cold));
}

} // namespace giga
