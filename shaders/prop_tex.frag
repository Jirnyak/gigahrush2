#version 450
#extension GL_GOOGLE_include_directive : require
// prop_tex.frag — Prop shader variant with KTX2 triplanar texture sampling.
//
// Compiled with -DGIGA_PROP_ALBEDO_ARRAY when the texture array is available.
// Without it (plain prop.frag.spv), the procedural PBR path is used exclusively.
//
// Triplanar mapping samples the KTX2 texture array using world-space normals as
// blend weights. UV axes are world-aligned at 0.5 texels-per-metre (kPropTexScale).
// The three samples are blended by aw^k (k=4 gives sharp seams without the
// expensive smooth-step chain). Normal-map perturbation is blended triplanarly too.
//
// Descriptor layout (set=0):
//   binding 0: sampler2DArray uPropAlbedo     — BC7/ASTC SRGB
//   binding 1: sampler2DArray uPropNormal     — BC7/ASTC UNORM (tangent-space)
//   binding 2: sampler2DArray uPropRoughness  — BC7/ASTC UNORM single-channel
//
// One layer per PropShape material bucket:
//   Layer 0: corrugated iron  (pipes/beams — matId 4)
//   Layer 1: metal plate      (structural — matId 3)
//   Layer 2: rubber tiles     (floor grates — matId 2)
//   Layer 3: factory wall     (walls/cabinets — matId 1)
//   Layer 4: green metal rust (organic/anomalous — matId 0)
//   Layer 5: metal grate rusty (crates — matId 5)

layout(location = 0) in vec3  vNormal;
layout(location = 1) in vec3  vColor;
layout(location = 2) in vec3  vWorldPos;
layout(location = 3) in float vAo;
layout(location = 4) flat in uint  vMat;
layout(location = 5) flat in float vEmissive;
layout(location = 6) flat in uint  vFlags;
layout(location = 7) flat in float vAnimPhase;

#include "material_surface.glsl"

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus; // w = uTime (seconds)
} pc;

layout(location = 0) out vec4 outColor;

// ── texture array bindings (prop-specific set=1) ─────────────────────────────
#ifdef GIGA_PROP_ALBEDO_ARRAY
layout(set = 1, binding = 0) uniform sampler2DArray uPropAlbedo;
layout(set = 1, binding = 1) uniform sampler2DArray uPropNormal;
layout(set = 1, binding = 2) uniform sampler2DArray uPropRoughness;
// Texture scale: ~0.5 repeats per metre gives good-looking results for 2m cells
const float kPropTexScale = 0.5;
// Which matIds have live textures (bitmask from push constants)
// pc.torus.z = texture bitmask (reusing slot from cube pass, bit per matId layer)
#endif

// ── constants ────────────────────────────────────────────────────────────────
const float kGamma = 2.2;
const float kPi    = 3.14159265;

// ── hash / noise utilities ───────────────────────────────────────────────────
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

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// ── triplanar helpers ─────────────────────────────────────────────────────────

// Compute triplanar blend weights from absolute normal.
// Exponent k=4 gives sharp transitions at seams.
vec3 triplanar_weights(vec3 absNormal) {
    vec3 w = pow(absNormal, vec3(4.0));
    return w / (w.x + w.y + w.z + 1e-6);
}

#ifdef GIGA_PROP_ALBEDO_ARRAY
// Sample a 2DArray layer with triplanar UVs; returns linear-space RGB.
// The sRGB -> linear conversion is done in hardware (VK_FORMAT_*_SRGB).
vec3 triplanar_albedo(vec3 worldPos, vec3 weights, float layer) {
    vec2 uvX = worldPos.yz * kPropTexScale;
    vec2 uvY = worldPos.xz * kPropTexScale;
    vec2 uvZ = worldPos.xy * kPropTexScale;
    vec3 cX = texture(uPropAlbedo, vec3(uvX, layer)).rgb;
    vec3 cY = texture(uPropAlbedo, vec3(uvY, layer)).rgb;
    vec3 cZ = texture(uPropAlbedo, vec3(uvZ, layer)).rgb;
    return cX * weights.x + cY * weights.y + cZ * weights.z;
}

// Sample triplanar normal map; returns world-space perturbed normal.
// Uses Whiteout blending to preserve hemisphere orientation across axes.
vec3 triplanar_normal(vec3 worldPos, vec3 weights, vec3 geomNormal, float layer, float strength) {
    vec2 uvX = worldPos.yz * kPropTexScale;
    vec2 uvY = worldPos.xz * kPropTexScale;
    vec2 uvZ = worldPos.xy * kPropTexScale;

    // Sample tangent-space normals [0,1] -> [-1,1]
    vec3 tnX = texture(uPropNormal, vec3(uvX, layer)).xyz * 2.0 - 1.0;
    vec3 tnY = texture(uPropNormal, vec3(uvY, layer)).xyz * 2.0 - 1.0;
    vec3 tnZ = texture(uPropNormal, vec3(uvZ, layer)).xyz * 2.0 - 1.0;

    // Whiteout blend: remap the z-component so it stays hemisphere-correct
    tnX = vec3(tnX.xy + geomNormal.zy, abs(tnX.z) * geomNormal.x);
    tnY = vec3(tnY.xy + geomNormal.xz, abs(tnY.z) * geomNormal.y);
    tnZ = vec3(tnZ.xy + geomNormal.xy, abs(tnZ.z) * geomNormal.z);

    vec3 blended = normalize(tnX * weights.x + tnY * weights.y + tnZ * weights.z);
    return normalize(mix(geomNormal, blended, strength));
}

// Sample triplanar roughness (scalar channel).
float triplanar_roughness(vec3 worldPos, vec3 weights, float layer) {
    vec2 uvX = worldPos.yz * kPropTexScale;
    vec2 uvY = worldPos.xz * kPropTexScale;
    vec2 uvZ = worldPos.xy * kPropTexScale;
    float rX = texture(uPropRoughness, vec3(uvX, layer)).r;
    float rY = texture(uPropRoughness, vec3(uvY, layer)).r;
    float rZ = texture(uPropRoughness, vec3(uvZ, layer)).r;
    return rX * weights.x + rY * weights.y + rZ * weights.z;
}

// Map material id to texture array layer index.
// Matches the layer loading order in prop_pass.cpp::init.
float mat_to_tex_layer(uint matId) {
    if (matId == 4u) return 0.0;   // corrugated iron — pipes/beams
    if (matId == 3u) return 1.0;   // metal plate — structural
    if (matId == 2u) return 2.0;   // rubber tiles — floor
    if (matId == 1u) return 3.0;   // factory wall — cabinets
    if (matId == 0u) return 4.0;   // green metal rust — anomalous
    return 5.0;                     // metal grate rusty — crates (matId 5+)
}
#endif

// ── procedural surface (fallback or blend-in) ─────────────────────────────────

float mottle(float sigma, float n) {
    return exp(sigma * n - 0.5 * sigma * sigma);
}

float resolved(float px, float freq) {
    return clamp(1.0 - px * freq * 2.2, 0.0, 1.0);
}

float surface_proc(uint id, vec2 uv, float px, float g) {
    uint fam   = kMatFamily[min(id, kMatSurfaceCount - 1u)];
    float amp  = kMatSurface[min(id, kMatSurfaceCount - 1u)].x;
    float pitch= kMatSurface[min(id, kMatSurfaceCount - 1u)].y;

    const uint kFamSmooth  = 8u;
    const uint kFamRibbed  = 4u;
    const uint kFamRust    = 6u;
    const float kNormGrain = 6.413;
    const float kNormMask  = 2.293;
    const float kMeanMask  = 0.4497;
    const float kNormRib   = 1.4145;

    if (fam == kFamSmooth || id >= 3u) {
        float n = (g - 0.5) * kNormGrain;
        return mottle(amp * 0.5, n);
    }
    if (fam == kFamRibbed) {
        float rib = cos(uv.x * pitch * 6.2831853) * resolved(px, pitch);
        return mottle(amp, rib * kNormRib);
    }
    if (fam == kFamRust) {
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 2.85);
        float raw = lo * 0.65 + hi * 0.35;
        float mask = smoothstep(0.42, 0.62, raw);
        return mottle(amp, (mask - kMeanMask) * kNormMask);
    }
    float n = (g - 0.5) * kNormGrain;
    return mottle(amp, n);
}

// ── normal perturbation (derivative bump map) ─────────────────────────────────
vec3 bump_normal(vec3 n_geom, uint mat_id, vec2 uv, float px, float g) {
    uint mid = min(mat_id, kMatSurfaceCount - 1u);
    float bumpScale = kMatSurface[mid].w;
    if (bumpScale < 0.001) return n_geom;

    vec3 up = abs(n_geom.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, n_geom));
    vec3 B = cross(n_geom, T);

    const float eps = 0.002;
    float dSdu = (surface_proc(mat_id, uv+vec2(eps,0), px, grain(uv+vec2(eps,0))) -
                  surface_proc(mat_id, uv-vec2(eps,0), px, grain(uv-vec2(eps,0)))) / (2.0*eps);
    float dSdv = (surface_proc(mat_id, uv+vec2(0,eps), px, grain(uv+vec2(0,eps))) -
                  surface_proc(mat_id, uv-vec2(0,eps), px, grain(uv-vec2(0,eps)))) / (2.0*eps);

    return normalize(n_geom - bumpScale * (dSdu * T + dSdv * B));
}

// ── roughness model ───────────────────────────────────────────────────────────
float compute_roughness(uint mat_id, float g_noise) {
    uint mid = min(mat_id, kMatSurfaceCount - 1u);
    uint fam = kMatFamily[mid];
    float sigma = kMatSurface[mid].x;

    float base = 0.50;
    const uint kFamSmooth = 8u;
    const uint kFamRibbed = 4u;
    const uint kFamRust   = 6u;
    const uint kFamRubble = 7u;
    const uint kFamPlaster= 1u;
    const uint kFamPlank  = 2u;

    if (fam == kFamSmooth || mat_id >= 3u)            base = 0.22 + sigma * 1.5;
    else if (fam == kFamRibbed)                        base = 0.42 + sigma;
    else if (fam == kFamRust || fam == kFamRubble)    base = 0.82 + sigma * 0.3;
    else if (fam == kFamPlaster || fam == kFamPlank)  base = 0.65;

    return clamp(base + (g_noise - 0.5) * 0.18, 0.05, 0.98);
}

// ── animated emissive ─────────────────────────────────────────────────────────
float animated_emissive(float baseEmissive, uint mat_id, vec3 worldPos,
                         float phase, float t) {
    if (baseEmissive < 0.001) return 0.0;

    if (baseEmissive > 1.2) {
        float step_t  = floor(t * 22.0 + phase * 3.0);
        float flicker = mix(1.0, step(0.20, hash11(step_t)), 0.30);
        float hum     = 1.0 + 0.06 * sin(t * 60.0 * 6.2831853 + phase);
        return baseEmissive * flicker * hum;
    }
    if (mat_id == 0u || baseEmissive > 0.8) {
        float breathe = 1.0 + 0.28 * sin(t * 2.2 + phase)
                            + 0.10 * cos(t * 4.3 + phase * 1.7);
        return baseEmissive * max(breathe, 0.05);
    }
    float wave   = sin(t * 3.2 + worldPos.x * 3.5 + worldPos.z * 3.5 + phase);
    float bubble = pow(max(sin(t * 7.5 + phase * 2.5), 0.0), 10.0) * 1.5;
    return baseEmissive * (0.80 + 0.25 * wave + bubble);
}

// ── main ─────────────────────────────────────────────────────────────────────
void main() {
    vec3 n_geom = normalize(vNormal);

    // Triplanar UV (world-space) — primary UV for procedural fallback
    vec3 aw = abs(n_geom);
    vec2 uv = aw.z > 0.5 ? vWorldPos.xy
            : (aw.x > 0.5 ? vWorldPos.yz : vWorldPos.xz);
    uv /= 2.0;

    float g  = grain(uv);
    float px = max(fwidth(uv.x), fwidth(uv.y));

    // ── albedo ────────────────────────────────────────────────────────────────
    vec3 albedo;

#ifdef GIGA_PROP_ALBEDO_ARRAY
    vec3 tWeights   = triplanar_weights(aw);
    float texLayer  = mat_to_tex_layer(vMat);
    // Check if this layer has a valid texture (bitmask in pc.torus.z)
    uint layerBit   = 1u << uint(texLayer);
    bool hasTexture = (floatBitsToUint(pc.torus.z) & layerBit) != 0u;

    if (hasTexture) {
        // Photographic triplanar albedo (already in linear space via sRGB format)
        vec3 texAlbedo = triplanar_albedo(vWorldPos, tWeights, texLayer);
        // Tint the texture by the instance color (multiplicative)
        vec3 instColor = pow(vColor, vec3(kGamma));
        // Blend: 70% texture, 30% instance tint for material identity
        albedo = texAlbedo * mix(vec3(1.0), instColor, 0.30);
        // Modulate by procedural surface for fine micro-variation
        float surfMod = surface_proc(vMat, uv, px, g);
        albedo *= mix(1.0, surfMod, 0.25);
    } else {
        // Procedural fallback
        albedo = pow(vColor, vec3(kGamma));
        albedo *= surface_proc(vMat, uv, px, g);
    }
#else
    albedo = pow(vColor, vec3(kGamma));
    albedo *= surface_proc(vMat, uv, px, g);
#endif

    // ── normal ────────────────────────────────────────────────────────────────
    vec3 n_shading;
#ifdef GIGA_PROP_ALBEDO_ARRAY
    if ((floatBitsToUint(pc.torus.z) & (1u << uint(mat_to_tex_layer(vMat)))) != 0u) {
        float texLayer2 = mat_to_tex_layer(vMat);
        n_shading = triplanar_normal(vWorldPos, tWeights, n_geom, texLayer2, 0.6);
    } else {
        n_shading = bump_normal(n_geom, vMat, uv, px, g);
    }
#else
    n_shading = bump_normal(n_geom, vMat, uv, px, g);
#endif

    // ── roughness ─────────────────────────────────────────────────────────────
    float roughness;
#ifdef GIGA_PROP_ALBEDO_ARRAY
    float texLayerR = mat_to_tex_layer(vMat);
    uint  layerBitR = 1u << uint(texLayerR);
    if ((floatBitsToUint(pc.torus.z) & layerBitR) != 0u) {
        float texRough = triplanar_roughness(vWorldPos, tWeights, texLayerR);
        roughness = mix(texRough, compute_roughness(vMat, g), 0.3);
    } else {
        roughness = compute_roughness(vMat, g);
    }
#else
    roughness = compute_roughness(vMat, g);
#endif

    // ── lighting ──────────────────────────────────────────────────────────────
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d    = length(toCam);
    vec3 V     = toCam / max(d, 1e-4);

    // Headlamp Henyey-Greenstein scatter
    float g_hg   = 0.55;
    vec3 lightDir = normalize(vWorldPos - pc.camPos.xyz);
    float cosT    = dot(-V, lightDir);
    float phase   = (1.0 - g_hg * g_hg) /
                    pow(max(1.0 + g_hg * g_hg - 2.0 * g_hg * cosT, 1e-4), 1.5);

    float r   = pc.fog.z;
    float att = 1.0 / (1.0 + (d * d) / (r * r));

    // Blinn-Phong specular
    float specPow       = max(2.0 / (roughness * roughness * roughness * roughness + 1e-4) - 2.0, 1.0);
    float specIntensity = (1.0 - roughness) * 0.5;
    float spec = 0.0;

    float NdotL_head = dot(n_shading, V);
    if (NdotL_head > 0.0) {
        vec3 H = normalize(V + V); // V == L for headlamp (co-located)
        spec += pow(max(dot(n_shading, H), 0.0), specPow) * specIntensity * att * pc.camPos.w;
    }

    // Sun/fill specular
    vec3 Lsun = normalize(pc.sunDir.xyz);
    if (pc.sunDir.w > 0.0) {
        vec3 Hsun = normalize(Lsun + V);
        spec += pow(max(dot(n_shading, Hsun), 0.0), specPow) * specIntensity * pc.sunDir.w;
    }

    // Anisotropic metallic specular for matId 3 (metal plate) and 4 (corrugated iron)
    if (vMat == 4u || vMat == 3u) {
        vec3 T = abs(n_shading.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
        vec3 aniso = cross(n_shading, T);
        float anisoDot = dot(aniso, V);
        float anisoSpec = pow(max(1.0 - anisoDot * anisoDot, 0.0), specPow * 0.5)
                          * specIntensity * 1.2 * att * pc.camPos.w;
        spec += anisoSpec;
    }

    // Crystal Fresnel rim — sharp edge glow for anomalous props
    if (vMat == 0u) {
        float rim = 1.0 - max(dot(n_shading, V), 0.0);
        rim = pow(rim, 3.5);
        spec += rim * 0.4 * att * pc.camPos.w;
    }

    // Diffuse terms
    float lampDirect  = pc.camPos.w * att * max(dot(n_shading, V), 0.0);
    float lampScatter = pc.camPos.w * att * phase * 0.25;
    float lamp        = lampDirect + lampScatter;
    float fill        = pc.sunDir.w * max(dot(n_shading, Lsun), 0.0);

    float hemi = 0.5 + 0.5 * n_shading.z;
    vec3  amb  = pc.fog.w * mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.23, 0.21), hemi);

    const float kAoFloor = 0.32;
    float ao       = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);

    vec3 lit = albedo * (amb * ao + vec3(lamp + fill) * aoDirect) + vec3(spec) * aoDirect;

    // ── emissive ──────────────────────────────────────────────────────────────
    float timeSec      = pc.torus.w;
    float animEmissive = animated_emissive(vEmissive, vMat, vWorldPos, vAnimPhase, timeSec);

    if (animEmissive > 0.001) {
        vec3 emitCol = pow(vColor, vec3(kGamma));
        // Texture-tinted emissive for visual richness
#ifdef GIGA_PROP_ALBEDO_ARRAY
        float texLayerE = mat_to_tex_layer(vMat);
        uint  layerBitE = 1u << uint(texLayerE);
        if ((floatBitsToUint(pc.torus.z) & layerBitE) != 0u) {
            vec3 texEmit = triplanar_albedo(vWorldPos, triplanar_weights(aw), texLayerE);
            emitCol = mix(emitCol, texEmit, 0.4);
        }
#endif
        lit += emitCol * animEmissive;
    }

    // ── fog ───────────────────────────────────────────────────────────────────
    const float kHeightFogScale = 0.04;
    float heightPos     = vWorldPos.z;
    float heightDensity = exp(-clamp(kHeightFogScale * heightPos, -3.0, 3.0));
    float effectiveDist = d * heightDensity;
    float fogFactor     = clamp((effectiveDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
    if (d >= pc.fog.y) fogFactor = 1.0;

    lit = mix(lit, vec3(0.0), fogFactor);

    // ── tonemap + dither ──────────────────────────────────────────────────────
    // ACES Filmic Tonemapping (matches raymarch.frag / cube.frag)
    vec3 x = max(lit, vec3(0.0));
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    vec3 srgb = pow(mapped, vec3(1.0 / kGamma));
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    srgb += (ign - 0.5) / 255.0 * (1.0 - fogFactor);

    outColor = vec4(srgb, 1.0);
}
