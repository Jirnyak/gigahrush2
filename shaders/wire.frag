#version 450
// wire.frag — a dark rubber cable: flat colour, ambient only, fog to black.
// Deliberately tiny: a 1-2 px line needs no material system.
//
// НЕТ ПРЯМОГО СВЕТА, и это долг, а не решение. Аналитический налобник, который
// освещал трос, убит (владелец 2026-08-20, [CANON.md] S5 — света от камеры не
// существует). Заменить его нечем: verlet_pass строит layout с ОДНИМ
// дескрипторным сетом ([verlet_pass.cpp:175-176, 213-214]), поэтому set 1 —
// световая сетка — этому пассу недоступен, и `surface_light` позвать не из
// чего. Трос теперь виден только по ambient. Чинится подключением пасса ко
// второму сету — правка C++, не шейдера ([markoaudit/plans/headlamp-death.md]).

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

layout(location = 0) in float vFog;
layout(location = 1) in vec3 vWorldPos;
layout(location = 0) out vec4 outColor;

void main() {
    const vec3 cable = vec3(0.16, 0.14, 0.12);
    vec3 lit = cable * pc.fog.w;
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
