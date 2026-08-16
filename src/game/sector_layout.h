// Sector layout & Fuzzy Boundary simulation.
//
// CONSTITUTION: Docs/specs/22_WORLD_SCALE_AND_SECTOR_SIMULATION.md
//
// 1. 512 x 512 x 16 macro-cells per sector (1024m x 1024m x 32m physical volume).
// 2. Deterministic sector generation via Seed = WorldSeed ^ FloorNumber.
// 3. 5 Vertical Biomes:
//    - Upper Clean  [+50 .. +25]: White tile, research labs, high-tier security
//    - Residential  [+24 ..  +1]: Standard five-story block housing, markets, bars
//    - Central Hub  [ 0 ]:        Grand multi-level atrium, neutral exchange, bank
//    - Industrial   [-1 .. -25]:  Heavy pipelines, machine shops, steam, dark sludge
//    - Deep Reactor [-26 .. -50]: Pitch dark catacombs, extreme radiation, Veretar
// 4. Fuzzy Boundaries at radius > 400m from sector center (256, 256):
//    - Structural collapse blocks (rubble, cave-ins, collapsed concrete slabs)
//    - Sealed airlock bulkheads (Zero-class locked hermetic doors with warning seals)
//    - Toxic & radiation perimeter hazard fields (1500+ uSv/h rads & Veretar fog)
//
// Zero mocks, no exceptions, no RTTI, UTF-8 without BOM.
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/door.h"
#include "game/floor_spec.h"
#include "game/npc_pool.h"
#include "game/status.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/types.h"

namespace giga {
class World;
}

namespace giga::game {

struct RoomZones;

// 5 Vertical Biomes across 100-floor megastructure (-50..+50)
enum class VerticalBiome : std::uint8_t {
    UpperClean = 0,   // [+50 .. +25]
    Residential = 1,  // [+24 .. +1]
    CentralHub = 2,   // [0]
    Industrial = 3,   // [-1 .. -25]
    DeepReactor = 4,  // [-26 .. -50]
    Count = 5
};

inline constexpr int kSectorDimX = 512;
inline constexpr int kSectorDimY = 512;
inline constexpr int kSectorDimZ = 16;
inline constexpr std::size_t kSectorTotalCells =
    static_cast<std::size_t>(kSectorDimX) * kSectorDimY * kSectorDimZ; // 4,194,304

inline constexpr float kSectorSizeMetersX = kSectorDimX * kCellSize; // 1024.0m
inline constexpr float kSectorSizeMetersY = kSectorDimY * kCellSize; // 1024.0m
inline constexpr float kSectorSizeMetersZ = kSectorDimZ * kCellSize; // 32.0m

inline constexpr int kSectorCenterCellX = kSectorDimX / 2; // 256
inline constexpr int kSectorCenterCellY = kSectorDimY / 2; // 256
inline constexpr int kSectorCenterCellZ = kSectorDimZ / 2; // 8

inline constexpr float kSectorCenterMetersX = kSectorCenterCellX * kCellSize; // 512.0m
inline constexpr float kSectorCenterMetersY = kSectorCenterCellY * kCellSize; // 512.0m

inline constexpr float kFuzzyBoundaryRadiusMeters = 400.0f;
inline constexpr int kFuzzyBoundaryRadiusCells = 200; // 400.0m / 2.0m

inline constexpr float kPerimeterMinRadiationUSvH = 1500.0f;
inline constexpr float kPerimeterMaxRadiationUSvH = 5000.0f;
inline constexpr float kPerimeterBaseToxicity = 0.85f;

// 32x32 Spatial Activity Grid sectors (Spec 22 §3.1)
inline constexpr int kSpatialActivityGridDim = 32;
inline constexpr int kSpatialActivityBlockCells = 16; // 16x16x16 macro-cells per sector

enum class SpatialActivityMode : std::uint8_t {
    Hot = 0,   // 125 Hz: within 200m of observers
    Warm = 1,  // 25 Hz: 200m..450m
    Cold = 2   // MacroSim only: > 450m
};

struct SectorLayout {
    int floorNumber = 0;
    VerticalBiome biome = VerticalBiome::CentralHub;
    std::uint32_t seed = 0;
    FloorKind dominantKind = FloorKind::Residential;

    // Environmental profiles
    float ambientToxicity = 0.0f;
    float ambientRadiationUSvH = 0.1f;
    float structuralDecayFactor = 0.0f;

    // Boundary bulkheads and collapse count
    std::uint32_t bulkheadCount = 0;
    std::uint32_t collapseBlockCount = 0;

    // 32x32 spatial activity grid modes
    SpatialActivityMode spatialGrid[kSpatialActivityGridDim * kSpatialActivityGridDim]{};
};

VerticalBiome floor_vertical_biome(int floorNumber);
const char* vertical_biome_name(VerticalBiome b);
FloorKind default_kind_for_biome(VerticalBiome b);

// Compute sector seed = WorldSeed ^ FloorNumber
inline std::uint32_t compute_sector_seed(std::uint32_t worldSeed, int floorNumber) {
    return worldSeed ^ static_cast<std::uint32_t>(floorNumber);
}

// Check if a point (world metres) is in the fuzzy boundary outskirts (>400m from center)
bool is_in_fuzzy_boundary(float posX, float posY);

// Check if a macro cell is in the fuzzy boundary outskirts
bool is_cell_in_fuzzy_boundary(int cx, int cy);

// Distance in metres from sector center (512m, 512m)
float distance_from_sector_center(float posX, float posY);
float cell_distance_from_sector_center(int cx, int cy);

// Fuzzy boundary decay factor 0.0..1.0 (0 inside 400m, ramping up to 1.0 at 512m)
float fuzzy_boundary_decay(float posX, float posY);
float cell_fuzzy_boundary_decay(int cx, int cy);

// Calculate environmental perimeter radiation (uSv/h) and toxicity at given position
float sector_perimeter_radiation(float posX, float posY, int floorNumber);
float sector_perimeter_toxicity(float posX, float posY, int floorNumber);

// Generate sector layout descriptor for a given floor and world seed
SectorLayout generate_sector_layout(int floorNumber, std::uint32_t worldSeed);

// Generate and apply structural collapse blocks at radius > 400m
void apply_sector_fuzzy_boundaries(World& world, int floorNumber, std::uint32_t seed, VerticalBiome biome);

// Stamp sealed airlock bulkheads into DoorSet & World at radius ~400m
std::uint32_t generate_sector_airlock_bulkheads(World& world, DoorSet& doors, int floorNumber,
                                               const FloorSpec& spec, std::uint32_t seed);

// Periodic environmental perimeter hazard step (radiation, Veretar gas, HP debt for unsheltered entities in >400m perimeter)
void sector_perimeter_hazard_step(Registry& reg, NpcPool& pool, const DoorSet* doors,
                                  LayerId layer, int floorNumber, float dt,
                                  StatusSet* playerStatus, const MacroGrid* grid,
                                  const RoomZones* rooms);

} // namespace giga::game
