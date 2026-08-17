#pragma once

#include <cstdint>
#include <utility>
#include <vector>
#include <vulkan/vulkan.h>
#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_device.h"

#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable: 4324) // structure was padded due to alignment specifier
#endif

namespace giga::gpu {

// Сетка света = ВЕСЬ тор, привязана к миру: 64³ клеток по 4 м = 256 м =
// kWorldExtent на каждой оси. Камерная коробка 64×32×64 м была классом багов —
// свет за её гранью исчезал при видимости 128 м. Числа обязаны совпадать с
// kLightGridDim/kLightGridCell в shaders/volumetric_fog.glsl.
static constexpr uint32_t kGridDimX = 64;
static constexpr uint32_t kGridDimY = 64;
static constexpr uint32_t kGridDimZ = 64;
static constexpr float kGridCellMeters = 4.0f;
static constexpr uint32_t kTotalGridCells = kGridDimX * kGridDimY * kGridDimZ; // 262144
// «Сотен в кадре» хватает с запасом: на GPU едут БЛИЖАЙШИЕ kMaxPointLights из
// отсортированного стейджинга. Стейджинг обязан вмещать ВСЕ источники этажа:
// перелив здесь режет по порядку вставки (= порядку создания, z снизу вверх),
// и это был живой баг — блейм несёт 9500 лампочек, в 2048 влезали только
// нижние, «ближайшие 512» выбирались из произвольного подмножества, и целые
// ярусы не светились никогда (замер GIGA_LIGHT_DBG 2026-08-17). 16384 = 9500
// худшего этажа с запасом; вектора на куче, 1.5 MB. Перелив теперь считается
// (overflow_dropped) и виден в GIGA_LIGHT_DBG — молча не режем.
static constexpr uint32_t kMaxPointLights = 512;
static constexpr uint32_t kStagingLights = 16384;

// Matches PointLight in shaders/light_grid.comp and shaders/volumetric_fog.glsl (std430)
struct alignas(16) GpuPointLight {
    vec4 posRadius;      // xyz = world pos (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity scale
    vec4 dirCone;        // xyz = spot direction, w = cos(outer half-angle);
                         // w <= -1.5 — сентинель «омни» (см. add_light)
};
static_assert(sizeof(GpuPointLight) == 48, "GpuPointLight std430 layout must be 48 bytes");

// Matches LightGridCell in shaders/light_grid.comp and shaders/volumetric_fog.glsl (std430).
// Клетка = ровно 32 слова = 128 байт (степень двойки): счётчик + 31 индекс.
// Перелив вытесняется по вкладу в клетку (top-K, light_grid.comp), но МОЛЧА.
struct alignas(16) GpuGridCell {
    uint32_t count = 0;
    uint32_t lightIndices[31]{};
};
static_assert(sizeof(GpuGridCell) == 128, "GpuGridCell std430 layout must be 128 bytes");

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

    // Zero-allocation light collection. 4-арг = омни; перегрузка с dir/cosOuter =
    // конус (фонарик, прожектор). Один структ, один цикл в шейдере — «универсальные
    // источники живут вместе» по построению.
    void add_light(const vec3& pos, float radius, const vec3& color, float intensity) noexcept;
    void add_light(const vec3& pos, float radius, const vec3& color, float intensity,
                   const vec3& dir, float cosOuter) noexcept;
    void clear_lights() noexcept;
    void sort_lights_by_distance(const vec3& camPos) noexcept;

    // Record compute dispatch (3D spatial grid binning) & pipeline memory barrier.
    // Must execute outside active render pass on current_cmd().
    void update_and_dispatch(VkCommandBuffer cmd, float timeSec, const vec3& camPos) noexcept;

    VkDescriptorSetLayout descriptor_set_layout() const noexcept { return descriptorSetLayout_; }
    VkDescriptorSet descriptor_set() const noexcept { return descriptorSet_; }
    bool ready() const noexcept { return computePipeline_ != VK_NULL_HANDLE; }

    uint32_t active_light_count() const noexcept { return stagingLightCount_; }
    uint32_t overflow_dropped() const noexcept { return overflowDropped_; }

private:
    bool create_buffers() noexcept;
    bool create_descriptor_sets() noexcept;
    bool create_compute_pipeline(const char* shaderDir) noexcept;

    VulkanDevice* dev_ = nullptr;

    VulkanBuffer lightBuf_{}; // HOST_VISIBLE persistent mapped storage for point lights
    VulkanBuffer gridSSBO_{}; // DEVICE_LOCAL storage for 3D grid cells

    void* lightMapped_ = nullptr;

    VkDescriptorSetLayout descriptorSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet_ = VK_NULL_HANDLE;

    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline computePipeline_ = VK_NULL_HANDLE;

    // Вектора, не массивы: 16384 x 48 B x 2 — этому не место ни в объекте на
    // стеке main(), ни тем более в кадре стека. Резервируются один раз в init().
    std::vector<GpuPointLight> stagingLights_;
    std::vector<GpuPointLight> sortScratch_;
    std::vector<std::pair<float, uint16_t>> sortKeys_; // distSq, index
    uint32_t stagingLightCount_ = 0;
    uint32_t overflowDropped_ = 0;
};
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

} // namespace giga::gpu
