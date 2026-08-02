// src/render/prop_placer.cpp — Refactored Procedural Prop Placement System
#include "render/prop_placer.h"

#include <cmath>
#include <cstdint>

#include "core/rng.h"
#include "world/materials.h"

namespace giga::gpu {

namespace {

constexpr float kHalfPi = 1.5707963267948966f;
constexpr float kPi = 3.141592653589793f;

inline bool is_solid(CellType type) {
    return type != kCellAir;
}

struct PropSpawnConfig {
    std::uint32_t grateFloorChancePct   = 15;
    std::uint32_t wallCabinetChancePct = 12;
    std::uint32_t lightChancePct       = 25;
    std::uint32_t anomalyChancePermil  = 15;
    std::uint32_t crateCornerChancePct = 18;

    vec3 grateColor   = {0.30f, 0.30f, 0.32f};
    vec3 cabColor     = {0.32f, 0.35f, 0.38f};
    vec3 warmLampCol  = {1.00f, 0.90f, 0.72f};
    vec3 coolLampCol  = {0.75f, 0.88f, 1.00f};
    vec3 crystalCol   = {0.70f, 0.15f, 0.95f};
    vec3 acidCol      = {0.15f, 0.85f, 0.25f};
    vec3 fungalCol    = {0.40f, 0.75f, 0.30f};
    vec3 beamColor    = {0.22f, 0.24f, 0.26f};
    vec3 crateColor   = {0.45f, 0.35f, 0.25f};
};

constexpr PropSpawnConfig kCfg{};

// Distinct seeds per rule to diversify spatial hash across placement rules
constexpr std::uint32_t kSaltGrate    = 0x22222222u;
constexpr std::uint32_t kSaltWall     = 0x33333333u;
constexpr std::uint32_t kSaltLight    = 0x44444444u;
constexpr std::uint32_t kSaltAnomaly  = 0x55555555u;
constexpr std::uint32_t kSaltCrate    = 0x77777777u;
constexpr std::uint32_t kSaltPillar   = 0x88888888u;
constexpr std::uint32_t kSaltRailing  = 0x99999999u;
constexpr std::uint32_t kSaltBench    = 0xaaaaaaaau;
constexpr std::uint32_t kSaltSecurity = 0xbbbbbbbbu;

} // namespace

void PropPlacer::populate(const MacroGrid& grid, PropPass& propPass, std::uint32_t seed) {
    propPass.clear_instances();
    totalPlaced_ = 0;

    constexpr float kCell = kCellSize;

    // Scan every cell in the 128^3 macro grid
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                CellType cur = grid.cell(x, y, z);
                if (cur != kCellAir) continue; // Props inhabit air space

                CellType below = grid.cell(x, y - 1, z);
                CellType above = grid.cell(x, y + 1, z);
                CellType west  = grid.cell(x - 1, y, z);
                CellType east  = grid.cell(x + 1, y, z);
                CellType north = grid.cell(x, y, z + 1);
                CellType south = grid.cell(x, y, z - 1);

                const bool solidBelow = is_solid(below);
                const bool solidAbove = is_solid(above);
                const bool solidWest  = is_solid(west);
                const bool solidEast  = is_solid(east);
                const bool solidNorth = is_solid(north);
                const bool solidSouth = is_solid(south);

                // Count open horizontal directions
                int nOpen = 0;
                if (!solidWest)  nOpen++;
                if (!solidEast)  nOpen++;
                if (!solidNorth) nOpen++;
                if (!solidSouth) nOpen++;

                float wx = static_cast<float>(x) * kCell;
                float wy = static_cast<float>(y) * kCell;
                float wz = static_cast<float>(z) * kCell;

                // Per-cell slot occupation tracking to prevent multi-prop stacking
                bool ceilingOccupied = false;
                bool floorOccupied   = false;
                bool wallOccupied    = false;

                // 2. Floor Grates & Drainage (Grate, RoundGrate)
                std::uint32_t rngGrate = giga::spatial_hash(x, y, z, seed ^ kSaltGrate);
                if (solidBelow && !floorOccupied && (below == kMatElectricGrate || (rngGrate % 100 < kCfg.grateFloorChancePct))) {
                    PropInstance grate{};
                    grate.origin    = {wx, wy + 0.01f, wz};
                    grate.yaw       = (!solidWest && !solidEast) ? 0.0f : kHalfPi;
                    grate.color     = kCfg.grateColor;
                    grate.matId     = 4;
                    grate.animPhase = static_cast<std::uint8_t>(rngGrate & 0xFFu);

                    PropShape shape = (rngGrate & 2) ? PropShape::RoundGrate : PropShape::Grate;
                    if (below == kMatElectricGrate) {
                        grate.color    = {0.30f, 0.65f, 0.95f};
                        grate.emissive = 140;
                        grate.flags    = 0x04; // Glow pulse bit
                        shape          = PropShape::Grate;
                    }

                    propPass.add_instance(shape, grate);
                    totalPlaced_++;
                    floorOccupied = true;
                }

                // 3. Wall Devices & Soviet Props (CabinetBox, Terminal, Radiator, ElectricalShield)
                std::uint32_t rngWall = giga::spatial_hash(x, y, z, seed ^ kSaltWall);
                if (solidBelow && (solidWest || solidEast || solidNorth || solidSouth) && !wallOccupied) {
                    float yawVal = 0.0f;
                    if (solidWest)        yawVal = 0.0f;
                    else if (solidEast)   yawVal = kPi;
                    else if (solidSouth)  yawVal = kHalfPi;
                    else if (solidNorth)  yawVal = kHalfPi * 3.0f;

                    std::uint32_t wsel = rngWall % 100;
                    if (wsel < 15) {
                        // Cast-iron accordion radiator under windows / on walls
                        PropInstance rad{};
                        rad.origin    = {wx, wy + 0.05f, wz};
                        rad.yaw       = yawVal;
                        rad.color     = {0.80f, 0.78f, 0.74f}; // Aged radiator off-white enamel
                        rad.matId     = 4;
                        rad.animPhase = static_cast<std::uint8_t>(rngWall & 0xFFu);
                        propPass.add_instance(PropShape::Radiator, rad);
                        totalPlaced_++;
                        wallOccupied = true;
                    } else if (wsel < 25) {
                        // ElectricalShield GPU instance owned by ECS PropMesh skin
                        // ([jirnyak.md] §18). Reserve wall slot so radiators do not stack.
                        wallOccupied = true;
                    } else if (wsel < 35) {
                        // Terminal GPU instance owned by ECS PropMesh skin
                        // ([jirnyak.md] §18). Reserve wall slot.
                        wallOccupied = true;
                    }
                }

                // 4. Lights — ECS seed_ceiling_lights owns BareBulb/FloodLamp GPU
                // instances ([jirnyak.md] §18 PropPass passive skin). Still reserve
                // the ceiling slot with the same hash so other props do not stack.
                std::uint32_t rngLight = giga::spatial_hash(x, y, z, seed ^ kSaltLight);
                if (solidAbove && !ceilingOccupied && (rngLight % 100 < kCfg.lightChancePct)) {
                    ceilingOccupied = true;
                }

                std::uint32_t rngSec = giga::spatial_hash(x, y, z, seed ^ kSaltSecurity);
                if (solidAbove && (solidWest || solidEast || solidNorth || solidSouth) && !wallOccupied && (rngSec % 100 < 8)) {
                    PropInstance cam{};
                    cam.origin    = {wx, wy + 1.50f, wz};
                    if (solidWest)        cam.yaw = 0.0f;
                    else if (solidEast)   cam.yaw = kPi;
                    else if (solidSouth)  cam.yaw = kHalfPi;
                    else if (solidNorth)  cam.yaw = kHalfPi * 3.0f;
                    cam.color     = {0.40f, 0.42f, 0.45f};
                    cam.matId     = 4;
                    cam.emissive  = 120;
                    cam.animPhase = static_cast<std::uint8_t>(rngSec & 0xFFu);

                    propPass.add_instance(PropShape::SecurityCamera, cam);
                    totalPlaced_++;
                    wallOccupied = true;
                }

                // 5. Anomalous Zones (AcidPool, FungalColumn, CrystalCluster)
                std::uint32_t rngAnomaly = giga::spatial_hash(x, y, z, seed ^ kSaltAnomaly);
                const bool isAnomalyMat = (below == kMatAcidPool || below == kMatWaterMark || below == kMatElectricGrate);
                if (solidBelow && !floorOccupied && (isAnomalyMat || (rngAnomaly % 1000 < kCfg.anomalyChancePermil))) {
                    PropInstance crystal{};
                    crystal.origin    = {wx, wy + 0.01f, wz};
                    crystal.yaw       = static_cast<float>(rngAnomaly % 360) * (kPi / 180.0f);
                    crystal.color     = kCfg.crystalCol;
                    crystal.matId     = 0;
                    crystal.emissive  = 200;
                    crystal.flags     = 0x04; // Glow pulse bit
                    crystal.animPhase = static_cast<std::uint8_t>(rngAnomaly & 0xFFu);

                    PropShape shape = PropShape::CrystalCluster;
                    if (below == kMatAcidPool) {
                        shape            = PropShape::AcidPool;
                        crystal.color    = kCfg.acidCol;
                        crystal.emissive = 140;
                    } else if (solidAbove && (rngAnomaly % 100 < 30)) {
                        shape            = PropShape::FungalColumn;
                        crystal.color    = kCfg.fungalCol;
                        crystal.emissive = 160;
                    }

                    propPass.add_instance(shape, crystal);
                    totalPlaced_++;
                    floorOccupied = true;
                }

                // 6. Corner Structural Pillars & Archways (Cylinder, Arch) — ONLY at room corners
                std::uint32_t rngPillar = giga::spatial_hash(x, y, z, seed ^ kSaltPillar);
                bool isCorner = ((solidWest || solidEast) && (solidNorth || solidSouth));
                if (solidBelow && solidAbove && isCorner && !floorOccupied && (rngPillar % 100 < 15)) {
                    PropInstance pillar{};
                    pillar.origin    = {wx, wy, wz};
                    pillar.yaw       = 0.0f;
                    pillar.color     = {0.35f, 0.35f, 0.38f};
                    pillar.matId     = 1;
                    pillar.animPhase = static_cast<std::uint8_t>(rngPillar & 0xFFu);

                    propPass.add_instance(PropShape::Cylinder, pillar);
                    totalPlaced_++;
                    floorOccupied = true;
                }

                if (solidBelow && solidAbove && (solidWest || solidEast || solidNorth || solidSouth) && !wallOccupied && (rngPillar % 100 < 10)) {
                    PropInstance hc{};
                    hc.origin    = {wx, wy, wz};
                    if (solidWest)        hc.yaw = 0.0f;
                    else if (solidEast)   hc.yaw = kPi;
                    else if (solidSouth)  hc.yaw = kHalfPi;
                    else if (solidNorth)  hc.yaw = kHalfPi * 3.0f;
                    hc.color     = {0.30f, 0.32f, 0.35f};
                    hc.matId     = 4;
                    hc.animPhase = static_cast<std::uint8_t>(rngPillar & 0xFFu);

                    propPass.add_instance(PropShape::HalfCylinder, hc);
                    totalPlaced_++;
                    wallOccupied = true;
                }

                if (solidBelow && solidAbove && !ceilingOccupied &&
                    ((solidWest && solidEast && !solidNorth && !solidSouth) || (!solidWest && !solidEast && solidNorth && solidSouth)) &&
                    (rngPillar % 100 < 15)) {
                    PropInstance arch{};
                    arch.origin    = {wx, wy, wz};
                    arch.yaw       = (!solidWest && !solidEast) ? 0.0f : kHalfPi;
                    arch.color     = {0.40f, 0.38f, 0.35f};
                    arch.matId     = 1;
                    arch.animPhase = static_cast<std::uint8_t>(rngPillar & 0xFFu);

                    propPass.add_instance(PropShape::Arch, arch);
                    totalPlaced_++;
                    ceilingOccupied = true;
                }

                // 7. Floor Clutter, Furniture & Storage (CrateBox, CrateLong, Barrel, StairStep, Railing, BenchSlab)
                std::uint32_t rngBench = giga::spatial_hash(x, y, z, seed ^ kSaltBench);
                if (solidBelow && (solidWest || solidEast || solidNorth || solidSouth) && !floorOccupied && (rngBench % 100 < 10)) {
                    PropInstance bench{};
                    bench.origin    = {wx, wy + 0.01f, wz};
                    if (solidWest)        bench.yaw = 0.0f;
                    else if (solidEast)   bench.yaw = kPi;
                    else if (solidSouth)  bench.yaw = kHalfPi;
                    else if (solidNorth)  bench.yaw = kHalfPi * 3.0f;
                    bench.color     = {0.50f, 0.30f, 0.20f};
                    bench.matId     = 2;
                    bench.animPhase = static_cast<std::uint8_t>(rngBench & 0xFFu);

                    propPass.add_instance(PropShape::BenchSlab, bench);
                    totalPlaced_++;
                    floorOccupied = true;
                }

                std::uint32_t rngRail = giga::spatial_hash(x, y, z, seed ^ kSaltRailing);
                if (solidBelow && !solidAbove && !floorOccupied && (nOpen >= 2) && (rngRail % 100 < 8)) {
                    PropInstance rail{};
                    rail.origin    = {wx, wy + 0.01f, wz};
                    rail.yaw       = (!solidWest && !solidEast) ? 0.0f : kHalfPi;
                    rail.color     = {0.35f, 0.38f, 0.40f};
                    rail.matId     = 4;
                    rail.animPhase = static_cast<std::uint8_t>(rngRail & 0xFFu);

                    propPass.add_instance(PropShape::Railing, rail);
                    totalPlaced_++;
                    floorOccupied = true;
                }

                std::uint32_t rngCrate = giga::spatial_hash(x, y, z, seed ^ kSaltCrate);
                if (solidBelow && (nOpen <= 2) && (solidWest || solidEast) && (solidNorth || solidSouth) && !floorOccupied && (rngCrate % 100 < kCfg.crateCornerChancePct)) {
                    PropInstance item{};
                    item.origin    = {wx, wy + 0.01f, wz};
                    item.yaw       = static_cast<float>(rngCrate % 360) * (kPi / 180.0f);
                    item.color     = kCfg.crateColor;
                    item.matId     = 2;
                    item.animPhase = static_cast<std::uint8_t>(rngCrate & 0xFFu);

                    PropShape shape = PropShape::CrateBox;
                    std::uint32_t csel = rngCrate % 4;
                    if (csel == 0) {
                        shape = PropShape::CrateLong;
                    } else if (csel == 1) {
                        shape = PropShape::Barrel;
                        item.color = {0.38f, 0.28f, 0.18f};
                    } else if (csel == 2) {
                        shape = PropShape::StairStep;
                        item.color = {0.40f, 0.40f, 0.42f};
                        item.matId = 1;
                    }

                    propPass.add_instance(shape, item);
                    totalPlaced_++;
                    floorOccupied = true;
                }
            }
        }
    }
}

} // namespace giga::gpu
