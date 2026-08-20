#version 450
// cloth.frag — worn canvas: flat colour with a soft lambert off the sheet's
// own normal, ambient only, fog to black. Two-sided (abs on the lambert).
//
// ПРЯМОГО СВЕТА НЕТ — см. тот же долг в [wire.frag]: налобник убит (владелец
// 2026-08-20, S5), а световая сетка этому пассу недоступна — layout с одним
// дескрипторным сетом ([verlet_pass.cpp:213-214]). `lam` ниже — не источник, а
// модулятор по направлению fill: он ФОРМА, а не яркость.

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

layout(location = 0) in float vFog;
layout(location = 1) in vec3 vWorldPos;
layout(location = 2) in vec3 vNormal;
layout(location = 0) out vec4 outColor;

void main() {
    const vec3 canvas = vec3(0.26, 0.23, 0.18);
    float lam = 0.55 + 0.45 * abs(dot(normalize(vNormal),
                                      normalize(pc.sunDir.xyz)));
    vec3 lit = canvas * lam * pc.fog.w;
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
