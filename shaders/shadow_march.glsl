#ifndef SHADOW_MARCH_GLSL
#define SHADOW_MARCH_GLSL

// shadow_march.glsl — настоящий giga_shadow для РАСТРОВЫХ пассов (тела,
// пропсы) ([ddalight.md] закон №5). Тот же двухуровневый DDA по вокселному
// зеркалу, что и в raymarch.frag, но БЕЗ материалов/стейнов — луч отвечает на
// один вопрос: «дойдёт ли свет». Прокарвил стену — тень пропала у ВСЕХ
// потребителей тем же кадром: буфера общие с физикой.
//
// Включение: #define GIGA_SHADOW_SET <N> до инклюда; пайплайн обязан нести
// теневой сет VoxelMirror (masks=0, class=1) под этим номером. Без дефайна
// заголовок пуст — шейдер даёт свой стаб.

#ifdef GIGA_SHADOW_SET

layout(set = GIGA_SHADOW_SET, binding = 0, std430) readonly buffer ShadowMaskBuf {
    uint sMasks[]; // 16 uints на клетку — суб-воксельная занятость
};
layout(set = GIGA_SHADOW_SET, binding = 1, std430) readonly buffer ShadowClassBuf {
    uint sClass[]; // 4 клетки на uint: 0 пусто, 1 цельно, 2 частично
};

// Занятость по субвокселям, блок 1 м (см. raymarch.frag/voxel_mirror.h):
// один бит на 4³ атома, решётка 2 МиБ вместо 128 МиБ масок.
layout(set = GIGA_SHADOW_SET, binding = 2, std430) readonly buffer ShadowOccBuf {
    uint sOcc[];
};

const int   kSmMacroDim = GIGA_MACRO_DIM; // -D из CMakeLists <- world/types.h
const float kSmCell = GIGA_CELL_SIZE;
const float kSmVoxel = kSmCell / float(GIGA_SUB_DIM);
const int   kSmOccDim = kSmMacroDim * 2;

bool sm_occ_block(ivec3 b) {
    b &= (kSmOccDim - 1);
    uint i = uint(b.x) + uint(b.y) * uint(kSmOccDim) +
             uint(b.z) * uint(kSmOccDim) * uint(kSmOccDim);
    return ((sOcc[i >> 5] >> (i & 31u)) & 1u) != 0u;
}

uint sm_cell_index(ivec3 c) {
    c &= (kSmMacroDim - 1); // тор: врап на битовом И
    return uint(c.x) | (uint(c.y) << 7) | (uint(c.z) << 14);
}

uint sm_class(uint ci) {
    return (sClass[ci >> 2] >> ((ci & 3u) * 8u)) & 0xFFu;
}

bool sm_solid(uint ci, ivec3 s) {
    uint bit = uint(s.x) | (uint(s.y) << 3) | (uint(s.z) << 6);
    return ((sMasks[ci * 16u + (bit >> 5)] >> (bit & 31u)) & 1u) != 0u;
}

// Суб-воксельный DDA внутри одной частичной клетки, t0..t1.
bool sm_cell_blocked(uint ci, ivec3 c, vec3 ro, vec3 rd, vec3 rinv, ivec3 stp,
                     vec3 cellLo, float t0, float t1) {
    vec3 e = ro + rd * (t0 + 1e-5);
    ivec3 s = clamp(ivec3(floor((e - cellLo) / kSmVoxel)), ivec3(0), ivec3(7));
    vec3 bound = cellLo + (vec3(s) + max(vec3(stp), vec3(0.0))) * kSmVoxel;
    vec3 sMax = (bound - ro) * rinv;
    vec3 sDelta = vec3(kSmVoxel) * abs(rinv);
    ivec3 blkCur = ivec3(-1);
    bool blkOcc = true;
    bool useOcc = (uShadowFlags & kShadowFlagNoOcc) == 0u;
    for (int i = 0; i < 32; ++i) {
        if (useOcc) {
            ivec3 blk = s >> 2;
            if (blk != blkCur) { blkCur = blk; blkOcc = sm_occ_block(c * 2 + blk); }
        }
        if (blkOcc && sm_solid(ci, s)) return true;
        int axis = sMax.x < sMax.y ? (sMax.x < sMax.z ? 0 : 2)
                                   : (sMax.y < sMax.z ? 1 : 2);
        float t = sMax[axis];
        if (t > t1) return false;
        s[axis] += stp[axis];
        if (s[axis] < 0 || s[axis] > 7) return false;
        sMax[axis] += sDelta[axis];
    }
    return false;
}

// 1.0 = свет виден, 0.0 = перекрыт. Смещения старта/финиша — у вызывающего
// (surface_light, единые для всех реализаций).
float giga_shadow(vec3 ro, vec3 rd, float dist) {
    if (dist <= 0.0) return 1.0;

    rd.x = abs(rd.x) < 1e-6 ? (rd.x >= 0.0 ? 1e-6 : -1e-6) : rd.x;
    rd.y = abs(rd.y) < 1e-6 ? (rd.y >= 0.0 ? 1e-6 : -1e-6) : rd.y;
    rd.z = abs(rd.z) < 1e-6 ? (rd.z >= 0.0 ? 1e-6 : -1e-6) : rd.z;
    vec3 rinv = 1.0 / rd;
    ivec3 stp = ivec3(sign(rd));

    ivec3 c = ivec3(floor(ro / kSmCell));
    vec3 bound = (vec3(c) + max(vec3(stp), vec3(0.0))) * kSmCell;
    vec3 tMax = (bound - ro) * rinv;
    vec3 tDelta = vec3(kSmCell) * abs(rinv);
    float t = 0.0;

    // Радиус света <= 48 м = 24 клетки; sqrt(3)-диагональ и запас держат цикл.
    for (int i = 0; i < 96; ++i) {
        uint ci = sm_cell_index(c);
        uint cls = sm_class(ci);
        if (cls == 1u) return 0.0; // цельная клетка — свет не пройдёт
        float tExit = min(min(tMax.x, tMax.y), tMax.z);
        // NOSUB — та же измерительная ручка, что в raymarch.frag (маски не
        // читаются; частичные клетки прозрачны). Не режим игры.
        if (cls == 2u && (uShadowFlags & kShadowFlagNoSub) == 0u &&
            sm_cell_blocked(ci, c, ro, rd, rinv, stp, vec3(c) * kSmCell, t,
                            min(tExit, dist)))
            return 0.0;
        int axis = tMax.x < tMax.y ? (tMax.x < tMax.z ? 0 : 2)
                                   : (tMax.y < tMax.z ? 1 : 2);
        t = tMax[axis];
        if (t > dist) return 1.0;
        c[axis] += stp[axis];
        tMax[axis] += tDelta[axis];
    }
    return 1.0;
}

#endif // GIGA_SHADOW_SET

#endif // SHADOW_MARCH_GLSL
