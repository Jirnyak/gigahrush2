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
                 b.z - a.z};

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

        // Off the top or the bottom of the stack: there is nothing there to see
        // through, so it blocks. z does not wrap ([AGENTS.md]: W and the vertical
        // extent of the stack are not toroidal the way x/y are).
        if (cell.z < 0 || cell.z >= kMacroDim) {
            ++blockers;
            continue;
        }
        if (grid.cell(cell.x, cell.y, cell.z) != kCellAir) ++blockers;
    }
    return blockers;
}

bool los_clear(const MacroGrid& grid, const vec3& a, const vec3& b) {
    return los_blockers(grid, a, b) == 0;
}

} // namespace giga
