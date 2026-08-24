#include "sim/physics.h"

#include <algorithm>
#include <cmath>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "sim/drag.h"
#include "world/medium.h" // liquid_frac_at — плавучесть из агрегата S16.4
#include "world/world.h"

namespace giga {

namespace {

// Total voxels per axis across the whole world (wraps as a torus).

int floor_div(float v, float s) {
    return static_cast<int>(std::floor(v / s));
}

} // namespace

bool aabb_overlaps_solid(const World& world, vec3 pos, vec3 half) {
    // Voxel range the box covers on each axis.
    const int x0 = floor_div(pos.x - half.x, kVoxelSize);
    const int x1 = floor_div(pos.x + half.x, kVoxelSize);
    const int y0 = floor_div(pos.y - half.y, kVoxelSize);
    const int y1 = floor_div(pos.y + half.y, kVoxelSize);
    const int z0 = floor_div(pos.z - half.z, kVoxelSize);
    const int z1 = floor_div(pos.z + half.z, kVoxelSize);

    const int cx0 = floor_div(static_cast<float>(x0), static_cast<float>(kSubDim));
    const int cx1 = floor_div(static_cast<float>(x1), static_cast<float>(kSubDim));
    const int cy0 = floor_div(static_cast<float>(y0), static_cast<float>(kSubDim));
    const int cy1 = floor_div(static_cast<float>(y1), static_cast<float>(kSubDim));
    const int cz0 = floor_div(static_cast<float>(z0), static_cast<float>(kSubDim));
    const int cz1 = floor_div(static_cast<float>(z1), static_cast<float>(kSubDim));

    const MacroGrid& grid = world.grid();

    for (int cz = cz0; cz <= cz1; ++cz) {
        const int mcz = wrap_macro(cz);
        const int sz0 = std::max(0, z0 - cz * kSubDim);
        const int sz1 = std::min(kSubDim - 1, z1 - cz * kSubDim);

        for (int cy = cy0; cy <= cy1; ++cy) {
            const int mcy = wrap_macro(cy);
            const int sy0 = std::max(0, y0 - cy * kSubDim);
            const int sy1 = std::min(kSubDim - 1, y1 - cy * kSubDim);

            for (int cx = cx0; cx <= cx1; ++cx) {
                const int mcx = wrap_macro(cx);
                const SubMask& mask = grid.mask(mcx, mcy, mcz);
                if (mask.empty()) continue;

                const int sx0 = std::max(0, x0 - cx * kSubDim);
                const int sx1 = std::min(kSubDim - 1, x1 - cx * kSubDim);

                const int xSpan = sx1 - sx0 + 1;
                const std::uint64_t rowBits = (xSpan >= kSubDim)
                    ? 0xFFULL
                    : (((1ULL << xSpan) - 1ULL) << sx0);

                std::uint64_t xyMask = 0;
                for (int sy = sy0; sy <= sy1; ++sy) {
                    xyMask |= (rowBits << (sy * kSubDim));
                }

                for (int sz = sz0; sz <= sz1; ++sz) {
                    if (mask.words[sz] & xyMask) return true;
                }
            }
        }
    }
    return false;
}

namespace {

// Move `pos` along one axis by `delta`, backing out of any solid overlap. The
// axis is selected by `comp` (0=x,1=y,2=z). Returns true if a collision on this
// axis stopped the motion (used to zero the matching velocity component).
bool sweep_axis(const World& w, vec3& pos, vec3 half, int comp, float delta) {
    if (delta == 0.0f) return false;
    float* p = (comp == 0) ? &pos.x : (comp == 1) ? &pos.y : &pos.z;
    const float old = *p;
    const float dist = std::fabs(delta);

    // СУБСЭМПЛИРОВАНИЕ (из аудита форка, e462579b): раньше проверялась только
    // конечная точка — быстрый снаряд/рэгдолл проскакивал субвоксельную стену
    // целиком за шаг. Теперь шаг ограничен kVoxelSize: вдоль оси проскочить
    // нечего. Заодно бинарный поиск сужен до [t_prev, t_curr]: старый искал в
    // [0, delta] и мог схлопнуться к ДАЛЬНЕМУ препятствию, пропустив ближнее.
    // (Диагональные углы это не закрывает — оси по-прежнему раздельны; честный
    // slab-sweep — отдельное решение, если угол когда-нибудь стрельнёт.)
    const int numSteps = (dist <= kVoxelSize)
        ? 1
        : std::max(1, static_cast<int>(std::ceil(dist / kVoxelSize)));
    const float stepDelta = delta / static_cast<float>(numSteps);

    for (int step = 1; step <= numSteps; ++step) {
        const float tCurr =
            (step == numSteps) ? delta : (static_cast<float>(step) * stepDelta);
        *p = old + tCurr;
        if (aabb_overlaps_solid(w, pos, half)) {
            // Collided: binary-search back to the last non-overlapping position
            // so the box rests flush against the sub-voxel surface.
            float lo = static_cast<float>(step - 1) * stepDelta, hi = tCurr;
            for (int i = 0; i < 12; ++i) {
                const float mid = 0.5f * (lo + hi);
                *p = old + mid;
                if (aabb_overlaps_solid(w, pos, half)) hi = mid; else lo = mid;
            }
            *p = old + lo;
            return true;
        }
    }
    *p = old + delta;
    return false;
}

float axis_of(const vec3& v, int comp) {
    return comp == 0 ? v.x : comp == 1 ? v.y : v.z;
}

// One sub-voxel atom of smooth step-up, plus the skin that lets the retried
// sweep clear the step's top surface exactly. The manifest's rule: a single
// 0.25 m atom is walkable without a jump; two atoms are a wall.
constexpr float kStepRise = kVoxelSize + 0.01f;
constexpr float kStepGainEps = 1e-4f;

// Sweep one axis with auto-step. A grounded walker blocked on a non-up axis
// retries the same move lifted one atom, keeps it only if it actually gains
// ground (a real wall gains nothing), then settles flush onto the step top.
// Universal: `upComp/upSign` come from the gravity vector's dominant axis, so
// walkers on regional/inverted gravity step the same way; flyers and
// projectiles never pass `canStep` and keep the plain sweep.
bool sweep_axis_walk(const World& w, vec3& pos, vec3 half, int comp,
                     float delta, bool canStep, int upComp, float upSign) {
    vec3 flush = pos;
    const bool hit = sweep_axis(w, flush, half, comp, delta);
    if (!hit || !canStep || comp == upComp) {
        pos = flush;
        return hit;
    }

    vec3 lifted = pos;
    if (sweep_axis(w, lifted, half, upComp, kStepRise * upSign)) {
        pos = flush; // no headroom above — nothing to step onto
        return true;
    }
    const bool hitLifted = sweep_axis(w, lifted, half, comp, delta);
    const float dir = delta > 0.0f ? 1.0f : -1.0f;
    const float gain =
        (axis_of(lifted, comp) - axis_of(flush, comp)) * dir;
    if (gain <= kStepGainEps) {
        pos = flush; // a real wall, not a one-atom step
        return true;
    }
    // Settle flush onto the step; the landing is this sweep's own clamp.
    sweep_axis(w, lifted, half, upComp, -kStepRise * upSign);
    pos = lifted;
    return hitLifted;
}

} // namespace

void physics_step(Registry& reg, LevelStack& stack, float dt,
                  const PhysicsParams& params) {
    if (dt <= 0.0f) return;
    int steps = std::clamp(
        static_cast<int>(std::ceil(dt / params.maxStep)), 1, params.maxSubsteps);
    float h = dt / static_cast<float>(steps);

    // Excludes anything that integrates its own motion. Projectiles do, and until
    // this exclusion existed they were moved twice per tick — double speed, double
    // gravity, every shot in the game. [components.h SelfIntegrating]
    auto view = reg.view<Transform, Velocity>(entt::exclude<SelfIntegrating>);
    for (int s = 0; s < steps; ++s) {
        for (auto e : view) {
            auto& tr = view.get<Transform>(e);
            auto& vel = view.get<Velocity>(e);
            if (!stack.valid(tr.layer)) continue;
            World& w = stack.layer(tr.layer);

            // Noclip: integrate + wrap, nothing else. No gravity, no jump, no
            // sweep — the body passes through geometry by design (debug console
            // toggles the tag; [components.h NoClip]).
            if (reg.all_of<NoClip>(e)) {
                tr.pos += vel.v * h;
                tr.pos.x = wrapf(tr.pos.x, kWorldExtent);
                tr.pos.y = wrapf(tr.pos.y, kWorldExtent);
                tr.pos.z = wrapf(tr.pos.z, kWorldExtent);
                continue;
            }

            vec3 half = reg.all_of<AABB>(e) ? reg.get<AABB>(e).half
                                            : vec3{0.4f, 0.4f, 0.4f};

            // Gravity + jump (only if the entity opts in).
            vec3 up{0, 0, 1};
            if (auto* g = reg.try_get<GravityAffected>(e)) {
                vec3 accel = w.gravity().at(tr.pos) * g->scale;
                up = normalize(accel * -1.0f);
                vel.v += accel * h;

                // ПЛАВУЧЕСТЬ + ВЯЗКОСТЬ ВОДЫ (CANON S16.4, инкремент 4):
                // тело читает агрегат СВОЕЙ клетки — вопрос «в чём я»
                // макроскопический (тело 4×4×7 субвокселей само размером с
                // клетку). Один член силы: толчок ПРОТИВ гравитации фрейма,
                // пропорциональный погружённости; никакой оси Z — вектор.
                // kBuoyancy = ρ_воды/ρ_тела = 1000/985 (человек с воздухом в
                // лёгких — слегка положительная плавучесть, как в жизни).
                // kWaterDrag: терминальная скорость погружённого тела ~2 м/с
                // при g 9.8 → линейная вязкость 9.8/2 ≈ 4.9 1/с.
                const float frac = liquid_frac_at(
                    w, macro_index(
                           wrap_macro(static_cast<int>(
                               std::floor(tr.pos.x / kCellSize))),
                           wrap_macro(static_cast<int>(
                               std::floor(tr.pos.y / kCellSize))),
                           wrap_macro(static_cast<int>(
                               std::floor(tr.pos.z / kCellSize)))));
                if (frac > 0.0f) {
                    constexpr float kBuoyancy = 1000.0f / 985.0f;
                    constexpr float kWaterDrag = 4.9f;
                    vel.v = vel.v - accel * (frac * kBuoyancy * h);
                    const float damp = frac * kWaterDrag * h;
                    vel.v = vel.v * (damp < 1.0f ? 1.0f - damp : 0.0f);
                }

                if (auto* j = reg.try_get<Jump>(e)) {
                    if (j->wants_jump && g->grounded) {
                        vel.v += up * j->impulse;
                        g->grounded = false;
                    }
                    j->wants_jump = false;
                }
            }

            // ТРЕНИЕ ВОЗДУХА — универсальный квадратичный закон ([sim/drag.h]),
            // безусловно для всего, что дошло сюда: у ходока на 6 м/с это
            // 0.1 м/с^2 (неощутимо), у падающего в шахте тора тела это кап на
            // ~55 м/с вместо вечного разгона. После гравитации, а не до —
            // тогда неподвижная точка пары «+g*h, затем трение» есть точно
            // v_t = sqrt(g/q), и тест может пинить равенство, а не полосу.
            // Mass — через тот же фолбэк-паттерн, что AABB строкой выше:
            // компонента нет — действует её собственный дефолт (70 кг).
            air_drag_step(vel.v,
                          drag_q(half, reg.all_of<Mass>(e) ? reg.get<Mass>(e).kg
                                                           : Mass{}.kg),
                          h);

            // Whether the entity was moving "downward" (against up) this step,
            // captured before collisions zero the velocity.
            bool movingDown = dot(vel.v, up) <= 0.0f;

            // The dominant axis of "up", shared by the auto-step and the
            // ground check below.
            float ax = std::fabs(up.x), ay = std::fabs(up.y),
                  az = std::fabs(up.z);
            int upComp = (az >= ax && az >= ay) ? 2 : (ay >= ax) ? 1 : 0;
            float upSign = axis_of(up, upComp) >= 0.0f ? 1.0f : -1.0f;
            auto* g = reg.try_get<GravityAffected>(e);
            const bool canStep = g && g->grounded;

            // Integrate + collide, one axis at a time; grounded walkers step
            // over single sub-voxel atoms instead of snagging on them.
            bool hitX = sweep_axis_walk(w, tr.pos, half, 0, vel.v.x * h,
                                        canStep, upComp, upSign);
            bool hitY = sweep_axis_walk(w, tr.pos, half, 1, vel.v.y * h,
                                        canStep, upComp, upSign);
            bool hitZ = sweep_axis_walk(w, tr.pos, half, 2, vel.v.z * h,
                                        canStep, upComp, upSign);
            // Impact report BEFORE zeroing: the killed velocity is the impact
            // speed the game layer's universal law (E = m*v^2/2 over Mass)
            // consumes. 4 m/s floor keeps ordinary walking/jump landings from
            // churning components (a jump lands at ~5 m/s and the damage law
            // has its own free band on top).
            {
                const float kx = hitX ? vel.v.x : 0.0f;
                const float ky = hitY ? vel.v.y : 0.0f;
                const float kz = hitZ ? vel.v.z : 0.0f;
                const float killed = std::sqrt(kx * kx + ky * ky + kz * kz);
                if (killed > 4.0f) {
                    Impact& im = reg.get_or_emplace<Impact>(e);
                    if (killed > im.speed) im.speed = killed;
                }
            }
            if (hitX) vel.v.x = 0.0f;
            if (hitY) vel.v.y = 0.0f;
            if (hitZ) vel.v.z = 0.0f;

            // Ground check: a collision on the axis most aligned with "up",
            // while descending, means we are standing on something.
            if (g) {
                bool upAxisHit = upComp == 2 ? hitZ : upComp == 1 ? hitY : hitX;
                g->grounded = upAxisHit && movingDown;
            }

            // Toroidal world: wrap the entity's position back into [0, extent)
            // on every axis. This is what makes the torus real for the *agent*,
            // not just for collision queries — walk or fall off any face and
            // you seamlessly re-enter from the opposite one (top<->bottom,
            // left<->right, front<->back). Isotropy by construction.
            tr.pos.x = wrapf(tr.pos.x, kWorldExtent);
            tr.pos.y = wrapf(tr.pos.y, kWorldExtent);
            tr.pos.z = wrapf(tr.pos.z, kWorldExtent);

            // Косметика качения (ω=n×v/r на DynamicBodyTag) и интеграция
            // AngularVelocity УМЕРЛИ (рагдолл-эпик, инкремент 6, 2026-08-21):
            // сорванные пропы, трупы и стендовые тела несут RigidBody +
            // SelfIntegrating и живут в rigid_body_step (src/sim/rigid.cpp) —
            // качение там ВОЗНИКАЕТ из трения через точку контакта, а не
            // подкручивается по латеральной скорости. physics_step остался
            // тем, чем был всегда: свепт-AABB агентов (ходьба игрока и NPC).
        }
    }
}


} // namespace giga
