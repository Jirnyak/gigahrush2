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
// crowd): same procedural families, same biome recolours, same light-grid /
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
// ПОЛУРЕЗНЫЙ СВЕТ (ddalight.md, после опровержения квад-теней 2026-08-24):
// три модуля из ОДНОГО исходника. -DGIGA_LIGHT_HALF — производитель света:
// полурезный кадр, свой первичный DDA, surface_light со ВСЕМИ теневыми
// лучами, выход — диффуз (до альбедо) + t луча в альфе и спекуляр. Обычный
// модуль с -DGIGA_LIGHT_SAMPLED — потребитель: вместо своего surface_light
// берёт свет 4 полурез-текселей билатерально (глубинный гейт по t). Фрагментов
// со светом вчетверо меньше при ЛЮБОМ разрешении рендера — это и есть рычаг,
// который квад-шеринг дать не мог (SIMD-лок-степ).
#ifdef GIGA_LIGHT_HALF
layout(location = 0) out vec4 outLightDiffuse; // rgb = диффуз до альбедо, a = t (м; <0 = промах)
layout(location = 1) out vec4 outLightSpec;    // rgb = спекуляр (окрашен светом)
#else
layout(location = 0) out vec4 outColor;
#endif

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
    vec4 albedo[64];    // display-referred material albedo (38 строк + запас)
    vec4 timeParams;    // x = timeSec, y = samosborPulse, z = reserved, w = reserved
    uvec4 texMaskAN;    // albedo lo,hi; normal lo,hi — 64-битные маски карт
    uvec4 texMaskR;     // roughness lo,hi (К1-2: float-путь корёжил маску)
} ub;

// 64-битная маска парой u32: id материалов доходят до 37 (двойники).
bool mat_has_map(uint lo, uint hi, uint mid) {
    return ((mid < 32u ? (lo >> mid) : (hi >> (mid - 32u))) & 1u) != 0u;
}
// binding 6 (fluid) УМЕР: воду двигает и рисует мир-автомат (страницы).
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
    vec4 camPos;   // xyz = camera world position, w = МЁРТВАЯ ЛЕЙНА (нуль)
    vec4 fog;      // x = fog start, y = fog end, z = МЁРТВАЯ ЛЕЙНА, w = ambient
    vec4 torus;    // x = wrap period; y = AO direct share; z = albedo tex mask;
                   // w = packed normal|roughness masks (textured) / uTime
} pc;

#ifdef GIGA_LIGHT_SAMPLED
// Полурезный свет полупасса ([render/raymarch_pass.h] record_light). Сет —
// последний в лейауте: 3 у текстурного модуля (2 занят альбедо-массивами),
// 2 у процедурного.
#ifdef GIGA_ALBEDO_ARRAY
layout(set = 3, binding = 0) uniform sampler2D uHalfDiffuse;
layout(set = 3, binding = 1) uniform sampler2D uHalfSpec;
#else
layout(set = 2, binding = 0) uniform sampler2D uHalfDiffuse;
layout(set = 2, binding = 1) uniform sampler2D uHalfSpec;
#endif

// БИЛАТЕРАЛЬНАЯ выборка полурезного света: 4 ближайших полурез-текселя,
// вес = билинейный × близость глубины (альфа хранит t первичного луча
// полупасса). Глубинный гейт режет чужие тексели на разрыве (край стены —
// свет не течёт через угол); если чужие все — ближайший по глубине.
// Гейт 32: вес падает вдвое при ошибке глубины 1/32 ≈ 3% — порядок
// субвокселя на дистанции ~8 м (выведено, не подобрано).
void sample_half_light(float d, out vec3 outDiff, out vec3 outSpec) {
    vec2 hxy = gl_FragCoord.xy * 0.5 - 0.5;
    ivec2 base = ivec2(floor(hxy));
    vec2 f = hxy - vec2(base);
    ivec2 sz = textureSize(uHalfDiffuse, 0);
    vec3 accD = vec3(0.0), accS = vec3(0.0);
    float accW = 0.0;
    vec3 bestD = vec3(0.0), bestS = vec3(0.0);
    float bestErr = 1e30;
    for (int i = 0; i < 4; ++i) {
        ivec2 o = ivec2(i & 1, i >> 1);
        ivec2 c = clamp(base + o, ivec2(0), sz - 1);
        vec4 sd = texelFetch(uHalfDiffuse, c, 0);
        if (sd.a < 0.0) continue; // полутексель промахнулся (пустота/даль)
        vec4 sp = texelFetch(uHalfSpec, c, 0);
        float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
        float err = abs(sd.a - d) / max(d, 1.0);
        float w = bw / (1.0 + 32.0 * err);
        accD += sd.rgb * w;
        accS += sp.rgb * w;
        accW += w;
        if (err < bestErr) { bestErr = err; bestD = sd.rgb; bestS = sp.rgb; }
    }
    if (accW > 1e-4) {
        outDiff = accD / accW;
        outSpec = accS / accW;
    } else {
        outDiff = bestD;
        outSpec = bestS;
    }
}
#endif

// cube.frag's varyings, filled by the marcher before the ported shading runs.
vec3 vNormal;
vec3 vColor;
vec3 vWorldPos;
float vAo;
uint vMat;

// СРЕДЫ НА ЛУЧЕ (инкремент 6, рендер сред): прозрачные атомы (жидкость,
// газ — по фазе строки; рендер фазу читать ВПРАВЕ, S16.2 запрещает её
// только движению) не останавливают марш — копят оптическую глубину и
// цвет, поверхность за ними красится поглощением Бэра. Выводы коэффициентов:
// вода — видимость ~5.5 м (T=5% на 5.5 м -> k=0.55 1/м); газ читаем на
// ~8 м (k=0.35).
const float kAbsorbLiquid = 0.55;
const float kAbsorbGas = 0.35;
// ПОВЕРХНОСТЬ ЖИДКОСТИ (фикс «регрессии» видимости 2026-08-24: тонкий край
// лужи поглощал ~4% — невидим, лужа выглядела съёжившейся): первый вход
// луча в жидкость даёт фиксированную оптическую плёнку — граница фаз видна
// независимо от толщины (0.5 ~ эквивалент 0.9 м воды, вклад ~40%).
const float kLiquidSurface = 0.5;
float gMediaDepth = 0.0;
vec3 gMediaTint = vec3(0.0);
bool gLiquidEntered = false;

const float kGamma = 2.2;

// =============================================================================
// == voxel fetch ==============================================================
// =============================================================================
const int kMacroDim = GIGA_MACRO_DIM;         // -D из CMakeLists <- world/types.h
const float kCell = GIGA_CELL_SIZE;
const float kVoxel = kCell / float(GIGA_SUB_DIM);

uint cell_index(ivec3 c) {
    c &= (kMacroDim - 1); // torus: power-of-two wrap is one AND per axis
    return uint(c.x) | (uint(c.y) << 7) | (uint(c.z) << 14);
}

uint cell_class(uint ci) { // 0 empty, 1 full, 2 partial, 3 partial+материя сред
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

// Material of one sub-voxel: the sub_material page when the cell is mixed,
// else its uniform CellType — sub_material_at(), the world/destruct.h contract.
uint sub_mat(uint ci, ivec3 s) {
    uint pg = uPageIdx[ci];
    if (pg == 0xFFFFFFFFu) return cell_type(ci);
    uint bit = uint(s.x) | (uint(s.y) << 3) | (uint(s.z) << 6);
    uint w = uPagePool[pg * 256u + (bit >> 1)];
    return (bit & 1u) != 0u ? (w >> 16) & 0xFFFFu : w & 0xFFFFu;
}

// The stain of one sub-voxel ([world/stain.h]): additive RGB painted by
// blood/urine/scorch. RGBA8 in the pool; alpha unused.
vec3 sub_stain(uint ci, ivec3 s) {
    uint pg = uStainIdx[ci];
    if (pg == 0xFFFFFFFFu) return vec3(0.0);
    uint bit = uint(s.x) | (uint(s.y) << 3) | (uint(s.z) << 6);
    uint w = uStainPool[pg * 512u + bit];
    return vec3(float(w & 0xFFu), float((w >> 8) & 0xFFu),
                float((w >> 16) & 0xFFu)) * (1.0 / 255.0);
}

// Solidity of one sub-voxel by GLOBAL (unwrapped) sub coordinates — the AO taps.
bool sub_solid_global(ivec3 g) {
    ivec3 c = ivec3(floor(vec3(g) / 8.0));
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
    uint ci; // wrapped macro cell index of the solid voxel, for the fluid tint
    ivec3 sub; // the solid atom's local 0..7 coords, for the stain fetch
    bool ok;
};

// March one cell's 8^3 bits between ray times t0..t1. `axisIn` is the axis the
// macro DDA stepped to enter this cell (-1 on the camera's own cell).
// `matter` — клетка класса 3 (материя сред, CANON S16): субвоксель занят и
// тогда, когда бита маски нет, но материал страницы не воздух — так лужа
// видна ДО рендера сред (инкремент 6: прозрачность/поверхность). Обычные
// клетки (класс 2) не платят этот фетч вовсе.
bool march_cell(uint ci, vec3 ro, vec3 rd, vec3 rinv, ivec3 stp, vec3 cellLo,
                float t0, float t1, int axisIn, bool matter, inout Hit h) {
    vec3 e = ro + rd * (t0 + 1e-5);
    ivec3 s = clamp(ivec3(floor((e - cellLo) / kVoxel)), ivec3(0), ivec3(7));
    vec3 bound = cellLo + (vec3(s) + max(vec3(stp), vec3(0.0))) * kVoxel;
    vec3 sMax = (bound - ro) * rinv;
    vec3 sDelta = vec3(kVoxel) * abs(rinv);
    float t = t0;
    int axis = axisIn;
    for (int i = 0; i < 32; ++i) {
        if (matter && !sub_solid(ci, s)) {
            // Класс-3 клетка: немасочный не-воздух — ВСЕГДА среда (закон
            // чтения: немасочного твёрдого атома не существует). Прозрачный
            // проход: копим сегмент атома и маршируем дальше.
            uint mm = sub_mat(ci, s);
            if (mm != 0u) {
                float tNext =
                    min(min(min(sMax.x, sMax.y), sMax.z), t1);
                float k =
                    kMatPhase[mm] == 1u ? kAbsorbLiquid : kAbsorbGas;
                float wgt = k * max(tNext - t, 0.0);
                if (kMatPhase[mm] == 1u && !gLiquidEntered) {
                    gLiquidEntered = true;
                    wgt += kLiquidSurface; // плёнка границы фаз
                }
                gMediaDepth += wgt;
                gMediaTint += ub.albedo[min(mm, 63u)].rgb * wgt;
            }
        }
        if (sub_solid(ci, s)) {
            h.t = t;
            h.n = vec3(0.0);
            if (axis >= 0) h.n[axis] = -float(stp[axis]);
            else h.n = -rd; // camera embedded in a solid voxel
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

    // Degenerate components poison 1/rd with NaNs at exact cell boundaries.
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

    // 64-cell fog radius; sqrt(3) diagonal and slack bound the loop.
    for (int i = 0; i < 224; ++i) {
        uint ci = cell_index(c);
        uint cls = cell_class(ci);
        if (cls != 0u) {
            float tExit = min(min(tMax.x, tMax.y), tMax.z);
            if (cls == 1u) {
                // Fully solid: the entry face is the hit — no bit tests.
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
                           min(tExit, tCap), axis, cls == 3u, h))
                return h;
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

// Per-pixel sub-voxel corner AO: the two edge neighbours and the diagonal on
// the air side of the hit face, weighted by where inside the voxel face the
// pixel sits — the same three-tap rule as cube.vert corner_ao, evaluated at
// 0.25 m atoms per pixel instead of 2 m cells per vertex.
float voxel_ao(vec3 hitP, vec3 n) {
    ivec3 ni = ivec3(round(n));
    ivec3 g = ivec3(floor(hitP / kVoxel - 0.5 * vec3(ni))); // the solid voxel
    ivec3 a = g + ni;                                       // its air neighbour
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
    // Both edges solid = a closed inside corner: full occlusion, like the
    // special case in corner_ao that stops seams glowing.
    float occ = (s1 > 0.5 && s2 > 0.5)
                    ? max(wu, wv)
                    : (s1 * wu + s2 * wv + s3 * min(wu, wv)) / 3.0;
    return 1.0 - clamp(occ, 0.0, 1.0);
}

// Тень поверхности: булев DDA-луч к источнику ПО ТОЙ ЖЕ геометрии, что
// физика и пули, — та же двухуровневая DDA, что march(), но ответ один бит:
// без материала, нормали и текстурной страницы. Аудит 2026-08-20: полный
// march() платил за sub_mat/нормаль ради «перекрыт/нет» на КАЖДЫЙ теневой
// луч (главный едок кадра); у растровых пассов shadow_march.glsl всегда
// отвечал мгновенно. Семантика тени бит в бит: стоп на первом твёрдом
// субвокселе. Прокарвил дыру — свет хлынул в тот же кадр: луч читает тот же
// обновлённый воксельный mirror. Смещения старта/финиша — у вызывающего.
bool shadow_cell_occluded(uint ci, vec3 ro, vec3 rd, vec3 rinv, ivec3 stp,
                          vec3 cellLo, float t0, float t1) {
    vec3 e = ro + rd * (t0 + 1e-5);
    ivec3 s = clamp(ivec3(floor((e - cellLo) / kVoxel)), ivec3(0), ivec3(7));
    vec3 bound = cellLo + (vec3(s) + max(vec3(stp), vec3(0.0))) * kVoxel;
    vec3 sMax = (bound - ro) * rinv;
    vec3 sDelta = vec3(kVoxel) * abs(rinv);
    for (int i = 0; i < 32; ++i) {
        // ТЕНЬ ПРОЩАЕТ ПРОЗРАЧНЫЙ МАТЕРИАЛ, НЕ СВЕТЯЩИЙСЯ (решение владельца
        // 2026-08-24): условие — колонка light_transparent из materials.csv,
        // прозрачность эмиттеров и воздуха из неё ВЫВЕДЕНА (эмиттер не
        // преграда своему свету — светящийся шар светит во все стороны;
        // поймано владельцем 2026-08-24), а стекло получается строкой CSV:
        // свет проходит, материя стоит. Тот же закон у бейка видимости —
        // material_passes_light в [game/light_vis_bake.cpp]; менять только
        // ВМЕСТЕ, обе стороны читают одну колонку. Материал берётся тем же
        // sub_mat, что и рендер.
        if (sub_solid(ci, s) &&
            kMatLightPass[min(sub_mat(ci, s), kMatSurfaceCount - 1u)] == 0u)
            return true;
        int axis = sMax.x < sMax.y ? (sMax.x < sMax.z ? 0 : 2)
                                   : (sMax.y < sMax.z ? 1 : 2);
        if (sMax[axis] > t1) return false;
        s[axis] += stp[axis];
        if (s[axis] < 0 || s[axis] > 7) return false;
        sMax[axis] += sDelta[axis];
    }
    return false;
}

float giga_shadow(vec3 p, vec3 dirToLight, float dist) {
    if (dist <= 0.0) return 1.0;
    vec3 rd = dirToLight;
    rd.x = abs(rd.x) < 1e-6 ? (rd.x >= 0.0 ? 1e-6 : -1e-6) : rd.x;
    rd.y = abs(rd.y) < 1e-6 ? (rd.y >= 0.0 ? 1e-6 : -1e-6) : rd.y;
    rd.z = abs(rd.z) < 1e-6 ? (rd.z >= 0.0 ? 1e-6 : -1e-6) : rd.z;
    vec3 rinv = 1.0 / rd;
    ivec3 stp = ivec3(sign(rd));
    ivec3 c = ivec3(floor(p / kCell));
    vec3 bound = (vec3(c) + max(vec3(stp), vec3(0.0))) * kCell;
    vec3 tMax = (bound - p) * rinv;
    vec3 tDelta = vec3(kCell) * abs(rinv);
    float t = 0.0;
    for (int i = 0; i < 224; ++i) {
        uint ci = cell_index(c);
        uint cls = cell_class(ci);
        if (cls == 1u) return 0.0; // полная клетка — перекрыто без бит-тестов
        if (cls != 0u) {
            float tExit = min(min(tMax.x, tMax.y), tMax.z);
            if (shadow_cell_occluded(ci, p, rd, rinv, stp, vec3(c) * kCell, t,
                                     min(tExit, dist)))
                return 0.0;
        }
        int axis = tMax.x < tMax.y ? (tMax.x < tMax.z ? 0 : 2)
                                   : (tMax.y < tMax.z ? 1 : 2);
        t = tMax[axis];
        if (t > dist) return 1.0;
        c[axis] += stp[axis];
        tMax[axis] += tDelta[axis];
    }
    return 1.0;
}

// =============================================================================
// == shading — verbatim port of cube.frag (single-sourced here once the
// == mesher and cube.frag's world half are deleted) ===========================
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

    // Z-up world: floors/ceilings have |n.z| ~ 1. Testing Y here shaded
    // ceilings with the wall band logic and walls with the floor path.
    bool isHorizontal = (abs(aw.z) > 0.7);

    if (fam == kFamGeneric) {
        if (!isHorizontal) {
            float h_in_room = fract(vWorldPos.z * 0.5);
            vec3 wallColorMult;
            float wallGloss = 1.0;
            if (h_in_room < 0.58) {
                wallColorMult = vec3(0.42, 0.65, 0.85);
                wallGloss = 1.25;
            } else if (h_in_room < 0.61) {
                wallColorMult = vec3(0.22, 0.25, 0.28);
                wallGloss = 0.80;
            } else {
                wallColorMult = vec3(1.05, 0.98, 0.88);
                wallGloss = 0.90;
            }
            float stain = vnoise(uv * 3.5) * 0.25 + vnoise(uv * 12.0) * 0.15;
            float s = seam(uv);
            return ((1.0 - 0.22 * 0.5) + 0.22 * g) * (1.0 - 0.35 * s) * wallGloss;
        } else {
            float amount = 0.26;
            return ((1.0 - amount * 0.5) + amount * g);
        }
    }

    if (fam == kFamSmooth) {
        return mottle(sigma, (g - 0.5) * kNormGrain);
    }

    if (fam == kFamPlaster) {
        if (!isHorizontal) {
            float h_in_room = fract(vWorldPos.z * 0.5);
            float wallGloss = (h_in_room < 0.58) ? 1.20 : 0.90;
            float stain = vnoise(uv * pitch);
            float n = (g - 0.5) * kNormGrain * 0.78 + (stain - 0.5) * kNormNoise * 0.62;
            float s = seam(uv);
            return mottle(sigma, n) * (1.0 - 0.32 * s) * wallGloss;
        } else {
            float stain = vnoise(uv * pitch);
            float n = (g - 0.5) * kNormGrain * 0.78 + (stain - 0.5) * kNormNoise * 0.62;
            return mottle(sigma, n);
        }
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

float surface_height(uint fam, vec2 uv, float pitch, float g, bool isHorizontal) {
    if (fam == kFamRibbed) {
        float rib = cos(uv.x * pitch * 6.2831853);
        float trough = smoothstep(-0.2, -0.95, rib);
        return rib - 0.5 * trough;
    }
    if (fam == kFamTread) {
        vec2 q = uv * pitch;
        q.x += 0.5 * floor(q.y);
        vec2 f = fract(q) - 0.5;
        float stud = 1.0 - smoothstep(0.28, 0.40, abs(f.x) + abs(f.y));
        return stud * (1.0 + 0.3 * (f.x + f.y));
    }
    if (fam == kFamTile) {
        vec2 q = uv * pitch;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.42, 0.5, max(e.x, e.y));
        return -grout;
    }
    if (fam == kFamPlank) {
        float row = floor(uv.y * pitch);
        float along = uv.x * 5.0 + hash21(vec2(row, 7.0)) * 3.0;
        float jAcross = smoothstep(0.42, 0.5, abs(fract(uv.y * pitch) - 0.5));
        float jAlong = smoothstep(0.46, 0.5, abs(fract(along) - 0.5));
        float streak = vnoise(vec2(uv.x * 40.0, uv.y * pitch * 8.0));
        return -0.6 * jAcross - 0.4 * jAlong + 0.2 * streak;
    }
    if (fam == kFamPlaster) {
        // Советская стена в три пояса (порт форка 16004b86, гейт — СЕМЬЯ
        // материала, не floorIdx: один материал обязан выглядеть одинаково
        // на любом этаже). Граница поясов — та же 0.58 доли клетки, что уже
        // делит глянец в surface_albedo: рельеф и блеск режутся ОДНОЙ линией.
        float stain = vnoise(uv * pitch);
        if (isHorizontal) {
            // Плиты пола/потолка: швы по 2-метровой сетке клеток.
            vec2 slabDist = abs(fract(vWorldPos.xy * 0.5) - 0.5);
            float slabSeam = smoothstep(0.46, 0.50, max(slabDist.x, slabDist.y));
            return stain * 0.5 + g * 0.25 - 0.5 * slabSeam;
        }
        float s = seam(uv);
        float h_in_room = fract(vWorldPos.z * 0.5);
        if (h_in_room < 0.58) {
            // Нижняя панель: масляная эмаль, облупленная пятнами износа —
            // скол приподнят кромкой и просажен теллом.
            float wearArea = smoothstep(0.42, 0.65, vnoise(uv * 1.5));
            float chipNoise = vnoise(uv * 14.0) * 0.70 + vnoise(uv * 42.0) * 0.30;
            float peeled = wearArea * smoothstep(0.55, 0.62, chipNoise);
            return peeled * 0.28 - 0.15 * peeled + (g - 0.5) * 0.16 - 0.28 * s;
        } else if (h_in_room < 0.66) {
            // Бортик-отбивка между эмалью и побелкой.
            float trimRidge = sin((h_in_room - 0.58) / 0.08 * 3.14159265) * 0.35;
            return trimRidge - 0.20 * s;
        }
        // Побелка: мелкое зерно и волосяные трещины.
        float fineGrit = (g - 0.5) * 0.20 + vnoise(uv * 48.0) * 0.10;
        float cracks = -0.22 * smoothstep(0.46, 0.52, abs(vnoise(uv * 18.0) - 0.5));
        return fineGrit + cracks - 0.28 * s;
    }
    if (fam == kFamRust) {
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 2.85);
        float mask = smoothstep(0.42, 0.62, lo * 0.65 + hi * 0.35);
        return -mask + 0.3 * (g - 0.5) * mask;
    }
    if (fam == kFamRubble) {
        float warp = vnoise(uv * 2.3);
        vec2 q = uv * pitch + warp * 2.5;
        float chunk = hash21(floor(q)) - 0.5;
        vec2 e = abs(fract(q) - 0.5);
        float crack = smoothstep(0.36, 0.5, max(e.x, e.y));
        return chunk * (1.0 - crack) - 0.8 * crack;
    }
    if (fam == kFamGeneric) {
        float s = isHorizontal ? 0.0 : seam(uv);
        return -0.3 * s + 0.1 * g;
    }
    return 0.0;
}

vec2 compute_grad_uv(uint fam, vec2 uv, float pitch, float g, bool isHorizontal) {
    float eps = 0.005;
    float h0 = surface_height(fam, uv, pitch, g, isHorizontal);
    float hu = surface_height(fam, uv + vec2(eps, 0.0), pitch, g, isHorizontal);
    float hv = surface_height(fam, uv + vec2(0.0, eps), pitch, g, isHorizontal);
    return vec2(hu - h0, hv - h0) / eps;
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
    // Ray through this pixel: unproject the near and far NDC points with the
    // CPU-inverted matrix, so ray generation matches the raster projection
    // bit-for-bit (same Y flip, same [0,1] clip depth).
    vec4 p0 = ub.invViewProj * vec4(vNdc, 0.0, 1.0);
    vec4 p1 = ub.invViewProj * vec4(vNdc, 1.0, 1.0);
    vec3 ro = pc.camPos.xyz;
    vec3 rd = normalize(p1.xyz / p1.w - p0.xyz / p0.w);

    Hit h = march(ro, rd, pc.fog.y);
#ifdef GIGA_LIGHT_HALF
    // ПРОИЗВОДИТЕЛЬ ПОЛУРЕЗНОГО СВЕТА: первичный DDA свой (четверть цены
    // полного кадра), весь световой цикл с теневыми лучами — здесь, выход —
    // диффуз до альбедо + t луча (для глубинного гейта потребителя) и
    // спекуляр. Ни тумана, ни альбедо, ни глубины — это делает полный кадр.
    if (!h.ok) {
        outLightDiffuse = vec4(0.0, 0.0, 0.0, -1.0);
        outLightSpec = vec4(0.0);
        return;
    }
    {
        vec3 P = ro + rd * h.t;
        vec3 n = normalize(h.n);
        vec3 toCam = pc.camPos.xyz - P;
        float d = length(toCam);
        vec3 V = toCam / max(d, 1e-4);
        // Нормаль — ГЕОМЕТРИЧЕСКАЯ: бамп-наклон субпиксельный, полурезная
        // билатераль его всё равно усреднила бы. Спекуляр — шершавость 0.5,
        // как у процедурного пути полного кадра.
        float roughness = 0.50;
        float specPow = max(
            2.0 / (roughness * roughness * roughness * roughness + 1e-4) - 2.0,
            1.0);
        float specIntensity = (1.0 - roughness) * 0.25;
        vec3 dd, ss;
        surface_light(P, n, V, specPow, specIntensity, pc.torus.x, d, pc.fog.x,
                      dd, ss);
        outLightDiffuse = vec4(dd, h.t);
        outLightSpec = vec4(ss, 0.0);
    }
#else
    if (!h.ok) {
        // Past the fog radius everything is black — but среды на луче красят
        // и пустоту (взгляд сквозь толщу воды в бездну).
        vec3 miss = vec3(0.0);
        if (gMediaDepth > 0.0) {
            float mT = exp(-gMediaDepth);
            vec3 mediaCol = gMediaTint / max(gMediaDepth, 1e-4);
            miss = mediaCol * 0.30 * (1.0 - mT);
            vec3 mx = max(miss, vec3(0.0));
            miss = clamp((mx * (2.51 * mx + 0.03)) /
                             (mx * (2.43 * mx + 0.59) + 0.14),
                         0.0, 1.0);
            miss = pow(miss, vec3(1.0 / kGamma));
        }
        outColor = vec4(miss, 1.0);
        gl_FragDepth = 1.0;
        return;
    }

    vWorldPos = ro + rd * h.t;
    vNormal = h.n;
    vMat = min(h.mat, 63u);
    vColor = ub.albedo[vMat].rgb;
    // Fluid-тинт УМЕР (чистка 2026-08-24): вода — материя автомата, её
    // рисуют сами water-атомы (albedo строки); прозрачность — инкремент 6.
    // Stains paint over everything else — wet organic matter on the surface.
    // Strength follows the strongest channel (paint coverage), hue follows the
    // accumulated mix, so blood + urine reads as their blend, emergently.
    vec3 stain = sub_stain(h.ci, h.sub);
    float stainAmt = max(stain.r, max(stain.g, stain.b));
    if (stainAmt > 0.0)
        vColor = mix(vColor, stain * 0.85, clamp(stainAmt * 1.2, 0.0, 0.92));
    vAo = voxel_ao(vWorldPos, h.n);

    // Honest depth through the same matrix the raster passes push.
    vec4 clip = pc.viewProj * vec4(vWorldPos, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w, 0.0, 1.0);

    // -- from here down: cube.frag main(), verbatim --------------------------
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

    vec3 n = n_geom;
    if (bump > 0.001) {
        vec2 grad_uv = compute_grad_uv(fam, uv, kMatSurface[mid].y, g, isHorizontal);
        vec3 grad_world;
        if (aw.z > 0.5) {
            grad_world = vec3(-grad_uv.x * sign(n_geom.z), -grad_uv.y * sign(n_geom.z), 0.0);
        } else if (aw.x > 0.5) {
            grad_world = vec3(0.0, -grad_uv.x * sign(n_geom.x), -grad_uv.y * sign(n_geom.x));
        } else {
            grad_world = vec3(-grad_uv.x * sign(n_geom.y), 0.0, -grad_uv.y * sign(n_geom.y));
        }
        // Step discontinuities (floor/fract in surface_height) divide by the
        // 5 mm tap — an unbounded gradient flips the shading normal and one
        // pixel catches full additive specular on a flat dark surface
        // (measured: 0.6-1.2% of lino/tread/rubble pixels at 6.5x flat).
        // Cap the tilt so a spike cannot exceed ~30 deg.
        vec3 tilt = bump * grad_world;
        float tl = length(tilt);
        if (tl > 0.58) tilt *= 0.58 / tl;
        n = normalize(n_geom + tilt);
    }

#ifdef GIGA_ALBEDO_ARRAY
    // Маски карт — из UBO, 64-битно (К1-2): пуш-упаковка 16+16 молча
    // отрезала карты с id >= 16, а float(torus.z) округлял маску целиком.

    if (mat_has_map(ub.texMaskAN.z, ub.texMaskAN.w, mid)) {
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

#ifdef GIGA_ALBEDO_ARRAY
    vec3 albedo;
    if (mat_has_map(ub.texMaskAN.x, ub.texMaskAN.y, mid)) {
        albedo = texture(uAlbedo, vec3(uv * kTexRepeat, float(mid))).rgb * vColor;
    } else {
        albedo = pow(vColor, vec3(kGamma));
        albedo *= surface(vMat, uv, aw, px, g);
        albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
    }
#else
    vec3 albedo = pow(vColor, vec3(kGamma));
    albedo *= surface(vMat, uv, aw, px, g);
    albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
#endif

    float roughness = 0.50;

    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 V = toCam / max(d, 1e-4);

#ifdef GIGA_ALBEDO_ARRAY
    if (mat_has_map(ub.texMaskR.x, ub.texMaskR.y, mid)) {
        roughness = texture(uRoughness, vec3(uv * kTexRepeat, float(mid))).r;
    }
#endif

    float specPow = max(2.0 / (roughness * roughness * roughness * roughness + 1e-4) - 2.0, 1.0);
    float specIntensity = (1.0 - roughness) * 0.25;

    // Прямой свет — ЕДИНЫЙ цикл по light grid: лампы этажа, фонарик в руке (свет
    // сетки — его аналитический двойник удалён, он учитывался дважды), мобы,
    // трассеры, конусы. Тень каждого источника — giga_shadow выше.
    vec3 directDiffuse, directSpec;
#ifdef GIGA_LIGHT_SAMPLED
    // ГИБРИД: топ-K доминант — полнорезно ЗДЕСЬ (surface_light под
    // GIGA_LIGHT_SAMPLED маршит только [0..K)), хвост — из полурезного
    // полупасса билатералью (глубинный гейт выше). Сумма — весь свет клетки.
    surface_light(vWorldPos, n, V, specPow, specIntensity, pc.torus.x,
                  d, pc.fog.x, directDiffuse, directSpec);
    vec3 tailD, tailS;
    sample_half_light(d, tailD, tailS);
    directDiffuse += tailD;
    directSpec += tailS;
#else
    surface_light(vWorldPos, n, V, specPow, specIntensity, pc.torus.x,
                  d, pc.fog.x, directDiffuse, directSpec);
#endif

    // Направленный fill вырезан 2026-08-25 — солнца нет (S15).

    float hemi = 0.5 + 0.5 * n.z;
    vec3 amb = pc.fog.w * mix(vec3(0.025, 0.022, 0.018), vec3(0.055, 0.048, 0.040), hemi);

    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);
    vec3 lit = albedo * (amb * ao + directDiffuse * aoDirect) + directSpec * aoDirect;

    // Светоматериал светится сам ([ddalight.md]): нарисованный неон читается
    // и в полной тьме; сам СВЕТ от него в сетку кладёт бейк этажа.
    lit += albedo * kMatEmissive[mid];

    // fog.y is kWorldExtent*0.50*fogScale, so fogScale = fog.y / (extent*0.5) and
    // the pulse is (1 - fogScale) / (1 - kSamosborFogSqueeze). Both constants used
    // to be wrong here: the divisor was 128.0*0.50 = 64 instead of the 128 that is
    // kWorldExtent*0.5, and the ramp was /0.70 instead of /0.66. Together they ran
    // the effect at 0.457 where the CPU says 1.0 at full samosbor, and pinned it
    // to zero for the whole first half of the ramp. The extent now comes from the
    // push block (torus.x) rather than a literal; 0.66 mirrors main.cpp's
    // kSamosborFogSqueeze = 0.34 and is the one number still duplicated here.
    // [problems.md] section 20
    float samosborPulse = ub.timeParams.y;
    float timeSec = ub.timeParams.x;

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

    // СРЕДЫ (инкремент 6): поглощение Бэра по накопленной оптической глубине
    // луча — вода синеет с толщей, газ даёт цветную дымку своим альбедо.
    // Среда светится окружением (0.30 от собственного цвета), не сама.
    if (gMediaDepth > 0.0) {
        float mT = exp(-gMediaDepth);
        vec3 mediaCol = gMediaTint / max(gMediaDepth, 1e-4);
        lit = mix(mediaCol * 0.30, lit, mT);
    }

    float fog = distance_fog(d, pc.fog.x, pc.fog.y);

    float fogFlicker = 1.0 + samosborPulse * 0.35 * sin(timeSec * 22.0 + vWorldPos.x * 0.4 + vWorldPos.y * 0.3);
    fog = clamp(fog * fogFlicker, 0.0, 1.0);

    lit = mix(lit, vec3(0.0), fog);

    vec3 x = max(lit, vec3(0.0));
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    vec3 srgb = pow(mapped, vec3(1.0 / kGamma));
    outColor = vec4(srgb, 1.0);
#endif // GIGA_LIGHT_HALF else-ветка (полный кадр)
}
