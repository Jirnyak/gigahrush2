#version 450
#extension GL_GOOGLE_include_directive : require
// Shading for both the world pass (cube.vert) and the population pass
// (body.vert) — see render.md. The model is built for a *windowless interior*:
// there is no sun down here, so the light the player actually sees is the light
// they carry.
//
// Multi-Biome Procedural Material Rendering:
//   - Floor 0 (Soviet Padic): Authentically weathered two-tone oil enamel (peeling
//     paint flakes with micro-cavity shadow, plaster reveal), concrete floor slabs
//     with distinct bevelled seams, micro-grain roughness, damp floor patches,
//     and subtle grazing-angle specular reflection, conduit pipes with
//     anisotropic metallic glints, ceiling concrete texture.
//   - Floor 2 (Industrial Factory): Heavy rusted cast iron, dark oxidized steel, hazard
//     warning yellow-black diagonal stripes on door frames/pillars, high-contrast
//     metallic specular.
//   - Floor 4 (Sterile Bio-Lab): Glazed white/mint ceramic tiles with sharp specular
//     grid lines, glowing green bioluminescent vats/tubes.
//
// Dynamic Lighting & Volumetrics:
//   - 3D LightGrid Point Lights (fluorescent tubes with 100Hz micro-flicker tint,
//     sodium warm emergency lights, bioluminescent vats).
//   - High-contrast flashlight spotlight with warm tungsten core, realistic
//     inverse-square decay, and grazing specular highlights.
//   - Refined volumetric fog for soft atmospheric dust and god-rays without muddy
//     grey washout.

layout(location = 0) in vec3 vNormal;
layout(location = 1) in vec3 vColor;
layout(location = 2) in vec3 vWorldPos;
// Baked corner occlusion from cube.vert; body.vert writes a constant 1.0.
layout(location = 3) in float vAo;
// Material id (world/materials.h) from cube.vert; body.vert writes a constant 0.
layout(location = 4) flat in uint vMat;

// Per-material family + measured amplitude, GENERATED from data/materials.csv
#include "material_surface.glsl"

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl"

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent); y = direct-light AO share;
                   // z = live photographic albedo layer mask;
                   // w = packed normal/roughness masks / uTime
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;
const float kPi = 3.14159265359;

#ifdef GIGA_ALBEDO_ARRAY
layout(set = 0, binding = 0) uniform sampler2DArray uAlbedo;
layout(set = 0, binding = 1) uniform sampler2DArray uNormal;
layout(set = 0, binding = 2) uniform sampler2DArray uRoughness;
const float kTexRepeat = 0.5;
#endif

// ---------------------------------------------------------------------------
// Procedural Surface Mathematics & Noise Functions
// ---------------------------------------------------------------------------

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float grain(vec2 uv) {
    return vnoise(uv * 26.0) * 0.62 + vnoise(uv * 97.0) * 0.38;
}

float seam(vec2 uv) {
    vec2 e = abs(fract(uv) - 0.5);
    float m = max(e.x, e.y);
    return smoothstep(0.44, 0.5, m);
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

const float kNormGrain = 6.413;
const float kNormNoise = 4.665;
const float kNormHash  = 3.465;
const float kNormMask  = 2.293;
const float kMeanMask  = 0.4497;
const float kNormRib   = 1.4145;
const float kNormStud  = 2.518;
const float kMeanStud  = 0.2331;
const float kNormShade = 2.448;

float mottle(float sigma, float n) {
    return exp(sigma * n - 0.5 * sigma * sigma);
}

float resolved(float px, float freq) {
    return clamp(1.0 - px * freq * 2.2, 0.0, 1.0);
}

float surface(uint mat, vec2 uv, vec3 aw, float px, float g) {
    uint id = min(mat, kMatSurfaceCount - 1u);
    uint fam = kMatFamily[id];
    float sigma = kMatSurface[id].x;
    float pitch = kMatSurface[id].y;

    if (fam == kFamSmooth) {
        return mottle(sigma, (g - 0.5) * kNormGrain);
    }

    if (fam == kFamPlaster || fam == kFamGeneric) {
        float stain = vnoise(uv * pitch);
        float n = (g - 0.5) * kNormGrain * 0.78 + (stain - 0.5) * kNormNoise * 0.62;
        float s = seam(uv);
        return mottle(sigma, n) * (1.0 - 0.28 * s);
    }

    if (fam == kFamPlank) {
        float row = floor(uv.y * pitch);
        float along = uv.x * 5.0 + hash21(vec2(row, 7.0)) * 3.0;
        float tone = hash21(vec2(floor(along), row)) - 0.5;
        float streak = vnoise(vec2(uv.x * 40.0, uv.y * pitch * 8.0)) - 0.5;
        float n = tone * kNormHash * 0.85 + streak * kNormNoise * 0.53;
        float jAcross = smoothstep(0.42, 0.5, abs(fract(uv.y * pitch) - 0.5))
                      * resolved(px, pitch);
        float jAlong = smoothstep(0.46, 0.5, abs(fract(along) - 0.5))
                     * resolved(px, 5.0);
        return mottle(sigma, n) * (1.0 - 0.34 * jAcross - 0.20 * jAlong);
    }

    if (fam == kFamTile) {
        vec2 q = uv * pitch;
        float tone = hash21(floor(q)) - 0.5;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.42, 0.5, max(e.x, e.y)) * resolved(px, pitch);
        float n = tone * kNormHash * 0.88 + (g - 0.5) * kNormGrain * 0.47;
        return mottle(sigma, n) * (1.0 - 0.30 * grout);
    }

    if (fam == kFamRibbed) {
        float d = resolved(px, pitch);
        float rib = cos(uv.x * pitch * 6.2831853);
        float n = rib * kNormRib * 0.90 * d + (g - 0.5) * kNormGrain * 0.44;
        float trough = smoothstep(-0.2, -0.95, rib) * d;
        return mottle(sigma, n) * (1.0 - 0.16 * trough);
    }

    if (fam == kFamTread) {
        float d = resolved(px, pitch);
        vec2 q = uv * pitch;
        q.x += 0.5 * floor(q.y);
        vec2 f = fract(q) - 0.5;
        float stud = 1.0 - smoothstep(0.28, 0.40, abs(f.x) + abs(f.y));
        float n = (stud - kMeanStud) * kNormStud * 0.826 * d
                + (f.x + f.y) * stud * kNormShade * 0.574 * d
                + (g - 0.5) * kNormGrain * 0.550;
        return mottle(sigma, n) * (1.0 - 0.28 * (1.0 - stud) * d);
    }

    if (fam == kFamRust) {
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 2.85);
        float mask = smoothstep(0.42, 0.62, lo * 0.65 + hi * 0.35);
        float n = -(mask - kMeanMask) * kNormMask * 0.92
                + (g - 0.5) * kNormGrain * 0.55 * (0.45 + 0.85 * mask);
        return mottle(sigma, n);
    }

    if (fam == kFamRubble) {
        float warp = vnoise(uv * 2.3);
        vec2 q = uv * pitch + warp * 2.5;
        float chunk = hash21(floor(q)) - 0.5;
        vec2 e = abs(fract(q) - 0.5);
        float crack = smoothstep(0.36, 0.5, max(e.x, e.y)) * resolved(px, pitch);
        float n = chunk * kNormHash * 0.90 + (g - 0.5) * kNormGrain * 0.44;
        return mottle(sigma, n) * (1.0 - 0.32 * crack);
    }

    return 1.0;
}

// ── Surface Height for Procedural Micro-Bump ──────────────────────────────────
float surface_height(uint fam, vec2 uv, float pitch, float g, bool isHorizontal, uint mid, float h_wall) {
    if (fam == kFamRibbed || mid == 19u) {
        float rib = cos(uv.x * pitch * 6.2831853);
        float trough = smoothstep(-0.2, -0.95, rib);
        float weld = smoothstep(0.46, 0.50, abs(fract(uv.y * 3.0) - 0.5)) * 0.30;
        return (rib - 0.5 * trough) + weld + 0.10 * (g - 0.5);
    }
    if (fam == kFamTread || mid == 13u || mid == 16u) {
        vec2 q = uv * pitch;
        q.x += 0.5 * floor(q.y);
        vec2 f = fract(q) - 0.5;
        float stud = 1.0 - smoothstep(0.24, 0.38, abs(f.x) + abs(f.y));
        float bevel = (f.x + f.y) * stud * 0.35;
        return stud * 1.2 + bevel - 0.2 * (1.0 - stud);
    }
    if (fam == kFamTile || mid == 11u) {
        vec2 q = uv * 6.0;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.42, 0.50, max(e.x, e.y));
        float dome = (1.0 - 4.0 * (e.x * e.x + e.y * e.y)) * 0.20;
        return -0.70 * grout + dome + 0.05 * (g - 0.5);
    }
    if (fam == kFamPlank || mid == 9u) {
        float row = floor(uv.y * pitch);
        float along = uv.x * 5.0 + hash21(vec2(row, 7.0)) * 3.0;
        float jAcross = smoothstep(0.42, 0.50, abs(fract(uv.y * pitch) - 0.5));
        float jAlong = smoothstep(0.46, 0.50, abs(fract(along) - 0.5));
        float streak = vnoise(vec2(uv.x * 40.0, uv.y * pitch * 8.0));
        return -0.65 * jAcross - 0.45 * jAlong + 0.30 * streak;
    }
    if (fam == kFamPlaster || fam == kFamGeneric || mid == 8u || mid == 0u || mid == 1u || mid == 4u) {
        float s = seam(uv);
        if (!isHorizontal) {
            if (h_wall < 2.2) {
                // Lower enamel paint with peeling chips
                float wearArea = smoothstep(0.42, 0.65, vnoise(uv * 1.5));
                float chipNoise = vnoise(uv * 14.0) * 0.70 + vnoise(uv * 42.0) * 0.30;
                float peeled = wearArea * smoothstep(0.55, 0.62, chipNoise);
                float chipEdge = peeled * 0.28;
                return chipEdge - 0.15 * peeled + (g - 0.5) * 0.16 - 0.28 * s;
            } else if (h_wall <= 2.4) {
                float trimRidge = sin((h_wall - 2.2) / 0.2 * 3.14159265) * 0.35;
                return trimRidge - 0.20 * s;
            } else {
                // Upper whitewash / plaster: fine fissures & grit
                float fineGrit = (g - 0.5) * 0.20 + vnoise(uv * 48.0) * 0.10;
                float cracks = -0.22 * smoothstep(0.46, 0.52, abs(vnoise(uv * 18.0) - 0.5));
                return fineGrit + cracks - 0.28 * s;
            }
        } else {
            // Horizontal floor/ceiling slab seams
            vec2 slabDist = abs(fract(vWorldPos.xy * 0.5) - 0.5);
            float slabSeam = smoothstep(0.46, 0.50, max(slabDist.x, slabDist.y));
            return -slabSeam * 0.50 + (g - 0.5) * 0.15;
        }
    }
    if (fam == kFamRust || mid == 14u) {
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 3.0);
        float mask = smoothstep(0.36, 0.64, lo * 0.65 + hi * 0.35);
        float microRust = vnoise(uv * pitch * 10.0) * mask * 0.45;
        return -0.80 * mask + microRust + (g - 0.5) * 0.20 * (1.0 - mask);
    }
    if (fam == kFamRubble || mid == 15u) {
        float warp = vnoise(uv * 2.3);
        vec2 q = uv * pitch + warp * 2.5;
        float chunk = hash21(floor(q)) - 0.5;
        vec2 e = abs(fract(q) - 0.5);
        float crack = smoothstep(0.32, 0.50, max(e.x, e.y));
        return chunk * (1.0 - crack) - 0.85 * crack + 0.15 * (g - 0.5);
    }
    if (mid == 7u || mid == 5u) {
        vec2 plateDist = abs(fract(vWorldPos.xy) - 0.5);
        float seamDepth = smoothstep(0.44, 0.49, max(plateDist.x, plateDist.y));
        return -seamDepth * 0.45 + 0.08 * (g - 0.5);
    }
    if (mid == 6u) {
        vec2 dEdge = abs(fract(uv) - 0.5);
        float bevel = smoothstep(0.40, 0.48, max(dEdge.x, dEdge.y));
        return -0.50 * bevel + 0.12 * (g - 0.5);
    }
    if (fam == kFamSmooth) {
        if (isHorizontal) {
            vec2 slabDist = abs(fract(vWorldPos.xy * 0.5) - 0.5);
            float slabSeam = smoothstep(0.46, 0.50, max(slabDist.x, slabDist.y));
            return -slabSeam * 0.50 + (g - 0.5) * 0.15;
        }
        float microPores = vnoise(uv * 64.0) * 0.18 + (g - 0.5) * 0.22;
        float pits = -0.22 * smoothstep(0.68, 0.85, vnoise(uv * 24.0));
        return microPores + pits - 0.25 * seam(uv);
    }
    return 0.0;
}

vec2 compute_grad_uv(uint fam, vec2 uv, float pitch, float g, bool isHorizontal, uint mid, float h_wall) {
    float eps = 0.0025;
    float hu_p = surface_height(fam, uv + vec2(eps, 0.0), pitch, g, isHorizontal, mid, h_wall);
    float hu_m = surface_height(fam, uv - vec2(eps, 0.0), pitch, g, isHorizontal, mid, h_wall);
    float hv_p = surface_height(fam, uv + vec2(0.0, eps), pitch, g, isHorizontal, mid, h_wall);
    float hv_m = surface_height(fam, uv - vec2(0.0, eps), pitch, g, isHorizontal, mid, h_wall);
    return vec2(hu_p - hu_m, hv_p - hv_m) / (2.0 * eps);
}

vec3 apply_chroma(vec3 albedo, uint id, vec2 uv, float pitch) {
    float chroma_sig = kMatSurface[id].z;
    if (chroma_sig > 0.001) {
        vec3 chroma_axis = kMatChromaAxis[id];
        float n_chroma = vnoise(uv * pitch * 0.7 + vec2(17.3, 31.7));
        float z_chroma = (n_chroma - 0.5) * kNormNoise;
        vec3 chroma_mod = exp(z_chroma * chroma_sig * chroma_axis - 0.5 * chroma_sig * chroma_sig * chroma_axis * chroma_axis);
        return albedo * chroma_mod;
    }
    return albedo;
}

void main() {
    vec3 n_geom = normalize(vNormal);

    vec3 aw = abs(n_geom);
    vec2 uv = aw.z > 0.5 ? vWorldPos.xy
            : (aw.x > 0.5 ? vWorldPos.yz : vWorldPos.xz);
    uv /= 2.0;

    float g = grain(uv);
    float px = max(fwidth(uv.x), fwidth(uv.y));

    uint mid = min(vMat, kMatSurfaceCount - 1u);
    uint fam = kMatFamily[mid];
    float bump = kMatSurface[mid].w;

    bool isHorizontal = (aw.z > 0.7);
    bool isFloor = isHorizontal && (n_geom.z > 0.5);
    bool isCeiling = isHorizontal && (n_geom.z < -0.5);
    float h_wall = mod(vWorldPos.z, 6.0);
    int floorIdx = int(floor(vWorldPos.z / 6.0));

    // Enhanced bump multiplier
    float bumpMultiplier = 1.0;
    if (mid == 1u || mid == 4u) bumpMultiplier = 1.8;
    else if (fam == kFamRust || mid == 14u) bumpMultiplier = 1.6;
    else if (fam == kFamPlaster || fam == kFamGeneric) bumpMultiplier = 1.4;
    else if (fam == kFamRibbed || mid == 19u) bumpMultiplier = 1.3;
    else if (fam == kFamTread || mid == 7u || mid == 5u) bumpMultiplier = 1.4;

    float effectiveBump = bump * bumpMultiplier;
    vec3 n = n_geom;
    if (effectiveBump > 0.001) {
        vec2 grad_uv = compute_grad_uv(fam, uv, kMatSurface[mid].y, g, isHorizontal, mid, h_wall);
        vec3 grad_world;
        if (aw.z > 0.5) {
            grad_world = vec3(-grad_uv.x * sign(n_geom.z), -grad_uv.y * sign(n_geom.z), 0.0);
        } else if (aw.x > 0.5) {
            grad_world = vec3(0.0, -grad_uv.x * sign(n_geom.x), -grad_uv.y * sign(n_geom.x));
        } else {
            grad_world = vec3(-grad_uv.x * sign(n_geom.y), 0.0, -grad_uv.y * sign(n_geom.y));
        }
        vec3 tilt = effectiveBump * grad_world;
        float tl = length(tilt);
        if (tl > 0.60) tilt *= 0.60 / tl;
        n = normalize(n_geom + tilt);
    }

#ifdef GIGA_ALBEDO_ARRAY
    uint packedMasks = floatBitsToUint(pc.torus.w);
    uint normalMask = packedMasks & 0xFFFFu;
    uint roughnessMask = (packedMasks >> 16u) & 0xFFFFu;

    if (normalMask != 0u && (normalMask & (1u << mid)) != 0u) {
        vec3 mapN = texture(uNormal, vec3(uv * kTexRepeat, float(mid))).xyz * 2.0 - 1.0;
        vec3 dp1 = dFdx(vWorldPos);
        vec3 dp2 = dFdy(vWorldPos);
        vec2 duv1 = dFdx(uv * kTexRepeat);
        vec2 duv2 = dFdy(uv * kTexRepeat);

        vec3 N = normalize(n_geom);
        vec3 dp2perp = cross(dp2, N);
        vec3 dp1perp = cross(N, dp1);

        vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
        vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

        float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-8));
        mat3 TBN = mat3(T * invmax, B * invmax, N);

        vec3 n_surf = normalize(TBN * mapN);
        n = n_surf;
    }
#endif

    // ── Multi-Biome Albedo & Surface Texturing ─────────────────────────────────
    vec3 albedo = pow(vColor, vec3(kGamma));
    float flakeEdgeShadow = 0.0;
    float dampFloorMask = 0.0;

    if (!isHorizontal && (fam == kFamGeneric || fam == kFamPlaster || mid == 8u || mid == 1u || mid == 4u || mid == 0u)) {
        // Floor 0 (Soviet Stairwell & Living Units) Authentic Two-Tone Wall:
        if (h_wall < 2.2) {
            // Lower section (< 2.2m): Saturated teal/sea-green Soviet oil enamel with peeling paint flakes
            float wearArea = smoothstep(0.42, 0.65, vnoise(uv * 1.5));
            float chipNoise = vnoise(uv * 14.0) * 0.70 + vnoise(uv * 42.0) * 0.30;
            float peeled = wearArea * smoothstep(0.55, 0.62, chipNoise);
            float flakeEdge = wearArea * smoothstep(0.52, 0.55, chipNoise) * (1.0 - smoothstep(0.62, 0.65, chipNoise));
            flakeEdgeShadow = flakeEdge;

            vec3 authoredCol = pow(vColor, vec3(kGamma));
            vec3 sovietTeal = vec3(0.018, 0.185, 0.155); // Rich saturated Soviet institutional sea-green enamel
            vec3 paintCol = mix(authoredCol, sovietTeal, 0.75);
            vec3 plasterSubstrate = vec3(0.28, 0.25, 0.20) * (0.85 + 0.30 * vnoise(uv * 8.0)); // Rough beige/grey plaster substrate
            albedo = mix(paintCol, plasterSubstrate, peeled);
            albedo *= (1.0 - flakeEdge * 0.65); // Dark contact shadow cavity under flaked paint edge
        } else if (h_wall <= 2.4) {
            // Dark dividing stripe (2.2m - 2.4m)
            albedo = vec3(0.020, 0.018, 0.016);
        } else {
            // Matte whitewashed plaster above (> 2.4m)
            vec3 upperPlaster = vec3(0.38, 0.35, 0.30) * (0.92 + 0.16 * vnoise(uv * 6.0));
            albedo = mix(pow(vColor, vec3(kGamma)) * 1.15, upperPlaster, 0.60);
        }
        albedo *= surface(vMat, uv, aw, px, g);
        albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
    } else if (isFloor) {
        // Floor 0: Concrete floor slabs with bevelled joint seams, micro-grain roughness, damp floor patches
        vec2 slabUv = fract(vWorldPos.xy * 0.5);
        vec2 dSlab = abs(slabUv - 0.5);
        float seamW = 0.025 + px * 2.5;
        float slabSeam = max(smoothstep(0.5 - seamW, 0.5, dSlab.x), smoothstep(0.5 - seamW, 0.5, dSlab.y));
        
        vec2 tileUv = fract(vWorldPos.xy * 2.0);
        vec2 dTile = abs(tileUv - 0.5);
        float tileSeam = max(smoothstep(0.5 - seamW * 2.0, 0.5, dTile.x), smoothstep(0.5 - seamW * 2.0, 0.5, dTile.y));
        
        float slabHash = hash21(floor(vWorldPos.xy * 0.5));
        vec3 floorBase = mix(vec3(0.040, 0.044, 0.048), vec3(0.062, 0.068, 0.075), slabHash);
        
        // Damp floor patches
        dampFloorMask = smoothstep(0.52, 0.75, vnoise(vWorldPos.xy * 0.35 + vec2(4.1, 8.3)));
        floorBase = mix(floorBase, floorBase * 0.45, dampFloorMask);
        
        if (mid == 7u) {
            // Fast-travel hub pad: central cyan stencil + perimeter hazard stripes
            vec2 padCenter = fract(vWorldPos.xy * 0.125) * 8.0 - 4.0;
            float padR = length(padCenter);
            float ring = smoothstep(0.08, 0.04, abs(padR - 1.8));
            vec3 cyanStencil = vec3(0.03, 0.55, 0.70);
            
            float borderSeam = seam(vWorldPos.xy * 0.125);
            float diag = fract((vWorldPos.x + vWorldPos.y) * 2.0);
            vec3 hazardStripe = mix(vec3(0.88, 0.68, 0.05), vec3(0.025, 0.025, 0.027), step(0.5, diag));
            
            floorBase = mix(floorBase, cyanStencil, ring * 0.75);
            floorBase = mix(floorBase, hazardStripe, borderSeam * 0.80);
        } else if (mid == 5u) {
            vec2 padCenter = fract(vWorldPos.xy * 0.125) * 8.0 - 4.0;
            float padR = length(padCenter);
            float ring = smoothstep(0.08, 0.04, abs(padR - 1.8));
            vec3 greenStencil = vec3(0.05, 0.65, 0.28);
            
            float borderSeam = seam(vWorldPos.xy * 0.125);
            float diag = fract((vWorldPos.x - vWorldPos.y) * 2.0);
            vec3 hazardStripe = mix(vec3(0.06, 0.55, 0.24), vec3(0.025, 0.025, 0.027), step(0.5, diag));
            
            floorBase = mix(floorBase, greenStencil, ring * 0.75);
            floorBase = mix(floorBase, hazardStripe, borderSeam * 0.80);
        }
        
        albedo = floorBase * (1.0 - slabSeam * 0.65) * (1.0 - tileSeam * 0.25);
    } else if (mid == 6u) {
        // Floor 2 / Doors: Yellow/Black Hazard Warning Diagonal Stripes on Doorframes
        float diag = fract((vWorldPos.x + vWorldPos.y + vWorldPos.z) * 2.5);
        vec3 hazardYellow = vec3(0.88, 0.68, 0.05);
        vec3 hazardBlack = vec3(0.025, 0.025, 0.027);
        vec3 hazardStripe = mix(hazardYellow, hazardBlack, step(0.50, diag));
        float wear = smoothstep(0.55, 0.85, vnoise(uv * 16.0));
        vec3 oxidizedSteel = vec3(0.045, 0.048, 0.052);
        albedo = mix(hazardStripe, oxidizedSteel, wear * 0.65);
    } else if (mid == 14u || (floorIdx == 2 && !isHorizontal)) {
        // Floor 2 (Industrial Plant): Heavy rusted cast iron & dark oxidized steel
        float lo = vnoise(uv * kMatSurface[mid].y);
        float hi = vnoise(uv * kMatSurface[mid].y * 2.85);
        float rustMask = smoothstep(0.36, 0.64, lo * 0.65 + hi * 0.35);
        vec3 oxidizedSteel = vec3(0.045, 0.048, 0.052) * (0.85 + 0.30 * g);
        vec3 rustCrust = vec3(0.25, 0.09, 0.03) * (0.80 + 0.40 * vnoise(uv * 16.0));
        albedo = mix(oxidizedSteel, rustCrust, rustMask);
    } else if (mid == 11u || (floorIdx == 4 && !isHorizontal)) {
        // Floor 4 (Sterile Bio-Lab): Glossy White/Mint Ceramic Tiles with Crisp Dark Grout Lines
        vec2 q = uv * 6.0;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.44, 0.50, max(e.x, e.y));
        vec3 mintTile = vec3(0.84, 0.93, 0.89);
        vec3 darkGrout = vec3(0.07, 0.08, 0.09);
        albedo = mix(mintTile, darkGrout, grout);
    } else if (mid == 17u) {
        // Glowing Bio-luminescent Tubes & Hydroponic Fluid
        float timeSec = pc.torus.w;
        float bioWave = 0.85 + 0.15 * sin(timeSec * 3.5 + vWorldPos.x * 2.0 + vWorldPos.y * 2.0 + vWorldPos.z * 1.5);
        albedo = vec3(0.03, 0.98, 0.40) * bioWave;
    } else {
#ifdef GIGA_ALBEDO_ARRAY
        if ((uint(pc.torus.z) & (1u << mid)) != 0u) {
            albedo = texture(uAlbedo, vec3(uv * kTexRepeat, float(mid))).rgb * vColor;
        } else {
            albedo *= surface(vMat, uv, aw, px, g);
            albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
        }
#else
        albedo *= surface(vMat, uv, aw, px, g);
        albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
#endif
    }

    // ── Material PBR Roughness & Metallic Classification ─────────────────────
    float roughness = 0.65;
    float metallic = 0.0;
    float specIntensity = 0.35;
    float cavity = 1.0;

    if (isFloor) {
        vec2 slabUv = fract(vWorldPos.xy * 0.5);
        vec2 dSlab = abs(slabUv - 0.5);
        float slabSeam = max(smoothstep(0.46, 0.5, dSlab.x), smoothstep(0.46, 0.5, dSlab.y));
        roughness = mix(mix(0.28, 0.78, slabSeam), 0.04, dampFloorMask);
        metallic = (mid == 7u || mid == 5u) ? mix(0.88, 0.10, slabSeam) : 0.03;
        specIntensity = mix(mix(1.35, 0.30, slabSeam), 2.80, dampFloorMask);
    } else if (isCeiling) {
        roughness = 0.85;
        metallic = 0.02;
        specIntensity = 0.22;
    } else if (mid == 1u || mid == 4u) {
        roughness = clamp(0.70 + (g - 0.5) * 0.15, 0.52, 0.88);
        metallic = 0.02;
        specIntensity = 0.35;
    } else if (mid == 6u) {
        // Doorframes: oxidized heavy steel with yellow/black hazard striping
        roughness = clamp(0.25 + (g - 0.5) * 0.12, 0.15, 0.45);
        metallic = 0.88;
        specIntensity = 1.35;
    } else if (mid == 19u) {
        // Pipes and conduits: High-contrast anisotropic metallic sheen
        roughness = clamp(0.12 + (g - 0.5) * 0.05, 0.07, 0.22);
        metallic = 0.96;
        specIntensity = 2.00;
    } else if (fam == kFamRibbed || mid == 10u || mid == 12u) {
        roughness = clamp(0.26 + (g - 0.5) * 0.15, 0.16, 0.46);
        metallic = 0.88;
        specIntensity = 1.30;
    } else if (fam == kFamTread || mid == 13u || mid == 16u) {
        vec2 q = uv * kMatSurface[mid].y;
        q.x += 0.5 * floor(q.y);
        vec2 f = fract(q) - 0.5;
        float stud = 1.0 - smoothstep(0.24, 0.38, abs(f.x) + abs(f.y));
        roughness = mix(0.68, 0.16, stud);
        metallic = mix(0.40, 0.94, stud);
        specIntensity = mix(0.40, 1.55, stud);
    } else if (fam == kFamRust || mid == 14u || (floorIdx == 2 && !isHorizontal)) {
        // Floor 2: Heavy rusted cast iron & dark oxidized steel
        float lo = vnoise(uv * kMatSurface[mid].y);
        float hi = vnoise(uv * kMatSurface[mid].y * 2.85);
        float rustMask = smoothstep(0.36, 0.64, lo * 0.65 + hi * 0.35);
        roughness = mix(0.22, 0.94, rustMask);
        metallic = mix(0.92, 0.02, rustMask);
        specIntensity = mix(1.75, 0.15, rustMask);
        cavity = mix(1.0, 0.45, rustMask);
    } else if (fam == kFamPlaster || fam == kFamGeneric || mid == 8u || mid == 0u) {
        if (!isHorizontal) {
            if (h_wall < 2.2) {
                // Lower enamel paint with peeling chips
                float wearArea = smoothstep(0.42, 0.65, vnoise(uv * 1.5));
                float chipNoise = vnoise(uv * 14.0) * 0.70 + vnoise(uv * 42.0) * 0.30;
                float peeled = wearArea * smoothstep(0.55, 0.62, chipNoise);
                roughness = mix(0.18 + (g - 0.5) * 0.08, 0.88, peeled);
                metallic = mix(0.04, 0.0, peeled);
                specIntensity = mix(1.60, 0.20, peeled);
                cavity = 1.0 - flakeEdgeShadow * 0.60;
            } else if (h_wall <= 2.4) {
                // Dark dividing stripe
                roughness = 0.42;
                metallic = 0.02;
                specIntensity = 0.55;
            } else {
                // Matte whitewashed plaster above
                roughness = clamp(0.82 + (g - 0.5) * 0.10, 0.65, 0.95);
                metallic = 0.0;
                specIntensity = 0.24;
            }
        } else {
            roughness = 0.72;
            metallic = 0.0;
            specIntensity = 0.30;
        }
    } else if (mid == 11u || floorIdx == 4) {
        // Floor 4: Bio-Lab Glazed Ceramic Tile with crisp dark grout lines
        vec2 q = uv * 6.0;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.44, 0.50, max(e.x, e.y));
        roughness = mix(0.06, 0.80, grout);
        metallic = 0.02;
        specIntensity = mix(2.60, 0.22, grout);
    } else if (mid == 17u) {
        // Bio-vat glowing fluid
        roughness = 0.03;
        metallic = 0.08;
        specIntensity = 3.00;
    } else if (fam == kFamPlank || mid == 9u) {
        roughness = clamp(0.28 + (g - 0.5) * 0.10, 0.16, 0.45);
        metallic = 0.02;
        specIntensity = 0.85;
    } else if (fam == kFamRubble || mid == 15u) {
        roughness = 0.85;
        metallic = 0.0;
        specIntensity = 0.20;
    }

#ifdef GIGA_ALBEDO_ARRAY
    if (roughnessMask != 0u && (roughnessMask & (1u << mid)) != 0u) {
        roughness = texture(uRoughness, vec3(uv * kTexRepeat, float(mid))).r;
    }
#endif

    // ── Vectors & Lighting Formulation ───────────────────────────────────────
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 V = toCam / max(d, 1e-4);

    vec3 F0 = mix(vec3(0.04), albedo, metallic);

    float r4 = roughness * roughness * roughness * roughness;
    float specPow = max(2.0 / (r4 + 1e-4) - 2.0, 1.0);
    float normFactor = (specPow + 8.0) / (8.0 * kPi);

    // 1. High-Contrast Player Flashlight Cone (Hot Tungsten Core + Realistic Inverse-Square Decay)
    vec3 camForward = -normalize(vec3(pc.viewProj[0][2], pc.viewProj[1][2], pc.viewProj[2][2]));
    vec3 rayDir = normalize(vWorldPos - pc.camPos.xyz);

    float cosAngle = dot(rayDir, camForward);
    float spotCore = smoothstep(0.88, 0.99, cosAngle);
    float spotCone = smoothstep(0.50, 0.88, cosAngle);
    float spotFactor = mix(0.15, 1.80, spotCone * 0.35 + spotCore * 0.65);
    float lampIntensity = pc.camPos.w * spotFactor * 2.8;

    float r_lamp = pc.fog.z * 2.5;
    float att_head = 1.0 / (1.0 + (d * d) / (r_lamp * r_lamp));

    float NdotV = max(dot(n, V), 0.0);
    vec3 headSpec = vec3(0.0);
    if (NdotV > 0.0) {
        float NdotH = NdotV;
        vec3 F_head = F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);
        headSpec = F_head * (pow(NdotH, specPow) * normFactor * specIntensity * att_head * lampIntensity * 2.4);

        // High-contrast anisotropic metallic sheen for pipes and conduits
        if (mid == 19u || fam == kFamRibbed) {
            vec3 T_aniso = abs(n.z) > 0.7 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
            vec3 anisoH = cross(n, T_aniso);
            float anisoDot = dot(anisoH, V);
            float anisoTerm = pow(max(1.0 - anisoDot * anisoDot, 0.0), specPow * 0.40);
            headSpec += F_head * (anisoTerm * normFactor * 2.5 * specIntensity * att_head * lampIntensity);
        }
    }

    float g_scat = 0.55;
    float cosTheta = dot(-V, rayDir);
    float hg_denom = max(1.0 + g_scat * g_scat - 2.0 * g_scat * cosTheta, 1e-4);
    float phase = (1.0 - g_scat * g_scat) / (hg_denom * sqrt(hg_denom));

    const vec3 kTungstenTint = vec3(1.04, 0.88, 0.68);
    float lampDirect = lampIntensity * att_head * NdotV;
    float lampScatter = lampIntensity * att_head * phase * 0.25;
    vec3 lampDiffuse = kTungstenTint * (lampDirect + lampScatter) * (1.0 - metallic);

    // 2. Sun / Fill Light
    vec3 L_fill = normalize(pc.sunDir.xyz);
    float NdotFill = max(dot(n, L_fill), 0.0);
    vec3 fillDiffuse = vec3(pc.sunDir.w * NdotFill * (1.0 - metallic));

    // 3. GPU LightGrid Point Lights (Ceiling fluorescent tubes with 100Hz micro-flicker, warm sodium emergency lamps)
    vec3 gridDiffuse = vec3(0.0);
    vec3 gridSpec = vec3(0.0);
    float timeSec = pc.torus.w;

#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
    vec3 gridMin = pc.camPos.xyz - vec3(32.0, 16.0, 32.0);
    vec3 gridExt = vec3(32.0, 16.0, 32.0);
    vec3 cellSize = vec3(2.0, 2.0, 2.0);
    uvec3 gridDim = uvec3(32, 16, 32);

    vec3 localPos = vWorldPos - gridMin;
    ivec3 cellCoord = ivec3(floor(localPos / cellSize));

    if (cellCoord.x >= 0 && cellCoord.x < int(gridDim.x) &&
        cellCoord.y >= 0 && cellCoord.y < int(gridDim.y) &&
        cellCoord.z >= 0 && cellCoord.z < int(gridDim.z)) {

        uint flatIdx = uint(cellCoord.x + cellCoord.y * int(gridDim.x) + cellCoord.z * int(gridDim.x * gridDim.y));
        LightGridCell cell = uGridCells[flatIdx];
        uint count = min(cell.count, 15u);

        for (uint k = 0u; k < count; ++k) {
            uint lightIdx = cell.lightIndices[k];
            if (lightIdx == 0u) continue;

            PointLight pt = uPointLights[lightIdx];

            vec3 toPt = pt.posRadius.xyz - vWorldPos;
            toPt -= 256.0 * floor((toPt + 128.0) / 256.0);

            float dPtSq = dot(toPt, toPt);
            float radius = pt.posRadius.w;

            if (dPtSq < radius * radius && dPtSq > 1e-6) {
                float dPt = sqrt(dPtSq);
                vec3 L_pt = toPt / dPt;

                float NdotL_pt = max(dot(n, L_pt), 0.0);
                if (NdotL_pt > 0.0) {
                    float dOverR = dPt / radius;
                    float dOverR2 = dOverR * dOverR;
                    float win = clamp(1.0 - dOverR2 * dOverR2, 0.0, 1.0);
                    float att_pt = (win * win) / (dPtSq + 0.15);

                    vec3 ptCol = pt.colorIntensity.rgb;
                    if (ptCol.r < ptCol.b * 1.15) {
                        // Ceiling Fluorescent Tube 100Hz AC magnetic ballast micro-flicker & cool phosphor tint
                        float flick = 1.0 + 0.045 * sin(timeSec * 628.3185 + pt.posRadius.x * 23.1 + pt.posRadius.y * 17.3 + pt.posRadius.z * 13.7);
                        ptCol *= flick * vec3(0.92, 0.98, 1.05);
                    } else if (ptCol.r > ptCol.b * 1.8) {
                        // Warm Sodium Emergency Lamp
                        ptCol = mix(ptCol, vec3(1.0, 0.58, 0.10), 0.45);
                    }

                    vec3 radiance = ptCol * (pt.colorIntensity.w * att_pt * 2.8);

                    gridDiffuse += radiance * NdotL_pt * (1.0 - metallic);

                    vec3 H_pt = normalize(L_pt + V);
                    float NdotH_pt = max(dot(n, H_pt), 0.0);
                    float VdotH_pt = max(dot(V, H_pt), 0.0);
                    vec3 F_pt = F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - VdotH_pt, 0.0, 1.0), 5.0);

                    gridSpec += radiance * F_pt * (pow(NdotH_pt, specPow) * normFactor * specIntensity * NdotL_pt * 1.45);
                }
            }
        }
    }
#endif

    // 4. Ambient, Ceiling Bounce & Corner AO
    float hemi = 0.5 + 0.5 * n.z;
    vec3 amb = pc.fog.w * mix(vec3(0.045, 0.052, 0.060), vec3(0.140, 0.130, 0.115), hemi);
    
    float ceilingBounce = max(n.z, 0.0) * 0.04;
    vec3 ceilingBounceCol = vec3(0.045, 0.042, 0.038) * ceilingBounce;
    amb += ceilingBounceCol;

    const float kAoFloor = 0.25;
    float ao = (kAoFloor + (1.0 - kAoFloor) * vAo) * cavity;
    float aoDirect = mix(1.0, ao, pc.torus.y);

    // 5. Subtle Grazing-Angle Specular Sheen (Fresnel Reflection for Damp Concrete Floor & Enamel)
    vec3 R = reflect(-V, n);
    float skyHemi = 0.5 + 0.5 * R.z;
    vec3 envRefl = mix(vec3(0.035, 0.042, 0.050), vec3(0.14, 0.13, 0.11), skyHemi);
    vec3 F_env = F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);
    vec3 envSpec = envRefl * F_env * (1.0 - roughness * 0.75) * specIntensity * 1.65;

    // Total Lit Surface Radiance
    vec3 lit = albedo * (amb * ao + (lampDiffuse + fillDiffuse + gridDiffuse) * aoDirect)
             + (kTungstenTint * headSpec + gridSpec + envSpec) * aoDirect;

    // Bioluminescent emission for Bio-Lab vats
    if (mid == 17u) {
        float bioWave = 0.85 + 0.15 * sin(timeSec * 3.5 + vWorldPos.x * 2.0 + vWorldPos.y * 2.0 + vWorldPos.z * 1.5);
        lit += vec3(0.04, 0.98, 0.40) * (bioWave * 2.2);
    }

    // ── Volumetric Fog Integration ───────────────────────────────────────────
    float samosborPulse =
        clamp((1.0 - pc.fog.y / (pc.torus.x * 0.5)) / 0.66, 0.0, 1.0);

    vec3 gridMinFog = pc.camPos.xyz - vec3(32.0, 16.0, 32.0);
    vec4 fogVol = march_volumetric_fog(
        pc.camPos.xyz,
        normalize(vWorldPos - pc.camPos.xyz),
        min(d, pc.fog.y),
        gl_FragCoord.xy,
        pc.camPos.xyz,
        pc.camPos.w,
        pc.fog.z,
        pc.sunDir.xyz,
        pc.sunDir.w,
        gridMinFog,
        vec3(32.0, 16.0, 32.0),
        vec3(2.0, 2.0, 2.0),
        timeSec,
        samosborPulse
    );
    lit = lit * fogVol.a + fogVol.rgb;

    const float kHeightFogScale = 0.04;
    float heightDensity = exp(-clamp(kHeightFogScale * vWorldPos.z, -3.0, 3.0));
    float effectiveDist = d * heightDensity;

    float fog = clamp((effectiveDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);

    float fogFlicker = 1.0 + samosborPulse * 0.35 * sin(timeSec * 22.0 + vWorldPos.x * 0.4 + vWorldPos.y * 0.3);
    fog = clamp(fog * fogFlicker, 0.0, 1.0);

    lit = mix(lit, vec3(0.0), fog);

    // ACES Filmic Tonemapping
    vec3 x = max(lit, vec3(0.0));
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    vec3 srgb = pow(mapped, vec3(1.0 / kGamma));

    outColor = vec4(srgb, 1.0);
}
