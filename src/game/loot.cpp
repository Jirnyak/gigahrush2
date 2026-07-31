#include "game/loot.h"

#include <vector>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/combat.h"   // Dead, MobRef window
#include "game/embody.h"
#include "game/loot_table.h"  // roll_kind_drop — the per-kind identity half of a roll
#include "game/mob_spawn.h"  // MobRef
#include "game/mob_table.h"
#include "game/ranged_table.h"
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

// Ammo count bundled with a firearm — same rule as drop_weapon_ammo, pure data.
// Returns 0 if weapon is not ranged.
std::uint16_t weapon_ammo_count(ItemId weapon, std::uint32_t seed) {
    const RangedDef* def = ranged_for_item(weapon);
    if (!def) return 0;
    const std::uint32_t h = mix(seed ^ 0xA11A3300u);
    std::uint16_t count;
    if (def->pellets > 1)
        count = static_cast<std::uint16_t>(4u + (h % 8u));
    else {
        const std::uint16_t base = def->magazine > 10 ? def->magazine : 10;
        count = static_cast<std::uint16_t>(base + (h % 20u));
    }
    const std::uint8_t cap = item_def(def->ammo).stackMax;
    if (cap && count > cap) count = cap;
    return count;
}

// Append one ItemSlot into a fixed POD buffer. Returns false if full.
bool push_slot(ItemSlot* out, std::uint8_t cap, std::uint8_t& n,
               ItemId id, std::uint16_t count) {
    if (!out || n >= cap || id == kInvalidItem || count == 0) return false;
    if (count > 0xFFFFu) count = 0xFFFFu;
    out[n++] = ItemSlot{id, count};
    return true;
}

} // namespace

std::uint32_t roll_mob_loot_slots(std::uint8_t mobKind, std::uint8_t mobTier,
                                  int floorNumber, std::uint32_t seed,
                                  ItemSlot* outSlots, std::uint8_t outCap) {
    if (!outSlots || outCap == 0) return 0;

    const std::uint32_t rolls = rolls_for_tier(mobTier);
    const std::uint32_t chance = drop_chance_for_tier(mobTier);

    std::vector<ItemId> pool;
    std::vector<std::uint32_t> cum;
    std::uint32_t total = 0;
    bool poolBuilt = false;

    std::uint8_t filled = 0;
    for (std::uint32_t r = 0; r < rolls; ++r) {
        if (filled >= outCap) break;
        std::uint32_t h = mix(seed ^ (r * 0x9e3779b9u));
        if ((h % 100u) >= chance) continue;

        KindDrop kd = roll_kind_drop(mobKind, floorNumber, mix(h ^ 0x10071ee7u));
        if (kd.item == kInvalidItem) {
            if (!poolBuilt) {
                poolBuilt = true;
                pool.reserve(64);
                cum.reserve(64);
                for (std::size_t i = 0; i < kItemCount; ++i) {
                    const ItemId cid = static_cast<ItemId>(i + 1);
                    const std::uint32_t w = item_weight_on_floor(cid, floorNumber, 0);
                    if (w == 0) continue;
                    total += w;
                    pool.push_back(cid);
                    cum.push_back(total);
                }
            }
            if (total == 0) continue;
            const std::uint32_t pick = mix(h) % total;
            std::size_t k = 0;
            while (k + 1 < pool.size() && pick >= cum[k]) ++k;
            kd.item = pool[k];
            kd.count = 1;
        }
        const ItemId id = kd.item;
        const std::uint8_t cap = item_def(id).stackMax;
        if (kd.count < 1) kd.count = 1;
        if (cap && kd.count > cap) kd.count = cap;

        if (!push_slot(outSlots, outCap, filled, id,
                       static_cast<std::uint16_t>(kd.count)))
            break;

        // Firearm → append ammo ItemSlot (mirror drop_weapon_ammo), no floor entity.
        const std::uint32_t j = mix(h ^ 0x51ed270bu);
        if (const RangedDef* rdef = ranged_for_item(id)) {
            const std::uint16_t ac =
                weapon_ammo_count(id, seed ^ (j * 0x2545F491u));
            if (ac > 0)
                push_slot(outSlots, outCap, filled, rdef->ammo, ac);
        }
    }
    return filled;
}


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
    const std::uint32_t rolls = rolls_for_tier(mobTier);
    const std::uint32_t chance = drop_chance_for_tier(mobTier);

    // The floor's droppable set, the FALLBACK half of each roll. Room mask 0 =
    // "anywhere", because a monster carries what it carries regardless of which room it
    // died in. Cumulative weights, so the pick is one scan.
    //
    // **Built lazily, on the first roll the authored table does not answer.** Scanning
    // 446 rows through `item_weight_on_floor` (a divide + an `exp` past the band cap) is
    // the most expensive thing in this function, and a Trash corpse fails its single 12%
    // roll seven times out of eight — so on the common path it is now not built at all.
    std::vector<ItemId> pool;
    std::vector<std::uint32_t> cum;
    std::uint32_t total = 0;
    bool poolBuilt = false;

    std::uint32_t made = 0;
    for (std::uint32_t r = 0; r < rolls; ++r) {
        std::uint32_t h = mix(seed ^ (r * 0x9e3779b9u));
        if ((h % 100u) >= chance) continue;

        // ---- WHAT falls. The tier envelope above already decided HOW MUCH. -------
        // The mob's own authored row gets first refusal ([loot_table.h]): 136 reference
        // rows across all 69 kinds, so a dead Rebar leaves rebar and a dead Robot leaves
        // a circuit board instead of both drawing the same anonymous catalog sample.
        // A hit SUBSTITUTES for the catalog pick rather than adding to it, which is why
        // the per-kill item count — and therefore the whole economy — is unchanged.
        // A miss (and every kind at every depth can miss) falls through to the catalog,
        // exactly as every kind did before the table existed.
        KindDrop kd = roll_kind_drop(mobKind, floorNumber, mix(h ^ 0x10071ee7u));
        if (kd.item == kInvalidItem) {
            if (!poolBuilt) {
                poolBuilt = true;
                pool.reserve(64);
                cum.reserve(64);
                for (std::size_t i = 0; i < kItemCount; ++i) {
                    const ItemId cid = static_cast<ItemId>(i + 1);
                    const std::uint32_t w = item_weight_on_floor(cid, floorNumber, 0);
                    if (w == 0) continue;
                    total += w;
                    pool.push_back(cid);
                    cum.push_back(total);
                }
            }
            if (total == 0) continue;   // nothing legal on this floor; the roll is void
            const std::uint32_t pick = mix(h) % total;
            std::size_t k = 0;
            while (k + 1 < pool.size() && pick >= cum[k]) ++k;
            kd.item = pool[k];
            kd.count = 1;
        }
        const ItemId id = kd.item;

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
        // Never over the item's own stack cap: a single pickup carrying more than an
        // inventory slot may legally hold is silently truncated by pickup_step. The
        // authored counts are 1..2 and every count-bearing row stacks well past that, so
        // this is the rule stated rather than a bug fixed.
        const std::uint8_t cap = item_def(id).stackMax;
        if (kd.count < 1) kd.count = 1;
        if (cap && kd.count > cap) kd.count = cap;
        reg.emplace<Pickup>(e, Pickup{id, kd.count});
        ++made;
        // A gun without bullets is a paperweight. Bundle its ammo at the moment it
        // drops, because the CATALOG roller cannot produce ammo any other way — all 17
        // AMMO rows have spawn weight 0. [loot.h drop_weapon_ammo]
        //
        // Runs on the authored item too, unconditionally, and that is deliberate rather
        // than sloppy: it is a no-op for every row the table can produce. Measured — the
        // five WEAPON-category authored items are rebar, pipe and the three psi clots, and
        // none of the five appears in `kRangedTable`, so `ranged_for_item` answers nullptr
        // for all of them. One call site covers both halves of the roll; a guard would
        // only encode which half we are in.
        made += drop_weapon_ammo(reg, layer, tr.pos, id, seed ^ (j * 0x2545F491u));
    }
    return made;
}

std::uint32_t drop_weapon_ammo(Registry& reg, LayerId layer, const vec3& pos,
                               ItemId weapon, std::uint32_t seed) {
    const RangedDef* def = ranged_for_item(weapon);
    if (!def) return 0;
    const std::uint32_t h = mix(seed ^ 0xA11A3300u);

    // Shotguns get shells by the handful; everything else gets at least a magazine
    // plus change, so the magazine size — not the item's rarity — decides the bundle.
    std::uint16_t count;
    if (def->pellets > 1)
        count = static_cast<std::uint16_t>(4u + (h % 8u));            // 4..11
    else {
        const std::uint16_t base = def->magazine > 10 ? def->magazine : 10;
        count = static_cast<std::uint16_t>(base + (h % 20u));         // base..base+19
    }
    // Never exceed the item's own stack cap, or a single pickup would carry more than
    // an inventory slot can legally hold and pickup_step would silently drop the rest.
    const std::uint8_t cap = item_def(def->ammo).stackMax;
    if (cap && count > cap) count = cap;

    Entity e = reg.create();
    Transform tr;
    // Beside the gun, not inside it: two pickups at the same point are one pickup you
    // can see.
    tr.pos = vec3{pos.x + 0.45f, pos.y - 0.35f, pos.z};
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{kPickupHalf});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
    reg.emplace<Renderable>(e, Renderable{kPickupColor});
    reg.emplace<Pickup>(e, Pickup{def->ammo, static_cast<std::uint8_t>(
                                                 count > 255 ? 255 : count)});
    return 1;
}

std::uint32_t loot_dead_mobs(Registry& reg, LayerId layer, int floorNumber,
                             std::uint32_t seed) {
    // CORP1: stage loot onto the Dead entity as POD CorpseLootPending.
    // finalize_deaths moves it into Corpse.lootSlots. No floor Pickup spawn —
    // that was the double-drop defect (empty corpse + gold boxes on the floor).
    //
    // Snapshot entity ids first: emplace_or_replace can reallocate component
    // storage and invalidate a live view iterator.
    std::vector<Entity> dead;
    for (auto e : reg.view<const Dead, const MobRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        // Already staged this death window — do not re-roll.
        if (reg.all_of<CorpseLootPending>(e)) continue;
        dead.push_back(e);
    }

    std::uint32_t staged = 0;
    for (Entity e : dead) {
        if (!reg.valid(e) || !reg.all_of<MobRef>(e)) continue;
        const MobRef& m = reg.get<const MobRef>(e);
        const std::uint8_t tier = kMobTable[m.kind].tier;
        const std::uint32_t key =
            static_cast<std::uint32_t>(entt::to_integral(e));

        CorpseLootPending pending{};
        pending.slotCount = static_cast<std::uint8_t>(roll_mob_loot_slots(
            m.kind, tier, floorNumber, seed ^ key, pending.slots,
            static_cast<std::uint8_t>(kMaxCorpseSlots)));
        staged += pending.slotCount;
        reg.emplace_or_replace<CorpseLootPending>(e, pending);
    }
    return staged;
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
            // **Clamp to the item's own cap.** An audit put 7 of a cap-8 item in a slot,
            // dropped a stack of 8 on it, and pickup_step merged the lot into 15 — the
            // cap was consulted to CHOOSE the slot and then ignored when writing it. A
            // slot over cap is not a crash; it is an inventory that quietly holds more
            // than the rules allow, which is worse because nothing complains.
            if (def.stackMax && inv.slots[slot].count > def.stackMax)
                inv.slots[slot].count = def.stackMax;
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
    //
    // ONE KEY HERE, TWO IN `use_best_food` ([needs.h]) — do not "unify" them. That
    // rule ranks HP cost ahead of fit because 4 of the 21 feeding rows charge
    // `kRiskyFeedHpCost` = 6 HP, so ranking food on fit alone buys a tighter fit with
    // health. Healing has no such key to add: all 12 `Heal` rows in `data/items.csv`
    // leave `use_b` empty, so every candidate this loop can see is free. Copying the
    // cost key over would be dead code; copying THIS loop into a consumable selector
    // is how the defect got in.
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

CorpseLootResult loot_corpse_interact(Registry& reg, NpcPool& pool, EventBus& bus,
                                       LayerId layer, const vec3& playerPos,
                                       float maxReach, std::uint64_t tick) {
    CorpseLootResult res{};
    Entity targetCorpse = entt::null;
    float minDistSq = maxReach * maxReach;

    for (auto e : reg.view<const Corpse, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        float dx = wrap_delta_f(playerPos.x, tr.pos.x, kWorldExtent);
        float dy = playerPos.y - tr.pos.y;
        float dz = wrap_delta_f(playerPos.z, tr.pos.z, kWorldExtent);
        float distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < minDistSq) {
            minDistSq = distSq;
            targetCorpse = e;
        }
    }

    if (targetCorpse == entt::null) return res;
    res.foundCorpse = true;

    // Resolve the player BEFORE marking searched or touching slots. A missing
    // CameraTag/NpcRef must not brick the corpse (searched=true with loot still
    // inside) or destroy items the player never absorbed.
    Entity self = entt::null;
    NpcId selfId = kInvalidNpc;
    for (auto e : reg.view<const CameraTag, const Transform, const NpcRef>()) {
        if (reg.get<const Transform>(e).layer == layer) {
            self = e;
            selfId = reg.get<const NpcRef>(e).id;
            break;
        }
    }
    if (self == entt::null || !pool.valid(selfId)) return res;

    auto& corpse = reg.get<Corpse>(targetCorpse);
    // Player reached the body and is about to rifle it — mark searched even if
    // the inventory is full and nothing moves (they looked; loot stays for later).
    corpse.searched = true;

    Inventory& inv = pool.inventory(selfId);
    for (std::size_t i = 0; i < kMaxCorpseSlots; ++i) {
        ItemSlot& slotItem = corpse.lootSlots[i];
        if (!item_valid(slotItem.item) || slotItem.count == 0) continue;
        const ItemDef& def = item_def(slotItem.item);

        // Drain this corpse slot across as many inventory slots as needed.
        // Remainder stays on the corpse when the pack is full or a stack caps —
        // never clamp-and-discard (that was silent item loss).
        while (slotItem.count > 0 && item_valid(slotItem.item)) {
            int targetSlot = -1;
            if (def.stackMax > 1) {
                for (int s = 0; s < kInvSlots; ++s) {
                    if (inv.slots[s].item == slotItem.item &&
                        inv.slots[s].count < def.stackMax) {
                        targetSlot = s;
                        break;
                    }
                }
            }
            if (targetSlot < 0) targetSlot = inv.first_free();
            if (targetSlot < 0) break;  // inventory full: leave remainder on corpse

            std::uint16_t moved = 0;
            if (inv.slots[targetSlot].item == slotItem.item) {
                const std::uint16_t space = static_cast<std::uint16_t>(
                    def.stackMax > inv.slots[targetSlot].count
                        ? def.stackMax - inv.slots[targetSlot].count
                        : 0);
                if (space == 0) break;
                moved = slotItem.count < space ? slotItem.count : space;
                inv.slots[targetSlot].count = static_cast<std::uint16_t>(
                    inv.slots[targetSlot].count + moved);
            } else {
                // Fresh slot: take up to stackMax, leave the rest on the corpse.
                moved = slotItem.count;
                if (def.stackMax && moved > def.stackMax)
                    moved = def.stackMax;
                inv.slots[targetSlot].item = slotItem.item;
                inv.slots[targetSlot].count = moved;
            }

            slotItem.count = static_cast<std::uint16_t>(slotItem.count - moved);
            res.roublesGained += def.value * static_cast<std::int32_t>(moved);
            res.itemsTaken++;
            bus.publish(EventType::ItemTransferred, kInvalidNpc, selfId,
                        slotItem.item, tick);
            if (slotItem.count == 0) slotItem = {};
        }
    }

    // Keep slotCount honest: count filled slots after the drain pass.
    std::uint8_t filled = 0;
    for (std::size_t i = 0; i < kMaxCorpseSlots; ++i) {
        if (item_valid(corpse.lootSlots[i].item) && corpse.lootSlots[i].count > 0)
            ++filled;
    }
    corpse.slotCount = filled;

    return res;
}


} // namespace giga::game
