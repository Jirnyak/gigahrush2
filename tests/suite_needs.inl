// Needs — the survival clock. Included into game_test.cpp, so it uses that file's
// CHECK macro and its `using namespace giga::game`. Everything except the single
// entry point `test_needs_all()` lives in `namespace needs_test`.
//
// The load-bearing test is `survival_window()`. Every constant in needs.h is MEASURED
// from the TypeScript reference rather than chosen, and that function asserts the
// minutes-to-damage they produce — at build time where it can, by running the real
// clock where it cannot. Retune 0.12 and this file goes red with the number it now
// produces.
//
// `use_best()` CHANGED CONTRACT and the old one is documented on it rather than
// deleted, because it was green: it asserted that the eat key spends
// kRiskyFeedHpCost = 6 HP to buy a tighter portion fit, which is what ranking
// consumables on fit alone does with data/items.csv's four FeedRisky rows. The rule and
// the arithmetic that replaced it are in [needs.h]; the count over every deficit the
// bar can hold is in suite_needs2.inl.
#include "core/tick.h"   // kSimDt / kSimHz — never a bare 1/120 ([core/tick.h])
#include "game/needs.h"
#include "game/room_zone.h" // RoomZones/room_bit_at — the ambient-recovery arm
#include "game/elevator.h"
#include "game/floor_registry.h"
#include "game/population.h"

namespace needs_test {

// Everything full, nothing pending, marked seeded so needs_step will not re-roll it.
// Tests then knock down exactly the one bar under test.
Needs full_clock() {
    Needs n{};
    n.food = kNeedMax;
    n.water = kNeedMax;
    n.sleep = kNeedMax;
    n.sanity = kNeedMax;
    n.radiation = 0.0f;
    n.seeded = 1;
    return n;
}

bool approx(float a, float b, float tol) {
    const float d = a - b;
    return (d < 0.0f ? -d : d) <= tol;
}

struct Rig {
    NpcPool pool;
    Registry reg;
    EventBus bus;
    NpcId id = kInvalidNpc;
    Entity body = entt::null;

    void build(std::int16_t hp) {
        pool.init();
        bus.init();
        id = pool.spawn();
        pool.height_mm(id) = 1750;
        body = embody_as_player(reg, pool, id, 0);
        reset(hp);
    }
    // Re-arm the same body for the next case. NpcPool::init() commits 0.49 GiB, so
    // rigs are reused rather than rebuilt wherever the case does not need a virgin
    // registry — that is worth ~2 s of the suite's runtime.
    void reset(std::int16_t hp) {
        pool.max_hp(id) = hp;
        pool.hp(id) = hp;
        needs() = full_clock();
    }
    Needs& needs() { return pool.needs(id); }
};

constexpr float kRefPeriod = 0.25f;   // the reference's own needs period
constexpr float kSimStep = kSimDt;    // the real sim tick itself ([core/tick.h])

// Outer brackets around the measured windows, wide enough that the build-time asserts
// are brackets rather than coincidences. balance.md rounds the same figures to
// "9.7..13.9" and "14.6..20.8"; the exact values are 9.722..13.889 and
// 14.583..20.833, which is why the food floor here is 14.5 and not the rounded 14.6.
// The tight pins are the `approx` CHECKs, to +/-0.02 min.
constexpr float kWaterMinLo =  9.5f, kWaterMinHi = 14.0f;
constexpr float kFoodMinLo  = 14.5f, kFoodMinHi  = 21.0f;

// Minutes of pure clock until `bit` fails. Drives `needs_advance`, which IS the clock
// — no registry, no HP — so what is measured is the constants and nothing else.
float minutes_until_failed(Needs n, std::uint8_t bit) {
    float t = 0.0f;
    for (int i = 0; i < 1440000 && (needs_failed_mask(n) & bit) == 0; ++i) {
        needs_advance(n, kRefPeriod);
        t += kRefPeriod;
    }
    return t / 60.0f;
}

float seconds_until_hurting(Needs n) {
    float t = 0.0f;
    for (int i = 0; i < 1440000 && needs_hp_rate(n) <= 0.0f; ++i) {
        needs_advance(n, kRefPeriod);
        t += kRefPeriod;
    }
    return t;
}

// Run the WIRED path — needs_step through the registry, apply_damage and all — and
// report the total HP it took off.
std::int32_t run_step_seconds(Rig& rig, float seconds, float dt) {
    std::int32_t lost = 0;
    const int steps = static_cast<int>(seconds / dt + 0.5f);
    for (int i = 0; i < steps; ++i) {
        const NeedsTick t = needs_step(rig.reg, rig.pool, 0, dt);
        lost += t.hpLost;
        if (t.lethal) break;
    }
    return lost;
}

// No item id is hardcoded in this file — the table is the source ([AGENTS.md]).
ItemId first_with_effect(UseEffect eff) {
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        const ItemDef& d = item_def(id);
        if (d.useEffect == static_cast<std::uint8_t>(eff) && d.useA > 0) return id;
    }
    return kInvalidItem;
}

// Which cost class a lookup is over. `consumable_hp_cost` is the discriminator, so
// the test states the selection rule's primary key in the same terms the rule uses.
enum class Cost : std::uint8_t { Any, Free, Charged };

// Extremes of useA over the rows serving one appetite, restricted to a cost class. No
// item id is hardcoded in this file — the table is the source ([AGENTS.md]) — so a CSV
// retune moves the test with it instead of quietly invalidating it.
void extremes_for(bool hydrating, Cost cls, ItemId& small, ItemId& large) {
    small = kInvalidItem;
    large = kInvalidItem;
    std::int16_t lo = 0, hi = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        if (hydrating ? !item_hydrates(id) : !item_feeds(id)) continue;
        const std::int16_t a = item_def(id).useA;
        if (a <= 0) continue;
        // `noCost`, not `free`: a local named `free` hides ::free, which MSVC /W4
        // reports as C4459.
        const bool noCost = consumable_hp_cost(id) == 0;
        if (cls == Cost::Free && !noCost) continue;
        if (cls == Cost::Charged && noCost) continue;
        if (small == kInvalidItem || a < lo) { small = id; lo = a; }
        if (large == kInvalidItem || a > hi) { large = id; hi = a; }
    }
}

void roll() {
    float foodLo = 1e9f, foodHi = -1e9f, waterLo = 1e9f, waterHi = -1e9f;
    float sleepLo = 1e9f, peeHi = -1e9f, pooHi = -1e9f;
    for (std::uint32_t s = 0; s < 512u; ++s) {
        const Needs n = needs_roll(s);
        CHECK(n.seeded == 1);
        CHECK(n.food >= kStartFoodLo && n.food <= kStartFoodHi);
        CHECK(n.water >= kStartWaterLo && n.water <= kStartWaterHi);
        CHECK(n.sleep >= kStartSleepLo && n.sleep <= kStartSleepHi);
        CHECK(n.pee >= kStartPeeLo && n.pee <= kStartPeeHi);
        CHECK(n.poo >= kStartPooLo && n.poo <= kStartPooHi);
        CHECK(n.pendingPee == 0.0f && n.pendingPoo == 0.0f && n.hpDebt == 0.0f);
        // A fresh body is never already in trouble, never already warned, never
        // already exhausted.
        CHECK(needs_failed_mask(n) == 0);
        CHECK(needs_warn_mask(n) == 0);
        CHECK(needs_speed_scale(n) == 1.0f);

        if (n.food < foodLo) foodLo = n.food;
        if (n.food > foodHi) foodHi = n.food;
        if (n.water < waterLo) waterLo = n.water;
        if (n.water > waterHi) waterHi = n.water;
        if (n.sleep < sleepLo) sleepLo = n.sleep;
        if (n.pee > peeHi) peeHi = n.pee;
        if (n.poo > pooHi) pooHi = n.poo;
    }
    // Spread across the window rather than clustered at one end — two bodies must not
    // be interchangeable.
    CHECK(foodLo < kStartFoodLo + 1.5f && foodHi > kStartFoodHi - 1.5f);
    CHECK(waterLo < kStartWaterLo + 1.5f && waterHi > kStartWaterHi - 1.5f);
    CHECK(sleepLo < kStartSleepLo + 2.0f);
    CHECK(peeHi > kStartPeeHi - 1.5f);
    CHECK(pooHi > kStartPooHi - 1.5f);

    // Deterministic in the seed: the same record is the same body across a reload.
    CHECK(needs_roll(1234u).water == needs_roll(1234u).water);
    CHECK(needs_roll(1234u).water != needs_roll(1235u).water);
    // Independent per bar — one hash reused across five fields would correlate them,
    // so a thirsty body would always also be a hungry one.
    bool decorrelated = false;
    for (std::uint32_t s = 0; s < 64u && !decorrelated; ++s)
        decorrelated = needs_roll(s).food != needs_roll(s).water;
    CHECK(decorrelated);

    // Sleep starts lower than food and water, which is why exhaustion bites on a long
    // trip despite being the slowest bar to drain.
    static_assert(kStartSleepLo < kStartFoodLo);

    // A blank pool row is "never rolled", NOT a starving body. That distinction keeps
    // ~1M reserve slots from reading as corpses-in-waiting.
    const Needs blank{};
    CHECK(blank.seeded == 0 && blank.food == 0.0f);
}

void survival_window() {
    // The arithmetic in needs.h's comment block, as static_asserts, so a retuned rate
    // fails to COMPILE rather than fails a run.
    static_assert(needs_survival_minutes(kStartWaterLo, kWaterDrainPerSec) >=
                      kWaterMinLo,
                  "the unluckiest body must still get the documented water window");
    static_assert(needs_survival_minutes(kStartWaterHi, kWaterDrainPerSec) <=
                      kWaterMinHi,
                  "the luckiest body must not exceed the documented water window");
    static_assert(needs_survival_minutes(kStartFoodLo, kFoodDrainPerSec) >= kFoodMinLo);
    static_assert(needs_survival_minutes(kStartFoodHi, kFoodDrainPerSec) <= kFoodMinHi);
    // The floors the original brief asked for ("8..12 min on water, 12..18 on food").
    // Its ceilings were ~16 % low — see needs.h — but these floors are the guarantee
    // that matters, and they hold for the worst roll.
    static_assert(needs_survival_minutes(kStartWaterLo, kWaterDrainPerSec) >= 8.0f);
    static_assert(needs_survival_minutes(kStartFoodLo, kFoodDrainPerSec) >= 12.0f);
    // Water is harsher than food by minutes, not by rounding.
    static_assert(needs_survival_minutes(100.0f, kWaterDrainPerSec) <
                      needs_survival_minutes(100.0f, kFoodDrainPerSec) - 5.0f);

    // Now measure it by RUNNING the clock, so constants and code have to agree.
    Needs worst = full_clock();
    worst.water = kStartWaterLo;
    const float waterLo = minutes_until_failed(worst, NeedWater);
    Needs best = full_clock();
    best.water = kStartWaterHi;
    const float waterHi = minutes_until_failed(best, NeedWater);
    CHECK(approx(waterLo, 9.72f, 0.02f));
    CHECK(approx(waterHi, 13.89f, 0.02f));
    CHECK(waterLo >= 8.0f && waterLo <= 12.0f);   // the brief's window, worst roll
    CHECK(waterHi <= kWaterMinHi);

    // Thirst fails first along the way here, which is itself the proof that water is
    // the binding constraint.
    Needs fWorst = full_clock();
    fWorst.food = kStartFoodLo;
    const float foodLo = minutes_until_failed(fWorst, NeedFood);
    Needs fBest = full_clock();
    fBest.food = kStartFoodHi;
    const float foodHi = minutes_until_failed(fBest, NeedFood);
    CHECK(approx(foodLo, 14.58f, 0.02f));
    CHECK(approx(foodHi, 20.83f, 0.02f));
    CHECK(foodLo >= 12.0f && foodLo <= 18.0f);    // the brief's window, worst roll
    CHECK(foodHi <= kFoodMinHi);

    // Even the luckiest thirst beats the unluckiest hunger.
    CHECK(waterLo < foodLo && waterHi < foodLo);

    // Sleep is the slowest bar, so exhaustion is a late-trip problem by design.
    Needs sWorst = full_clock();
    sWorst.sleep = kStartSleepLo;
    CHECK(approx(minutes_until_failed(sWorst, NeedSleep), 20.0f, 0.02f));

    // dt-independence: the same answer at the sim step as at 0.25 s, or the window is
    // an artefact of whatever dt the loop happens to use. Both loops must cover the
    // SAME 60 s, so the tick count is kSimHz * 60 rather than a literal that only
    // meant 60 s while the rate was 120.
    Needs a = full_clock();
    Needs b = full_clock();
    for (int i = 0; i < kSimHz * 60; ++i) needs_advance(a, kSimStep);
    for (int i = 0; i < 4 * 60; ++i) needs_advance(b, kRefPeriod);
    // 0.05 of a point out of 100, not tighter: 7500 float subtractions of 0.00067 from
    // ~100 accumulate a rounding bias of up to ulp(100)/2 * steps ~= 0.027. A genuinely
    // dt-dependent bug (draining per step instead of per second) would be 30x off, so
    // this bound still catches the thing it is here to catch. Do not tighten it.
    CHECK(approx(a.water, b.water, 0.05f));
    CHECK(approx(a.food, b.food, 0.05f));
    CHECK(approx(a.water, kNeedMax - 60.0f * kWaterDrainPerSec, 0.05f));
}

void warning_lead() {
    // Thresholds are rate * lead, so the lead is identical for every bar by
    // construction — and the lead itself is inside the design window.
    static_assert(kNeedWarnLeadSec >= 90.0f && kNeedWarnLeadSec <= 150.0f);
    static_assert(kFoodWarnAt / kFoodDrainPerSec > 119.0f &&
                  kFoodWarnAt / kFoodDrainPerSec < 121.0f);
    static_assert(kWaterWarnAt / kWaterDrainPerSec > 119.0f &&
                  kWaterWarnAt / kWaterDrainPerSec < 121.0f);
    // Derived, so the harsher bar warns at a HIGHER level — the whole reason not to
    // hardcode one number for both.
    static_assert(kWaterWarnAt > kFoodWarnAt);

    // Measured by running the clock from the threshold to the first HP loss.
    Needs w = full_clock();
    w.water = kWaterWarnAt;
    const float waterLead = seconds_until_hurting(w);
    CHECK(waterLead >= 90.0f && waterLead <= 150.0f);
    CHECK(approx(waterLead, kNeedWarnLeadSec, kRefPeriod));

    Needs f = full_clock();
    f.food = kFoodWarnAt;
    const float foodLead = seconds_until_hurting(f);
    CHECK(foodLead >= 90.0f && foodLead <= 150.0f);
    CHECK(approx(foodLead, kNeedWarnLeadSec, kRefPeriod));

    // The mask must fire at the threshold and stay quiet above it, or the lead time
    // is a number nobody ever sees.
    Needs at = full_clock();
    at.water = kWaterWarnAt + 0.01f;
    CHECK((needs_warn_mask(at) & NeedWater) == 0);
    at.water = kWaterWarnAt - 0.01f;
    at.food = kFoodWarnAt - 0.01f;
    CHECK((needs_warn_mask(at) & NeedWater) != 0);
    CHECK((needs_warn_mask(at) & NeedFood) != 0);
    // A warning is not a failure. That gap is the point.
    CHECK(needs_failed_mask(at) == 0);
    CHECK(needs_hp_rate(at) == 0.0f);

    Needs s = full_clock();
    s.water = kWaterWarnAt;
    CHECK(approx(needs_seconds_to_damage(s), kNeedWarnLeadSec, 0.01f));
    s.water = 0.0f;
    CHECK(needs_seconds_to_damage(s) == 0.0f);   // already paying
}

void attrition() {
    // The damage table, as a pure query. Additive, not exclusive.
    Needs n = full_clock();
    CHECK(needs_hp_rate(n) == 0.0f);
    n.water = 0.0f;
    CHECK(approx(needs_hp_rate(n), kDehydrationHpPerSec, 1e-6f));
    n.food = 0.0f;
    CHECK(approx(needs_hp_rate(n), 0.8f, 1e-6f));
    n.pee = kNeedMax;
    n.poo = kNeedMax;
    CHECK(approx(needs_hp_rate(n), 1.0f, 1e-6f));   // all four = exactly 1.0 HP/s

    // Sleep at zero adds NOTHING to that rate — the no-death-spiral rule.
    Needs sleepy = full_clock();
    sleepy.sleep = 0.0f;
    CHECK(needs_hp_rate(sleepy) == 0.0f);
    CHECK((needs_failed_mask(sleepy) & NeedSleep) != 0);   // still reported

    // One rig, re-armed between cases — see Rig::reset. The death case comes last
    // because it destroys the body.
    Rig rig;
    rig.build(100);

    // Fractional banking. 0.5 HP/s at the 125 Hz step is 0.0040 HP — truncate that to
    // an int every step and dehydration costs literally nothing, forever. So one
    // second must cost 0 whole HP with the fraction visibly banked, and 21 s must
    // cost 10.
    rig.needs().water = 0.0f;
    CHECK(run_step_seconds(rig, 1.0f, kSimStep) == 0);
    CHECK(rig.pool.hp(rig.id) == 100);
    CHECK(rig.needs().hpDebt > 0.4f && rig.needs().hpDebt < 0.6f);

    rig.reset(100);
    rig.needs().water = 0.0f;
    CHECK(run_step_seconds(rig, 21.0f, kSimStep) == 10);   // 0.5 HP/s * 21 s
    CHECK(rig.pool.hp(rig.id) == 90);

    // Hunger is 0.3 HP/s: 61 s costs 18, so the banked remainder is not silently
    // dropped over a long run.
    rig.reset(100);
    rig.needs().food = 0.0f;
    CHECK(run_step_seconds(rig, 61.0f, kSimStep) == 18);

    // ARMOUR MUST NOT SLOW STARVATION. This pins kAttritionChannel: the heaviest vest
    // in the table resists 80 % kinetic, and it must make no difference at all to
    // dehydration.
    ItemId vest = kInvalidItem;
    int bestSum = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        int sum = 0;
        for (std::size_t c = 0; c < kItemResistChannels; ++c)
            sum += item_def(id).resist[c];
        if (sum > bestSum) { bestSum = sum; vest = id; }
    }
    CHECK(vest != kInvalidItem && bestSum > 100);

    rig.reset(200);
    rig.needs().water = 0.0f;
    const std::int32_t nude = run_step_seconds(rig, 61.0f, kSimStep);

    rig.reset(200);
    rig.needs().water = 0.0f;
    rig.pool.inventory(rig.id).slots[0] = ItemSlot{vest, 1};
    sync_armour(rig.reg, rig.pool, rig.body);
    CHECK(rig.reg.all_of<Armour>(rig.body));   // the vest really is worn
    const std::int32_t armoured = run_step_seconds(rig, 61.0f, kSimStep);

    CHECK(nude == 30);                  // 0.5 HP/s * 61 s -> 30 whole HP
    CHECK(armoured == nude);            // <-- the contract
    // ...and that same vest DOES stop a kinetic hit, so the equality above is not
    // passing merely because the armour is inert.
    const DamageResult k = apply_damage(rig.reg, rig.pool, rig.body, 100,
                                        DamageChannel::Kinetic, entt::null);
    CHECK(k.blocked > 0 && k.applied < 100);

    // Starving to death is the SAME death as being clubbed to death: Dead tag, one
    // finalizer, one NpcDied event. There is no second death route.
    rig.reset(3);
    rig.needs().water = 0.0f;
    rig.needs().food = 0.0f;      // 0.8 HP/s -> 3 HP gone inside 5 s
    bool sawLethal = false;
    for (int i = 0; i < kSimHz * 10 && !sawLethal; ++i)
        sawLethal = needs_step(rig.reg, rig.pool, 0, kSimStep).lethal;
    CHECK(sawLethal);
    CHECK(rig.pool.hp(rig.id) == 0);
    CHECK(rig.reg.all_of<Dead>(rig.body));   // tagged, NOT destroyed yet
    CHECK(rig.pool.alive(rig.id));           // finalize_deaths owns that
    CHECK(finalize_deaths(rig.reg, rig.pool, rig.bus, 7u) == 1);
    CHECK(!rig.pool.alive(rig.id));
    CHECK(!rig.reg.valid(rig.body));
    CHECK(rig.bus.size() == 1);
    CHECK(rig.bus.events()[0].type == EventType::NpcDied);
    CHECK(rig.bus.events()[0].a == rig.id);
}

void sleep_costs_speed() {
    Needs n = full_clock();
    CHECK(needs_speed_scale(n) == 1.0f);
    n.sleep = kSleepExhaustedAt + 0.01f;
    CHECK(needs_speed_scale(n) == 1.0f);
    n.sleep = kSleepExhaustedAt - 0.01f;
    CHECK(needs_speed_scale(n) == kSleepExhaustedSpeedScale);
    n.sleep = 0.0f;
    CHECK(needs_speed_scale(n) == kSleepExhaustedSpeedScale);
    // A penalty, not a stop: exhaustion must slow you without pinning you in place.
    static_assert(kSleepExhaustedSpeedScale < 1.0f && kSleepExhaustedSpeedScale > 0.0f);

    // Five minutes with sleep pinned at zero and the other bars full: not one HP.
    Rig rig;
    rig.build(100);
    rig.needs() = full_clock();
    rig.needs().sleep = 0.0f;
    CHECK(run_step_seconds(rig, 300.0f, kRefPeriod) == 0);
    CHECK(rig.pool.hp(rig.id) == 100);

    // The step hands the multiplier back, so scaling Controller::moveSpeed needs no
    // second query.
    const NeedsTick t = needs_step(rig.reg, rig.pool, 0, kRefPeriod);
    CHECK(t.ticked && t.hpLost == 0);
    CHECK(t.speedScale == kSleepExhaustedSpeedScale);
}

void consumption() {
    // The food/drink sets key off UseEffect, never ItemCategory — and two rows
    // disagree: calm_brew is category DRINK, easter_egg is category FOOD, and both are
    // HealPsi. Category would let you "drink" a brew and stay thirsty.
    int feeds = 0, hydrates = 0, catFood = 0, catDrink = 0, miscategorised = 0;
    int drinkStim = 0, pills = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        const ItemDef& d = item_def(id);
        const bool f = item_feeds(id), h = item_hydrates(id);
        if (f) ++feeds;
        if (h) ++hydrates;
        CHECK(!(f && h));
        const bool isFood = d.category == static_cast<std::uint8_t>(ItemCategory::Food);
        const bool isDrink = d.category == static_cast<std::uint8_t>(ItemCategory::Drink);
        if (isFood) ++catFood;
        if (isDrink) ++catDrink;
        if ((isFood || isDrink) != (f || h)) ++miscategorised;
        if (d.useEffect == static_cast<std::uint8_t>(UseEffect::DrinkStim)) ++drinkStim;
        if (d.useEffect == static_cast<std::uint8_t>(UseEffect::SleepingPills)) ++pills;
        // Anything edible must carry a positive magnitude, or it is an item you can
        // "use" to no effect at all.
        if (f || h) CHECK(d.useA > 0);
    }
    // Pinned against data/items.csv: 16 Feed + 4 FeedRisky + 1 FeedPsi = 21;
    // 7 Drink + 1 DrinkStim = 8.
    CHECK(feeds == 21 && hydrates == 8);
    CHECK(catFood == 22 && catDrink == 9);
    CHECK(miscategorised == 2);   // calm_brew, easter_egg — the trap above
    // needs.h ports siren_energy's sleep bonus and the pill's costs as single
    // constants, which is exact ONLY while each effect has one row. A second turns
    // them into approximations and is the signal ItemDef needs `useB`.
    CHECK(drinkStim == 1 && pills == 1);

    const ItemId water = first_with_effect(UseEffect::Drink);
    CHECK(water != kInvalidItem);
    const float waterA = static_cast<float>(item_def(water).useA);
    CHECK(waterA > 10.0f);   // so the clamp below is testing something
    {
        Needs n = full_clock();
        n.water = kNeedMax - 10.0f;
        const ConsumeResult r = apply_consumable(n, water, 100);
        CHECK(r.used && r.item == water);
        CHECK(approx(r.water, 10.0f, 1e-4f));   // what LANDED, not what the tin says
        CHECK(r.water < waterA);
        CHECK(approx(n.water, kNeedMax, 1e-4f));
        CHECK(r.food == 0.0f && r.hpCost == 0);
        // Pressure is billed on the LABEL, not on what fitted: the bottle went through
        // you either way. And it is QUEUED, not immediate.
        CHECK(approx(r.peeQueued, waterA * kDrinkPeeShare, 1e-4f));
        CHECK(approx(n.pendingPee, r.peeQueued, 1e-4f));
        CHECK(n.pendingPoo == 0.0f && n.pee == 0.0f);
    }
    {
        Needs n = full_clock();
        n.water = 0.0f;
        CHECK(approx(apply_consumable(n, water, 100).water, waterA, 1e-4f));
        // Drinking at a FULL bar restores nothing and still bills the full bladder
        // charge. That is the label-billing rule at its extreme, and the reason
        // use_best_drink refuses to reach for a bottle you do not need: the waste is
        // not merely the item, it is a pressure you now have to walk off.
        Needs sated = full_clock();
        const ConsumeResult wasted = apply_consumable(sated, water, 100);
        CHECK(wasted.used && approx(wasted.water, 0.0f, 1e-4f));
        CHECK(approx(sated.pendingPee, waterA * kDrinkPeeShare, 1e-4f));
    }

    // Food splits its pressure between bowel and bladder, 0.7 / 0.3.
    const ItemId bread = first_with_effect(UseEffect::Feed);
    CHECK(bread != kInvalidItem);
    {
        const float a = static_cast<float>(item_def(bread).useA);
        Needs n = full_clock();
        n.food = 0.0f;
        const ConsumeResult r = apply_consumable(n, bread, 100);
        CHECK(approx(r.food, a, 1e-4f) && r.water == 0.0f);
        CHECK(approx(r.pooQueued, a * kFeedPooShare, 1e-3f));
        CHECK(approx(r.peeQueued, a * kFeedPeeShare, 1e-3f));
        CHECK(r.pooQueued > r.peeQueued);
    }

    // Risky food costs HP, queues more pressure than clean food, and can never kill
    // you — the reference floors it at 1 HP.
    const ItemId risky = first_with_effect(UseEffect::FeedRisky);
    CHECK(risky != kInvalidItem);
    static_assert(kRiskyPooShare > kFeedPooShare && kRiskyFeedHpCost > 0,
                  "risky food must cost more than clean food, or nobody would hesitate");
    {
        Needs n = full_clock();
        n.food = 0.0f;
        CHECK(apply_consumable(n, risky, 100).hpCost == kRiskyFeedHpCost);
        Needs dying = full_clock();
        dying.food = 0.0f;
        CHECK(apply_consumable(dying, risky, 1).hpCost == 0);
        Needs hurt = full_clock();
        hurt.food = 0.0f;
        CHECK(apply_consumable(hurt, risky, 3).hpCost == 2);   // never 3
        CHECK(hurt.food > 0.0f);   // ...and it still feeds you, which is why anyone eats it
    }

    // The one sleep restorer in the table, unreachable through use_best_food/drink.
    const ItemId sleepAid = first_with_effect(UseEffect::SleepingPills);
    CHECK(sleepAid != kInvalidItem);
    CHECK(!item_feeds(sleepAid) && !item_hydrates(sleepAid));
    {
        Needs n = full_clock();
        n.sleep = 20.0f;
        n.water = 90.0f;
        n.food = 90.0f;
        const ConsumeResult r = apply_consumable(n, sleepAid, 100);
        CHECK(r.used && r.sleep > 0.0f && n.sleep > 20.0f);
        CHECK(approx(n.water, 90.0f - kSleepingPillsWaterCost, 1e-4f));
        CHECK(approx(n.food, 90.0f - kSleepingPillsFoodCost, 1e-4f));
        CHECK(r.hpCost == kSleepingPillsHpCost);
    }

    // `consumable_hp_cost` is the PRIMARY key of the selection rule, so it has to agree
    // with what `apply_consumable` actually charges for EVERY row in the table, not for
    // the three rows the cases above happen to use. Disagreement would be invisible at
    // runtime: selection would keep calling a row free while eating it took 6 HP.
    int charged = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        Needs probe = full_clock();
        probe.food = 0.0f;
        probe.water = 0.0f;
        probe.sleep = 0.0f;
        // hp 1000 so the hp-1 survivability floor cannot mask a mismatch.
        const ConsumeResult pr = apply_consumable(probe, id, 1000);
        CHECK(pr.hpCost == (pr.used ? consumable_hp_cost(id) : 0));
        if (consumable_hp_cost(id) > 0) ++charged;
    }
    // 4 FeedRisky at kRiskyFeedHpCost + 1 SleepingPills at kSleepingPillsHpCost. A
    // sixth row would be a cost path the selection rule has never been exercised on.
    CHECK(charged == 5);

    // Nothing else touches the clock.
    Needs junk = full_clock();
    CHECK(!apply_consumable(junk, kInvalidItem, 100).used);
    CHECK(!apply_consumable(junk, static_cast<ItemId>(kItemCount + 1), 100).used);
    CHECK(junk.food == kNeedMax && junk.water == kNeedMax);
}

// THE SELECTION CONTRACT, in prose before code, because this function previously
// asserted the OPPOSITE of it and was green for it:
//
//   1. HP COST OUTRANKS FIT. Anything `consumable_hp_cost` reports 0 for is chosen
//      over anything it charges for, however much better the costly one fits.
//   2. Within one cost class: the smallest portion that still covers the deficit,
//      else the largest available — `use_best_heal`'s rule ([loot.h]).
//   3. Ties in useA go to the lowest slot index.
//
// WHAT THE OLD ASSERTIONS ENCODED. `extremes_for(Cost::Any)` over the 21 feeding rows
// returns sand_spoiled_ration (useA 4, FeedRisky) as the smallest and
// liquidator_ration (useA 40, Feed) as the largest — the globally smallest feeding row
// in the table is a risky one. So the previously-green `r1.item == small` at a 4-point
// deficit was asserting that the eat key pays kRiskyFeedHpCost = 6 HP to restore 4
// food points (50 s of clock at kFoodDrainPerSec) while a 0 HP ration sits in the next
// slot. The old test never looked at HP at all, which is exactly how a 6-for-4 trade
// stayed green for a whole integration. HP is now checked in every case below.
//
// KEY 1 IS NOT FREE, and the cost is stated here rather than hidden: at a small
// deficit it burns a bigger item and queues more digestion than the tight risky fit
// would. Case B measures both sides of that trade. What decides it is that the
// pathological shape needs sand_spoiled_ration, whose spawn weight is 0 — no run can
// hand you one, because `drop_mob_loot` skips weight-0 rows — while case C's shape
// (220 and 1000 milli) is reachable on any floor with a MEDICAL or STORAGE room.
void use_best() {
    ItemId anySmall = kInvalidItem, anyLarge = kInvalidItem;
    ItemId freeSmall = kInvalidItem, freeLarge = kInvalidItem;
    ItemId riskySmall = kInvalidItem, riskyLarge = kInvalidItem;
    extremes_for(/*hydrating=*/false, Cost::Any, anySmall, anyLarge);
    extremes_for(/*hydrating=*/false, Cost::Free, freeSmall, freeLarge);
    extremes_for(/*hydrating=*/false, Cost::Charged, riskySmall, riskyLarge);
    CHECK(freeSmall != kInvalidItem && riskySmall != kInvalidItem);

    // The two table facts that make key 1 load-bearing rather than theoretical:
    // the globally tightest feeding row is a charged one (4 against the free 6), and
    // the largest charged row still fits a deep deficit better than any free row
    // (32 against 40). Both are why fit-first reaches for HP.
    CHECK(anySmall == riskySmall);
    CHECK(item_def(riskySmall).useA < item_def(freeSmall).useA);
    CHECK(item_def(riskyLarge).useA < item_def(freeLarge).useA);
    CHECK(anyLarge == freeLarge);
    CHECK(consumable_hp_cost(riskySmall) == kRiskyFeedHpCost);
    CHECK(consumable_hp_cost(riskyLarge) == kRiskyFeedHpCost);
    CHECK(consumable_hp_cost(freeSmall) == 0 && consumable_hp_cost(freeLarge) == 0);

    Rig rig;
    rig.build(100);
    rig.needs() = full_clock();
    Inventory& inv = rig.pool.inventory(rig.id);
    inv.slots[0] = ItemSlot{riskySmall, 1};
    inv.slots[1] = ItemSlot{freeLarge, 1};

    // A — full: nothing is spent. A ration is not burned on an appetite you do not have.
    CHECK(!use_best_food(rig.reg, rig.pool, rig.bus, 0, 1u).used);
    CHECK(inv.slots[0].item == riskySmall && inv.slots[1].item == freeLarge);
    CHECK(rig.pool.hp(rig.id) == 100);

    // B — THE CASE THAT FLIPPED. The charged row fits the deficit EXACTLY and is still
    // not chosen. Ledger for a 4-point deficit holding {4 charged, 40 free}:
    //   charged: +4 food, 6 HP,  4.0 poo + 1.6 pee queued, keeps the 40-point ration
    //   free:    +4 food, 0 HP, 28.0 poo + 12.0 pee queued, keeps the charged row
    // So key 1 trades 36 wasted food points and 24 extra points of bowel for 6 % of a
    // 100 HP bar. It is the right way round because HP has exactly one restore path in
    // this build (12 `Heal` rows at 10..140 RUB) while the 16 clean Feed rows are 1..22
    // RUB trash, and because the deferral is only ever deferral: the key is repeatable,
    // so the 6 HP is still available on the next press once the free rows are gone
    // (case F).
    const float riskyA = static_cast<float>(item_def(riskySmall).useA);
    rig.needs().food = kNeedMax - riskyA;
    const ConsumeResult r1 = use_best_food(rig.reg, rig.pool, rig.bus, 0, 2u);
    CHECK(r1.used && r1.item == freeLarge);
    CHECK(r1.hpCost == 0);
    CHECK(rig.pool.hp(rig.id) == 100);          // was 94 under fit-first ranking
    CHECK(approx(rig.needs().food, kNeedMax, 1e-3f));
    CHECK(inv.slots[0].item == riskySmall);     // the 6 HP stays unspent
    CHECK(inv.slots[1].item == kInvalidItem);   // the free ration is what got eaten

    // C — the band a real run reaches, because both rows actually spawn: a 31-point
    // deficit holding {32 charged, 40 free}. The charged row fits to within 1 point,
    // the free one overshoots by 9 — and 9 food points is 112 s of clock at
    // kFoodDrainPerSec. Fit-first spent 6 HP to buy those 112 s.
    inv.clear();
    inv.slots[0] = ItemSlot{riskyLarge, 1};
    inv.slots[1] = ItemSlot{freeLarge, 1};
    const std::int16_t hpBeforeC = rig.pool.hp(rig.id);
    rig.needs().food = kNeedMax - static_cast<float>(item_def(riskyLarge).useA) + 1.0f;
    const ConsumeResult r2 = use_best_food(rig.reg, rig.pool, rig.bus, 0, 3u);
    CHECK(r2.used && r2.item == freeLarge);
    CHECK(r2.hpCost == 0 && rig.pool.hp(rig.id) == hpBeforeC);
    CHECK(inv.slots[0].item == riskyLarge);     // still in the bag, still unpaid for

    // D — key 2 inside the free class: smallest that COVERS, so a 40-point ration is
    // not spent on a 6-point hole. The big one sits in the LOWER slot on purpose — a
    // lowest-index bias would pass a version of this test that put it second.
    inv.clear();
    inv.slots[0] = ItemSlot{freeLarge, 1};
    inv.slots[1] = ItemSlot{freeSmall, 1};
    rig.needs().food = kNeedMax - static_cast<float>(item_def(freeSmall).useA);
    const ConsumeResult r3 = use_best_food(rig.reg, rig.pool, rig.bus, 0, 4u);
    CHECK(r3.used && r3.item == freeSmall);
    CHECK(inv.slots[0].item == freeLarge);      // NOT wasted
    CHECK(approx(rig.needs().food, kNeedMax, 1e-3f));

    // E — key 2's fallback: a deficit nothing covers takes the largest FREE row.
    inv.clear();
    inv.slots[0] = ItemSlot{freeSmall, 1};
    inv.slots[1] = ItemSlot{freeLarge, 1};
    rig.needs().food = 1.0f;                    // 99 short; neither row covers it
    const ConsumeResult r4 = use_best_food(rig.reg, rig.pool, rig.bus, 0, 5u);
    CHECK(r4.used && r4.item == freeLarge);
    CHECK(inv.slots[0].item == freeSmall);

    // F — CHARGED FOOD STAYS REACHABLE. Key 1 that refused to eat it must not become
    // "never eats it", which would be the opposite defect: with only infected_mushroom
    // in the bag at 0 food, 12 points for 6 HP beats 0.3 HP/s forever. So when the
    // charged class is the ONLY class present it is chosen, and the HP really is billed
    // through apply_damage rather than reported and forgotten.
    inv.clear();
    inv.slots[0] = ItemSlot{riskySmall, 1};
    const std::int16_t hpBeforeF = rig.pool.hp(rig.id);
    rig.needs().food = 0.0f;
    const ConsumeResult r5 = use_best_food(rig.reg, rig.pool, rig.bus, 0, 6u);
    CHECK(r5.used && r5.item == riskySmall);
    CHECK(r5.hpCost == kRiskyFeedHpCost);
    CHECK(rig.pool.hp(rig.id) == hpBeforeF - kRiskyFeedHpCost);
    CHECK(rig.needs().food > 0.0f);             // ...and it still feeds you
    CHECK(!rig.reg.all_of<Dead>(rig.body));     // a meal is never lethal

    // G — the other bar. Key 1 is INERT on drinks and that is the fact that makes the
    // divergence from use_best_heal safe: not one of the 8 hydrating rows charges HP,
    // so the drink path is still pure key 2 and nothing about it changed.
    ItemId chargedDrinkSmall = kInvalidItem, chargedDrinkLarge = kInvalidItem;
    extremes_for(/*hydrating=*/true, Cost::Charged, chargedDrinkSmall,
                 chargedDrinkLarge);
    CHECK(chargedDrinkSmall == kInvalidItem && chargedDrinkLarge == kInvalidItem);

    ItemId smallDrink = kInvalidItem, largeDrink = kInvalidItem;
    extremes_for(/*hydrating=*/true, Cost::Any, smallDrink, largeDrink);
    CHECK(smallDrink != kInvalidItem && largeDrink != kInvalidItem);
    CHECK(item_def(largeDrink).useA > item_def(smallDrink).useA);
    inv.clear();
    inv.slots[0] = ItemSlot{smallDrink, 2};
    inv.slots[1] = ItemSlot{freeLarge, 1};      // food, must be ignored
    rig.needs().water = kNeedMax - static_cast<float>(item_def(smallDrink).useA);
    const ConsumeResult r6 = use_best_drink(rig.reg, rig.pool, rig.bus, 0, 7u);
    CHECK(r6.used && r6.item == smallDrink && r6.water > 0.0f);
    CHECK(inv.slots[0].count == 1);             // one unit off a stack
    CHECK(inv.slots[1].item == freeLarge);      // the food was not drunk

    // Nothing edible left: an honest false, not a silent no-op that claims success.
    inv.clear();
    rig.needs().food = 1.0f;
    CHECK(!use_best_food(rig.reg, rig.pool, rig.bus, 0, 8u).used);
    // No camera holder on the layer means nobody to feed.
    CHECK(!use_best_food(rig.reg, rig.pool, rig.bus, 99, 9u).used);

    // Every use publishes ItemTransferred, the way a spent bandage does — six uses,
    // six events, and the charged one is billed as ITSELF rather than as the free row
    // that was declined. apply_damage publishes nothing (only finalize_deaths does),
    // so case F's 6 HP adds no event.
    CHECK(rig.bus.size() == 6);
    CHECK(rig.bus.events()[0].type == EventType::ItemTransferred);
    CHECK(rig.bus.events()[0].a == rig.id && rig.bus.events()[0].c == freeLarge);
    CHECK(rig.bus.events()[4].c == riskySmall);
    CHECK(rig.bus.events()[5].c == smallDrink);
}

void pressure() {
    // With an empty pending queue the pressures do not move at all, for an hour. That
    // is what makes them a tax on drinking rather than an unavoidable timer.
    Needs idle = full_clock();
    idle.pee = 40.0f;
    idle.poo = 20.0f;
    for (int i = 0; i < 4 * 3600; ++i) needs_advance(idle, kRefPeriod);
    CHECK(idle.pee == 40.0f && idle.poo == 20.0f);
    CHECK((needs_failed_mask(idle) & (NeedPee | NeedPoo)) == 0);

    // Drinking queues pressure, which meters out at the digest rate, drains to empty
    // and stops — never negative. Poo lingers longer than pee.
    Needs n = full_clock();
    n.pendingPee = 30.0f;
    needs_advance(n, 10.0f);
    CHECK(approx(n.pee, 10.0f * kPeeDigestPerSec, 1e-4f));
    CHECK(approx(n.pendingPee, 30.0f - 10.0f * kPeeDigestPerSec, 1e-4f));
    for (int i = 0; i < 4 * 3600; ++i) needs_advance(n, kRefPeriod);
    CHECK(n.pendingPee == 0.0f);
    CHECK(approx(n.pee, 30.0f, 1e-3f));
    static_assert(kPooDigestPerSec < kPeeDigestPerSec, "food lingers, water does not");

    // Overflow caps at 100 and costs kOverflowHpPerSec per failing pressure.
    Needs over = full_clock();
    over.pee = 99.0f;
    over.pendingPee = 50.0f;
    needs_advance(over, 100.0f);
    CHECK(over.pee == kNeedMax);   // clamped; no backlog kept above 100
    CHECK((needs_failed_mask(over) & NeedPee) != 0);
    CHECK(approx(needs_hp_rate(over), kOverflowHpPerSec, 1e-6f));

    // Relief reports what actually came off, so "you did not need to" is
    // distinguishable from "that helped" — and it is partial by design.
    const ReliefResult r = relieve_needs(over, kToiletPeeRelief, kToiletPooRelief);
    CHECK(approx(r.pee, kToiletPeeRelief, 1e-4f));
    CHECK(r.poo == 0.0f);          // there was nothing to relieve
    CHECK(approx(over.pee, kNeedMax - kToiletPeeRelief, 1e-4f));
    CHECK(needs_hp_rate(over) == 0.0f && over.pee > 0.0f);
    const ReliefResult again = relieve_needs(over, 1000.0f, 0.0f);
    CHECK(approx(again.pee, kNeedMax - kToiletPeeRelief, 1e-4f));   // clamped, honest
    CHECK(over.pee == 0.0f);
    CHECK(relieve_needs(over, 0.0f, 0.0f).pee == 0.0f);

    // End to end: drinking enough water WILL eventually cost you HP. That is the
    // pacing tax on chugging.
    const ItemId water = first_with_effect(UseEffect::Drink);
    Needs chug = full_clock();
    chug.pee = kStartPeeHi;
    for (int i = 0; i < 8; ++i) {
        chug.water = 0.0f;   // pretend a long trip between bottles
        apply_consumable(chug, water, 100);
    }
    CHECK(chug.pendingPee > 0.0f);
    for (int i = 0; i < 4 * 3600; ++i) needs_advance(chug, kRefPeriod);
    CHECK(chug.pee == kNeedMax);
    CHECK((needs_failed_mask(chug) & NeedPee) != 0);
}

void survives_the_body_swap() {
    // THE reason the clock is a pool column and not an ECS component: an elevator ride
    // destroys the player's entity and builds a new one, so a component would go with
    // it and the clock would restart on every floor change.
    NpcPool pool;
    pool.init();
    Registry reg;
    FloorRegistry floors;
    floors.assign(0, static_cast<ModuleId>(0));
    floors.set_resident(static_cast<ModuleId>(0), 0u);
    floors.assign(1, static_cast<ModuleId>(1));
    floors.set_resident(static_cast<ModuleId>(1), 1u);

    const NpcId id = pool.spawn();
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    pool.height_mm(id) = 1750;
    pool.cz(id) = 1;
    Entity body = embody_as_player(reg, pool, id, 0);

    // Half a trip's worth of clock, including exhaustion and an unpaid HP fraction.
    Needs& n = pool.needs(id);
    n = full_clock();
    n.water = 41.0f;
    n.food = 63.0f;
    n.sleep = 7.0f;
    n.pendingPee = 9.0f;
    n.hpDebt = 0.5f;

    const RideResult up = ride_elevator(reg, pool, floors, body, 0, +1, 2);
    CHECK(up.moved);
    CHECK(!reg.valid(body));     // the old body really is gone
    CHECK(up.player != body);    // and this is a different entity
    CHECK(reg.get<NpcRef>(up.player).id == id);

    const Needs& after = pool.needs(id);
    CHECK(after.water == 41.0f && after.food == 63.0f && after.sleep == 7.0f);
    CHECK(after.pendingPee == 9.0f && after.hpDebt == 0.5f);
    CHECK(after.seeded == 1);    // and it is NOT re-rolled onto the new body

    // The clock keeps running on the new floor, on the new body, and exhaustion
    // carried across — the speed penalty does not lift for free.
    const NeedsTick t = needs_step(reg, pool, up.layer, 10.0f);
    CHECK(t.ticked && pool.needs(id).water < 41.0f);
    CHECK(t.speedScale == kSleepExhaustedSpeedScale);
}

// THIS TEST REPLACES `only_the_player_starves`, WHICH WAS GREEN AND IS NOW WRONG.
// The old one asserted, for each of 63 residents, `seeded == 0`, `food == 0` and
// `hp == 100 && alive` — i.e. that the survival clock deliberately skipped the crowd.
// That was the correct invariant while nothing could walk an NPC to a kitchen, and
// [needs.h] said so in writing, naming the exact condition for widening it: "widen it
// when the utility AI (#12) can walk an NPC to a kitchen, not before".
//
// It can now ([room_zone.h], [ai.h], [problems.md] §27 legs (a)-(c); measured in
// suite_rooms: 64 of 64 starving bodies standing in a kitchen 40 s later). So the old
// assertions are not PINNED PAST A FAILURE ([AGENTS.md] "NEVER PIN A FAILING SUITE"),
// they are retired by their own stated condition, and what replaces them is the pair
// of facts that make the widening safe rather than lethal:
//
//   * without rooms the crowd DIES, and this test measures that rather than assuming
//     it — the ~14-minute population wipe is a real number, not a worry;
//   * with rooms it does not.
//
// Running both arms is the whole point. An ambient-recovery bug would otherwise turn
// the building into a morgue silently, over minutes, with every other test green.
void the_whole_floor_lives_on_one_clock() {
    NpcPool pool;
    pool.init();
    Registry reg;

    const NpcId playerId = seed_floor_population(pool, /*floor=*/0, /*n=*/64,
                                                 /*seed=*/5u);
    CHECK(playerId != kInvalidNpc && pool.count() == 64u);
    for (NpcId i = 0; i < pool.count(); ++i) {
        pool.hp(i) = 100;
        pool.max_hp(i) = 100;
        if (i != playerId) embody(reg, pool, i, 0);
    }
    CHECK(embody_as_player(reg, pool, playerId, 0) != entt::null);

    // ONE STEP is enough to see the seeding rule: everybody's clock is now live.
    const NeedsTick first = needs_step(reg, pool, 0, kRefPeriod);
    CHECK(first.ticked);            // the camera holder's report is unchanged in shape
    CHECK(first.bodies == 64u);     // ...and 64 clocks moved, not 1
    CHECK(first.recovering == 0u);  // no rooms passed: nothing restores

    // THE CAMERA HOLDER STARTS ITS TRIP AT THE TOP — `needs_roll`'s 70..100 band,
    // undisturbed, because "the body you wake up in decides how long your first trip
    // can be" is a player-facing design decision this widening must not quietly move.
    CHECK(pool.needs(playerId).seeded == 1);
    CHECK(pool.needs(playerId).water > kStartWaterLo - 1.0f);

    // A RESIDENT IS BORN PARTWAY THROUGH ITS OWN DAY. Two properties, both of which a
    // constant phase or a broken hash would fail: the spread is REAL, and nobody is
    // born already failing (the `kResidentPhaseMaxSec` derivation).
    float lo = kNeedMax, hi = 0.0f;
    int crowd = 0;
    for (NpcId i = 0; i < pool.count(); ++i) {
        if (i == playerId) continue;
        ++crowd;
        const Needs& n = pool.needs(i);
        CHECK(n.seeded == 1);
        CHECK(n.water > 0.0f && n.food > 0.0f); // thirsty is allowed, failing is not
        if (n.water < lo) lo = n.water;
        if (n.water > hi) hi = n.water;
    }
    CHECK(crowd == 63);
    std::printf("[needs] resident phase spread: water %.1f .. %.1f over %d bodies\n",
                static_cast<double>(lo), static_cast<double>(hi), crowd);
    CHECK(hi - lo > 30.0f); // a constant phase would make this 30 (the roll band alone)

    // ARM 1 — NO ROOMS. Twenty-five minutes with nothing to drink is a morgue, and
    // that is exactly the cost [needs.h] refused to pay before legs (a)-(c) existed.
    for (int i = 0; i < 25 * 60 * 4; ++i) needs_step(reg, pool, 0, kRefPeriod);
    // COUNTED ON hp, NOT ON `alive`. `apply_damage` writes hp and nothing else; the
    // `Dead` tag and the pool's alive bit are set one pass later by
    // `finalize_deaths`, which is the single-death-point contract [combat.h]
    // describes and which this harness deliberately does not run. Asserting on
    // `alive` here would have read 0 dead out of a building that is entirely dead —
    // a metric that passes while the thing it grades fails ([AGENTS.md]).
    int deadNoRooms = 0;
    for (NpcId i = 0; i < pool.count(); ++i)
        if (pool.hp(i) <= 0) ++deadNoRooms;
    std::printf("[needs] 25 min WITHOUT rooms: %d of 64 at zero HP\n", deadNoRooms);
    CHECK(deadNoRooms > 32); // most of the building

    // ARM 2 — THE SAME 25 MINUTES, OBEYING THE SCORER. Not "parked in a kitchen":
    // parking there for 25 minutes KILLS you, and correctly — the kitchen queues
    // 2.1 pee/s and 1.225 poo/s of digestion ([room_zone.h] "the kitchen charges for
    // itself"), so a body that eats forever and never leaves drowns in its own
    // bladder at 0.2 HP/s. Measured that way first, and it is the loop working, not
    // a bug. What this arm asserts is the CLOSED LOOP:
    //
    //   needs -> score_intents -> intent_room_mask -> the room -> room_recover -> needs
    //
    // Every link is the shipping one; the only thing the harness stands in for is
    // the walking, which suite_rooms measures separately (64 of 64 arrive). So this
    // is §27's whole pillar, end to end, headless, in one loop.
    NpcPool pool2;
    pool2.init();
    Registry reg2;
    const NpcId p2 = seed_floor_population(pool2, /*floor=*/0, /*n=*/64, /*seed=*/5u);
    RoomZones zones;
    zones.kind = FloorKind::Residential;
    zones.number = 0;

    // One cell of each room kind the affordance table names, plus a corridor for the
    // bodies whose winning intent has no destination. `needs_step` reads only
    // `kind`/`number` off the zones, so no bake is needed to ask what a cell is.
    int cellX[kFloorRoomBits] = {}, cellY[kFloorRoomBits] = {};
    int corridorX = 0, corridorY = 0;
    for (int y = 1; y < kMacroDim; ++y) {
        if (y % 4 == 0) continue;
        for (int x = 1; x < kMacroDim; ++x) {
            if (x % 4 == 0) continue;
            const int bi = floor_room_bit_index(
                room_bit_at(zones.kind, zones.number, x, y));
            if (bi < 0) continue;
            if (cellX[bi] == 0) { cellX[bi] = x; cellY[bi] = y; }
            if (corridorX == 0 &&
                room_bit_at(zones.kind, zones.number, x, y) ==
                    static_cast<std::uint16_t>(RoomBit::Corridor)) {
                corridorX = x;
                corridorY = y;
            }
        }
    }
    CHECK(cellX[floor_room_bit_index(static_cast<std::uint16_t>(RoomBit::Kitchen))] != 0);
    CHECK(cellX[floor_room_bit_index(static_cast<std::uint16_t>(RoomBit::Bathroom))] != 0);
    CHECK(corridorX != 0);

    std::vector<Entity> ents;
    for (NpcId i = 0; i < pool2.count(); ++i) {
        pool2.hp(i) = 100;
        pool2.max_hp(i) = 100;
        Entity e = (i == p2) ? embody_as_player(reg2, pool2, i, 0)
                             : embody(reg2, pool2, i, 0);
        CHECK(e != entt::null);
        reg2.get<Transform>(e).layer = 0;
        ents.push_back(e);
    }

    NeedsTick last{};
    int visitedKitchen = 0, visitedBathroom = 0;
    for (int t = 0; t < 25 * 60 * 4; ++t) {
        for (NpcId i = 0; i < pool2.count(); ++i) {
            // The REAL scorer on the REAL row, with every stubbed Perception input at
            // its default — the same call `ai_step` makes on a re-plan.
            Perception p;
            p.idSeed = identity_seed(i);
            p.faction = pool2.faction(i);
            p.hp = static_cast<float>(pool2.hp(i));
            p.maxHp = static_cast<float>(pool2.max_hp(i));
            float scores[kIntentCount];
            score_intents(p, pool2.needs(i), scores);
            const std::uint16_t want = intent_room_mask(select_intent_raw(scores));
            const int bi = want != 0 ? floor_room_bit_index(want) : -1;
            const int gx = (bi >= 0 && cellX[bi] != 0) ? cellX[bi] : corridorX;
            const int gy = (bi >= 0 && cellX[bi] != 0) ? cellY[bi] : corridorY;
            if (bi >= 0 && want == static_cast<std::uint16_t>(RoomBit::Kitchen))
                ++visitedKitchen;
            if (bi >= 0 && want == static_cast<std::uint16_t>(RoomBit::Bathroom))
                ++visitedBathroom;
            Transform& tr = reg2.get<Transform>(ents[i]);
            tr.pos = vec3{(static_cast<float>(gx) + 0.5f) * kCellSize,
                          (static_cast<float>(gy) + 0.5f) * kCellSize, 8.0f};
        }
        last = needs_step(reg2, pool2, 0, kRefPeriod, &zones);
    }

    int hurt = 0, minHp = 100;
    for (NpcId i = 0; i < pool2.count(); ++i) {
        if (pool2.hp(i) < 100) ++hurt;
        if (pool2.hp(i) < minHp) minHp = pool2.hp(i);
    }
    std::printf("[needs] 25 min OBEYING THE SCORER: %d of 64 lost HP (min %d), "
                "%d kitchen-seconds, %d bathroom-seconds, %u recovering\n",
                hurt, minHp, visitedKitchen / 4, visitedBathroom / 4,
                last.recovering);
    // NOBODY DIES, and the building is not merely alive — it is UNSCRATCHED. The
    // same 25 minutes that takes all 64 bodies to zero HP with no rooms costs a
    // crowd that goes where it wants exactly nothing.
    CHECK(hurt == 0);
    CHECK(minHp == 100);
    // BOTH rooms are used, in both directions. A crowd that only ever ate would pass
    // an "alive" check for a while and then die of the thing it never went to fix.
    CHECK(visitedKitchen > 0);
    CHECK(visitedBathroom > 0);

    // Nothing embodied on a layer means no clock at all — an unloaded floor is not
    // secretly running its own survival sim. A zero dt is a no-op, not a rewind.
    const NeedsTick none = needs_step(reg, pool, 77, kRefPeriod);
    CHECK(!none.ticked && none.hpLost == 0 && none.speedScale == 1.0f);
    CHECK(none.bodies == 0u);
    CHECK(!needs_step(reg, pool, 0, 0.0f).ticked);
}

} // namespace needs_test

static void test_needs_all() {
    needs_test::roll();
    needs_test::survival_window();
    needs_test::warning_lead();
    needs_test::attrition();
    needs_test::sleep_costs_speed();
    needs_test::consumption();
    needs_test::use_best();
    needs_test::pressure();
    needs_test::survives_the_body_swap();
    needs_test::the_whole_floor_lives_on_one_clock();
}
