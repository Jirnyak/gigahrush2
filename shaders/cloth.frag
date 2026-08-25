#version 450
// cloth.frag — worn canvas: direct light from the light grid off the sheet's
// own normal (two-sided |cos|), fog to black.
//
// ДОЛГ S5 ЗАКРЫТ 2026-08-21 (см. wire.frag): второй дескрипторный сет, те же
// лампы и кластеры, что у стен; тени тонкой декорации не маршатся
// (dressing_light). `lam` от fill остался формой на бессветье.

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl"

layout(location = 0) in float vFog;
layout(location = 1) in vec3 vWorldPos;
layout(location = 2) in vec3 vNormal;
layout(location = 0) out vec4 outColor;

void main() {
    const vec3 canvas = vec3(0.26, 0.23, 0.18);
    vec3 N = normalize(vNormal);
    // Ламберт от «солнца» вырезан 2026-08-25 — солнца нет (S15): ткань
    // освещают лампы (dressing_light) + плоский ambient.
    vec3 irr = dressing_light(vWorldPos, N, 1.0, pc.torus.x);
    vec3 lit = canvas * (pc.fog.w + irr);
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
