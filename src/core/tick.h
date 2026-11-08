// The sim tick rate, in one place because more than one place needs it.
//
// It used to live in `main.cpp`'s anonymous namespace, which meant no test could
// reference it — and an audit test duly defined its own `1/120` and went on measuring a
// rate the game no longer ran at. **A timing constant the tests cannot see is a timing
// constant that will drift away from them**, silently, and the drift shows up as tests
// that pass while the game is wrong or fail while the game is right.
#pragma once

#include <cstdint>

namespace giga {

// **125 Hz, and the reason is arithmetic rather than preference.**
//
// Every timer in this game is integer milliseconds, advanced by
// `static_cast<uint16_t>(dt * 1000.0f + 0.5f)`. At 1/120 that is `8.333 + 0.5 = 8.833`,
// truncated to **8** — so a second of sim time took 125 ticks instead of 120, and EVERY
// cooldown, reload, windup, telegraph and samosbor phase ran **4.17% slow**. Measured: a
// 1000 ms mob cooldown cleared after 1.0417 s, and a 30 s samosbor warning opened after
// 31.250 s. Not a rounding curiosity — a systematic stretch of every authored duration
// in the game, in the same direction, forever.
//
// At 1/125 the step is exactly 8 ms, the conversion is lossless, and an authored
// duration means what it says. Nothing else had to change: every rate in the sim is
// per-second and multiplied by dt, and the identity-hash stagger keys off tick counts
// rather than wall time.
inline constexpr int kSimHz = 125;
inline constexpr float kSimDt = 1.0f / static_cast<float>(kSimHz);

// Milliseconds one tick advances an integer timer. Exact at 125 Hz, which is the point.
inline constexpr int kSimStepMs = 1000 / kSimHz;
static_assert(kSimStepMs * kSimHz == 1000,
              "the tick must divide a second exactly, or every integer-millisecond "
              "timer in the game runs slow");

// АВТОРСКИЕ МИЛЛИСЕКУНДЫ -> ТИКИ, ОДНА ДВЕРЬ (CANON S22: одна единица времени
// на всё дерево — тик; миллисекунды остаются в строках данных, которые их
// авторят).
//
// ОКРУГЛЕНИЕ ВВЕРХ, И ЭТО ЗАМЕР, А НЕ ВКУС. Декрементный счётчик, который эта
// функция заменяет, вычитал ровно `kSimStepMs` за тик и считался занятым, пока
// остаток больше нуля, — то есть занимал `ceil(ms / 8)` тиков. Любое другое
// округление сдвинуло бы темп КАЖДОГО оружия и моба на полтика относительно
// авторской строки: 340 мс (кулак) — 43 тика вверх против 42 к ближайшему, и
// это 2.3 % скорости удара на пустом месте. Поэтому вверх: свод пяти таймеров в
// одно поле обязан быть бит-в-бит, иначе он не свод, а балансная правка.
inline constexpr std::uint32_t ms_to_ticks(std::uint32_t ms) {
    return (ms + static_cast<std::uint32_t>(kSimStepMs) - 1u) /
           static_cast<std::uint32_t>(kSimStepMs);
}

} // namespace giga
