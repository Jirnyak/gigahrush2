#version 450
// particle.frag — a soft round sprite: ambient only like wire.frag, emissive
// kinds (sparks) glow through the dark, fog fades to black. The circular
// falloff does the anti-aliasing; no texture.
//
// Налобник убит (владелец 2026-08-20, S5), световая сетка этому пассу
// недоступна ([particle_pass.cpp:120-121, 155-156] — один дескрипторный сет).
// ИСКРЫ ЭТОГО НЕ ЗАМЕТИЛИ: строка `mix` ниже при em==1 заменяет освещение
// целиком, поэтому светящееся читается в темноте по-прежнему. Потеряли яркость
// только НЕэмиссивные виды — пыль, дым, кровь: их видно лишь по ambient.

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

layout(location = 0) in vec3 vColor;
layout(location = 1) in vec3 vMisc; // x fog, y emissive 0..1, z alpha
layout(location = 2) in vec2 vUv;
layout(location = 3) in vec3 vWorldPos;
layout(location = 0) out vec4 outColor;

void main() {
    float r = length(vUv);
    float disc = 1.0 - smoothstep(0.55, 1.0, r);
    float alpha = vMisc.z * disc;
    if (alpha < 0.004) discard;

    vec3 lit = vColor * pc.fog.w;
    // Emissive rows self-light and resist fog — a spark reads in the dark.
    float em = vMisc.y;
    lit = mix(lit, vColor * (1.0 + em * 2.0), em);
    float fogF = vMisc.x * (1.0 - em * 0.7);
    outColor = vec4(mix(lit, vec3(0.0), fogF), alpha);
}
