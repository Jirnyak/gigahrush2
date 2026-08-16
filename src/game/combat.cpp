#include "game/combat.h"
#include <cstdio>

#include <cmath>
#include <vector>

#include "core/math.h"
#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/container.h" // Container — inventory overflow on death
#include "game/embody.h"   // NpcRef
#include "game/equip.h"
#include "game/hunt.h"
#include "game/inventory.h" // Inventory — spill NPC bag into Corpse / cell containers
#include "game/loot.h"      // Pickup — floor overflow when corpse + cell containers full
#include "game/mob_spawn.h"
#include "game/prop_system.h" // Interactable::Kind::Corpse — §18 interaction tag


#include "game/faction_relations.h"
#include "game/mob_behaviour.h"
#include "game/mob_table.h"
#include "game/monster.h"
#include "game/monster_traits.h"
#include "game/ranged_table.h"
#include "game/rpg.h"      // RpgStats, xp_for_monster_kill, award_xp
#include "game/status.h"   // StatusSet, status_melee/aim mults
#include "game/weapon_table.h"
#include "sim/camera.h"   // camera_forward
#include "world/macro_grid.h"
#include "world/los.h"   // los_clear — a wall stops a fragment
#include "world/stain.h" // blood — the universal stain layer
#include "world/world.h"
#include "world/types.h"


namespace giga::game {

namespace {

bool adjacent_wall(const MacroGrid& grid, const vec3& pos) {
    const int cx = static_cast<int>(pos.x / kCellSize);
    const int cy = static_cast<int>(pos.y / kCellSize);
    const int cz = static_cast<int>(pos.z / kCellSize);
    return grid.cell(cx + 1, cy, cz) != kCellAir ||
           grid.cell(cx - 1, cy, cz) != kCellAir ||
           grid.cell(cx, cy + 1, cz) != kCellAir ||
           grid.cell(cx, cy - 1, cz) != kCellAir;
}

// Component `a` of a vec3 by index, 0/1/2.
//
// The grenade bounce below is written entirely over this accessor rather than over
// `.x` / `.y` / `.z`, and that is [problems.md] §34's isotropy law in code form: the
// three axes are searched by ONE loop, so none of them can quietly acquire a special
// case the way "reflect whichever component is biggest" would. What reflects a
// grenade is the cell FACE it crossed; which letter that face belongs to is a
// result, never an input.
inline float& axis(vec3& v, int a) { return a == 0 ? v.x : (a == 1 ? v.y : v.z); }
inline float axis(const vec3& v, int a) { return a == 0 ? v.x : (a == 1 ? v.y : v.z); }

// Is the cell containing `p` solid? Cell level and not sub-voxel, for the reason the
// bullet path states: a grenade clipping the corner of a wall should bounce, and the
// sub-voxel mask would let it slip through a half-carved cell that reads as solid.
//
// `MacroGrid::cell` wraps all three indices itself, so an unwrapped world position
// is safe here — which is what lets the sweep below work in unwrapped coordinates
// and wrap once, at the end. Out-of-stack z is solid: the bottom of the level has no
// floor below it to fall through, and a grenade that fell out of the world would
// detonate 200 m away from where the player watched it land.
bool cell_solid(const MacroGrid& grid, const vec3& p) {
    const int cz = static_cast<int>(std::floor(p.z / kCellSize));
    if (cz < 0 || cz >= kMacroDim) return true;
    return grid.cell(static_cast<int>(std::floor(p.x / kCellSize)),
                     static_cast<int>(std::floor(p.y / kCellSize)), cz) != kCellAir;
}

// How far past a face to place the grenade after a reflection, metres. Big enough
// that the next step's `floor(p / kCellSize)` lands in the new cell despite float
// error, small enough to be invisible at a 2 m cell.
inline constexpr float kBounceEpsilon = 1e-3f;

// Advance one grenade by `dt`, reflecting it off every cell face it crosses.
//
// A miniature DDA rather than "integrate, then test the destination": the destination
// test alone is wrong at a corner, where the step crosses an AIR face first and the
// solid cell second — it would reflect off the wrong face and send the grenade back
// up the corridor it came from. So the step is walked crossing by crossing, and each
// crossing asks the cell it is about to ENTER whether it is solid.
//
// Bounded at four crossings. One 8 ms step at the 16 m/s throw speed covers 0.13 m
// against a 2 m cell, so three is already unreachable; the fourth is there so the
// bound is a bound and not a guess.
void grenade_advance(const MacroGrid& grid, vec3& pos, vec3& vel, float dt) {
    vec3 from = pos;
    float remain = dt;
    for (int iter = 0; iter < 4 && remain > 1e-6f; ++iter) {
        const vec3 to = from + vel * remain;

        // The earliest cell-boundary plane this segment crosses, over all three axes
        // by the same rule.
        float bestT = 2.0f;
        int bestA = -1;
        float bestDelta = 0.0f;
        for (int a = 0; a < 3; ++a) {
            const float f = axis(from, a);
            const float d = axis(to, a) - f;
            if (d > -1e-9f && d < 1e-9f) continue;
            const int cf = static_cast<int>(std::floor(f / kCellSize));
            const int ct = static_cast<int>(std::floor(axis(to, a) / kCellSize));
            if (cf == ct) continue;
            const float plane =
                static_cast<float>(d > 0.0f ? cf + 1 : cf) * kCellSize;
            const float t = (plane - f) / d;
            if (t >= 0.0f && t < bestT) {
                bestT = t;
                bestA = a;
                bestDelta = d;
            }
        }
        if (bestA < 0) {
            // No face in the way. Either the whole step is free, or the grenade is
            // ALREADY inside solid — thrown point-blank into a wall from a body that
            // is itself clipped into geometry. There is no face to reflect off in
            // that case, so it stops dead and the fuse finishes the job; the
            // alternative is picking an axis to push out along, which is exactly the
            // guess §34 forbids. Drifting on through the rock is the one answer that
            // is definitely wrong.
            if (cell_solid(grid, to)) vel = vec3{0.0f, 0.0f, 0.0f};
            else from = to;
            remain = 0.0f;
            break;
        }

        // Contact point, nudged just inside the cell being entered so the solidity
        // question is asked about that cell and not about the boundary itself.
        vec3 hit = from + (to - from) * bestT;
        const float nSign = bestDelta > 0.0f ? -1.0f : 1.0f;
        vec3 probe = hit;
        axis(probe, bestA) -= nSign * kBounceEpsilon;
        remain *= (1.0f - bestT);

        if (!cell_solid(grid, probe)) {   // an open face; keep going
            from = probe;
            continue;
        }

        // REFLECT off this face. The normal component flips and keeps
        // kGrenadeRestitution; the two tangential components — whichever two are not
        // `bestA` — keep kGrenadeFriction, which is what turns a bounce into a roll
        // instead of letting a grenade skate down a corridor forever.
        for (int a = 0; a < 3; ++a) {
            if (a == bestA) axis(vel, a) = -axis(vel, a) * kGrenadeRestitution;
            else axis(vel, a) *= kGrenadeFriction;
        }
        axis(hit, bestA) += nSign * kBounceEpsilon;   // rest OUTSIDE the face
        from = hit;
        if (length(vel) < kGrenadeRestSpeed) {
            vel = vec3{0.0f, 0.0f, 0.0f};   // settled; see kGrenadeRestSpeed
            break;
        }
    }
    // All three axes wrap on the 128^3 torus
    pos.x = wrapf(from.x, kWorldExtent);
    pos.y = wrapf(from.y, kWorldExtent);
    pos.z = wrapf(from.z, kWorldExtent);
}

// WHERE THE BARREL IS — the one function that decides it, for every spawner.
//
// Returns the point along `from + unitDir * t` at which the shot is provably OUTSIDE
// the sphere the hit test uses, starting from `kMuzzleForward` and pushing further
// only if it has to. `sourcePos` is the shooter's `Transform::pos`, which is what the
// hit test measures distances against — not the eye, and that gap is the whole bug
// this closes.
//
// **This reads the shooter and is NOT an exclusion, and the difference is the entire
// argument.** Placing a barrel is something a BODY does, once, at the moment it
// fires: the body has a size and the muzzle is outside it. What the manifesto
// forbids is a projectile IN FLIGHT that remembers whose it was and refuses to touch
// him. Nothing here is written onto the shot; it comes out at a position, and from
// that instant it is a physical object with no memory.
//
// Until 2026-08-13 this arithmetic was not done at all, and `projectile_step` carried
// `p.source != victim` instead — the LAST owner test in the tree, and the thing §33
// was supposed to have finished. It survived because it looked necessary: fire
// straight down and the muzzle lands `eyeOffset - kMuzzleForward` below the body
// origin, which for the default 1.75 m stature is 0.92 m — outside the 0.75 m sphere
// by 0.17 m. The rule was not paying for that case.
//
// It was paying for a case nobody had computed. `body_eye_height` is `h * 0.43`
// ([embody.cpp]) and `height_for_age` clamps stature at 2200 mm
// ([population.cpp]), so the tallest legal body has an eye at 0.946 m and its own
// straight-down shot is born 0.754 m away — **4 mm outside a 0.75 m sphere**. That
// margin is not geometry, it is a coincidence between three constants in three files
// that no comment connected, and one retune of any of them turns the tallest bodies
// in the game into suicides. Solving the ray/sphere exit makes it a guarantee at
// every stature and deletes the rule.
vec3 muzzle_point(const vec3& from, const vec3& unitDir, const vec3& sourcePos) {
    // Clearance, not just contact: the hit test is `<=`, and the shot's own first
    // integration step must not walk it back in.
    const float r = kProjHitRadius + 0.05f;
    const vec3 d{wrap_delta_f(sourcePos.x, from.x, kWorldExtent),
                 wrap_delta_f(sourcePos.y, from.y, kWorldExtent),
                 wrap_delta_f(sourcePos.z, from.z, kWorldExtent)};
    const float b = dot(unitDir, d);
    const float c = dot(d, d) - r * r;
    // Ray/sphere: with |unitDir| = 1 the exit parameter is -b + sqrt(b^2 - c). A
    // negative discriminant means the ray misses the sphere entirely, which is the
    // common case (a level shot from an eye 1.7 m ahead of a 0.8 m body).
    const float disc = b * b - c;
    float t = kMuzzleForward;
    if (disc > 0.0f) {
        const float exit = -b + std::sqrt(disc);
        if (exit > t) t = exit;
    }
    return vec3{from.x + unitDir.x * t, from.y + unitDir.y * t,
                from.z + unitDir.z * t};
}

// Percentage mitigation, clamped. A negative resist is a vulnerability, which is
// why this does not clamp the low end at zero.
std::int16_t mitigate(std::int16_t raw, std::int8_t resistPct) {
    int r = resistPct;
    if (r > 95) r = 95;    // never fully immune; a 100% wall is unkillable content
    if (r < -100) r = -100;
    int out = raw - (raw * r) / 100;
    if (out < 0) out = 0;
    return static_cast<std::int16_t>(out);
}

} // namespace

bool entity_health(const Registry& reg, const NpcPool& pool, Entity e,
                   std::int16_t& hp, std::int16_t& maxHp) {
    if (!reg.valid(e)) return false;
    if (const MobRef* m = reg.try_get<MobRef>(e)) {
        hp = m->hp;
        maxHp = m->maxHp;
        return true;
    }
    if (const NpcRef* n = reg.try_get<NpcRef>(e)) {
        if (!pool.valid(n->id)) return false;
        // const_cast: NpcPool's accessors are non-const by design (it is an SoA
        // table meant to be written through), but reading is genuinely const here.
        NpcPool& p = const_cast<NpcPool&>(pool);
        hp = p.hp(n->id);
        maxHp = p.max_hp(n->id);
        return true;
    }
    return false;
}

DamageResult apply_damage(Registry& reg, NpcPool& pool, Entity target,
                          std::int16_t raw, DamageChannel ch, Entity source,
                          const MacroGrid* grid, ParticleBurstQueue* particles,
                          const GravityField* gravity, const float* fluid) {
    DamageResult out;
    if (!reg.valid(target) || raw <= 0) return out;
    if (reg.all_of<Dead>(target)) return out;  // already scheduled to die
    if (reg.all_of<GodMode>(target)) return out; // console god mode: untouchable

    // Mitigation happens exactly once, here. Nothing downstream sees `raw`.
    std::int16_t dmg = raw;

    MobRef* m = reg.try_get<MobRef>(target);
    const Transform* targetTr = nullptr;
    auto get_target_tr = [&]() -> const Transform* {
        if (!targetTr) targetTr = reg.try_get<Transform>(target);
        return targetTr;
    };

    // Counterplay Vulnerability Floor (e.g. Fire vs Plant/Shark/Swarm monsters)
    if (m) {
        dmg = trait_counterplay_damage(m->kind, static_cast<std::uint8_t>(ch), dmg, m->maxHp);
    }

    if (reg.valid(source)) {
        if (const RpgStats* sRpg = reg.try_get<RpgStats>(source)) {
            if (ch == DamageChannel::Fire && has_perk(*sRpg, PerkId::Pyromaniac)) {
                int boosted = static_cast<int>(static_cast<float>(dmg) * 1.25f + 0.5f);
                dmg = static_cast<std::int16_t>(boosted > 32767 ? 32767 : (boosted < 0 ? 0 : boosted));
            }
        }
    }

    if (const Armour* a = reg.try_get<Armour>(target)) {
        std::size_t i = static_cast<std::size_t>(ch);
        if (i < kDamageChannels) dmg = mitigate(dmg, a->resist[i]);
    }
    if (const RpgStats* tRpg = reg.try_get<RpgStats>(target)) {
        const std::int16_t rpgRes = rpg_damage_resistance_pct(*tRpg, static_cast<std::uint8_t>(ch));
        if (rpgRes != 0) dmg = mitigate(dmg, static_cast<std::int8_t>(rpgRes));
    }

    // Burer kinetic shield mitigation / reactive activation:
    if (BurerAi* burer = reg.try_get<BurerAi>(target)) {
        const Transform* tr = get_target_tr();
        const vec3 tpos = tr ? tr->pos : vec3{0.0f, 0.0f, 0.0f};
        dmg = burer_mitigate_damage(*burer, ch, dmg, tpos, particles);
    }

    // Defender behaviour incoming damage multiplier (e.g. WallBrace armour against walls)
    if (grid && m) {
        if (static_cast<std::size_t>(m->kind) < kMobKindCount) {
            const MobDef& def = kMobTable[m->kind];
            const auto beh = static_cast<MobBehaviour>(def.behaviour);
            if (wall_query_needed(def.aiFlags, beh)) {
                if (const Transform* tr = get_target_tr()) {
                    const bool nearWall = adjacent_wall(*grid, tr->pos);
                    const float incMult = behaviour_incoming_mult(beh, nearWall);
                    if (incMult != 1.0f) {
                        int mitigated = static_cast<int>(static_cast<float>(dmg) * incMult + 0.5f);
                        if (mitigated < 1 && dmg > 0) mitigated = 1;
                        dmg = static_cast<std::int16_t>(mitigated);
                    }
                }
            }
        }
    }

    // Defender wet terrain incoming damage multiplier (e.g. Lotochnik drain armour)
    if (fluid && m) {
        if (const Transform* tr = get_target_tr()) {
            const bool wet = pos_wet(fluid, tr->pos);
            const float inMult = trait_incoming_mult(m->kind, wet);
            if (inMult != 1.0f) {
                int mitigated = static_cast<int>(static_cast<float>(dmg) * inMult + 0.5f);
                if (mitigated < 1 && dmg > 0) mitigated = 1;
                dmg = static_cast<std::int16_t>(mitigated);
            }
        }
    }

    out.blocked = static_cast<std::int16_t>(raw - dmg);

    // Spec 03 §4.1: Armor condition degradation when absorbing damage
    if (out.blocked > 0 && reg.valid(target)) {
        if (const NpcRef* tn = reg.try_get<NpcRef>(target)) {
            if (pool.valid(tn->id)) {
                Inventory& inv = pool.inventory(tn->id);
                const Equipped* eq = reg.try_get<Equipped>(target);
                const int armSlot = equipped_armour_slot(inv, eq);
                if (armSlot >= 0 && armSlot < kInvSlots) {
                    ItemSlot& aslot = inv.slots[armSlot];
                    if (item_valid(aslot.item) && aslot.condition > 0) {
                        const ItemDef& adef = item_def(aslot.item);
                        const std::uint32_t wearRate = std::max(1u, (static_cast<std::uint32_t>(out.blocked) *
                            (adef.wearPerUse > 0 ? static_cast<std::uint32_t>(adef.wearPerUse) : 2u) + 7u) / 8u);
                        if (aslot.condition > wearRate) {
                            aslot.condition = static_cast<std::uint8_t>(aslot.condition - wearRate);
                        } else {
                            aslot.condition = 0;
                        }
                        sync_armour(reg, pool, target);
                    }
                }
            }
        }
    }

    // Where the HP lives depends on what the target is, and that is the only
    // branch: everything above and below is common.
    std::int16_t* hp = nullptr;
    if (m) {
        hp = &m->hp;
    } else if (NpcRef* n = reg.try_get<NpcRef>(target)) {
        if (pool.valid(n->id)) hp = &pool.hp(n->id);
    }
    if (!hp) return out;  // nothing to damage; `hit` stays false

    out.hit = true;
    const std::int16_t before = *hp;
    std::int16_t after = static_cast<std::int16_t>(before - dmg);
    if (after < 0) after = 0;
    *hp = after;

    out.applied = static_cast<std::int16_t>(before - after);

    if (out.applied > 0) {
        if (RpgStats* tRpg = reg.try_get<RpgStats>(target)) {
            implant_take_damage(*tRpg, out.applied, static_cast<std::uint8_t>(ch));
        }
    }

    // Directional knockback impulse on hit (DOD DOD-compliant pure math).
    // LATERAL means "perpendicular to gravity", never "XZ": the plane is derived
    // from the layer's own gravity vector ([AGENTS.md] — gravity is a vector, and
    // "down" is never assumed to be -Z). A hit shoves the target away along the
    // ground, not up the slope of whichever axis happens to be vertical today.
    // Without a field the raw attacker→target line is used: still isotropic, just
    // uncorrected for slope — no axis is privileged in either branch.
    Velocity* targetVel = (out.applied > 0) ? reg.try_get<Velocity>(target) : nullptr;
    if (targetVel && get_target_tr()) {
        if (reg.valid(source) && reg.all_of<Transform>(source)) {
            const vec3& srcPos = reg.get<Transform>(source).pos;
            const vec3& tgtPos = targetTr->pos;
            vec3 d{wrap_delta_f(srcPos.x, tgtPos.x, kWorldExtent),
                   wrap_delta_f(srcPos.y, tgtPos.y, kWorldExtent),
                   wrap_delta_f(srcPos.z, tgtPos.z, kWorldExtent)};
            if (gravity) {
                const vec3 g = gravity->at(tgtPos);
                const float gLen = length(g);
                if (gLen > 1e-6f) {
                    // Strip the component along gravity: what is left is the floor plane.
                    const vec3 up = g * (-1.0f / gLen);
                    d = d - up * dot(d, up);
                }
            }
            const float lenSq = dot(d, d);
            if (lenSq > 0.001f) {
                // KNOCKBACK IS AN IMPULSE, so it divides by mass — p = m*v, the same
                // law `impact.cpp` charges energy with. It used to add a flat 2.5 m/s
                // to every body, which meant a loaded liquidator and an empty child
                // flew equally and the `Mass` component was decoration on this path.
                // Normalised at kKnockbackRefMassKg so the shipped feel is unchanged
                // for a body of average stature carrying nothing, and a full pack now
                // genuinely plants you.
                const Mass* km = reg.try_get<Mass>(target);
                const float kmass = km != nullptr && km->kg > 1.0f
                                        ? km->kg
                                        : kKnockbackRefMassKg;
                float kbSpeed = 1.5f;
                if (const NpcRef* sn = reg.try_get<NpcRef>(source)) {
                    if (pool.valid(sn->id)) {
                        const ItemId weaponId = equipped_melee(pool.inventory(sn->id));
                        const MeleeDef* mdef = melee_for_item(weaponId);
                        if (mdef && mdef->knockbackMm > 0) {
                            kbSpeed = static_cast<float>(mdef->knockbackMm) * 0.001f * kCellSize;
                        }
                    }
                }
                const float impulse = kbSpeed * (kKnockbackRefMassKg / kmass);
                targetVel->v = targetVel->v + d * (impulse / std::sqrt(lenSq));
            }
        }
    }
    out.lethal = (after == 0 && before > 0);

    // Blood — the unified particle pool's one writer for every hurt body
    // ([particles.h]). Psi is mental and bleeds nothing; everything physical
    // sprays away from the attacker, scaled by what actually landed.
    //
    // The 0.45 upward bias and the 0.9 chest offset ride the layer's gravity
    // vector rather than +Z, and the away-from-attacker component is taken in the
    // plane perpendicular to gravity — the same derivation the knockback block
    // above makes, from the same `gravity` parameter, which was already in scope
    // and simply went unread here. Magnitudes are untouched: only the frame they
    // are expressed in changes. With no field the old +Z / XY frame stands, and
    // it does so bit-for-bit — with up = {0,0,1} the stripped vector is exactly
    // (dx, dy, 0), so `len` is the old sqrt(dx*dx + dy*dy) and the spawn point is
    // the old pos.z + 0.9.
    if (particles && out.applied > 0 && ch != DamageChannel::Psi) {
        if (const Transform* tt = get_target_tr()) {
            vec3 up{0.0f, 0.0f, 1.0f};
            if (gravity) {
                const vec3 g = gravity->at(tt->pos);
                const float gLen = length(g);
                if (gLen > 1e-6f) up = g * (-1.0f / gLen);
            }
            vec3 dir = up * 0.45f;
            if (reg.valid(source)) {
                if (const Transform* st = reg.try_get<Transform>(source)) {
                    vec3 away{wrap_delta_f(st->pos.x, tt->pos.x, kWorldExtent),
                              wrap_delta_f(st->pos.y, tt->pos.y, kWorldExtent),
                              wrap_delta_f(st->pos.z, tt->pos.z, kWorldExtent)};
                    away = away - up * dot(away, up);  // drop the vertical part
                    const float len = length(away);
                    if (len > 1e-3f) dir = dir + away * (0.8f / len);
                }
            }
            const int n = 2 + out.applied / 3;
            particles->push(
                tt->pos + up * 0.9f, dir,
                ParticleKind::Blood,
                static_cast<std::uint8_t>(n > 18 ? 18 : n), 0,
                static_cast<std::uint32_t>(entt::to_integral(target)) ^
                    (static_cast<std::uint32_t>(before) << 16) ^
                    static_cast<std::uint32_t>(out.applied));
        }
    }

    if (out.lethal)
        reg.emplace<Dead>(target,
                          Dead{source, static_cast<std::uint8_t>(ch)});
    return out;
}

std::uint32_t finalize_deaths(Registry& reg, NpcPool& pool, EventBus& bus,
                              std::uint64_t tick, NoiseField* noise) {
    // Collect before destroying: mutating while iterating a view invalidates it.
    auto deadView = reg.view<const Dead>();
    std::vector<Entity> doomed;
    doomed.reserve(deadView.size());
    for (auto e : deadView) doomed.push_back(e);

    for (Entity e : doomed) {
        const Dead& d = reg.get<const Dead>(e);

        // A body hitting the floor is audible. Published BEFORE the destroy, for the
        // same reason the NpcDied event is: afterwards there is no Transform to read.
        // The victim is credited as the noise's actor, not the killer — a monster must
        // not skip investigating a corpse just because it did not make it.
        if (noise)
            if (const Transform* tr = reg.try_get<Transform>(e))
                noise_publish(*noise, tr->layer, tr->pos, body_fall_noise(),
                              static_cast<std::uint32_t>(entt::to_integral(e)));

        std::uint32_t victim = kInvalidNpc;
        std::uint32_t kind = 0xFFu;
        // jirnyak §19: snapshot the living 8×8 bag BEFORE pool.kill. kill() only
        // clears the live bit; inventory memory lingers until the slot is reused,
        // but we empty it here so a recycled row cannot resurrect loot. Spill
        // into Corpse / same-cell Containers happens when the Corpse is built.
        Inventory spilledInv{};
        if (const NpcRef* n = reg.try_get<NpcRef>(e)) {
            victim = n->id;
            // A dead record KEEPS its slot ([npcs.md]) — the id stays valid
            // forever, so anything holding it (a quest, a relation) does not
            // dangle. This is the whole reason the pool never reclaims.
            if (pool.valid(n->id)) {
                Inventory& live = pool.inventory(n->id);
                spilledInv = live;
                for (ItemSlot& s : live.slots) {
                    s.item = kInvalidItem;
                    s.count = 0;
                }
                pool.kill(n->id);
            }
        }

        std::uint8_t victimLevel = 1;
        if (const MobRef* m = reg.try_get<MobRef>(e)) {
            kind = m->kind;
            victimLevel = m->level;
        } else if (victim != kInvalidNpc && pool.valid(victim)) {
            victimLevel = pool.level(victim);
        }

        // XP to the killer, and this is the ONE place it is awarded.
        //
        // Here rather than off the NpcDied event for two reasons. The event carries
        // the mob KIND but not the victim's LEVEL, and XP scales with level — a
        // consumer would have to re-derive it after the entity is gone. And a frame
        // can run several sim substeps, each calling finalize_deaths, while the bus
        // is drained once per frame; billing XP from the drain would either
        // double-count or need its own dedup. Crediting at the single death point
        // inherits the property this function already guarantees: one death, once.
        //
        // Only a killer carrying RpgStats is credited, so monster-on-monster and
        // monster-on-civilian kills cost nothing — the component IS the licence.
        if (reg.valid(d.killer) && d.killer != e) {
            if (RpgStats* kr = reg.try_get<RpgStats>(d.killer)) {
                const std::uint32_t gain =
                    kind != 0xFFu
                        ? xp_for_monster_kill(static_cast<MobKind>(kind), victimLevel)
                        : xp_for_npc_kill(victimLevel);
                // The killer's HP lives in its pool row when it has one ([npcs.md]
                // and this file's header note on split storage), so a level-up's
                // max-HP growth is credited there. A killer with no record keeps
                // the level and the point and simply has no HP to raise.
                const NpcRef* kn = reg.try_get<NpcRef>(d.killer);
                if (kn != nullptr && pool.valid(kn->id))
                    award_xp(*kr, gain, &pool.hp(kn->id), &pool.max_hp(kn->id));
                else
                    award_xp(*kr, gain);
            }
        }

        // Published BEFORE the entity goes away, so a listener can still read it.
        // Everything that must react to a death reacts to this, never to noticing
        // an entity has vanished.
        bus.publish(EventType::NpcDied, victim, kind,
                    static_cast<std::uint32_t>(entt::to_integral(d.killer)), tick);

        // Player / camera holder entities are destroyed for body swapping
        if (reg.all_of<CameraTag>(e)) {
            reg.destroy(e);
            continue;
        }

        // Convert NPC/mob entity to a persistent fallen Corpse on the floor
        if (reg.valid(e)) {
            // Blind Dog Pack AI: notify pack table on mob member/leader killed
            if (const MobRef* m = reg.try_get<MobRef>(e)) {
                if (m->pack != 0) {
                    dog_pack_on_member_killed(reg, e, m->pack);
                }
            }

            // Pure NPC deaths carry NpcRef only — MobRef is optional.
            if (reg.all_of<MobRef>(e)) reg.remove<MobRef>(e);
            if (reg.all_of<MobCombat>(e)) reg.remove<MobCombat>(e);
            if (reg.all_of<Velocity>(e)) reg.remove<Velocity>(e);
            reg.remove<Dead>(e);


            if (auto* aabb = reg.try_get<AABB>(e)) {
                const float h = aabb->half.z;
                aabb->half.z = 0.18f;                     // Flatten vertically on ground (Z-up)
                aabb->half.y = std::max(h * 0.75f, 0.55f); // Extend along floor
            }
            if (auto* tr = reg.try_get<Transform>(e)) {
                tr->pos.z -= 0.45f; // Place flush on floor surface (Z-up)
            }
            if (auto* rend = reg.try_get<Renderable>(e)) {
                // Darken & desaturate tint to read as a cold fallen body
                rend->color = vec3{rend->color.x * 0.35f, rend->color.y * 0.35f, rend->color.z * 0.40f};
            }

            // CORP1: move staged loot (CorpseLootPending) into the persistent
            // Corpse. loot_dead_mobs rolls pure data in the Dead window; this is
            // the only place Corpse is born (defect 2). No floor Pickup path.
            Corpse corpse;
            corpse.mobKind = static_cast<std::uint8_t>(kind);
            corpse.deathTick = static_cast<std::uint32_t>(tick);
            if (const CorpseLootPending* pend = reg.try_get<CorpseLootPending>(e)) {
                const std::uint8_t n =
                    pend->slotCount < static_cast<std::uint8_t>(kMaxCorpseSlots)
                        ? pend->slotCount
                        : static_cast<std::uint8_t>(kMaxCorpseSlots);
                for (std::uint8_t i = 0; i < n; ++i)
                    corpse.lootSlots[i] = pend->slots[i];
                corpse.slotCount = n;
                reg.remove<CorpseLootPending>(e);
            }

            // jirnyak §19: dump the snapshotted 8×8 bag into Corpse (8 slots),
            // then same-cell Containers (128³). CORP1 forbids a floor Pickup path
            // for death loot — overflow past corpse+containers is left in the
            // nearest cell container when possible; otherwise dropped only if a
            // container had room. spilledInv was taken before pool.kill.
            {
                const Transform* bodyTr = reg.try_get<const Transform>(e);
                const LayerId bodyLayer = bodyTr ? bodyTr->layer : LayerId{0};
                const vec3 bodyPos = bodyTr ? bodyTr->pos : vec3{0.0f, 0.0f, 0.0f};
                const float cs = static_cast<float>(kCellSize);
                const int bx = wrap_macro(static_cast<int>(std::floor(bodyPos.x / cs)));
                const int by = wrap_macro(static_cast<int>(std::floor(bodyPos.y / cs)));
                const int bz = wrap_macro(static_cast<int>(std::floor(bodyPos.z / cs)));

                auto push_corpse = [&](ItemId id, std::uint16_t count) -> std::uint16_t {
                    if (id == kInvalidItem || count == 0) return 0;
                    if (corpse.slotCount >= static_cast<std::uint8_t>(kMaxCorpseSlots))
                        return count;
                    ItemSlot& ls = corpse.lootSlots[corpse.slotCount++];
                    ls.item = id;
                    ls.count = count;
                    return 0;
                };
                auto push_cell_containers = [&](ItemId id, std::uint16_t count) -> std::uint16_t {
                    if (id == kInvalidItem || count == 0 || !bodyTr) return count;
                    std::uint16_t left = count;
                    for (auto ce : reg.view<Container, const Transform>()) {
                        if (left == 0) break;
                        const Transform& ct = reg.get<const Transform>(ce);
                        if (ct.layer != bodyLayer) continue;
                        const int cx = wrap_macro(static_cast<int>(std::floor(ct.pos.x / cs)));
                        const int cy = wrap_macro(static_cast<int>(std::floor(ct.pos.y / cs)));
                        const int cz = wrap_macro(static_cast<int>(std::floor(ct.pos.z / cs)));
                        if (cx != bx || cy != by || cz != bz) continue;
                        Container& c = reg.get<Container>(ce);
                        const std::uint16_t cap = item_def(id).stackMax ? item_def(id).stackMax : 255u;
                        for (std::uint8_t si = 0; si < kContainerSlots && left > 0; ++si) {
                            if (c.item[si] != id || c.count[si] == 0) continue;
                            if (c.count[si] >= cap) continue;
                            const std::uint16_t room =
                                static_cast<std::uint16_t>(cap - c.count[si]);
                            if (room == 0) continue;
                            const std::uint16_t take = left < room ? left : room;
                            c.count[si] = static_cast<std::uint8_t>(c.count[si] + take);
                            left = static_cast<std::uint16_t>(left - take);
                        }
                        for (std::uint8_t si = 0; si < kContainerSlots && left > 0; ++si) {
                            if (c.item[si] != kInvalidItem && c.count[si] != 0) continue;
                            c.item[si] = id;
                            const std::uint16_t put = left < cap ? left : cap;
                            c.count[si] = static_cast<std::uint8_t>(put);
                            left = static_cast<std::uint16_t>(left - put);
                        }

                    }
                    return left;
                };

                for (const ItemSlot& s : spilledInv.slots) {
                    if (s.item == kInvalidItem || s.count == 0) continue;
                    std::uint16_t left = push_corpse(s.item, s.count);
                    if (left > 0) (void)push_cell_containers(s.item, left);
                }
            }


            reg.emplace<Corpse>(e, corpse);
            // [jirnyak.md] §18: corpses are Interactable::Kind::Corpse so the
            // unified find_nearest_interactable path can see them. Backend loot
            // remains loot_corpse_interact (specialized Corpse view).
            reg.emplace_or_replace<Interactable>(
                e, Interactable{Interactable::Kind::Corpse, 2.2f, true});

        }


    }
    return static_cast<std::uint32_t>(doomed.size());
}



std::uint32_t mob_attack_step(Registry& reg, const MacroGrid& grid,
                             NpcPool& pool, EventBus& bus,
                             LayerId layer, float dt, std::uint64_t tick,
                             ParticleBurstQueue* particles,
                             const GravityField* gravity,
                             const float* fluid,
                             bool samosborFrenzy) {
    // The camera holder, resolved ONCE per pass. It is a single entity that every
    // monster may want, so hoisting it out of the loop is free; crowd prey is
    // per-monster and cannot be hoisted the same way ([hunt.h]).
    Entity player = entt::null;
    vec3 playerPos{0, 0, 0};
    float playerFwdX = 1.0f, playerFwdY = 0.0f;
    bool havePlayer = false;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (const NpcRef* nr = reg.try_get<NpcRef>(e))
            if (!mob_hostile_to(pool, nr->id)) continue;
        player = e;
        playerPos = tr.pos;
        const CameraTag& cam = reg.get<const CameraTag>(e);
        playerFwdX = std::cos(cam.yaw);
        playerFwdY = std::sin(cam.yaw);
        havePlayer = true;
        break;
    }

    std::uint16_t elapsedMs =
        static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);
    if (elapsedMs == 0) elapsedMs = 1;
    if (samosborFrenzy) {
        // Active Samosbor blood frenzy: monsters attack 15% faster
        elapsedMs = static_cast<std::uint16_t>(elapsedMs + (elapsedMs * 15u + 50u) / 100u);
    }

    // Two phases, and the split is a CRASH FIX rather than a style choice.
    //
    // apply_damage can `emplace<Dead>`, and the first time it does, EnTT creates a
    // new component storage — which can reallocate the registry's pool container
    // and dangle the pointers the view being iterated is holding. Damaging a target
    // from inside a view loop therefore segfaults *sometimes*: only when the pool
    // vector happens to be at capacity. Exactly the bug that survives several clean
    // runs and then bites. Observed as a hard crash immediately after the first
    // mob-killed-the-player death.
    //
    // Phase 1 touches only components already in the view (safe) and records
    // intent. Phase 2 applies damage after the view is gone. This is the same
    // discipline finalize_deaths, despawn_layer_mobs, loot_dead_mobs and
    // pickup_step already follow — this was the one place it was missed.
    struct Swing {
        Entity mob;
        // Per-swing now, not one shared victim: a monster may be hunting a resident
        // while its neighbour is hunting the player ([hunt.h]).
        Entity target;
        std::int16_t raw;
        std::uint16_t cd;
        bool ranged;         // launch a projectile instead of touching the victim
        vec3 from;           // launch origin, captured while the view was alive
        vec3 to;             // aim point, captured with it
        std::uint16_t projSpeedMmps;
        std::uint8_t proj;   // ProjType, copied off the row so the launch can read it
    };
    std::vector<Swing> queued;
    queued.reserve(16);

    struct HazardHit {
        Entity mob;
        std::int16_t dmg;
        DamageChannel ch;
    };
    std::vector<HazardHit> hazardHits;
    hazardHits.reserve(8);

    for (auto e : reg.view<const MobRef, const Transform, MobCombat>()) {
        MobCombat& mc = reg.get<MobCombat>(e);

        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const MobRef& mr = reg.get<const MobRef>(e);
        if (static_cast<std::size_t>(mr.kind) >= kMobKindCount) continue;
        const MobDef& def = kMobTable[mr.kind];

        // Environmental hazard check
        if (!has_flag(def.aiFlags, AiFlag::Flying)) {
            const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
            const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
            const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));
            CellType cellType = grid.cell(cx, cy, cz);
            CellStep d{0, 0, -1};
            if (gravity) {
                GravityRegime r = gravity->regime;
                if (r == GravityRegime::Custom) r = regime_from_vector(gravity->at(tr.pos));
                d = regime_down(r);
            }
            CellType floorType = (d.x != 0 || d.y != 0 || d.z != 0)
                ? grid.cell(wrap_macro(cx + d.x), wrap_macro(cy + d.y), wrap_macro(cz + d.z))
                : kCellAir;
            CellHazard hz = get_cell_hazard(cellType);
            if (!hz.active) hz = get_cell_hazard(floorType);
            if (hz.active) {
                const std::uint32_t mobId = static_cast<std::uint32_t>(entt::to_integral(e));
                if ((tick + mobId) % 16 == 0) {
                    hazardHits.push_back(HazardHit{e, hz.damage, hz.channel});
                }
            }
        }

        // THE single cooldown decrement. Every mob, every tick, exactly once —
        // whether or not it is in reach, whether or not there is a target.
        if (mc.cooldownMs > elapsedMs) mc.cooldownMs =
            static_cast<std::uint16_t>(mc.cooldownMs - elapsedMs);
        else mc.cooldownMs = 0;
        // The windup runs down in the SAME one place, for the same reason: two
        // sites decrementing a timer is how a monster ends up firing twice as fast
        // as it is authored to.
        //
        // The transition is captured BEFORE the decrement, and that is load-bearing.
        // A single u16 cannot tell "no telegraph started" from "telegraph just
        // finished" — both read 0 — so without this flag the ranged branch saw zero
        // after the windup expired and started a *fresh* telegraph, forever. The mob
        // would wind up on a loop and never actually fire. Caught by a test, not by
        // playing: an infinite telegraph looks exactly like a monster idling.
        const bool windupDone = mc.windupMs > 0 && mc.windupMs <= elapsedMs;
        if (mc.windupMs > elapsedMs) mc.windupMs =
            static_cast<std::uint16_t>(mc.windupMs - elapsedMs);
        else mc.windupMs = 0;

        if (mc.cooldownMs > 0) continue;

        // A CONTROL shooter is a monster whose whole attack is its projectile's
        // effect, so it has to get past a damage gate that was written as if damage
        // were the only thing an attack could deliver.
        //
        // "PAUPSINA and friends" had no friends: measured on data/mobs.csv, PAUPSINA
        // is the ONLY row of 69 with dmg == 0, and it is exactly the one row carrying
        // proj_type WEB. So this early-out was not filtering harmless monsters — it
        // was the single reason the web-spitter never attacked at all. Its entire
        // ranged kit (11.5-cell range, 3.4-cell dead zone, 0.48 s telegraph,
        // 9.5 cells/s shot) was unreachable code, and the CSV's own role text says
        // what it was for: control, not health.
        const bool control =
            static_cast<ProjType>(def.projType) != ProjType::Bullet &&
            def.shotRangeMm != 0;
        if (def.dmg == 0 && !control) continue;

        // Who this one is swinging at. The camera holder wins whenever it is inside
        // kHuntRadius, so a monster with the player in the room never turns on the
        // locals and the player's side of combat is bit-for-bit what it was. Only a
        // monster holding this epoch's hunting licence looks any further ([hunt.h]).
        //
        // The prey scan runs INSIDE this view's iteration, which is safe for exactly
        // one reason: `nearest_prey` takes a const Registry and reads only components
        // that already exist, so it cannot create a storage and cannot reallocate the
        // pool container the live view is holding. That is the same crash this
        // function's two-phase split exists to prevent — the read-only half of the
        // rule, not an exception to it.
        Entity victim = player;
        vec3 victimPos = playerPos;
        if (mob_hunts_npcs(static_cast<std::uint32_t>(entt::to_integral(e)), tick)) {
            bool playerClose = false;
            if (player != entt::null) {
                const float px = wrap_delta_f(tr.pos.x, playerPos.x, kWorldExtent);
                const float py = wrap_delta_f(tr.pos.y, playerPos.y, kWorldExtent);
                const float pz = wrap_delta_f(tr.pos.z, playerPos.z, kWorldExtent);
                playerClose =
                    px * px + py * py + pz * pz <= kHuntRadius * kHuntRadius;
            }
            if (!playerClose) {
                const Prey pr = nearest_prey(reg, pool, layer, tr.pos, kHuntRadius);
                if (pr.e != entt::null) {
                    victim = pr.e;
                    victimPos = pr.pos;
                }
            }
        }
        if (victim == entt::null) continue;

        // Distances are toroidal.
        const float dx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
        const float dy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
        const float dz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;

        // Damage scales with the mob's level on the same curve as its HP, so a
        // deep-floor elite hits as hard as it is tough.
        //
        // ZERO STAYS ZERO, and that guard is load-bearing rather than defensive.
        // `mob_hp_at_level` clamps its result to a minimum of 1 ([mob_table.cpp]),
        // which is right for HP — a monster spawning with 0 HP is dead on arrival —
        // and wrong for damage, because a kind authored at 0 damage is authored that
        // way ON PURPOSE. PAUPSINA is the one: a web-spitter whose shot is control,
        // not damage. Routed through the HP curve it came out at 1, so the only
        // projectile in the game meant to leave you unharmed was quietly chewing a
        // point of health per hit. Reusing a curve named for one stat on another
        // carries that stat's floor along with it.
        float dmg = def.dmg == 0
                        ? 0.0f
                        : static_cast<float>(mob_hp_at_level(def.dmg, mr.level));

        const auto beh = static_cast<MobBehaviour>(def.behaviour);
        const bool nearWall = wall_query_needed(def.aiFlags, beh)
                                  ? adjacent_wall(grid, tr.pos)
                                  : false;
        if (behaviour_claims_damage(beh)) {
            dmg *= behaviour_damage_mult(beh, nearWall);
        } else if (has_flag(def.aiFlags, AiFlag::WallBias)) {
            dmg *= wall_bias_damage(def.aiFlags, nearWall);
        }

        if (victim == player && havePlayer) {
            const float pdx = wrap_delta_f(playerPos.x, tr.pos.x, kWorldExtent);
            const float pdy = wrap_delta_f(playerPos.y, tr.pos.y, kWorldExtent);
            dmg *= facing_damage_mult(beh, playerFwdX, playerFwdY, pdx, pdy);
        }

        const float dist = std::sqrt(d2);
        const BurstPhase bp = burst_phase(
            beh, static_cast<std::uint32_t>(entt::to_integral(e)), tick, dist);
        dmg *= burst_damage_mult(bp);

        // Terrain-keyed damage multiplier (e.g. Polzun wet ambush bonus)
        if (fluid) {
            const bool wet = pos_wet(fluid, tr.pos);
            dmg *= trait_damage_mult(mr.kind, wet);
        }

        // Bloodsucker decloak and backstab strike evaluation:
        if (BloodsuckerAi* bs = reg.try_get<BloodsuckerAi>(e)) {
            dmg *= bloodsucker_evaluate_strike(*bs, tr.pos, victimPos, playerFwdX, playerFwdY, particles);
        }

        const std::int16_t raw = (dmg > 0.0f && dmg < 1.0f)
                                     ? static_cast<std::int16_t>(1)
                                     : static_cast<std::int16_t>(dmg);

        const float reach = behaviour_melee_reach(beh, def.meleeReachMm, nearWall);
        if (raw > 0 && d2 <= reach * reach) {
            mc.windupMs = 0;   // contact cancels a shot it was lining up
            queued.push_back(Swing{e, victim, raw, def.attackCdMs, false, tr.pos,
                                   victimPos, 0, def.projType});
            continue;
        }

        if (def.shotRangeMm == 0) continue;
        const float maxR = static_cast<float>(def.shotRangeMm) * 0.001f * kCellSize;
        const float minR = static_cast<float>(def.minRangeMm) * 0.001f * kCellSize;
        if (d2 > maxR * maxR || d2 < minR * minR) {
            mc.windupMs = 0;
            continue;
        }

        if (!los_clear(grid, tr.pos, victimPos)) {
            mc.windupMs = 0;
            continue;
        }

        if (mc.windupMs > 0) continue;              // mid-telegraph
        if (!windupDone && def.windupMs > 0) {      // start one
            mc.windupMs = def.windupMs;
            continue;
        }

        queued.push_back(Swing{e, victim, raw, def.attackCdMs, true, tr.pos,
                               victimPos, def.projSpeedMmps, def.projType});
    }

    std::uint32_t swings = 0;
    for (const Swing& s : queued) {
        if (s.ranged) {
            spawn_projectile(reg, layer, s.from, s.to, s.raw,
                             s.projSpeedMmps, s.mob, s.proj, gravity);
            ++swings;
            if (MobCombat* mc = reg.try_get<MobCombat>(s.mob))
                mc->cooldownMs = s.cd;
            continue;   // a shot in flight is not a hit yet
        }
        DamageResult r = apply_damage(reg, pool, s.target, s.raw,
                                      DamageChannel::Kinetic, s.mob, &grid,
                                      particles, gravity, fluid);
        if (r.hit) {
            ++swings;
            if (MobCombat* mc = reg.try_get<MobCombat>(s.mob))
                mc->cooldownMs = s.cd;
        }
    }

    for (const auto& hit : hazardHits) {
        apply_damage(reg, pool, hit.mob, hit.dmg, hit.ch, entt::null, &grid,
                     particles, gravity, fluid);
    }

    (void)bus;
    return swings;
}

std::uint32_t hazard_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                          LayerId layer, std::uint64_t tick,
                          ParticleBurstQueue* particles,
                          const GravityField* gravity) {
    struct Hit {
        Entity body;
        std::int16_t dmg;
        DamageChannel ch;
    };
    // Empty in the overwhelming common case (hazard cells are sparse), and an
    // empty std::vector does not allocate — so this costs nothing on a tick where
    // nobody is standing in fire.
    std::vector<Hit> hits;
    hits.reserve(8);

    for (auto e : reg.view<const NpcRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;

        // The body's own cell, then the cell it stands ON — the same two probes
        // the monster path makes, so a pool of acid burns whether you are in it
        // or on its surface.
        const int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
        const int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
        const int cz = wrap_macro(static_cast<int>(tr.pos.z / kCellSize));
        CellHazard hz = get_cell_hazard(grid.cell(cx, cy, cz));
        if (!hz.active) {
            // "The cell it stands ON" is one step along GRAVITY, not one step
            // down -Z. `regime_down` already spells that step for the six axis
            // regimes; Custom is resolved to its nearest axis the same way
            // gravity_frames does it, and Zero returns {0,0,0} — correctly, since
            // a body in free fall stands on nothing and the probe is skipped.
            //
            // Under the shipping NegZ this is {0,0,-1} and therefore identical to
            // the old `cz - 1`. It mattered everywhere else: under PosZ the probe
            // read the CEILING, and under any lateral regime an unrelated WALL —
            // so the acid you were standing in stopped burning while a wall you
            // merely passed started to.
            CellStep d{0, 0, -1};
            if (gravity) {
                GravityRegime r = gravity->regime;
                if (r == GravityRegime::Custom)
                    r = regime_from_vector(gravity->at(tr.pos));
                d = regime_down(r);
            }
            if (d.x != 0 || d.y != 0 || d.z != 0)
                hz = get_cell_hazard(grid.cell(wrap_macro(cx + d.x),
                                               wrap_macro(cy + d.y),
                                               wrap_macro(cz + d.z)));
        }
        if (!hz.active) continue;

        // Identity stagger on the entity, matching the monster path exactly.
        const std::uint64_t id = static_cast<std::uint64_t>(entt::to_integral(e));
        if ((tick + id) % 16 != 0) continue;
        hits.push_back(Hit{e, hz.damage, hz.channel});
    }

    for (const Hit& h : hits)
        apply_damage(reg, pool, h.body, h.dmg, h.ch, entt::null, &grid, particles,
                     gravity);

    return static_cast<std::uint32_t>(hits.size());
}

int equipped_melee_slot(const Inventory& inv, const Equipped* eq) {
    if (eq && eq->weapon < kInvSlots) {
        const ItemSlot& s = inv.slots[eq->weapon];
        if (s.item != kInvalidItem && s.count > 0 && melee_for_item(s.item)) {
            return eq->weapon;
        }
    }
    int bestIdx = -1;
    std::uint16_t bestDmg = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == kInvalidItem || s.count == 0) continue;
        const MeleeDef* m = melee_for_item(s.item);
        if (!m) continue;
        if (m->dmg > bestDmg) { bestDmg = m->dmg; bestIdx = i; }
    }
    return bestIdx;
}

ItemId equipped_melee(const Inventory& inv, const Equipped* eq) {
    const int idx = equipped_melee_slot(inv, eq);
    if (idx >= 0 && idx < kInvSlots) return inv.slots[idx].item;
    return kInvalidItem;
}

int equipped_armour_slot(const Inventory& inv, const Equipped* eq) {
    if (eq && eq->armor < kInvSlots) {
        const ItemSlot& s = inv.slots[eq->armor];
        if (s.item != kInvalidItem && s.count > 0 && item_valid(s.item)) {
            const ItemDef& d = item_def(s.item);
            if (d.equipSlot == static_cast<std::uint8_t>(EquipSlot::Armor)) {
                return eq->armor;
            }
        }
    }
    int bestIdx = -1;
    int bestSum = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item)) continue;
        const ItemDef& d = item_def(s.item);
        if (d.equipSlot != static_cast<std::uint8_t>(EquipSlot::Armor)) continue;
        int sum = 0;
        for (std::size_t c = 0; c < kItemResistChannels; ++c) sum += d.resist[c];
        if (sum > bestSum) { bestSum = sum; bestIdx = i; }
    }
    return bestIdx;
}

ItemId equipped_armour(const Inventory& inv, const Equipped* eq) {
    const int idx = equipped_armour_slot(inv, eq);
    if (idx >= 0 && idx < kInvSlots) return inv.slots[idx].item;
    return kInvalidItem;
}

void sync_armour(Registry& reg, NpcPool& pool, Entity e) {
    if (!reg.valid(e)) return;
    const NpcRef* n = reg.try_get<NpcRef>(e);
    if (!n || !pool.valid(n->id)) return;

    const Equipped* eq = reg.try_get<Equipped>(e);
    const Inventory& inv = pool.inventory(n->id);
    const int slotIdx = equipped_armour_slot(inv, eq);
    if (slotIdx < 0 || slotIdx >= kInvSlots) {
        if (reg.all_of<Armour>(e)) reg.remove<Armour>(e);
        return;
    }

    const ItemSlot& sl = inv.slots[slotIdx];
    if (sl.item == kInvalidItem || sl.count == 0 || sl.condition == 0) {
        if (reg.all_of<Armour>(e)) reg.remove<Armour>(e);
        return;
    }

    const ItemDef& d = item_def(sl.item);
    Armour a{};
    const float condScale = 0.20f + 0.80f * (static_cast<float>(sl.condition) / 255.0f);
    for (std::size_t c = 0; c < kDamageChannels; ++c) {
        int scaledResist = static_cast<int>(static_cast<float>(d.resist[c]) * condScale + 0.5f);
        if (scaledResist > 95) scaledResist = 95;
        if (scaledResist < -100) scaledResist = -100;
        a.resist[c] = static_cast<std::int8_t>(scaledResist);
    }
    reg.emplace_or_replace<Armour>(e, a);
}

// Launch a shot from `from` toward `to`.
//
// Aimed with a gravity-compensated lob, which is the most important asymmetry in
// the whole model: fired level from chest height a projectile reaches the floor in
// well under a second, so a flat shot is short whatever its muzzle speed. Distance
// has to be bought with arc. The vertical rate below is the one that lands the shot
// at the target's height after dist/speed seconds.
void spawn_projectile(Registry& reg, LayerId layer, const vec3& from,
                      const vec3& to, std::int16_t dmg,
                      std::uint16_t projSpeedMmps, Entity source,
                      std::uint8_t projType, const GravityField* gravity) {
    // Table speed is cells/s in fixed point; a cell is kCellSize metres.
    float speed = static_cast<float>(projSpeedMmps) * 0.001f * kCellSize;
    if (speed < 1.0f) speed = 12.0f;   // a ranged kind with no authored speed

    // THE LOB IS SOLVED IN THE LAYER'S OWN FRAME, not in Z.
    //
    // The ballistic problem is one vector equation. Under a constant acceleration
    // `a`, a shot launched at `v0` is at `r0 + v0*T + 0.5*a*T^2`, so the launch that
    // arrives at the target after T is
    //
    //     v0 = Δ/T − 0.5*a*T
    //
    // and there is no axis in it. What stood here was exactly that solution written
    // out in a basis where `a = (0, 0, −kProjGravity)`: the two "horizontal"
    // components got Δ/T (no acceleration along them) and the "vertical" one got
    // Δz/T + 0.5*g*T. Correct — and only while `a` really is along −Z.
    //
    // Under any other GravityRegime it puts the WHOLE compensation on an axis with
    // no acceleration and none on the axis that has it, so the miss is of order
    // 0.5*g*T² — a quarter of a metre at 12 m, one and a half at 30, and wrong along
    // two axes at once. `projectile_step` has integrated along the real gravity
    // vector since 2026-08-12; only the launch was still aiming at −Z, so the shot
    // FLEW honestly and was AIMED in the wrong frame. Discipline applied unevenly
    // inside one file is the sign of a law kept by hand rather than by a gate.
    //
    // Latent, not live, and worth saying plainly: `kPadicGravity` is NegZ and padic
    // is the only geometric module, so no shipping floor exercises this today. It is
    // fixed because "x/y/z are equal citizens" is a law about what the engine may be
    // asked to do, not about what one floor happens to ask.
    //
    // `up` is the local vertical; with no field it is +Z and every line below is
    // bit-for-bit what it replaced (dot with (0,0,1) IS dz, and Δ − up*dz IS
    // (dx, dy, 0) exactly).
    vec3 up{0.0f, 0.0f, 1.0f};
    float gMag = kProjGravity;
    if (gravity) {
        const vec3 g = gravity->at(from);
        const float gLen = length(g);
        if (gLen > 1e-6f) {
            up = g * (-1.0f / gLen);
        } else {
            gMag = 0.0f;
        }
    }

    const vec3 delta{wrap_delta_f(from.x, to.x, kWorldExtent),
                     wrap_delta_f(from.y, to.y, kWorldExtent),
                     wrap_delta_f(from.z, to.z, kWorldExtent)};
    // Δ split into the part along the local vertical and the part perpendicular to
    // it — the projection that `dz` and `sqrt(dx*dx + dy*dy)` were hardcoding.
    const float dUp = dot(delta, up);
    const vec3 across = delta - up * dUp;
    const float flat = length(across);

    const vec3 fwd = (flat >= 1e-3f) ? across * (1.0f / flat)
                                     : (dUp >= 0.0f ? up : up * -1.0f);
    const float travel = (flat >= 1e-3f) ? (flat - kMuzzleForward)
                                         : (std::abs(dUp) - kMuzzleForward);
    // Point-blank: the target is already inside the barrel length. Floor the distance
    // rather than refusing the shot — a monster with its face against you must still
    // be able to fire, and the arc over 0.1 m is nil anyway.
    const float tof = (travel > 0.1f ? travel : 0.1f) / speed;
    // The compensation, now on the axis that actually has the acceleration.
    const float vUp = dUp / tof + 0.5f * gMag * tof;

    Entity e = reg.create();
    Transform tr;
    // Through `muzzle_point` like every other spawner, and it changes NOTHING here —
    // this path offsets by the full kMuzzleForward in the FLAT plane whatever the
    // pitch, so its clearance is sqrt(1.7^2 + 0.6^2) = 1.80 m with no stature term to
    // go wrong. Routed through anyway so there is exactly one function in the tree
    // that answers "where is the barrel", instead of one that answers it and one that
    // happens to agree.
    // `up * 0.6` and not `+0.6 z`: chest height is measured against the floor the
    // body is standing on, and which way that is comes from the field.
    tr.pos = muzzle_point(from + up * 0.6f, fwd, from);
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    // v0 = fwd*speed + up*vUp — the same two terms as before (`(ux,uy,0)*speed` and
    // `vz` on Z), now expressed in the frame the layer actually has.
    reg.emplace<Velocity>(e, Velocity{fwd * speed + up * vUp});
    reg.emplace<AABB>(e, AABB{vec3{0.10f, 0.10f, 0.10f}});
    // projectile_step owns this entity's motion; keep physics_step off it.
    reg.emplace<SelfIntegrating>(e);
    // Hot white-yellow for a bullet; a web is a pale grey-green so the one shot in
    // the game that does not hurt you does not look like the ones that do. The render
    // layer is a pure skin ([AGENTS.md]) so this changes pixels and nothing else —
    // but a control projectile that is visually indistinguishable from a lethal one
    // teaches the player the wrong thing about what just hit them.
    const bool web = static_cast<ProjType>(projType) == ProjType::Web;
    reg.emplace<Renderable>(e, Renderable{web ? vec3{0.72f, 0.86f, 0.74f}
                                              : vec3{1.00f, 0.95f, 0.70f}});
    // gravityPct 100: a monster's lob is fully gravity-compensated. Nothing here
    // records whose shot it is beyond `source`, which is attribution only.
    reg.emplace<Projectile>(
        e, Projectile{source, dmg, kProjTtlMs, 100, projType});
}

void spawn_projectile_dir(Registry& reg, LayerId layer, const vec3& from,
                          const vec3& dir, std::int16_t dmg,
                          std::uint16_t projSpeedMmps, Entity source,
                          std::uint8_t gravityPct, std::uint8_t channel) {
    float speed = static_cast<float>(projSpeedMmps) * 0.001f * kCellSize;
    if (speed < 1.0f) speed = 12.0f;
    const float len = std::sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len < 1e-4f) return;
    const float inv = 1.0f / len;

    Entity e = reg.create();
    Transform tr;
    // Born in front of the EYE, but cleared against the BODY — the two are not the
    // same point, and the gap between them is what `p.source != victim` used to
    // paper over. `muzzle_point` pushes past kMuzzleForward only when the ray still
    // ends inside the shooter's hit sphere, which is the straight-down shot from a
    // tall body and nothing else. A source with no Transform (a test, a console
    // shot) has no body to be inside, so the plain offset stands.
    const vec3 u{dir.x * inv, dir.y * inv, dir.z * inv};
    const Transform* stf = reg.valid(source) ? reg.try_get<Transform>(source)
                                             : nullptr;
    tr.pos = stf ? muzzle_point(from, u, stf->pos)
                 : vec3{from.x + u.x * kMuzzleForward,
                        from.y + u.y * kMuzzleForward,
                        from.z + u.z * kMuzzleForward};
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e, Velocity{vec3{dir.x * inv * speed,
                                           dir.y * inv * speed,
                                           dir.z * inv * speed}});
    reg.emplace<AABB>(e, AABB{vec3{0.10f, 0.10f, 0.10f}});
    // projectile_step owns this entity's motion; keep physics_step off it.
    reg.emplace<SelfIntegrating>(e);
    reg.emplace<Renderable>(e, Renderable{vec3{1.00f, 0.95f, 0.70f}});
    // ProjType::Bullet, and passed rather than defaulted: no ranged WEAPON in
    // data/weapons_ranged.csv fires anything but a bullet, and spelling it means the
    // day one does, the compiler asks about this call site instead of silently
    // handing the player a bullet.
    reg.emplace<Projectile>(
        e, Projectile{source, dmg, kProjTtlMs, gravityPct,
                      static_cast<std::uint8_t>(ProjType::Bullet), channel});
}

void spawn_grenade(Registry& reg, LayerId layer, const vec3& from,
                   const vec3& dir, std::int16_t dmg,
                   std::uint16_t projSpeedMmps, Entity source,
                   std::uint8_t blastDm, std::uint16_t fuseMs,
                   std::uint8_t channel) {
    float speed = static_cast<float>(projSpeedMmps) * 0.001f * kCellSize;
    if (speed < 1.0f) speed = 12.0f;
    const float len = std::sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len < 1e-4f) return;
    const float inv = 1.0f / len;

    Entity e = reg.create();
    Transform tr;
    // The same `muzzle_point` as every other spawner. A grenade could get away with
    // less — it does no contact damage, so being born inside the thrower costs
    // nothing — but "where the barrel is" having one answer is worth more than the
    // two lines saved, and the day a thrown weapon does something on contact this
    // will already be right.
    const vec3 u{dir.x * inv, dir.y * inv, dir.z * inv};
    const Transform* stf = reg.valid(source) ? reg.try_get<Transform>(source)
                                             : nullptr;
    tr.pos = stf ? muzzle_point(from, u, stf->pos)
                 : vec3{from.x + u.x * kMuzzleForward,
                        from.y + u.y * kMuzzleForward,
                        from.z + u.z * kMuzzleForward};
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e, Velocity{vec3{dir.x * inv * speed,
                                           dir.y * inv * speed,
                                           dir.z * inv * speed}});
    reg.emplace<AABB>(e, AABB{vec3{0.10f, 0.10f, 0.10f}});
    reg.emplace<SelfIntegrating>(e);
    // Olive-drab, and darker than either tracer: the one projectile you are supposed
    // to be able to spot lying on the floor and run away from.
    reg.emplace<Renderable>(e, Renderable{vec3{0.42f, 0.50f, 0.28f}});
    // gravityPct 100 — a thrown weight obeys gravity in full. The 40% flattening
    // exists so a camera-aimed BULLET is not handed a lob it did not aim
    // ([combat.h] Projectile::gravityPct); an arc is the whole point of a throw.
    reg.emplace<Projectile>(
        e, Projectile{source, dmg, fuseMs, 100,
                      static_cast<std::uint8_t>(ProjType::Grenade), channel,
                      blastDm});
}

// **Never call this from inside a live view.** The first web in a session runs
// `reg.emplace<Slowed>`, which creates a component storage and can reallocate the
// registry's pool container — dangling any view still being iterated. That is the
// documented crash `mob_attack_step` was split in two to avoid, and it is why the
// one caller (`projectile_step`) applies it in its resolution phase, over a
// std::vector, after every view is closed.
bool apply_slow(Registry& reg, Entity target, float scale, std::uint16_t ms) {
    if (!reg.valid(target) || ms == 0) return false;
    if (scale < 0.0f) scale = 0.0f;
    if (scale >= 1.0f) return false;   // not a slow

    // The cap comes from the victim's own top speed, resolved once here. See the
    // header for why a resident (neither component) is refused instead of guessed.
    float base = 0.0f;
    if (const MobRef* m = reg.try_get<MobRef>(target)) {
        if (static_cast<std::size_t>(m->kind) < kMobKindCount) {
            base = static_cast<float>(kMobTable[m->kind].speedMmps) * 0.001f * kCellSize;
        }
    } else if (const Controller* c = reg.try_get<Controller>(target)) {
        base = c->moveSpeed;
    }
    if (base <= 0.0f) return false;    // immobile, or nothing to slow

    const float cap = base * scale;
    if (Slowed* s = reg.try_get<Slowed>(target)) {
        // Refresh, never compound: the stronger cap and the longer remainder. An
        // expired-but-still-attached component (ttlMs == 0, see slow_step) has no
        // claim on either, so it is overwritten outright.
        if (s->ttlMs == 0) {
            s->maxSpeed = cap;
            s->ttlMs = ms;
        } else {
            if (cap < s->maxSpeed) s->maxSpeed = cap;
            if (ms > s->ttlMs) s->ttlMs = ms;
        }
        return true;
    }
    reg.emplace<Slowed>(target, Slowed{cap, ms});
    return true;
}

float slow_scale(const Registry& reg, Entity e) {
    if (!reg.valid(e)) return 1.0f;
    const Slowed* s = reg.try_get<Slowed>(e);
    if (!s || s->ttlMs == 0 || s->maxSpeed <= 0.0f) return 1.0f;
    // Reported against the same authority the cap was derived from, so the number the
    // HUD prints is the fraction of the body's OWN speed and not of some global.
    float base = 0.0f;
    if (const MobRef* m = reg.try_get<MobRef>(e)) {
        if (static_cast<std::size_t>(m->kind) < kMobKindCount) {
            base = static_cast<float>(kMobTable[m->kind].speedMmps) * 0.001f * kCellSize;
        }
    }
    else if (const Controller* c = reg.try_get<Controller>(e))
        base = c->moveSpeed;
    if (base <= 0.0f) return 1.0f;
    const float f = s->maxSpeed / base;
    return f < 1.0f ? f : 1.0f;
}

std::uint32_t slow_step(Registry& reg, LayerId layer, float dt) {
    const std::uint16_t elapsedMs =
        static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);

    std::uint32_t live = 0;
    for (auto e : reg.view<Slowed, Transform, Velocity>()) {
        Slowed& s = reg.get<Slowed>(e);
        if (s.ttlMs == 0) continue;   // expired and inert ([combat.h] Slowed)

        // THE single decrement, at the top and BEFORE the layer test — the same rule
        // and the same reason as the mob cooldown above: a timer that only runs on the
        // live layer is a timer that stops when you leave the room. Two seconds of web
        // has to be two seconds of wall clock.
        if (s.ttlMs > elapsedMs) s.ttlMs =
            static_cast<std::uint16_t>(s.ttlMs - elapsedMs);
        else s.ttlMs = 0;
        if (s.ttlMs == 0) continue;   // last tick of the effect; let it go

        if (reg.get<Transform>(e).layer != layer) continue;
        ++live;

        // Clamp, do not scale. Idempotent, so a crowd body whose velocity is only
        // rewritten every kWanderPeriod ticks is not multiplied down to zero in
        // between ([combat.h] Slowed).
        Velocity& v = reg.get<Velocity>(e);
        const float sp2 = v.v.x * v.v.x + v.v.y * v.v.y;
        if (sp2 <= s.maxSpeed * s.maxSpeed) continue;
        const float k = s.maxSpeed / std::sqrt(sp2);
        v.v.x *= k;
        v.v.y *= k;
        // z untouched: a slow is not reduced gravity.
    }
    return live;
}

std::uint32_t projectile_step(Registry& reg, NpcPool& pool, EventBus& bus,
                              LevelStack& stack, LayerId layer, float dt,
                              std::uint64_t tick, StatusSet* playerStatus,
                              Entity playerEntity,
                              CarveProposalQueue* carves,
                              std::vector<std::uint32_t>* stainDirty,
                              ParticleBurstQueue* particles,
                              NoiseField* noise) {
    if (!stack.valid(layer)) return 0;
    const MacroGrid& grid = stack.layer(layer).grid();

    Entity victim = entt::null;
    vec3 victimPos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        victim = e;
        victimPos = t.pos;
        break;
    }

    const std::uint16_t elapsedMs =
        static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);

    // Same two-phase discipline as the attack step, for the same reason:
    // apply_damage can create the Dead pool and dangle a live view.
    struct Hit {
        Entity proj;
        std::int16_t dmg;
        Entity source;
        bool onVictim;
        // Set instead of onVictim when the shot struck a specific body that is not
        // the camera holder: a monster for a player shot, a resident for a monster
        // shot. One field rather than two, because phase 2 does the same thing with
        // either — apply_damage does not care what it is pointed at.
        Entity other = entt::null;
        // ProjType, carried through phase 2 because that is where the effect lands.
        // Read off the Projectile in phase 1 rather than looked up again later: the
        // entity is destroyed at the end of the resolution loop. Named `projType`
        // and not `proj` because `proj` above is the projectile ENTITY.
        std::uint8_t projType = 0;
        // DamageChannel, carried for exactly the reason projType above is: phase 2 is
        // where apply_damage runs, and the Projectile entity is destroyed at the end
        // of the resolution loop, so the channel has to be read off it in phase 1.
        std::uint8_t channel = static_cast<std::uint8_t>(DamageChannel::Kinetic);
        // Wall impact: solid geometry stopped the shot. impactPos is the contact
        // point (projectile position at the stop). onWall is mutually exclusive
        // with onVictim/other — a body hit never also carves the wall behind it.
        bool onWall = false;
        vec3 impactPos{0, 0, 0};
        // The fuse ran out on a grenade. Mutually exclusive with all three of the
        // above: a detonation strikes nothing in particular, it strikes a PLACE
        // (impactPos) and everything standing in it. Blast radius in decimetres,
        // carried off the Projectile in phase 1 for the same reason projType and
        // channel are — the entity is destroyed at the end of the resolution loop.
        bool onDetonate = false;
        std::uint8_t blastDm = 0;
    };
    std::vector<Hit> resolved;
    resolved.reserve(32);

    for (auto e : reg.view<Projectile, Transform, Velocity>()) {
        Transform& tr = reg.get<Transform>(e);
        if (tr.layer != layer) continue;
        Projectile& p = reg.get<Projectile>(e);
        Velocity& v = reg.get<Velocity>(e);

        if (p.ttlMs > elapsedMs)
            p.ttlMs = static_cast<std::uint16_t>(p.ttlMs - elapsedMs);
        else
            p.ttlMs = 0;

        // Per-projectile gravity. A monster's lob is compensated for full gravity;
        // a camera-aimed player shot cannot be, so it flies flatter instead. One
        // integrator, two trajectories. [combat.h Projectile::gravityPct]
        //
        // The pull follows the layer's gravity VECTOR, never -Z ([AGENTS.md]:
        // read it via world.gravity().at(pos)). kProjGravity stays the ballistic
        // tuning knob it always was — it is a MAGNITUDE (m/s^2), so it scales the
        // unit gravity direction rather than being bolted onto one axis. This is
        // the game's only projectile integrator: shots carry SelfIntegrating, so
        // physics_step never touches them and there is no second chance to be right.
        const vec3 projG = stack.layer(layer).gravity().at(tr.pos);
        const float projGLen = length(projG);
        if (projGLen > 1e-6f) {
            const float mag =
                kProjGravity * (static_cast<float>(p.gravityPct) * 0.01f) * dt;
            v.v = v.v + projG * (mag / projGLen);
        }
        // A GRENADE SKIPS ACROSS THE VOXELS INSTEAD OF ENDING ON THEM. Everything
        // above this line is shared — one integrator, one gravity vector — and
        // everything below it differs, because contact means the opposite thing for
        // the two: a bullet is spent by the first solid it meets, a grenade is
        // redirected by it. [ARCHITECTURE.md] §Манифест п.5.
        const bool grenade = static_cast<ProjType>(p.proj) == ProjType::Grenade;
        if (grenade) {
            grenade_advance(grid, tr.pos, v.v, dt);
        } else {
            tr.pos.x = wrapf(tr.pos.x + v.v.x * dt, kWorldExtent);
            tr.pos.y = wrapf(tr.pos.y + v.v.y * dt, kWorldExtent);
            tr.pos.z = wrapf(tr.pos.z + v.v.z * dt, kWorldExtent);
        }

        if (p.ttlMs == 0) {
            // THE SAME ZERO, TWO MEANINGS. For a bullet the TTL is a backstop and
            // reaching it means the shot is spent — dmg 0, nothing happens, the
            // entity goes away. For a grenade it is the FUSE, and reaching it is the
            // entire point of the object.
            Hit h{e, grenade ? p.dmg : static_cast<std::int16_t>(0), p.source, false};
            if (grenade) {
                h.onDetonate = true;
                h.impactPos = tr.pos;
                h.projType = p.proj;
                h.channel = p.channel;
                h.blastDm = p.blastDm;
            }
            resolved.push_back(h);
            continue;
        }

        // A live grenade touches nothing else. Not the body it flies past — a
        // shoulder is not a wall and must not stop it — and not the wall it just
        // bounced off, which the block above already resolved. Its whole interaction
        // with the world for the next three seconds is geometry, and geometry is
        // handled. The fuse is the only thing that can end it.
        if (grenade) continue;

        // The camera holder, tested like anything else — INCLUDING against his own
        // bullet, since 2026-08-13.
        //
        // This branch used to read `if (victim != entt::null && p.source != victim)`,
        // and that was the last owner test in the tree: §33 deleted `Projectile::team`
        // and left one exclusion standing, wearing a geometry argument. The argument
        // was that a shot fired straight down passes through the shooter on its way to
        // the floor — and it does not, but only by 4 mm at the tallest legal stature,
        // and only because of a clamp in population.cpp that nothing here referenced.
        // `muzzle_point` above turns that coincidence into a solved ray/sphere exit,
        // so the rule has nothing left to pay for and is gone.
        //
        // What that buys is not tidiness. A shot is now hittable by its own shooter
        // whenever it is genuinely in his space — a ricochet off a wall he is standing
        // against, a pellet from a barrel pressed into a corner. Under the old test
        // those cases were silently impossible for the camera holder and possible for
        // everyone else, which is an asymmetry in the player's favour and exactly what
        // "the player is not special" ([AGENTS.md]) forbids.
        if (victim != entt::null) {
            const float hx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
            const float hy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
            const float hz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
            if (hx * hx + hy * hy + hz * hz <= kProjHitRadius * kProjHitRadius) {
                resolved.push_back(
                    Hit{e, p.dmg, p.source, true, entt::null, p.proj, p.channel});
                continue;
            }
        }

        // EVERYTHING ELSE IN THE AIR, with no memory of who fired it.
        //
        // This used to be two branches gated on `Projectile::team`: monsters were hit
        // only by player shots, the crowd only by monster shots, and the crowd branch
        // additionally spared anyone `mob_hostile_to` said was not prey. Three
        // exclusions, all of them the thing ARCHITECTURE.md §Манифест п.5 forbids by
        // name — "никаких friendly-fire-исключений; граната скачет по вокселям,
        // осколки бьют и владельца".
        //
        // Owner's ruling, 2026-08-12: **ownership itself is the hardcode.** A shot,
        // once fired, is a physical object that remembers nothing. It does not know
        // who pulled the trigger, what team they were on, or which faction is
        // standing in front of it. It hits what it reaches.
        //
        // So this is ONE sweep over everything a projectile can touch, and it takes
        // the NEAREST — not the first the view happens to yield. With separate
        // branches "first found" was already arbitrary; merged, arbitrary would mean
        // a monster shielding a civilian only when EnTT ordered it that way.
        //
        // `p.source` survives as ATTRIBUTION and nothing else: `finalize_deaths`
        // needs to know whose kill it was to award XP. Attribution is not exclusion —
        // a body can be credited with a death it caused to itself, and now is.
        {
            Entity best = entt::null;
            float bestD2 = kProjHitRadius * kProjHitRadius;
            auto consider = [&](Entity cand, const vec3& cp) {
                const float hx = wrap_delta_f(tr.pos.x, cp.x, kWorldExtent);
                const float hy = wrap_delta_f(tr.pos.y, cp.y, kWorldExtent);
                const float hz = wrap_delta_f(tr.pos.z, cp.z, kWorldExtent);
                const float d2 = hx * hx + hy * hy + hz * hz;
                if (d2 <= bestD2) {
                    bestD2 = d2;
                    best = cand;
                }
            };
            for (auto m : reg.view<const MobRef, const Transform>()) {
                const Transform& mt = reg.get<const Transform>(m);
                if (mt.layer != layer) continue;
                consider(m, mt.pos);
            }
            for (auto b : reg.view<const NpcRef, const Transform>()) {
                if (b == victim) continue;   // already tested above, at priority
                const Transform& bt = reg.get<const Transform>(b);
                if (bt.layer != layer) continue;
                consider(b, bt.pos);
            }
            if (best != entt::null) {
                resolved.push_back(Hit{e, p.dmg, p.source, false, best, p.proj,
                                       p.channel});
                continue;
            }
        }

        // Solid geometry stops it. Cell-level rather than sub-voxel on purpose: a
        // shot clipping the corner of a wall should stop, and the sub-voxel mask
        // would let it slip through a half-carved cell that reads as solid.
        // Carry p.dmg so phase 2 can propose a wall chip (carve_power_from_dmg);
        // body damage is still skipped via onWall (no onVictim/other).
        const int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
        const int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
        const int cz = static_cast<int>(tr.pos.z / kCellSize);
        if (cz < 0 || cz >= kMacroDim ||
            grid.cell(cx, cy, wrap_macro(cz)) != kCellAir) {
            Hit h{e, p.dmg, p.source, false};
            h.onWall = true;
            h.impactPos = tr.pos;
            h.projType = p.proj;
            h.channel = p.channel;
            resolved.push_back(h);
        }
    }


    std::uint32_t hits = 0;
    for (const Hit& h : resolved) {
        // What a WEB shot delivers, and the ONLY reader of `MobDef::projType` in the
        // tree. A web carries dmg 0 (its one authored row is the only zero-damage row
        // in data/mobs.csv), so `apply_damage` would refuse it and the shot would
        // land as nothing at all — the slow IS the hit, and it is counted as one so
        // the HUD's hit tally does not report a web-spitter as permanently missing.
        //
        // Applied before apply_damage rather than after, because apply_damage may tag
        // `Dead`, and slowing a corpse is a wasted 8 bytes on an entity that is about
        // to be destroyed. A web cannot itself be lethal, so ordering costs nothing.
        //
        // `landed` and not `++hits` in two places: a shot must count once whatever it
        // delivered, or a future WEB row with nonzero damage would report two hits for
        // one projectile and quietly inflate the tally the HUD prints.
        bool landed = false;
        const bool web = static_cast<ProjType>(h.projType) == ProjType::Web;
        const Entity body = h.onVictim ? victim : h.other;
        if (web && body != entt::null && reg.valid(body)) {
            landed = apply_slow(reg, body, kWebSlowScale, kWebSlowMs);
            // Content layer: Slowed is the velocity CAP; PaupsinaWeb is the
            // authored row (root window + move 540/220). Both coexist.
            if (landed && playerStatus && body == playerEntity) {
                status_apply(*playerStatus, StatusId::PaupsinaWeb,
                             /*useAlt=*/false);
            }
        }

        // `h.channel` and not `DamageChannel::Kinetic`: this is the line that makes
        // armour's resist[5] mean anything on a shot. Both branches take it, because
        // a channel is a property of the SHOT and not of what it happened to strike.
        const DamageChannel ch = static_cast<DamageChannel>(h.channel);

        // DETONATION — the reason `Projectile::team` was deleted, arriving 24 hours
        // after the deletion.
        //
        // ONE sweep over every body and every monster on the layer, and **not one
        // exclusion in it**. Not by team, not by faction, not by owner — and there is
        // now none anywhere else either: the contact path above lost the last one,
        // `p.source != victim`, on 2026-08-13 once `muzzle_point` made the clearance
        // it was insuring a guarantee instead of a 4 mm coincidence. A blast never had
        // even that excuse. It goes off in a PLACE, and everyone in that place pays,
        // starting with whoever was holding it. ARCHITECTURE.md §Манифест п.5:
        // "осколки бьют и владельца".
        //
        // `h.source` is read exactly twice below, both times to CREDIT a kill, never
        // to skip a target. That is the whole of the attribution/exclusion
        // distinction the 2026-08-12 ruling turns on.
        if (h.onDetonate && h.blastDm > 0) {
            const float R = static_cast<float>(h.blastDm) * 0.1f;

            // Gather first, damage second — the same two-phase discipline as the
            // enclosing function, one level down and for the same reason:
            // `apply_damage` emplaces `Dead`, which can reallocate the component pool
            // that the sweep is walking.
            struct Caught { Entity e; float d; };
            std::vector<Caught> caught;
            caught.reserve(16);
            auto sweep = [&](Entity cand, const vec3& cp) {
                const float dx = wrap_delta_f(h.impactPos.x, cp.x, kWorldExtent);
                const float dy = wrap_delta_f(h.impactPos.y, cp.y, kWorldExtent);
                const float dz = wrap_delta_f(h.impactPos.z, cp.z, kWorldExtent);
                const float d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > R * R) return;
                // A WALL STOPS A FRAGMENT, and this is the only thing in the blast
                // that may refuse a target. It is not an exclusion: it does not ask
                // WHO the body is, it asks whether anything solid stands between the
                // blast and it — the same question, at the same cell granularity,
                // that already stops a bullet and bounces a grenade. Distance alone
                // was a grenade that killed through a load-bearing wall.
                //
                // `los_clear` is the first LOS primitive in the tree ([world/los.h]);
                // it lives in the core because it is a fact about geometry, and
                // [mob_behaviour.h] has a dropped sight test waiting for it.
                //
                // NOT counted here, and the reason is the layer rather than
                // indifference: every other refusal in this file is counted
                // (`droppedFull` and friends) because there is a queue to hang the
                // counter on and an app-side `GIGA_*_DBG` line to print it. There is
                // neither here, and `giga_game` holds no `getenv` anywhere on
                // purpose — it stays headless and pure ([AGENTS.md]). So the number
                // is asserted where it is measured: `test_grenade` block 7 prints
                // how many bodies the wall shielded, on every ctest run.
                if (!los_clear(grid, h.impactPos, cp)) return;
                caught.push_back(Caught{cand, std::sqrt(d2)});
            };
            for (auto m : reg.view<const MobRef, const Transform>()) {
                const Transform& mt = reg.get<const Transform>(m);
                if (mt.layer != layer) continue;
                sweep(m, mt.pos);
            }
            for (auto b : reg.view<const NpcRef, const Transform>()) {
                // Anything already swept as a monster is not swept again as a body.
                // Nothing in the tree carries both today; a blast that charged such an
                // entity twice would be a silent double-damage and is cheaper to make
                // impossible than to notice. The camera holder is an ordinary NpcRef
                // and IS in this loop — that is how the thrower gets hit.
                if (reg.all_of<MobRef>(b)) continue;
                const Transform& bt = reg.get<const Transform>(b);
                if (bt.layer != layer) continue;
                sweep(b, bt.pos);
            }

            for (const Caught& c : caught) {
                if (!reg.valid(c.e)) continue;
                // LINEAR falloff, full damage at the centre and 1 at the rim. Linear
                // and not inverse-square because inverse-square is the law for a
                // point source radiating into free space, and a fragmentation blast
                // in a 2 m corridor is not that — it is fragments that spread and
                // slow. Linear is also the one shape a player can read off two
                // explosions: half as far, twice the damage.
                //
                // The floor of 1 keeps the rim honest: inside the radius you were
                // caught in the blast, and "caught in the blast for zero" would make
                // the radius a lie at its own edge.
                const float f = 1.0f - c.d / R;
                std::int16_t dmgHere =
                    static_cast<std::int16_t>(static_cast<float>(h.dmg) * f + 0.5f);
                if (dmgHere < 1) dmgHere = 1;
                DamageResult r =
                    apply_damage(reg, pool, c.e, dmgHere, ch, h.source, &grid,
                                 particles, &stack.layer(layer).gravity());
                if (!r.hit) continue;
                landed = true;
                // Credited exactly as the bullet path credits a shot, so a grenade
                // kill counts on the same counter the HUD already prints and, through
                // `Dead::killer` -> the NpcDied event, on the same contract/quest
                // ledger ([problems.md] §40). A monster's grenade credits a monster
                // and therefore closes nobody's contract.
                if (reg.valid(h.source)) {
                    if (auto* pr = reg.try_get<PlayerRanged>(h.source)) ++pr->hits;
                    if (r.lethal)
                        if (auto* pm = reg.try_get<PlayerMelee>(h.source)) ++pm->kills;
                }
            }

            // Geometry, through the ONE carve path ([destruct.h]): combat proposes,
            // the app disposes. A refusal here is COUNTED, never silent —
            // `droppedFull` is why a grenade that opened no hole can be told from a
            // grenade whose proposal never got in ([combat.h] CarveProposalQueue).
            if (carves) {
                const std::uint32_t seed =
                    static_cast<std::uint32_t>(tick) * 0x9e3779b9u ^
                    static_cast<std::uint32_t>(entt::to_integral(h.proj));
                if (carves->push(h.impactPos.x, h.impactPos.y, h.impactPos.z,
                                 R * kBlastCarveScale, carve_power_from_dmg(h.dmg),
                                 seed)) {
                    landed = true;
                }
            }
            // Heard, at severity 5 — the loudest thing in the game, and published at
            // the BLAST rather than at whoever threw it, because the place a monster
            // should walk toward is where the bang was.
            if (noise)
                noise_publish(*noise, layer, h.impactPos, blast_noise(R),
                              static_cast<std::uint32_t>(
                                  entt::to_integral(h.source)));
            // Flash and debris, through the unified pool ([particles.h]). Two bursts
            // and not one: the spark is the detonation, the debris is the wall it
            // took with it, and they are separate rows of data/particles.csv with
            // separate lifetimes.
            if (particles) {
                const std::uint32_t pseed =
                    static_cast<std::uint32_t>(tick) ^
                    static_cast<std::uint32_t>(entt::to_integral(h.proj));
                particles->push(h.impactPos, vec3{0.0f, 0.0f, 1.0f},
                                ParticleKind::Spark, 24, 0, pseed);
                particles->push(h.impactPos, vec3{0.0f, 0.0f, 0.5f},
                                ParticleKind::Debris, 18, 0, pseed ^ 0x5bf03635u);
            }
        }

        if (h.onVictim && victim != entt::null) {
            DamageResult r = apply_damage(reg, pool, victim, h.dmg, ch, h.source,
                                          &grid, particles,
                                          &stack.layer(layer).gravity());
            if (r.hit) landed = true;
        } else if (h.other != entt::null && reg.valid(h.other)) {
            DamageResult r = apply_damage(reg, pool, h.other, h.dmg, ch, h.source,
                                          &grid, particles,
                                          &stack.layer(layer).gravity());
            if (r.hit) {
                landed = true;
                // Credit the shooter, the same way the melee path credits a swing.
                // Only a player carries PlayerRanged, so this quietly does nothing for
                // the monster-shot-hit-a-resident case and needs no team test.
                if (reg.valid(h.source)) {
                    if (auto* pr = reg.try_get<PlayerRanged>(h.source)) ++pr->hits;
                    // And a KILL is a kill however it was made. `PlayerMelee::kills` is
                    // the game's only kill counter and the HUD prints it as "kills", so
                    // leaving shot monsters out of it meant a player with a rifle watched
                    // the number stay at zero while the corridor emptied. The field's
                    // NAME is now wrong; the behaviour was worse.
                    if (r.lethal)
                        if (auto* pm = reg.try_get<PlayerMelee>(h.source)) ++pm->kills;
                }
            }
        }
        // Wall chip: combat proposes, app disposes via carve_sphere ([destruct.h]).
        // WEB is control, not demolition — skip. Power from weapon dmg (not 0).
        if (h.onWall && carves && !web && h.dmg > 0) {
            const std::uint16_t pow = carve_power_from_dmg(h.dmg);
            if (carves->push(h.impactPos.x, h.impactPos.y, h.impactPos.z,
                             kBulletCarveRadius, pow,
                             static_cast<std::uint32_t>(tick) * 0x9e3779b9u ^
                                 static_cast<std::uint32_t>(
                                     entt::to_integral(h.proj)))) {
                landed = true;
            }
            // Sparks — the projectile-on-wall writer of the unified pool
            // ([particles.h]). The chip carve above is the scar; this is the
            // flash. The sim's voxel bounce scatters them off the surface, so
            // no impact normal is needed here.
            if (particles) {
                const int n = 4 + h.dmg / 4;
                // The 0.6 bias rides the layer's UP, not +Z — the same frame
                // correction apply_damage's blood spray already makes, and the
                // last hardcoded vertical in this file. Magnitude untouched.
                const vec3 gg = stack.layer(layer).gravity().at(h.impactPos);
                const float ggLen = length(gg);
                const vec3 sparkUp = ggLen > 1e-6f ? gg * (-0.6f / ggLen)
                                                   : vec3{0.0f, 0.0f, 0.6f};
                particles->push(h.impactPos, sparkUp,
                                ParticleKind::Spark,
                                static_cast<std::uint8_t>(n > 12 ? 12 : n), 0,
                                static_cast<std::uint32_t>(tick) ^
                                    static_cast<std::uint32_t>(
                                        entt::to_integral(h.proj)));
            }
        }
        if (landed) ++hits;
        // Blood: a shot that landed on a BODY splatters the world through the
        // universal stain layer ([world/stain.h]) — same op for every channel,
        // colour from the substance table, dirty cells owed to the mirror by
        // the caller. Wall hits bleed nothing; the carve chip is their mark.
        if (landed && stainDirty && !h.onWall && !web && h.dmg > 0) {
            const vec3 gg = stack.layer(layer).gravity().at(h.impactPos);
            const float ggLen = length(gg);
            const vec3 stainBias = ggLen > 1e-6f ? gg * (0.35f / ggLen)
                                                 : vec3{0.0f, 0.0f, -0.35f};
            stain_splat(stack.layer(layer), h.impactPos,
                        stainBias, 1.6f, /*rays=*/10,
                        kStainBlood,
                        static_cast<std::uint32_t>(tick) ^
                            entt::to_integral(h.proj),
                        *stainDirty);
        }
        if (reg.valid(h.proj)) reg.destroy(h.proj);
    }
    (void)bus;
    return hits;
}


std::uint32_t player_ranged_step(Registry& reg, NpcPool& pool, LayerId layer,
                                 bool wantFire, float dt, std::uint64_t tick,
                                 NoiseField* noise, const StatusSet* status,
                                 EventBus* bus) {
    Entity shooter = entt::null;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        shooter = e;
        break;
    }
    if (shooter == entt::null) return 0;

    // Lazily attached, like PlayerMelee: possessing a new body after death must not
    // have to remember to add it.
    PlayerRanged& pr = reg.get_or_emplace<PlayerRanged>(shooter);

    const std::uint16_t elapsedMs =
        static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);

    // Decremented EXACTLY ONCE, at the top, before any early-out. Defect 3: the
    // reference decremented cooldowns at ~60 sites and some monsters out-attacked
    // their own authored rate.
    if (pr.cooldownMs > elapsedMs) pr.cooldownMs -= elapsedMs; else pr.cooldownMs = 0;
    if (pr.reloadMs > elapsedMs) pr.reloadMs -= elapsedMs; else pr.reloadMs = 0;

    const NpcRef* nr = reg.try_get<NpcRef>(shooter);
    if (!nr || !pool.valid(nr->id)) return 0;
    Inventory& inv = pool.inventory(nr->id);

    const Equipped* eq = reg.try_get<Equipped>(shooter);
    const int gunSlot = equipped_ranged_slot(inv, eq);
    if (gunSlot < 0) return 0;
    const ItemId gun = inv.slots[gunSlot].item;
    const RangedDef* def = ranged_for_item(gun);
    if (!def) return 0;

    // Swapping guns empties the magazine: a magazine of shells is not a magazine of
    // 9mm, and carrying the count across would let a shotgun fire rifle rounds.
    if (pr.weapon != gun) {
        pr.weapon = gun;
        pr.magCount = 0;
        pr.reloadMs = 0;
    }

    if (pr.reloadMs > 0) return 0;

    if (pr.magCount == 0) {
        // Reload: move up to a magazine's worth out of the inventory. Counting first
        // and only starting the timer if something is actually there, so an empty
        // pack does not lock the player into a permanent reload.
        std::uint16_t want = def->magazine;
        std::uint16_t got = 0;
        for (ItemSlot& sl : inv.slots) {
            if (got >= want) break;
            if (sl.item != def->ammo || sl.count == 0) continue;
            const std::uint16_t take =
                static_cast<std::uint16_t>(sl.count < (want - got) ? sl.count
                                                                   : (want - got));
            sl.count = static_cast<std::uint16_t>(sl.count - take);
            if (sl.count == 0) sl.item = kInvalidItem;
            got = static_cast<std::uint16_t>(got + take);
        }
        if (got == 0) return 0;   // out of ammo entirely; nothing to do but not fire
        pr.magCount = got;
        pr.reloadMs = def->reloadMs;
        return 0;
    }

    if (!wantFire || pr.cooldownMs > 0) return 0;

    // Spec 03 §4.1: Piecewise jamming malfunction roll on fouled weapons.
    ItemSlot& gSlot = inv.slots[gunSlot];
    const ItemDef& d = item_def(gSlot.item);
    if (d.wearKind == static_cast<std::uint8_t>(WearKind::Jamming)) {
        const std::uint8_t cond = gSlot.condition;
        if (cond < 200u) {
            float jamProb = 0.0f;
            if (cond >= 128u) {
                // Low risk zone: 0% .. 5%
                jamProb = (static_cast<float>(200u - cond) / 72.0f) * 0.05f;
            } else {
                // Critical fouling zone: 5% .. 50%
                const float t = static_cast<float>(128u - cond) / 128.0f;
                jamProb = 0.05f + 0.45f * (t * t);
            }

            if (const RpgStats* rs = reg.try_get<RpgStats>(shooter)) {
                const float agiFactor = static_cast<float>(agi_attack_speed_mult_e3(*rs)) / 1000.0f;
                jamProb *= agiFactor;
            }

            const std::uint32_t jamThreshold = static_cast<std::uint32_t>(jamProb * 1000.0f + 0.5f);
            const std::uint32_t jamHash = hash_u32((static_cast<std::uint32_t>(nr->id) * 0x9e3779b9u) ^
                                                   (static_cast<std::uint32_t>(tick) * 0x7feb352du) ^ 0x7A391u);
            const std::uint32_t jamRoll = jamHash % 1000u;
            if (jamRoll < jamThreshold) {
                pr.cooldownMs = static_cast<std::uint16_t>(def->cooldownMs * 2);
                if (bus) {
                    const std::uint32_t fouling = static_cast<std::uint32_t>(255u - cond);
                    bus->publish(EventType::WeaponJammed, nr->id, gSlot.item, fouling, tick);
                }
                return 0; // Jammed! Misfire
            }
        }
        if (gSlot.condition > d.wearPerUse) {
            gSlot.condition = static_cast<std::uint8_t>(gSlot.condition - d.wearPerUse);
        } else {
            gSlot.condition = 0;
        }
    }

    const CameraTag& cam = reg.get<const CameraTag>(shooter);
    const Transform& tr = reg.get<const Transform>(shooter);
    const vec3 eye{tr.pos.x + cam.eyeOffset.x, tr.pos.y + cam.eyeOffset.y,
                   tr.pos.z + cam.eyeOffset.z};
    const vec3 fwd = camera_forward(cam.yaw, cam.pitch);

    // Spread is applied as a CONE, not as the reference's yaw-only jitter. The
    // reference is 2.5D, so jittering yaw alone was correct there; in true 3D it
    // would put a shotgun's pellets in a dead-flat horizontal line, which reads as a
    // bug rather than as a spread.
    // RPGCMBT: AGI tightens the cone (agi_ranged_spread_mult_e3 < 1000).
    float spread = static_cast<float>(def->spreadE4) * 1e-4f;
    if (const RpgStats* rs = reg.try_get<RpgStats>(shooter)) {
        spread *= static_cast<float>(agi_ranged_spread_mult_e3(*rs)) / 1000.0f;
        spread *= static_cast<float>(per_ranged_accuracy_mult_e3(*rs)) / 1000.0f;
    }
    // STATAIM: SporeHaze (and friends) widen the cone via status_aim_mult_e3.
    if (status) {
        const std::uint16_t am = status_aim_mult_e3(*status);
        if (am != 1000u)
            spread *= static_cast<float>(am) / 1000.0f;
    }
    // Spec 03 §4.1 / Spec 09: Fouling / weapon wear degrades accuracy by widening the spread cone.
    if (d.wearKind != static_cast<std::uint8_t>(WearKind::None) && gSlot.condition < 255u) {
        const float foulingFrac = static_cast<float>(255u - gSlot.condition) / 255.0f;
        spread *= (1.0f + 0.50f * foulingFrac);
    }
    // Any two vectors perpendicular to fwd. Guarding on |fwd.z| rather than fwd.x
    // keeps the cross product well-conditioned when looking straight up or down.
    vec3 up = (fwd.z > 0.9f || fwd.z < -0.9f) ? vec3{1, 0, 0} : vec3{0, 0, 1};
    vec3 rt{fwd.y * up.z - fwd.z * up.y, fwd.z * up.x - fwd.x * up.z,
            fwd.x * up.y - fwd.y * up.x};
    float rl = std::sqrt(rt.x * rt.x + rt.y * rt.y + rt.z * rt.z);
    if (rl < 1e-4f) return 0;
    rt = vec3{rt.x / rl, rt.y / rl, rt.z / rl};
    vec3 ud{rt.y * fwd.z - rt.z * fwd.y, rt.z * fwd.x - rt.x * fwd.z,
            rt.x * fwd.y - rt.y * fwd.x};

    std::uint32_t seed = static_cast<std::uint32_t>(tick) * 0x9e3779b9u ^
                         static_cast<std::uint32_t>(entt::to_integral(shooter));
    for (std::uint8_t i = 0; i < def->pellets; ++i) {
        // splitmix-ish, the same idiom the spawner and the loot roller use.
        seed += 0x9e3779b9u;
        std::uint32_t h = seed;
        h ^= h >> 16; h *= 0x7feb352du;
        h ^= h >> 15; h *= 0x846ca68bu;
        h ^= h >> 16;
        const float a = static_cast<float>(h & 0xFFFFu) / 65535.0f * 6.2831853f;
        const float r = static_cast<float>((h >> 16) & 0xFFFFu) / 65535.0f;
        // sqrt(r) so pellets are uniform over the cone's DISC rather than piling up
        // in the middle, which is what a bare uniform radius would do.
        const float m = std::sqrt(r) * spread * 0.5f;
        const float ox = std::cos(a) * m, oy = std::sin(a) * m;
        const vec3 dir{fwd.x + rt.x * ox + ud.x * oy,
                       fwd.y + rt.y * ox + ud.y * oy,
                       fwd.z + rt.z * ox + ud.z * oy};
        // `def->channel` and not a hardcoded Kinetic: the column exists in
        // [ranged_table.h], the generator fills it from data/weapons_ranged.csv, and
        // until this line NOTHING in src/ read it. Armour's resist[5], the psi-resist
        // rows in data/items.csv and every per-channel column in [monster_traits.h]
        // were all mitigating against a channel that only ever arrived as Kinetic.
        spawn_projectile_dir(reg, layer, eye, dir,
                             static_cast<std::int16_t>(def->dmg),
                             def->projSpeedMmps, shooter, kPlayerGravityPct,
                             def->channel);
    }

    // The shot is heard. ONE noise per trigger pull, not one per pellet: a shotgun
    // blast is one bang, and twelve records would also evict everything else in a
    // 64-slot field. Published at the SHOOTER's position rather than the muzzle so a
    // monster investigating the sound walks at the player and not at a point 1.7 m in
    // front of him. [noise.h]
    if (noise)
        noise_publish(*noise, layer, tr.pos, weapon_fire_noise(*def),
                      static_cast<std::uint32_t>(entt::to_integral(shooter)));

    // ONE round per shot regardless of pellet count — a shotgun blast costs one shell
    // and produces up to twelve projectiles. The reference's rule.
    --pr.magCount;
    // RPGCMBT: AGI shortens firearm cooldown (same inverse mult as melee).
    std::uint16_t rcd = def->cooldownMs;
    if (const RpgStats* rs = reg.try_get<RpgStats>(shooter)) {
        std::int16_t php = -1, pmaxHp = -1;
        if (const NpcRef* snr = reg.try_get<NpcRef>(shooter)) {
            if (pool.valid(snr->id)) {
                php = pool.hp(snr->id);
                pmaxHp = pool.max_hp(snr->id);
            }
        }
        const std::uint32_t cd =
            (static_cast<std::uint32_t>(def->cooldownMs) *
             agi_attack_speed_mult_e3(*rs, php, pmaxHp)) / 1000u;
        rcd = static_cast<std::uint16_t>(cd > 65535u ? 65535u : (cd < 1u ? 1u : cd));
    }
    pr.cooldownMs = rcd;
    ++pr.shots;
    return 1;
}

std::uint32_t player_throw_step(Registry& reg, NpcPool& pool, LayerId layer,
                                bool wantThrow) {
    Entity thrower = entt::null;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        thrower = e;
        break;
    }
    if (thrower == entt::null) return 0;

    // NO DECREMENT HERE. The cooldown is `player_ranged_step`'s and it is aged there,
    // exactly once per tick, before any early-out — defect 3 in this file's header,
    // the one the reference committed at ~60 sites. This function READS the timer it
    // shares and never advances it; see [combat.h] for the ordering requirement that
    // makes that safe.
    PlayerRanged& pr = reg.get_or_emplace<PlayerRanged>(thrower);
    if (!wantThrow || pr.cooldownMs > 0) return 0;

    const NpcRef* nr = reg.try_get<NpcRef>(thrower);
    if (!nr || !pool.valid(nr->id)) return 0;
    Inventory& inv = pool.inventory(nr->id);

    const ItemId item = equipped_throwable(inv);
    const RangedDef* def = ranged_for_item(item);
    if (!def || !ranged_is_explosive(*def)) return 0;

    // SPEND THE WEAPON, and spend it BEFORE the throw. There is no magazine here and
    // no reload: the thing in your hand is the round, so one throw is one item out of
    // the bag. Taken first so a spawn that refuses (a degenerate aim vector) cannot
    // leave the player holding a grenade he has already thrown.
    bool paid = false;
    for (ItemSlot& sl : inv.slots) {
        if (sl.item != item || sl.count == 0) continue;
        --sl.count;
        if (sl.count == 0) sl.item = kInvalidItem;
        paid = true;
        break;
    }
    if (!paid) return 0;

    const CameraTag& cam = reg.get<const CameraTag>(thrower);
    const Transform& tr = reg.get<const Transform>(thrower);
    const vec3 eye{tr.pos.x + cam.eyeOffset.x, tr.pos.y + cam.eyeOffset.y,
                   tr.pos.z + cam.eyeOffset.z};
    // Straight down the look ray, and DELIBERATELY not lofted. An automatic upward
    // arc would be the aimbot `Projectile::gravityPct` exists to refuse, one axis
    // over: the player would be handed a throw he did not aim. Look up to throw far,
    // look at your feet to throw short — the arc is gravity's, and the aim is yours.
    const vec3 dir = camera_forward(cam.yaw, cam.pitch);

    spawn_grenade(reg, layer, eye, dir, static_cast<std::int16_t>(def->dmg),
                  def->projSpeedMmps, thrower, def->blastDm,
                  static_cast<std::uint16_t>(def->fuseDs) * 100u, def->channel);

    // NO NoiseField AND NO TICK PARAMETER, which is why this signature is shorter
    // than its two siblings rather than symmetrical with them. A throw is nearly
    // silent — what a floor hears is the detonation, three seconds later and
    // somewhere else, and `projectile_step` publishes exactly that ([noise.h]
    // blast_noise). A tick would be the seed for a spread cone, and there is no cone:
    // a thrown weight goes where you are looking. Carrying either as an unread
    // parameter is how a field becomes write-only, which is the defect
    // `Projectile::proj` and `RangedDef::channel` were both dug out of.
    pr.cooldownMs = def->cooldownMs;
    ++pr.shots;
    return 1;
}

bool player_melee_step(Registry& reg, NpcPool& pool, EventBus& bus, LayerId layer,
                       float dt, bool wantsAttack, std::uint64_t tick,
                       const MacroGrid* grid, CarveProposalQueue* carves,
                       const StatusSet* status, ParticleBurstQueue* particles,
                       const GravityField* gravity) {
    Entity self = entt::null;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        self = e;
        break;
    }
    if (self == entt::null) return false;

    // Attached lazily so possessing a new body after death does not have to
    // remember to add it — but the kill count is carried over by the caller.
    if (!reg.all_of<PlayerMelee>(self)) reg.emplace<PlayerMelee>(self);
    PlayerMelee& pm = reg.get<PlayerMelee>(self);

    const std::uint16_t elapsedMs =
        static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);
    if (pm.cooldownMs > elapsedMs)
        pm.cooldownMs = static_cast<std::uint16_t>(pm.cooldownMs - elapsedMs);
    else
        pm.cooldownMs = 0;

    if (!wantsAttack || pm.cooldownMs > 0) return false;

    // Whatever is in hand. A found rebar hits eight times as hard as a fist and
    // reaches four times as far — which is the entire point of picking loot up.
    // RPGCMBT: STR/level scale damage via melee_damage(); AGI shortens cooldown;
    // STR also speeds heavy weapons (cd >= kHeavyWeaponCooldownMs). Without a
    // RpgStats component the raw table values are used (identity mults).
    const MeleeDef* wp = &unarmed_melee();
    ItemId heldWeapon = 0;  // 0 = bare hands sentinel [item_table.h]
    const NpcRef* nr = reg.try_get<NpcRef>(self);
    const RpgStats* rs = reg.try_get<RpgStats>(self);
    const Equipped* eq = reg.try_get<Equipped>(self);
    int heldSlot = -1;
    if (nr && pool.valid(nr->id)) {
        Inventory& inv = pool.inventory(nr->id);
        heldSlot = equipped_melee_slot(inv, eq);
        if (heldSlot >= 0 && heldSlot < kInvSlots) {
            heldWeapon = inv.slots[heldSlot].item;
            if (const MeleeDef* m = melee_for_item(heldWeapon)) wp = m;
        }
    }
    std::int16_t swingDmg = static_cast<std::int16_t>(wp->dmg);
    std::uint16_t swingCd = wp->cooldownMs;
    if (rs) {
        swingDmg = melee_damage(*rs, heldWeapon, static_cast<std::int16_t>(wp->dmg));
        // Combine AGI attack-speed and STR heavy-weapon speed as e3 mults.
        std::int16_t php = -1, pmaxHp = -1;
        if (nr && pool.valid(nr->id)) {
            php = pool.hp(nr->id);
            pmaxHp = pool.max_hp(nr->id);
        }
        const std::uint32_t agiE3 = agi_attack_speed_mult_e3(*rs, php, pmaxHp);
        const std::uint32_t strE3 = str_heavy_weapon_speed_mult_e3(*rs, wp->cooldownMs);
        const std::uint32_t cd =
            (static_cast<std::uint32_t>(wp->cooldownMs) * agiE3 * strE3) / 1000000u;
        swingCd = static_cast<std::uint16_t>(cd > 65535u ? 65535u : (cd < 1u ? 1u : cd));
    }
    // STATMELEE: authored status melee mult (Zhelemish 700/1000). Applied after
    // RPGCMBT so both bite; identity 1000 when status is null or clean.
    if (status) {
        const std::uint32_t m = status_melee_mult_e3(*status);
        if (m != 1000u) {
            int scaled = static_cast<int>(
                (static_cast<std::int32_t>(swingDmg) * static_cast<std::int32_t>(m))
                / 1000);
            if (scaled < 1 && swingDmg > 0) scaled = 1;
            if (scaled > 32767) scaled = 32767;
            swingDmg = static_cast<std::int16_t>(scaled);
        }
    }
    // Spec 03 §4.1 / Spec 09: Weapon condition degradation (dull blade, cracked club)
    // scales damage down to 60% minimum at condition 0.
    if (heldSlot >= 0 && nr && pool.valid(nr->id)) {
        const Inventory& inv = pool.inventory(nr->id);
        const ItemSlot& sl = inv.slots[heldSlot];
        if (item_valid(sl.item)) {
            const ItemDef& d = item_def(sl.item);
            if (d.wearKind == static_cast<std::uint8_t>(WearKind::Durability) && sl.condition < 255u) {
                const float condMult = 0.60f + 0.40f * (static_cast<float>(sl.condition) / 255.0f);
                int scaled = static_cast<int>(static_cast<float>(swingDmg) * condMult);
                if (scaled < 1 && swingDmg > 0) scaled = 1;
                if (scaled > 32767) scaled = 32767;
                swingDmg = static_cast<std::int16_t>(scaled);
            }
        }
    }
    const float reach =
        static_cast<float>(wp->reachMm) * 0.001f * kCellSize + kMeleeReachSlack;

    const Transform& me = reg.get<const Transform>(self);
    const CameraTag& cam = reg.get<const CameraTag>(self);
    const vec3 fwd = camera_forward(cam.yaw, cam.pitch);

    // Nearest monster inside reach that is also roughly in front. Nearest rather
    // than first-found, so a swing in a crowd hits what you are actually up
    // against instead of whichever entity the view happened to yield first.
    Entity best = entt::null;
    float bestD2 = reach * reach;
    for (auto e : reg.view<const MobRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const float dx = wrap_delta_f(me.pos.x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(me.pos.y, tr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(me.pos.z, tr.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > bestD2) continue;
        const float len = std::sqrt(d2);
        if (len > 1e-3f) {
            const float dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / len;
            if (dot < kMeleeFacingDot) continue;  // behind or off to the side
        }
        bestD2 = d2;
        best = e;
    }
    if (best == entt::null) {
        // Wall chip: no monster in the cone — probe solid cells along the look
        // ray and propose a carve. Without grid+carves this is bit-for-bit the
        // pre-CARVE miss (return false, no cooldown burn on empty air).
        if (grid && carves) {
            const vec3 eye{me.pos.x + cam.eyeOffset.x,
                           me.pos.y + cam.eyeOffset.y,
                           me.pos.z + cam.eyeOffset.z};
            bool hitWall = false;
            vec3 hitAt{};
            constexpr int kSteps = 8;
            for (int i = 1; i <= kSteps; ++i) {
                const float t = reach * (static_cast<float>(i) / kSteps);
                const vec3 p{eye.x + fwd.x * t, eye.y + fwd.y * t,
                             eye.z + fwd.z * t};
                const int cx = wrap_macro(static_cast<int>(p.x / kCellSize));
                const int cy = wrap_macro(static_cast<int>(p.y / kCellSize));
                const int cz = wrap_macro(static_cast<int>(p.z / kCellSize));
                if (grid->cell(cx, cy, cz) != kCellAir) {
                    hitWall = true;
                    hitAt = p;
                    break;
                }
            }
            if (hitWall) {
                carves->push(hitAt.x, hitAt.y, hitAt.z, kMeleeCarveRadius,
                             carve_power_from_dmg(swingDmg),
                             static_cast<std::uint32_t>(tick));
                pm.cooldownMs = swingCd;
                if (heldSlot >= 0 && nr && pool.valid(nr->id)) {
                    Inventory& inv = pool.inventory(nr->id);
                    ItemSlot& sl = inv.slots[heldSlot];
                    if (item_valid(sl.item)) {
                        const ItemDef& d = item_def(sl.item);
                        if (d.wearKind == static_cast<std::uint8_t>(WearKind::Durability)) {
                            const std::uint32_t strWearMult = rs ? str_durability_wear_mult_e3(*rs) : 1000u;
                            const std::uint32_t wearRate = std::max(1u, (static_cast<std::uint32_t>(d.wearPerUse) * strWearMult + 500u) / 1000u);
                            if (sl.condition > wearRate) {
                                sl.condition = static_cast<std::uint8_t>(sl.condition - wearRate);
                            } else {
                                sl.condition = 0;
                                bus.publish(EventType::WeaponBroken, nr->id, sl.item, 0, tick);
                                sl = ItemSlot{};
                            }
                        }
                    }
                }
                return true;
            }
        }
        return false;
    }

    // Same damage path, same Dead tag, same finalizer as a mob's swing. There is
    // deliberately no second way for something to die.
    // MELEEGRID: forward grid so WallBrace soaks player melee (mobs/projectiles already do).
    DamageResult r = apply_damage(reg, pool, best, swingDmg,
                                  DamageChannel::Kinetic, self, grid, particles,
                                  gravity);
    pm.cooldownMs = swingCd;
    if (r.lethal) ++pm.kills;

    if (r.hit && heldSlot >= 0 && nr && pool.valid(nr->id)) {
        Inventory& inv = pool.inventory(nr->id);
        ItemSlot& sl = inv.slots[heldSlot];
        if (item_valid(sl.item)) {
            const ItemDef& d = item_def(sl.item);
            if (d.wearKind == static_cast<std::uint8_t>(WearKind::Durability)) {
                const std::uint32_t strWearMult = rs ? str_durability_wear_mult_e3(*rs) : 1000u;
                const std::uint32_t wearRate = std::max(1u, (static_cast<std::uint32_t>(d.wearPerUse) * strWearMult + 500u) / 1000u);
                if (sl.condition > wearRate) {
                    sl.condition = static_cast<std::uint8_t>(sl.condition - wearRate);
                } else {
                    sl.condition = 0;
                    bus.publish(EventType::WeaponBroken, nr->id, sl.item, 0, tick);
                    sl = ItemSlot{};
                }
            }
        }
    }
    return r.hit;
}



// POSRPG: see combat.h. Live-to-live hop — old body stays in the world.
void transfer_player_progression(Registry& reg, Entity from, Entity to) {
    if (from == to) return;
    if (!reg.valid(from) || !reg.valid(to)) return;

    if (const RpgStats* rs = reg.try_get<RpgStats>(from)) {
        reg.emplace_or_replace<RpgStats>(to, *rs);
    }

    std::uint32_t kills = 0;
    if (PlayerMelee* pm = reg.try_get<PlayerMelee>(from)) {
        kills = pm->kills;
        pm->kills = 0;
    }
    // Always stamp melee when there was a tally OR the source carried the
    // component (so a zero-kill fighter still gets a clean PlayerMelee on the
    // new body rather than waiting for the first swing to lazy-attach).
    if (kills != 0 || reg.all_of<PlayerMelee>(from)) {
        reg.emplace_or_replace<PlayerMelee>(to, PlayerMelee{/*cooldownMs=*/0, kills});
    }

    if (PlayerRanged* pr = reg.try_get<PlayerRanged>(from)) {
        const std::uint32_t shots = pr->shots;
        const std::uint32_t hits = pr->hits;
        pr->shots = 0;
        pr->hits = 0;
        // Mag/weapon/cooldowns remain on `from`. Move only the cumulative
        // counters; do not invent PlayerRanged on a body that never fired and
        // has nothing to carry (lazy attach stays lazy).
        if (shots == 0 && hits == 0 && !reg.all_of<PlayerRanged>(to))
            return; // kills/rpg already handled above
        PlayerRanged dst{};
        if (PlayerRanged* existing = reg.try_get<PlayerRanged>(to))
            dst = *existing;
        dst.shots = shots;
        dst.hits = hits;
        reg.emplace_or_replace<PlayerRanged>(to, dst);
    }
}

std::uint32_t fouling_step(Registry& reg, NpcPool& pool, LayerId layer,
                           const float* gasField, const float* smokeField,
                           float dt, std::uint64_t tick) {
    (void)dt;
    std::uint32_t processed = 0;

    for (auto e : reg.view<const NpcRef, const Transform, const Equipped>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const NpcRef& nr = reg.get<const NpcRef>(e);
        if (!pool.valid(nr.id)) continue;

        // Identity stagger 1-in-16 ticks (matches encumbrance_step)
        if ((tick + static_cast<std::uint64_t>(nr.id)) % 16 != 0) continue;

        const Equipped& eq = reg.get<const Equipped>(e);
        Inventory& inv = pool.inventory(nr.id);

        float envHazard = 0.0f;
        if (gasField || smokeField) {
            const int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
            const int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
            const int cz = wrap_macro(static_cast<int>(tr.pos.z / kCellSize));
            const std::size_t idx = macro_index(cx, cy, cz);
            if (gasField) envHazard += gasField[idx];
            if (smokeField) envHazard += smokeField[idx] * 0.5f;
        }

        // 1. Tool fouling & charge (gas masks, batteries, filters)
        if (eq.tool != kEquipNone && eq.tool < kInvSlots) {
            ItemSlot& toolSlot = inv.slots[eq.tool];
            if (item_valid(toolSlot.item) && toolSlot.count > 0) {
                const ItemDef& def = item_def(toolSlot.item);
                if (def.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
                    if (envHazard > 0.05f) {
                        const std::uint8_t foulRate = static_cast<std::uint8_t>(
                            std::clamp(static_cast<int>(envHazard * 4.0f + 0.5f), 1, 8));
                        if (toolSlot.condition > foulRate) toolSlot.condition = static_cast<std::uint8_t>(toolSlot.condition - foulRate);
                        else toolSlot.condition = 0;
                        ++processed;
                    }
                } else if (def.wearKind == static_cast<std::uint8_t>(WearKind::Charge)) {
                    if (def.wearPerUse > 0 && toolSlot.condition > 0) {
                        if (toolSlot.condition > def.wearPerUse) toolSlot.condition = static_cast<std::uint8_t>(toolSlot.condition - def.wearPerUse);
                        else toolSlot.condition = 0;
                        ++processed;
                    }
                }
            }
        }

        // 2. Equipped weapon environmental fouling (soot / corrosive gas deposits on firearms)
        if (eq.weapon != kEquipNone && eq.weapon < kInvSlots) {
            ItemSlot& wepSlot = inv.slots[eq.weapon];
            if (item_valid(wepSlot.item) && wepSlot.count > 0) {
                const ItemDef& def = item_def(wepSlot.item);
                if (def.wearKind == static_cast<std::uint8_t>(WearKind::Jamming) ||
                    def.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
                    if (envHazard > 0.10f) {
                        const std::uint8_t foulRate = static_cast<std::uint8_t>(
                            std::clamp(static_cast<int>(envHazard * 2.0f + 0.5f), 1, 4));
                        if (wepSlot.condition > foulRate) wepSlot.condition = static_cast<std::uint8_t>(wepSlot.condition - foulRate);
                        else wepSlot.condition = 0;
                        ++processed;
                    }
                }
            }
        }
    }
    return processed;
}

} // namespace giga::game
