// flicker.h — ЕДИНАЯ функция мерцания источников ([ddalight.md]).
//
// ЗЕРКАЛО shaders/flicker.glsl — формулы обязаны совпадать строка в строку:
// CPU применяет её к ИНТЕНСИВНОСТИ СВЕТА (collect_scene_lights), GPU — к
// EMISSIVE поверхности (prop.frag), и синхронность плафона со светом держится
// именно идентичностью чистой функции от (профиль, позиция, время).
//
// Профиль — колонка `flicker` в data/props.csv (FlickerProfile ordinal).
#pragma once

#include <cmath>
#include <cstdint>

#include "core/math.h"

namespace giga::game {

enum class FlickerProfile : std::uint8_t {
    None  = 0, // ровный
    Mains = 1, // хрущёвская сеть: синус ±18% + редкие просадки −50%
    Arc   = 2, // электрический треск: стохастика 22 Гц + гул
    Pulse = 3, // органическое дыхание
    Crt   = 4, // свет ровный; анимация экрана — поверхностная (prop.frag)
};

inline float flicker_hash11(float p) {
    p = p * 0.1031f;
    p -= std::floor(p);
    p *= p + 33.33f;
    p *= p + p;
    return p - std::floor(p);
}

inline float flicker_factor(FlickerProfile profile, const vec3& pos, float t) {
    switch (profile) {
        case FlickerProfile::Mains: {
            const float flick =
                std::sin(t * 12.0f + pos.x * 1.7f + pos.z * 2.3f) * 0.18f;
            const float micro =
                std::fmod(t * 47.0f + pos.x * 3.1f + pos.z * 5.7f, 1.0f);
            return 1.0f + flick + (micro < 0.07f ? -0.50f : 0.0f);
        }
        case FlickerProfile::Arc: {
            const float stepTime =
                std::floor(t * 22.0f + (pos.x + pos.z) * 3.0f);
            const float stoch =
                1.0f + ((flicker_hash11(stepTime) >= 0.20f ? 1.0f : 0.0f) - 1.0f) * 0.30f;
            const float hum = 1.0f + 0.06f * std::sin(t * 377.0f + pos.x);
            return stoch * hum;
        }
        case FlickerProfile::Pulse: {
            const float b = 1.0f + 0.28f * std::sin(t * 2.2f + pos.x + pos.z) +
                            0.10f * std::cos(t * 4.3f + (pos.x + pos.z) * 1.7f);
            return b > 0.05f ? b : 0.05f;
        }
        default:
            return 1.0f;
    }
}

} // namespace giga::game
