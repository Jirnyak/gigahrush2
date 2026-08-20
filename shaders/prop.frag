#version 450
#extension GL_GOOGLE_include_directive : require
// prop.frag — fragment shader for GPU-instanced prop meshes with Milestone 2 shading.

layout(location = 0) in vec3  vNormal;
layout(location = 1) in vec3  vColor;
layout(location = 2) in vec3  vWorldPos;
layout(location = 3) in float vAo;
layout(location = 4) flat in uint vMat;
layout(location = 5) flat in float vEmissive;
layout(location = 6) flat in uint  vFlags;
layout(location = 7) flat in float vAnimPhase;

#include "material_surface.glsl"

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl"
#include "flicker.glsl" // единое мерцание: та же функция, что у света (CPU)

// Настоящие тени: теневой сет вокселного зеркала через ОБЩИЙ с cube-пассом
// pipeline layout (set 2) — пропсы принимают тени мира. [ddalight.md]
#define GIGA_SHADOW_SET 2
#include "shadow_march.glsl"

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus; // w = uTime (seconds)
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

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

const float kNormGrain = 6.413;
const float kNormMask  = 2.293;
const float kMeanMask  = 0.4497;
const float kNormRib   = 1.4145;

float surface(uint id, vec2 uv, vec3 aw, float px, float g) {
    uint fam   = kMatFamily[min(id, kMatSurfaceCount - 1u)];
    float amp  = kMatSurface[min(id, kMatSurfaceCount - 1u)].x;
    float pitch= kMatSurface[min(id, kMatSurfaceCount - 1u)].y;

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
    float n = (g - 0.5) * kNormGrain;
    return mottle(amp, n);
}

// Derivative Normal Perturbation & Bump Mapping
vec3 construct_perturbed_normal(vec3 n_geom, uint mat_id, vec2 uv, vec3 aw, float px, float g_center) {
    uint mid = min(mat_id, kMatSurfaceCount - 1u);
    float bumpScale = kMatSurface[mid].w;

    if (bumpScale < 0.001) {
        return n_geom;
    }

    vec3 up = abs(n_geom.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, n_geom));
    vec3 B = cross(n_geom, T);

    const float eps = 0.002;
    // Grain's finest octave (~2 cm period) is far below the 4 mm tap spacing:
    // differencing across it decorrelates the shading normal from geometry
    // (58 deg median tilt — single-pixel specular sparks). Hold grain constant
    // across the taps so that octave cancels, exactly as the world pass's
    // compute_grad_uv already does.
    float g0 = grain(uv);
    float s_right = surface(mat_id, uv + vec2(eps, 0.0), aw, px, g0);
    float s_left  = surface(mat_id, uv - vec2(eps, 0.0), aw, px, g0);
    float s_top   = surface(mat_id, uv + vec2(0.0, eps), aw, px, g0);
    float s_bot   = surface(mat_id, uv - vec2(0.0, eps), aw, px, g0);

    float dSdu = (s_right - s_left) / (2.0 * eps);
    float dSdv = (s_top - s_bot)   / (2.0 * eps);

    // Residual step discontinuities (floor/fract families in surface()) still
    // divide by 0.004; cap the tilt so no tap can flip the normal past ~30 deg.
    vec3 tilt = bumpScale * (dSdu * T + dSdv * B);
    float tl = length(tilt);
    if (tl > 0.58) tilt *= 0.58 / tl;
    vec3 n_perturbed = n_geom - tilt;
    return normalize(n_perturbed);
}

// Material-Driven Roughness & Specular Variation
float compute_prop_roughness(uint mat_id, float g_noise) {
    uint mid = min(mat_id, kMatSurfaceCount - 1u);
    uint fam = kMatFamily[mid];
    float sigma = kMatSurface[mid].x;

    float baseRoughness = 0.50;
    if (fam == kFamSmooth || mat_id >= 3u) {
        baseRoughness = 0.22 + sigma * 1.5;
    } else if (fam == kFamRibbed) {
        baseRoughness = 0.42 + sigma;
    } else if (fam == kFamRust || fam == kFamRubble) {
        baseRoughness = 0.82 + sigma * 0.3;
    } else if (fam == kFamPlaster || fam == kFamPlank) {
        baseRoughness = 0.65;
    }

    float microVariation = (g_noise - 0.5) * 0.18;
    return clamp(baseRoughness + microVariation, 0.05, 0.98);
}

// Emissive носителя: профиль мерцания — из ЕГО СТРОКИ props.csv (биты 0..2
// vFlags), формула — та же единая функция, что красит ЕГО СВЕТ на CPU
// ([game/flicker.h]): плафон и свет пульсируют синхронно по построению.
// Бывший зоопарк Case A-D с ветками по mat_id и порогам baseEmissive умер —
// семантика через магические диапазоны числа против законов проекта.
// CRT (профиль 4) — не мерцание, а поверхностная анимация экрана: скан-линии
// и осциллограф, взвинчиваемые самосбором.
float compute_animated_emissive(float baseEmissive, uint flickerProfile, vec3 worldPos, float phaseRad, float timeSec, float samosborPulse) {
    if (baseEmissive < 0.001) return 0.0;

    if (flickerProfile == 4u) { // crt: анимация ЭКРАНА
        float scanline = sin(vWorldPos.y * 120.0 + timeSec * 15.0) * 0.20 + 0.80;
        float staticNoise = flicker_hash11(floor(vWorldPos.y * 80.0) + floor(timeSec * 35.0 + phaseRad)) * 0.25;
        float oscWave = exp(-180.0 * pow(fract(vWorldPos.x * 2.0) - (0.5 + 0.3 * sin(vWorldPos.z * 10.0 + timeSec * 6.0)), 2.0));
        staticNoise *= (1.0 + samosborPulse * 4.5);
        oscWave *= (1.0 + samosborPulse * 3.0 * (0.5 + 0.5 * sin(timeSec * 40.0)));
        return baseEmissive * (scanline + staticNoise + oscWave * 2.5);
    }

    return baseEmissive * flicker_factor(flickerProfile, worldPos, timeSec);
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

    // Apply procedural derivative normal perturbation
    vec3 n_shading = construct_perturbed_normal(n_geom, vMat, uv, aw, px, g);

    // Procedural albedo
    vec3 albedo = pow(vColor, vec3(kGamma));
    albedo *= surface(vMat, uv, aw, px, g);

    // Lighting vectors
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 V = toCam / max(d, 1e-4);

    // Calibrated material roughness & Blinn-Phong specular
    float roughness = compute_prop_roughness(vMat, g);
    float specPow     = max(2.0 / (roughness * roughness * roughness * roughness + 1e-4) - 2.0, 1.0);
    float specIntensity = (1.0 - roughness) * 0.5;

    // Прямой свет — ЕДИНЫЙ цикл по light grid: лампы этажа, фонарик в руке (свет
    // сетки), мобы, трассеры, конусы. [volumetric_fog.glsl]
    vec3 directDiffuse, directSpec;
    surface_light(vWorldPos, n_shading, V, specPow, specIntensity, pc.torus.x,
                  d, pc.fog.x, directDiffuse, directSpec);

    float spec = 0.0;
    vec3 Lsun = normalize(pc.sunDir.xyz);
    if (pc.sunDir.w > 0.0 && dot(n_shading, Lsun) > 0.0) {
        vec3 Hsun = normalize(Lsun + V);
        spec += pow(max(dot(n_shading, Hsun), 0.0), specPow) * specIntensity * pc.sunDir.w;
    }
    // Metallic Anisotropic Specular Highlight for Pipes & Industrial Metal.
    // Масштаб — по ФАКТИЧЕСКИ пришедшему прямому свету (бывший множитель
    // att*camPos.w знал только про убитый налобник).
    if (vMat == 4u || vMat == 3u) {
        vec3 T = abs(n_shading.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 anisotropicH = cross(n_shading, T);
        float anisoDot = dot(anisotropicH, V);
        float anisoSpec = pow(max(1.0 - anisoDot * anisoDot, 0.0), specPow * 0.5) * specIntensity * 1.2;
        float directLum = dot(directDiffuse, vec3(0.2126, 0.7152, 0.0722));
        spec += anisoSpec * directLum;
    }

    float fill = pc.sunDir.w * max(dot(n_shading, Lsun), 0.0);

    float hemi = 0.5 + 0.5 * n_shading.z;
    vec3 amb = pc.fog.w * mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.23, 0.21), hemi);

    const float kAoFloor = 0.32;
    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);

    vec3 lit = albedo * (amb * ao + (directDiffuse + vec3(fill)) * aoDirect) + (directSpec + vec3(spec)) * aoDirect;

    float timeSec = pc.torus.w;
    // torus.z IS the pulse: the CPU computes it every frame (main.cpp
    // `push.torus = {kWorldExtent, kAoDirect, samosborPulse, time}`) and 0 is
    // a legal value, not "unset". The old `> 0.0 ? : ` fallback re-derived the
    // pulse from pc.fog.x against a hand-computed 76.8 where the CPU passes
    // 64, so every prop pulsed at ~0.25 with no samosbor active — the bug
    // cube.frag already had fixed ([problems.md] §20) and this file did not.
    float samosborPulse = clamp(pc.torus.z, 0.0, 1.0);

    // Volumetric fog raymarching with world-aligned light grid & Samosbor pulse
    vec4 fogVol = march_volumetric_fog(
        pc.camPos.xyz,
        normalize(vWorldPos - pc.camPos.xyz),
        min(d, pc.fog.y),
        gl_FragCoord.xy,
        pc.sunDir.xyz,
        pc.sunDir.w,
        samosborPulse
    );
    lit = lit * fogVol.a + fogVol.rgb;

    // Emissive term with time-based animation and Samosbor pulse scaling
    float animEmissive = compute_animated_emissive(vEmissive, vFlags & 7u, vWorldPos, vAnimPhase, timeSec, samosborPulse);

    if (animEmissive > 0.001) {
        vec3 emitCol = pow(vColor, vec3(kGamma));
        lit += emitCol * animEmissive;
    }

    float fog = distance_fog(d, pc.fog.x, pc.fog.y);

    lit = mix(lit, vec3(0.0), fog);

    vec3 srgb = pow(max(lit, vec3(0.0)), vec3(1.0 / kGamma));

    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    srgb += (ign - 0.5) / 255.0 * (1.0 - fog);

    outColor = vec4(srgb, 1.0);
}
