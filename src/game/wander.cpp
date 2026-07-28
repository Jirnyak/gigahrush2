#include "game/wander.h"

#include <cmath>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/mob_behaviour.h"
#include "game/mob_table.h"
#include "game/mob_spawn.h"
#include "world/lattice.h"
#include "world/types.h"

namespace giga::game {

namespace {

// splitmix64-style scrambler, as elsewhere in the game layer.
std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// Walking speed for an ordinary resident, m/s. Mobs override this from their
// table row (speed is authored in cells/s, and a cell is kCellSize metres).
constexpr float kNpcWalkSpeed = 1.35f;

// Visits to wait before choosing a new destination after arriving or failing.
// Staggered visits, not ticks: with kWanderPeriod = 8 at 120 Hz this is ~1.1 s.
constexpr std::uint8_t kRepathCooldown = 16;

// Aggro range, metres. Inside this a mob drops navigation and closes on the
// camera holder directly. 20 m is a corridor-and-a-half: far enough that a floor
// feels hunted, near enough that the whole roster does not converge at once.
constexpr float kAggroRadius = 20.0f;

// Cell the agent currently occupies.
void agent_cell(const vec3& pos, int& cx, int& cy, int& cz) {
    cx = wrap_macro(static_cast<int>(pos.x / kCellSize));
    cy = wrap_macro(static_cast<int>(pos.y / kCellSize));
    cz = wrap_macro(static_cast<int>(pos.z / kCellSize));
}

} // namespace

std::uint32_t wander_init(Registry& reg, LayerId layer, std::uint32_t seed) {
    std::uint32_t n = 0;
    auto view = reg.view<const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;          // the player
        if (reg.all_of<WanderTarget>(e)) continue;       // already wandering
        // Immobile mobs are architecture; giving them a destination would only
        // make them fight their own zero speed every pass.
        if (const MobRef* m = reg.try_get<MobRef>(e))
            if (has_flag(kMobTable[m->kind].aiFlags, AiFlag::Immobile)) continue;

        std::uint32_t h = mix(seed ^ (static_cast<std::uint32_t>(entt::to_integral(e)) *
                                      0x9e3779b9u));
        reg.emplace<WanderTarget>(
            e, WanderTarget{static_cast<std::uint8_t>(h % nav::kNodes), 0});
        ++n;
    }
    return n;
}

void wander_step(Registry& reg, const nav::CoarseGraph& coarse,
                 const nav::FineNav& fine, LayerId layer, std::uint64_t tick) {
    if (fine.flow.empty()) return;  // nav not baked for this floor

    const std::uint32_t phase = static_cast<std::uint32_t>(tick % kWanderPeriod);

    // Whoever holds the camera. Mobs inside kAggroRadius abandon their wander and
    // come for it, which is what turns 77 idle monsters into a threat. Found once
    // per pass, not per agent.
    bool haveVictim = false;
    vec3 victimPos{0, 0, 0};
    std::uint32_t victimId = 0;
    // The viewer's forward, for WeepingAngel. Computed ONCE per pass, not per
    // monster: the whole reason the gaze test compares cosines is that no monster
    // then needs any trig of its own.
    float fwdX = 1.0f, fwdY = 0.0f;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        victimPos = t.pos;
        victimId = static_cast<std::uint32_t>(entt::to_integral(e));
        const CameraTag& cam = reg.get<const CameraTag>(e);
        fwdX = std::cos(cam.yaw);
        fwdY = std::sin(cam.yaw);
        haveVictim = true;
        break;
    }

    auto view = reg.view<Transform, Velocity, WanderTarget>();
    for (auto e : view) {
        Transform& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;

        // Identity-hash stagger: an agent's slot is a function of its own id, so
        // the crowd spreads evenly across the period with no scheduling state.
        const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(e));
        if (mix(id) % kWanderPeriod != phase) continue;

        WanderTarget& wt = view.get<WanderTarget>(e);
        Velocity& vel = view.get<Velocity>(e);

        // Aggro overrides navigation entirely: a monster that can see you does not
        // consult a flow field, it comes straight at you. Straight-line pursuit is
        // correct at this range — inside 20 m in an apartment interior there is
        // rarely a wall worth routing around, and physics stops it if there is.
        // Only mobs hunt; residents keep wandering past the carnage for now.
        if (haveVictim && reg.all_of<MobRef>(e)) {
            const float ax = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
            const float ay = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
            const float az = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
            const float d2 = ax * ax + ay * ay + az * az;
            const MobRef& mr = reg.get<const MobRef>(e);
            const MobDef& md = kMobTable[mr.kind];
            const MobBehaviour beh = static_cast<MobBehaviour>(md.behaviour);
            // Two kinds notice you far later than everyone else, which is the only
            // reason walking past a monster is ever possible. [mob_behaviour.h]
            const float radius = behaviour_aggro_radius(beh, kAggroRadius);
            if (d2 < radius * radius) {
                // Frozen while looked at. This returns BEFORE any velocity is
                // written, so a gazed Sculpture holds perfectly still instead of
                // coasting on last pass's velocity.
                if (frozen_by_gaze(beh, fwdX, fwdY, -ax, -ay)) {
                    vel.v.x = 0.0f;
                    vel.v.y = 0.0f;
                    continue;
                }
                const float len = std::sqrt(ax * ax + ay * ay);
                if (len > 0.05f) {
                    // Steer at a SLOT around the victim, not at the victim itself.
                    // Two behaviours turn a converging queue into an encirclement,
                    // and both offsets are pure functions of entity ids — no state,
                    // no coordination, no spatial query. [mob_behaviour.h]
                    const PursuitOffset off =
                        pursuit_offset(beh, id, victimId, ax / len, ay / len);
                    float tx = ax + off.x;
                    float ty = ay + off.y;
                    float tl = std::sqrt(tx * tx + ty * ty);
                    // Standing exactly on the slot must not divide by zero, and
                    // must not stop the chase either: fall back to the direct line.
                    if (tl < 0.05f) { tx = ax; ty = ay; tl = len; }
                    const float sp = static_cast<float>(md.speedMmps) *
                                     0.001f * kCellSize;
                    vel.v.x = tx / tl * sp;
                    vel.v.y = ty / tl * sp;
                }
                continue;  // no repath, no flow read — it has a target
            }
        }

        int cx, cy, cz;
        agent_cell(tr.pos, cx, cy, cz);

        // Steer toward the CURRENT lattice node on the coarse route, not the
        // final destination: the flow fields route to a node, and the coarse
        // next-hop table is what makes a multi-node journey a sequence of them.
        const int here = lattice_id(lattice_axis_of(cx), lattice_axis_of(cy),
                                    lattice_axis_of(cz));
        const int hop = nav::coarse_next(coarse, here, wt.node);
        std::uint8_t flow = fine.at(hop, cx, cy, cz);

        if (wt.cooldown > 0) --wt.cooldown;

        const bool arrived = (flow == nav::kFlowArrived && hop == wt.node);
        const bool stuck = (flow == nav::kFlowNone);
        if (arrived || stuck) {
            // Pick a fresh destination, but not every pass — thrashing between
            // unreachable nodes would burn the whole stagger budget on repathing.
            if (wt.cooldown == 0) {
                std::uint32_t h = mix(id ^ static_cast<std::uint32_t>(tick));
                wt.node = static_cast<std::uint8_t>(h % nav::kNodes);
                wt.cooldown = kRepathCooldown;
            }
            vel.v.x = 0.0f;
            vel.v.y = 0.0f;
            continue;
        }

        float dirX = 0.0f, dirY = 0.0f;
        const bool horizontalStep =
            (flow < 6) && (nav::kNavDir[flow][2] == 0);

        if (horizontalStep) {
            // The common, good case: the bake hands us the exact next step along a
            // shortest wrapped path, obstacle avoidance included, for one byte.
            dirX = static_cast<float>(nav::kNavDir[flow][0]);
            dirY = static_cast<float>(nav::kNavDir[flow][1]);
        } else {
            // The flow says "climb" (or we are standing on the hop node). A walking
            // body cannot climb a storey, and stairwell traversal is not wired.
            //
            // This is NOT a rare edge case, which is why it gets a real fallback
            // instead of a shrug: measured on a Residential floor, 110 of 120
            // ground-storey residents get a vertical first step. All 64 lattice
            // nodes sit at cell z in {16, 48, 80, 112} while a floor module's crowd
            // stands at z = 1, so nearly every route begins by going up. Refusing
            // the step left 92% of the crowd standing still.
            //
            // Fall back to the horizontal bearing toward the hop node's column: the
            // agent walks toward the shaft rather than freezing, which is both
            // plausible behaviour and the direction a future stairwell traversal
            // would want anyway. Physics resolves whatever it walks into.
            const LatticeNode ln = lattice_unpack(hop);
            const float tx = static_cast<float>(lattice_coord(ln.ix)) * kCellSize;
            const float ty = static_cast<float>(lattice_coord(ln.iy)) * kCellSize;
            const float ox = wrap_delta_f(tr.pos.x, tx, kWorldExtent);
            const float oy = wrap_delta_f(tr.pos.y, ty, kWorldExtent);
            const float len = std::sqrt(ox * ox + oy * oy);
            if (len < kCellSize) {
                // Already in the node's column with nowhere horizontal to go.
                if (wt.cooldown == 0) {
                    std::uint32_t h =
                        mix(id ^ static_cast<std::uint32_t>(tick) ^ 0x5bf03635u);
                    wt.node = static_cast<std::uint8_t>(h % nav::kNodes);
                    wt.cooldown = kRepathCooldown;
                }
                vel.v.x = 0.0f;
                vel.v.y = 0.0f;
                continue;
            }
            dirX = ox / len;
            dirY = oy / len;
        }

        float speed = kNpcWalkSpeed;
        if (const MobRef* m = reg.try_get<MobRef>(e)) {
            // Table speed is cells/s in fixed point; a cell is kCellSize metres.
            speed = static_cast<float>(kMobTable[m->kind].speedMmps) * 0.001f *
                    kCellSize;
        }

        vel.v.x = dirX * speed;
        vel.v.y = dirY * speed;
        // z is left to gravity: this is locomotion, not flight.
    }
}

} // namespace giga::game
