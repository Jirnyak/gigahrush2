#version 450
#extension GL_GOOGLE_include_directive : require
// prop.frag — fragment shader for GPU-instanced prop meshes.
//
// Extends cube.frag shading with:
//   emissive  per-instance brightness multiplier packed in the instance struct.
//             Crystals, flood-lamps and acid pools glow based on their emissive byte.
//             Value 0 -> no emission, 255 -> 2.0x emissive (white overexposed).
//
// Prop surfaces are PROCEDURAL ONLY (no photographic atlas): props are the
// second visual layer above the voxel world and are small enough that at any
// distance the headlamp still reaches, the voxel surface families would look
// identical. Instead, the matId controls roughness and surface character without
// needing per-prop texture arrays.

layout(location = 0) in vec3  vNormal;
layout(location = 1) in vec3  vColor;
layout(location = 2) in vec3  vWorldPos;
layout(location = 3) in float vAo;
layout(location = 4) flat in uint vMat;
// Emissive packed as 0-255 → 0.0-2.0 by prop.vert via flat interpolation.
// Passed from per-instance data through the vertex stage.
layout(location = 5) flat in float vEmissive;

#include "material_surface.glsl"

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

// ── Shared procedural surface utilities (verbatim from cube.frag) ──────────

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1,0));
    float c = hash21(i + vec2(0,1)), dd = hash21(i + vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,dd,f.x), f.y);
}
float grain(vec2 uv) {
    return vnoise(uv * 26.0) * 0.62 + vnoise(uv * 97.0) * 0.38;
}
float seam(vec2 uv) {
    vec2 e = abs(fract(uv) - 0.5);
    return smoothstep(0.44, 0.5, max(e.x, e.y));
}
float mottle(float sigma, float n) {
    return exp(sigma * n - 0.5 * sigma * sigma);
}
float resolved(float px, float freq) {
    return clamp(1.0 - px * freq * 2.2, 0.0, 1.0);
}

const uint kFamGeneric = 0u;
const uint kFamPlaster = 1u;
const uint kFamPlank   = 2u;
const uint kFamTile    = 3u;
const uint kFamRibbed  = 4u;
const uint kFamTread   = 5u;
const uint kFamRust    = 6u;
const uint kFamRubble  = 7u;
const uint kFamSmooth  = 8u;

const float kNormGrain = 6.413, kNormNoise = 4.665, kNormHash = 3.465;
const float kNormMask  = 2.293, kMeanMask  = 0.4497;
const float kNormRib   = 1.4145;
const float kNormStud  = 2.518, kMeanStud  = 0.2331;
const float kNormShade = 2.448;

float surface(uint id, vec2 uv, vec3 aw, float px, float g) {
    uint fam   = kMatFamily[min(id, kMatSurfaceCount - 1u)];
    float amp  = kMatSurface[min(id, kMatSurfaceCount - 1u)].x;
    float pitch= kMatSurface[min(id, kMatSurfaceCount - 1u)].y;

    // For metal/smooth props (matId 3-5), use a smooth family regardless
    if (fam == kFamSmooth || id >= 3u) {
        float n = (g - 0.5) * kNormGrain;
        return mottle(amp * 0.5, n);
    }
    if (fam == kFamRibbed) {
        float freq = pitch;
        float rib  = cos(uv.x * freq * 6.2831853) * resolved(px, freq);
        float z    = rib * kNormRib;
        return mottle(amp, z);
    }
    if (fam == kFamRust) {
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 2.85);
        float raw = lo * 0.65 + hi * 0.35;
        float mask = smoothstep(0.42, 0.62, raw);
        float z = (mask - kMeanMask) * kNormMask;
        return mottle(amp, z);
    }
    // Default: generic grain
    float n = (g - 0.5) * kNormGrain;
    return mottle(amp, n);
}

void main() {
    vec3 n_geom = normalize(vNormal);

    // Triplanar UV from world position
    vec3 aw = abs(n_geom);
    vec2 uv = aw.z > 0.5 ? vWorldPos.xy
            : (aw.x > 0.5 ? vWorldPos.yz : vWorldPos.xz);
    uv /= 2.0;

    float g  = grain(uv);
    float px = max(fwidth(uv.x), fwidth(uv.y));
    uint  mid = min(vMat, kMatSurfaceCount - 1u);

    // Procedural albedo — no texture array needed for props
    vec3 albedo = pow(vColor, vec3(kGamma));
    albedo *= surface(vMat, uv, aw, px, g);

    // ── Lighting (identical to cube.frag) ─────────────────────────────────
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 L = toCam / max(d, 1e-4);

    float r = pc.fog.z;
    float att = 1.0 / (1.0 + (d * d) / (r * r));

    // HG forward scatter
    float g_scat   = 0.55;
    float cosTheta = dot(-L, L);    // effectively dot(viewDir, lightDir)=1 when aligned
    cosTheta = dot(normalize(vWorldPos - pc.camPos.xyz), -L);
    float phase = (1.0 - g_scat * g_scat) /
                  pow(max(1.0 + g_scat * g_scat - 2.0 * g_scat * cosTheta, 1e-4), 1.5);

    float roughness   = 0.4 + 0.2 * float(vMat & 3u);  // 0.4-1.0 based on matId
    float specPow     = max(2.0 / (roughness * roughness * roughness * roughness + 1e-4) - 2.0, 1.0);
    float specIntensity = (1.0 - roughness) * 0.5;
    float spec = 0.0;
    if (dot(n_geom, L) > 0.0) {
        spec = pow(max(dot(n_geom, L), 0.0), specPow) * specIntensity * att * pc.camPos.w;
    }

    float lampDirect  = pc.camPos.w * att * max(dot(n_geom, L), 0.0);
    float lampScatter = pc.camPos.w * att * phase * 0.25;
    float lamp = lampDirect + lampScatter;

    float fill = pc.sunDir.w * max(dot(n_geom, normalize(pc.sunDir.xyz)), 0.0);

    float hemi = 0.5 + 0.5 * n_geom.z;
    vec3 amb = pc.fog.w * mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.23, 0.21), hemi);

    const float kAoFloor = 0.32;
    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);

    vec3 lit = albedo * (amb * ao + vec3(lamp + fill) * aoDirect) + vec3(spec) * aoDirect;

    // ── Emissive term ─────────────────────────────────────────────────────
    // vEmissive: 0.0 = dark prop, 2.0 = fully saturated glow.
    // Emissive is ADDED in linear space BEFORE fog so it fades with distance.
    // Coloured by the prop's own albedo tint to keep crystal/acid palette.
    if (vEmissive > 0.001) {
        // Emissive glow: self-illuminated albedo colour, pulsed slightly by world-pos
        // to make bioluminescent props flicker naturally without CPU animation.
        float pulse = 1.0 + 0.08 * sin(vWorldPos.y * 7.3 + vWorldPos.x * 3.1);
        vec3 emitCol = pow(vColor, vec3(kGamma));       // already linear
        lit += emitCol * vEmissive * pulse;
    }

    // ── Fog ──────────────────────────────────────────────────────────────
    const float kHeightFogScale = 0.04;
    float heightDensity = exp(-clamp(kHeightFogScale * vWorldPos.y, -3.0, 3.0));
    float effectiveDist = d * heightDensity;
    float fog = clamp((effectiveDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
    lit = mix(lit, vec3(0.0), fog);

    vec3 srgb = pow(max(lit, vec3(0.0)), vec3(1.0 / kGamma));

    // IGN dithering
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    srgb += (ign - 0.5) / 255.0 * (1.0 - fog);

    outColor = vec4(srgb, 1.0);
}
