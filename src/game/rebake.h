// RebakeScheduler — единая система фонового допекания активного этажа (S9.2).
//
// Наследник и МОГИЛА nav::AsyncBake. AsyncBake держал сырой указатель в живой
// MacroGrid, и вокруг этого указателя вырос целый протокол заморозки мира:
// doors.frozen, отложенный консольный карв, ВЫБРОШЕННЫЕ боевые карвы
// (droppedBake), отказ F9 во время бейка. Ключевое наблюдение плана
// (markoaudit/plans/async-rebake.md §0): оба тяжёлых бейка читают из мира ровно
// ОДИН поклеточный предикат проходимости, то есть снапшот мира для воркера — не
// 132 MiB грида, а два битсета по 256 KiB ([world/walk_bits.h]). Воркер владеет
// КОПИЕЙ по значению и ничем больше — сырой указатель, фриз мира и весь класс
// «мутация во время бейка» перестают существовать по построению. Мутация во
// время бейка просто оставляет bakedGen < worldGen после свапа, и цикл
// перезапускается по своим таймерам.
//
// Живёт в game, а не в world, потому что оркеструет game::RoomZones — world
// game не видит ([world/walk_bits.h] о том же для предикатов). Аргумент
// безопасности AsyncBake сохранён дословно: живые структуры пишутся ровно в
// одной точке — внутри step() на главном потоке, после того как воркер отдал
// секцию (release-store флага секции / join).
//
// Два режима задания (Prebuild-лифт — отдельный эпик, фаза E):
//
//  * Fresh (вход на этаж, текущая семантика): rooms печётся синхронно в
//    start_fresh (три multi-source BFS против nav-шестидесяти-четырёх — поля
//    комнат целы до первого тика, который мог бы их прочитать), живой nav-граф
//    освобождается сразу (толпа стоит до свапа — wander_step сам no-op на
//    пустом поле), nav печёт воркер на ВСЕХ ядрах со снапшота.
//
//  * Rebake (фон): живой граф НЕ трогается — потребители ходят по stale до
//    свапа («секунды устаревания — норма», CANON S9). Воркер печёт на
//    rebake_threads() потоках (hw/2 — решение владельца) в порядке приоритетов
//    СВЕТ ПЕРВЫМ (решение владельца, light-visibility-bake.md §финал: свет
//    заметнее всего, а его ужатие возвращает кадры сразу) -> rooms (~0.1 s)
//    -> coarse (~1.9 s) -> fine (~1.8 s), и step() свапает каждую секцию ПО
//    МЕРЕ ГОТОВНОСТИ, не дожидаясь хвоста. На Rebake-свапе finish_floor_nav
//    НЕ зовётся — пересев толпы нужен только на входе этажа.
//
// Отмена: cancel() ставит атомарный флаг, который бейки опрашивают в узловых
// BFS (~30 мс гранулярность, [world/nav.h]) — join при смене этажа/загрузке
// становится мгновенным вместо секунд. Результат отменённого бейка — мусор по
// контракту, step() его выбрасывает и никогда не свапает.
//
// ЧАСЫ — СИМ-ТИКИ (125 Гц), не wall-clock и не кадры: сим работает без
// рендера, а SLA обязан тестироваться headless детерминированно — wall-clock
// в тесте не существует (решение владельца, план §9 «ночь-2»).
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <thread>

#include "game/door.h"       // DoorSet — премиса all-open в патче битсетов
#include "game/floor_spec.h" // FloorKind
#include "game/light_vis_bake.h" // LightVisBake — секция света (строка №10)
#include "game/room_zone.h"   // RoomZones, bake_room_zones, patch_body_walk_bit
#include "world/macro_grid.h" // MacroGrid — снапшот масок по значению (свет)
#include "world/nav.h"        // CoarseGraph, FineNav, bake_*, patch_walk_bit
#include "world/walk_bits.h"  // WalkBits — живые битсеты и их снапшоты

namespace giga::game {

class RebakeScheduler {
public:
    // --- SLA-константы планировщика, в сим-тиках. Каждая ВЫВЕДЕНА (S11) ---

    // Потолок устаревания: слово владельца «порядка минуты» — единственная
    // авторская константа всей системы. 8192 тиков = 65.5 с; предложенные им же
    // степени 4096 (32.8 с) и 1024 (8.2 с) не держат ХУДШЕЕ целевое железо
    // (см. вывод дедлайна ниже), что и решило выбор (план §9, «ночь-2»).
    static constexpr std::uint64_t kRebakeCeilTicks = 8192;

    // Длительность полного бейка на hw/2 худшего целевого железа: 8-поточный
    // ноут, ~15-20 с по экстраполяции замера «coarse 1.9 + fine 1.8 c на 20
    // потоках» (план §6). 20.5 с = 2560 тиков — верхняя граница замера.
    // Фактическое время НА ЭТОМ железе печатает строка [rebake] — по ней эту
    // границу и уточнять, когда худшее железо окажется в руках.
    static constexpr std::uint64_t kWorstBakeTicks = 2560;

    // Жёсткий дедлайн старта после ПЕРВОЙ незапечённой мутации. Вывод: в
    // худший момент мутация падает сразу ПОСЛЕ старта цикла по старому
    // снапшоту — потолок обязан вместить достройку того цикла (до
    // kWorstBakeTicks) плюс полный новый (ещё kWorstBakeTicks): старт не
    // позже потолок − 2×бейк = 8192 − 5120 = 3072 тиков (24.6 с).
    static constexpr std::uint64_t kRebakeDeadlineTicks =
        kRebakeCeilTicks - 2 * kWorstBakeTicks;

    // Дебаунс тишины: ждём конца ПАЧКИ мутаций, иначе свап устаревает в момент
    // рождения. Типовая боевая пачка (очередь + граната) — ~2-3 с непрерывных
    // карвов (план §9); 256 тиков = 2.05 с, нижний край этой вилки, чтобы бой
    // с редкими паузами не откладывал цикл до дедлайна. Уточнять замером
    // плотности карвов в бою: GIGA_CARVE_DBG печатает пачки поштучно.
    static constexpr std::uint64_t kRebakeQuietTicks = 256;

    // Дебаунс ЧАСТИЧНОГО допекания света (carve-hitch.md, инкремент 3). Цикл
    // дёшев (~единицы-десятки мс — вывод в [game/light_vis_bake.h] у
    // LightVisPatch), поэтому длинный дебаунс полного цикла ему не нужен:
    // ждать надо только слияния одной ОЧЕРЕДИ выстрелов в один цикл. Интервал
    // выстрелов очереди ~0.1 с (600 rpm = 12.5 тиков) — 32 тика (0.26 с)
    // покрывают два межвыстрельных интервала с запасом. Каждый тик очереди
    // всё равно продлевает окно от ПОСЛЕДНЕЙ мутации, так что длинная очередь
    // печётся одним циклом после её конца.
    static constexpr std::uint64_t kLightPatchQuietTicks = 32;

    // Мин-интервал между стартами — НЕ константа, а замер самого планировщика:
    // длительность последнего Rebake в тиках (бессмысленно стартовать чаще,
    // чем бейк успевает крутиться; число решает замер, не вкус — план §9).
    // До первого замера 0: первый цикл ничем не ограничен.

    RebakeScheduler();
    ~RebakeScheduler();
    RebakeScheduler(const RebakeScheduler&) = delete;
    RebakeScheduler& operator=(const RebakeScheduler&) = delete;

    // Статик-таблица света этажа для секции LightVisibility (строка №10
    // реестра): позиции/радиусы со СТАБИЛЬНЫМИ id = индексам слотов
    // uPointLights[0..staticCount). Зовётся вызывающим ДО start_fresh (лампы
    // сеются при постройке этажа) и на рождении ламп после карва (append в
    // хвост — уже запечённые id не двигаются). slots — ёмкость клетки
    // светосетки, приходит от рендера (kGridCellSlots).
    void set_light_table(const LightVisLamp* lamps, std::size_t n,
                         std::uint32_t slots, std::uint32_t clusterBase = 0);

    // Вход на этаж. Отменяет и джойнит любой бейк в полёте (мгновенно —
    // cancel-гранулярность узловая), строит ВСЕ ТРИ живых битсета с текущей
    // геометрии (двери к этому моменту все открыты — door_build зовётся ДО,
    // и премиса all-open впекается в битсеты по построению), печёт rooms и
    // СВЕТ синхронно (хитч 0.1–0.3 с принят владельцем — план light-visibility
    // §решения; цена печатается строкой [lightvis]), освобождает живой
    // nav-граф и запускает Fresh-воркер на всех ядрах. `rooms` — живой объект
    // вызывающего: сюда же лягут и Rebake-свапы. `worldGen` — текущее
    // поколение мутаций (на входе этажа вызывающий его обнуляет).
    void start_fresh(const MacroGrid& grid, FloorKind kind, int floorNumber,
                     RoomZones& rooms, std::uint64_t worldGen);

    // Отменить бейк в полёте (флаг; воркер бросает узлы и выходит, step()
    // выбрасывает мусор). Дешёвая и идемпотентная; start_fresh делает это сам.
    void cancel();

    // Шаг планировщика + свап готовых секций. Раз в кадр, на главном потоке,
    // в топе кадра до сим-подшагов (та же точка, где стоял AsyncBake::poll).
    // Возвращает true ровно на кадре Fresh-свапа — сигнал вызывающему сделать
    // finish_floor_nav (пересев толпы). Rebake-свапы всегда возвращают false.
    bool step(std::uint64_t simTick, std::uint64_t worldGen);

    // Дренаж CarveResult::dirtyCells — O(1)-патч обоих живых битсетов из живых
    // масок ([world/nav.h] patch_walk_bit, [game/room_zone.h]
    // patch_body_walk_bit). Дверные клетки ПРОПУСКАЮТСЯ: оба бейка живут по
    // премисе «все двери открыты» ([game/door.h]), битсеты построены на входе
    // этажа при открытых дверях и обязаны её хранить — честный патч по маске
    // закрытой двери впёк бы дверь в фоновый бейк, ровно то, от чего премиса
    // защищает. (Тоггл двери битсеты не трогает по той же причине — и потому
    // же двери не инкрементируют worldGen.)
    void patch_carved_cells(const MacroGrid& grid, const DoorSet& doors,
                            const std::uint32_t* cells, std::size_t n);

    // Бюджет потоков фонового Rebake. Дефолт max(2, hw/2): hw/2 — решение
    // владельца (план §6/§9), нижний клэмп 2 — на 2-4-ядерном железе hw/2
    // вырождается в 1-2, а прогресс фона важнее честной половины. SLA-тест
    // фиксирует 2 (бит-идентичность от бюджета не зависит — контракт
    // [core/jobs.h], — фиксация держит машину теста незадушенной).
    void set_rebake_threads(int t) { rebakeThreads_ = t; }
    int rebake_threads() const { return rebakeThreads_; }

    bool baking() const { return running_; }
    // Живой граф пригоден для чтения. false между start_fresh и его свапом —
    // ровно когда толпа стоит. Во время Rebake остаётся true: stale-граф жив.
    bool ready() const { return !fine_.flow.empty(); }
    const nav::CoarseGraph& coarse() const { return coarse_; }
    const nav::FineNav& fine() const { return fine_; }

    // --- секция света (LightVisibility) -------------------------------------
    // Живой запечённый грид видимости и поколение мира, которое он отражает.
    // Свап поднимает lightGen_; карвы, пришедшие во время полёта бейка, лежат
    // в carvedSinceLight_ и запускают следующий цикл (приём bakedGen !=
    // worldGen — гонок «мутация во время бейка» нет по построению; GPU-буфер
    // dirtyGen грязной ветки вырезан чисткой 2026-08-23).
    const LightVisBake& light_vis() const { return lightVis_; }
    std::uint64_t light_gen() const { return lightGen_; }
    // true один раз после каждого свапа секции света (Fresh или Rebake) —
    // сигнал вызывающему перезалить bakedGrid на GPU.
    bool take_light_swap() {
        const bool f = lightSwapPending_;
        lightSwapPending_ = false;
        return f;
    }
    // true один раз после свапа ЧАСТИЧНОГО допекания (дельта-лампы,
    // carve-hitch.md инкремент 3): *cells — изменённые клетки светосетки,
    // отсортированы; заливать на GPU только их (upload_baked_cells). Список
    // может быть ПУСТ (карв в темноте) — заливка всё равно обязана поднять
    // genBaked, иначе грязные клетки шара остались бы на дорогом фоллбэке.
    bool take_light_patch(const std::vector<std::uint32_t>** cells) {
        if (!lightPatchPending_) return false;
        lightPatchPending_ = false;
        *cells = &patchChangedCells_;
        return true;
    }
    // Поколение мира, которое отражает живой граф. bakedGen != worldGen —
    // запечённое устарело, планировщик сам доведёт (SLA-тест ассертит это).
    std::uint64_t baked_gen() const { return bakedGen_; }
    // Сколько раз свет печёкся ПОЛНОСТЬЮ (Fresh + Rebake-full). Тест
    // гарантии №1: карв при неизменной таблице ламп НЕ двигает счётчик —
    // актуальность держат патчи, полный бейк живёт по смене таблицы/дедлайну.
    std::uint32_t light_full_bakes() const { return lightFullBakes_; }

    // Тайминги последнего завершённого бейка, для HUD и строк [rooms]/[nav] —
    // чтобы цена не превращалась в фольклор (тот же довод, что у AsyncBake).
    float last_rooms_ms() const { return roomsMs_; }
    float last_coarse_ms() const { return coarseMs_; }
    float last_fine_ms() const { return fineMs_; }

    // Всё, что объект держит СЕЙЧАС, по capacity (см. довод у AsyncBake:
    // ёмкость — то, что реально удерживает аллокатор). Живой fine + pending
    // fine — это и есть транзиентный пик ~+130 MiB во время Rebake, принятый
    // владельцем (план §9, ответ 3); печатается строкой [rebake] на свапе.
    std::size_t resident_bytes() const {
        return fine_.flow.capacity() + fine_.nearest.capacity() +
               pendingFine_.flow.capacity() + pendingFine_.nearest.capacity() +
               sizeof(nav::CoarseGraph) * 2 +
               (navBits_.words.capacity() + bodyBits_.words.capacity() +
                snapNav_.words.capacity() + snapBody_.words.capacity()) *
                   sizeof(std::uint64_t) +
               (shadowGrid_ ? shadowGrid_->masks().capacity() * sizeof(SubMask) +
                                  shadowGrid_->types().capacity() *
                                      sizeof(CellType)
                            : 0) +
               pendingRooms_.resident_bytes() + lightVis_.resident_bytes() +
               pendingLight_.resident_bytes() +
               (lampsLive_.capacity() + lampsSnap_.capacity()) *
                   sizeof(LightVisLamp) +
               (carvedSinceLight_.capacity() + carvedSnap_.capacity() +
                patchChangedCells_.capacity()) *
                   sizeof(std::uint32_t) +
               pendingPatch_.hits.capacity() * sizeof(LightVisPatch::Hit);
    }

private:
    enum class Mode : std::uint8_t { Idle, Fresh, Rebake, LightPatch };

    void join_worker();
    void discard_pending();
    void start_rebake(std::uint64_t simTick, std::uint64_t worldGen);
    void start_light_patch(std::uint64_t worldGen);
    void sync_shadow(); // O(1)-долив карвнутых клеток в теневую сетку

    // --- живая сторона: пишется только в step()/start_fresh на главном потоке
    nav::CoarseGraph coarse_{};
    nav::FineNav fine_{};
    WalkBits navBits_;  // живые открыто-сеты, патчатся дренажом карвов
    WalkBits bodyBits_;
    // Живая сетка этажа вызывающего — источник снапшота масок для секции
    // света (лучи бейка субвоксельные, S2; битсета им мало). Тот же контракт
    // жизни, что у rooms_: живёт, пока жив этаж; читается ТОЛЬКО на главном
    // потоке в start_fresh/start_rebake.
    const MacroGrid* liveGrid_ = nullptr;
    LightVisBake lightVis_; // живой запечённый грид видимости
    std::vector<LightVisLamp> lampsLive_; // статик-таблица (индекс = слот id)
    std::uint32_t lightSlots_ = 0;
    std::uint32_t lightClusterBase_ = 0; // верхний регион таблицы (light-cluster.md)
    std::uint64_t lightGen_ = 0;
    bool lightSwapPending_ = false;
    bool lightPatchPending_ = false;
    // Поколение СОСТАВА таблицы ламп (растёт в set_light_table) против
    // поколения, которое отражает последний ПОЛНЫЙ бейк света. Пока таблица
    // не менялась, патчи держат списки истинными по построению (добавки +
    // чистота rays_one_lamp) — полному бейку в цикле нечего добавить, кроме
    // формы (top-K-хвосты при переливе, вычистка надгробий), и он печётся
    // только на смене таблицы или по дедлайну (страховка формы).
    std::uint64_t lightTableGen_ = 1;
    std::uint64_t lightTableBakedGen_ = 0;
    std::uint64_t lightTableGenSnap_ = 0; // состав на старте цикла
    bool cycleLightFull_ = false; // свет этого Rebake-цикла: полный или патч
    std::uint32_t lightFullBakes_ = 0; // счётчик полных бейков (тест #1)
    std::vector<std::uint32_t> patchChangedCells_; // выход последнего патча
    // Карвнутые макроклетки с последнего свапа света — вход дельта-лампового
    // патча. Копятся в patch_carved_cells (тот же дренаж CarveResult, что у
    // битсетов); на старте патча/полного цикла уезжают в carvedSnap_, на
    // отмене возвращаются (иначе клетки навсегда остались бы грязными на GPU).
    std::vector<std::uint32_t> carvedSinceLight_;
    std::vector<std::uint32_t> carvedSnap_;
    RoomZones* rooms_ = nullptr; // живые поля комнат вызывающего
    FloorKind kind_ = FloorKind::Residential;
    int floorNumber_ = 0;

    // --- сторона воркера: его собственность на время полёта -----------------
    nav::CoarseGraph pendingCoarse_{};
    nav::FineNav pendingFine_{};
    RoomZones pendingRooms_{};
    LightVisBake pendingLight_{};
    WalkBits snapNav_;  // снапшот по значению (2×256 KiB, ~75 мкс)
    WalkBits snapBody_;
    // ТЕНЕВАЯ копия масок+типов для света (проблема 59.21): ~134 МиБ
    // РЕЗИДЕНТНО («памяти щедро» — решение владельца), копируется ОДИН раз на
    // входе этажа и дальше правится O(1) на карв (sync_shadow из копилки
    // carvedSinceLight_ перед каждым стартом воркера) — копия мира на главном
    // потоке на каждый цикл (15-40 мс = 1-3 кадра) мертва. Двери в тени
    // остаются как на входе — ВСЕ ОТКРЫТЫ: та же премиса all-open, что у
    // nav-битсетов, ошибка — «посветить лишним» сквозь проём (реальную тень
    // от закрытой двери всё равно кладёт попиксельный DDA-марш по живому
    // зеркалу). unique_ptr, а не член по значению: MacroGrid() плотный и
    // держал бы 134 МиБ даже у пустого планировщика.
    std::unique_ptr<MacroGrid> shadowGrid_;
    std::vector<LightVisLamp> lampsSnap_;
    LightVisPatch pendingPatch_; // выход воркера дельта-патча

    std::thread worker_;
    std::atomic<bool> cancel_{false};
    // release-store воркера / acquire-load step() — посекционная передача.
    std::atomic<bool> lightDone_{false};
    std::atomic<bool> roomsDone_{false};
    std::atomic<bool> coarseDone_{false};
    std::atomic<bool> exited_{false};
    bool running_ = false;
    Mode mode_ = Mode::Idle;
    bool lightSwapped_ = false;
    bool roomsSwapped_ = false;
    bool coarseSwapped_ = false;

    // --- планировщик (все часы — сим-тики) ----------------------------------
    std::uint64_t bakedGen_ = 0;    // что отражает живой граф
    std::uint64_t snapGen_ = 0;     // что отражает снапшот в полёте
    std::uint64_t lastSeenGen_ = 0; // летопись мутаций
    std::uint64_t lastMutTick_ = 0;
    std::uint64_t firstDirtyTick_ = 0;
    bool haveDirty_ = false;
    std::uint64_t lastStartTick_ = 0;
    std::uint64_t lastRebakeDurTicks_ = 0; // замер = мин-интервал
    int rebakeThreads_;

    float roomsMs_ = 0.0f;
    float coarseMs_ = 0.0f;
    float fineMs_ = 0.0f;
    float snapCopyMs_ = 0.0f; // O(1)-долив тени на главном потоке (59.21)
};

} // namespace giga::game
