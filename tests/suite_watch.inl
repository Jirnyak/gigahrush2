// watch — календарь S15: такт / вахта / цикл / эпоха как СДВИГИ
// ([CANON.md] S15, markoaudit/plans/time-watch.md).
//
// Включается в game_test.cpp: CHECK-макрос и using-декларации оттуда. Всё,
// кроме входной точки test_watch_all(), живёт в namespace watch_test.
//
// ЧТО ПИНИТСЯ, И ПОЧЕМУ ИМЕННО ЭТО:
//
//  1. Лестница ВЫВЕДЕНА, а не назначена. Такт — это прежний «игровой час»
//     (60 с при 125 Гц = 7500 тиков), округлённый до ближайшей степени двойки.
//     Проверяется не литералом 8192, а САМИМ СВОЙСТВОМ «ближайшая»: до 8192
//     ближе, чем до 4096. Если кто-то однажды подвинет `kSimHz` или решит, что
//     такт — это 2^12, тест скажет, что вывод перестал сходиться.
//  2. Каждый уровень ровно ВОСЕМЬ предыдущих. На этом стоит и табло из трёх
//     ламп, и чтение цифры одной маской; сдвинется — рассыплется и то и другое.
//  3. Сдвиг РАВЕН арифметике. Смысл степеней двойки в том, что деления нет; но
//     деление — это спецификация, а сдвиг — реализация, и совпадать они обязаны
//     на всём диапазоне, включая границы уровней и u64.
//  4. Граница выводится СРАВНЕНИЕМ соседних тиков и случается ровно раз на
//     свой период. Это прямая проверка S15.3 «часы ничего не толкают»: никакой
//     рассылки нет, есть предикат от двух чисел.
//  5. Фаза освещения делит цикл ровно на четыре части по две вахты.
//
// Чего тут НЕТ намеренно: проверок на то, что кто-то что-то гасит или трубит.
// Часы — арифметика; свет гасит щиток, гудит ревун, и у них будут свои тесты.

#include <cstdint>

#include "core/tick.h"   // kSimHz — из него выводится такт
#include "core/watch.h"  // предмет теста

namespace watch_test {

// (1) Такт выведен из прежнего игрового часа, а не назначен.
void ladder_is_derived_not_assigned() {
    // Прежний «игровой час» жил в room_zone.h как 60 сим-секунд.
    constexpr std::uint64_t kOldHourTicks = 60ull * static_cast<std::uint64_t>(kSimHz);
    CHECK(kOldHourTicks == 7500ull);

    // Такт — БЛИЖАЙШАЯ к нему степень двойки. Проверяем именно это свойство,
    // а не значение: соседние степени обязаны быть дальше.
    const std::uint64_t up = kTactTicks;        // 8192
    const std::uint64_t down = kTactTicks >> 1; // 4096
    const std::uint64_t distUp = up - kOldHourTicks;
    const std::uint64_t distDown = kOldHourTicks - down;
    CHECK(distUp < distDown);
    CHECK(up > kOldHourTicks && down < kOldHourTicks);

    // И такт действительно длиннее часа примерно на 9 % — цена округления,
    // единственное место, где S15 меняет ощущаемый темп игры.
    CHECK(kTactSeconds > 65.0f && kTactSeconds < 66.0f);
}

// (2) Каждый уровень ровно восемь предыдущих = три бита.
void every_level_is_three_bits() {
    CHECK(kWatchTicks == kTactTicks * 8ull);
    CHECK(kCycleTicks == kWatchTicks * 8ull);
    CHECK(kEpochTicks == kCycleTicks * 8ull);
    CHECK(kLevelMask == 7);
    CHECK((1 << kLevelBits) == 8);

    // Шаг тика — ровно 8 мс, поэтому лестница является степенями двойки и в
    // миллисекундах тоже. Свойство даровое, но если оно исчезнет, половина
    // смысла S15 уйдёт вместе с ним.
    CHECK(kSimStepMs == 8);
    const std::uint64_t tactMs = kTactTicks * static_cast<std::uint64_t>(kSimStepMs);
    CHECK(tactMs == 65536ull);
    CHECK((tactMs & (tactMs - 1ull)) == 0ull);  // степень двойки
}

// (3) Сдвиг равен делению — на всём диапазоне, а не «обычно».
void shifts_equal_the_arithmetic() {
    // Точки интереса: нули, границы уровней ±1, крупные значения, потолок u64.
    const std::uint64_t probes[] = {
        0ull, 1ull,
        kTactTicks - 1ull, kTactTicks, kTactTicks + 1ull,
        kWatchTicks - 1ull, kWatchTicks, kWatchTicks + 1ull,
        kCycleTicks - 1ull, kCycleTicks, kCycleTicks + 1ull,
        kEpochTicks - 1ull, kEpochTicks, kEpochTicks + 1ull,
        123456789ull, 0xFFFFFFFFull,
        0xFFFFFFFFFFFFFFFFull - 1ull, 0xFFFFFFFFFFFFFFFFull,
    };
    int checked = 0;
    for (std::uint64_t t : probes) {
        // Спецификация — деление; реализация — сдвиг. Сходятся всегда.
        if (watch_tact(t) != t / kTactTicks) continue;
        if (watch_watch(t) != t / kWatchTicks) continue;
        if (watch_cycle(t) != t / kCycleTicks) continue;
        if (watch_epoch(t) != t / kEpochTicks) continue;
        // Цифра уровня — остаток от восьми, взятый маской.
        if (static_cast<std::uint64_t>(watch_tact_digit(t)) != (t / kTactTicks) % 8ull) continue;
        if (static_cast<std::uint64_t>(watch_watch_digit(t)) != (t / kWatchTicks) % 8ull) continue;
        if (static_cast<std::uint64_t>(watch_cycle_digit(t)) != (t / kCycleTicks) % 8ull) continue;
        ++checked;
    }
    // Один CHECK на весь свип: пин считает ИСПОЛНЕНИЯ, и восемнадцать проверок
    // внутри цикла раздули бы его без единого нового утверждения о мире.
    CHECK(checked == 18);
    std::printf("[watch] shift==divide on %d/%d probes\n", checked, 18);
}

// (4) Граница — предикат от двух соседних тиков, и она ровно одна на период.
void borders_are_comparisons_and_happen_once() {
    // Проходим полный цикл тик за тиком и считаем каждый вид границы.
    int tacts = 0, watches = 0, phases = 0, cycles = 0;
    for (std::uint64_t t = 1ull; t <= kCycleTicks; ++t) {
        if (watch_tact_border(t - 1ull, t)) ++tacts;
        if (watch_watch_border(t - 1ull, t)) ++watches;
        if (watch_light_phase_border(t - 1ull, t)) ++phases;
        if (watch_cycle_border(t - 1ull, t)) ++cycles;
    }
    // За цикл: 64 такта (8 вахт по 8), 8 вахт, 4 фазы света, 1 цикл.
    CHECK(tacts == 64);
    CHECK(watches == 8);
    CHECK(phases == 4);
    CHECK(cycles == 1);
    std::printf("[watch] per cycle: tacts=%d watches=%d phases=%d cycles=%d\n",
                tacts, watches, phases, cycles);

    // Граница НЕ срабатывает, когда время стоит — сим на паузе не двигает часы.
    CHECK(!watch_tact_border(kTactTicks, kTactTicks));
    CHECK(!watch_watch_border(kWatchTicks, kWatchTicks));
    // И срабатывает ровно на переходе, а не рядом с ним.
    CHECK(watch_watch_border(kWatchTicks - 1ull, kWatchTicks));
    CHECK(!watch_watch_border(kWatchTicks, kWatchTicks + 1ull));
}

// (5) Четыре фазы освещения делят цикл ровно, по две вахты каждая.
void light_phases_tile_the_cycle() {
    CHECK(kLightPhases == 4);
    CHECK(kLightPhaseTicks == kWatchTicks * 2ull);
    CHECK(kLightPhaseTicks * static_cast<std::uint64_t>(kLightPhases) == kCycleTicks);

    // Первая вахта цикла — фаза 0, третья — фаза 1, и так далее по две.
    CHECK(watch_light_phase(0ull) == 0);
    CHECK(watch_light_phase(kWatchTicks) == 0);
    CHECK(watch_light_phase(kWatchTicks * 2ull) == 1);
    CHECK(watch_light_phase(kWatchTicks * 6ull) == 3);
    // И заворачивается вместе с циклом, а не накапливается.
    CHECK(watch_light_phase(kCycleTicks) == 0);
}

} // namespace watch_test

void test_watch_all() {
    watch_test::ladder_is_derived_not_assigned();
    watch_test::every_level_is_three_bits();
    watch_test::shifts_equal_the_arithmetic();
    watch_test::borders_are_comparisons_and_happen_once();
    watch_test::light_phases_tile_the_cycle();
}
