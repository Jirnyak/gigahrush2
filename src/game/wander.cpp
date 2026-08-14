#include "core/rng.h"
#include "game/wander.h"

#include <cmath>
#include <vector>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/ai.h"       // ai_owns_motion — the single-writer guard for Velocity
#include "game/combat.h"
#include "game/embody.h"   // NpcRef
#include "game/faction_relations.h"
#include "game/hunt.h"
#include "game/mob_behaviour.h"
#include "game/mob_table.h"
#include "game/mob_spawn.h"
#include "world/gravity.h"
#include "world/lattice.h"
#include "world/types.h"

namespace giga::game {

namespace {

// Walking speed for an ordinary resident, m/s. Mobs override this from their
// table row (speed is authored in cells/s, and a cell is kCellSize metres).
constexpr float kNpcWalkSpeed = 1.35f;

// Visits to wait before choosing a new destination after arriving or failing.
// Staggered visits, not ticks: with kWanderPeriod = 8 at 120 Hz this is ~1.1 s.
constexpr std::uint8_t kRepathCooldown = 16;

// Pack alert coordination storage (256 pack slots)
struct PackAlertTable {
    PackAlert slots[256]{};
};
PackAlertTable g_packAlerts{};

// kAggroRadius moved to wander.h — [investigate.h] needs the same number to decide
// whether a mob is already hunting by sight or is free to investigate a sound.

// Cell the agent currently occupies.
void agent_cell(const vec3& pos, int& cx, int& cy, int& cz) {
    cx = wrap_macro(static_cast<int>(pos.x / kCellSize));
    cy = wrap_macro(static_cast<int>(pos.y / kCellSize));
    cz = wrap_macro(static_cast<int>(pos.z / kCellSize));
}

} // namespace

void pack_alert_broadcast(std::uint8_t pack, LayerId layer, const vec3& pos,
                          std::uint32_t targetId, std::uint64_t tick) {
    if (pack == 0) return;
    PackAlert& a = g_packAlerts.slots[pack];
    a.pos = pos;
    a.targetId = targetId;
    a.alertTick = tick;
    a.layer = layer;
    a.active = true;
}

PackAlert pack_alert_get(std::uint8_t pack, LayerId layer, std::uint64_t tick) {
    if (pack == 0) return PackAlert{};
    const PackAlert& a = g_packAlerts.slots[pack];
    if (!a.active || a.layer != layer) return PackAlert{};
    if (tick > a.alertTick && (tick - a.alertTick) > kPackAlertTtlTicks) {
        return PackAlert{};
    }
    return a;
}

void pack_alert_clear() {
    for (auto& s : g_packAlerts.slots) s = PackAlert{};
}

std::uint8_t pack_target_node(std::uint8_t pack, std::uint64_t tick) {
    const std::uint32_t epoch = static_cast<std::uint32_t>(tick / kPackEpochTicks);
    // The epoch is mixed before it is combined, not after: raw epochs are 0,1,2...
    // and XORing a small counter into a small pack id would make neighbouring packs
    // and neighbouring epochs collide in blocks.
    const std::uint32_t h =
        hash_u32((static_cast<std::uint32_t>(pack) * 0x9e3779b9u) ^ hash_u32(epoch));
    return static_cast<std::uint8_t>(h % nav::kNodes);
}

std::uint32_t wander_init(Registry& reg, LayerId layer, std::uint32_t seed) {
    pack_alert_clear();
    // Two phases, and the split is the discipline combat.cpp documents at length,
    // not tidiness: `emplace<WanderTarget>` on the FIRST agent creates that
    // component's storage, which can reallocate the registry's pool container and
    // dangle the view being iterated. Phase 1 only reads; phase 2 writes once the
    // view is gone. Bounded by the live-actor budget, and this runs at floor load.
    struct Candidate {
        Entity e;
        std::uint8_t pack;
    };
    std::vector<Candidate> fresh;

    auto view = reg.view<const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;          // the player
        if (reg.all_of<WanderTarget>(e)) continue;       // already wandering
        std::uint8_t pack = 0;
        if (const MobRef* m = reg.try_get<MobRef>(e)) {
            // Immobile mobs are architecture; giving them a destination would only
            // make them fight their own zero speed every pass.
            if (has_flag(kMobTable[m->kind].aiFlags, AiFlag::Immobile)) continue;
            pack = m->pack;
        }
        fresh.push_back(Candidate{e, pack});
    }

    for (const Candidate& c : fresh) {
        // A packed agent's very first destination is its PACK's, so the group is
        // coherent on pass one. Anything without a pack — every embodied resident —
        // keeps the original per-identity roll and is completely unaffected.
        const std::uint8_t node =
            c.pack != 0
                ? pack_target_node(c.pack, 0)
                : static_cast<std::uint8_t>(
                      hash_u32(seed ^
                          (static_cast<std::uint32_t>(entt::to_integral(c.e)) *
                           0x9e3779b9u)) %
                      nav::kNodes);
        reg.emplace<WanderTarget>(c.e, WanderTarget{node, 0, c.pack});
    }
    return static_cast<std::uint32_t>(fresh.size());
}

namespace {

// Is any of the four cardinal neighbours solid? The reference's wall-bias context
// runs a radius-2 disc scan and derives several scores from it; only `adjacentWall`
// has a consumer here, so only that is computed — four cell reads instead of
// twenty-one, for the one number that is actually read.
bool adjacent_wall(const MacroGrid& grid, const vec3& pos) {
    const int cx = static_cast<int>(pos.x / kCellSize);
    const int cy = static_cast<int>(pos.y / kCellSize);
    const int cz = static_cast<int>(pos.z / kCellSize);
    return grid.cell(cx + 1, cy, cz) != kCellAir ||
           grid.cell(cx - 1, cy, cz) != kCellAir ||
           grid.cell(cx, cy + 1, cz) != kCellAir ||
           grid.cell(cx, cy - 1, cz) != kCellAir;
}

} // namespace

void wander_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                 const nav::CoarseGraph& coarse,
                 const nav::FineNav& fine, LayerId layer, std::uint64_t tick,
                 const GravityField* gravity) {
    if (fine.flow.empty()) return;  // nav not baked for this floor

    GravityRegime steerRegime = GravityRegime::NegZ;
    if (gravity != nullptr) {
        steerRegime = gravity->regime;
        if (steerRegime == GravityRegime::Custom)
            steerRegime = regime_from_vector(gravity->global);
    }
    const GravityFrame gf = regime_frame(steerRegime);
    const auto tangent = [&gf](float x, float y, float z) {
        if (gf.axis == 0) x = 0.0f;
        else if (gf.axis == 1) y = 0.0f;
        else z = 0.0f;
        return vec3{x, y, z};
    };

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
        // Monsters do not hunt what they do not consider prey. Same gate as
        // mob_attack_step, and it has to be in BOTH: gating only the attack would
        // give a cultist a floor of monsters that chase and never swing, which reads
        // as broken pathfinding rather than as safety.
        if (const NpcRef* nr = reg.try_get<NpcRef>(e))
            if (!mob_hostile_to(pool, nr->id)) continue;
        victimPos = t.pos;
        victimId = static_cast<std::uint32_t>(entt::to_integral(e));
        const CameraTag& cam = reg.get<const CameraTag>(e);
        fwdX = std::cos(cam.yaw);
        fwdY = std::sin(cam.yaw);
        haveVictim = true;
        break;
    }

    struct HazardHit {
        Entity mob;
        std::int16_t dmg;
        DamageChannel ch;
    };
    std::vector<HazardHit> hazardHits;

    auto view = reg.view<Transform, Velocity, WanderTarget>();
    for (auto e : view) {
        Transform& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;

        const MobRef* mr = reg.try_get<MobRef>(e);
        if (mr) {
            const MobDef& md = kMobTable[mr->kind];
            if (!has_flag(md.aiFlags, AiFlag::Flying)) {
                int cx, cy, cz;
                agent_cell(tr.pos, cx, cy, cz);
                CellType cellType = grid.cell(cx, cy, cz);
                CellType floorType = grid.cell(cx, cy, wrap_macro(cz - 1));
                CellHazard hz = get_cell_hazard(cellType);
                if (!hz.active) hz = get_cell_hazard(floorType);
                if (hz.active) {
                    hazardHits.push_back(HazardHit{e, hz.damage, hz.channel});
                }
            }
        }

        // THE SINGLE-WRITER GUARD ([ai.h]). Exactly one system may write a body's
        // horizontal Velocity on a tick, and the token that decides it is
        // AiBrain::motion: ai_step runs before this loop, claims the bodies it will
        // steer, and this skips them. Without it, ai_step and this loop both write the
        // same component every tick and the creature vibrates — a bug that reads as
        // broken physics and is not.
        //
        // ADDITIVE TODAY, on purpose. A body with no AiBrain returns false, AiBrain is
        // attached only by ai_init, and ai_init has no caller yet — so this is a null
        // try_get and nothing else changes. That is what makes the AI's default-off real
        // rather than aspirational, and it is why the guard lands BEFORE the AI is
        // switched on instead of in the same commit.
        if (ai_owns_motion(reg, e)) continue;

        // The player is steered by input, never by the flow field. wander_init
        // already refuses to GIVE the camera holder a target (see the CameraTag
        // check in its loop above), but that only protects a body that was the
        // player when the floor was populated. possess_a_survivor hands CameraTag
        // and Controller to a resident that has been wandering for minutes and
        // therefore already carries a WanderTarget, so after any death this loop
        // was overwriting the player's own velocity every stagger period — the
        // documented contract in [wander.h] ("The player is skipped — it holds
        // CameraTag and is steered by input") held only until the first death.
        // Checked here rather than by stripping WanderTarget on possession: the
        // component is harmless data, and an exclusion at the point of steering
        // cannot be defeated by a future third way of becoming the player.
        if (reg.all_of<CameraTag>(e)) continue;

        // Identity-hash stagger: an agent's slot is a function of its own id, so
        // the crowd spreads evenly across the period with no scheduling state.
        const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(e));
        if (hash_u32(id) % kWanderPeriod != phase) continue;

        WanderTarget& wt = view.get<WanderTarget>(e);
        Velocity& vel = view.get<Velocity>(e);

        // A packed agent's destination is DERIVED from the pack every pass, never
        // remembered from whenever it last repathed. That is what makes cohesion
        // exact instead of statistical: two members in different stagger slots
        // cannot come to hold different nodes, because neither of them is holding a
        // decision of its own. One mix per visit, and `wt.node` degrades to a cache.
        if (wt.pack != 0) wt.node = pack_target_node(wt.pack, tick);

        // Aggro overrides navigation entirely: a monster that can see you does not
        // consult a flow field, it comes straight at you. Straight-line pursuit is
        // correct at this range — inside 20 m in an apartment interior there is
        // rarely a wall worth routing around, and physics stops it if there is.
        //
        // Only mobs hunt. What they may hunt is now the crowd as well as the camera
        // holder, and the RATE is the whole design — see [hunt.h] before touching
        // this. Residents themselves still walk past the carnage: NPC-on-NPC and
        // NPC-on-monster fighting is a threat model this does not have.
        if (mr) {
            const MobDef& md = kMobTable[mr->kind];
            const MobBehaviour beh = static_cast<MobBehaviour>(md.behaviour);
            // Ten kinds have their own sight range instead of the flat 20 m: three
            // notice you far LATER (2.15 to 7.5 m), which is the only reason walking
            // past a monster is ever possible, and six notice you EARLIER (23 to
            // 30 m). Both directions are authored. [mob_behaviour.h]
            const float radius = behaviour_aggro_radius(beh, kAggroRadius);

            // Pick the chase target. The camera holder first and at its full aggro
            // radius; only a monster with nobody better, and holding this epoch's
            // hunting licence, drops to the crowd — and then only inside
            // min(kHuntRadius, its own radius), so the player can never lose a monster
            // to a resident standing further away than it can see the player.
            //
            // The prey scan runs inside this view's iteration and that is safe for one
            // stated reason: `nearest_prey` takes a const Registry and reads only
            // components that already exist, so it can neither create a storage nor
            // reallocate the pool container this live view is holding.
            bool chasing = false;
            float ax = 0.0f, ay = 0.0f;
            std::uint32_t chaseId = victimId;
            if (haveVictim) {
                ax = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
                ay = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
                const float az = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
                if (ax * ax + ay * ay + az * az < radius * radius) {
                    chasing = true;
                    if (wt.pack != 0) {
                        pack_alert_broadcast(wt.pack, layer, victimPos, victimId, tick);
                    }
                }
            }
            if (!chasing && mob_hunts_npcs(id, tick)) {
                // Clamped to the mob's OWN sight radius, not left at the flat 6 m.
                // [hunt.h] states "the player wins inside kHuntRadius" as a strict
                // rule, and justifies it by kHuntRadius never exceeding the smallest
                // behaviour radius — which was true only while that smallest value
                // was CloseReveal's 6.0. LurkingFurniture is 2.15 ([mob_behaviour.h]),
                // so without this clamp a dormant Ковер would ignore the camera holder
                // standing 3 m away and go and eat a resident at 5 m: the rule
                // inverted, for the one kind whose whole design is not noticing you.
                // Derived from the radius rather than re-stated, so the next short
                // behaviour cannot reintroduce it.
                const float preyRadius = radius < kHuntRadius ? radius : kHuntRadius;
                const Prey pr = nearest_prey(reg, pool, layer, tr.pos, preyRadius);
                if (pr.e != entt::null) {
                    ax = wrap_delta_f(tr.pos.x, pr.pos.x, kWorldExtent);
                    ay = wrap_delta_f(tr.pos.y, pr.pos.y, kWorldExtent);
                    chaseId = static_cast<std::uint32_t>(entt::to_integral(pr.e));
                    chasing = true;
                    if (wt.pack != 0) {
                        pack_alert_broadcast(wt.pack, layer, pr.pos, chaseId, tick);
                    }
                }
            }
            // Pack target coordination: if not directly aggroed, check if a pack mate has alerted
            if (!chasing && wt.pack != 0) {
                const PackAlert pa = pack_alert_get(wt.pack, layer, tick);
                if (pa.active) {
                    const float pax = wrap_delta_f(tr.pos.x, pa.pos.x, kWorldExtent);
                    const float pay = wrap_delta_f(tr.pos.y, pa.pos.y, kWorldExtent);
                    const float paz = wrap_delta_f(tr.pos.z, pa.pos.z, kWorldExtent);
                    if (pax * pax + pay * pay + paz * paz < kPackAlertRange * kPackAlertRange) {
                        ax = pax;
                        ay = pay;
                        chaseId = pa.targetId;
                        chasing = true;
                    }
                }
            }
            if (chasing) {
                // Frozen while looked at. This returns BEFORE any velocity is
                // written, so a gazed Sculpture holds perfectly still instead of
                // coasting on last pass's velocity.
                //
                // The delta is VIEWER -> monster and is recomputed from the camera
                // holder rather than reused from the chase vector, because those are
                // now two different things: a Sculpture stalking a resident must still
                // freeze while you are watching it, or the one behaviour that gives it
                // counterplay would switch itself off the moment it found other prey.
                if (haveVictim) {
                    const float gx =
                        wrap_delta_f(victimPos.x, tr.pos.x, kWorldExtent);
                    const float gy =
                        wrap_delta_f(victimPos.y, tr.pos.y, kWorldExtent);
                    if (frozen_by_gaze(beh, fwdX, fwdY, gx, gy)) {
                        vel.v.x = 0.0f;
                        vel.v.y = 0.0f;
                        continue;
                    }
                }
                const float len = std::sqrt(ax * ax + ay * ay);
                if (len > 0.05f) {
                    // Steer at a SLOT around the victim, not at the victim itself.
                    // Two behaviours turn a converging queue into an encirclement,
                    // and both offsets are pure functions of entity ids — no state,
                    // no coordination, no spatial query. [mob_behaviour.h]
                    const PursuitOffset off =
                        pursuit_offset(beh, id, chaseId, ax / len, ay / len);
                    float tx = ax + off.x;
                    float ty = ay + off.y;
                    float tl = std::sqrt(tx * tx + ty * ty);
                    // Standing exactly on the slot must not divide by zero, and
                    // must not stop the chase either: fall back to the direct line.
                    if (tl < 0.05f) { tx = ax; ty = ay; tl = len; }
                    float sp = static_cast<float>(md.speedMmps) *
                               0.001f * kCellSize;
                    // Wall-adjacency pace. The four AiFlag::WallBias carriers move
                    // faster hugging a wall and slower in the open, which makes
                    // corridors and doorways genuinely worse places to be caught
                    // than open rooms — free level design, extracted from geometry
                    // that already exists. Two BEHAVIOURS read the same query with
                    // their own numbers (Арматура x1.22/x0.68, Панельник
                    // x1.02/x0.90) and TAKE PRECEDENCE over the flag rather than
                    // stacking with it: Арматура carries both, and multiplying
                    // would give it 1.44 where the reference gives 1.22.
                    // [mob_behaviour.h]
                    //
                    // One gate, one query. `wall_query_needed` is true for 5 of the
                    // 69 kinds, so the four cardinal cell reads stay off the other
                    // 64 — wave 2 added the query for exactly one more kind.
                    if (wall_query_needed(md.aiFlags, beh)) {
                        const bool wall = adjacent_wall(grid, tr.pos);
                        const MoveMult bm = behaviour_move_mult(beh, wall);
                        sp *= bm.claimed ? bm.mult
                                         : wall_bias_speed(md.aiFlags, wall);
                    }
                    const game::BurstPhase bp = game::burst_phase(beh, id, tick, len);
                    sp *= game::burst_speed_mult(bp);
                    sp *= game::behaviour_hurt_move_mult(beh, mr->hp, mr->maxHp);
                    const vec3 to = tangent(tx, ty, 0.0f);
                    const float toLen = length(to);
                    if (toLen > 0.001f) {
                        if (gf.axis != 0) vel.v.x = (to.x / toLen) * sp;
                        if (gf.axis != 1) vel.v.y = (to.y / toLen) * sp;
                        if (gf.axis != 2) vel.v.z = (to.z / toLen) * sp;
                    }
                }
                continue;  // no repath, no flow read — it has a target
            }
        }

        int cx, cy, cz;
        agent_cell(tr.pos, cx, cy, cz);

        // Steer toward the CURRENT lattice node on the coarse route, not the
        // final destination: the flow fields route to a node, and the coarse
        // next-hop table is what makes a multi-node journey a sequence of them.
        // Spec 15 §2: query the baked geodesic nearest_node field (guarantees
        // reachability), falling back to Voronoi partition if outside fine field.
        const std::uint8_t nearAnchor = fine.nearest_node(cx, cy, cz);
        const int here = (nearAnchor < nav::kNodes)
                             ? static_cast<int>(nearAnchor)
                             : lattice_id(lattice_axis_of(cx), lattice_axis_of(cy),
                                          lattice_axis_of(cz));
        const int hop = nav::coarse_next(coarse, here, wt.node);
        std::uint8_t flow = fine.at(hop, cx, cy, cz);

        if (wt.cooldown > 0) --wt.cooldown;

        const bool arrived = (flow == nav::kFlowArrived && hop == wt.node);
        const bool stuck = (flow == nav::kFlowNone);
        if (arrived || stuck) {
            // Pick a fresh destination, but not every pass — thrashing between
            // unreachable nodes would burn the whole stagger budget on repathing.
            if (wt.pack == 0 && wt.cooldown == 0) {
                std::uint32_t h = hash_u32(id ^ static_cast<std::uint32_t>(tick));
                wt.node = static_cast<std::uint8_t>(h % nav::kNodes);
                wt.cooldown = kRepathCooldown;
            }
            if (gf.axis != 0) vel.v.x = 0.0f;
            if (gf.axis != 1) vel.v.y = 0.0f;
            if (gf.axis != 2) vel.v.z = 0.0f;
            continue;
        }

        const bool inWalkingPlane =
            (flow < 6) && ((flow >> 1) != gf.axis);

        vec3 dir{0.0f, 0.0f, 0.0f};
        if (inWalkingPlane) {
            // The common, good case: the bake hands us the exact next step along a
            // shortest wrapped path, obstacle avoidance included, for one byte.
            dir.x = static_cast<float>(nav::kNavDir[flow][0]);
            dir.y = static_cast<float>(nav::kNavDir[flow][1]);
            dir.z = static_cast<float>(nav::kNavDir[flow][2]);
        } else {
            // Fall back to the bearing toward the hop node's column in the tangent plane:
            const LatticeNode ln = lattice_unpack(hop);
            const float tx = static_cast<float>(lattice_coord(ln.ix)) * kCellSize;
            const float ty = static_cast<float>(lattice_coord(ln.iy)) * kCellSize;
            const float tz = static_cast<float>(lattice_coord(ln.iz)) * kCellSize;
            const vec3 delta = tangent(
                wrap_delta_f(tr.pos.x, tx, kWorldExtent),
                wrap_delta_f(tr.pos.y, ty, kWorldExtent),
                wrap_delta_f(tr.pos.z, tz, kWorldExtent));
            const float len = length(delta);
            if (len < kCellSize) {
                if (wt.pack == 0 && wt.cooldown == 0) {
                    std::uint32_t h =
                        hash_u32(id ^ static_cast<std::uint32_t>(tick) ^ 0x5bf03635u);
                    wt.node = static_cast<std::uint8_t>(h % nav::kNodes);
                    wt.cooldown = kRepathCooldown;
                }
                if (gf.axis != 0) vel.v.x = 0.0f;
                if (gf.axis != 1) vel.v.y = 0.0f;
                if (gf.axis != 2) vel.v.z = 0.0f;
                continue;
            }
            dir = delta * (1.0f / len);
        }

        float speed = kNpcWalkSpeed;
        if (const MobRef* m = reg.try_get<MobRef>(e)) {
            // Table speed is cells/s in fixed point; a cell is kCellSize metres.
            speed = static_cast<float>(kMobTable[m->kind].speedMmps) * 0.001f *
                    kCellSize;
        }

        if (gf.axis != 0) vel.v.x = dir.x * speed;
        if (gf.axis != 1) vel.v.y = dir.y * speed;
        if (gf.axis != 2) vel.v.z = dir.z * speed;
        // Gravity axis is left to physics_step
    }

    for (const auto& hit : hazardHits) {
        apply_damage(reg, pool, hit.mob, hit.dmg, hit.ch, entt::null, &grid);
    }
}

} // namespace giga::game
