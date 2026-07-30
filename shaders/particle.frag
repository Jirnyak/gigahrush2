#version 450
#extension GL_GOOGLE_include_directive : require
// particle.frag — Soft-circle billboard fragment shader with volumetric fog & light grid in-scattering.

layout(location = 0) in vec4  vColorAlpha; // rgb = color, a = alpha
layout(location = 1) in vec2  vUV;         // -1..+1
layout(location = 2) in float vFog;
layout(location = 3) in vec3  vWorldPos;

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl"

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
    // Soft circle SDF: 1 at center, 0 at edge
    float dist = length(vUV);
    if (dist > 1.0) discard;

    // Smooth edge with controllable feather zone
    float edge  = 1.0 - smoothstep(0.55, 1.0, dist);
    float alpha = vColorAlpha.a * edge;

    if (alpha < 0.004) discard;

    // Apply distance fog
    alpha *= (1.0 - vFog);

    vec3 col = vColorAlpha.rgb;

    // Volumetric fog in-scattering
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 gridMin = pc.camPos.xyz - vec3(32.0, 16.0, 32.0);
    vec4 fogVol = march_volumetric_fog(
        pc.camPos.xyz,
        normalize(vWorldPos - pc.camPos.xyz),
        min(d, pc.fog.y),
        gl_FragCoord.xy,
        pc.camPos.xyz,
        2.2,
        14.0,
        vec3(0.4, 0.3, 0.85),
        0.5,
        gridMin,
        vec3(32.0, 16.0, 32.0),
        vec3(2.0, 2.0, 2.0),
        0.0
    );
    col = col * fogVol.a + fogVol.rgb * 0.5;

    // Gamma encode (rendering to UNORM swapchain — same contract as cube.frag)
    col = pow(max(col, vec3(0.0)), vec3(1.0 / kGamma));

    // Triangle-noise dither to suppress banding at low alpha
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy,
                     vec2(0.06711056, 0.00583715))));
    col += (ign - 0.5) / 255.0;

    outColor = vec4(col * alpha, alpha);
}
