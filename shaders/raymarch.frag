#version 450
#extension GL_GOOGLE_include_directive : require
// The world pass as a two-level DDA raymarch over the GPU voxel mirror
// ([render/voxel_mirror.h]) — stage 2 of the raymarch migration. Replaces the
// instanced-cube world draw: geometry is read per-ray straight from the same
// masks physics collides against, so destruction costs the renderer nothing
// beyond the mirror's 64 B/cell dirty upload. No meshing, no rebuild.
//
// SHADING PARITY IS THE CONTRACT. Everything below the "== shading ==" marker
// is a verbatim port of shaders/cube.frag (which body_pass keeps using for the
// crowd): same procedural families, same biome recolours, same headlamp /
// fill / ambient / light-grid / volumetric model, same fog, dither, and sRGB
// encode. The raster varyings become globals the marcher fills from the hit:
//   vWorldPos = ray hit point (camera-relative march => nearest toroidal image
//               by construction, matching cube.vert's placement rule)
//   vNormal   = the DDA face normal
//   vMat      = per-sub-voxel material (page ? page[bit] : CellType)
//   vColor    = the material albedo table (what CubeInstance::color carried)
//   vAo       = per-pixel sub-voxel corner AO (finer than the baked per-cell
//               27-bit mask — craters now shade honestly, the known limit in
//               [destruct.md])
// When cube.frag's world-only shading dies with the mesher, THIS becomes the
// single source.
//
// Depth is honest: gl_FragDepth = clip.z/clip.w through the SAME pc.viewProj
// the raster passes use, so bodies/props/particles occlude against voxel walls
// with zero changes to their pipelines ([render.md] hybrid contract).
//
// No 64-bit ints anywhere — masks are read as uint pairs (MoltenVK/Metal has
// no shader int64).

layout(location = 0) in vec2 vNdc;
layout(location = 0) out vec4 outColor;

// Per-material family + measured amplitude, GENERATED from data/materials.csv.
#include "material_surface.glsl"

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl" // set 1: the light grid, same as cube.frag

// --- set 0: the voxel mirror -------------------------------------------------
// Layouts mirror the CPU byte-for-byte (world/types.h macro_index, sub_bit).
layout(set = 0, binding = 0, std430) readonly buffer MaskBuf { uint uMasks[]; };     // 16 uints/cell
layout(set = 0, binding = 1, std430) readonly buffer TypeBuf { uint uTypes[]; };     // 2 cells/uint
layout(set = 0, binding = 2, std430) readonly buffer PageIdxBuf { uint uPageIdx[]; };// 1 uint/cell
layout(set = 0, binding = 3, std430) readonly buffer PoolBuf { uint uPagePool[]; };  // 256 uints/page
layout(set = 0, binding = 4, std430) readonly buffer ClassBuf { uint uClass[]; };    // 4 cells/uint
layout(set = 0, binding = 5) uniform MarchUbo {
    mat4 invViewProj;   // rays; inverse of pc.viewProj, CPU-inverted per frame
    vec4 albedo[32];    // display-referred material albedo (cube_pass kMaterial)
    vec4 timeParams;    // x = timeSec, y = samosborPulse, z = reserved, w = reserved
} ub;
layout(set = 0, binding = 6, std430) readonly buffer FluidBuf { float uFluid[]; };   // 1 float/cell
layout(set = 0, binding = 7, std430) readonly buffer StainIdxBuf { uint uStainIdx[]; }; // 1/cell
layout(set = 0, binding = 8, std430) readonly buffer StainPool { uint uStainPool[]; };  // 512 u32/page (RGBA8)

#ifdef GIGA_ALBEDO_ARRAY
// set 2: the photographic albedo/normal/roughness arrays CubePass loaded.
layout(set = 2, binding = 0) uniform sampler2DArray uAlbedo;
layout(set = 2, binding = 1) uniform sampler2DArray uNormal;
layout(set = 2, binding = 2) uniform sampler2DArray uRoughness;
const float kTexRepeat = 0.5;
#endif

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period; y = AO direct share; z = albedo tex mask;
                   // w = packed normal|roughness masks (textured) / uTime
} pc;

// cube.frag's varyings, filled by the marcher before the ported shading runs.
vec3 vNormal;
vec3 vColor;
vec3 vWorldPos;
float vAo;
uint vMat;

const float kGamma = 2.2;
const float kPi = 3.14159265359;

// =============================================================================
// == voxel fetch ==============================================================
// =============================================================================
const int kMacroDimX = 512;
const int kMacroDimY = 512;
const int kMacroDimZ = 16;
const float kCell = 2.0;
const float kVoxel = 0.25;

uint cell_index(ivec3 c) {
    ivec3 w = ivec3(c.x & (kMacroDimX - 1), c.y & (kMacroDimY - 1), c.z & (kMacroDimZ - 1));
    return uint(w.x) | (uint(w.y) << 9) | (uint(w.z) << 18);
}

uint cell_class(uint ci) { // 0 empty, 1 full, 2 partial
    return (uClass[ci >> 2] >> ((ci & 3u) * 8u)) & 0xFFu;
}

uint cell_type(uint ci) {
    uint w = uTypes[ci >> 1];
    return (ci & 1u) != 0u ? (w >> 16) & 0xFFFFu : w & 0xFFFFu;
}

bool sub_solid(uint ci, ivec3 s) {
    uint bit = uint(s.x) | (uint(s.y) << 3) | (uint(s.z) << 6);
    return ((uMasks[ci * 16u + (bit >> 5)] >> (bit & 31u)) & 1u) != 0u;
}

uint sub_mat(uint ci, ivec3 s) {
    uint pg = uPageIdx[ci];
    if (pg == 0xFFFFFFFFu) return cell_type(ci);
    uint bit = uint(s.x) | (uint(s.y) << 3) | (uint(s.z) << 6);
    uint w = uPagePool[pg * 256u + (bit >> 1)];
    return (bit & 1u) != 0u ? (w >> 16) & 0xFFFFu : w & 0xFFFFu;
}

vec3 sub_stain(uint ci, ivec3 s) {
    uint pg = uStainIdx[ci];
    if (pg == 0xFFFFFFFFu) return vec3(0.0);
    uint bit = uint(s.x) | (uint(s.y) << 3) | (uint(s.z) << 6);
    uint w = uStainPool[pg * 512u + bit];
    return vec3(float(w & 0xFFu), float((w >> 8) & 0xFFu),
                float((w >> 16) & 0xFFu)) * (1.0 / 255.0);
}

bool sub_solid_global(ivec3 g) {
    ivec3 c = ivec3(floor(vec3(g) / 8.0));
    if (c.z < 0 || c.z >= kMacroDimZ) return false;
    uint ci = cell_index(c);
    uint cls = cell_class(ci);
    if (cls == 0u) return false;
    if (cls == 1u) return true;
    return sub_solid(ci, g - c * 8);
}

// =============================================================================
// == two-level DDA ============================================================
// =============================================================================
struct Hit {
    float t;
    vec3 n;
    uint mat;
    uint ci;
    ivec3 sub;
    bool ok;
};

bool march_cell(uint ci, vec3 ro, vec3 rd, vec3 rinv, ivec3 stp, vec3 cellLo,
                float t0, float t1, int axisIn, inout Hit h) {
    vec3 e = ro + rd * (t0 + 1e-5);
    ivec3 s = clamp(ivec3(floor((e - cellLo) / kVoxel)), ivec3(0), ivec3(7));
    vec3 bound = cellLo + (vec3(s) + max(vec3(stp), vec3(0.0))) * kVoxel;
    vec3 sMax = (bound - ro) * rinv;
    vec3 sDelta = vec3(kVoxel) * abs(rinv);
    float t = t0;
    int axis = axisIn;
    for (int i = 0; i < 32; ++i) {
        if (sub_solid(ci, s)) {
            h.t = t;
            h.n = vec3(0.0);
            if (axis >= 0) h.n[axis] = -float(stp[axis]);
            else h.n = -rd;
            h.mat = sub_mat(ci, s);
            h.ci = ci;
            h.sub = s;
            h.ok = true;
            return true;
        }
        axis = sMax.x < sMax.y ? (sMax.x < sMax.z ? 0 : 2)
                               : (sMax.y < sMax.z ? 1 : 2);
        t = sMax[axis];
        if (t > t1) return false;
        s[axis] += stp[axis];
        if (s[axis] < 0 || s[axis] > 7) return false;
        sMax[axis] += sDelta[axis];
    }
    return false;
}

Hit march(vec3 ro, vec3 rd, float tCap) {
    Hit h;
    h.ok = false;
    h.t = tCap;
    h.n = vec3(0.0, 0.0, 1.0);
    h.mat = 0u;
    h.ci = 0u;
    h.sub = ivec3(0);

    rd.x = abs(rd.x) < 1e-6 ? (rd.x >= 0.0 ? 1e-6 : -1e-6) : rd.x;
    rd.y = abs(rd.y) < 1e-6 ? (rd.y >= 0.0 ? 1e-6 : -1e-6) : rd.y;
    rd.z = abs(rd.z) < 1e-6 ? (rd.z >= 0.0 ? 1e-6 : -1e-6) : rd.z;
    vec3 rinv = 1.0 / rd;
    ivec3 stp = ivec3(sign(rd));

    ivec3 c = ivec3(floor(ro / kCell));
    vec3 bound = (vec3(c) + max(vec3(stp), vec3(0.0))) * kCell;
    vec3 tMax = (bound - ro) * rinv;
    vec3 tDelta = vec3(kCell) * abs(rinv);
    float t = 0.0;
    int axis = -1;

    for (int i = 0; i < 224; ++i) {
        if (c.z >= 0 && c.z < kMacroDimZ) {
            uint ci = cell_index(c);
            uint cls = cell_class(ci);
            if (cls != 0u) {
                float tExit = min(min(tMax.x, tMax.y), tMax.z);
                if (cls == 1u) {
                    vec3 q = ro + rd * (t + 1e-4);
                    ivec3 s = clamp(ivec3(floor((q - vec3(c) * kCell) / kVoxel)),
                                    ivec3(0), ivec3(7));
                    h.t = t;
                    h.n = vec3(0.0);
                    if (axis >= 0) h.n[axis] = -float(stp[axis]);
                    else h.n = -rd;
                    h.mat = sub_mat(ci, s);
                    h.ci = ci;
                    h.sub = s;
                    h.ok = true;
                    return h;
                }
                if (march_cell(ci, ro, rd, rinv, stp, vec3(c) * kCell, t,
                               min(tExit, tCap), axis, h))
                    return h;
            }
        }
        axis = tMax.x < tMax.y ? (tMax.x < tMax.z ? 0 : 2)
                               : (tMax.y < tMax.z ? 1 : 2);
        t = tMax[axis];
        if (t > tCap) break;
        c[axis] += stp[axis];
        tMax[axis] += tDelta[axis];
    }
    return h;
}

float voxel_ao(vec3 hitP, vec3 n) {
    ivec3 ni = ivec3(round(n));
    ivec3 g = ivec3(floor(hitP / kVoxel - 0.5 * vec3(ni)));
    ivec3 a = g + ni;
    ivec3 u = abs(ni.x) == 1 ? ivec3(0, 1, 0) : ivec3(1, 0, 0);
    ivec3 v = abs(ni.z) == 1 ? ivec3(0, 1, 0) : ivec3(0, 0, 1);
    vec3 f = fract(hitP / kVoxel);
    float fu = dot(f, vec3(u));
    float fv = dot(f, vec3(v));
    int du = fu > 0.5 ? 1 : -1;
    int dv = fv > 0.5 ? 1 : -1;
    float wu = abs(fu - 0.5) * 2.0;
    float wv = abs(fv - 0.5) * 2.0;
    float s1 = sub_solid_global(a + u * du) ? 1.0 : 0.0;
    float s2 = sub_solid_global(a + v * dv) ? 1.0 : 0.0;
    float s3 = sub_solid_global(a + u * du + v * dv) ? 1.0 : 0.0;
    float occ = (s1 > 0.5 && s2 > 0.5)
                    ? max(wu, wv)
                    : (s1 * wu + s2 * wv + s3 * min(wu, wv)) / 3.0;
    return 1.0 - clamp(occ, 0.0, 1.0);
}

// =============================================================================
// == procedural noise & surface mathematics ====================================
// =============================================================================

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
float surface_height(uint fam, vec2 uv, float pitch, float g, bool isHorizontal, uint mid, float h_in_room) {
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
        vec2 q = uv * pitch;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.40, 0.50, max(e.x, e.y));
        float dome = (1.0 - 4.0 * (e.x * e.x + e.y * e.y)) * 0.18;
        return -0.6 * grout + dome + 0.08 * (g - 0.5);
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
            if (h_in_room < 0.58) {
                // Lower enamel paint with peeling chips
                float wearArea = smoothstep(0.45, 0.65, vnoise(uv * 1.5));
                float chipNoise = vnoise(uv * 14.0) * 0.7 + vnoise(uv * 42.0) * 0.3;
                float peeled = wearArea * smoothstep(0.56, 0.62, chipNoise);
                float chipEdge = peeled * 0.25;
                return chipEdge + (g - 0.5) * 0.15 - 0.28 * s;
            } else if (h_in_room < 0.61) {
                float trimRidge = sin((h_in_room - 0.58) / 0.03 * 3.14159) * 0.30;
                return trimRidge - 0.20 * s;
            } else {
                // Upper whitewash / plaster: fine fissures & grit
                float fineGrit = (g - 0.5) * 0.20 + vnoise(uv * 48.0) * 0.10;
                float cracks = -0.20 * smoothstep(0.46, 0.52, abs(vnoise(uv * 18.0) - 0.5));
                return fineGrit + cracks - 0.28 * s;
            }
        } else {
            return (g - 0.5) * 0.20 - 0.22 * s;
        }
    }
    if (fam == kFamRust || mid == 14u) {
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 3.0);
        float mask = smoothstep(0.38, 0.62, lo * 0.65 + hi * 0.35);
        float microRust = vnoise(uv * pitch * 10.0) * mask * 0.40;
        return -0.75 * mask + microRust + (g - 0.5) * 0.18 * (1.0 - mask);
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
        // Hub Pad & Extract Pad: 1m modular deck plates with bevelled seams
        vec2 plateDist = abs(fract(vWorldPos.xy) - 0.5);
        float seamDepth = smoothstep(0.44, 0.49, max(plateDist.x, plateDist.y));
        return -seamDepth * 0.45 + 0.08 * (g - 0.5);
    }
    if (mid == 6u) {
        // Steel Door leaf: perimeter bevel
        vec2 dEdge = abs(fract(uv) - 0.5);
        float bevel = smoothstep(0.40, 0.48, max(dEdge.x, dEdge.y));
        return -0.50 * bevel + 0.12 * (g - 0.5);
    }
    if (fam == kFamSmooth) {
        float microPores = vnoise(uv * 64.0) * 0.18 + (g - 0.5) * 0.22;
        float pits = -0.22 * smoothstep(0.68, 0.85, vnoise(uv * 24.0));
        return microPores + pits - 0.25 * seam(uv);
    }
    return 0.0;
}

vec2 compute_grad_uv(uint fam, vec2 uv, float pitch, float g, bool isHorizontal, uint mid, float h_in_room) {
    float eps = 0.0025;
    float hu_p = surface_height(fam, uv + vec2(eps, 0.0), pitch, g, isHorizontal, mid, h_in_room);
    float hu_m = surface_height(fam, uv - vec2(eps, 0.0), pitch, g, isHorizontal, mid, h_in_room);
    float hv_p = surface_height(fam, uv + vec2(0.0, eps), pitch, g, isHorizontal, mid, h_in_room);
    float hv_m = surface_height(fam, uv - vec2(0.0, eps), pitch, g, isHorizontal, mid, h_in_room);
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
    vec4 p0 = ub.invViewProj * vec4(vNdc, 0.0, 1.0);
    vec4 p1 = ub.invViewProj * vec4(vNdc, 1.0, 1.0);
    vec3 ro = pc.camPos.xyz;
    vec3 rd = normalize(p1.xyz / p1.w - p0.xyz / p0.w);

    Hit h = march(ro, rd, pc.fog.y);
    if (!h.ok) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragDepth = 1.0;
        return;
    }

    vWorldPos = ro + rd * h.t;
    vNormal = h.n;
    vMat = min(h.mat, 31u);
    vColor = ub.albedo[vMat].rgb;

    float fl = uFluid[h.ci];
    float tint = fl > 0.05 ? clamp(fl, 0.0, 1.0) : 0.0;
    if (tint > 0.0)
        vColor = mix(vColor, vec3(0.15, 0.35, 0.85), tint);

    vec3 stain = sub_stain(h.ci, h.sub);
    float stainAmt = max(stain.r, max(stain.g, stain.b));
    if (stainAmt > 0.0)
        vColor = mix(vColor, stain * 0.85, clamp(stainAmt * 1.2, 0.0, 0.92));

    vAo = voxel_ao(vWorldPos, h.n);

    vec4 clip = pc.viewProj * vec4(vWorldPos, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w, 0.0, 1.0);

    // ── Shading & Lighting ───────────────────────────────────────────────────
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
    float h_in_room = fract(vWorldPos.z * 0.5);

    // Enhanced bump multiplier
    float bumpMultiplier = 1.0;
    if (mid == 1u || mid == 4u) bumpMultiplier = 1.8;
    else if (fam == kFamRust) bumpMultiplier = 1.6;
    else if (fam == kFamPlaster || fam == kFamGeneric) bumpMultiplier = 1.4;
    else if (fam == kFamRibbed || mid == 19u) bumpMultiplier = 1.3;
    else if (fam == kFamTread || mid == 7u || mid == 5u) bumpMultiplier = 1.4;

    float effectiveBump = bump * bumpMultiplier;
    vec3 n = n_geom;
    if (effectiveBump > 0.001) {
        vec2 grad_uv = compute_grad_uv(fam, uv, kMatSurface[mid].y, g, isHorizontal, mid, h_in_room);
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

    // ── Albedo & Soviet Wall Band / Pad Texturing ─────────────────────────────
    vec3 albedo = pow(vColor, vec3(kGamma));

    if (!isHorizontal && (fam == kFamGeneric || fam == kFamPlaster || mid == 8u || mid == 1u || mid == 4u || mid == 0u)) {
        // Authentic Soviet Khrushchevka vertical wall band:
        if (h_in_room < 0.58) {
            // Lower 1.16m: Glossy Soviet enamel oil paint (teal-green stairwell tone)
            float wearArea = smoothstep(0.45, 0.65, vnoise(uv * 1.5));
            float chipNoise = vnoise(uv * 14.0) * 0.7 + vnoise(uv * 42.0) * 0.3;
            float peeled = wearArea * smoothstep(0.56, 0.62, chipNoise);
            vec3 paintCol = vec3(0.035, 0.15, 0.13);
            vec3 plasterCol = vec3(0.24, 0.21, 0.16);
            albedo = mix(paintCol, plasterCol, peeled);
        } else if (h_in_room < 0.61) {
            // Dark separating border trim
            albedo = vec3(0.035, 0.030, 0.025);
        } else {
            // Upper wall: aged yellowed chalky whitewash
            albedo = vec3(0.26, 0.23, 0.18);
        }
        albedo *= surface(vMat, uv, aw, px, g);
        albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
    } else if (mid == 7u) {
        // Fast-travel Hub Pad: Modular 1m x 1m steel deck plates with antialiased seams & hazard markings
        vec2 tileUv = fract(vWorldPos.xy);
        vec2 dSeam = abs(tileUv - 0.5);
        float seamW = 0.03 + px * 3.0;
        float plateSeam = max(smoothstep(0.5 - seamW, 0.5, dSeam.x), smoothstep(0.5 - seamW, 0.5, dSeam.y));
        
        float slabHash = hash21(floor(vWorldPos.xy));
        vec3 baseMetal = mix(vec3(0.038, 0.046, 0.055), vec3(0.055, 0.065, 0.078), slabHash);
        
        // Central technological chevron stencil
        vec2 padCenter = fract(vWorldPos.xy * 0.125) * 8.0 - 4.0;
        float padR = length(padCenter);
        float ring = smoothstep(0.08, 0.04, abs(padR - 1.8));
        vec3 cyanStencil = vec3(0.03, 0.55, 0.70);
        
        // Hazard chevrons on pad perimeter
        float borderSeam = seam(vWorldPos.xy * 0.125);
        float diag = fract((vWorldPos.x + vWorldPos.y) * 2.0);
        vec3 hazardStripe = mix(vec3(0.55, 0.42, 0.05), vec3(0.03, 0.03, 0.03), step(0.5, diag));
        
        albedo = mix(baseMetal, cyanStencil, ring * 0.75);
        albedo = mix(albedo, vec3(0.012, 0.015, 0.018), plateSeam * 0.85);
        albedo = mix(albedo, hazardStripe, borderSeam * 0.80);
    } else if (mid == 5u) {
        // Extract Pad: Modular steel deck with emerald evac chevrons
        vec2 tileUv = fract(vWorldPos.xy);
        vec2 dSeam = abs(tileUv - 0.5);
        float seamW = 0.03 + px * 3.0;
        float plateSeam = max(smoothstep(0.5 - seamW, 0.5, dSeam.x), smoothstep(0.5 - seamW, 0.5, dSeam.y));
        
        float slabHash = hash21(floor(vWorldPos.xy));
        vec3 baseMetal = mix(vec3(0.040, 0.050, 0.042), vec3(0.058, 0.072, 0.060), slabHash);
        
        vec2 padCenter = fract(vWorldPos.xy * 0.125) * 8.0 - 4.0;
        float padR = length(padCenter);
        float ring = smoothstep(0.08, 0.04, abs(padR - 1.8));
        vec3 greenStencil = vec3(0.05, 0.65, 0.28);
        
        float borderSeam = seam(vWorldPos.xy * 0.125);
        float diag = fract((vWorldPos.x - vWorldPos.y) * 2.0);
        vec3 hazardStripe = mix(vec3(0.06, 0.55, 0.24), vec3(0.03, 0.03, 0.03), step(0.5, diag));
        
        albedo = mix(baseMetal, greenStencil, ring * 0.75);
        albedo = mix(albedo, vec3(0.012, 0.018, 0.014), plateSeam * 0.85);
        albedo = mix(albedo, hazardStripe, borderSeam * 0.80);
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

    if (mid == 1u || mid == 4u) {
        roughness = clamp(0.72 + (g - 0.5) * 0.15, 0.55, 0.90);
        metallic = 0.02;
        specIntensity = 0.30;
    } else if (mid == 6u) {
        roughness = clamp(0.30 + (g - 0.5) * 0.12, 0.16, 0.48);
        metallic = 0.85;
        specIntensity = 1.10;
    } else if (mid == 19u) {
        roughness = clamp(0.18 + (g - 0.5) * 0.10, 0.10, 0.38);
        metallic = 0.92;
        specIntensity = 1.50;
    } else if (mid == 7u || mid == 5u) {
        vec2 tileUv = fract(vWorldPos.xy);
        vec2 dSeam = abs(tileUv - 0.5);
        float plateSeam = max(smoothstep(0.46, 0.5, dSeam.x), smoothstep(0.46, 0.5, dSeam.y));
        roughness = mix(0.18, 0.70, plateSeam);
        metallic = mix(0.88, 0.10, plateSeam);
        specIntensity = mix(1.50, 0.30, plateSeam);
    } else if (fam == kFamRibbed || mid == 10u || mid == 12u) {
        roughness = clamp(0.32 + (g - 0.5) * 0.15, 0.20, 0.52);
        metallic = 0.80;
        specIntensity = 1.00;
    } else if (fam == kFamTread || mid == 13u || mid == 16u) {
        vec2 q = uv * kMatSurface[mid].y;
        q.x += 0.5 * floor(q.y);
        vec2 f = fract(q) - 0.5;
        float stud = 1.0 - smoothstep(0.24, 0.38, abs(f.x) + abs(f.y));
        roughness = mix(0.70, 0.20, stud);
        metallic = mix(0.40, 0.92, stud);
        specIntensity = mix(0.40, 1.35, stud);
    } else if (fam == kFamRust || mid == 14u) {
        float lo = vnoise(uv * kMatSurface[mid].y);
        float hi = vnoise(uv * kMatSurface[mid].y * 2.85);
        float rustMask = smoothstep(0.38, 0.64, lo * 0.65 + hi * 0.35);
        roughness = mix(0.30, 0.92, rustMask);
        metallic = mix(0.88, 0.05, rustMask);
        specIntensity = mix(1.05, 0.15, rustMask);
        cavity = mix(1.0, 0.60, rustMask);
    } else if (fam == kFamPlaster || fam == kFamGeneric || mid == 8u || mid == 0u) {
        if (!isHorizontal) {
            if (h_in_room < 0.58) {
                float wearArea = smoothstep(0.45, 0.65, vnoise(uv * 1.5));
                float chipNoise = vnoise(uv * 14.0) * 0.7 + vnoise(uv * 42.0) * 0.3;
                float peeled = wearArea * smoothstep(0.56, 0.62, chipNoise);
                roughness = mix(0.16 + (g - 0.5) * 0.08, 0.82, peeled);
                metallic = mix(0.06, 0.0, peeled);
                specIntensity = mix(1.30, 0.25, peeled);
            } else if (h_in_room < 0.61) {
                roughness = 0.55;
                metallic = 0.0;
                specIntensity = 0.40;
            } else {
                roughness = clamp(0.78 + (g - 0.5) * 0.12, 0.60, 0.92);
                metallic = 0.0;
                specIntensity = 0.28;
            }
        } else {
            roughness = 0.72;
            metallic = 0.0;
            specIntensity = 0.30;
        }
    } else if (fam == kFamPlank || mid == 9u) {
        roughness = clamp(0.28 + (g - 0.5) * 0.10, 0.16, 0.45);
        metallic = 0.02;
        specIntensity = 0.85;
    } else if (mid == 17u) {
        roughness = 0.04;
        metallic = 0.10;
        specIntensity = 2.60;
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

    // Wet patches & Stains
    if (tint > 0.0) {
        roughness = mix(roughness, 0.03, tint * 0.95);
        specIntensity = mix(specIntensity, 2.4, tint);
        albedo *= mix(1.0, 0.55, tint);
    }
    if (stainAmt > 0.0) {
        roughness = mix(roughness, 0.12, clamp(stainAmt * 1.2, 0.0, 0.85));
        specIntensity = mix(specIntensity, 1.6, clamp(stainAmt, 0.0, 0.8));
    }

    // ── Vectors & Lighting Formulation ───────────────────────────────────────
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 V = toCam / max(d, 1e-4);

    vec3 F0 = mix(vec3(0.04), albedo, metallic);

    float r4 = roughness * roughness * roughness * roughness;
    float specPow = max(2.0 / (r4 + 1e-4) - 2.0, 1.0);
    float normFactor = (specPow + 8.0) / (8.0 * kPi);

    // 1. Headlamp Focused Spotlight Beam
    vec4 pCenter0 = ub.invViewProj * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 pCenter1 = ub.invViewProj * vec4(0.0, 0.0, 1.0, 1.0);
    vec3 camForward = normalize(pCenter1.xyz / pCenter1.w - pCenter0.xyz / pCenter0.w);

    float cosAngle = dot(rd, camForward);
    float spotFactor = smoothstep(0.55, 0.95, cosAngle);
    float lampIntensity = pc.camPos.w * mix(0.10, 0.85, spotFactor);

    float r_lamp = pc.fog.z;
    float att_head = 1.0 / (1.0 + (d * d) / (r_lamp * r_lamp));

    float NdotV = max(dot(n, V), 0.0);
    vec3 headSpec = vec3(0.0);
    if (NdotV > 0.0) {
        float NdotH = NdotV;
        vec3 F_head = F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);
        headSpec = F_head * (pow(NdotH, specPow) * normFactor * specIntensity * att_head * lampIntensity);

        // Anisotropic highlight for conduit pipes & corrugated metal
        if (mid == 19u || fam == kFamRibbed) {
            vec3 T_aniso = abs(n.z) > 0.7 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
            vec3 anisoH = cross(n, T_aniso);
            float anisoDot = dot(anisoH, V);
            float anisoTerm = pow(max(1.0 - anisoDot * anisoDot, 0.0), specPow * 0.35);
            headSpec += F_head * (anisoTerm * normFactor * 0.9 * specIntensity * att_head * lampIntensity);
        }
    }

    float g_scat = 0.55;
    vec3 lightDir = normalize(vWorldPos - pc.camPos.xyz);
    float cosTheta = dot(-V, lightDir);
    float hg_denom = max(1.0 + g_scat * g_scat - 2.0 * g_scat * cosTheta, 1e-4);
    float phase = (1.0 - g_scat * g_scat) / (hg_denom * sqrt(hg_denom));

    const vec3 kTungstenTint = vec3(1.00, 0.85, 0.58);
    float lampDirect = lampIntensity * att_head * NdotV;
    float lampScatter = lampIntensity * att_head * phase * 0.25;
    vec3 lampDiffuse = kTungstenTint * (lampDirect + lampScatter) * (1.0 - metallic);

    // 2. Sun / Fill Light
    vec3 L_fill = normalize(pc.sunDir.xyz);
    float NdotFill = max(dot(n, L_fill), 0.0);
    vec3 fillDiffuse = vec3(pc.sunDir.w * NdotFill * (1.0 - metallic));

    // 3. 3D LightGrid Point Lights (Ceiling fluorescent tubes, wall lamps, etc.)
    // Note: Light index 0 is the player headlamp which is computed above with the focused beam model.
    vec3 gridDiffuse = vec3(0.0);
    vec3 gridSpec = vec3(0.0);

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
            if (lightIdx == 0u) continue; // Skip headlamp (calculated with spotlight cone above)

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
                    // Windowed inverse-square attenuation
                    float dOverR = dPt / radius;
                    float dOverR2 = dOverR * dOverR;
                    float win = clamp(1.0 - dOverR2 * dOverR2, 0.0, 1.0);
                    float att_pt = (win * win) / (dPtSq + 0.25);

                    vec3 radiance = pt.colorIntensity.rgb * (pt.colorIntensity.w * att_pt * 2.8);

                    gridDiffuse += radiance * NdotL_pt * (1.0 - metallic);

                    vec3 H_pt = normalize(L_pt + V);
                    float NdotH_pt = max(dot(n, H_pt), 0.0);
                    float VdotH_pt = max(dot(V, H_pt), 0.0);
                    vec3 F_pt = F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - VdotH_pt, 0.0, 1.0), 5.0);

                    gridSpec += radiance * F_pt * (pow(NdotH_pt, specPow) * normFactor * specIntensity * NdotL_pt);
                }
            }
        }
    }
#endif

    // 4. Ambient & Corner AO
    float hemi = 0.5 + 0.5 * n.z;
    vec3 amb = pc.fog.w * mix(vec3(0.008, 0.010, 0.012), vec3(0.026, 0.024, 0.020), hemi);

    const float kAoFloor = 0.28;
    float ao = (kAoFloor + (1.0 - kAoFloor) * vAo) * cavity;
    float aoDirect = mix(1.0, ao, pc.torus.y);

    // 5. Grazing Angle Ambient / Floor Specular Sheen (Fresnel Reflection)
    vec3 R = reflect(-V, n);
    float skyHemi = 0.5 + 0.5 * R.z;
    vec3 envRefl = mix(vec3(0.015, 0.020, 0.025), vec3(0.08, 0.07, 0.05), skyHemi);
    vec3 F_env = F0 + (vec3(1.0) - F0) * pow(clamp(1.0 - NdotV, 0.0, 1.0), 5.0);
    vec3 envSpec = envRefl * F_env * (1.0 - roughness) * specIntensity;

    // Total Lit Surface Radiance
    vec3 lit = albedo * (amb * ao + (lampDiffuse + fillDiffuse + gridDiffuse) * aoDirect)
             + (kTungstenTint * headSpec + gridSpec + envSpec) * aoDirect;

    // ── Volumetric Fog Integration ───────────────────────────────────────────
    float samosborPulse = ub.timeParams.y;
    float timeSec = ub.timeParams.x;

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

    // ACES Filmic Tone Mapping to linear display range [0, 1]
    vec3 x = max(lit, vec3(0.0));
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    vec3 srgb = pow(mapped, vec3(1.0 / kGamma));
    outColor = vec4(srgb, 1.0);
}
