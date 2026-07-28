// The sim tick rate, in one place because more than one place needs it.
//
// It used to live in `main.cpp`'s anonymous namespace, which meant no test could
// reference it — and an audit test duly defined its own `1/120` and went on measuring a
// rate the game no longer ran at. **A timing constant the tests cannot see is a timing
// constant that will drift away from them**, silently, and the drift shows up as tests
// that pass while the game is wrong or fail while the game is right.
#pragma once

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

} // namespace giga
