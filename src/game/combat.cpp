#include "game/combat.h"

#include <cmath>
#include <vector>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"   // NpcRef
#include "game/mob_spawn.h"
#include "game/mob_table.h"
#include "game/weapon_table.h"
#include "sim/camera.h"   // camera_forward
#include "world/macro_grid.h"
#include "world/world.h"
#include "world/types.h"

namespace giga::game {

namespace {

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

// Defined further down, beside projectile_step where the flight logic lives.
// Declared here because mob_attack_step launches shots and sits above it.
void spawn_projectile(Registry& reg, LayerId layer, const vec3& from,
                      const vec3& to, std::int16_t dmg,
                      std::uint16_t projSpeedMmps, Entity source);

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
                          std::int16_t raw, DamageChannel ch, Entity source) {
    DamageResult out;
    if (!reg.valid(target) || raw <= 0) return out;
    if (reg.all_of<Dead>(target)) return out;  // already scheduled to die

    // Mitigation happens exactly once, here. Nothing downstream sees `raw`.
    std::int16_t dmg = raw;
    if (const Armour* a = reg.try_get<Armour>(target)) {
        std::size_t i = static_cast<std::size_t>(ch);
        if (i < kDamageChannels) dmg = mitigate(raw, a->resist[i]);
    }
    out.blocked = static_cast<std::int16_t>(raw - dmg);

    // Where the HP lives depends on what the target is, and that is the only
    // branch: everything above and below is common.
    std::int16_t* hp = nullptr;
    if (MobRef* m = reg.try_get<MobRef>(target)) {
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

    // The applied value is what HP actually lost — clamped at zero, so an
    // overkill hit reports the overkill it could use, not the swing that was
    // authored. This is the number a kill feed or a threat model must use.
    out.applied = static_cast<std::int16_t>(before - after);
    out.lethal = (after == 0 && before > 0);

    if (out.lethal)
        reg.emplace<Dead>(target,
                          Dead{source, static_cast<std::uint8_t>(ch)});
    return out;
}

std::uint32_t finalize_deaths(Registry& reg, NpcPool& pool, EventBus& bus,
                              std::uint64_t tick) {
    // Collect before destroying: mutating while iterating a view invalidates it.
    std::vector<Entity> doomed;
    for (auto e : reg.view<const Dead>()) doomed.push_back(e);

    for (Entity e : doomed) {
        const Dead& d = reg.get<const Dead>(e);

        std::uint32_t victim = kInvalidNpc;
        std::uint32_t kind = 0xFFu;
        if (const NpcRef* n = reg.try_get<NpcRef>(e)) {
            victim = n->id;
            // A dead record KEEPS its slot ([npcs.md]) — the id stays valid
            // forever, so anything holding it (a quest, a relation) does not
            // dangle. This is the whole reason the pool never reclaims.
            if (pool.valid(n->id)) pool.kill(n->id);
        }
        if (const MobRef* m = reg.try_get<MobRef>(e)) kind = m->kind;

        // Published BEFORE the entity goes away, so a listener can still read it.
        // Everything that must react to a death reacts to this, never to noticing
        // an entity has vanished.
        bus.publish(EventType::NpcDied, victim, kind,
                    static_cast<std::uint32_t>(entt::to_integral(d.killer)), tick);

        reg.destroy(e);
    }
    return static_cast<std::uint32_t>(doomed.size());
}

std::uint32_t mob_attack_step(Registry& reg, NpcPool& pool, EventBus& bus,
                             LayerId layer, float dt, std::uint64_t tick) {
    // The one target, stated in the header: whoever holds the camera.
    Entity victim = entt::null;
    vec3 victimPos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        victim = e;
        victimPos = tr.pos;
        break;
    }

    const std::uint16_t elapsedMs =
        static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);

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
        std::int16_t raw;
        std::uint16_t cd;
        bool ranged;         // launch a projectile instead of touching the victim
        vec3 from;           // launch origin, captured while the view was alive
        float dist;          // horizontal range, for the gravity arc
        std::uint16_t projSpeedMmps;
    };
    std::vector<Swing> queued;

    for (auto e : reg.view<const MobRef, const Transform, MobCombat>()) {
        MobCombat& mc = reg.get<MobCombat>(e);

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

        if (victim == entt::null) continue;
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (mc.cooldownMs > 0) continue;

        const MobRef& mr = reg.get<const MobRef>(e);
        const MobDef& def = kMobTable[mr.kind];
        if (def.dmg == 0) continue;  // PAUPSINA and friends do not hit

        // Distances are toroidal.
        const float dx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
        const float dy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
        const float dz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;

        // Damage scales with the mob's level on the same curve as its HP, so a
        // deep-floor elite hits as hard as it is tough.
        const std::int16_t raw =
            static_cast<std::int16_t>(mob_hp_at_level(def.dmg, mr.level));

        // Melee first: if it can touch you, it touches you. Reach is in cells.
        const float reach = static_cast<float>(def.meleeReachMm) * 0.001f * kCellSize;
        if (d2 <= reach * reach) {
            mc.windupMs = 0;   // contact cancels a shot it was lining up
            queued.push_back(Swing{e, raw, def.attackCdMs, false, tr.pos, 0.0f, 0});
            continue;
        }

        // Ranged. 13 of the 69 kinds; the rest have shotRangeMm == 0 and stop here.
        if (def.shotRangeMm == 0) continue;
        const float maxR = static_cast<float>(def.shotRangeMm) * 0.001f * kCellSize;
        const float minR = static_cast<float>(def.minRangeMm) * 0.001f * kCellSize;
        if (d2 > maxR * maxR || d2 < minR * minR) {
            mc.windupMs = 0;   // out of the band: abort whatever it was aiming
            continue;
        }

        // The telegraph. A shot is not fired on the tick it is decided: the kind's
        // authored windup runs first, and leaving the band during it aborts (above).
        // This is the entire difference between a fair ranged monster and an unfair
        // one, so it is not optional and not tunable away.
        if (mc.windupMs > 0) continue;              // mid-telegraph
        if (!windupDone && def.windupMs > 0) {      // start one
            mc.windupMs = def.windupMs;
            continue;
        }
        // windupDone, or a kind with no authored windup: the shot leaves now.

        queued.push_back(Swing{e, raw, def.attackCdMs, true, tr.pos,
                               std::sqrt(dx * dx + dy * dy), def.projSpeedMmps});
    }

    std::uint32_t swings = 0;
    for (const Swing& s : queued) {
        if (s.ranged) {
            spawn_projectile(reg, layer, s.from, victimPos, s.raw,
                             s.projSpeedMmps, s.mob);
            ++swings;
            if (MobCombat* mc = reg.try_get<MobCombat>(s.mob))
                mc->cooldownMs = s.cd;
            continue;   // a shot in flight is not a hit yet
        }
        DamageResult r = apply_damage(reg, pool, victim, s.raw,
                                      DamageChannel::Kinetic, s.mob);
        if (r.hit) {
            ++swings;
            if (MobCombat* mc = reg.try_get<MobCombat>(s.mob))
                mc->cooldownMs = s.cd;
        }
        // Once the victim is down the rest of the queue has nothing to touch, and
        // apply_damage would no-op on it anyway — it refuses a target already Dead.
        // Projectiles already launched still fly; that is correct.
        if (r.lethal) break;
    }
    (void)bus;
    (void)tick;
    return swings;
}

ItemId equipped_melee(const Inventory& inv) {
    ItemId best = kInvalidItem;
    std::uint16_t bestDmg = 0;
    for (const ItemSlot& s : inv.slots) {
        if (s.item == kInvalidItem || s.count == 0) continue;
        const MeleeDef* m = melee_for_item(s.item);
        if (!m) continue;
        if (m->dmg > bestDmg) { bestDmg = m->dmg; best = s.item; }
    }
    return best;
}

ItemId equipped_armour(const Inventory& inv) {
    ItemId best = kInvalidItem;
    int bestSum = 0;
    for (const ItemSlot& s : inv.slots) {
        if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item)) continue;
        const ItemDef& d = item_def(s.item);
        int sum = 0;
        for (std::size_t c = 0; c < kItemResistChannels; ++c) sum += d.resist[c];
        if (sum > bestSum) { bestSum = sum; best = s.item; }
    }
    return best;
}

void sync_armour(Registry& reg, NpcPool& pool, Entity e) {
    if (!reg.valid(e)) return;
    const NpcRef* n = reg.try_get<NpcRef>(e);
    if (!n || !pool.valid(n->id)) return;

    const ItemId worn = equipped_armour(pool.inventory(n->id));
    if (worn == kInvalidItem) {
        if (reg.all_of<Armour>(e)) reg.remove<Armour>(e);
        return;
    }
    const ItemDef& d = item_def(worn);
    Armour a{};
    for (std::size_t c = 0; c < kDamageChannels; ++c)
        a.resist[c] = d.resist[c];
    reg.emplace_or_replace<Armour>(e, a);
}

namespace {

// Launch a shot from `from` toward `to`.
//
// Aimed with a gravity-compensated lob, which is the most important asymmetry in
// the whole model: fired level from chest height a projectile reaches the floor in
// well under a second, so a flat shot is short whatever its muzzle speed. Distance
// has to be bought with arc. The vertical rate below is the one that lands the shot
// at the target's height after dist/speed seconds.
void spawn_projectile(Registry& reg, LayerId layer, const vec3& from,
                      const vec3& to, std::int16_t dmg,
                      std::uint16_t projSpeedMmps, Entity source) {
    // Table speed is cells/s in fixed point; a cell is kCellSize metres.
    float speed = static_cast<float>(projSpeedMmps) * 0.001f * kCellSize;
    if (speed < 1.0f) speed = 12.0f;   // a ranged kind with no authored speed

    const float dx = wrap_delta_f(from.x, to.x, kWorldExtent);
    const float dy = wrap_delta_f(from.y, to.y, kWorldExtent);
    const float dz = wrap_delta_f(from.z, to.z, kWorldExtent);
    const float flat = std::sqrt(dx * dx + dy * dy);
    if (flat < 1e-3f) return;

    const float tof = flat / speed;                   // time of flight
    const float vz = dz / tof + 0.5f * kProjGravity * tof;

    Entity e = reg.create();
    Transform tr;
    tr.pos = from;
    tr.pos.z += 0.6f;        // leaves from chest height, not from the feet
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(
        e, Velocity{vec3{dx / flat * speed, dy / flat * speed, vz}});
    reg.emplace<AABB>(e, AABB{vec3{0.10f, 0.10f, 0.10f}});
    // Hot white-yellow: a shot must read against both the monster palette (the red
    // axis) and the faction one, so it is brighter than anything else in the frame.
    reg.emplace<Renderable>(e, Renderable{vec3{1.00f, 0.95f, 0.70f}});
    reg.emplace<Projectile>(e, Projectile{source, dmg, kProjTtlMs});
}

} // namespace

std::uint32_t projectile_step(Registry& reg, NpcPool& pool, EventBus& bus,
                              const LevelStack& stack, LayerId layer, float dt,
                              std::uint64_t tick) {
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
    struct Hit { Entity proj; std::int16_t dmg; Entity source; bool onVictim; };
    std::vector<Hit> resolved;

    for (auto e : reg.view<Projectile, Transform, Velocity>()) {
        Transform& tr = reg.get<Transform>(e);
        if (tr.layer != layer) continue;
        Projectile& p = reg.get<Projectile>(e);
        Velocity& v = reg.get<Velocity>(e);

        if (p.ttlMs > elapsedMs)
            p.ttlMs = static_cast<std::uint16_t>(p.ttlMs - elapsedMs);
        else
            p.ttlMs = 0;

        v.v.z -= kProjGravity * dt;
        tr.pos.x = wrapf(tr.pos.x + v.v.x * dt, kWorldExtent);
        tr.pos.y = wrapf(tr.pos.y + v.v.y * dt, kWorldExtent);
        tr.pos.z += v.v.z * dt;

        if (p.ttlMs == 0) {
            resolved.push_back(Hit{e, 0, p.source, false});
            continue;
        }

        if (victim != entt::null) {
            const float hx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
            const float hy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
            const float hz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
            if (hx * hx + hy * hy + hz * hz <= kProjHitRadius * kProjHitRadius) {
                resolved.push_back(Hit{e, p.dmg, p.source, true});
                continue;
            }
        }

        // Solid geometry stops it. Cell-level rather than sub-voxel on purpose: a
        // shot clipping the corner of a wall should stop, and the sub-voxel mask
        // would let it slip through a half-carved cell that reads as solid.
        const int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
        const int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
        const int cz = static_cast<int>(tr.pos.z / kCellSize);
        if (cz < 0 || cz >= kMacroDim ||
            grid.cell(cx, cy, wrap_macro(cz)) != kCellAir)
            resolved.push_back(Hit{e, 0, p.source, false});
    }

    std::uint32_t hits = 0;
    for (const Hit& h : resolved) {
        if (h.onVictim && victim != entt::null) {
            DamageResult r = apply_damage(reg, pool, victim, h.dmg,
                                          DamageChannel::Kinetic, h.source);
            if (r.hit) ++hits;
        }
        if (reg.valid(h.proj)) reg.destroy(h.proj);
    }
    (void)bus;
    (void)tick;
    return hits;
}

bool player_melee_step(Registry& reg, NpcPool& pool, EventBus& bus, LayerId layer,
                       float dt, bool wantsAttack, std::uint64_t tick) {
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
    const MeleeDef* wp = &unarmed_melee();
    if (const NpcRef* n = reg.try_get<NpcRef>(self))
        if (pool.valid(n->id)) {
            const ItemId held = equipped_melee(pool.inventory(n->id));
            if (const MeleeDef* m = melee_for_item(held)) wp = m;
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
    if (best == entt::null) return false;

    // Same damage path, same Dead tag, same finalizer as a mob's swing. There is
    // deliberately no second way for something to die.
    DamageResult r = apply_damage(reg, pool, best,
                                  static_cast<std::int16_t>(wp->dmg),
                                  DamageChannel::Kinetic, self);
    pm.cooldownMs = wp->cooldownMs;
    if (r.lethal) ++pm.kills;
    (void)bus;
    (void)tick;
    return r.hit;
}

} // namespace giga::game
