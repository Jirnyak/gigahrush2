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

// Animated Emissive Effects
float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float compute_animated_emissive(float baseEmissive, uint mat_id, vec3 worldPos, float phaseRad, float timeSec, float samosborPulse) {
    if (baseEmissive < 0.001) return 0.0;

    // Case A: High-frequency electrical flicker (for lamps / cabinets / bright lights)
    if (baseEmissive > 1.2) {
        float stepTime = floor(timeSec * 22.0 + phaseRad * 3.0);
        float stochasticFlicker = mix(1.0, step(0.20, hash11(stepTime)), 0.30);
        float hum = 1.0 + 0.06 * sin(timeSec * 60.0 * 6.2831853 + phaseRad);
        return baseEmissive * stochasticFlicker * hum;
    }

    // Case B: Bioluminescent Crystal / Organic Breathing Pulse
    if (mat_id == 0u || baseEmissive > 0.8) {
        float breathe = 1.0 + 0.28 * sin(timeSec * 2.2 + phaseRad)
                            + 0.10 * cos(timeSec * 4.3 + phaseRad * 1.7);
        return baseEmissive * max(breathe, 0.05);
    }

    // Case C: CRT Screen / Terminal & Control Panel Oscilloscope Scanlines
    if (mat_id == 12u || mat_id == 19u) {
        float scanline = sin(vWorldPos.y * 120.0 + timeSec * 15.0) * 0.20 + 0.80;
        float staticNoise = hash11(floor(vWorldPos.y * 80.0) + floor(timeSec * 35.0 + phaseRad)) * 0.25;
        float oscWave = exp(-180.0 * pow(fract(vWorldPos.x * 2.0) - (0.5 + 0.3 * sin(vWorldPos.z * 10.0 + timeSec * 6.0)), 2.0));

        // Dynamically scale CRT oscilloscope noise and wave distortion during Samosbor hazard (samosbor.pulse)
        staticNoise *= (1.0 + samosborPulse * 4.5);
        oscWave *= (1.0 + samosborPulse * 3.0 * (0.5 + 0.5 * sin(timeSec * 40.0)));
        return baseEmissive * (scanline + staticNoise + oscWave * 2.5);
    }

    // Case D: Acid Pool Chemical Undulation & Bubble Bursts
    float spatialWave = sin(timeSec * 3.2 + worldPos.x * 3.5 + worldPos.z * 3.5 + phaseRad);
    float bubblePop   = pow(max(sin(timeSec * 7.5 + phaseRad * 2.5), 0.0), 10.0) * 1.5;
    return baseEmissive * (0.80 + 0.25 * spatialWave + bubblePop);
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
    vec3 L = toCam / max(d, 1e-4);

    vec3 viewDir = -L;
    vec3 lightDir = normalize(vWorldPos - pc.camPos.xyz);

    // Headlamp forward light scattering (Henyey-Greenstein phase function)
    float g_scat = 0.55;
    float cosTheta = dot(viewDir, lightDir);
    float phase = (1.0 - g_scat * g_scat) / pow(max(1.0 + g_scat * g_scat - 2.0 * g_scat * cosTheta, 1e-4), 1.5);

    float r = pc.fog.z;
    float att = 1.0 / (1.0 + (d * d) / max(r * r, 1e-4));

    // Calibrated material roughness & Blinn-Phong specular
    float roughness = compute_prop_roughness(vMat, g);
    float specPow     = max(2.0 / (roughness * roughness * roughness * roughness + 1e-4) - 2.0, 1.0);
    float specIntensity = (1.0 - roughness) * 0.5;
    float spec = 0.0;
    vec3 V = L; // View vector towards camera
    if (dot(n_shading, L) > 0.0) {
        vec3 H = normalize(L + V);
        spec += pow(max(dot(n_shading, H), 0.0), specPow) * specIntensity * att * pc.camPos.w;
    }
    vec3 Lsun = normalize(pc.sunDir.xyz);
    if (pc.sunDir.w > 0.0 && dot(n_shading, Lsun) > 0.0) {
        vec3 Hsun = normalize(Lsun + V);
        spec += pow(max(dot(n_shading, Hsun), 0.0), specPow) * specIntensity * pc.sunDir.w;
    }
    // Metallic Anisotropic Specular Highlight for Pipes & Industrial Metal
    if (vMat == 4u || vMat == 3u) {
        vec3 T = abs(n_shading.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 anisotropicH = cross(n_shading, T);
        float anisoDot = dot(anisotropicH, L);
        float anisoSpec = pow(max(1.0 - anisoDot * anisoDot, 0.0), specPow * 0.5) * specIntensity * 1.2;
        spec += anisoSpec * att * pc.camPos.w;
    }

    float lampDirect  = pc.camPos.w * att * max(dot(n_shading, L), 0.0);
    float lampScatter = pc.camPos.w * att * phase * 0.25;
    float lamp = lampDirect + lampScatter;

    float fill = pc.sunDir.w * max(dot(n_shading, normalize(pc.sunDir.xyz)), 0.0);

    float hemi = 0.5 + 0.5 * n_shading.z;
    vec3 amb = pc.fog.w * mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.23, 0.21), hemi);

    const float kAoFloor = 0.32;
    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);

    vec3 lit = albedo * (amb * ao + vec3(lamp + fill) * aoDirect) + vec3(spec) * aoDirect;

    float timeSec = pc.torus.w;
    float samosborPulse = pc.torus.z > 0.0 ? pc.torus.z : clamp((1.0 - pc.fog.x / (128.0 * 0.30 * 2.0)) / 0.66, 0.0, 1.0);

    // Volumetric fog raymarching with 3D light grid lookup and Samosbor pulse scaling
    vec3 gridMin = pc.camPos.xyz - vec3(32.0, 16.0, 32.0);
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
        gridMin,
        vec3(32.0, 16.0, 32.0),
        vec3(2.0, 2.0, 2.0),
        timeSec,
        samosborPulse
    );
    lit = lit * fogVol.a + fogVol.rgb;

    // Emissive term with time-based animation and Samosbor pulse scaling
    float animEmissive = compute_animated_emissive(vEmissive, vMat, vWorldPos, vAnimPhase, timeSec, samosborPulse);

    if (animEmissive > 0.001) {
        vec3 emitCol = pow(vColor, vec3(kGamma));
        lit += emitCol * animEmissive;
    }

    // Бывшая «высотная» модуляция exp(-0.04*min(y,z)) — ДВОЙНОЙ грех: шов на
    // врапе тора плюс рудимент Y-up в выборе оси. Константа = значение прежней
    // формулы на жилых высотах (z≈40 м). [volumetric_fog.glsl]
    const float kFogDistScale = 0.20;
    float effectiveDist = d * kFogDistScale;
    float fog = clamp((effectiveDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);

    // Enforce fog = 1.0 at max toroidal distance pc.fog.y to protect wrap seam
    if (d >= pc.fog.y) {
        fog = 1.0;
    }

    lit = mix(lit, vec3(0.0), fog);

    vec3 srgb = pow(max(lit, vec3(0.0)), vec3(1.0 / kGamma));

    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    srgb += (ign - 0.5) / 255.0 * (1.0 - fog);

    outColor = vec4(srgb, 1.0);
}
