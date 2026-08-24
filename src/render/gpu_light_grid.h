#pragma once

#include <cstddef>
#include <cstdint>
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

// Надгробие: intensity ≤ порога = слот мёртв до ребейка (компакция на свапе).
// Обязан совпадать с kTombstone в light_grid.comp.
static constexpr float kTombstoneIntensity = 0.001f;

// КЛАСТЕРЫ УДАЛЕНЫ 2026-08-23 (решение владельца): регион верхних слотов,
// записи-агрегаты и покадровая сумма их интенсивностей. Механизм не работал
// ни одного кадра — биннинг выбрасывал каждую кластерную ссылку (id 98304+
// против порога staticCount ~12646), потребительская ветка шейдера была
// мёртвым кодом. Цена: клетка жила максимум 8 честными лампами при среднем
// 10.6, и свет рвался прямоугольниками по границам клеток 4 м.
// kMaxPointLights = 512 и sort_lights_by_distance УМЕРЛИ (план
// light-visibility-bake §5): камерный отбор — нарушение S7 («дальние комнаты
// гаснут»), а сбор кандидатов клетки решает запечённая видимость (bakedGrid)
// + дистанционный фолбэк грязных клеток. На GPU едет вся таблица.

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

// Бакеты ДИНАМИЧЕСКОГО хвоста (проблема 59.14): раньше каждая из 262144
// клеток сканировала весь хвост [staticCount..activeCount) каждый кадр —
// перестрелка (каждый снаряд = лампа) дорожала линейно от интенсивности боя.
// Теперь CPU сплатит динамики сферами в решётку 16³ (бакет = период/16 =
// 16 м), клетка компьюта читает ТОЛЬКО свой бакет. Вывод ёмкости: динамиков
// единицы-десятки, сфера снаряда ~5-10 м накрывает ≤8 бакетов — 15 слотов
// держат ~2 плотных боя в одном бакете; переполнение НЕ роняет свет: бакет
// помечается kDynBucketFallback и клетка честно сканирует весь хвост (ошибка
// всегда «заплатить больше», не «потерять лампу» — S11 вслух строкой).
static constexpr uint32_t kDynBucketDim = 16;
static constexpr uint32_t kDynBucketCount =
    kDynBucketDim * kDynBucketDim * kDynBucketDim; // 4096
static constexpr uint32_t kDynBucketSlots = 15;    // 16 слов: счётчик + 15 id
static constexpr uint32_t kDynBucketFallback = 0xFFFFFFFFu;

// Matches GridPush in shaders/light_grid.comp
// Камеры в пуше НЕТ (S7: биннинг камеронезависим). Блок ужат чисткой
// 2026-08-23 (смерть грязной ветки 37e772d1): camPos-гейт, genBaked,
// params.z (R_max) и params.w (флаг топологии) вырезаны С ОБЕИХ СТОРОН
// синхронно — урок «0 света» 2026-08-22: пуш-блок шейдера и host-структура
// суть ОДИН layout, поле умирает только с обеих сторон разом. Раскладка
// обязана совпадать с light_grid.comp::GridPush.
struct alignas(16) GridPush {
    vec4 gridMin; // xyz = min-угол сетки в мире, w = размер клетки x/z (4.0 м)
    vec4 gridExt; // xyz = размеры сетки (64,64,64), w = размер клетки y (4.0 м)
    vec4 params;  // x = activeLightCount, y = wrap period (kWorldExtent); z/w свободны
    uint32_t genStaticCount = 0; // граница секций: [0..S) статики, [S..N) динамики
    uint32_t dynBucketDim = 0;   // решётка бакетов динамиков (= kDynBucketDim)
    uint32_t dynBucketSlots = 0; // слотов на бакет (= kDynBucketSlots)
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
    float staged_intensity(uint32_t slot) const noexcept;
    uint32_t static_count() const noexcept { return staticCount_; }

    // Свап бейка видимости: залить bakedGrid (лейаут LightVisBake.cells ==
    // GpuGridCell[kTotalGridCells] по построению — слоты приходят от нас же)
    // и поднять bakedGen. memcpy в стейджинг здесь; vkCmdCopyBuffer — в
    // update_and_dispatch, вне рендер-пасса, кадром заливки.
    void upload_baked_grid(const uint32_t* cells, std::size_t words,
                           uint32_t bakedGen) noexcept;
    // Частичный свап (дельта-патч, carve-hitch.md §3): записать в стейджинг
    // ТОЛЬКО изменённые клетки (отсортированный список индексов) и скопировать
    // их диапазонами кадром заливки — полная копия 64 МиБ (42 мс замером) за
    // дырку не платится. Полная заливка, запрошенная тем же кадром, главнее
    // диапазонов. (Дренаж dirtyGen и кластерная топология грязного фоллбэка
    // вырезаны чисткой 2026-08-23 — свет ДОГОНЯЕТ мир патчами, 37e772d1.)
    void upload_baked_cells(const uint32_t* cells, std::size_t words,
                            const uint32_t* changed, std::size_t nChanged,
                            uint32_t bakedGen) noexcept;

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
    // (timeSec/camPos параметры умерли чисткой 2026-08-23: компьют не читал
    // ни времени, ни камеры — биннинг камеронезависим, S7.)
    void update_and_dispatch(VkCommandBuffer cmd) noexcept;

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
    // Запечённая видимость (план light-visibility-bake §1.2): bakedGrid —
    // device-local зеркало LightVisBake.cells (64 МиБ), bakedStaging_ —
    // host-visible источник копии (каденция — секунды, полоса копейки).
    // Буферы dirtyGen_/clusterBucketBuf_/clusterMembersBuf_ грязной ветки
    // вырезаны чисткой 2026-08-23 (−1.25 МиБ host-visible).
    VulkanBuffer bakedGrid_{};    // DEVICE_LOCAL, kTotalGridCells × kGridCellBytes
    VulkanBuffer bakedStaging_{}; // HOST_VISIBLE persistent mapped, тот же размер
    VulkanBuffer dynBuckets_{};   // HOST_VISIBLE, бакеты динамиков (59.14), 256 КиБ

    void* lightMapped_ = nullptr;
    void* bakedMapped_ = nullptr;
    uint32_t* dynBucketsMapped_ = nullptr;
    uint32_t dynBucketOverflowFrames_ = 0; // троттлинг строки перелива

    VkDescriptorSetLayout descriptorSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet_ = VK_NULL_HANDLE;

    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline computePipeline_ = VK_NULL_HANDLE;

    // Вектор, не массив: kRootLights x 48 B — этому не место ни в объекте на
    // стеке main(), ни тем более в кадре стека. Резервируется один раз в
    // init(). stagingLights_ = [статик-таблица | динамический хвост]; статики
    // НЕ переупорядочиваются никогда (слот-id стабильны).
    std::vector<GpuPointLight> stagingLights_;
    uint32_t staticCount_ = 0;
    uint32_t dynamicCount_ = 0;
    uint32_t overflowDropped_ = 0;
    uint32_t cellOverflow_ = 0;
    uint32_t bakedGen_ = 0;
    bool bakedUploadPending_ = false;
    // Диапазоны частичного свапа (смежные клетки склеены); живут до копии в
    // update_and_dispatch. Полная заливка их обнуляет — копия целиком кроет.
    std::vector<VkBufferCopy> bakedRegions_;
};
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

} // namespace giga::gpu
