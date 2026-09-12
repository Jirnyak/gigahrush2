// surface_lib.glsl — ОБЩИЕ шумовые/поверхностные примитивы шейдеров.
// Родились дедупом аудита 2026-08-25 (К5): hash21/vnoise/grain/mottle/
// resolved жили ТРЕМЯ дословными копиями (cube/raymarch/prop) — cube
// похудел до шейдера тел, канон отсюда, копий больше нет. hash21 —
// НЕ sin-хеш намеренно: у sin-хеша известные артефакты точности на части
// драйверов (диагональный муар). Сюда же — единая полусферная ambient
// (дрейф копий давал пропам 4x яркость стен без обоснования) и вывод
// спекуляра из шершавости (жил четырьмя копиями).
#ifndef GIGA_SURFACE_LIB
#define GIGA_SURFACE_LIB

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float grain(vec2 uv) {
    return vnoise(uv * 26.0) * 0.62 + vnoise(uv * 97.0) * 0.38;
}

float mottle(float sigma, float n) {
    return exp(sigma * n - 0.5 * sigma * sigma);
}

float resolved(float px, float freq) {
    return clamp(1.0 - px * freq * 2.2, 0.0, 1.0);
}

// Полусферная ambient: чуть светлее и холоднее сверху. «Верх» = +Z мира —
// рендер-локальная эстетика, не утверждение о гравитации (та — вектор в
// симе). Единственные числа ambient в дереве: стены, тела и пропы обязаны
// жить в одной шкале (дрейф копии — как пропы в 4x — теперь невозможен).
vec3 hemi_ambient(vec3 n, float scale) {
    float hemi = 0.5 + 0.5 * n.z;
    return scale * mix(vec3(0.025, 0.022, 0.018),
                       vec3(0.055, 0.048, 0.040), hemi);
}

// Вывод спекуляра из шершавости — одна формула на всех (жила 4 копиями).
void spec_terms(float roughness, out float specPow, out float specIntensity) {
    specPow = max(2.0 / (roughness * roughness * roughness * roughness + 1e-4)
                      - 2.0,
                  1.0);
    specIntensity = (1.0 - roughness) * 0.25;
}

#endif // GIGA_SURFACE_LIB
