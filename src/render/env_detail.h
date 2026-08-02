// env_detail.h — Environment Detail Biome Placement System
//
// 5 biomes: Industrial, Residential, Organic, Anomalous, Derelict.
// classify() runs a 2-pass spatial scan. populate() places props via PropPass.
// Zero dynamic allocation. No exceptions. No RTTI.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "world/macro_grid.h"   // giga::MacroGrid, giga::CellType, giga::kMacroDim
#include "world/materials.h"    // giga::kMatAcidPool, kMatWaterMark, kMatElectricGrate

// Forward-declare PropPass to avoid pulling in the full Vulkan render chain.
// env_detail.h is included from world-layer code that must not see Vulkan.
namespace giga::gpu {
class PropPass;
enum class PropShape : std::uint8_t;
struct PropInstance;
} // namespace giga::gpu

namespace giga::gpu {

// ─────────────────────────── biome IDs ────────────────────────────────────────

enum class Biome : std::uint8_t {
    Industrial  = 0,
    Residential = 1,
    Organic     = 2,
    Anomalous   = 3,
    Derelict    = 4,
    kCount      = 5,
};

static constexpr int kBiomeCount = static_cast<int>(Biome::kCount);

// ─────────────────────────── per-biome config ─────────────────────────────────

struct BiomePropConfig {
    // Ceiling
    std::uint32_t pipeCeilingPct    = 35;
    std::uint32_t lampCeilingPct    = 20;
    std::uint32_t beamCeilingPct    = 10;
    // Floor
    std::uint32_t grateFloorPct     = 15;
    std::uint32_t crateCornerPct    = 18;
    std::uint32_t benchWallPct      = 10;
    std::uint32_t crystalFloorPpm   = 8;
    std::uint32_t acidFloorPpm      = 3;
    // Walls
    std::uint32_t cabinetWallPct    = 12;
    std::uint32_t lockerWallPct     = 8;
    std::uint32_t cameraWallPct     = 6;
    std::uint32_t terminalWallPct   = 5;
    std::uint32_t fungalWallPpm     = 4;
    // Structural
    std::uint32_t supportBeamPct    = 40;
    std::uint32_t pillarPct         = 20;
    // Colors
    vec3 pipeCol      = {0.25f, 0.28f, 0.30f};
    vec3 rustCol      = {0.52f, 0.28f, 0.14f};
    vec3 grateCol     = {0.30f, 0.30f, 0.32f};
    vec3 warmLampCol  = {1.00f, 0.90f, 0.72f};
    vec3 coolLampCol  = {0.75f, 0.88f, 1.00f};
    vec3 crystalCol   = {0.70f, 0.15f, 0.95f};
    vec3 acidCol      = {0.15f, 0.85f, 0.25f};
    vec3 fungalCol    = {0.40f, 0.75f, 0.30f};
    vec3 metalCol     = {0.38f, 0.40f, 0.44f};
    vec3 woodenCol    = {0.50f, 0.32f, 0.20f};
    vec3 terminalCol  = {0.22f, 0.24f, 0.28f};
    float emissiveScale = 1.0f;
};

// ─────────────────────────── biome map ───────────────────────────────────────

// Flat 128^3 classification array (2 MiB). Used as a class member (heap), never stack.
struct BiomeMap {
    static constexpr int kN = giga::kMacroDim;
    static constexpr int kSize = kN * kN * kN;

    std::uint8_t data[kSize] = {};   // raw C array — no std::array dependency

    Biome at(int x, int y, int z) const noexcept {
        if (x < 0 || y < 0 || z < 0 || x >= kN || y >= kN || z >= kN)
            return Biome::Industrial;
        return static_cast<Biome>(
            data[static_cast<std::size_t>(z) * kN * kN +
                 static_cast<std::size_t>(y) * kN +
                 static_cast<std::size_t>(x)]);
    }

    void set(int x, int y, int z, Biome b) noexcept {
        if (x < 0 || y < 0 || z < 0 || x >= kN || y >= kN || z >= kN) return;
        data[static_cast<std::size_t>(z) * kN * kN +
             static_cast<std::size_t>(y) * kN +
             static_cast<std::size_t>(x)] = static_cast<std::uint8_t>(b);
    }
};

// ─────────────────────────── main system ─────────────────────────────────────

class EnvDetail {
public:
    EnvDetail() noexcept = default;
    ~EnvDetail() noexcept = default;
    EnvDetail(const EnvDetail&) = delete;
    EnvDetail& operator=(const EnvDetail&) = delete;

    void classify(const giga::MacroGrid& grid, std::uint32_t seed) noexcept;
    void populate (const giga::MacroGrid& grid, PropPass& pass,
                   std::uint32_t seed) const noexcept;

    Biome biome_at(int x, int y, int z) const noexcept { return biomeMap_.at(x, y, z); }
    std::uint32_t total_placed() const noexcept { return totalPlaced_; }

private:

    static Biome classify_cell(const giga::MacroGrid& grid, int x, int y, int z,
                               std::uint32_t seed) noexcept;

    void place_ceiling  (const giga::MacroGrid&, PropPass&, int,int,int, const BiomePropConfig&, std::uint32_t) const noexcept;
    void place_floor    (const giga::MacroGrid&, PropPass&, int,int,int, const BiomePropConfig&, std::uint32_t) const noexcept;
    void place_walls    (const giga::MacroGrid&, PropPass&, int,int,int, const BiomePropConfig&, std::uint32_t) const noexcept;
    void place_structural(const giga::MacroGrid&, PropPass&, int,int,int, const BiomePropConfig&, std::uint32_t) const noexcept;

    BiomeMap biomeMap_{};
    mutable std::uint32_t totalPlaced_ = 0;

    static const BiomePropConfig kConfigs[kBiomeCount];
};

} // namespace giga::gpu
