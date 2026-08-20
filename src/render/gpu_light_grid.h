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
// КОРНЕВОЙ кап системы света (S11: один корневой кап на систему, производные
// считаются от него; решение владельца — markoaudit/plans/light-perf.md §капы,
// CANON S9/S11: «свет 131072 стейджинг»). Таблица = [0..staticCount) статики
// со СТАБИЛЬНЫМИ слот-id на поколение бейка (позиция/радиус неподвижны — их
// видимость печёт light_vis_bake; в кадре обновляется только интенсивность:
// мерцание/обесточка/поломка) + динамический хвост (мобы-эмиттеры, снаряды,
// фонарик из рук — единицы-десятки, переписывается каждый кадр). Перелив
// считается (overflow_dropped) и виден в GIGA_LIGHT_DBG — молча не режем.
static constexpr uint32_t kRootLights = 131072;
// Слот «не в статик-таблице»: проп, сорванный в RagdollRoll, или лампа,
// рождённая после постройки таблицы, идут динамическим хвостом.
static constexpr uint32_t kNoLightSlot = 0xFFFFFFFFu;
// Аплоад-кап «ближайшие к камере» — ВРЕМЕННЫЙ до слияния bakedGrid в
// light_grid.comp (план light-visibility-bake §5: умирает вместе с сортом —
// камерный отбор нарушает S7; без бейка биннить 12k статиков каждый кадр
// нельзя, поэтому до потребителя кадр живёт по-старому).
static constexpr uint32_t kMaxPointLights = 512;

// Matches PointLight in shaders/light_grid.comp and shaders/volumetric_fog.glsl (std430)
struct alignas(16) GpuPointLight {
    vec4 posRadius;      // xyz = world pos (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity scale
    vec4 dirCone;        // xyz = spot direction, w = cos(outer half-angle);
                         // w <= -1.5 — сентинель «омни» (см. add_light)
};
static_assert(sizeof(GpuPointLight) == 48, "GpuPointLight std430 layout must be 48 bytes");

// Matches LightGridCell in shaders/light_grid.comp and shaders/volumetric_fog.glsl (std430).
// КОРНЕВАЯ константа раскладки клетки — БАЙТЫ, степень двойки (решение
// владельца, markoaudit/plans/light-visibility-bake.md §ответы: «клетка 256 Б,
// 64 МиБ сетки — гроши»; было 128 Б / 31 id, и плотные залы блейма теряли
// хвост списка). Всё остальное ВЫВОДИТСЯ: слоты = байты/слово − счётчик;
// в GLSL число едет как -DGIGA_LIGHT_CELL_BYTES (CMakeLists парсит kGridCellBytes
// отсюда, правило 9 гейта запрещает литерал в шейдере). Перелив вытесняется по
// вкладу в клетку (top-K по d²/r², light_grid.comp) и СЧИТАЕТСЯ: шейдер
// атомарно копит переливы в заголовке светобуфера, update_and_dispatch читает
// их и печатает раз в кадр при ненулевом — молча не режем (закон S11).
static constexpr uint32_t kGridCellBytes = 256;
static constexpr uint32_t kGridCellSlots =
    kGridCellBytes / sizeof(uint32_t) - 1; // 63: счётчик + 63 индекса
struct alignas(16) GpuGridCell {
    uint32_t count = 0;
    uint32_t lightIndices[kGridCellSlots]{};
};
static_assert(sizeof(GpuGridCell) == kGridCellBytes,
              "GpuGridCell std430 layout must equal kGridCellBytes");

// Matches GridPush in shaders/light_grid.comp
struct alignas(16) GridPush {
    vec4 camPos;  // xyz = camera world position, w = max range (48.0m)
    vec4 gridMin; // xyz = 3D grid min corner in world space, w = cell size x/z (2.0m)
    vec4 gridExt; // x = gridDimX (32), y = gridDimY (16), z = gridDimZ (32), w = cell size y (2.0m)
    vec4 params;  // x = uTime, y = maxLightsPerCell (kGridCellSlots), z = activeLightCount, w = wrap period
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

    // Статик-таблица этажа: [0..n) занимают лампы со стабильными слот-id (те
    // же id, которыми оперирует бейк видимости light_vis_bake). Зовётся при
    // (пере)постройке этажа; intensity в base игнорируется — её каждый кадр
    // пишет set_static_intensity (0 = надгробие: умершая лампа не светит, слот
    // жив до ребейка). clear_lights обнуляет интенсивности статиков и
    // динамический хвост; порядок кадра: clear -> интенсивности + динамики.
    void set_static_table(const GpuPointLight* base, uint32_t n) noexcept;
    void set_static_intensity(uint32_t slot, float intensity) noexcept;
    uint32_t static_count() const noexcept { return staticCount_; }

    // Zero-allocation light collection — ДИНАМИЧЕСКИЙ хвост [staticCount..).
    // 4-арг = омни; перегрузка с dir/cosOuter = конус (фонарик, прожектор).
    // Один структ, один цикл в шейдере — «универсальные источники живут
    // вместе» по построению.
    void add_light(const vec3& pos, float radius, const vec3& color, float intensity) noexcept;
    void add_light(const vec3& pos, float radius, const vec3& color, float intensity,
                   const vec3& dir, float cosOuter) noexcept;
    void clear_lights() noexcept;

    // Record compute dispatch (3D spatial grid binning) & pipeline memory barrier.
    // Must execute outside active render pass on current_cmd().
    void update_and_dispatch(VkCommandBuffer cmd, float timeSec, const vec3& camPos) noexcept;

    VkDescriptorSetLayout descriptor_set_layout() const noexcept { return descriptorSetLayout_; }
    VkDescriptorSet descriptor_set() const noexcept { return descriptorSet_; }
    bool ready() const noexcept { return computePipeline_ != VK_NULL_HANDLE; }

    uint32_t active_light_count() const noexcept {
        return staticCount_ + dynamicCount_;
    }
    uint32_t overflow_dropped() const noexcept { return overflowDropped_; }
    // Клетки, перелившиеся В ПРОШЛОМ снятом кадре (атомарный счёт в
    // light_grid.comp, читается из заголовка светобуфера кадром позже).
    uint32_t cell_overflow() const noexcept { return cellOverflow_; }

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

    // Временный камерный отбор до слияния bakedGrid (умирает по плану §5
    // вместе с kMaxPointLights: камерный отбор — нарушение S7).
    void sort_lights_by_distance(const vec3& camPos) noexcept;

    // Вектора, не массивы: kRootLights x 48 B — этому не место ни в объекте на
    // стеке main(), ни тем более в кадре стека. Резервируются один раз в init().
    // stagingLights_ = [статик-таблица | динамический хвост]; статики НЕ
    // переупорядочиваются никогда (слот-id стабильны), временный сорт пишет в
    // sortScratch_ и грузит на GPU оттуда.
    std::vector<GpuPointLight> stagingLights_;
    std::vector<GpuPointLight> sortScratch_;
    std::vector<std::pair<float, uint32_t>> sortKeys_; // distSq, index
    uint32_t staticCount_ = 0;
    uint32_t dynamicCount_ = 0;
    uint32_t sortedCount_ = 0; // живых (не-надгробий) в sortScratch_ после сорта
    uint32_t overflowDropped_ = 0;
    uint32_t cellOverflow_ = 0;
};
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

} // namespace giga::gpu
