#include "world/los.h"

#include <cmath>

#include "core/wrap.h"
#include "world/macro_grid.h"
#include "world/types.h"

namespace giga {

namespace {

// Component `a` of a vec3 by index. The whole traversal below is written over this
// accessor and a 3-iteration loop, so no axis can acquire a special case — the same
// discipline `grenade_advance` follows for the same reason ([problems.md] §34).
inline float& axis(vec3& v, int a) { return a == 0 ? v.x : (a == 1 ? v.y : v.z); }
inline float axis(const vec3& v, int a) { return a == 0 ? v.x : (a == 1 ? v.y : v.z); }
inline int& axis(ivec3& v, int a) { return a == 0 ? v.x : (a == 1 ? v.y : v.z); }

} // namespace



namespace {

// Мировой субвоксельный индекс → (клетка, субвоксель). Честное деление с полом,
// без битовых допущений о kSubDim ([world/types.h]: переключение на 16 обязано
// остаться однострочником) и без UB на отрицательных.
inline void split_sub(int v, int& c, int& s) {
    c = v >= 0 ? v / kSubDim : (v - (kSubDim - 1)) / kSubDim;
    s = v - c * kSubDim;
}

// Твёрдость субвокселя по мировому субвоксельному индексу; MacroGrid оборачивает
// макро-координаты сам, обе оси и z тоже (тор по всем трём — [AGENTS.md]).
inline bool sub_solid(const MacroGrid& grid, const ivec3& v) {
    int cx, cy, cz, sx, sy, sz;
    split_sub(v.x, cx, sx);
    split_sub(v.y, cy, sy);
    split_sub(v.z, cz, sz);
    return grid.solid(cx, cy, cz, sx, sy, sz);
}

} // namespace

bool sub_march(const MacroGrid& grid, const vec3& a, const vec3& b,
               SubRayHit& out) {
    const vec3 d{b.x - a.x, b.y - a.y, b.z - a.z};

    ivec3 sv{static_cast<int>(std::floor(a.x / kVoxelSize)),
             static_cast<int>(std::floor(a.y / kVoxelSize)),
             static_cast<int>(std::floor(a.z / kVoxelSize))};

    auto fill = [&](float t, int hitAxis, float hitSign) {
        out.t = t;
        int sx, sy, sz;
        split_sub(sv.x, out.cx, sx);
        split_sub(sv.y, out.cy, sy);
        split_sub(sv.z, out.cz, sz);
        out.cx = wrap_macro(out.cx);
        out.cy = wrap_macro(out.cy);
        out.cz = wrap_macro(out.cz);
        out.sx = sx;
        out.sy = sy;
        out.sz = sz;
        out.axis = hitAxis;
        out.sign = hitSign;
    };

    // Старт в материи — контакт на месте, грани входа нет.
    if (sub_solid(grid, sv)) {
        fill(0.0f, -1, 0.0f);
        return true;
    }

    ivec3 stepDir{0, 0, 0};
    vec3 tMax{0.0f, 0.0f, 0.0f};
    vec3 tDelta{0.0f, 0.0f, 0.0f};
    constexpr float kNever = 3.0e30f;   // «эта ось границ не пересекает»

    for (int i = 0; i < 3; ++i) {
        const float di = axis(d, i);
        if (di > -1e-9f && di < 1e-9f) {
            axis(stepDir, i) = 0;
            axis(tMax, i) = kNever;
            axis(tDelta, i) = kNever;
            continue;
        }
        const int s = di > 0.0f ? 1 : -1;
        axis(stepDir, i) = s;
        const float origin = axis(a, i);
        const int c = axis(sv, i);
        const float boundary =
            static_cast<float>(s > 0 ? c + 1 : c) * kVoxelSize;
        axis(tMax, i) = (boundary - origin) / di;
        axis(tDelta, i) = kVoxelSize / std::fabs(di);
    }

    // Тот же страховочный потолок, что у los_blockers, в субвоксельном масштабе;
    // реальный выход из цикла — `best > 1`, отрезок шага короток.
    const int guard = 3 * kMacroDim * kSubDim + 3;
    for (int i = 0; i < guard; ++i) {
        int stepAxis = 0;
        float best = axis(tMax, 0);
        for (int k = 1; k < 3; ++k) {
            if (axis(tMax, k) < best) {
                best = axis(tMax, k);
                stepAxis = k;
            }
        }
        if (best > 1.0f) break;            // отрезок кончился в воздухе
        axis(sv, stepAxis) += axis(stepDir, stepAxis);
        const float tEnter = best;
        axis(tMax, stepAxis) += axis(tDelta, stepAxis);

        if (sub_solid(grid, sv)) {
            fill(tEnter, stepAxis,
                 axis(stepDir, stepAxis) > 0 ? -1.0f : 1.0f);
            return true;
        }
    }
    return false;
}

// Толщина материи вдоль отрезка В КЛЕТКАХ-ЭКВИВАЛЕНТАХ: счёт СОЛИДНЫХ
// субвокселей на DDA-пути / kSubDim, с потолком вверх (тонкая лепленая
// стена в 2 атома обязана дать 1, не 0). Заменяет клеточный los_blockers
// у звука (аудит 2026-08-25, К1-9): клеточный предикат на лепленом этаже
// (полных клеток 0.4%) почти никогда не видел заслона — окклюзия звука
// была no-op. Та же DDA-шагалка, что sub_march — второго марша нет (S11),
// отличие только в вопросе («сколько материи» против «первый контакт»).
int sub_thickness_cells(const MacroGrid& grid, const vec3& a, const vec3& b) {
    const vec3 d{b.x - a.x, b.y - a.y, b.z - a.z};
    ivec3 sv{static_cast<int>(std::floor(a.x / kVoxelSize)),
             static_cast<int>(std::floor(a.y / kVoxelSize)),
             static_cast<int>(std::floor(a.z / kVoxelSize))};
    int solidSteps = sub_solid(grid, sv) ? 1 : 0;

    ivec3 stepDir{0, 0, 0};
    vec3 tMax{0.0f, 0.0f, 0.0f};
    vec3 tDelta{0.0f, 0.0f, 0.0f};
    constexpr float kNever = 3.0e30f;
    for (int i = 0; i < 3; ++i) {
        const float di = axis(d, i);
        if (di > -1e-9f && di < 1e-9f) {
            axis(stepDir, i) = 0;
            axis(tMax, i) = kNever;
            axis(tDelta, i) = kNever;
            continue;
        }
        const int s = di > 0.0f ? 1 : -1;
        axis(stepDir, i) = s;
        const float origin = axis(a, i);
        const int c = axis(sv, i);
        const float boundary =
            static_cast<float>(s > 0 ? c + 1 : c) * kVoxelSize;
        axis(tMax, i) = (boundary - origin) / di;
        axis(tDelta, i) = kVoxelSize / std::fabs(di);
    }
    const int guard = 3 * kMacroDim * kSubDim + 3;
    for (int i = 0; i < guard; ++i) {
        int stepAxis = 0;
        float best = axis(tMax, 0);
        for (int k = 1; k < 3; ++k) {
            if (axis(tMax, k) < best) {
                best = axis(tMax, k);
                stepAxis = k;
            }
        }
        if (best > 1.0f) break;
        axis(sv, stepAxis) += axis(stepDir, stepAxis);
        axis(tMax, stepAxis) += axis(tDelta, stepAxis);
        if (sub_solid(grid, sv)) ++solidSteps;
    }
    return (solidSteps + kSubDim - 1) / kSubDim; // потолок вверх
}

} // namespace giga
