// env_detail.h — Environment Detail Biome Placement System
//
// Classifies every cell in the macro grid into one of several environmental
// biomes (Industrial, Residential, Organic, Anomalous, Derelict) based on
// material density, floor depth, and spatial hash salts. The biome drives:
//   - Prop density (sparse, normal, dense) per shape category
//   - Color palette selection per biome
//   - Emissive intensity modulation (Derelict dims lights; Anomalous maxes them)
//   - Special feature injection (acid drip chains, crystal veins, pipe clusters)
//
// Usage:
//   EnvDetail detail;
//   detail.classify(grid, seed);
//   detail.populate(grid, propPass, seed);  // replaces / augments PropPlacer
//
// Zero dynamic allocation in hot paths — all internal state uses fixed-size
// arrays. No exceptions. No RTTI.
#pragma once

#include <array>
#include <cstdint>

#include "core/math.h"
#include "render/prop_mesh.h"
#include "render/prop_pass.h"
#include "world/macro_grid.h"

namespace giga::gpu {

// ─────────────────────────── biome IDs ────────────────────────────────────────

enum class Biome : std::uint8_t {
    Industrial  = 0,  // metal corridors, pipes, machinery
    Residential = 1,  // lockers, benches, terminals, social spaces
    Organic     = 2,  // fungal growths, crystal clusters, bioluminescence
    Anomalous   = 3,  // acid pools, radiation zones, glowing cracks
    Derelict    = 4,  // collapsed ceilings, heavy rust, minimal light
    kCount      = 5,
};

static constexpr int kBiomeCount = static_cast<int>(Biome::kCount);

// ─────────────────────────── per-biome config ─────────────────────────────────

struct BiomePropConfig {
    // Ceiling rules
    std::uint32_t pipeCeilingPct    = 35;
    std::uint32_t lampCeilingPct    = 20;
    std::uint32_t beamCeilingPct    = 10;

    // Floor rules
    std::uint32_t grateFloorPct     = 15;
    std::uint32_t crateCornerPct    = 18;
    std::uint32_t benchWallPct      = 10;
    std::uint32_t crystalFloorPpm   = 8;   // per-mille
    std::uint32_t acidFloorPpm      = 3;

    // Wall rules
    std::uint32_t cabinetWallPct    = 12;
    std::uint32_t lockerWallPct     = 8;
    std::uint32_t cameraWallPct     = 6;
    std::uint32_t terminalWallPct   = 5;
    std::uint32_t fungalWallPpm     = 4;

    // Structural
    std::uint32_t supportBeamPct    = 40;
    std::uint32_t pillarPct         = 20;

    // Color palettes (display-referred RGB)
    vec3 pipeCol        = {0.25f, 0.28f, 0.30f};
    vec3 rustCol        = {0.52f, 0.28f, 0.14f};
    vec3 grateCol       = {0.30f, 0.30f, 0.32f};
    vec3 warmLampCol    = {1.00f, 0.90f, 0.72f};
    vec3 coolLampCol    = {0.75f, 0.88f, 1.00f};
    vec3 crystalCol     = {0.70f, 0.15f, 0.95f};
    vec3 acidCol        = {0.15f, 0.85f, 0.25f};
    vec3 fungalCol      = {0.40f, 0.75f, 0.30f};
    vec3 metalCol       = {0.38f, 0.40f, 0.44f};
    vec3 woodenCol      = {0.50f, 0.32f, 0.20f};
    vec3 terminalCol    = {0.22f, 0.24f, 0.28f};

    // Emissive scale (1.0 = normal, 0.3 = dim derelict, 1.5 = anomalous hot)
    float emissiveScale = 1.0f;
};

// ─────────────────────────── classification map ───────────────────────────────

// Flat 128^3 lookup baked by classify(). Each byte holds a Biome enum value.
// Size: 128*128*128 = 2,097,152 bytes = 2 MiB — fits comfortably on stack.
// Indexed by cell_biome_[z * kMacroDim * kMacroDim + y * kMacroDim + x].
struct BiomeMap {
    static constexpr int kSize = kMacroDim * kMacroDim * kMacroDim;
    std::array<std::uint8_t, kSize> data{};

    Biome at(int x, int y, int z) const noexcept {
        if (x < 0 || y < 0 || z < 0 ||
            x >= kMacroDim || y >= kMacroDim || z >= kMacroDim)
            return Biome::Industrial;
        return static_cast<Biome>(
            data[static_cast<std::size_t>(z) * kMacroDim * kMacroDim +
                 static_cast<std::size_t>(y) * kMacroDim +
                 static_cast<std::size_t>(x)]);
    }

    void set(int x, int y, int z, Biome b) noexcept {
        if (x < 0 || y < 0 || z < 0 ||
            x >= kMacroDim || y >= kMacroDim || z >= kMacroDim)
            return;
        data[static_cast<std::size_t>(z) * kMacroDim * kMacroDim +
             static_cast<std::size_t>(y) * kMacroDim +
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

    // Phase 1: classify every cell into a biome.
    // Call once after world generation. O(N) scan with no allocations.
    void classify(const MacroGrid& grid, std::uint32_t seed) noexcept;

    // Phase 2: scatter props according to the biome map.
    // Adds instances to propPass; does NOT call clear_instances().
    void populate(const MacroGrid& grid, PropPass& propPass,
                  std::uint32_t seed) const noexcept;

    // Return the biome at a world cell.
    Biome biome_at(int x, int y, int z) const noexcept {
        return biomeMap_.at(x, y, z);
    }

    // Total props placed since last populate() call.
    std::uint32_t total_placed() const noexcept { return totalPlaced_; }

private:
    // ── classification helpers ────────────────────────────────────────────────
    static std::uint32_t spatial_hash(int x, int y, int z, std::uint32_t seed) noexcept;
    static bool is_solid(CellType c) noexcept { return c != kCellAir; }
    static Biome classify_cell(const MacroGrid& grid, int x, int y, int z,
                                std::uint32_t seed) noexcept;

    // ── placement helpers ─────────────────────────────────────────────────────
    void place_ceiling_props(const MacroGrid& grid, PropPass& pass,
                             int x, int y, int z,
                             const BiomePropConfig& cfg,
                             std::uint32_t seed) const noexcept;

    void place_floor_props(const MacroGrid& grid, PropPass& pass,
                           int x, int y, int z,
                           const BiomePropConfig& cfg,
                           std::uint32_t seed) const noexcept;

    void place_wall_props(const MacroGrid& grid, PropPass& pass,
                          int x, int y, int z,
                          const BiomePropConfig& cfg,
                          std::uint32_t seed) const noexcept;

    void place_structural(const MacroGrid& grid, PropPass& pass,
                          int x, int y, int z,
                          const BiomePropConfig& cfg,
                          std::uint32_t seed) const noexcept;

    // ── internal state ────────────────────────────────────────────────────────
    BiomeMap biomeMap_{};
    mutable std::uint32_t totalPlaced_ = 0;

    // One config per biome, baked at class-init time
    static const std::array<BiomePropConfig, kBiomeCount> kBiomeConfigs;
};

} // namespace giga::gpu
