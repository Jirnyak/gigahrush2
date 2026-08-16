#include "sim/physics.h"

#include <algorithm>
#include <cmath>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "world/world.h"

namespace giga {

namespace {

// Total voxels per axis across the whole world (wraps as a torus).
constexpr int kVoxAxis = kMacroDim * kSubDim;

int floor_div(float v, float s) {
    return static_cast<int>(std::floor(v / s));
}

// Is the global voxel (gx, gy, gz) solid? Global voxel coords wrap on the
// 1024^3 torus; they decompose into a macro cell + local sub index.
bool voxel_solid(const World& w, int gx, int gy, int gz) {
    gx = wrapi(gx, kVoxAxis);
    gy = wrapi(gy, kVoxAxis);
    gz = wrapi(gz, kVoxAxis);
    int cx = gx / kSubDim, cy = gy / kSubDim, cz = gz / kSubDim;
    int sx = gx % kSubDim, sy = gy % kSubDim, sz = gz % kSubDim;
    return w.grid().mask(cx, cy, cz).test(sub_bit(sx, sy, sz));
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

                if (auto* j = reg.try_get<Jump>(e)) {
                    if (j->wants_jump && g->grounded) {
                        vel.v += up * j->impulse;
                        g->grounded = false;
                    }
                    j->wants_jump = false;
                }
            }

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

            // Ragdoll / tumbling + grounded roll ([jirnyak.md] section 18).
            // BodyPass is still axis-aligned; Rotation/AngularVelocity are sim
            // state for PropPass / future draw. On DynamicBodyTag debris that is
            // grounded with lateral speed, drive spin from v so balls/props roll
            // on slopes instead of skating. Skin lift keeps the AABB from
            // settling one binary-search eps into solid (no grid sink).
            const bool isDebris = reg.all_of<DynamicBodyTag>(e);
            if (g && g->grounded && isDebris) {
                constexpr float kContactSkin = 0.02f;
                if (aabb_overlaps_solid(w, tr.pos, half)) {
                    vec3 lifted = tr.pos;
                    const float lift = kContactSkin * upSign;
                    if (upComp == 0) lifted.x += lift;
                    else if (upComp == 1) lifted.y += lift;
                    else lifted.z += lift;
                    if (!aabb_overlaps_solid(w, lifted, half)) {
                        tr.pos = lifted;
                    }
                }
                const float r = std::max(0.05f, std::min({half.x, half.y, half.z}));
                const float vn = dot(vel.v, up);
                vec3 vLat{vel.v.x - up.x * vn, vel.v.y - up.y * vn,
                          vel.v.z - up.z * vn};
                const float v2 = vLat.x * vLat.x + vLat.y * vLat.y + vLat.z * vLat.z;
                constexpr float kRollV2 = 1e-4f;
                if (v2 > kRollV2) {
                    // n x v_lat / r  (right-hand, n = contact up)
                    vec3 wTarget{up.y * vLat.z - up.z * vLat.y,
                                 up.z * vLat.x - up.x * vLat.z,
                                 up.x * vLat.y - up.y * vLat.x};
                    wTarget.x /= r;
                    wTarget.y /= r;
                    wTarget.z /= r;
                    // get_or_emplace, NOT emplace_or_replace — the same form
                    // `Impact` uses above. With no constructor arguments,
                    // emplace_or_replace assigns a value-initialized
                    // AngularVelocity{} over the existing one (EnTT
                    // registry.hpp: `curr = Type{args...}`), so `ang.w` was
                    // ALWAYS {0,0,0} on the right-hand side and the blend below
                    // collapsed to `ang.w = wTarget * kBlend`. Two consequences,
                    // both silent: a rolling body span at a permanent 35% of the
                    // correct n x v_lat / r and never converged, and any authored
                    // tumble (prop_system.cpp gives a detached ragdoll one) was
                    // wiped by the first grounded substep. [problems.md] §16.
                    auto& ang = reg.get_or_emplace<AngularVelocity>(e);
                    constexpr float kBlend = 0.35f;
                    ang.w.x = ang.w.x * (1.0f - kBlend) + wTarget.x * kBlend;
                    ang.w.y = ang.w.y * (1.0f - kBlend) + wTarget.y * kBlend;
                    ang.w.z = ang.w.z * (1.0f - kBlend) + wTarget.z * kBlend;
                    if (!reg.all_of<Rotation>(e)) reg.emplace<Rotation>(e);
                }
            }

            if (auto* ang = reg.try_get<AngularVelocity>(e)) {
                if (auto* rot = reg.try_get<Rotation>(e)) {
                    rot->euler.x += ang->w.x * h;
                    rot->euler.y += ang->w.y * h;
                    rot->euler.z += ang->w.z * h;
                    // Settle spin only when grounded AND not actively rolling.
                    if (g && g->grounded) {
                        const float vn = dot(vel.v, up);
                        const float vLat2 =
                            (vel.v.x - up.x * vn) * (vel.v.x - up.x * vn) +
                            (vel.v.y - up.y * vn) * (vel.v.y - up.y * vn) +
                            (vel.v.z - up.z * vn) * (vel.v.z - up.z * vn);
                        if (vLat2 <= 1e-4f) {
                            ang->w.x *= 0.85f;
                            ang->w.y *= 0.85f;
                            ang->w.z *= 0.85f;
                        }
                    }
                }
            }        }
    }
}


} // namespace giga
