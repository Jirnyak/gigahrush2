#include "game/loot.h"

#include <vector>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/combat.h"   // Dead, MobRef window
#include "game/embody.h"
#include "game/mob_spawn.h"  // MobRef
#include "game/mob_table.h"
#include "world/types.h"

namespace giga::game {

namespace {

std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// A dropped item is a small box on the ground. Bright warm gold: it must be
// findable in a headlamp cone, and it must not collide with either the faction
// palette (green-teal/blue/violet/cyan/amber) or the monster one (the red axis).
// Gold sits between amber and white, brighter than any body.
constexpr vec3 kPickupColor{1.00f, 0.86f, 0.42f};
constexpr vec3 kPickupHalf{0.16f, 0.16f, 0.16f};

// Drops per tier. Trash mobs mostly leave nothing; a boss is worth the fight.
std::uint32_t rolls_for_tier(std::uint8_t tier) {
    switch (static_cast<MobTier>(tier)) {
        case MobTier::Trash:  return 1;   // ...and usually fails the odds below
        case MobTier::Light:  return 1;
        case MobTier::Medium: return 2;
        case MobTier::Heavy:  return 2;
        case MobTier::Elite:  return 3;
        case MobTier::Boss:   return 5;
        default:              return 1;
    }
}

// Percent chance each roll produces anything. Keeps a corridor of dead Sborka from
// carpeting the floor in gold while a real kill still feels paid.
std::uint32_t drop_chance_for_tier(std::uint8_t tier) {
    switch (static_cast<MobTier>(tier)) {
        case MobTier::Trash:  return 12;
        case MobTier::Light:  return 25;
        case MobTier::Medium: return 45;
        case MobTier::Heavy:  return 65;
        case MobTier::Elite:  return 85;
        case MobTier::Boss:   return 100;
        default:              return 20;
    }
}

} // namespace

std::int32_t inventory_value(const Inventory& inv) {
    std::int32_t total = 0;
    for (const ItemSlot& s : inv.slots) {
        if (s.item == kInvalidItem || !item_valid(s.item)) continue;
        total += item_def(s.item).value * static_cast<std::int32_t>(s.count);
    }
    return total;
}

std::uint32_t drop_mob_loot(Registry& reg, LayerId layer, const vec3& pos,
                            std::uint8_t mobKind, std::uint8_t mobTier,
                            int floorNumber, std::uint32_t seed) {
    (void)mobKind;  // per-kind loot tables do not exist in the reference (66/69)

    const std::uint32_t rolls = rolls_for_tier(mobTier);
    const std::uint32_t chance = drop_chance_for_tier(mobTier);

    // Build the floor's droppable set once per corpse. Room mask 0 = "anywhere",
    // because a monster carries what it carries regardless of which room it died in.
    // Cumulative weights, so the pick is one scan.
    std::vector<ItemId> pool;
    std::vector<std::uint32_t> cum;
    std::uint32_t total = 0;
    pool.reserve(64);
    cum.reserve(64);
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        const std::uint32_t w = item_weight_on_floor(id, floorNumber, 0);
        if (w == 0) continue;
        total += w;
        pool.push_back(id);
        cum.push_back(total);
    }
    if (total == 0) return 0;

    std::uint32_t made = 0;
    for (std::uint32_t r = 0; r < rolls; ++r) {
        std::uint32_t h = mix(seed ^ (r * 0x9e3779b9u));
        if ((h % 100u) >= chance) continue;

        const std::uint32_t pick = mix(h) % total;
        std::size_t k = 0;
        while (k + 1 < pool.size() && pick >= cum[k]) ++k;
        const ItemId id = pool[k];

        // Scatter slightly so multiple drops from one corpse are separately
        // visible rather than one box hiding the others.
        const std::uint32_t j = mix(h ^ 0x51ed270bu);
        const float ox = (static_cast<float>(j & 0xFFu) / 255.0f - 0.5f) * 1.2f;
        const float oy = (static_cast<float>((j >> 8) & 0xFFu) / 255.0f - 0.5f) * 1.2f;

        Entity e = reg.create();
        Transform tr;
        tr.pos = vec3{pos.x + ox, pos.y + oy, pos.z};
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<Velocity>(e);
        reg.emplace<AABB>(e, AABB{kPickupHalf});
        reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
        reg.emplace<Renderable>(e, Renderable{kPickupColor});
        reg.emplace<Pickup>(e, Pickup{id, 1});
        ++made;
    }
    return made;
}

std::uint32_t loot_dead_mobs(Registry& reg, LayerId layer, int floorNumber,
                             std::uint32_t seed) {
    // Every mob that is dead but not yet finalized. Snapshot first: drop_mob_loot
    // creates entities, which would invalidate a live view.
    struct Corpse { vec3 pos; std::uint8_t kind, tier; std::uint32_t key; };
    std::vector<Corpse> corpses;
    for (auto e : reg.view<const Dead, const MobRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const MobRef& m = reg.get<const MobRef>(e);
        corpses.push_back(Corpse{tr.pos, m.kind, kMobTable[m.kind].tier,
                                 static_cast<std::uint32_t>(entt::to_integral(e))});
    }

    std::uint32_t made = 0;
    for (const Corpse& c : corpses)
        made += drop_mob_loot(reg, layer, c.pos, c.kind, c.tier, floorNumber,
                              seed ^ c.key);
    return made;
}

std::int32_t pickup_step(Registry& reg, NpcPool& pool, EventBus& bus, LayerId layer,
                         std::uint64_t tick) {
    Entity self = entt::null;
    vec3 me{0, 0, 0};
    NpcId selfId = kInvalidNpc;
    for (auto e : reg.view<const CameraTag, const Transform, const NpcRef>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        self = e;
        me = tr.pos;
        selfId = reg.get<const NpcRef>(e).id;
        break;
    }
    if (self == entt::null || !pool.valid(selfId)) return 0;

    Inventory& inv = pool.inventory(selfId);
    std::int32_t gained = 0;

    // Collect first, then destroy: mutating while iterating a view invalidates it.
    std::vector<Entity> taken;
    for (auto e : reg.view<const Pickup, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const float dx = wrap_delta_f(me.x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(me.y, tr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(me.z, tr.pos.z, kWorldExtent);
        if (dx * dx + dy * dy + dz * dz > kPickupReach * kPickupReach) continue;

        const Pickup& p = reg.get<const Pickup>(e);
        if (!item_valid(p.item)) { taken.push_back(e); continue; }
        const ItemDef& def = item_def(p.item);

        // Stack into an existing slot where the item allows it, else take a free
        // one. A full inventory simply leaves the item on the floor — no silent
        // discard, which is what makes 64 slots a real constraint.
        int slot = -1;
        if (def.stackMax > 1) {
            for (int i = 0; i < kInvSlots; ++i)
                if (inv.slots[i].item == p.item &&
                    inv.slots[i].count < def.stackMax) { slot = i; break; }
        }
        if (slot < 0) slot = inv.first_free();
        if (slot < 0) continue;  // full: it stays where it is

        if (inv.slots[slot].item == p.item) {
            inv.slots[slot].count =
                static_cast<std::uint16_t>(inv.slots[slot].count + p.count);
        } else {
            inv.slots[slot].item = p.item;
            inv.slots[slot].count = p.count;
        }
        gained += def.value * static_cast<std::int32_t>(p.count);

        // `a` = from (the world, kInvalidNpc), `b` = to, `c` = item id.
        bus.publish(EventType::ItemTransferred, kInvalidNpc, selfId, p.item, tick);
        taken.push_back(e);
    }
    for (Entity e : taken) reg.destroy(e);
    return gained;
}

std::int16_t use_best_heal(Registry& reg, NpcPool& pool, EventBus& bus,
                           LayerId layer, std::uint64_t tick) {
    Entity self = entt::null;
    NpcId selfId = kInvalidNpc;
    for (auto e : reg.view<const CameraTag, const Transform, const NpcRef>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        self = e;
        selfId = reg.get<const NpcRef>(e).id;
        break;
    }
    if (self == entt::null || !pool.valid(selfId)) return 0;

    const std::int16_t hp = pool.hp(selfId);
    const std::int16_t maxHp = pool.max_hp(selfId);
    const std::int16_t missing = static_cast<std::int16_t>(maxHp - hp);
    if (missing <= 0) return 0;   // nothing to heal; do not burn a bandage

    Inventory& inv = pool.inventory(selfId);

    // Smallest heal that still covers the wound, else the largest we have. So a
    // full medkit is not spent on a scratch, and a scratch's worth of bandage is
    // not withheld when it is all there is.
    int best = -1;
    std::int16_t bestAmt = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item)) continue;
        const ItemDef& d = item_def(s.item);
        if (d.useEffect != static_cast<std::uint8_t>(UseEffect::Heal)) continue;
        const std::int16_t amt = static_cast<std::int16_t>(d.useA);
        if (amt <= 0) continue;

        if (best < 0) { best = i; bestAmt = amt; continue; }
        const bool bestCovers = bestAmt >= missing;
        const bool thisCovers = amt >= missing;
        if (thisCovers && (!bestCovers || amt < bestAmt)) { best = i; bestAmt = amt; }
        else if (!thisCovers && !bestCovers && amt > bestAmt) { best = i; bestAmt = amt; }
    }
    if (best < 0) return 0;

    const std::int16_t healed =
        bestAmt < missing ? bestAmt : missing;   // report what landed, not the label
    pool.hp(selfId) = static_cast<std::int16_t>(hp + healed);

    const ItemId used = inv.slots[best].item;
    if (--inv.slots[best].count == 0) inv.slots[best] = ItemSlot{};
    bus.publish(EventType::ItemTransferred, selfId, kInvalidNpc, used, tick);
    return healed;
}

} // namespace giga::game
