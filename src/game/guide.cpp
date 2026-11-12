#include "game/guide.h"

#include <cmath>

#include "core/wrap.h"
#include "game/ai.h"      // decider_of — ЧЬЁ это тело (S13.7a)
#include "game/impact.h"  // kImpactFreeSpeed — из него выведена высота края
#include "sim/physics.h"  // support_gap_sub — просвет под следом по ходу
#include "world/nav.h"    // nav::kNavDir — словарь направлений шага
#include "world/types.h"  // kCellSize/kWorldExtent/cell_of_metres

namespace giga::game {

SteerGround steer_ground_of(const MacroGrid* grid,
                            const GravityField* gravity) {
    SteerGround out;
    const GravityField field = gravity != nullptr ? *gravity : GravityField{};
    GravityRegime r = field.regime;
    if (r == GravityRegime::Custom) r = regime_from_vector(field.global);
    out.down = regime_down(r);
    const float g = length(field.global);
    if (grid == nullptr || g <= 0.0f ||
        (out.down.x == 0 && out.down.y == 0 && out.down.z == 0))
        return out; // сторожить нечего: grid остаётся nullptr
    // h = v² / 2g — высота, с которой тело приземляется ровно на бесплатной
    // скорости закона удара. Сопротивление воздуха её только увеличивает,
    // так что предел без него — в безопасную сторону.
    const float freeDropM = kImpactFreeSpeed * kImpactFreeSpeed / (2.0f * g);
    out.dropLayers = static_cast<int>(freeDropM / kVoxelSize);
    out.grid = grid;
    return out;
}

bool steer_off_edge(const SteerGround& ground, const vec3& pos,
                    const vec3& half, const vec3& dir) {
    if (ground.grid == nullptr) return false;
    // Ширина тела в плоскости ходьбы — больший из двух касательных
    // полуразмеров (ось низа в неё не входит).
    const float wa = ground.down.x != 0 ? half.y : half.x;
    const float wb = ground.down.z != 0 ? half.y : half.z;
    const float width = 2.0f * (wa > wb ? wa : wb);
    const vec3 ahead = pos + dir * width;
    return support_gap_sub(*ground.grid, ground.down, ahead, half,
                           ground.dropLayers) == kNoSupportSub;
}

SteerStep steer_to_zone(const ZoneNav& zones, const GravityFrame& gf,
                        const SteerGround& ground, const vec3& pos,
                        const vec3& half, int cx, int cy, int cz, RoomId from,
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
    if (steer_off_edge(ground, pos, half, out.dir)) {
        out.dir = vec3{0.0f, 0.0f, 0.0f};
        out.fail = SteerFail::Edge;
    }
    return out;
}

GuideTick guide_step(Registry& reg, const ZoneNav& zones, LayerId layer,
                     std::uint64_t tick, const GravityField* gravity,
                     const MacroGrid* grid) {
    GuideTick out;
    // Плоскость ходьбы — одна на проход: она свойство мира, не тела.
    const GravityFrame gf = steer_frame_of(gravity);
    // Земля под сторожа края — тоже одна на проход.
    const SteerGround ground = steer_ground_of(grid, gravity);
    // Габарит тела; у сущности без `AABB` — тот же куб, что берёт солвер.
    const auto half_of = [&reg](Entity e) {
        const AABB* box = reg.try_get<AABB>(e);
        return box != nullptr ? box->half : vec3{0.4f, 0.4f, 0.4f};
    };
    // Непостроенный бейк НЕ останавливает проход, и это отличие от прежних
    // ходоков: заявка вида `Dir` (бегство, погоня, шум) нава не спрашивает
    // вовсе, а `Hold` — тем более. Отказывает только разрешение зоны, и
    // отказывает оно у `zone_walk_dir`, который сам проверяет построенность
    // ([game/zone_nav.h]).
    auto view = reg.view<const Steer, const Transform, Velocity>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const Steer& s = view.get<const Steer>(e);
        if (s.rank == SteerRank::None || s.rank >= SteerRank::Count ||
            s.target.kind == TargetKind::None ||
            s.target.kind >= TargetKind::Count) {
            // Непонятный байт читается как «заявки нет»: тело едет на прошлой
            // скорости. Счётчик обязан быть НУЛЁМ — это самопроверка, а не
            // статистика.
            if (s.rank != SteerRank::None) ++out.bogus;
            continue;
        }
        if (s.tick != static_cast<std::uint32_t>(tick)) {
            ++out.stale;
            continue;
        }
        // РАЗВИЛКА МОЗГОВ (S13.7a) У ЕДИНСТВЕННОГО ПИСАТЕЛЯ. Заявители её и
        // так спрашивают (каждый про себя), но вопрос «можно ли писать в это
        // тело» принадлежит писателю: вселение отдаёт `CameraTag` живому
        // жителю ПОСЕРЕДИНЕ кадра, и заявка, поданная до вселения, иначе
        // перетёрла бы ввод человека — ровно дефект Б6.2, которым наряд
        // однажды уже стоил владельцу управления.
        const Decider dec = decider_of(reg, e);
        if (dec == Decider::Human || dec == Decider::None) {
            ++out.foreign;
            continue;
        }
        Velocity& vel = view.get<Velocity>(e);
        const std::size_t rank = static_cast<std::size_t>(s.rank);
        if (s.target.kind == TargetKind::Hold) {
            steer_stop(gf, vel);
            ++out.held;
            ++out.byRank[rank];
            continue;
        }
        if (s.target.kind == TargetKind::Dir) {
            // Пеленг заявителя: нормируем ЗДЕСЬ, потому что это половина
            // «как дойти». Пустой вектор — остановка, а не толчок: вести
            // нечем, а оставить прошлую скорость значило бы везти тело
            // решением, которого уже нет.
            const vec3 d = steer_tangent(gf, s.target.dir.x, s.target.dir.y,
                                         s.target.dir.z);
            const float d2 = d.x * d.x + d.y * d.y + d.z * d.z;
            if (d2 <= kSteerMinBearing2) {
                steer_stop(gf, vel);
                ++out.held;
                ++out.byRank[rank];
                continue;
            }
            const vec3 unit = d * (1.0f / std::sqrt(d2));
            // СТОРОЖ КРАЯ у пеленга: бегущее и гонящееся тело нава не
            // спрашивает, и до сторожа шагало с обрыва вслепую. Загнанное к
            // краю тело СТОИТ — владеемым нулём, а не прошлой скоростью.
            if (steer_off_edge(ground, tr.pos, half_of(e), unit)) {
                steer_stop(gf, vel);
                ++out.edge;
                ++out.byRank[rank];
                continue;
            }
            steer_write(gf, vel, unit, s.target.speed);
            ++out.led;
            ++out.byRank[rank];
            continue;
        }
        // Zone: нав по зонам. Зона тела — через дверь с опорой на соседа
        // (клетка центра тела бывает ДЫРКОЙ в разбивке — замер §88: 26 тел на
        // тик из 238 ведомых), «метры → клетка» — одной дверью
        // `cell_of_metres` ([world/types.h]).
        const int cx = cell_of_metres(tr.pos.x);
        const int cy = cell_of_metres(tr.pos.y);
        const int cz = cell_of_metres(tr.pos.z);
        const RoomId from = zone_of_body(zones, cx, cy, cz);
        const SteerStep st =
            from == kNoRoom
                ? SteerStep{vec3{0.0f, 0.0f, 0.0f}, SteerFail::NoRoute}
                : steer_to_zone(zones, gf, ground, tr.pos, half_of(e), cx, cy,
                                cz, from, s.target.zone);
        if (st.fail == SteerFail::Edge) {
            // Заявитель, спросивший ту же дверь с той же землёй, сюда не
            // приходит; пришедший — стоит у края, а не едет на прошлой
            // скорости в обрыв.
            steer_stop(gf, vel);
            ++out.edge;
            ++out.byRank[rank];
            continue;
        }
        if (st.fail != SteerFail::None) {
            // ЗАЯВИТЕЛЬ ОБЯЗАН БЫЛ ПРОВЕРИТЬ ИСПОЛНИМОСТЬ той же дверью и на
            // тех же входах, поэтому этот счётчик — НОЛЬ по построению, и
            // держать его ненулевым значит иметь заявителя, который заявляет
            // недостижимое (и отнимает тело у того, кто его провёл бы).
            // Скорость при этом НЕ ПИШЕТСЯ: тело едет на прошлой — тот же
            // исход, что у тела без заявки, и он не зависит от того, успел ли
            // слабый заявитель подать свою.
            ++out.unresolved;
            continue;
        }
        steer_write(gf, vel, st.dir, s.target.speed);
        ++out.led;
        ++out.byRank[rank];
    }
    return out;
}

} // namespace giga::game
