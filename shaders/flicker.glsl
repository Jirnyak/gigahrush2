#ifndef FLICKER_GLSL
#define FLICKER_GLSL

// flicker.glsl — ЕДИНАЯ функция мерцания источников ([ddalight.md]).
//
// Чистая функция (профиль, позиция, время) → множитель яркости. Реализована
// ИДЕНТИЧНО в src/game/flicker.h: CPU применяет её к ИНТЕНСИВНОСТИ СВЕТА
// (collect_scene_lights), GPU — к EMISSIVE поверхности (prop.frag), поэтому
// плафон и свет одного носителя пульсируют СИНХРОННО ПО ПОСТРОЕНИЮ — без
// каналов данных, просто одна математика от одних аргументов.
//
// Профиль — колонка `flicker` таблицы носителя (data/props.csv), никаких
// веток по mat_id или порогам emissive (умерший зоопарк Case A-D).
//   0 none  — ровный
//   1 mains — хрущёвская сеть: медленный синус ±18% + редкие просадки −50%
//   2 arc   — электрический треск: стохастический флик 22 Гц + гул сети
//   3 pulse — органическое дыхание (биолюм)
//   4 crt   — для СВЕТА ровный; поверхностная анимация экрана — отдельно
//             (prop.frag), гаснет вместе с носителем.

float flicker_hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float flicker_factor(uint profile, vec3 pos, float t) {
    if (profile == 1u) { // mains
        float flick = sin(t * 12.0 + pos.x * 1.7 + pos.z * 2.3) * 0.18;
        float micro = fract(t * 47.0 + pos.x * 3.1 + pos.z * 5.7);
        return 1.0 + flick + (micro < 0.07 ? -0.50 : 0.0);
    }
    if (profile == 2u) { // arc
        float stepTime = floor(t * 22.0 + (pos.x + pos.z) * 3.0);
        float stoch = mix(1.0, step(0.20, flicker_hash11(stepTime)), 0.30);
        float hum = 1.0 + 0.06 * sin(t * 377.0 + pos.x);
        return stoch * hum;
    }
    if (profile == 3u) { // pulse
        return max(1.0 + 0.28 * sin(t * 2.2 + pos.x + pos.z) +
                       0.10 * cos(t * 4.3 + (pos.x + pos.z) * 1.7),
                   0.05);
    }
    return 1.0;
}

#endif // FLICKER_GLSL
