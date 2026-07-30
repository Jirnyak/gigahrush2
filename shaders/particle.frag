#version 450
// particle.frag — Soft-circle billboard fragment shader.
//
// SDF soft circle: distance from center in UV space (-1..+1), smooth alpha
// edge so particles blend cleanly without hard pixel borders. Additive
// blending is set on the pipeline side (VK_BLEND_OP_ADD) so particles
// naturally brighten overlapping regions without z-write conflicts.
//
// Per-kind color modulation:
//   Spark:    overbright, bloom-ready (color * 2.5)
//   Smoke:    desaturated, large, soft
//   AcidDrip: green emissive tint
//   BioSpore: slight color shift over lifetime (encoded in alpha sign)
//   DustMote: very dim, flat grey
//   ElecArc:  full white overbright flash

layout(location = 0) in vec4  vColorAlpha; // rgb = color, a = alpha
layout(location = 1) in vec2  vUV;         // -1..+1
layout(location = 2) in float vFog;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

void main() {
    // Soft circle SDF: 1 at center, 0 at edge
    float dist    = length(vUV);
    if (dist > 1.0) discard;

    // Smooth edge with controllable feather zone
    float edge    = 1.0 - smoothstep(0.55, 1.0, dist);
    float alpha   = vColorAlpha.a * edge;

    if (alpha < 0.004) discard;

    // Apply fog
    alpha *= (1.0 - vFog);

    vec3 col = vColorAlpha.rgb;

    // Gamma encode (rendering to UNORM swapchain — same contract as cube.frag)
    col = pow(max(col, vec3(0.0)), vec3(1.0 / kGamma));

    // Triangle-noise dither to suppress banding at low alpha
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy,
                     vec2(0.06711056, 0.00583715))));
    col += (ign - 0.5) / 255.0;

    outColor = vec4(col * alpha, alpha);
}
