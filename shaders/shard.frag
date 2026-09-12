#version 450
// shard.frag — черепок GpuHandoff: материальный цвет пропа под световой
// сеткой, туман в черноту. Закон wire.frag (S5: та же сетка, что у стен;
// тонкая декорация без теневого марша), форма обломка — цилиндровое среднее.

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
layout(location = 2) in vec3 vColor;
layout(location = 0) out vec4 outColor;

void main() {
    const float kCylinderAvg = 0.318; // 1/π
    vec3 irr = dressing_light(vWorldPos, vec3(0.0), 0.0, pc.torus.x);
    vec3 lit = vColor * (pc.fog.w + irr * kCylinderAvg);
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
