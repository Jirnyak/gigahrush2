// rebake — SLA-гейт фонового допекания (план async-rebake §7, фаза D).
//
// Включается в game_test.cpp: CHECK-макрос и using-декларации оттуда. Всё,
// кроме входной точки test_rebake_all(), живёт в namespace rebake_test.
//
// Что пинится, и почему только это:
//
//   1. SLA: после карва, пробившего стену, свап фонового ребейка происходит
//      не позже kRebakeCeilTicks (8192 тиков = 65.5 с — «порядка минуты»
//      владельца). Часы — СИМ-ТИКИ, спроецированные из wall-clock (8 мс = 1
//      тик): headless-тест и есть тот случай, ради которого SLA выражен в
//      тиках, а бейк-воркер живёт в реальном времени — проекция честно
//      связывает обе шкалы.
//   2. После свапа поле ЗНАЕТ пролом: nearest/flow покрывают срезанную клетку.
//   3. До свапа stale-чтения живы: старое поле зовёт клетку солидной (не
//      мусор и не падение), обычные маршруты отвечают по контракту.
//
// Бит-идентичность оракула (бейк по битсетам == бейк по гриду) уже запинена
// suite_walkbits.inl — здесь НЕ дублируется (план §7, прямое указание).
//
// threads=2 фиксированно: бит-идентичность от бюджета не зависит (контракт
// [core/jobs.h]), а фиксация держит машину теста незадушенной и делает
// длительность прогона воспроизводимой. Это самый долгий сьют game_test —
// ровно потому, что он меряет НАСТОЯЩИЙ фоновый бейк на настоящем этаже;
// мок здесь мерил бы только самого себя.
#include <chrono>
#include <thread>

#include "game/floor_gen.h"   // generate_floor — настоящий этаж, не игрушка
#include "game/floor_spec.h"  // FloorKind, floor_spec
#include "game/rebake.h"      // RebakeScheduler — предмет теста
#include "world/macro_grid.h" // clear_cell — «карв» пробивает стену
#include "world/nav.h"        // route_step, kFlowNone
#include "world/types.h"      // kMacroDim, kMacroCells, wrap_macro
#include "world/world.h"

namespace rebake_test {

// Проекция wall-clock -> сим-тики: 1 тик = 8 мс ([core/tick.h] — 125 Гц).
// Тест гоняет планировщик так, как его гоняет кадровый цикл: часы идут, пока
// воркер печёт в реальном времени.
struct TickClock {
    std::chrono::steady_clock::time_point t0 =
        std::chrono::steady_clock::now();
    std::uint64_t now() const {
        return static_cast<std::uint64_t>(
                   std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::steady_clock::now() - t0)
                       .count()) /
               8u;
    }
};

void sla_holds_on_a_real_floor() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);

    RebakeScheduler s;
    s.set_rebake_threads(2);

    TickClock clock;
    std::uint64_t gen = 0;

    // Ёмкость клетки светосетки — ДО start_fresh (как в main): без неё
    // stride=1 и дельта-патчу некуда дописывать (проверяется ниже).
    s.set_light_table(nullptr, 0, 63, 1);

    // --- Fresh: текущая семантика входа на этаж --------------------------
    s.start_fresh(w.grid(), FloorKind::Residential, 0, gen);
    CHECK(s.baking());
    CHECK(!s.ready());    // живой граф освобождён — толпа стояла бы, не блуждала

    bool freshSwap = false;
    // Страховочный потолок 16384 тиков (~131 с wall) — чтобы сломанный свап
    // давал КРАСНЫЙ CHECK, а не вечный цикл.
    while (!freshSwap && clock.now() < 16384u) {
        freshSwap = s.step(clock.now(), gen);
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    CHECK(freshSwap); // ровно кадр Fresh-свапа — сигнал finish_floor_nav
    CHECK(s.ready());
    // ТЕГ СОСТАВА (находка №2 аудита 2026-08-23): Fresh пёкся с таблицы
    // тега 1 — ровно он и отражён; свежая смена таблицы (тег 2 ниже, у
    // лампы) НЕ двигает baked_tag до следующего ПОЛНОГО бейка: переработка
    // мёртвых слотов обязана ждать списков, которые их забыли.
    CHECK(s.light_table_baked_tag() == 1);

    // --- Выбрать стену: полностью солидная клетка с nav-открытым соседом,
    // которого старое поле уже знает (иначе пролом вёл бы в закрытую пустоту
    // и «поле знает пролом» было бы недоказуемо).
    const auto& masks = w.grid().masks();
    int target = -1;
    int nbx = 0, nby = 0, nbz = 0;
    for (std::size_t i = 0; i < kMacroCells && target < 0; ++i) {
        if (!masks[i].full()) continue;
        const int x = static_cast<int>(i % kMacroDim);
        const int y = static_cast<int>((i / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(i / (kMacroDim * kMacroDim));
        for (int d = 0; d < 6 && target < 0; ++d) {
            const int nx = wrap_macro(x + nav::kNavDir[d][0]);
            const int ny = wrap_macro(y + nav::kNavDir[d][1]);
            const int nz = wrap_macro(z + nav::kNavDir[d][2]);
            if (s.fine().nearest_node(nx, ny, nz) != nav::kFlowNone) {
                target = static_cast<int>(i);
                nbx = nx;
                nby = ny;
                nbz = nz;
            }
        }
    }
    CHECK(target >= 0);
    const int tx = target % kMacroDim;
    const int ty = (target / kMacroDim) % kMacroDim;
    const int tz = target / (kMacroDim * kMacroDim);

    // Запечённое поле зовёт стену стеной — исходная истина.
    CHECK(s.fine().nearest_node(tx, ty, tz) == nav::kFlowNone);

    // --- Карв пробивает стену: клетка в воздух + O(1)-патч битсетов +
    // поколение мутаций — ровно то, что делает дренаж dirtyCells в main.
    w.grid().clear_cell(tx, ty, tz);
    const std::uint32_t dirty[] = {static_cast<std::uint32_t>(target)};
    s.patch_carved_cells(w.grid(), dirty, 1);
    ++gen;
    const std::uint64_t carveTick = clock.now();

    // --- До свапа: stale-чтения живы (план §7в). Поле СТАРОЕ и честно
    // старое: пролом для него солиден, маршруты по прежней геометрии отвечают
    // по контракту, ничего не падает.
    s.step(clock.now(), gen);
    CHECK(s.baked_gen() == 0);
    CHECK(s.fine().nearest_node(tx, ty, tz) == nav::kFlowNone);
    const std::uint8_t staleStep = nav::route_step(
        s.coarse(), s.fine(), ivec3{nbx, nby, nbz}, ivec3{tx, ty, tz});
    CHECK(staleStep == nav::kFlowNone); // цель в (старой) стене — «нет пути»

    // --- Крутить планировщик тиками до свапа; потолок — SLA (план §7а).
    std::uint64_t swapTick = 0;
    for (;;) {
        const std::uint64_t t = clock.now();
        s.step(t, gen);
        if (s.baked_gen() == gen) {
            swapTick = t;
            break;
        }
        // Страховка от вечного цикла: даём 2x потолка, ассерт ниже краснеет.
        if (t - carveTick > 2u * RebakeScheduler::kRebakeCeilTicks) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    CHECK(s.baked_gen() == gen); // свап случился
    CHECK(swapTick - carveTick <= RebakeScheduler::kRebakeCeilTicks);

    // --- После свапа: поле ведёт в проём (план §7б).
    const std::uint8_t node = s.fine().nearest_node(tx, ty, tz);
    CHECK(node != nav::kFlowNone); // пролом присвоен якорю
    CHECK(s.fine().at(node, tx, ty, tz) != nav::kFlowNone); // и покрыт полем
    const std::uint8_t freshStep = nav::route_step(
        s.coarse(), s.fine(), ivec3{nbx, nby, nbz}, ivec3{tx, ty, tz});
    CHECK(freshStep != nav::kFlowNone); // маршрут в проём существует
    // Секция rooms умерла (rooms-object F); свап нава проверен выше.

    // --- Дельта-патч света (carve-hitch.md §3): дешёвый цикл обгоняет
    // полный, а полный всё равно приходит. Часы те же — сим-тики.
    {
        // Дренаж возможного патча первой фазы (0 ламп — пустой, но флаг
        // взводился): take одноразовый, начинаем с чистого.
        const std::vector<std::uint32_t>* drain = nullptr;
        (void)s.take_light_patch(&drain);

        // Лампа в проёме первого карва; стена в её радиусе — вторая цель.
        giga::game::LightVisLamp lamp;
        lamp.pos = vec3{(static_cast<float>(nbx) + 0.5f) * kCellSize,
                        (static_cast<float>(nby) + 0.5f) * kCellSize,
                        (static_cast<float>(nbz) + 0.5f) * kCellSize};
        lamp.radiusM = 8.0f;
        s.set_light_table(&lamp, 1, 63, 2);
        // ±2 клетки: худшая диагональ 6.9 м < охвата лампы 8+1.7 м — вторая
        // стена гарантированно в зоне затронутости.
        int target2 = -1;
        for (int dz = -2; dz <= 2 && target2 < 0; ++dz)
            for (int dy = -2; dy <= 2 && target2 < 0; ++dy)
                for (int dx = -2; dx <= 2 && target2 < 0; ++dx) {
                    const int cx = wrap_macro(nbx + dx);
                    const int cy = wrap_macro(nby + dy);
                    const int cz = wrap_macro(nbz + dz);
                    const std::size_t ci = macro_index(cx, cy, cz);
                    if (w.grid().masks()[ci].full())
                        target2 = static_cast<int>(ci);
                }
        CHECK(target2 >= 0); // стена рядом с проёмом обязана найтись
        w.grid().clear_cell(target2 % kMacroDim,
                            (target2 / kMacroDim) % kMacroDim,
                            target2 / (kMacroDim * kMacroDim));
        const std::uint32_t dirty2[] = {static_cast<std::uint32_t>(target2)};
        s.patch_carved_cells(w.grid(), dirty2, 1);
        ++gen;
        const std::uint64_t carve2 = clock.now();

        // Патч обязан свапнуться ДО того, как полный цикл вообще стартует
        // (его дебаунс kRebakeQuietTicks) — иначе он не ужимает окно ничем.
        const std::vector<std::uint32_t>* patched = nullptr;
        std::uint64_t patchTick = 0;
        for (;;) {
            const std::uint64_t t = clock.now();
            s.step(t, gen);
            if (s.take_light_patch(&patched)) {
                patchTick = t;
                break;
            }
            if (t - carve2 > RebakeScheduler::kRebakeQuietTicks) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CHECK(patched != nullptr);
        CHECK(patchTick - carve2 <= RebakeScheduler::kRebakeQuietTicks);
        CHECK(!patched->empty());        // лампа увидела вторую дыру
        CHECK(s.light_gen() == gen);     // свет актуален патчем...
        CHECK(s.baked_gen() < gen);      // ...а нав ещё ждёт полного цикла

        // Полный цикл патчем не отменён: bakedGen доводится как раньше.
        for (;;) {
            const std::uint64_t t = clock.now();
            s.step(t, gen);
            if (s.baked_gen() == gen) break;
            if (t - carve2 > 2u * RebakeScheduler::kRebakeCeilTicks) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CHECK(s.baked_gen() == gen);
        // Смена таблицы (тег 2) созрела полным циклом — baked_tag догнал
        // состав ровно на свапе полного бейка, не раньше.
        CHECK(s.light_table_baked_tag() == 2);

        // --- Гарантия №1 (carve-hitch.md): карв при НЕИЗМЕННОЙ таблице ламп
        // не запускает полный бейк света — актуальность держат патчи
        // (одиночный или патч-в-цикле), счётчик полных бейков СТОИТ, при
        // этом lightGen всё равно доводится до текущего поколения.
        const std::uint32_t fullBakes = s.light_full_bakes();
        int target3 = -1;
        for (int dz = -2; dz <= 2 && target3 < 0; ++dz)
            for (int dy = -2; dy <= 2 && target3 < 0; ++dy)
                for (int dx = -2; dx <= 2 && target3 < 0; ++dx) {
                    const int cx = wrap_macro(nbx + dx);
                    const int cy = wrap_macro(nby + dy);
                    const int cz = wrap_macro(nbz + dz);
                    const std::size_t ci = macro_index(cx, cy, cz);
                    if (w.grid().masks()[ci].full())
                        target3 = static_cast<int>(ci);
                }
        CHECK(target3 >= 0);
        w.grid().clear_cell(target3 % kMacroDim,
                            (target3 / kMacroDim) % kMacroDim,
                            target3 / (kMacroDim * kMacroDim));
        const std::uint32_t dirty3[] = {static_cast<std::uint32_t>(target3)};
        s.patch_carved_cells(w.grid(), dirty3, 1);
        ++gen;
        const std::uint64_t carve3 = clock.now();
        for (;;) {
            const std::uint64_t t = clock.now();
            s.step(t, gen);
            if (s.light_gen() == gen && s.baked_gen() == gen) break;
            if (t - carve3 > 2u * RebakeScheduler::kRebakeCeilTicks) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CHECK(s.light_gen() == gen);              // свет актуален...
        CHECK(s.baked_gen() == gen);              // ...нав доведён...
        CHECK(s.light_full_bakes() == fullBakes); // ...без полного бейка света

        // --- Находка №2 аудита 2026-08-23 (гонка состава): таблица меняется,
        // ПОКА полный бейк в полёте — свап обязан отразить СНАПШОТНЫЙ тег
        // (состав, который бейк видел), не текущий: текущий переработал бы
        // слот лампы, на которую только что легшие списки ещё ссылаются, и
        // клетки светили бы чужой лампой до следующего полного бейка.
        s.set_light_table(&lamp, 1, 63, 3); // смена состава → цикл будет полным
        ++gen; // мутация мира без карва: патч невозможен (карв-долга нет)
        const std::uint64_t race0 = clock.now();
        while (!s.baking() &&
               clock.now() - race0 < 4u * RebakeScheduler::kRebakeCeilTicks) {
            s.step(clock.now(), gen);
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CHECK(s.baking()); // полный цикл в полёте, снапшот тега 3 снят
        s.set_light_table(&lamp, 1, 63, 4); // состав сменился во время полёта
        for (;;) {
            const std::uint64_t t = clock.now();
            s.step(t, gen);
            if (s.baked_gen() == gen) break;
            if (t - race0 > 6u * RebakeScheduler::kRebakeCeilTicks) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CHECK(s.baked_gen() == gen);
        CHECK(s.light_table_baked_tag() == 3); // снапшот, не текущий тег 4
    }
}

} // namespace rebake_test

void test_rebake_all() { rebake_test::sla_holds_on_a_real_floor(); }
