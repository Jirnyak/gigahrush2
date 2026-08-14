#include "game/needs.h"

#include <cmath>

#include "core/wrap.h"       // wrap_macro — the body's cell is a toroidal lookup
#include "ecs/components.h"
#include "game/embody.h"     // NpcRef
#include "game/equip.h"      // Equipped, equipped tools
#include "game/inventory.h"
#include "game/room_zone.h"  // room_bit_at / room_restores / room_recover
#include "game/rpg.h"        // RpgStats, max_psi
#include "game/status.h"     // status_water_drain_e3
#include "world/field.h"     // Field<float>
#include "world/types.h"     // kCellSize — pos -> macro cell, the one conversion

namespace giga::game {

namespace {

#include "core/rng.h"

// Uniform [0, 1) from a hash, using the top 24 bits — exactly a float's mantissa,
// so every representable step is reachable and none is reachable twice.
float u01(std::uint32_t h) {
    return static_cast<float>(h >> 8) * (1.0f / 16777216.0f);
}

float clamp_need(float v) {
    if (v < 0.0f) return 0.0f;
    if (v > kNeedMax) return kNeedMax;
    return v;
}

// Meter `rate` points out of a pending queue into a pressure bar. The amount that
// does not fit under the 100 cap is discarded, not held — matching the reference,
// where an overflowing bladder does not keep a backlog.
void digest(float& pending, float& actual, float rate) {
    if (pending <= 0.0f) return;
    const float moved = pending < rate ? pending : rate;
    pending -= moved;
    actual = clamp_need(actual + moved);
}

// Add to a reserve and report what fitted rather than what was offered. This is
// the whole "report what LANDED" rule in three lines.
float top_up(float& bar, float amount) {
    const float before = bar;
    bar = clamp_need(bar + amount);
    return bar - before;
}

// Resolve the camera holder on `layer` and its pool record.
//
// The view is opened and closed inside this helper, which is deliberate: callers
// go on to run `apply_damage`, and that can `emplace<Dead>` and reallocate the
// registry's storage — dangling any view still being iterated (the crash
// documented in `combat.cpp mob_attack_step`). Returning by value means there is
// no live view left to dangle.
struct PlayerRef {
    Entity entity = entt::null;
    NpcId id = kInvalidNpc;
};
PlayerRef find_player(Registry& reg, NpcPool& pool, LayerId layer) {
    PlayerRef out;
    auto view = reg.view<const CameraTag, const Transform, const NpcRef>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        out.entity = e;
        out.id = id;
        break;
    }
    return out;
}

// Which bar a consumable is bought for, so one selection routine serves both keys.
enum class Appetite : std::uint8_t { Food, Water };

// The restore magnitude a consumable advertises for `want`, or 0 if it does not
// serve that appetite at all. Reads `useA` from the table — no ids are hardcoded
// anywhere in this file, only `UseEffect` values.
float advertised(ItemId id, Appetite want) {
    if (!item_valid(id)) return 0.0f;
    const bool serves = want == Appetite::Food ? item_feeds(id) : item_hydrates(id);
    if (!serves) return 0.0f;
    const float a = static_cast<float>(item_def(id).useA);
    return a > 0.0f ? a : 0.0f;
}

// `use_best_heal`'s selection rule generalised over the bar being filled, plus one
// key it does not have: HP cost outranks fit. Full argument and numbers in
// [needs.h]; the short version is that ranking on fit alone forces the eat key onto
// experimental_concentrate at a 31-point deficit — 6 HP for 8 food points, 100 s of
// clock — and onto zhelemish_raw / infected_mushroom on a pure slot-index tie with
// rawmeat / soup_cube, where the tighter fit is worth exactly nothing.
ConsumeResult use_best_for(Registry& reg, NpcPool& pool, EventBus& bus,
                           LayerId layer, Appetite want, std::uint64_t tick) {
    ConsumeResult out;
    const PlayerRef me = find_player(reg, pool, layer);
    if (me.entity == entt::null) return out;

    Needs& n = pool.needs(me.id);
    if (n.seeded == 0) n = needs_roll(giga::hash_u32(me.id + 1u));

    const float bar = want == Appetite::Food ? n.food : n.water;
    const float missing = kNeedMax - bar;
    if (missing <= 0.0f) return out;   // full; do not burn a ration

    Inventory& inv = pool.inventory(me.id);
    int best = -1;
    float bestAmt = 0.0f;
    bool bestFree = false;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == kInvalidItem || s.count == 0) continue;
        const float amt = advertised(s.item, want);
        if (amt <= 0.0f) continue;
        // `noCost`, not `free`: a local named `free` hides ::free and MSVC /W4 reports
        // that as C4459 in a build that must stay warning-clean.
        const bool noCost = consumable_hp_cost(s.item) == 0;

        if (best < 0) { best = i; bestAmt = amt; bestFree = noCost; continue; }
        // PRIMARY KEY: a free candidate wins outright and a costly one cannot
        // displace it, so fit is only ever compared within one cost class.
        if (noCost != bestFree) {
            if (noCost) { best = i; bestAmt = amt; bestFree = true; }
            continue;
        }
        // SECONDARY KEY: smallest that covers, else largest. Strict comparisons, so
        // a tie in `amt` stays with the lower slot index.
        const bool bestCovers = bestAmt >= missing;
        const bool thisCovers = amt >= missing;
        if (thisCovers && (!bestCovers || amt < bestAmt)) { best = i; bestAmt = amt; }
        else if (!thisCovers && !bestCovers && amt > bestAmt) { best = i; bestAmt = amt; }
    }
    if (best < 0) return out;

    const ItemId used = inv.slots[best].item;
    out = apply_consumable(n, used, pool.hp(me.id), reg.try_get<RpgStats>(me.entity));
    if (!out.used) return out;

    if (--inv.slots[best].count == 0) inv.slots[best] = ItemSlot{};

    // The HP cost of questionable food goes through THE damage entry point like
    // everything else, on the channel armour cannot see — a vest does not settle
    // your stomach. `apply_consumable` already floored the cost at hp-1, so this
    // can never be lethal.
    if (out.hpCost > 0)
        apply_damage(reg, pool, me.entity, out.hpCost, kAttritionChannel,
                     entt::null);

    bus.publish(EventType::ItemTransferred, me.id, kInvalidNpc, used, tick);
    return out;
}

} // namespace

Needs needs_roll(std::uint32_t seed) {
    Needs n;
    n.food  = kStartFoodLo  + u01(giga::hash_u32(seed ^ 0x9e3779b9u)) * (kStartFoodHi  - kStartFoodLo);
    n.water = kStartWaterLo + u01(giga::hash_u32(seed ^ 0x85ebca6bu)) * (kStartWaterHi - kStartWaterLo);
    n.sleep = kStartSleepLo + u01(giga::hash_u32(seed ^ 0xc2b2ae35u)) * (kStartSleepHi - kStartSleepLo);
    n.pee   = kStartPeeLo   + u01(giga::hash_u32(seed ^ 0x27d4eb2fu)) * (kStartPeeHi   - kStartPeeLo);
    n.poo   = kStartPooLo   + u01(giga::hash_u32(seed ^ 0x165667b1u)) * (kStartPooHi   - kStartPooLo);
    n.pendingPee = 0.0f;
    n.pendingPoo = 0.0f;
    n.hpDebt = 0.0f;
    n.seeded = 1;
    return n;
}

Needs needs_roll_resident(std::uint32_t seed) {
    Needs n = needs_roll(seed);
    // Built by RUNNING the real clock rather than by inventing a second set of
    // bands: a resident's state is then always a state the ordinary clock could
    // have produced, and retuning any drain moves the residents with it for free.
    // Its own hash stream, so the phase is uncorrelated with the five bar rolls.
    const float phase =
        u01(giga::hash_u32(seed ^ 0xd4ec1e5eu)) * kResidentPhaseMaxSec;
    needs_advance(n, phase);
    return n;
}

void needs_advance(Needs& n, float dt) {
    if (dt <= 0.0f) return;
    n.food  = clamp_need(n.food  - kFoodDrainPerSec  * dt);
    n.water = clamp_need(n.water - kWaterDrainPerSec * dt);
    n.sleep = clamp_need(n.sleep - kSleepDrainPerSec * dt);
    digest(n.pendingPee, n.pee, kPeeDigestPerSec * dt);
    digest(n.pendingPoo, n.poo, kPooDigestPerSec * dt);
}

std::uint8_t needs_failed_mask(const Needs& n) {
    std::uint8_t m = 0;
    if (n.food  <= 0.0f)     m |= NeedFood;
    if (n.water <= 0.0f)     m |= NeedWater;
    if (n.sleep <= 0.0f)     m |= NeedSleep;   // reported, but costs 0 HP/s
    if (n.pee   >= kNeedMax) m |= NeedPee;
    if (n.poo   >= kNeedMax) m |= NeedPoo;
    return m;
}

std::uint8_t needs_warn_mask(const Needs& n) {
    std::uint8_t m = 0;
    if (n.food  < kFoodWarnAt)  m |= NeedFood;
    if (n.water < kWaterWarnAt) m |= NeedWater;
    if (n.sleep < kSleepWarnAt) m |= NeedSleep;
    if (n.pee   > kPeeWarnAt)   m |= NeedPee;
    if (n.poo   > kPooWarnAt)   m |= NeedPoo;
    return m;
}

float needs_hp_rate(const Needs& n) {
    // Additive across every failed need, capped by nothing: four at once is
    // 1.0 HP/s. Sleep is absent on purpose — see the header.
    const std::uint8_t f = needs_failed_mask(n);
    float rate = 0.0f;
    if (f & NeedFood)  rate += kHungerHpPerSec;
    if (f & NeedWater) rate += kDehydrationHpPerSec;
    if (f & NeedPee)   rate += kOverflowHpPerSec;
    if (f & NeedPoo)   rate += kOverflowHpPerSec;
    return rate;
}

float needs_seconds_to_damage(const Needs& n) {
    if (needs_hp_rate(n) > 0.0f) return 0.0f;

    float soonest = n.food / kFoodDrainPerSec;
    const float water = n.water / kWaterDrainPerSec;
    if (water < soonest) soonest = water;

    // A pressure only ticks toward overflow while its queue has something left,
    // so an empty queue is not a clock at all.
    if (n.pendingPee > 0.0f) {
        const float t = (kNeedMax - n.pee) / kPeeDigestPerSec;
        if (t < soonest) soonest = t;
    }
    if (n.pendingPoo > 0.0f) {
        const float t = (kNeedMax - n.poo) / kPooDigestPerSec;
        if (t < soonest) soonest = t;
    }
    return soonest;
}

float needs_speed_scale(const Needs& n) {
    float scale = 1.0f;
    if (n.sleep < kSleepExhaustedAt) scale *= kSleepExhaustedSpeedScale; // 0.5f exhaustion penalty
    if (n.food <= 0.0f)              scale *= 0.75f; // 25% starvation penalty
    if (n.water <= 0.0f)             scale *= 0.65f; // 35% dehydration penalty
    return scale;
}

NeedsTick needs_step(Registry& reg, NpcPool& pool, LayerId layer, float dt,
                     const RoomZones* rooms, AiMemory* mem, double now,
                     const StatusSet* playerStatus,
                     const Field<float>* gasField) {
    NeedsTick out;
    if (dt <= 0.0f) return out;

    // ONE SWEEP over the embodied bodies of this layer, camera holder included as an
    // ordinary row. There is no player branch in the loop — only a per-body question
    // ("does this entity hold CameraTag") that decides which seed roll it gets and
    // whose numbers land in the report ([jirnyak.md] §9: key on the component, never
    // on an identity).
    //
    // ITERATING WHILE DAMAGING IS SAFE HERE, and it is checked rather than assumed:
    // `apply_damage` ([combat.cpp]) writes hp, may write Velocity, and creates NO
    // component — `Dead` is emplaced by `finalize_deaths`, one pass later, which is
    // precisely the single-death-point contract [combat.h] describes. So no storage
    // can grow under this view. An earlier revision of this file buffered the player
    // through `find_player` for fear of that, and the fear was of the wrong function.
    auto view = reg.view<const NpcRef, const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;

        const bool camera = reg.all_of<CameraTag>(e);
        Needs& n = pool.needs(id);
        // Lazy roll, the way `player_melee_step` attaches PlayerMelee lazily: no
        // spawn path, elevator or possession has to remember to seed the clock.
        // Seeded from the record id, so the same body is the same body across a
        // reload — and a RESIDENT is seeded at its own point of the day, so a floor
        // is not 419 people who all ate breakfast on the same frame.
        if (n.seeded == 0) {
            const std::uint32_t seed = giga::hash_u32(id + 1u);
            n = camera ? needs_roll(seed) : needs_roll_resident(seed);
        }

        needs_advance(n, dt);
        if (camera && playerStatus) {
            const float extraDrain =
                static_cast<float>(status_water_drain_e3(*playerStatus)) * 0.001f * dt;
            if (extraDrain > 0.0f) {
                n.water = clamp_need(n.water - extraDrain);
            }
        }
        ++out.bodies;

        // AMBIENT RECOVERY — the other half of the widened scope. Standing in a
        // kitchen fills you and queues the digestion that later sends you to a
        // bathroom; a corridor does nothing, at the cost of one table read.
        if (rooms != nullptr) {
            const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
            const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
            const std::uint16_t bit = room_bit_at(rooms->kind, rooms->number, cx, cy);
            if (room_restores(bit)) {
                const int stride = floor_room_stride(rooms->kind);
                const int rx = cx / stride;
                const int ry = cy / stride;
                const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));
                room_recover(n, bit, dt, mem, id, cx, cy, cz, now,
                             pool.max_hp(id),
                             &rooms->stock, rx, ry, stride);
                ++out.recovering;
            }
        }

        // GAS / SMOKE SUFFOCATION HAZARD (Spec 02 §4 & Spec 03 §4)
        if (gasField != nullptr) {
            const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
            const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
            const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));
            const float gasConcentration = gasField->at(cx, cy, cz);
            if (gasConcentration > 0.01f) {
                // Check if equipped with working filter (Fouling wear kind with condition > 0)
                bool protectedByFilter = false;
                if (const Equipped* eq = reg.try_get<Equipped>(e)) {
                    if (eq->tool != kEquipNone && eq->tool < kInvSlots) {
                        const Inventory& inv = pool.inventory(id);
                        const ItemSlot& slot = inv.slots[eq->tool];
                        if (item_valid(slot.item) && slot.condition > 0) {
                            const ItemDef& idef = item_def(slot.item);
                            if (idef.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
                                protectedByFilter = true;
                            }
                        }
                    }
                }
                if (!protectedByFilter) {
                    const float suffocationRate = gasConcentration * 0.8f;
                    n.hpDebt += suffocationRate * dt;
                }
            }
        }

        // HEAL BANK SPILL — the mirror of the hpDebt drain below, and deliberately
        // NOT behind that section's `rate <= 0` early-out: a body healing in a
        // Medical room usually has no failed need at all, and gating the spill on
        // starvation would make the ward heal only the starving. Whole HP moves,
        // the fraction stays banked. NOT routed through apply_damage: healing is
        // not a damage channel and must not wake armour or knockback.
        if (n.hpBank >= 1.0f) {
            const float whole = std::floor(n.hpBank);
            n.hpBank -= whole;
            std::int16_t& hp = pool.hp(id);
            const std::int16_t maxHp = pool.max_hp(id);
            const float room = static_cast<float>(maxHp - hp);
            const std::int16_t gain =
                static_cast<std::int16_t>(whole < room ? whole : room);
            if (gain > 0) {
                hp = static_cast<std::int16_t>(hp + gain);
            }
        }

        if (camera) {
            out.ticked = true;
            out.failed = needs_failed_mask(n);
            out.warned = needs_warn_mask(n);
            out.speedScale = needs_speed_scale(n);
            out.secondsToDamage = needs_seconds_to_damage(n);
        }

        const float rate = needs_hp_rate(n);
        if (rate > 0.0f) {
            n.hpDebt += rate * dt;
        }
        if (n.hpDebt < 1.0f) continue;

        // HP is an integer and the slowest drain is 0.1 HP/s, which at the 125 Hz sim
        // step is 0.00083 HP — truncating that to an int every step would make
        // starvation cost exactly nothing, forever. So the fraction is BANKED in the
        // row and only whole HP is ever spent. The debt is deliberately not forgiven
        // when a need is topped back up: unpaid damage is still owed.
        float whole = std::floor(n.hpDebt);
        n.hpDebt -= whole;
        if (whole > 32767.0f) whole = 32767.0f; // a catch-up dt cannot overflow int16

        const DamageResult r = apply_damage(reg, pool, e,
                                            static_cast<std::int16_t>(whole),
                                            kAttritionChannel, entt::null);
        if (camera) {
            out.hpLost = r.applied;
            out.lethal = r.lethal;
        } else if (r.lethal) {
            ++out.crowdKilled;
        }
    }
    return out;
}

bool item_feeds(ItemId id) {
    if (!item_valid(id)) return false;
    switch (static_cast<UseEffect>(item_def(id).useEffect)) {
        case UseEffect::Feed:
        case UseEffect::FeedRisky:
        case UseEffect::FeedPsi:
            return true;
        default:
            return false;
    }
}

bool item_hydrates(ItemId id) {
    if (!item_valid(id)) return false;
    switch (static_cast<UseEffect>(item_def(id).useEffect)) {
        case UseEffect::Drink:
        case UseEffect::DrinkStim:
            return true;
        default:
            return false;
    }
}

bool item_restores_psi(ItemId id) {
    if (!item_valid(id)) return false;
    switch (static_cast<UseEffect>(item_def(id).useEffect)) {
        case UseEffect::HealPsi:
        case UseEffect::FeedPsi:
            return true;
        default:
            return false;
    }
}

std::int16_t consumable_hp_cost(ItemId id) {
    if (!item_valid(id)) return 0;
    switch (static_cast<UseEffect>(item_def(id).useEffect)) {
        case UseEffect::FeedRisky:     return kRiskyFeedHpCost;
        case UseEffect::SleepingPills: return kSleepingPillsHpCost;
        default:                       return 0;
    }
}

ConsumeResult apply_consumable(Needs& n, ItemId item, std::int16_t hp,
                              RpgStats* rpg) {
    ConsumeResult out;
    if (!item_valid(item)) return out;

    const UseEffect eff = static_cast<UseEffect>(item_def(item).useEffect);
    const float a = static_cast<float>(item_def(item).useA);
    if (a <= 0.0f) return out;   // nothing to give; `used` stays false

    float pooShare = 0.0f;
    float peeShare = 0.0f;
    // ONE source for the cost, because `use_best_for` now ranks on it: a switch here
    // and a second switch there would drift, and the drift would be invisible —
    // selection would keep calling a row free while eating it charged 6 HP.
    const std::int16_t cost = consumable_hp_cost(item);

    switch (eff) {
        case UseEffect::Feed:
            out.food = top_up(n.food, a);
            pooShare = kFeedPooShare;
            peeShare = kFeedPeeShare;
            break;

        case UseEffect::FeedPsi:
            out.food = top_up(n.food, a);
            pooShare = kFeedPooShare;
            peeShare = kFeedPeeShare;
            if (rpg) {
                const std::uint16_t mx = max_psi(*rpg);
                const std::uint16_t cur = rpg->psi;
                const std::uint16_t gain = static_cast<std::uint16_t>(a * 0.5f);
                rpg->psi = static_cast<std::uint16_t>(std::min<std::uint32_t>(mx, cur + gain));
                out.psi = static_cast<std::uint16_t>(rpg->psi - cur);
            }
            break;

        case UseEffect::HealPsi:
            if (rpg) {
                const std::uint16_t mx = max_psi(*rpg);
                const std::uint16_t cur = rpg->psi;
                const std::uint16_t gain = static_cast<std::uint16_t>(a);
                rpg->psi = static_cast<std::uint16_t>(std::min<std::uint32_t>(mx, cur + gain));
                out.psi = static_cast<std::uint16_t>(rpg->psi - cur);
            }
            break;

        case UseEffect::FeedRisky:
            out.food = top_up(n.food, a);
            pooShare = kRiskyPooShare;
            peeShare = kRiskyPeeShare;
            break;

        case UseEffect::Drink:
            out.water = top_up(n.water, a);
            peeShare = kDrinkPeeShare;
            break;

        case UseEffect::DrinkStim:
            out.water = top_up(n.water, a);
            out.sleep = top_up(n.sleep, kDrinkStimSleepBonus);
            peeShare = kDrinkPeeShare;
            break;

        case UseEffect::SleepingPills:
            // The one item that restores sleep, and it charges for it in the other
            // three bars. Not a food or a drink: `item_feeds`/`item_hydrates` both
            // reject it, so `use_best_food`/`use_best_drink` will never reach for it.
            out.sleep = top_up(n.sleep, a);
            n.water = clamp_need(n.water - kSleepingPillsWaterCost);
            n.food  = clamp_need(n.food  - kSleepingPillsFoodCost);
            break;

        default:
            return out;   // not a needs consumable at all
    }

    // Pressure is queued from the LABEL, not from what fitted — see the header.
    out.pooQueued = a * pooShare;
    out.peeQueued = a * peeShare;
    n.pendingPoo += out.pooQueued;
    n.pendingPee += out.peeQueued;

    // Bad food never kills: the reference floors it at 1 HP (`items.ts:33`). Clamp
    // the reported cost so the caller's `apply_damage` cannot be lethal either.
    if (cost > 0) {
        const std::int16_t survivable = static_cast<std::int16_t>(hp > 1 ? hp - 1 : 0);
        out.hpCost = cost < survivable ? cost : survivable;
    }

    out.item = item;
    out.used = true;
    return out;
}

ConsumeResult use_best_food(Registry& reg, NpcPool& pool, EventBus& bus,
                           LayerId layer, std::uint64_t tick) {
    return use_best_for(reg, pool, bus, layer, Appetite::Food, tick);
}

ConsumeResult use_best_drink(Registry& reg, NpcPool& pool, EventBus& bus,
                            LayerId layer, std::uint64_t tick) {
    return use_best_for(reg, pool, bus, layer, Appetite::Water, tick);
}

ConsumeResult use_best_psi(Registry& reg, NpcPool& pool, EventBus& bus,
                          LayerId layer, std::uint64_t tick) {
    ConsumeResult out;
    const PlayerRef me = find_player(reg, pool, layer);
    if (me.entity == entt::null) return out;

    RpgStats* rpg = reg.try_get<RpgStats>(me.entity);
    if (!rpg) return out;

    const std::uint16_t mx = max_psi(*rpg);
    if (rpg->psi >= mx) return out;
    const float missing = static_cast<float>(mx - rpg->psi);

    Inventory& inv = pool.inventory(me.id);
    int best = -1;
    float bestAmt = 0.0f;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemId id = inv.slots[i].item;
        if (!item_restores_psi(id) || inv.slots[i].count == 0) continue;
        const float amt = static_cast<float>(item_def(id).useA);
        const bool bestCovers = bestAmt >= missing;
        const bool thisCovers = amt >= missing;
        if (thisCovers && (!bestCovers || amt < bestAmt)) { best = i; bestAmt = amt; }
        else if (!thisCovers && !bestCovers && amt > bestAmt) { best = i; bestAmt = amt; }
    }
    if (best < 0) return out;

    Needs& n = pool.needs(me.id);
    const ItemId used = inv.slots[best].item;
    out = apply_consumable(n, used, pool.hp(me.id), rpg);
    if (!out.used) return out;

    if (--inv.slots[best].count == 0) inv.slots[best] = ItemSlot{};

    if (out.hpCost > 0)
        apply_damage(reg, pool, me.entity, out.hpCost, kAttritionChannel, entt::null);

    bus.publish(EventType::ItemTransferred, me.id, kInvalidNpc, used, tick);
    return out;
}

ReliefResult relieve_needs(Needs& n, float peeAmount, float pooAmount) {
    ReliefResult out;
    if (peeAmount > 0.0f) {
        const float before = n.pee;
        n.pee = clamp_need(n.pee - peeAmount);
        out.pee = before - n.pee;
    }
    if (pooAmount > 0.0f) {
        const float before = n.poo;
        n.poo = clamp_need(n.poo - pooAmount);
        out.poo = before - n.poo;
    }
    return out;
}

} // namespace giga::game
