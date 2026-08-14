#pragma once

#include <cstdint>
#include <vulkan/vulkan.h>
#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_common.h"
#include "render/vk_device.h"

#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable: 4324) // structure was padded due to alignment specifier
#endif

namespace giga::gpu {

static constexpr uint32_t kGridDimX = 32;
static constexpr uint32_t kGridDimY = 16;
static constexpr uint32_t kGridDimZ = 32;
static constexpr uint32_t kTotalGridCells = kGridDimX * kGridDimY * kGridDimZ; // 16384
static constexpr uint32_t kMaxPointLights = 256;

// Matches PointLight in shaders/light_grid.comp and shaders/volumetric_fog.glsl (std430)
struct alignas(16) GpuPointLight {
    vec4 posRadius;      // xyz = world pos (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity scale
};
static_assert(sizeof(GpuPointLight) == 32, "GpuPointLight std430 layout must be 32 bytes");

// Matches LightGridCell in shaders/light_grid.comp and shaders/volumetric_fog.glsl (std430)
struct alignas(16) GpuGridCell {
    uint32_t count = 0;
    uint32_t lightIndices[15]{};
};
static_assert(sizeof(GpuGridCell) == 64, "GpuGridCell std430 layout must be 64 bytes");

// Matches GridPush in shaders/light_grid.comp
struct alignas(16) GridPush {
    vec4 camPos;  // xyz = camera world position, w = max range (48.0m)
    vec4 gridMin; // xyz = 3D grid min corner in world space, w = cell size x/z (2.0m)
    vec4 gridExt; // x = gridDimX (32), y = gridDimY (16), z = gridDimZ (32), w = cell size y (2.0m)
    vec4 params;  // x = uTime, y = maxLightsPerCell (15), z = activeLightCount, w = reserved
};
static_assert(sizeof(GridPush) == 64, "GridPush layout must be 64 bytes");
#if defined(_MSC_VER)
// MSVC C4324 structure was padded due to alignment specifier is expected:
// GpuLightGrid is alignas(16) so the GpuPointLight stagingLights_ array
// (std430, alignas(16) elements) stays 16-byte aligned for the compute
// shader. The trailing pad_ already makes sizeof a multiple of 16; the
// alignment padding C4324 flags is intentional - layout must not change.
#pragma warning(push)
#pragma warning(disable : 4324)
#endif

class GpuLightGrid {
public:
    GpuLightGrid() = default;
    ~GpuLightGrid() { destroy(); }

    GpuLightGrid(const GpuLightGrid&) = delete;
    GpuLightGrid& operator=(const GpuLightGrid&) = delete;

    // Create Vulkan buffers, descriptor sets, and compute pipeline.
    bool init(VulkanDevice* dev, const char* shaderDir);
    void destroy() noexcept;

    // Zero-allocation point light collection
    void add_light(const vec3& pos, float radius, const vec3& color, float intensity) noexcept;
    void clear_lights() noexcept;
    void sort_lights_by_distance(const vec3& camPos) noexcept;

    // Record compute dispatch (3D spatial grid binning) & pipeline memory barrier.
    // Must execute outside active render pass on current_cmd().
    void update_and_dispatch(VkCommandBuffer cmd, uint32_t frameIndex, float timeSec, const vec3& camPos) noexcept;
    void update_and_dispatch(VkCommandBuffer cmd, float timeSec, const vec3& camPos) noexcept {
        update_and_dispatch(cmd, 0, timeSec, camPos);
    }

    VkDescriptorSetLayout descriptor_set_layout() const noexcept { return descriptorSetLayout_; }
    VkDescriptorSet descriptor_set(uint32_t frameIndex = 0) const noexcept {
        return descriptorSet_[frameIndex % kMaxFramesInFlight];
    }
    bool ready() const noexcept { return computePipeline_ != VK_NULL_HANDLE; }

    uint32_t active_light_count() const noexcept { return stagingLightCount_; }

private:
    bool create_buffers() noexcept;
    bool create_descriptor_sets() noexcept;
    bool create_compute_pipeline(const char* shaderDir) noexcept;

    VulkanDevice* dev_ = nullptr;

    VulkanBuffer lightBuf_[kMaxFramesInFlight]{}; // HOST_VISIBLE persistent mapped storage for point lights
    VulkanBuffer gridSSBO_[kMaxFramesInFlight]{}; // DEVICE_LOCAL storage for 3D grid cells

    void* lightMapped_[kMaxFramesInFlight]{};

    VkDescriptorSetLayout descriptorSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet_[kMaxFramesInFlight]{};

    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline computePipeline_ = VK_NULL_HANDLE;

    GpuPointLight stagingLights_[kMaxPointLights]{};
    uint32_t stagingLightCount_ = 0;
};
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

} // namespace giga::gpu
