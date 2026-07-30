// test_m1.cpp — Empirical Challenger test harness for Milestone 1
// (GPU Compute Volumetric Light Grid & Fog)
#include <iostream>
#include <vector>
#include <cmath>
#include <cstring>
#include <cassert>
#include <atomic>
#include <cstdlib>

// Define standalone math & structs matching render/gpu_light_grid.h and core/wrap.h
namespace challenger {

static std::atomic<size_t> g_allocationCount{0};
static bool g_trackAllocations = false;

} // namespace challenger

void* operator new(size_t size) {
    if (challenger::g_trackAllocations) {
        challenger::g_allocationCount++;
    }
    void* p = std::malloc(size);
    if (!p) throw std::bad_alloc();
    return p;
}

void operator delete(void* p) noexcept {
    std::free(p);
}

void operator delete(void* p, size_t) noexcept {
    std::free(p);
}

namespace challenger {

struct vec3 {
    float x, y, z;
    vec3 operator+(const vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    vec3 operator-(const vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
};

struct vec4 {
    float x, y, z, w;
};

static constexpr float kWorldExtent = 1000.0f;
static constexpr uint32_t kGridDimX = 32;
static constexpr uint32_t kGridDimY = 16;
static constexpr uint32_t kGridDimZ = 32;
static constexpr uint32_t kTotalGridCells = kGridDimX * kGridDimY * kGridDimZ; // 16384
static constexpr uint32_t kMaxPointLights = 256;

struct alignas(16) GpuPointLight {
    vec4 posRadius;      // xyz = world pos (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity scale
};

struct alignas(16) GpuGridCell {
    uint32_t count = 0;
    uint32_t lightIndices[15]{};
};

struct LightGrid {
    GpuPointLight stagingLights[kMaxPointLights]{};
    uint32_t stagingLightCount = 0;

    void clear_lights() noexcept {
        stagingLightCount = 0;
    }

    void add_light(const vec3& pos, float radius, const vec3& color, float intensity) noexcept {
        if (stagingLightCount >= kMaxPointLights || radius <= 0.0f || intensity <= 0.001f) {
            return;
        }
        GpuPointLight& pt = stagingLights[stagingLightCount++];
        pt.posRadius = vec4{pos.x, pos.y, pos.z, radius};
        pt.colorIntensity = vec4{color.x, color.y, color.z, intensity};
    }
};

inline float wrap_delta_f(float a, float b, float period) {
    float d = b - a;
    return d - period * std::floor(d / period + 0.5f);
}

inline float nearest_image(float absPos, float ref, float period) {
    return ref + wrap_delta_f(ref, absPos, period);
}

float dist_sq_point_aabb(vec3 p, vec3 bMin, vec3 bMax) {
    float dx = std::max(0.0f, std::max(bMin.x - p.x, p.x - bMax.x));
    float dy = std::max(0.0f, std::max(bMin.y - p.y, p.y - bMax.y));
    float dz = std::max(0.0f, std::max(bMin.z - p.z, p.z - bMax.z));
    return dx * dx + dy * dy + dz * dz;
}

// CPU simulation of light_grid.comp GPU compute binning logic
void cpu_bin_lights(const LightGrid& grid, const vec3& camPos, GpuGridCell* outCells) {
    vec3 cellSize{2.0f, 2.0f, 2.0f};
    vec3 gridMinPos = camPos - vec3{kGridDimX * cellSize.x * 0.5f,
                                    kGridDimY * cellSize.y * 0.5f,
                                    kGridDimZ * cellSize.z * 0.5f};

    for (uint32_t z = 0; z < kGridDimZ; ++z) {
        for (uint32_t y = 0; y < kGridDimY; ++y) {
            for (uint32_t x = 0; x < kGridDimX; ++x) {
                uint32_t flatCellIdx = x + y * kGridDimX + z * (kGridDimX * kGridDimY);
                vec3 cellMin = gridMinPos + vec3{x * cellSize.x, y * cellSize.y, z * cellSize.z};
                vec3 cellMax = cellMin + cellSize;

                uint32_t foundCount = 0;
                uint32_t indices[15]{};

                for (uint32_t i = 0; i < grid.stagingLightCount; ++i) {
                    const auto& light = grid.stagingLights[i];
                    float radius = light.posRadius.w;
                    float intensity = light.colorIntensity.w;
                    if (radius <= 0.0f || intensity <= 0.001f) continue;

                    vec3 lightPos{light.posRadius.x, light.posRadius.y, light.posRadius.z};
                    float dSq = dist_sq_point_aabb(lightPos, cellMin, cellMax);

                    if (dSq <= radius * radius) {
                        if (foundCount < 15) {
                            indices[foundCount] = i;
                            foundCount++;
                        }
                    }
                }

                GpuGridCell cell{};
                cell.count = foundCount;
                for (uint32_t k = 0; k < 15; ++k) {
                    cell.lightIndices[k] = (k < foundCount) ? indices[k] : 0;
                }
                outCells[flatCellIdx] = cell;
            }
        }
    }
}

} // namespace challenger

int main() {
    using namespace challenger;
    std::cout << "=========================================================\n";
    std::cout << "Milestone 1 Empirical Challenger Stress Test\n";
    std::cout << "=========================================================\n\n";

    int testsPassed = 0;
    int testsFailed = 0;

    // -------------------------------------------------------------------
    // Test 1: Light Grid Capacity Boundaries (256 point lights)
    // -------------------------------------------------------------------
    std::cout << "[TEST 1] Point Light Buffer Capacity Boundary (Max 256)... ";
    LightGrid grid;
    grid.clear_lights();
    for (int i = 0; i < 300; ++i) {
        grid.add_light(vec3{float(i), 0.0f, 0.0f}, 10.0f, vec3{1.0f, 1.0f, 1.0f}, 1.0f);
    }
    if (grid.stagingLightCount == kMaxPointLights) {
        std::cout << "PASS (Correctly capped at " << kMaxPointLights << " lights, 300 attempted)\n";
        testsPassed++;
    } else {
        std::cout << "FAIL (Expected count " << kMaxPointLights << ", got " << grid.stagingLightCount << ")\n";
        testsFailed++;
    }

    // -------------------------------------------------------------------
    // Test 2: Invalid / Degenerate Light Filter
    // -------------------------------------------------------------------
    std::cout << "[TEST 2] Invalid Light Filtering (Radius <= 0 / Intensity <= 0.001)... ";
    grid.clear_lights();
    grid.add_light(vec3{0.0f, 0.0f, 0.0f}, 0.0f, vec3{1.0f, 1.0f, 1.0f}, 1.0f);  // invalid radius
    grid.add_light(vec3{0.0f, 0.0f, 0.0f}, -5.0f, vec3{1.0f, 1.0f, 1.0f}, 1.0f); // negative radius
    grid.add_light(vec3{0.0f, 0.0f, 0.0f}, 10.0f, vec3{1.0f, 1.0f, 1.0f}, 0.0005f); // tiny intensity
    grid.add_light(vec3{0.0f, 0.0f, 0.0f}, 10.0f, vec3{1.0f, 1.0f, 1.0f}, 1.0f); // valid
    if (grid.stagingLightCount == 1) {
        std::cout << "PASS (Filtered out 3 invalid lights, kept 1 valid)\n";
        testsPassed++;
    } else {
        std::cout << "FAIL (Expected 1 light, got " << grid.stagingLightCount << ")\n";
        testsFailed++;
    }

    // -------------------------------------------------------------------
    // Test 3: Grid Cell Packing Limits (Max 15 lights / cell)
    // -------------------------------------------------------------------
    std::cout << "[TEST 3] Cell Packing Limits (20 overlapping lights in 1 cell)... ";
    grid.clear_lights();
    vec3 camPos{0.0f, 0.0f, 0.0f};
    for (int i = 0; i < 20; ++i) {
        grid.add_light(vec3{0.0f, 0.0f, 0.0f}, 5.0f, vec3{1.0f, 1.0f, 1.0f}, 1.0f);
    }
    std::vector<GpuGridCell> cells(kTotalGridCells);
    cpu_bin_lights(grid, camPos, cells.data());

    // Cell at center of grid (x=16, y=8, z=16)
    uint32_t centerFlatIdx = 16 + 8 * kGridDimX + 16 * (kGridDimX * kGridDimY);
    if (cells[centerFlatIdx].count == 15) {
        std::cout << "PASS (Cell count capped strictly at 15 lights, overflow dropped)\n";
        testsPassed++;
    } else {
        std::cout << "FAIL (Cell count was " << cells[centerFlatIdx].count << ", expected 15)\n";
        testsFailed++;
    }

    // -------------------------------------------------------------------
    // Test 4: Toroidal Wrap & Distance Culling Bug
    // -------------------------------------------------------------------
    std::cout << "[TEST 4] Toroidal Wrapping & Light Position Binning... ";
    grid.clear_lights();
    vec3 playerCamPos{5.0f, 10.0f, 5.0f};
    vec3 mobAbsPos{kWorldExtent - 5.0f, 10.0f, 5.0f}; // Across wrap boundary (dx = -10.0m)

    // Calculate wrapped delta
    float dx = wrap_delta_f(playerCamPos.x, mobAbsPos.x, kWorldExtent);
    float dy = playerCamPos.y - mobAbsPos.y;
    float dz = wrap_delta_f(playerCamPos.z, mobAbsPos.z, kWorldExtent);
    float distSq = dx * dx + dy * dy + dz * dz;

    // Check culling logic (48.0m threshold)
    bool passesCull = (distSq <= 48.0f * 48.0f);

    // BUG TEST: Current main.cpp collect_scene_lights adds mobAbsPos unwrapped!
    // Let's add unwrapped vs wrapped positions to grid and check binning:
    grid.clear_lights();
    grid.add_light(mobAbsPos, 12.0f, vec3{1.0f, 0.88f, 0.65f}, 2.0f); // Current buggy behavior
    cpu_bin_lights(grid, playerCamPos, cells.data());

    bool unwrappedLightFound = false;
    for (size_t i = 0; i < kTotalGridCells; ++i) {
        if (cells[i].count > 0) { unwrappedLightFound = true; break; }
    }

    grid.clear_lights();
    vec3 mobWrappedPos{playerCamPos.x + dx, mobAbsPos.y, playerCamPos.z + dz};
    grid.add_light(mobWrappedPos, 12.0f, vec3{1.0f, 0.88f, 0.65f}, 2.0f); // Fixed wrapped behavior
    cpu_bin_lights(grid, playerCamPos, cells.data());

    bool wrappedLightFound = false;
    for (size_t i = 0; i < kTotalGridCells; ++i) {
        if (cells[i].count > 0) { wrappedLightFound = true; break; }
    }

    if (passesCull && !unwrappedLightFound && wrappedLightFound) {
        std::cout << "BUG CONFIRMED!\n";
        std::cout << "  - Mob across wrap boundary (absPos = " << mobAbsPos.x << ") passes 48m cull check (dx = " << dx << "m).\n";
        std::cout << "  - Unwrapped light position fails GPU grid cell binning (0 cells populated).\n";
        std::cout << "  - Wrapped light position (" << mobWrappedPos.x << ") successfully populates GPU grid cells.\n";
        testsFailed++; // Failure of implementation code
    } else {
        std::cout << "PASS (Toroidal light binning working properly)\n";
        testsPassed++;
    }

    // -------------------------------------------------------------------
    // Test 5: Heap Allocation / GC Verification (0B GC on Frame Tick)
    // -------------------------------------------------------------------
    std::cout << "[TEST 5] Heap Allocation Verification (0B GC during frame tick)... ";
    grid.clear_lights();
    
    // Warm up
    for (int i = 0; i < 50; ++i) {
        grid.add_light(vec3{float(i), 0.0f, 0.0f}, 10.0f, vec3{1.0f, 1.0f, 1.0f}, 1.0f);
    }
    grid.clear_lights();

    g_allocationCount = 0;
    g_trackAllocations = true;

    for (int frame = 0; frame < 1000; ++frame) {
        grid.clear_lights();
        grid.add_light(vec3{1.0f, 2.0f, 3.0f}, 10.0f, vec3{1.0f, 0.5f, 0.2f}, 1.5f);
        grid.add_light(vec3{-5.0f, 2.0f, 8.0f}, 12.0f, vec3{0.2f, 0.5f, 1.0f}, 2.0f);
    }

    g_trackAllocations = false;

    if (g_allocationCount == 0) {
        std::cout << "PASS (0 heap allocations across 1000 frame ticks)\n";
        testsPassed++;
    } else {
        std::cout << "FAIL (" << g_allocationCount << " heap allocations detected! GC 0B violated)\n";
        testsFailed++;
    }

    std::cout << "\n=========================================================\n";
    std::cout << "Summary: " << testsPassed << " PASSED, " << testsFailed << " FAILED\n";
    std::cout << "=========================================================\n";

    return testsFailed > 0 ? 1 : 0;
}
