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

int los_blockers(const MacroGrid& grid, const vec3& a, const vec3& b) {
    // Walk toward b's NEAREST IMAGE on the wrapping axes. Working in a coordinate
    // frame anchored at `a` means the traversal never has to think about the seam:
    // it walks a straight segment in unwrapped space and wraps only when it asks the
    // grid a question, which is what `MacroGrid::cell` already does for us.
    const vec3 d{wrap_delta_f(a.x, b.x, kWorldExtent),
                 wrap_delta_f(a.y, b.y, kWorldExtent),
                 wrap_delta_f(a.z, b.z, kWorldExtent)};

    // Amanatides–Woo: step cell by cell along the segment, always advancing the axis
    // whose next boundary is nearest. Exact — it visits every cell the segment
    // touches and no others.
    ivec3 cell{static_cast<int>(std::floor(a.x / kCellSize)),
               static_cast<int>(std::floor(a.y / kCellSize)),
               static_cast<int>(std::floor(a.z / kCellSize))};
    const ivec3 startCell = cell;

    ivec3 endCell{static_cast<int>(std::floor((a.x + d.x) / kCellSize)),
                  static_cast<int>(std::floor((a.y + d.y) / kCellSize)),
                  static_cast<int>(std::floor((a.z + d.z) / kCellSize))};
    if (cell.x == endCell.x && cell.y == endCell.y && cell.z == endCell.z) return 0;

    ivec3 stepDir{0, 0, 0};
    vec3 tMax{0.0f, 0.0f, 0.0f};
    vec3 tDelta{0.0f, 0.0f, 0.0f};
    constexpr float kNever = 3.0e30f;   // "this axis never crosses a boundary"

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
        // Distance, in units of the whole segment, to the next boundary on this axis.
        const float origin = axis(a, i);
        const int c = axis(cell, i);
        const float boundary =
            static_cast<float>(s > 0 ? c + 1 : c) * kCellSize;
        axis(tMax, i) = (boundary - origin) / di;
        axis(tDelta, i) = kCellSize / std::fabs(di);
    }

    int blockers = 0;
    // One cell per iteration; the bound is the Manhattan cell distance plus slack,
    // so a degenerate segment cannot spin. `kWorldExtent / kCellSize` is the whole
    // grid, and no minimal-image segment is longer than half of it per axis.
    const int guard = 3 * kMacroDim + 3;
    for (int i = 0; i < guard; ++i) {
        // Advance along whichever axis reaches its next boundary first.
        int stepAxis = 0;
        float best = axis(tMax, 0);
        for (int k = 1; k < 3; ++k) {
            if (axis(tMax, k) < best) {
                best = axis(tMax, k);
                stepAxis = k;
            }
        }
        if (best > 1.0f) break;            // past b: the segment is done
        axis(cell, stepAxis) += axis(stepDir, stepAxis);
        axis(tMax, stepAxis) += axis(tDelta, stepAxis);

        const bool isEnd = cell.x == endCell.x && cell.y == endCell.y &&
                           cell.z == endCell.z;
        const bool isStart = cell.x == startCell.x && cell.y == startCell.y &&
                            cell.z == startCell.z;
        if (isStart || isEnd) {
            if (isEnd) break;              // reached the far end; nothing beyond it
            continue;                      // the cell we set out from never blocks
        }

        // All three axes wrap ([AGENTS.md]: x/y/z wrap; W does not) — the walk
        // runs in the frame anchored at `a` and MacroGrid::cell wraps every
        // coordinate on the query, z included. An earlier version treated
        // out-of-range z as a blocker here, citing AGENTS.md for "z does not
        // wrap" — the file says the opposite, and the fake wall made every
        // shot and sightline through the z seam read as blocked by nothing
        // (markoaudit/systems/05-torus.md §1.4).
        if (grid.cell(cell.x, cell.y, cell.z) != kCellAir) ++blockers;
    }
    return blockers;
}

bool los_clear(const MacroGrid& grid, const vec3& a, const vec3& b) {
    return los_blockers(grid, a, b) == 0;
}

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

} // namespace giga
