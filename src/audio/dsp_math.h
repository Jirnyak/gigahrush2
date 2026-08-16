// Pure inline DSP math functions and stateless primitives.
// Zero dynamic heap allocation, header-only, no exceptions, no RTTI.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include "audio/audio_types.h"

namespace giga::audio {

inline constexpr float kPi = 3.14159265358979323846f;
inline constexpr float kTwoPi = 6.28318530717958647692f;
inline constexpr float kHalfPi = 1.57079632679489661923f;

// ---------------------------------------------------------------------------
// Stateless PRNG: splitmix32
// ---------------------------------------------------------------------------
inline uint32_t splitmix32(uint32_t& state) {
    uint32_t z = (state += 0x9e3779b9u);
    z = (z ^ (z >> 16)) * 0x85ebca6bu;
    z = (z ^ (z >> 13)) * 0xc2b2ae35u;
    return z ^ (z >> 16);
}

inline float splitmix32_f01(uint32_t& state) {
    return static_cast<float>(splitmix32(state)) * (1.0f / 4294967296.0f);
}

inline float splitmix32_fsym(uint32_t& state) {
    return splitmix32_f01(state) * 2.0f - 1.0f;
}

// ---------------------------------------------------------------------------
// Soft Saturation & Master Limiting
// ---------------------------------------------------------------------------
inline float fast_tanh(float x) {
    if (x < -3.0f) return -1.0f;
    if (x > 3.0f) return 1.0f;
    float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}

inline float soft_clip(float x) {
    return fast_tanh(x);
}

inline float master_limiter(float x) {
    return std::tanh(x);
}

// ---------------------------------------------------------------------------
// Sine & Oscillator Utilities
// ---------------------------------------------------------------------------
inline float wrap_phase(float phase) {
    while (phase >= kTwoPi) phase -= kTwoPi;
    while (phase < 0.0f) phase += kTwoPi;
    return phase;
}

inline float fast_sin(float phase) {
    return std::sin(phase);
}

// ---------------------------------------------------------------------------
// 1-Pole IIR Lowpass Filter
// alpha = 1 - exp(-2*pi*fc/fs)
// y[n] = y[n-1] + alpha * (x[n] - y[n-1])
// ---------------------------------------------------------------------------
struct OnePoleLp {
    float z1 = 0.0f;
    float alpha = 1.0f;

    void set_cutoff(float cutoffHz, float sampleRate = kAudioSampleRate) {
        float fc = std::clamp(cutoffHz, 20.0f, sampleRate * 0.495f);
        alpha = 1.0f - std::exp(-kTwoPi * fc / sampleRate);
    }

    float process(float in) {
        z1 += alpha * (in - z1);
        return z1;
    }

    void reset(float initial = 0.0f) {
        z1 = initial;
    }
};

// ---------------------------------------------------------------------------
// 2nd-Order State Variable Filter (SVF - Andy Simper / Chamberlin topology)
// ---------------------------------------------------------------------------
struct StateVariableFilter {
    float ic1eq = 0.0f;
    float ic2eq = 0.0f;
    float g = 0.0f;
    float k = 0.0f;
    float a1 = 0.0f;
    float a2 = 0.0f;
    float a3 = 0.0f;

    void set_params(float cutoffHz, float q, float sampleRate = kAudioSampleRate) {
        float fc = std::clamp(cutoffHz, 20.0f, sampleRate * 0.495f);
        float qClamped = std::clamp(q, 0.1f, 30.0f);
        g = std::tan(kPi * fc / sampleRate);
        k = 1.0f / qClamped;
        a1 = 1.0f / (1.0f + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
    }

    void process(float in, float& lp, float& bp, float& hp, float& notch) {
        float v3 = in - ic2eq;
        float v1 = a1 * ic1eq + a2 * v3;
        float v2 = ic2eq + a2 * ic1eq + a3 * v3;
        ic1eq = 2.0f * v1 - ic1eq;
        ic2eq = 2.0f * v2 - ic2eq;

        lp = v2;
        bp = v1;
        hp = in - k * v1 - v2;
        notch = hp + lp;
    }

    float process_lp(float in) {
        float lp, bp, hp, notch;
        process(in, lp, bp, hp, notch);
        return lp;
    }

    float process_bp(float in) {
        float lp, bp, hp, notch;
        process(in, lp, bp, hp, notch);
        return bp;
    }

    float process_hp(float in) {
        float lp, bp, hp, notch;
        process(in, lp, bp, hp, notch);
        return hp;
    }

    void reset() {
        ic1eq = 0.0f;
        ic2eq = 0.0f;
    }
};

} // namespace giga::audio
