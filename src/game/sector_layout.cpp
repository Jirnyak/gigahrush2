#include "game/sector_layout.h"

#include <algorithm>
#include <cmath>

#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/combat.h"
#include "game/door.h"
#include "game/embody.h"
#include "game/needs.h"
#include "game/room_zone.h"
#include "game/samosbor.h"
#include "game/status.h"
#include "world/destruct.h"
#include "world/materials.h"
#include "world/subfield.h"
#include "world/world.h"

namespace giga::game {

VerticalBiome floor_vertical_biome(int floorNumber) {
    if (floorNumber >= 25) return VerticalBiome::UpperClean;
    if (floorNumber >= 1)  return VerticalBiome::Residential;
    if (floorNumber == 0)  return VerticalBiome::CentralHub;
    if (floorNumber >= -25) return VerticalBiome::Industrial;
    return VerticalBiome::DeepReactor;
}

const char* vertical_biome_name(VerticalBiome b) {
    switch (b) {
        case VerticalBiome::UpperClean:   return "Upper Clean";
        case VerticalBiome::Residential:  return "Residential";
        case VerticalBiome::CentralHub:   return "Central Hub";
        case VerticalBiome::Industrial:   return "Industrial";
        case VerticalBiome::DeepReactor:  return "Deep Reactor";
        default:                          return "Unknown";
    }
}

FloorKind default_kind_for_biome(VerticalBiome b) {
    switch (b) {
        case VerticalBiome::UpperClean:   return FloorKind::Commercial;
        case VerticalBiome::Residential:  return FloorKind::Residential;
        case VerticalBiome::CentralHub:   return FloorKind::Residential;
        case VerticalBiome::Industrial:   return FloorKind::Industrial;
        case VerticalBiome::DeepReactor:  return FloorKind::Derelict;
        default:                          return FloorKind::Residential;
    }
}

float distance_from_sector_center(float posX, float posY) {
    const float dx = posX - kSectorCenterMetersX;
    const float dy = posY - kSectorCenterMetersY;
    return std::sqrt(dx * dx + dy * dy);
}

float cell_distance_from_sector_center(int cx, int cy) {
    const float dx = (static_cast<float>(cx) - static_cast<float>(kSectorCenterCellX)) * kCellSize;
    const float dy = (static_cast<float>(cy) - static_cast<float>(kSectorCenterCellY)) * kCellSize;
    return std::sqrt(dx * dx + dy * dy);
}

bool is_in_fuzzy_boundary(float posX, float posY) {
    return distance_from_sector_center(posX, posY) > kFuzzyBoundaryRadiusMeters;
}

bool is_cell_in_fuzzy_boundary(int cx, int cy) {
    return cell_distance_from_sector_center(cx, cy) > kFuzzyBoundaryRadiusMeters;
}

float fuzzy_boundary_decay(float posX, float posY) {
    const float dist = distance_from_sector_center(posX, posY);
    if (dist <= kFuzzyBoundaryRadiusMeters) return 0.0f;
    constexpr float maxRadius = kSectorCenterMetersX; // 512.0m
    constexpr float span = maxRadius - kFuzzyBoundaryRadiusMeters; // 112.0m
    const float t = (dist - kFuzzyBoundaryRadiusMeters) / span;
    return std::clamp(t, 0.0f, 1.0f);
}

float cell_fuzzy_boundary_decay(int cx, int cy) {
    const float dist = cell_distance_from_sector_center(cx, cy);
    if (dist <= kFuzzyBoundaryRadiusMeters) return 0.0f;
    constexpr float maxRadius = kSectorCenterMetersX; // 512.0m
    constexpr float span = maxRadius - kFuzzyBoundaryRadiusMeters; // 112.0m
    const float t = (dist - kFuzzyBoundaryRadiusMeters) / span;
    return std::clamp(t, 0.0f, 1.0f);
}

float sector_perimeter_radiation(float posX, float posY, int floorNumber) {
    const float decay = fuzzy_boundary_decay(posX, posY);
    if (decay <= 0.0f) {
        const VerticalBiome vb = floor_vertical_biome(floorNumber);
        switch (vb) {
            case VerticalBiome::UpperClean:  return 0.05f;
            case VerticalBiome::Residential: return 0.12f;
            case VerticalBiome::CentralHub:  return 0.10f;
            case VerticalBiome::Industrial:  return 5.0f;
            case VerticalBiome::DeepReactor: return 85.0f;
            default:                         return 0.10f;
        }
    }
    return kPerimeterMinRadiationUSvH + decay * (kPerimeterMaxRadiationUSvH - kPerimeterMinRadiationUSvH);
}

float sector_perimeter_toxicity(float posX, float posY, int floorNumber) {
    const float decay = fuzzy_boundary_decay(posX, posY);
    if (decay <= 0.0f) {
        const VerticalBiome vb = floor_vertical_biome(floorNumber);
        switch (vb) {
            case VerticalBiome::UpperClean:  return 0.0f;
            case VerticalBiome::Residential: return 0.02f;
            case VerticalBiome::CentralHub:  return 0.0f;
            case VerticalBiome::Industrial:  return 0.20f;
            case VerticalBiome::DeepReactor: return 0.45f;
            default:                         return 0.0f;
        }
    }
    return kPerimeterBaseToxicity + decay * (1.0f - kPerimeterBaseToxicity);
}

SectorLayout generate_sector_layout(int floorNumber, std::uint32_t worldSeed) {
    SectorLayout layout;
    layout.floorNumber = floorNumber;
    layout.biome = floor_vertical_biome(floorNumber);
    layout.seed = compute_sector_seed(worldSeed, floorNumber);
    layout.dominantKind = default_kind_for_biome(layout.biome);

    switch (layout.biome) {
        case VerticalBiome::UpperClean:
            layout.ambientToxicity = 0.0f;
            layout.ambientRadiationUSvH = 0.05f;
            layout.structuralDecayFactor = 0.05f;
            break;
        case VerticalBiome::Residential:
            layout.ambientToxicity = 0.02f;
            layout.ambientRadiationUSvH = 0.12f;
            layout.structuralDecayFactor = 0.10f;
            break;
        case VerticalBiome::CentralHub:
            layout.ambientToxicity = 0.0f;
            layout.ambientRadiationUSvH = 0.10f;
            layout.structuralDecayFactor = 0.02f;
            break;
        case VerticalBiome::Industrial:
            layout.ambientToxicity = 0.20f;
            layout.ambientRadiationUSvH = 5.0f;
            layout.structuralDecayFactor = 0.35f;
            break;
        case VerticalBiome::DeepReactor:
            layout.ambientToxicity = 0.45f;
            layout.ambientRadiationUSvH = 85.0f;
            layout.structuralDecayFactor = 0.70f;
            break;
        default:
            break;
    }

    // Initialize 32x32 Spatial Activity Grid (Spec 22 §3.1)
    for (int by = 0; by < kSpatialActivityGridDim; ++by) {
        for (int bx = 0; bx < kSpatialActivityGridDim; ++bx) {
            const int blockCenterX = bx * kSpatialActivityBlockCells + kSpatialActivityBlockCells / 2;
            const int blockCenterY = by * kSpatialActivityBlockCells + kSpatialActivityBlockCells / 2;
            const float blockDist = cell_distance_from_sector_center(blockCenterX, blockCenterY);

            const int idx = bx + by * kSpatialActivityGridDim;
            if (blockDist <= 200.0f) {
                layout.spatialGrid[idx] = SpatialActivityMode::Hot;
            } else if (blockDist <= 450.0f) {
                layout.spatialGrid[idx] = SpatialActivityMode::Warm;
            } else {
                layout.spatialGrid[idx] = SpatialActivityMode::Cold;
            }
        }
    }

    return layout;
}

void apply_sector_fuzzy_boundaries(World& world, int floorNumber, std::uint32_t seed, VerticalBiome biome) {
    MacroGrid& g = world.grid();

    const float biomeDecayMult = (biome == VerticalBiome::DeepReactor) ? 1.4f :
                                 (biome == VerticalBiome::Industrial)  ? 1.1f : 1.0f;

    // Check cells across the macro volume
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                // Map to 512-sector coordinate representation
                const int sx = (x * kSectorDimX) / kMacroDim;
                const int sy = (y * kSectorDimY) / kMacroDim;
                const float dist = cell_distance_from_sector_center(sx, sy);

                if (dist <= kFuzzyBoundaryRadiusMeters) continue;

                const float decay = std::min(1.0f, cell_fuzzy_boundary_decay(sx, sy) * biomeDecayMult);
                const std::uint32_t h = hash_u32(seed ^
                                                (static_cast<std::uint32_t>(x) * 0x9E3779B9u) ^
                                                (static_cast<std::uint32_t>(y) * 0x85EBCA6Bu) ^
                                                (static_cast<std::uint32_t>(z) * 0xC2B2AE35u));

                // Outer perimeter wall (dist >= 505m): 100% solid monolithic boundary
                if (dist >= 505.0f) {
                    g.set_cell(x, y, z, kMatConcrete);
                    continue;
                }

                // Outskirts structural collapse: rubble cave-ins, buckled concrete slabs
                const std::uint32_t threshold = static_cast<std::uint32_t>(decay * 80.0f);
                if ((h % 100u) < threshold) {
                    g.set_cell(x, y, z, kMatConcrete);
                }
            }
        }
    }
}

std::uint32_t generate_sector_airlock_bulkheads(World& world, DoorSet& doors, int floorNumber,
                                               const FloorSpec& spec, std::uint32_t seed) {
    MacroGrid& g = world.grid();
    std::uint32_t added = 0;

    // Scan doorways and border crossings near boundary radius ~400m
    const int stride = floor_room_stride(spec.kind);
    const int roomsPerAxis = (stride > 0) ? (kMacroDim / stride) : 1;

    for (int ry = 0; ry < roomsPerAxis; ++ry) {
        for (int rx = 0; rx < roomsPerAxis; ++rx) {
            const int cx = rx * stride;
            const int cy = ry * stride;
            const int sx = (cx * kSectorDimX) / kMacroDim;
            const int sy = (cy * kSectorDimY) / kMacroDim;
            const float dist = cell_distance_from_sector_center(sx, sy);

            // Boundary threshold band: 380m .. 420m
            if (dist >= 380.0f && dist <= 420.0f) {
                // Find standing corridor / passage crossing
                for (int z = 2; z <= 4; ++z) {
                    if (g.cell(cx, cy, z) == kCellAir) {
                        Door d;
                        d.cx = static_cast<std::uint8_t>(cx);
                        d.cy = static_cast<std::uint8_t>(cy);
                        d.cz = static_cast<std::uint8_t>(z);
                        d.h = 2;
                        d.axis = (rx % 2 == 0) ? 0 : 1;
                        d.hermetic = 1;
                        d.state = static_cast<std::uint8_t>(DoorState::Locked);
                        d.keycardTier = static_cast<std::uint8_t>(KeycardTier::Master);
                        d.hp = 2500; // Zero-class sealed titanium bulkhead: "СЕКТОР КОНСЕРВИРОВАН"

                        const std::size_t idx = macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(z));
                        if (doors.index.size() > idx && doors.index[idx] == 0) {
                            const std::uint32_t doorId = static_cast<std::uint32_t>(doors.doors.size());
                            doors.doors.push_back(d);
                            doors.index[idx] = doorId + 1u;
                            if (z + 1 < kMacroDim) {
                                const std::size_t idxTop = macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(z + 1));
                                if (doors.index.size() > idxTop) doors.index[idxTop] = doorId + 1u;
                            }
                            ++added;
                            ++doors.shut;
                            g.set_cell(cx, cy, z, kMatConcrete);
                            if (z + 1 < kMacroDimZ) g.set_cell(cx, cy, z + 1, kMatConcrete);
                        }
                    }
                }
            }
        }
    }

    return added;
}

void sector_perimeter_hazard_step(Registry& reg, NpcPool& pool, const DoorSet* doors,
                                  LayerId layer, int floorNumber, float dt,
                                  StatusSet* playerStatus, const MacroGrid* grid,
                                  const RoomZones* rooms) {
    auto view = reg.view<const Transform, const NpcRef>();
    const VerticalBiome vb = floor_vertical_biome(floorNumber);

    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;

        // Map world position to sector scale
        const float dist = distance_from_sector_center(tr.pos.x, tr.pos.y);
        if (dist <= kFuzzyBoundaryRadiusMeters) continue;

        const float decay = fuzzy_boundary_decay(tr.pos.x, tr.pos.y);

        // Check if sheltered behind hermetic doors
        bool sheltered = false;
        if (doors != nullptr && grid != nullptr) {
            sheltered = samosbor_is_sheltered(tr.pos, *doors, grid, rooms);
        }
        if (sheltered) continue;

        // Apply sensory coughing and toxic haze to unsheltered camera holder
        if (reg.all_of<CameraTag>(e) && playerStatus != nullptr) {
            status_apply(*playerStatus, StatusId::SporeHaze, false);
            if (decay > 0.4f) {
                status_apply(*playerStatus, StatusId::GovnyakCough, false);
            }
        }

        // Unsheltered in outer perimeter: accumulate severe toxic/radiation HP debt
        Needs& n = pool.needs(id);
        float drainRate = 1.5f + decay * 2.5f;
        if (vb == VerticalBiome::DeepReactor) drainRate += 1.2f;

        n.hpDebt += drainRate * dt;

        if (n.hpDebt >= 1.0f) {
            const auto whole = static_cast<std::int16_t>(n.hpDebt);
            n.hpDebt -= static_cast<float>(whole);
            apply_damage(reg, pool, e, whole, kAttritionChannel, entt::null);
        }
    }
}

} // namespace giga::game
