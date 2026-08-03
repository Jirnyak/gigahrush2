#version 450
// wire.frag — a dark rubber cable: flat colour, headlamp falloff, fog to
// black. Deliberately tiny: a 1-2 px line needs no material system.

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
    float dist = length(vWorldPos - pc.camPos.xyz);
    // Headlamp: same inverse-square feel the cube family uses, cheap form.
    float lamp = pc.camPos.w / (1.0 + dist * dist / max(pc.fog.z * pc.fog.z, 1e-3));
    vec3 lit = cable * (pc.fog.w + lamp);
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
