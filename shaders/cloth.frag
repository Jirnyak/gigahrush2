#version 450
// cloth.frag — worn canvas: flat colour with a soft lambert off the sheet's
// own normal, headlamp falloff, fog to black. Two-sided (abs on the lambert).

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
    float dist = length(vWorldPos - pc.camPos.xyz);
    float lamp = pc.camPos.w / (1.0 + dist * dist / max(pc.fog.z * pc.fog.z, 1e-3));
    vec3 lit = canvas * lam * (pc.fog.w + lamp);
    outColor = vec4(mix(lit, vec3(0.0), vFog), 1.0);
}
