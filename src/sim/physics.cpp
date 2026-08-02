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
    int x0 = floor_div(pos.x - half.x, kVoxelSize);
    int x1 = floor_div(pos.x + half.x, kVoxelSize);
    int y0 = floor_div(pos.y - half.y, kVoxelSize);
    int y1 = floor_div(pos.y + half.y, kVoxelSize);
    int z0 = floor_div(pos.z - half.z, kVoxelSize);
    int z1 = floor_div(pos.z + half.z, kVoxelSize);
    for (int z = z0; z <= z1; ++z)
        for (int y = y0; y <= y1; ++y)
            for (int x = x0; x <= x1; ++x)
                if (voxel_solid(world, x, y, z)) return true;
    return false;
}

namespace {

// Move `pos` along one axis by `delta`, backing out of any solid overlap. The
// axis is selected by `comp` (0=x,1=y,2=z). Returns true if a collision on this
// axis stopped the motion (used to zero the matching velocity component).
bool sweep_axis(const World& w, vec3& pos, vec3 half, int comp, float delta) {
    float* p = (comp == 0) ? &pos.x : (comp == 1) ? &pos.y : &pos.z;
    float old = *p;
    *p = old + delta;
    if (!aabb_overlaps_solid(w, pos, half)) return false;

    // Collided: binary-search back to the last non-overlapping position so the
    // box rests flush against the sub-voxel surface.
    float lo = 0.0f, hi = delta;
    for (int i = 0; i < 12; ++i) {
        float mid = 0.5f * (lo + hi);
        *p = old + mid;
        if (aabb_overlaps_solid(w, pos, half)) hi = mid; else lo = mid;
    }
    *p = old + lo;
    return true;
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
                    auto& ang = reg.emplace_or_replace<AngularVelocity>(e);
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
