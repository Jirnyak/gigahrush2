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
#include <vector>
#include <vulkan/vulkan.h>

#include "core/math.h"
#include "render/vk_buffer.h"
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
    static constexpr std::uint32_t kLiveCap = 32768u;
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

    // Писатель разбудил клетки (flat macro-индексы). Раскрывает CPU-страницу
    // (ensure_page базой = CellType клетки) и метит зеркало dirty, если
    // страницы не было; полнотвёрдые клетки не будит (двигаться нечему).
    void wake_cells(const std::uint32_t* cells, std::size_t n, World& world,
                    VoxelMirror& mirror);

    // Разбор ActOut прошлого диспатча: пробуждение соседей, усыпление тихих.
    // Звать РАЗ В КАДР до record_substeps.
    void poll_activity(World& world, VoxelMirror& mirror);

    // Смена слоя/этажа: live-набор указывает в СТАРЫЙ мир — сбросить целиком
    // (зеркало в этот момент переезжает через upload_all).
    void clear_live() noexcept {
        live_.clear();
        std::fill(liveBits_.begin(), liveBits_.end(), 0ull);
        lastDispatched_ = 0;
        liveQuanta_ = 0;
        overflow_ = false;
    }

    // Записать n подтиков (move пачкой + settle) в cmd + ОБРАТНЫЙ ШОВ:
    // страницы живых клеток копируются в host-visible буфер — байт-копия
    // GPU→CPU каждый кадр (инкремент 3, S16.3 «туда-сюда макс быстро»).
    // Вне рендер-пасса, ПОСЛЕ voxelMirror.flush() — барьеры внутри.
    // substepBase — сквозной номер первого подтика (детерминизм роллов);
    // world — таблица страниц (автомат страниц не выделяет, слоты совпадают
    // по построению).
    void record_substeps(VkCommandBuffer cmd, std::uint32_t n,
                         const CellStep& downStep, std::uint64_t substepBase,
                         const World& world);

    // Применить последний ридбек в CPU-канон: memcpy страниц И МАСОК
    // слот-в-слот (инкремент 5: автомат двигает масочный рубл — маска-кэш
    // едет вместе с материей). Звать В НАЧАЛЕ кадра, ДО сим-писателей (карв
    // режет уже свежую воду) и ДО poll_activity (уснувшая клетка успевает
    // отдать финальное состояние). CPU отстаёт от материи в полёте не
    // больше кадра — допуск канона S16.3. Чтение без фенса: рваная
    // страница — кадровая рябь, самовыправляется следующим ридбеком.
    // changedMasks (опц.): клетки, чья CPU-маска реально изменилась —
    // вызывающий гасит нав-долг (patch_carved_cells, O(1)/клетка).
    void apply_readback(World& world,
                        std::vector<std::uint32_t>* changedMasks = nullptr);

    // Числа для печати каждый прогон (S11: молча не работаем).
    std::uint32_t live_count() const noexcept {
        return static_cast<std::uint32_t>(live_.size());
    }
    std::uint32_t live_quanta() const noexcept { return liveQuanta_; }
    std::uint32_t woken_total() const noexcept { return wokenTotal_; }
    std::uint32_t slept_total() const noexcept { return sleptTotal_; }
    bool overflowed() const noexcept { return overflow_; }

private:
    bool create_buffers() noexcept;
    bool create_descriptors(const VoxelMirror& mirror) noexcept;
    bool create_pipeline(const char* shaderDir) noexcept;
    void wake_one(std::uint32_t ci, World& world, VoxelMirror& mirror);
    void record_readback(VkCommandBuffer cmd, const World& world);

    VulkanDevice* dev_ = nullptr;

    VulkanBuffer liveBuf_;   // host-visible: uint32 x kLiveCap
    VulkanBuffer cellAct_;   // device-local: uint32 x kMacroCells (8 МиБ)
    VulkanBuffer actOut_;    // host-visible: uint32 x kLiveCap
    // Обратный шов: страницы живых клеток, 1 КиБ на слот (32 МиБ на капе;
    // реальная цена — live x 1 КиБ копий за кадр) + их маски (64 Б на слот).
    VulkanBuffer pageBack_;
    VulkanBuffer maskBack_;
    std::vector<std::uint32_t> rbSlots_;      // ci слота ридбека, ~0u = пуст
    std::vector<VkBufferCopy> rbCopies_;      // скретч без аллокаций в кадре
    std::vector<VkBufferCopy> rbMaskCopies_;  // копии масок тем же слотам
    bool actNeedsClear_ = true;

    VkBuffer mirrorPool_ = VK_NULL_HANDLE;  // pagePool зеркала — источник ридбека
    VkBuffer mirrorMasks_ = VK_NULL_HANDLE; // masks зеркала — второй источник

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE;
    VkPipelineLayout pipeLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;

    struct LiveCell {
        std::uint32_t ci;
        std::uint32_t quiet; // подтиков без изменения
    };
    std::vector<LiveCell> live_;
    std::vector<std::uint64_t> liveBits_; // kMacroCells бит — дедуп wake
    // Снапшот слотов последнего диспатча — ActOut индексируется ИМ, а не
    // текущим live_ (набор мог смениться между кадрами).
    std::vector<std::uint32_t> lastSlots_;
    std::uint32_t lastDispatched_ = 0;
    std::uint32_t lastSubstepsInDispatch_ = 0;

    std::uint32_t liveQuanta_ = 0;
    std::uint32_t wokenTotal_ = 0;
    std::uint32_t sleptTotal_ = 0;
    bool overflow_ = false;
};

} // namespace giga::gpu
