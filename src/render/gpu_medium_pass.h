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

#include "world/types.h" // kMacroCells — битсет очереди пробуждений
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
    // Кап живых клеток МЁРТВ СМЫСЛОМ с инкремента 2 «Автомат-2»: список-
    // однодневка вмещает все kMacroCells по построению, переполнение
    // невозможно. Константа жива только для -D моста CMake
    // (GIGA_MEDIUM_LIST_CAP, шейдером больше не читается) — уборка вместе
    // с перенумерацией биндингов в инкременте 6.
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

    // Писатель разбудил клетки (flat macro-индексы): источники ложатся в
    // ДЕДУП-ОЧЕРЕДЬ С ПЕРЕНОСОМ (битсет по kMacroCells — клетка стоит в
    // очереди один раз). Раскрытие граней (×7), материализация фронтира и
    // инжект происходят в drain_wakes — порцией под бюджет кадра, остаток
    // честно ПЕРЕНОСИТСЯ, не выбрасывается. До 2026-08-27 всё сверх
    // kAppendCap за кадр молча терялось (будильник этажа терял ~86%
    // пробуждений), а фронтир на всю пачку разом давал разовый
    // 18-миллионный проход — хитч.
    void wake_cells(const std::uint32_t* cells, std::size_t n, World& world,
                    VoxelMirror& mirror);

    // Дренаж очереди пробуждений: порция источников под бюджет
    // инжект-буфера (kAppendCap touch-ей с гранями), фронтир — только
    // порции. Звать раз в кадр ПЕРЕД voxelMirror.flush (страницы фронтира
    // обязаны уехать этим же кадром) и до record_substeps. Бит-идентичность
    // каденса держится, пока пачка писателя укладывается в бюджет кадра
    // (стенды под капом); суб-степовый инжект — отдельное решение владельца.
    void drain_wakes(World& world, VoxelMirror& mirror);

    // Раскрыть страницы вокруг клеток БЕЗ пробуждения (фронтир впереди
    // материи, закон «ничего не зависит от кадра» 2026-08-27): радиус и его
    // вывод — kFrontierRadius в .cpp. Зовут писатель (wake_cells) и шов
    // (apply_readback); пустые страницы в живой список не входят.
    void open_frontier(World& world, VoxelMirror& mirror,
                       const std::uint32_t* cells, std::size_t n);

    // Применить готовый (по фенсовой дисциплине) регион шва в CPU-канон:
    // СПИСОК живых клеток пришёл ИЗ РЕГИОНА (его собрал pack-пасс GPU —
    // CPU-протокола диспетчеризации не существует, решение владельца
    // 2026-08-24), страницы и маски memcpy слот-в-слот, агрегаты
    // пересчитываются, клетки без GPU-страницы лениво материализуются
    // (mark_dirty довезёт, материя подождёт у границы кадр-два). Звать в
    // начале кадра, ДО сим-писателей. changedMasks — клетки с реально
    // изменившейся маской (нав-долг вызывающего; судья связности сюда НЕ
    // подключён — ход автомата не может осиротить статику по закону
    // опоры S20.5, см. [world/destruct.h] detach_judge_cells).
    void apply_readback(World& world, VoxelMirror& mirror,
                        std::vector<std::uint32_t>* changedMasks = nullptr);

    // Смена слоя/этажа: GPU-список указывает в старый мир — гасим всё
    // (счётчики и биты обнулит клир на ближайшем record).
    void clear_live() noexcept {
        appendPending_.clear();
        wakeQueue_.clear();
        std::fill(wakeBits_.begin(), wakeBits_.end(), 0ull);
        // Предупреждения — ПО-ЭТАЖНО, не раз за процесс: молчащий после
        // первого раза кап неотличим от здорового (аудит 2026-08-27).
        overflow_ = false;
        rbWindowWarned_ = false;
        wakeCapWarned_ = false;
        actNeedsClear_ = true;
        std::fill(frontierDone_.begin(), frontierDone_.end(), 0ull);
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

    // Очередь пробуждений ещё несёт остаток — «этаж не допробужен».
    // Читает лифт: двери кабины ждут пустой очереди (решение владельца
    // 2026-08-27 — лавина будильника этажа целиком уходит за закрытые
    // двери бесшовной загрузки; суб-степовый инжект не нужен по построению).
    bool wakes_pending() const noexcept { return !wakeQueue_.empty(); }

    // Числа для печати каждый прогон (S11) — с лагом фенсового кольца.
    std::uint32_t live_count() const noexcept { return lastCount_; }
    // ОГОВОРКА БЮДЖЕТА: uCnt[8] суммируют только ИСПОЛНЕННЫЕ в подтик
    // клетки — при live > budget метрика занижена в ~stride раз (полная
    // ≈ quanta × ceil(live/budget)). Потребители — только диагностика.
    std::uint32_t live_quanta() const noexcept { return lastQuanta_; }

    // БЮДЖЕТНЫЙ ДИСПАТЧ (big-judge.md D): за подтик исполняется не более
    // ~budget слотов live-списка нечётно-страйдовой ротацией (изотропия по
    // фазам гарантирована — [medium_sim.comp] slot_budgeted). 0 = без
    // бюджета. Дефолт = kRbSlotCap: live в пределах окна шва живёт полным
    // темпом, ровно как до бюджета; перекрытие GIGA_MEDIUM_BUDGET — A/B-
    // ручка перф-кривой (как GIGA_LIGHT_BUDGET). Тесты зовут set_budget.
    void set_budget(std::uint32_t b) noexcept { budget_ = b; }
    std::uint32_t budget() const noexcept { return budget_; }
    std::uint32_t woken_total() const noexcept { return wokenTotal_; }
    std::uint32_t slept_total() const noexcept { return sleptTotal_; }
    bool overflowed() const noexcept { return overflow_; }
    std::uint32_t lazy_total() const noexcept { return lazyTotal_; }
    std::uint32_t list_total() const noexcept { return listTotal_; }
    std::uint32_t fade_total() const noexcept { return fadeTotal_; }
    std::uint32_t stale_skips() const noexcept { return staleSkips_; }
    bool wake_cap_hit() const noexcept { return wakeCapHit_; }
    // Диагноз (GIGA_POUR): побывала ли клетка в применённых регионах шва.
    bool seam_seen(std::uint32_t ci) const { return seamSeen_.count(ci) != 0; }
    bool seam_lazy(std::uint32_t ci) const { return seamLazy_.count(ci) != 0; }

    // БИТСЕТ АКТИВНОСТИ (эпик «Автомат-2», medium-bitmask.md) — нервная
    // система автомата: словный гейт пересобирает из него список-однодневку
    // исполнимых клеток каждый подтик. Аксессоры — только для гейт-сверки
    // test_bitset_execution («список == дилатация битсета» после idle).
    VkBuffer active_bits_buffer() const noexcept { return shadowBits_.buffer; }
    VkBuffer exec_list_buffer() const noexcept { return listA_.buffer; }
    VkBuffer counters_buffer() const noexcept { return counters_.buffer; }

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

    // GPU-резидентная петля (Автомат-2): битсет активности + список-
    // однодневка от гейта + счётчики-indirect (биндинги 5..13).
    VulkanBuffer listA_;    // список-однодневка исполнимых (2М слотов, 8 МиБ)
    VulkanBuffer counters_; // 16 u32; usage INDIRECT — диспатч от них
    VulkanBuffer cellAct_;  // device-local: uint32 x kMacroCells (8 МиБ)
    VulkanBuffer shadowBits_; // БИТСЕТ АКТИВНОСТИ (256 КиБ) — нерв автомата
    // Инжект писателей: слот на кадр в полёте.
    static constexpr std::uint32_t kAppendCap = 8192u;
    VulkanBuffer appendBuf_[kMaxFramesInFlight];
    std::vector<std::uint32_t> appendPending_;
    // Очередь пробуждений с переносом + битсет «уже в очереди» (256 КиБ).
    std::vector<std::uint32_t> wakeQueue_;
    std::vector<std::uint64_t> wakeBits_ =
        std::vector<std::uint64_t>(kMacroCells / 64, 0ull);
    // Битсет «округа клетки уже раскрыта» (256 КиБ): скан R=6 = 2197 проб,
    // и open_frontier звался на всё окно каждый кадр — 4-8 мс при 85-100%
    // повторной работы (замер 2026-08-30). Скан идемпотентен, страницы сами
    // не исчезают (схлопыватели — CPU-писатели, их wake-путь раскрывает
    // округу записи заново по своим клеткам) — раз на клетку за этаж
    // достаточно, набор страниц по таймлайну подтиков не меняется
    // (пин test_cadence_equivalence). Сброс — clear_live().
    std::vector<std::uint64_t> frontierDone_ =
        std::vector<std::uint64_t>(kMacroCells / 64, 0ull);
    std::vector<std::uint32_t> lazyDirty_; // материализованные новички шва
    std::uint32_t budget_ = kRbSlotCap; // бюджет диспатча (см. set_budget)

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
        std::uint32_t packGen = 0; // ВРЕМЕННО: ожидаемый ген в header[2]
    };
    RbRecord rbRing_[kRbRegions];
    std::uint64_t rbGen_ = 0;
    bool actNeedsClear_ = true;

    std::uint32_t lazyTotal_ = 0; // ленивые материализации шва (диагноз)
    std::unordered_set<std::uint32_t> seamSeen_, seamLazy_; // GIGA_POUR
    std::uint32_t listTotal_ = 0;   // честный размер списка до окна пака
    std::uint32_t fadeTotal_ = 0;   // истаявшие одиночки (закон 2026-08-25)
    // Зомби-замер §63 (накопительные, как woken/slept): пуш клетки, чья
    // тишина уже доросла до порога сна / face-пуш из settle / голос «живая
    // при нуле подвижных квантов». Их соотношение называет, кто держит
    // сухой шлейф бодрым — печать в [medium-dbg].
    std::uint32_t zombieTotal_ = 0;
    std::uint32_t faceWakeTotal_ = 0;
    std::uint32_t dryLiveTotal_ = 0;

public:
    // СОСТАВ med_apply (замер по добру владельца 2026-08-30, §63: куда
    // уходят 11 мс шва — прежде чем трогать run_move). Значения ПОСЛЕДНЕГО
    // применения; [prof] в main.cpp кладёт мс в кольца и печатает свод.
    float apply_loop_ms() const noexcept { return applyLoopMs_; }
    float apply_frontier_ms() const noexcept { return applyFrontierMs_; }
    std::uint32_t apply_window() const noexcept { return applyWindow_; }
    std::uint32_t apply_cmp_only() const noexcept { return applyCmpOnly_; }
    std::uint32_t apply_copied() const noexcept { return applyCopied_; }
    std::uint32_t apply_lazy() const noexcept { return applyLazy_; }
    std::uint32_t apply_skip_fresh() const noexcept { return applySkipFresh_; }

private:
    float applyLoopMs_ = 0.0f;      // цикл по окну: гейты+memcmp+копии
    float applyFrontierMs_ = 0.0f;  // open_frontier по liveCis в хвосте
    std::uint32_t applyWindow_ = 0;    // клеток в применённом окне
    std::uint32_t applyCmpOnly_ = 0;   // страница+маска НЕ менялись (чистый memcmp)
    std::uint32_t applyCopied_ = 0;    // страница менялась (memcpy+recount)
    std::uint32_t applyLazy_ = 0;      // ленивые материализации
    std::uint32_t applySkipFresh_ = 0; // скипы гейта свежести/write_pending
    std::uint32_t staleSkips_ = 0;  // регионы с чужой подписью (шов ждал GPU)
    bool wakeCapHit_ = false;       // wake_next упирался в kListCap
    bool rbWindowWarned_ = false, wakeCapWarned_ = false;
    std::uint32_t lastCount_ = 0;
    std::uint32_t lastQuanta_ = 0;
    std::uint32_t wokenTotal_ = 0;
    std::uint32_t sleptTotal_ = 0;
    bool overflow_ = false;      // очередь пробуждений несёт остаток (см. drain_wakes)
    std::uint32_t wakeCarryEvents_ = 0; // рейт-лимит строки wake carry
};

} // namespace giga::gpu
