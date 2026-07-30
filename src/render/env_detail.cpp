// env_detail.cpp — Biome classification & procedural prop placement.
//
// classify() makes two passes over the 128^3 grid:
//   Pass 1: Per-cell material census determines initial biome vote.
//   Pass 2: 3x3x3 neighbourhood smoothing suppresses single-cell noise.
//
// populate() iterates over air cells, queries BiomeMap, and places props
// through PropPass::add_instance() using the per-biome BiomePropConfig.
// All randomness is deterministic from `seed ^ cell_index`.

#include "render/env_detail.h"
#include "render/prop_pass.h"   // PropPass, PropShape, PropInstance

#include <cmath>
#include <cstdio>

namespace giga::gpu {

// ── static config tables ──────────────────────────────────────────────────────

const BiomePropConfig EnvDetail::kConfigs[kBiomeCount] = {
    // Industrial
    {
        .pipeCeilingPct   = 45, .lampCeilingPct   = 22, .beamCeilingPct  = 18,
        .grateFloorPct    = 25, .crateCornerPct   = 20, .benchWallPct    = 12,
        .crystalFloorPpm  = 0,  .acidFloorPpm     = 0,
        .cabinetWallPct   = 18, .lockerWallPct    = 12, .cameraWallPct   = 10,
        .terminalWallPct  = 6,  .fungalWallPpm    = 0,
        .supportBeamPct   = 55, .pillarPct        = 25,
        .pipeCol    = {0.28f, 0.30f, 0.32f},
        .rustCol    = {0.52f, 0.28f, 0.14f},
        .grateCol   = {0.30f, 0.32f, 0.34f},
        .warmLampCol= {0.90f, 0.82f, 0.68f},
        .coolLampCol= {0.75f, 0.88f, 1.00f},
        .crystalCol = {0.70f, 0.15f, 0.95f},
        .acidCol    = {0.15f, 0.85f, 0.25f},
        .fungalCol  = {0.40f, 0.75f, 0.30f},
        .metalCol   = {0.38f, 0.40f, 0.44f},
        .woodenCol  = {0.50f, 0.32f, 0.20f},
        .terminalCol= {0.22f, 0.24f, 0.28f},
        .emissiveScale = 1.0f,
    },
    // Residential
    {
        .pipeCeilingPct   = 20, .lampCeilingPct   = 35, .beamCeilingPct  = 5,
        .grateFloorPct    = 5,  .crateCornerPct   = 10, .benchWallPct    = 22,
        .crystalFloorPpm  = 0,  .acidFloorPpm     = 0,
        .cabinetWallPct   = 8,  .lockerWallPct    = 20, .cameraWallPct   = 4,
        .terminalWallPct  = 2,  .fungalWallPpm    = 0,
        .supportBeamPct   = 15, .pillarPct        = 10,
        .pipeCol    = {0.72f, 0.70f, 0.65f},
        .rustCol    = {0.60f, 0.42f, 0.30f},
        .grateCol   = {0.55f, 0.52f, 0.48f},
        .warmLampCol= {1.00f, 0.95f, 0.80f},
        .coolLampCol= {0.90f, 0.90f, 0.95f},
        .crystalCol = {0.70f, 0.15f, 0.95f},
        .acidCol    = {0.15f, 0.85f, 0.25f},
        .fungalCol  = {0.50f, 0.80f, 0.40f},
        .metalCol   = {0.62f, 0.58f, 0.54f},
        .woodenCol  = {0.62f, 0.45f, 0.28f},
        .terminalCol= {0.30f, 0.28f, 0.32f},
        .emissiveScale = 0.75f,
    },
    // Organic
    {
        .pipeCeilingPct   = 10, .lampCeilingPct   = 5,  .beamCeilingPct  = 8,
        .grateFloorPct    = 2,  .crateCornerPct   = 3,  .benchWallPct    = 2,
        .crystalFloorPpm  = 30, .acidFloorPpm     = 15,
        .cabinetWallPct   = 2,  .lockerWallPct    = 2,  .cameraWallPct   = 1,
        .terminalWallPct  = 1,  .fungalWallPpm    = 60,
        .supportBeamPct   = 20, .pillarPct        = 15,
        .pipeCol    = {0.30f, 0.45f, 0.28f},
        .rustCol    = {0.40f, 0.55f, 0.30f},
        .grateCol   = {0.28f, 0.38f, 0.22f},
        .warmLampCol= {0.60f, 0.90f, 0.50f},
        .coolLampCol= {0.40f, 0.85f, 0.70f},
        .crystalCol = {0.25f, 0.95f, 0.45f},
        .acidCol    = {0.10f, 0.95f, 0.20f},
        .fungalCol  = {0.40f, 0.75f, 0.30f},
        .metalCol   = {0.32f, 0.42f, 0.28f},
        .woodenCol  = {0.40f, 0.60f, 0.30f},
        .terminalCol= {0.20f, 0.30f, 0.20f},
        .emissiveScale = 1.4f,
    },
    // Anomalous
    {
        .pipeCeilingPct   = 30, .lampCeilingPct   = 8,  .beamCeilingPct  = 12,
        .grateFloorPct    = 20, .crateCornerPct   = 8,  .benchWallPct    = 4,
        .crystalFloorPpm  = 80, .acidFloorPpm     = 25,
        .cabinetWallPct   = 12, .lockerWallPct    = 5,  .cameraWallPct   = 15,
        .terminalWallPct  = 18, .fungalWallPpm    = 20,
        .supportBeamPct   = 30, .pillarPct        = 18,
        .pipeCol    = {0.55f, 0.20f, 0.65f},
        .rustCol    = {0.70f, 0.25f, 0.40f},
        .grateCol   = {0.40f, 0.15f, 0.55f},
        .warmLampCol= {0.95f, 0.40f, 0.80f},
        .coolLampCol= {0.60f, 0.20f, 1.00f},
        .crystalCol = {0.90f, 0.10f, 1.00f},
        .acidCol    = {0.60f, 0.95f, 0.10f},
        .fungalCol  = {0.70f, 0.30f, 0.90f},
        .metalCol   = {0.45f, 0.20f, 0.55f},
        .woodenCol  = {0.30f, 0.15f, 0.40f},
        .terminalCol= {0.25f, 0.10f, 0.35f},
        .emissiveScale = 2.0f,
    },
    // Derelict
    {
        .pipeCeilingPct   = 25, .lampCeilingPct   = 8,  .beamCeilingPct  = 6,
        .grateFloorPct    = 10, .crateCornerPct   = 6,  .benchWallPct    = 3,
        .crystalFloorPpm  = 5,  .acidFloorPpm     = 8,
        .cabinetWallPct   = 4,  .lockerWallPct    = 4,  .cameraWallPct   = 2,
        .terminalWallPct  = 1,  .fungalWallPpm    = 15,
        .supportBeamPct   = 25, .pillarPct        = 8,
        .pipeCol    = {0.35f, 0.30f, 0.28f},
        .rustCol    = {0.58f, 0.32f, 0.18f},
        .grateCol   = {0.28f, 0.25f, 0.22f},
        .warmLampCol= {0.70f, 0.55f, 0.38f},
        .coolLampCol= {0.55f, 0.62f, 0.70f},
        .crystalCol = {0.50f, 0.12f, 0.70f},
        .acidCol    = {0.10f, 0.60f, 0.18f},
        .fungalCol  = {0.35f, 0.55f, 0.22f},
        .metalCol   = {0.28f, 0.26f, 0.24f},
        .woodenCol  = {0.38f, 0.25f, 0.15f},
        .terminalCol= {0.18f, 0.16f, 0.14f},
        .emissiveScale = 0.45f,
    },
};

// ── RNG ───────────────────────────────────────────────────────────────────────

/*static*/ std::uint32_t EnvDetail::spatial_hash(int x, int y, int z,
                                                   std::uint32_t seed) noexcept {
    std::uint32_t h = seed ^ (static_cast<std::uint32_t>(x) * 2654435761u)
                            ^ (static_cast<std::uint32_t>(y) * 2246822519u)
                            ^ (static_cast<std::uint32_t>(z) * 3266489917u);
    h ^= h >> 16;
    h *= 0x45d9f3bu;
    h ^= h >> 16;
    return h;
}

static inline float rng01(std::uint32_t& s) noexcept {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return static_cast<float>(s & 0x00FFFFFFu) * (1.0f / 16777216.0f);
}

static inline bool pct_roll(std::uint32_t& s, std::uint32_t pct) noexcept {
    return (s % 100u) < pct;
}

static inline bool ppm_roll(std::uint32_t& s, std::uint32_t ppm) noexcept {
    return (s % 1000u) < ppm;
}

// ── classify: pass 1 ──────────────────────────────────────────────────────────

/*static*/ Biome EnvDetail::classify_cell(const giga::MacroGrid& grid,
                                            int x, int y, int z,
                                            std::uint32_t seed) noexcept {
    // Score each candidate biome from material census in 3x3x3 neighbourhood
    int score[kBiomeCount] = {};

    // Electric/acid hazards → Anomalous
    for (int dz = -1; dz <= 1; ++dz)
    for (int dy = -1; dy <= 1; ++dy)
    for (int dx = -1; dx <= 1; ++dx) {
        giga::CellType t = grid.cell(x+dx, y+dy, z+dz);
        if (t == giga::kMatElectricGrate || t == giga::kMatAcidPool)
            score[static_cast<int>(Biome::Anomalous)] += 3;
        else if (t == giga::kMatFactoryWall || t == giga::kMatTread)
            score[static_cast<int>(Biome::Industrial)] += 1;
        else if (t == giga::kMatPlaster || t == giga::kMatParquet)
            score[static_cast<int>(Biome::Residential)] += 1;
        else if (t == giga::kMatRust || t == giga::kMatRubble)
            score[static_cast<int>(Biome::Derelict)] += 1;
    }

    // Organic: high y (upper floors) + no metal materials
    if (y > giga::kMacroDim * 3 / 4)
        score[static_cast<int>(Biome::Organic)] += 2;

    // Spatial hash salt: add noise to avoid large uniform regions
    std::uint32_t h = spatial_hash(x >> 3, y >> 3, z >> 3, seed);
    score[h % kBiomeCount] += 1;

    // Pick highest score
    int best = 0;
    for (int i = 1; i < kBiomeCount; ++i)
        if (score[i] > score[best]) best = i;

    return static_cast<Biome>(best);
}

void EnvDetail::classify(const giga::MacroGrid& grid, std::uint32_t seed) noexcept {
    const int N = giga::kMacroDim;
    // Pass 1: per-cell classification
    for (int z = 0; z < N; ++z)
    for (int y = 0; y < N; ++y)
    for (int x = 0; x < N; ++x) {
        if (grid.cell(x, y, z) != giga::kCellAir) continue; // only classify air
        biomeMap_.set(x, y, z, classify_cell(grid, x, y, z, seed));
    }

    // Pass 2: 3x3x3 majority smoothing
    BiomeMap tmp = biomeMap_;
    for (int z = 1; z < N-1; ++z)
    for (int y = 1; y < N-1; ++y)
    for (int x = 1; x < N-1; ++x) {
        if (grid.cell(x, y, z) != giga::kCellAir) continue;
        int votes[kBiomeCount] = {};
        for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -1; dy <= 1; ++dy)
        for (int dx = -1; dx <= 1; ++dx)
            votes[static_cast<int>(tmp.at(x+dx, y+dy, z+dz))]++;
        int best = 0;
        for (int i = 1; i < kBiomeCount; ++i)
            if (votes[i] > votes[best]) best = i;
        biomeMap_.set(x, y, z, static_cast<Biome>(best));
    }

    std::fprintf(stderr, "[envdetail] classify done\n");
}

// ── helpers: check solid neighbours ──────────────────────────────────────────

static bool has_solid_above(const giga::MacroGrid& g, int x, int y, int z) {
    return g.cell(x, y+1, z) != giga::kCellAir;
}
static bool has_solid_below(const giga::MacroGrid& g, int x, int y, int z) {
    return g.cell(x, y-1, z) != giga::kCellAir;
}
static bool has_solid_side(const giga::MacroGrid& g, int x, int y, int z) {
    return g.cell(x+1,y,z) != giga::kCellAir || g.cell(x-1,y,z) != giga::kCellAir
        || g.cell(x,y,z+1) != giga::kCellAir || g.cell(x,y,z-1) != giga::kCellAir;
}

// ── place helpers ──────────────────────────────────────────────────────────────

static vec3 cell_world(int x, int y, int z) {
    const float cs = giga::kCellSize;
    return {x * cs, y * cs, z * cs};
}

static PropInstance make_inst(vec3 org, float yaw, vec3 col,
                               std::uint8_t mat, std::uint8_t emissive,
                               std::uint8_t flags = 0, std::uint8_t phase = 0) {
    PropInstance pi;
    pi.origin    = org;
    pi.yaw       = yaw;
    pi.color     = col;
    pi.matId     = mat;
    pi.emissive  = emissive;
    pi.flags     = flags;
    pi.animPhase = phase;
    return pi;
}

// ── populate: ceiling props ────────────────────────────────────────────────────

void EnvDetail::place_ceiling(const giga::MacroGrid& grid, PropPass& pass,
                               int x, int y, int z,
                               const BiomePropConfig& cfg,
                               std::uint32_t seed) const noexcept {
    if (!has_solid_above(grid, x, y, z)) return;

    std::uint32_t s = seed;
    const float cs  = giga::kCellSize;
    vec3 wp = cell_world(x, y, z);

    // Pipe ceiling
    if (pct_roll(s, cfg.pipeCeilingPct)) {
        float yaw = rng01(s) * 3.14159f;
        std::uint8_t em = static_cast<std::uint8_t>(
            30.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::Pipe,
            make_inst({wp.x, wp.y + cs * 0.85f, wp.z},
                      yaw, cfg.pipeCol, 12, em, 0,
                      static_cast<std::uint8_t>(s & 0xFF)));
        ++totalPlaced_;
    }
    // Lamp
    if (pct_roll(s, cfg.lampCeilingPct)) {
        bool warm    = rng01(s) > 0.5f;
        vec3 col     = warm ? cfg.warmLampCol : cfg.coolLampCol;
        std::uint8_t em = static_cast<std::uint8_t>(
            180.0f * cfg.emissiveScale);
        std::uint8_t ph = static_cast<std::uint8_t>(
            rng01(s) * 255.0f);
        pass.add_instance(PropShape::FloodLamp,
            make_inst({wp.x, wp.y + cs * 0.88f, wp.z},
                      rng01(s) * 6.28f, col, 7, em, 0, ph));
        ++totalPlaced_;
    }
    // Beam
    if (pct_roll(s, cfg.beamCeilingPct)) {
        float yaw = (rng01(s) > 0.5f) ? 0.0f : 1.5708f;
        pass.add_instance(PropShape::SupportBeam,
            make_inst({wp.x, wp.y + cs * 0.80f, wp.z},
                      yaw, cfg.metalCol, 12, 0, 0, 0));
        ++totalPlaced_;
    }
    // Railing / round grate vent
    if (pct_roll(s, 8)) {
        pass.add_instance(PropShape::RoundGrate,
            make_inst({wp.x, wp.y + cs * 0.88f, wp.z},
                      rng01(s) * 6.28f, cfg.grateCol, 9, 5, 0, 0));
        ++totalPlaced_;
    }
}

// ── populate: floor props ──────────────────────────────────────────────────────

void EnvDetail::place_floor(const giga::MacroGrid& grid, PropPass& pass,
                              int x, int y, int z,
                              const BiomePropConfig& cfg,
                              std::uint32_t seed) const noexcept {
    if (!has_solid_below(grid, x, y, z)) return;

    std::uint32_t s = seed ^ 0xABCDu;
    vec3 wp = cell_world(x, y, z);

    // Grate floor
    if (pct_roll(s, cfg.grateFloorPct)) {
        pass.add_instance(PropShape::Grate,
            make_inst(wp, rng01(s) * 1.5708f, cfg.grateCol, 9,
                      static_cast<std::uint8_t>(10.0f * cfg.emissiveScale)));
        ++totalPlaced_;
    }
    // Crate corner
    if (pct_roll(s, cfg.crateCornerPct)) {
        bool longCrate = rng01(s) > 0.65f;
        PropShape shape = longCrate ? PropShape::CrateLong : PropShape::CrateBox;
        float yaw = static_cast<float>(static_cast<int>(rng01(s) * 4.0f)) * 1.5708f;
        pass.add_instance(shape,
            make_inst(wp, yaw, cfg.metalCol, 14, 0, 0, 0));
        ++totalPlaced_;
    }
    // Crystal floor (Organic/Anomalous)
    if (ppm_roll(s, cfg.crystalFloorPpm)) {
        std::uint8_t em = static_cast<std::uint8_t>(220.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::CrystalCluster,
            make_inst(wp, rng01(s) * 6.28f, cfg.crystalCol, 0, em, 0,
                      static_cast<std::uint8_t>(s & 0xFF)));
        ++totalPlaced_;
    }
    // Acid pool
    if (ppm_roll(s, cfg.acidFloorPpm)) {
        std::uint8_t em = static_cast<std::uint8_t>(180.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::AcidPool,
            make_inst(wp, 0.0f, cfg.acidCol, 0, em, 0,
                      static_cast<std::uint8_t>(s & 0xFF)));
        ++totalPlaced_;
    }
    // Barrel
    if (pct_roll(s, 12)) {
        pass.add_instance(PropShape::Barrel,
            make_inst(wp, rng01(s) * 6.28f, cfg.rustCol, 14, 0, 0, 0));
        ++totalPlaced_;
    }
    // Bench
    if (pct_roll(s, cfg.benchWallPct)) {
        pass.add_instance(PropShape::BenchSlab,
            make_inst(wp, rng01(s) * 6.28f, cfg.woodenCol, 9, 0, 0, 0));
        ++totalPlaced_;
    }
    // Stair step at floor level
    if (pct_roll(s, 5)) {
        pass.add_instance(PropShape::StairStep,
            make_inst(wp, static_cast<float>(s & 3u) * 1.5708f,
                      cfg.metalCol, 12, 0, 0, 0));
        ++totalPlaced_;
    }
}

// ── populate: wall props ───────────────────────────────────────────────────────

void EnvDetail::place_walls(const giga::MacroGrid& grid, PropPass& pass,
                              int x, int y, int z,
                              const BiomePropConfig& cfg,
                              std::uint32_t seed) const noexcept {
    if (!has_solid_side(grid, x, y, z)) return;

    std::uint32_t s = seed ^ 0xDEADu;
    vec3 wp = cell_world(x, y, z);
    const float cs = giga::kCellSize;

    // Electrical cabinet
    if (pct_roll(s, cfg.cabinetWallPct)) {
        float yaw = static_cast<float>(s & 3u) * 1.5708f;
        std::uint8_t em = static_cast<std::uint8_t>(8.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::CabinetBox,
            make_inst(wp, yaw, cfg.terminalCol, 12, em, 0, 0));
        ++totalPlaced_;
    }
    // Locker
    if (pct_roll(s, cfg.lockerWallPct)) {
        float yaw = static_cast<float>(s & 3u) * 1.5708f;
        pass.add_instance(PropShape::LockerUnit,
            make_inst(wp, yaw, cfg.metalCol, 9, 0, 0, 0));
        ++totalPlaced_;
    }
    // Security camera
    if (pct_roll(s, cfg.cameraWallPct)) {
        float yaw = rng01(s) * 6.28f;
        std::uint8_t em = static_cast<std::uint8_t>(18.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::SecurityCamera,
            make_inst({wp.x, wp.y + cs * 0.75f, wp.z},
                      yaw, cfg.metalCol, 12, em, 0,
                      static_cast<std::uint8_t>(s & 0xFF)));
        ++totalPlaced_;
    }
    // Terminal
    if (pct_roll(s, cfg.terminalWallPct)) {
        float yaw = static_cast<float>(s & 3u) * 1.5708f;
        std::uint8_t em = static_cast<std::uint8_t>(35.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::Terminal,
            make_inst(wp, yaw, cfg.terminalCol, 7, em, 0,
                      static_cast<std::uint8_t>(rng01(s) * 255.0f)));
        ++totalPlaced_;
    }
    // Fungal wall
    if (ppm_roll(s, cfg.fungalWallPpm)) {
        float yaw = rng01(s) * 6.28f;
        std::uint8_t em = static_cast<std::uint8_t>(60.0f * cfg.emissiveScale);
        pass.add_instance(PropShape::FungalColumn,
            make_inst(wp, yaw, cfg.fungalCol, 0, em, 0,
                      static_cast<std::uint8_t>(rng01(s) * 255.0f)));
        ++totalPlaced_;
    }
    // Control panel
    if (pct_roll(s, 6)) {
        pass.add_instance(PropShape::ControlPanel,
            make_inst(wp, static_cast<float>(s & 3u) * 1.5708f,
                      cfg.terminalCol, 12,
                      static_cast<std::uint8_t>(20.0f * cfg.emissiveScale)));
        ++totalPlaced_;
    }
    // Valve on wall pipe
    if (pct_roll(s, 10)) {
        std::uint8_t ph = static_cast<std::uint8_t>(rng01(s) * 255.0f);
        pass.add_instance(PropShape::Valve,
            make_inst(wp, rng01(s) * 6.28f, cfg.rustCol, 14, 5, 0, ph));
        ++totalPlaced_;
    }
    // Railing on elevated walkways
    if (pct_roll(s, 8)) {
        pass.add_instance(PropShape::Railing,
            make_inst(wp, static_cast<float>(s & 3u) * 1.5708f,
                      cfg.metalCol, 12, 0, 0, 0));
        ++totalPlaced_;
    }
}

// ── populate: structural props ────────────────────────────────────────────────

void EnvDetail::place_structural(const giga::MacroGrid& grid, PropPass& pass,
                                   int x, int y, int z,
                                   const BiomePropConfig& cfg,
                                   std::uint32_t seed) const noexcept {
    std::uint32_t s = seed ^ 0xFEEDu;

    // Support beams span full cell height — only where ceiling + floor solid
    if (has_solid_above(grid, x, y, z) && has_solid_below(grid, x, y, z)) {
        if (pct_roll(s, cfg.supportBeamPct)) {
            float yaw = (rng01(s) > 0.5f) ? 0.0f : 1.5708f;
            pass.add_instance(PropShape::SupportBeam,
                make_inst(cell_world(x, y, z), yaw, cfg.metalCol, 12, 0));
            ++totalPlaced_;
        }
    }

    // Pillars (vertical cylinders)
    if (pct_roll(s, cfg.pillarPct)) {
        bool arch = rng01(s) > 0.7f;
        PropShape shape = arch ? PropShape::Arch : PropShape::Cylinder;
        std::uint8_t em = static_cast<std::uint8_t>(5.0f * cfg.emissiveScale);
        pass.add_instance(shape,
            make_inst(cell_world(x, y, z), rng01(s) * 6.28f,
                      cfg.metalCol, 12, em, 0, 0));
        ++totalPlaced_;
    }

    // Pipe elbow / tee junctions at intersections
    if (pct_roll(s, 8)) {
        bool isTee = rng01(s) > 0.6f;
        PropShape shape = isTee ? PropShape::PipeTee : PropShape::PipeElbow;
        pass.add_instance(shape,
            make_inst(cell_world(x, y, z), rng01(s) * 6.28f,
                      cfg.pipeCol, 12,
                      static_cast<std::uint8_t>(8.0f * cfg.emissiveScale)));
        ++totalPlaced_;
    }
}

// ── populate: main loop ────────────────────────────────────────────────────────

void EnvDetail::populate(const giga::MacroGrid& grid, PropPass& pass,
                          std::uint32_t seed) const noexcept {
    totalPlaced_ = 0;
    const int N  = giga::kMacroDim;

    pass.clear_instances();

    for (int z = 0; z < N; ++z)
    for (int y = 0; y < N; ++y)
    for (int x = 0; x < N; ++x) {
        if (grid.cell(x, y, z) != giga::kCellAir) continue;

        Biome   b   = biomeMap_.at(x, y, z);
        const BiomePropConfig& cfg = kConfigs[static_cast<int>(b)];
        std::uint32_t s = spatial_hash(x, y, z, seed);

        place_ceiling   (grid, pass, x, y, z, cfg, s ^ 0x11111111u);
        place_floor     (grid, pass, x, y, z, cfg, s ^ 0x22222222u);
        place_walls     (grid, pass, x, y, z, cfg, s ^ 0x33333333u);
        place_structural(grid, pass, x, y, z, cfg, s ^ 0x44444444u);
    }

    // Generate catenary wire clutter hanging between adjacent wall terminals & control panels
    auto termPositions = pass.get_terminal_positions();
    for (std::size_t i = 0; i < termPositions.size(); ++i) {
        for (std::size_t j = i + 1; j < std::min(termPositions.size(), i + 6); ++j) {
            float dx = termPositions[i].x - termPositions[j].x;
            float dy = termPositions[i].y - termPositions[j].y;
            float dz = termPositions[i].z - termPositions[j].z;
            float distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > 4.0f && distSq < 144.0f) { // between 2m and 12m apart
                vec3 start = termPositions[i] + vec3{0.0f, 1.2f, 0.0f};
                vec3 end   = termPositions[j] + vec3{0.0f, 1.2f, 0.0f};
                vec3 p0 = start;
                constexpr int kWireSegments = 8;
                for (int k = 1; k <= kWireSegments; ++k) {
                    float t = static_cast<float>(k) / static_cast<float>(kWireSegments);
                    vec3 p1 = {
                        start.x + (end.x - start.x) * t,
                        start.y + (end.y - start.y) * t - 0.65f * 4.0f * t * (1.0f - t),
                        start.z + (end.z - start.z) * t
                    };
                    vec3 mid = (p0 + p1) * 0.5f;
                    vec3 delta = p1 - p0;
                    float yaw = std::atan2(delta.x, delta.z);
                    pass.add_instance(PropShape::Pipe, make_inst(mid, yaw, vec3{0.18f, 0.16f, 0.14f}, 14, 0, 0, 0));
                    p0 = p1;
                }
                totalPlaced_ += kWireSegments;
            }
        }
    }

    std::fprintf(stderr, "[envdetail] populate: %u props placed (including catenary wire clutter)\n", totalPlaced_);
}

} // namespace giga::gpu
