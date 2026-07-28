#include "game/needs.h"

#include <cmath>

#include "ecs/components.h"
#include "game/embody.h"     // NpcRef
#include "game/inventory.h"

namespace giga::game {

namespace {

// Same integer hash the loot roller uses. Local copy rather than a shared header:
// two call sites is not the "used by 3+ consumers" bar for a utility file
// ([AGENTS.md] File Organization).
std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

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

// `use_best_heal`'s selection rule, generalised over the bar being filled: the
// smallest portion that still covers the deficit, else the largest there is.
ConsumeResult use_best_for(Registry& reg, NpcPool& pool, EventBus& bus,
                           LayerId layer, Appetite want, std::uint64_t tick) {
    ConsumeResult out;
    const PlayerRef me = find_player(reg, pool, layer);
    if (me.entity == entt::null) return out;

    Needs& n = pool.needs(me.id);
    if (n.seeded == 0) n = needs_roll(mix(me.id + 1u));

    const float bar = want == Appetite::Food ? n.food : n.water;
    const float missing = kNeedMax - bar;
    if (missing <= 0.0f) return out;   // full; do not burn a ration

    Inventory& inv = pool.inventory(me.id);
    int best = -1;
    float bestAmt = 0.0f;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == kInvalidItem || s.count == 0) continue;
        const float amt = advertised(s.item, want);
        if (amt <= 0.0f) continue;

        if (best < 0) { best = i; bestAmt = amt; continue; }
        const bool bestCovers = bestAmt >= missing;
        const bool thisCovers = amt >= missing;
        if (thisCovers && (!bestCovers || amt < bestAmt)) { best = i; bestAmt = amt; }
        else if (!thisCovers && !bestCovers && amt > bestAmt) { best = i; bestAmt = amt; }
    }
    if (best < 0) return out;

    const ItemId used = inv.slots[best].item;
    out = apply_consumable(n, used, pool.hp(me.id));
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
    n.food  = kStartFoodLo  + u01(mix(seed ^ 0x9e3779b9u)) * (kStartFoodHi  - kStartFoodLo);
    n.water = kStartWaterLo + u01(mix(seed ^ 0x85ebca6bu)) * (kStartWaterHi - kStartWaterLo);
    n.sleep = kStartSleepLo + u01(mix(seed ^ 0xc2b2ae35u)) * (kStartSleepHi - kStartSleepLo);
    n.pee   = kStartPeeLo   + u01(mix(seed ^ 0x27d4eb2fu)) * (kStartPeeHi   - kStartPeeLo);
    n.poo   = kStartPooLo   + u01(mix(seed ^ 0x165667b1u)) * (kStartPooHi   - kStartPooLo);
    n.pendingPee = 0.0f;
    n.pendingPoo = 0.0f;
    n.hpDebt = 0.0f;
    n.seeded = 1;
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
    return n.sleep < kSleepExhaustedAt ? kSleepExhaustedSpeedScale : 1.0f;
}

NeedsTick needs_step(Registry& reg, NpcPool& pool, LayerId layer, float dt) {
    NeedsTick out;
    if (dt <= 0.0f) return out;

    const PlayerRef me = find_player(reg, pool, layer);
    if (me.entity == entt::null) return out;   // nobody is playing this layer
    out.ticked = true;

    Needs& n = pool.needs(me.id);
    // Lazy roll, the way `player_melee_step` attaches PlayerMelee lazily: no spawn
    // path, elevator or possession has to remember to seed the clock. Seeded from
    // the record id, so the same body is the same body across a reload.
    if (n.seeded == 0) n = needs_roll(mix(me.id + 1u));

    needs_advance(n, dt);

    out.failed = needs_failed_mask(n);
    out.warned = needs_warn_mask(n);
    out.speedScale = needs_speed_scale(n);
    out.secondsToDamage = needs_seconds_to_damage(n);

    const float rate = needs_hp_rate(n);
    if (rate <= 0.0f) return out;

    // HP is an integer and the slowest drain is 0.1 HP/s, which at the 120 Hz sim
    // step is 0.00083 HP — truncating that to an int every step would make
    // starvation cost exactly nothing, forever. So the fraction is BANKED in the
    // row and only whole HP is ever spent. The debt is deliberately not forgiven
    // when a need is topped back up: unpaid damage is still owed.
    n.hpDebt += rate * dt;
    if (n.hpDebt < 1.0f) return out;

    float whole = std::floor(n.hpDebt);
    n.hpDebt -= whole;
    if (whole > 32767.0f) whole = 32767.0f;   // a catch-up dt cannot overflow int16

    const DamageResult r = apply_damage(reg, pool, me.entity,
                                        static_cast<std::int16_t>(whole),
                                        kAttritionChannel, entt::null);
    out.hpLost = r.applied;
    out.lethal = r.lethal;
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

ConsumeResult apply_consumable(Needs& n, ItemId item, std::int16_t hp) {
    ConsumeResult out;
    if (!item_valid(item)) return out;

    const UseEffect eff = static_cast<UseEffect>(item_def(item).useEffect);
    const float a = static_cast<float>(item_def(item).useA);
    if (a <= 0.0f) return out;   // nothing to give; `used` stays false

    float pooShare = 0.0f;
    float peeShare = 0.0f;
    std::int16_t cost = 0;

    switch (eff) {
        case UseEffect::Feed:
            out.food = top_up(n.food, a);
            pooShare = kFeedPooShare;
            peeShare = kFeedPeeShare;
            break;

        case UseEffect::FeedPsi:
            // Psi is not modelled in gigahrush2, so the psi half of `kulich` is
            // dropped and only its food half lands. The generic 0.7 share gives it
            // 24.5 points of bowel pressure against the reference's authored 25 —
            // within 2 %, so it does not earn a special case.
            out.food = top_up(n.food, a);
            pooShare = kFeedPooShare;
            peeShare = kFeedPeeShare;
            break;

        case UseEffect::FeedRisky:
            out.food = top_up(n.food, a);
            pooShare = kRiskyPooShare;
            peeShare = kRiskyPeeShare;
            cost = kRiskyFeedHpCost;
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
            cost = kSleepingPillsHpCost;
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
