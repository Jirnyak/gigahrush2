#include "game/guide.h"

#include <cmath>

#include "core/wrap.h"
#include "world/nav.h"    // nav::kNavDir — словарь направлений шага
#include "world/types.h"  // kCellSize/kWorldExtent

namespace giga::game {

SteerStep steer_to_zone(const ZoneNav& zones, const GravityFrame& gf,
                        const vec3& pos, int cx, int cy, int cz, RoomId from,
                        RoomId target) {
    SteerStep out;
    const std::uint8_t d =
        zone_walk_dir(zones, from, target, cx, cy, cz, gf.pull ? gf.axis : -1);
    if (d == kZoneFlowNone) {
        out.fail = SteerFail::NoRoute;
        return out;
    }
    // Единственный случай, когда дверь зон отдаёт шаг ВДОЛЬ гравитации:
    // ступенька и есть выход из зоны. Тангенциального пеленга у него ровно
    // ноль, то есть вести этим шагом нечем. Слепой прямой на цель здесь нет
    // СОЗНАТЕЛЬНО: ровно она была остатком якоря у решётки и стоила §88 нуля
    // прибытий.
    if (d < 6 && (d >> 1) == static_cast<std::uint8_t>(gf.axis)) {
        out.fail = SteerFail::StepUp;
        return out;
    }
    // `zone_walk_dir` по контракту ([game/zone_nav.h]) отдаёт 0..5 либо
    // `kZoneFlowNone`, а тот снят условием выше — индекс словаря законен по
    // построению, и ветки «не шаг» здесь нет.
    const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
    const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
    const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
    vec3 dir = steer_tangent(
        gf,
        wrap_delta_f(pos.x, (static_cast<float>(nx) + 0.5f) * kCellSize,
                     kWorldExtent),
        wrap_delta_f(pos.y, (static_cast<float>(ny) + 0.5f) * kCellSize,
                     kWorldExtent),
        wrap_delta_f(pos.z, (static_cast<float>(nz) + 0.5f) * kCellSize,
                     kWorldExtent));
    const float d2 = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
    if (d2 <= kSteerMinBearing2) {
        out.fail = SteerFail::NoBearing;
        return out;
    }
    out.dir = dir * (1.0f / std::sqrt(d2));
    return out;
}

} // namespace giga::game
