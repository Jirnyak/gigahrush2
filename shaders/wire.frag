#version 450
// wire.frag — a dark rubber cable: direct light from the light grid, fog to
// black. Deliberately tiny: a 1-2 px line needs no material system.
//
// ДОЛГ S5 ЗАКРЫТ 2026-08-21: verlet_pass подключён вторым дескрипторным
// сетом к световой сетке, трос освещают те же лампы и кластеры, что стены.
// Тени тонкой декорации не маршатся (dressing_light — вывод там же); форма
// цилиндра — среднее max(cosθ,0) по окружности = 1/π ≈ 0.318.

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl"

layout(location = 0) in float vFog;
layout(location = 1) in vec3 vWorldPos;
layout(location = 0) out vec4 outColor;

void main() {
    const vec3 cable = vec3(0.16, 0.14, 0.12);
    const float kCylinderAvg = 0.318; // 1/π
    vec3 irr = dressing_light(vWorldPos, vec3(0.0), 0.0, pc.torus.x);
    vec3 lit = cable * (pc.fog.w + irr * kCylinderAvg);
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
