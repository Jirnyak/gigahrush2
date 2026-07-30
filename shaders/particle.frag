#version 450
// particle.frag — Soft-circle billboard fragment shader.
//
// Fog is handled in the VERTEX stage (vFog, pre-computed from world distance).
// We intentionally do NOT raymarch the volumetric light grid here: this shader
// runs up to 8192 times per visible particle, so per-fragment SSBO reads would
// cost ~8K random buffer accesses per frame. The vertex-interpolated fog factor
// and push-constant ambient are sufficient and correct.
//
// Light-grid in-scattering for particles is baked into the emitter colour at
// CPU emit time via the GpuLightGrid query in collect_scene_lights(). Particles
// that are spawned inside a light radius already carry the right tinted colour.

layout(location = 0) in vec4  vColorAlpha; // rgb = color, a = alpha
layout(location = 1) in vec2  vUV;         // -1..+1
layout(location = 2) in float vFog;        // 0 = near, 1 = far (pre-computed in vert)
layout(location = 3) in vec3  vWorldPos;   // for future use (not used below)

layout(push_constant) uniform Push {
    mat4  viewProj;
    vec4  camPos;     // xyz = camera world position
    vec4  camRight;   // xyz = camera right vector
    vec4  camUp;      // xyz = camera up vector
    vec4  fog;        // x = fogStart, y = fogEnd
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

void main() {
    // Soft circle SDF: full intensity at center, fades to 0 at radius 1.0
    float dist = length(vUV);
    if (dist > 1.0) discard;

    float edge  = 1.0 - smoothstep(0.55, 1.0, dist);
    float alpha = vColorAlpha.a * edge;
    if (alpha < 0.004) discard;

    // Apply pre-computed vertex distance fog
    alpha *= (1.0 - vFog);
    if (alpha < 0.004) discard;

    vec3 col = vColorAlpha.rgb;

    // Gamma encode (swapchain is UNORM — same contract as cube.frag)
    col = pow(max(col, vec3(0.0)), vec3(1.0 / kGamma));

    // Triangle-noise dither — suppresses banding at low alpha values
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy,
                     vec2(0.06711056, 0.00583715))));
    col += (ign - 0.5) / 255.0;

    outColor = vec4(col * alpha, alpha);
}
