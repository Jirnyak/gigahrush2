// env_detail.cpp — Environment Detail Biome Placement Implementation
//
// Biome classification algorithm:
//   1. Count material neighbours in a 3x3x3 cube around each air cell.
//   2. Weight kMatAcidPool / kMatWaterMark -> Anomalous/Organic.
//   3. Deep floors (y < 32) bias towards Organic and Anomalous.
//   4. Apply spatial-hash XOR to break checkerboard and add natural variation.
//   5. Propagate biome blobs: if >4 neighbours share a biome, adopt it.
//
// Placement is then driven entirely by the per-biome BiomePropConfig table.
// Zero heap allocations in the hot loop. No exceptions, no RTTI.
//
#include "render/env_detail.h"

#include <cmath>
#include <cstdio>
#include <numbers>

#include "world/materials.h"

namespace giga::gpu {

namespace {

constexpr float kTwoPi  = 6.283185307179586f;
constexpr float kHalfPi = 1.5707963267948966f;
constexpr float kPi     = std::numbers::pi_v<float>;
constexpr float kCell   = kCellSize;

// Distinct salt constants for each rule category — no cross-rule RNG correlation
constexpr std::uint32_t kSaltClassify = 0xF1F1F1F1u;
constexpr std::uint32_t kSaltCeiling  = 0xA0A0A0A0u;
constexpr std::uint32_t kSaltFloor    = 0xB1B1B1B1u;
constexpr std::uint32_t kSaltWall     = 0xC2C2C2C2u;
constexpr std::uint32_t kSaltStruct   = 0xD3D3D3D3u;
constexpr std::uint32_t kSaltSubA     = 0x0F0F0F0Fu;
constexpr std::uint32_t kSaltSubB     = 0x1E1E1E1Eu;
constexpr std::uint32_t kSaltSubC     = 0x2D2D2D2Du;
constexpr std::uint32_t kSaltSubD     = 0x3C3C3C3Cu;

} // namespace

// ────────────────────────── biome config table ──────────────────────────────

// Industrial: dense machinery, pipes, lights, cabinets
static BiomePropConfig make_industrial() {
    BiomePropConfig c;
    c.pipeCeilingPct  = 45;
    c.lampCeilingPct  = 18;
    c.grateFloorPct   = 20;
    c.cabinetWallPct  = 18;
    c.terminalWallPct = 8;
    c.cameraWallPct   = 10;
    c.supportBeamPct  = 50;
    c.crateCornerPct  = 22;
    c.pipeCol         = {0.22f, 0.25f, 0.28f};
    c.emissiveScale   = 1.0f;
    return c;
}

// Residential: lockers, benches, terminals, fewer machines
static BiomePropConfig make_residential() {
    BiomePropConfig c;
    c.pipeCeilingPct  = 20;
    c.lampCeilingPct  = 30;
    c.grateFloorPct   = 8;
    c.benchWallPct    = 22;
    c.lockerWallPct   = 25;
    c.terminalWallPct = 15;
    c.cameraWallPct   = 12;
    c.cabinetWallPct  = 8;
    c.crateCornerPct  = 10;
    c.supportBeamPct  = 20;
    c.warmLampCol     = {1.00f, 0.92f, 0.76f};
    c.woodenCol       = {0.55f, 0.36f, 0.22f};
    c.emissiveScale   = 1.1f;
    return c;
}

// Organic: fungal columns, crystal clusters, bioluminescence, minimal tech
static BiomePropConfig make_organic() {
    BiomePropConfig c;
    c.pipeCeilingPct  = 8;
    c.lampCeilingPct  = 5;
    c.grateFloorPct   = 4;
    c.cabinetWallPct  = 2;
    c.terminalWallPct = 0;
    c.fungalWallPpm   = 40;
    c.crystalFloorPpm = 50;
    c.acidFloorPpm    = 15;
    c.crateCornerPct  = 4;
    c.supportBeamPct  = 10;
    c.pillarPct       = 35;
    c.crystalCol      = {0.60f, 0.12f, 0.98f};
    c.fungalCol       = {0.38f, 0.78f, 0.28f};
    c.emissiveScale   = 1.4f;
    return c;
}

// Anomalous: acid drips, glowing cracks, crystals, deformed infrastructure
static BiomePropConfig make_anomalous() {
    BiomePropConfig c;
    c.pipeCeilingPct  = 25;
    c.lampCeilingPct  = 12;
    c.grateFloorPct   = 5;
    c.acidFloorPpm    = 80;
    c.crystalFloorPpm = 60;
    c.cabinetWallPct  = 3;
    c.cameraWallPct   = 3;
    c.supportBeamPct  = 15;
    c.crystalCol      = {0.90f, 0.08f, 0.85f};
    c.acidCol         = {0.10f, 0.98f, 0.18f};
    c.emissiveScale   = 1.8f;
    c.rustCol         = {0.65f, 0.38f, 0.08f};
    return c;
}

// Derelict: few lights (dim), heavy rust, broken railings, collapsed state
static BiomePropConfig make_derelict() {
    BiomePropConfig c;
    c.pipeCeilingPct  = 30;
    c.lampCeilingPct  = 6;
    c.grateFloorPct   = 18;
    c.cabinetWallPct  = 5;
    c.cameraWallPct   = 2;
    c.crateCornerPct  = 28;
    c.supportBeamPct  = 45;
    c.pipeCol         = {0.40f, 0.30f, 0.20f};
    c.grateCol        = {0.28f, 0.22f, 0.18f};
    c.rustCol         = {0.55f, 0.30f, 0.10f};
    c.warmLampCol     = {0.80f, 0.70f, 0.50f};
    c.emissiveScale   = 0.35f;  // very dim — most lights broken
    return c;
}

// Static per-biome config table
const std::array<BiomePropConfig, kBiomeCount> EnvDetail::kBiomeConfigs = {
    make_industrial(),
    make_residential(),
    make_organic(),
    make_anomalous(),
    make_derelict(),
};

// ────────────────────────── helpers ──────────────────────────────────────────

/*static*/ std::uint32_t
EnvDetail::spatial_hash(int x, int y, int z, std::uint32_t seed) noexcept {
    std::uint32_t h = static_cast<std::uint32_t>(x) * 73856093u ^
                      static_cast<std::uint32_t>(y) * 19349663u ^
                      static_cast<std::uint32_t>(z) * 83492791u ^ seed;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    return h ^ (h >> 16);
}

// ────────────────────────── biome classification ──────────────────────────────

/*static*/ Biome
EnvDetail::classify_cell(const MacroGrid& grid, int x, int y, int z,
                          std::uint32_t seed) noexcept {
    // Count weighted material indicators in 3×3×3 neighbourhood
    int cntAcid    = 0;
    int cntFungal  = 0;  // kMatWaterMark or mould-hinting mats
    int cntSolid   = 0;
    int cntAir     = 0;

    for (int dz = -1; dz <= 1; ++dz) {
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                CellType m = grid.cell(x+dx, y+dy, z+dz);
                if (m == kCellAir)            { cntAir++;    continue; }
                cntSolid++;
                if (m == kMatAcidPool)        cntAcid    += 3;
                if (m == kMatWaterMark)       cntFungal  += 2;
                if (m == kMatElectricGrate)   cntAcid    += 1;
            }
        }
    }

    // Depth heuristic: lower y = more organic / anomalous pressure
    int depth = kMacroDim - 1 - y;   // 0 at top, 127 at bottom
    int depthBias = depth / 20;       // 0..6

    // Spatial noise for variety
    std::uint32_t rng = spatial_hash(x, y, z, seed ^ kSaltClassify);
    int noise = static_cast<int>(rng % 10);  // 0..9

    // Scoring: highest score wins biome
    int scoreIndustrial  = 20 + noise;
    int scoreResidential = 10 + noise / 2;
    int scoreOrganic     = cntFungal * 4 + depthBias * 3 + noise;
    int scoreAnomalous   = cntAcid   * 5 + depthBias * 2 + noise / 2;
    int scoreDerelict    = (cntSolid > 20 ? 15 : 0) + noise;

    // Override: acid pool cells near lots of acid material -> Anomalous
    CellType below = grid.cell(x, y-1, z);
    if (below == kMatAcidPool)    scoreAnomalous += 40;
    if (below == kMatWaterMark)   scoreOrganic   += 30;

    // Structural features -> Industrial
    if (cntAir < 5 && cntSolid > 22)  scoreDerelict  += 20;
    if (y > kMacroDim - 20)           scoreResidential += 15; // near surface = residential

    // Pick winner
    int best = scoreIndustrial;
    Biome winner = Biome::Industrial;
    if (scoreResidential > best) { best = scoreResidential; winner = Biome::Residential; }
    if (scoreOrganic     > best) { best = scoreOrganic;     winner = Biome::Organic;     }
    if (scoreAnomalous   > best) { best = scoreAnomalous;   winner = Biome::Anomalous;   }
    if (scoreDerelict    > best) {                           winner = Biome::Derelict;    }

    return winner;
}

void EnvDetail::classify(const MacroGrid& grid, std::uint32_t seed) noexcept {
    // Pass 1: classify each air cell
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) {
                    biomeMap_.set(x, y, z, Biome::Industrial); // solid = doesn't matter
                    continue;
                }
                Biome b = classify_cell(grid, x, y, z, seed);
                biomeMap_.set(x, y, z, b);
            }
        }
    }

    // Pass 2: biome blob propagation — smooth out salt-and-pepper noise.
    // An air cell with >=4 same-biome air neighbours adopts that biome.
    // Single pass forward sweep is cheap and enough for visual continuity.
    for (int z = 1; z < kMacroDim-1; ++z) {
        for (int y = 1; y < kMacroDim-1; ++y) {
            for (int x = 1; x < kMacroDim-1; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;
                // Count neighbours per biome
                int votes[kBiomeCount] = {};
                for (int dz = -1; dz <= 1; ++dz) {
                    for (int dy = -1; dy <= 1; ++dy) {
                        for (int dx = -1; dx <= 1; ++dx) {
                            if (dx == 0 && dy == 0 && dz == 0) continue;
                            if (grid.cell(x+dx, y+dy, z+dz) == kCellAir) {
                                int bi = static_cast<int>(biomeMap_.at(x+dx, y+dy, z+dz));
                                if (bi < kBiomeCount) votes[bi]++;
                            }
                        }
                    }
                }
                int myBiome = static_cast<int>(biomeMap_.at(x, y, z));
                // Find dominant neighbour biome
                int bestVotes = 0;
                int bestBiome = myBiome;
                for (int b = 0; b < kBiomeCount; ++b) {
                    if (votes[b] > bestVotes) { bestVotes = votes[b]; bestBiome = b; }
                }
                // If majority (>=14 of 26 neighbours) agree and disagree with us, adopt
                if (bestVotes >= 14 && bestBiome != myBiome) {
                    biomeMap_.set(x, y, z, static_cast<Biome>(bestBiome));
                }
            }
        }
    }

    // Log biome stats
    int counts[kBiomeCount] = {};
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                if (grid.cell(x, y, z) == kCellAir)
                    counts[static_cast<int>(biomeMap_.at(x, y, z))]++;

    std::fprintf(stderr,
        "[env_detail] biome classification done: "
        "Industrial=%d Residential=%d Organic=%d Anomalous=%d Derelict=%d\n",
        counts[0], counts[1], counts[2], counts[3], counts[4]);
}

// ────────────────────────── placement helpers ─────────────────────────────────

void EnvDetail::place_ceiling_props(const MacroGrid& grid, PropPass& pass,
                                     int x, int y, int z,
                                     const BiomePropConfig& cfg,
                                     std::uint32_t seed) const noexcept {
    float wx = static_cast<float>(x) * kCell;
    float wy = static_cast<float>(y) * kCell;
    float wz = static_cast<float>(z) * kCell;

    bool solidAbove = is_solid(grid.cell(x, y+1, z));
    if (!solidAbove) return;

    // Determine open directions
    bool openW = !is_solid(grid.cell(x-1, y, z));
    bool openE = !is_solid(grid.cell(x+1, y, z));
    bool openN = !is_solid(grid.cell(x, y, z+1));
    bool openS = !is_solid(grid.cell(x, y, z-1));
    int nOpen = (openW?1:0) + (openE?1:0) + (openN?1:0) + (openS?1:0);

    bool ceilOccupied = false;

    // Pipes
    std::uint32_t rngPipe = spatial_hash(x, y, z, seed ^ kSaltCeiling);
    if (!ceilOccupied && (rngPipe % 100 < cfg.pipeCeilingPct)) {
        PropInstance pi{};
        pi.origin    = {wx, wy + 1.70f, wz};
        pi.yaw       = (!openW && !openE) ? 0.0f : kHalfPi;
        pi.color     = cfg.pipeCol;
        pi.matId     = 4;
        pi.animPhase = static_cast<std::uint8_t>(rngPipe & 0xFFu);

        PropShape shape = PropShape::Pipe;
        std::uint32_t sub = spatial_hash(x, y, z, seed ^ kSaltSubA);
        if (nOpen >= 3)          shape = PropShape::PipeTee;
        else if (sub % 5 == 0)  shape = PropShape::PipeElbow;
        else if (sub % 5 == 1)  shape = PropShape::Valve;

        pass.add_instance(shape, pi);
        ++totalPlaced_;
        ceilOccupied = true;
    }

    // Flood lamps
    std::uint32_t rngLamp = spatial_hash(x, y, z, seed ^ (kSaltCeiling ^ kSaltSubB));
    if (!ceilOccupied && (rngLamp % 100 < cfg.lampCeilingPct) &&
        (nOpen >= 3 || (x % 6 == 0 && z % 6 == 0))) {
        PropInstance li{};
        li.origin    = {wx, wy + 1.70f, wz};
        li.yaw       = static_cast<float>(rngLamp % 4) * kHalfPi;
        li.color     = (rngLamp & 1) ? cfg.warmLampCol : cfg.coolLampCol;
        li.matId     = 0;
        li.emissive  = static_cast<std::uint8_t>(std::min(255.0f, 240.0f * cfg.emissiveScale));
        li.animPhase = static_cast<std::uint8_t>(rngLamp & 0xFFu);

        pass.add_instance(PropShape::FloodLamp, li);
        ++totalPlaced_;
        ceilOccupied = true;
    }

    // Support beams (full-room span)
    std::uint32_t rngBeam = spatial_hash(x, y, z, seed ^ kSaltStruct);
    if (!ceilOccupied && (x % 8 == 0) && (z % 8 == 0) &&
        is_solid(grid.cell(x, y-1, z)) &&
        (rngBeam % 100 < cfg.beamCeilingPct)) {
        PropInstance bi{};
        bi.origin    = {wx, wy, wz};
        bi.yaw       = static_cast<float>(rngBeam % 2) * kHalfPi;
        bi.color     = cfg.metalCol;
        bi.matId     = 4;
        bi.animPhase = static_cast<std::uint8_t>(rngBeam & 0xFFu);

        pass.add_instance(PropShape::SupportBeam, bi);
        ++totalPlaced_;
        (void)ceilOccupied; // beam doesn't block lamp
    }
}

void EnvDetail::place_floor_props(const MacroGrid& grid, PropPass& pass,
                                   int x, int y, int z,
                                   const BiomePropConfig& cfg,
                                   std::uint32_t seed) const noexcept {
    float wx = static_cast<float>(x) * kCell;
    float wy = static_cast<float>(y) * kCell;
    float wz = static_cast<float>(z) * kCell;

    CellType below = grid.cell(x, y-1, z);
    if (!is_solid(below)) return;

    bool openW = !is_solid(grid.cell(x-1, y, z));
    bool openE = !is_solid(grid.cell(x+1, y, z));
    bool openN = !is_solid(grid.cell(x, y, z+1));
    bool openS = !is_solid(grid.cell(x, y, z-1));
    int nOpen = (openW?1:0) + (openE?1:0) + (openN?1:0) + (openS?1:0);

    bool floorOccupied = false;

    // Grates
    std::uint32_t rngGrate = spatial_hash(x, y, z, seed ^ kSaltFloor);
    if (!floorOccupied && (below == kMatElectricGrate || (rngGrate % 100 < cfg.grateFloorPct))) {
        PropInstance gi{};
        gi.origin = {wx, wy + 0.01f, wz};
        gi.yaw    = (!openW && !openE) ? 0.0f : kHalfPi;
        gi.color  = cfg.grateCol;
        gi.matId  = 4;
        gi.animPhase = static_cast<std::uint8_t>(rngGrate & 0xFFu);

        PropShape shape = (rngGrate & 2) ? PropShape::RoundGrate : PropShape::Grate;
        if (below == kMatElectricGrate) {
            gi.color   = {0.30f, 0.65f, 0.95f};
            gi.emissive = static_cast<std::uint8_t>(140.0f * cfg.emissiveScale);
            gi.flags   = 0x04;
            shape      = PropShape::Grate;
        }

        pass.add_instance(shape, gi);
        ++totalPlaced_;
        floorOccupied = true;
    }

    // Acid pools (material or per-mille chance)
    std::uint32_t rngAcid = spatial_hash(x, y, z, seed ^ (kSaltFloor ^ kSaltSubA));
    if (!floorOccupied && (below == kMatAcidPool || (rngAcid % 1000 < cfg.acidFloorPpm))) {
        PropInstance ai{};
        ai.origin    = {wx, wy + 0.01f, wz};
        ai.yaw       = static_cast<float>(rngAcid % 360) * (kPi / 180.0f);
        ai.color     = cfg.acidCol;
        ai.matId     = 0;
        ai.emissive  = static_cast<std::uint8_t>(140.0f * cfg.emissiveScale);
        ai.flags     = 0x04;
        ai.animPhase = static_cast<std::uint8_t>(rngAcid & 0xFFu);

        pass.add_instance(PropShape::AcidPool, ai);
        ++totalPlaced_;
        floorOccupied = true;
    }

    // Crystal clusters
    std::uint32_t rngCrystal = spatial_hash(x, y, z, seed ^ (kSaltFloor ^ kSaltSubB));
    if (!floorOccupied && (rngCrystal % 1000 < cfg.crystalFloorPpm)) {
        PropInstance ci{};
        ci.origin    = {wx, wy + 0.01f, wz};
        ci.yaw       = static_cast<float>(rngCrystal % 360) * (kPi / 180.0f);
        ci.color     = cfg.crystalCol;
        ci.matId     = 0;
        ci.emissive  = static_cast<std::uint8_t>(200.0f * cfg.emissiveScale);
        ci.flags     = 0x04;
        ci.animPhase = static_cast<std::uint8_t>(rngCrystal & 0xFFu);

        pass.add_instance(PropShape::CrystalCluster, ci);
        ++totalPlaced_;
        floorOccupied = true;
    }

    // Crates in corners (nOpen <= 2, both x-wall and z-wall present)
    std::uint32_t rngCrate = spatial_hash(x, y, z, seed ^ (kSaltFloor ^ kSaltSubC));
    bool hasXwall = (is_solid(grid.cell(x-1,y,z)) || is_solid(grid.cell(x+1,y,z)));
    bool hasZwall = (is_solid(grid.cell(x,y,z-1)) || is_solid(grid.cell(x,y,z+1)));
    if (!floorOccupied && hasXwall && hasZwall && nOpen <= 2 && (rngCrate % 100 < cfg.crateCornerPct)) {
        PropInstance cr{};
        cr.origin    = {wx, wy + 0.01f, wz};
        cr.yaw       = static_cast<float>(rngCrate % 360) * (kPi / 180.0f);
        cr.color     = cfg.woodenCol;
        cr.matId     = 2;
        cr.animPhase = static_cast<std::uint8_t>(rngCrate & 0xFFu);

        PropShape shape = PropShape::CrateBox;
        std::uint32_t csel = rngCrate % 5;
        if (csel == 0)      shape = PropShape::CrateLong;
        else if (csel == 1) { shape = PropShape::Barrel;    cr.color = {0.40f, 0.28f, 0.18f}; }
        else if (csel == 2) { shape = PropShape::StairStep; cr.color = {0.40f, 0.40f, 0.42f}; cr.matId = 1; }

        pass.add_instance(shape, cr);
        ++totalPlaced_;
        floorOccupied = true;
    }

    // Benches along walls
    std::uint32_t rngBench = spatial_hash(x, y, z, seed ^ (kSaltFloor ^ kSaltSubD));
    bool solidWall = (is_solid(grid.cell(x-1,y,z)) || is_solid(grid.cell(x+1,y,z)) ||
                      is_solid(grid.cell(x,y,z-1)) || is_solid(grid.cell(x,y,z+1)));
    if (!floorOccupied && solidWall && (rngBench % 100 < cfg.benchWallPct)) {
        PropInstance bn{};
        bn.origin = {wx, wy + 0.01f, wz};
        if      (is_solid(grid.cell(x-1,y,z))) bn.yaw = 0.0f;
        else if (is_solid(grid.cell(x+1,y,z))) bn.yaw = kPi;
        else if (is_solid(grid.cell(x,y,z-1))) bn.yaw = kHalfPi;
        else                                    bn.yaw = kHalfPi * 3.0f;
        bn.color  = cfg.woodenCol;
        bn.matId  = 2;
        bn.animPhase = static_cast<std::uint8_t>(rngBench & 0xFFu);

        pass.add_instance(PropShape::BenchSlab, bn);
        ++totalPlaced_;
        floorOccupied = true;
    }

    // Railings on open ledges
    std::uint32_t rngRail = spatial_hash(x, y, z, seed ^ (kSaltFloor ^ 0xF0F0F0F0u));
    if (!floorOccupied && !is_solid(grid.cell(x, y+1, z)) && nOpen >= 2 && (rngRail % 100 < 8)) {
        PropInstance rl{};
        rl.origin = {wx, wy + 0.01f, wz};
        rl.yaw    = (!openW && !openE) ? 0.0f : kHalfPi;
        rl.color  = cfg.metalCol;
        rl.matId  = 4;
        rl.animPhase = static_cast<std::uint8_t>(rngRail & 0xFFu);
        pass.add_instance(PropShape::Railing, rl);
        ++totalPlaced_;
    }
}

void EnvDetail::place_wall_props(const MacroGrid& grid, PropPass& pass,
                                  int x, int y, int z,
                                  const BiomePropConfig& cfg,
                                  std::uint32_t seed) const noexcept {
    float wx = static_cast<float>(x) * kCell;
    float wy = static_cast<float>(y) * kCell;
    float wz = static_cast<float>(z) * kCell;

    bool solidBelow = is_solid(grid.cell(x, y-1, z));
    if (!solidBelow) return;

    bool solidW = is_solid(grid.cell(x-1, y, z));
    bool solidE = is_solid(grid.cell(x+1, y, z));
    bool solidN = is_solid(grid.cell(x, y, z+1));
    bool solidS = is_solid(grid.cell(x, y, z-1));
    if (!solidW && !solidE && !solidN && !solidS) return;

    bool wallOccupied = false;

    auto face_yaw = [&]() -> float {
        if      (solidW) return 0.0f;
        else if (solidE) return kPi;
        else if (solidS) return kHalfPi;
        else             return kHalfPi * 3.0f;
    };

    // Cabinets / control panels
    std::uint32_t rngCab = spatial_hash(x, y, z, seed ^ kSaltWall);
    if (!wallOccupied && (rngCab % 100 < cfg.cabinetWallPct)) {
        PropInstance ci{};
        ci.origin = {wx, wy, wz};
        ci.yaw    = face_yaw();
        ci.color  = cfg.metalCol;
        ci.matId  = 3;
        ci.animPhase = static_cast<std::uint8_t>(rngCab & 0xFFu);

        PropShape shape = PropShape::CabinetBox;
        std::uint32_t wsel = rngCab % 3;
        if (wsel == 1) shape = PropShape::ControlPanel;
        else if (wsel == 2) { shape = PropShape::CabinetBox; ci.emissive = static_cast<std::uint8_t>(80.0f * cfg.emissiveScale); }

        pass.add_instance(shape, ci);
        ++totalPlaced_;
        wallOccupied = true;
    }

    // Lockers
    std::uint32_t rngLocker = spatial_hash(x, y, z, seed ^ (kSaltWall ^ kSaltSubA));
    if (!wallOccupied && (rngLocker % 100 < cfg.lockerWallPct)) {
        PropInstance li{};
        li.origin = {wx, wy, wz};
        li.yaw    = face_yaw();
        li.color  = cfg.metalCol;
        li.matId  = 3;
        li.animPhase = static_cast<std::uint8_t>(rngLocker & 0xFFu);

        pass.add_instance(PropShape::LockerUnit, li);
        ++totalPlaced_;
        wallOccupied = true;
    }

    // Terminals
    std::uint32_t rngTerm = spatial_hash(x, y, z, seed ^ (kSaltWall ^ kSaltSubB));
    if (!wallOccupied && (rngTerm % 100 < cfg.terminalWallPct)) {
        PropInstance ti{};
        ti.origin   = {wx, wy, wz};
        ti.yaw      = face_yaw();
        ti.color    = cfg.terminalCol;
        ti.matId    = 3;
        ti.emissive = static_cast<std::uint8_t>(60.0f * cfg.emissiveScale);
        ti.animPhase = static_cast<std::uint8_t>(rngTerm & 0xFFu);

        pass.add_instance(PropShape::Terminal, ti);
        ++totalPlaced_;
        wallOccupied = true;
    }

    // Security cameras (upper wall position)
    std::uint32_t rngCam = spatial_hash(x, y, z, seed ^ (kSaltWall ^ kSaltSubC));
    if (!wallOccupied && is_solid(grid.cell(x, y+1, z)) &&
        (rngCam % 100 < cfg.cameraWallPct)) {
        PropInstance cam{};
        cam.origin   = {wx, wy + 1.50f, wz};
        cam.yaw      = face_yaw();
        cam.color    = {0.40f, 0.42f, 0.45f};
        cam.matId    = 4;
        cam.emissive = static_cast<std::uint8_t>(120.0f * cfg.emissiveScale);
        cam.animPhase = static_cast<std::uint8_t>(rngCam & 0xFFu);

        pass.add_instance(PropShape::SecurityCamera, cam);
        ++totalPlaced_;
        wallOccupied = true;
    }

    // Fungal wall growth (organic biome special)
    std::uint32_t rngFung = spatial_hash(x, y, z, seed ^ (kSaltWall ^ kSaltSubD));
    if (!wallOccupied && (rngFung % 1000 < cfg.fungalWallPpm)) {
        PropInstance fi{};
        fi.origin   = {wx, wy + 0.01f, wz};
        fi.yaw      = static_cast<float>(rngFung % 360) * (kPi / 180.0f);
        fi.color    = cfg.fungalCol;
        fi.matId    = 0;
        fi.emissive = static_cast<std::uint8_t>(160.0f * cfg.emissiveScale);
        fi.flags    = 0x04;
        fi.animPhase = static_cast<std::uint8_t>(rngFung & 0xFFu);

        pass.add_instance(PropShape::FungalColumn, fi);
        ++totalPlaced_;
    }
}

void EnvDetail::place_structural(const MacroGrid& grid, PropPass& pass,
                                  int x, int y, int z,
                                  const BiomePropConfig& cfg,
                                  std::uint32_t seed) const noexcept {
    float wx = static_cast<float>(x) * kCell;
    float wy = static_cast<float>(y) * kCell;
    float wz = static_cast<float>(z) * kCell;

    bool solidBelow = is_solid(grid.cell(x, y-1, z));
    bool solidAbove = is_solid(grid.cell(x, y+1, z));

    std::uint32_t rngStruct = spatial_hash(x, y, z, seed ^ kSaltStruct);

    // H-beam pillars at grid intersections
    if (solidBelow && solidAbove && (x % 8 == 0) && (z % 8 == 0) &&
        (rngStruct % 100 < cfg.supportBeamPct)) {
        PropInstance bi{};
        bi.origin = {wx, wy, wz};
        bi.yaw    = static_cast<float>(rngStruct % 4) * kHalfPi;
        bi.color  = cfg.metalCol;
        bi.matId  = 4;
        bi.animPhase = static_cast<std::uint8_t>(rngStruct & 0xFFu);
        pass.add_instance(PropShape::SupportBeam, bi);
        ++totalPlaced_;
    }

    // Cylinder pillars at coarser grid
    std::uint32_t rngPillar = spatial_hash(x, y, z, seed ^ (kSaltStruct ^ kSaltSubA));
    if (solidBelow && solidAbove && (x % 6 == 0) && (z % 6 == 0) &&
        (rngPillar % 100 < cfg.pillarPct)) {
        PropInstance pi{};
        pi.origin = {wx, wy, wz};
        pi.yaw    = 0.0f;
        pi.color  = {0.35f, 0.35f, 0.38f};
        pi.matId  = 1;
        pi.animPhase = static_cast<std::uint8_t>(rngPillar & 0xFFu);
        pass.add_instance(PropShape::Cylinder, pi);
        ++totalPlaced_;
    }

    // Archways in tight corridors (wall on both X or both Z sides)
    bool solidW = is_solid(grid.cell(x-1, y, z));
    bool solidE = is_solid(grid.cell(x+1, y, z));
    bool solidN = is_solid(grid.cell(x, y, z+1));
    bool solidS = is_solid(grid.cell(x, y, z-1));

    std::uint32_t rngArch = spatial_hash(x, y, z, seed ^ (kSaltStruct ^ kSaltSubB));
    bool xCorridor = (solidW && solidE && !solidN && !solidS);
    bool zCorridor = (!solidW && !solidE && solidN && solidS);
    if (solidBelow && solidAbove && (xCorridor || zCorridor) && (rngArch % 100 < 15)) {
        PropInstance ai{};
        ai.origin = {wx, wy, wz};
        ai.yaw    = xCorridor ? kHalfPi : 0.0f;
        ai.color  = {0.40f, 0.38f, 0.35f};
        ai.matId  = 1;
        ai.animPhase = static_cast<std::uint8_t>(rngArch & 0xFFu);
        pass.add_instance(PropShape::Arch, ai);
        ++totalPlaced_;
    }
}

// ────────────────────────── main populate ────────────────────────────────────

void EnvDetail::populate(const MacroGrid& grid, PropPass& propPass,
                          std::uint32_t seed) const noexcept {
    totalPlaced_ = 0;

    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                Biome b = biomeMap_.at(x, y, z);
                const BiomePropConfig& cfg =
                    kBiomeConfigs[static_cast<int>(b)];

                place_ceiling_props (grid, propPass, x, y, z, cfg, seed);
                place_floor_props   (grid, propPass, x, y, z, cfg, seed);
                place_wall_props    (grid, propPass, x, y, z, cfg, seed);
                place_structural    (grid, propPass, x, y, z, cfg, seed);
            }
        }
    }

    std::fprintf(stderr, "[env_detail] populate done: %u props total\n",
                 totalPlaced_);
}

} // namespace giga::gpu
