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

std::uint32_t mob_melee_step(Registry& reg, NpcPool& pool, EventBus& bus,
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

    std::uint32_t swings = 0;
    for (auto e : reg.view<const MobRef, const Transform, MobCombat>()) {
        MobCombat& mc = reg.get<MobCombat>(e);

        // THE single cooldown decrement. Every mob, every tick, exactly once —
        // whether or not it is in reach, whether or not there is a target.
        if (mc.cooldownMs > elapsedMs) mc.cooldownMs =
            static_cast<std::uint16_t>(mc.cooldownMs - elapsedMs);
        else mc.cooldownMs = 0;

        if (victim == entt::null) continue;
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (mc.cooldownMs > 0) continue;

        const MobRef& mr = reg.get<const MobRef>(e);
        const MobDef& def = kMobTable[mr.kind];
        if (def.dmg == 0) continue;  // PAUPSINA and friends do not hit

        // Reach is authored in cells; distances are toroidal.
        const float reach = static_cast<float>(def.meleeReachMm) * 0.001f * kCellSize;
        const float dx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
        const float dy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
        const float dz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;

        // Damage scales with the mob's level on the same curve as its HP, so a
        // deep-floor elite hits as hard as it is tough.
        const std::int16_t raw = static_cast<std::int16_t>(
            mob_hp_at_level(def.dmg, mr.level));
        DamageResult r = apply_damage(reg, pool, victim, raw,
                                      DamageChannel::Kinetic, e);
        if (r.hit) {
            ++swings;
            mc.cooldownMs = def.attackCdMs;
        }
        if (r.lethal) break;  // nothing left to hit this tick
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
