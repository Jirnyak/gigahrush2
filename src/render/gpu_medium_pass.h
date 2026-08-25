// МИР-АВТОМАТ (CANON S16) — двигатель материи над зеркалом VoxelMirror.
//
// GPU-часть — shaders/medium_sim.comp (Margolus-блоки IN-PLACE в каноническом
// pagePool: живой брик = страница sub_material, отдельного пула нет — см.
// шапку шейдера). Этот класс владеет:
//
//   * CPU live-набором — какие клетки диспатчатся. Спящая материя не стоит
//     НИЧЕГО ни на одном процессоре (S16.1): пустой live-набор = ноль
//     диспатчей, страницы осевшей материи остаются каноническим форматом
//     зеркала и рендерятся даром.
//   * Протоколом пробуждения: писатели (sphere, карв, эмиттеры) будят клетки;
//     автомат репортит активность (ActOut: изменение / касание +октанта /
//     материя у грани / кванты), CPU будит соседей и усыпляет тихие клетки.
//     Пробуждение обязано РАСКРЫТЬ страницу в CPU-каноне (ensure_page +
//     mark_dirty зеркала): GPU не умеет выделять страницы, а автомат пишет
//     только в страницы.
//   * Тактом НЕ владеет: подтики считает вызывающий от сим-тиков (решение
//     владельца 2026-08-24: подтик = каждый 4-й сим-тик, 31.25 Гц — падение
//     0.25 м × 31.25 = 7.8 м/с; детерминизм и пауза бесплатно, потому что
//     стоят сим-часы — стоит материя).
//
// ЧЕСТНОСТЬ ЧТЕНИЯ АКТИВНОСТИ: ActOut читается без фенса, с отставанием до
// кадра в полёте. Рваное слово даёт лишний wake (безвреден — заснёт) или
// пропущенный changed (quiet++ ложно); порог сна в 16 подтиков делает ложный
// сон статистически безобидным, а соседи будят обратно. Точный шов GPU→CPU
// с фенсом — инкремент 3 (осевшие брики в CPU-канон), не этот класс.
#pragma once

#include <algorithm>
#include <cstdint>
#include <unordered_set>
#include <vector>
#include <vulkan/vulkan.h>

#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_common.h" // kMaxFramesInFlight — регионы обратного шва
#include "world/gravity.h"

namespace giga {
class World;
}

namespace giga::gpu {

struct VulkanDevice;
class VoxelMirror;

// Зеркало Push в shaders/medium_sim.comp.
struct alignas(16) MediumPush {
    ivec4 downStep; // xyz = regime_down фрейма
    // x = номер подтика (offset Margolus + соль роллов), y = живых клеток,
    // z = режим (0 move / 1 settle), w = свободно.
    std::uint32_t params[4];
};
static_assert(sizeof(MediumPush) == 32, "MediumPush layout must be 32 bytes");

class GpuMediumPass {
public:
    // Кап живых клеток. Вывод: самый жирный разовый писатель — sphere r=2 м
    // (кап команды) = 33.5 м³ ≈ 2144 кванта ≈ до ~500 клеток с фронтом;
    // лужи и эмиттеры — сотни. 32768 = запас ~двух порядков, худший случай
    // страниц 32 МиБ (уже в пуле зеркала), и НЕ упирается в лимит Vulkan
    // 65535 воркгрупп по X. Переполнение печатается вслух (S11).
    // Рабочий набор автомата: пара списков по 4 Б на слот (1 МиБ на кап
    // 131072). Кап 32768 упирался в газ+воду одного этажа: новорожденные
    // клетки фронта проигрывали гонку за слоты старожилам (стабильный
    // порядок пуша) — вода не шла в клетки. Запас = 8 слоёв газа на весь
    // этаж 128x128.
    static constexpr std::uint32_t kLiveCap = 131072u;
    // Обратный шов, фенсовая дисциплина (детали у полей ниже): регионов на
    // один больше, чем кадров в полёте; запись кадра F применяется на топе
    // кадра F + kRbRegions — раньше её исполнение не гарантировано, и слот
    // нёс бы страницу чужой клетки (урок «мешанины» 2026-08-24).
    static constexpr std::uint32_t kRbRegions = kMaxFramesInFlight + 1;
    static constexpr std::uint32_t kRbSlotCap = 8192;

    // Порог сна: 16 тихих подтиков = 0.51 с на 31.25 Гц. Сон — НАБЛЮДЕНИЕ
    // планировщика («ни одного свопа»), правило о нём не знает (чистый
    // Марков, закон владельца 2026-08-24). Спят: осевший щебень, запертая в
    // породе вода, интерьер глубокой воды (нет пары с воздухом — нет ходов).
    // ПОВЕРХНОСТЬ открытой лужи диффундирует и живёт вечно — осознанная
    // цена («всё равно же GPU»): live растёт с ПОВЕРХНОСТЬЮ материи, не с
    // объёмом.
    static constexpr std::uint32_t kSleepSubsteps = 16u;

    GpuMediumPass() = default;
    ~GpuMediumPass() { destroy(); }
    GpuMediumPass(const GpuMediumPass&) = delete;
    GpuMediumPass& operator=(const GpuMediumPass&) = delete;

    bool init(VulkanDevice* dev, const char* shaderDir,
              const VoxelMirror& mirror);
    void destroy() noexcept;
    bool ready() const noexcept { return pipeline_ != VK_NULL_HANDLE; }

    // Писатель разбудил клетки (flat macro-индексы): CPU материализует
    // страницы (materialize + mark_dirty) клеткам И ГРАНЯМ — автомат пишет
    // только в страницы, — а сами клетки уезжают инжект-пассом в GPU-список
    // на ближайшем record_substeps. Полнотвёрдые не будятся.
    void wake_cells(const std::uint32_t* cells, std::size_t n, World& world,
                    VoxelMirror& mirror);

    // Применить готовый (по фенсовой дисциплине) регион шва в CPU-канон:
    // СПИСОК живых клеток пришёл ИЗ РЕГИОНА (его собрал pack-пасс GPU —
    // CPU-протокола диспетчеризации не существует, решение владельца
    // 2026-08-24), страницы и маски memcpy слот-в-слот, агрегаты
    // пересчитываются, клетки без GPU-страницы лениво материализуются
    // (mark_dirty довезёт, материя подождёт у границы кадр-два). Звать в
    // начале кадра, ДО сим-писателей. changedMasks — клетки с реально
    // изменившейся маской (нав-долг вызывающего).
    void apply_readback(World& world, VoxelMirror& mirror,
                        std::vector<std::uint32_t>* changedMasks = nullptr);

    // Смена слоя/этажа: GPU-список указывает в старый мир — гасим всё
    // (счётчики и биты обнулит клир на ближайшем record).
    void clear_live() noexcept {
        appendPending_.clear();
        actNeedsClear_ = true;
        lastCount_ = 0;
        lastQuanta_ = 0;
        for (auto& r : rbRing_) r.valid = false;
        // Поколение шва — В НОЛЬ СИНХРОННО (гейт свежести живёт на клоке
        // ЗЕРКАЛА и смену слоя переживает сам — flushGen монотонен).
        rbGen_ = 0;
    }

    // Записать n подтиков GPU-петли (inject -> [prepare, move, settle] x n)
    // + pack шва. Вне рендер-пасса, ПОСЛЕ voxelMirror.flush(); frameSlot =
    // renderer.currentFrame — слот append-буфера (буфер прошлого кадра GPU
    // ещё может читать).
    void record_substeps(VkCommandBuffer cmd, std::uint32_t n,
                         const CellStep& downStep, std::uint64_t substepBase,
                         const World& world, std::uint32_t frameSlot,
                         std::uint32_t mirrorFlushGen);

    // Числа для печати каждый прогон (S11) — с лагом фенсового кольца.
    std::uint32_t live_count() const noexcept { return lastCount_; }
    std::uint32_t live_quanta() const noexcept { return lastQuanta_; }
    std::uint32_t woken_total() const noexcept { return wokenTotal_; }
    std::uint32_t slept_total() const noexcept { return sleptTotal_; }
    bool overflowed() const noexcept { return overflow_; }
    std::uint32_t lazy_total() const noexcept { return lazyTotal_; }
    std::uint32_t list_total() const noexcept { return listTotal_; }
    std::uint32_t fade_total() const noexcept { return fadeTotal_; }
    bool wake_cap_hit() const noexcept { return wakeCapHit_; }
    // Диагноз (GIGA_POUR): побывала ли клетка в применённых регионах шва.
    bool seam_seen(std::uint32_t ci) const { return seamSeen_.count(ci) != 0; }
    bool seam_lazy(std::uint32_t ci) const { return seamLazy_.count(ci) != 0; }

private:
    bool create_buffers() noexcept;
    bool create_descriptors(const VoxelMirror& mirror) noexcept;
    bool create_pipeline(const char* shaderDir) noexcept;

    VulkanDevice* dev_ = nullptr;

    VkBuffer mirrorPool_ = VK_NULL_HANDLE;  // pagePool зеркала
    VkBuffer mirrorMasks_ = VK_NULL_HANDLE; // masks зеркала

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSet sets_[kMaxFramesInFlight]{}; // слот кадра: свой append
    VkPipelineLayout pipeLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;

    // GPU-резидентная петля: ping-pong списки + счётчики-indirect
    // ([shaders/medium_sim.comp], биндинги 5..12).
    VulkanBuffer listA_;
    VulkanBuffer listB_;
    VulkanBuffer counters_; // 16 u32; usage INDIRECT — диспатч от них
    VulkanBuffer cellAct_;  // device-local: uint32 x kMacroCells (8 МиБ)
    // Инжект писателей: слот на кадр в полёте.
    static constexpr std::uint32_t kAppendCap = 8192u;
    VulkanBuffer appendBuf_[kMaxFramesInFlight];
    std::vector<std::uint32_t> appendPending_;
    std::vector<std::uint32_t> lazyDirty_; // материализованные новички шва
    std::uint32_t listSel_ = 0; // чей список ТЕКУЩИЙ (персистентен)

    // Обратный шов (фенсовое кольцо kRbRegions): страницы/маски/СПИСОК
    // регионов пишет pack-пасс GPU — CPU только читает готовые.
    VulkanBuffer pageBack_;
    VulkanBuffer maskBack_;
    VulkanBuffer listBack_; // регион: 4 u32 заголовка + kRbSlotCap слотов
    struct RbRecord {
        bool valid = false;
        // Счётчик ФЛЕШЕЙ ЗЕРКАЛА на момент записи пака (клок кадров зеркала,
        // флеш до пака): гейт свежести сравнивает пак с ДОСТАВКОЙ CPU-записи
        // — гейт от записи ломался остатком окна стейджинга («дыра
        // заросла», 2026-08-26: пак между записью и её доставкой нёс
        // до-карвное состояние и воскрешал атомы).
        std::uint32_t flushCount = 0;
    };
    RbRecord rbRing_[kRbRegions];
    std::uint64_t rbGen_ = 0;
    bool actNeedsClear_ = true;

    std::uint32_t lazyTotal_ = 0; // ленивые материализации шва (диагноз)
    std::unordered_set<std::uint32_t> seamSeen_, seamLazy_; // GIGA_POUR
    std::uint32_t listTotal_ = 0;   // честный размер списка до окна пака
    std::uint32_t fadeTotal_ = 0;   // истаявшие одиночки (закон 2026-08-25)
    bool wakeCapHit_ = false;       // wake_next упирался в kListCap
    bool rbWindowWarned_ = false, wakeCapWarned_ = false;
    std::uint32_t lastCount_ = 0;
    std::uint32_t lastQuanta_ = 0;
    std::uint32_t wokenTotal_ = 0;
    std::uint32_t sleptTotal_ = 0;
    bool overflow_ = false;
};

} // namespace giga::gpu
