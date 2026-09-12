// Needs, part 2 — THE PRESSURE CLOCK AND THE SELECTION RULE, both measured rather
// than asserted from the constants they are derived from. Included into game_test.cpp,
// so it uses that file's CHECK macro and its `using namespace giga::game`; everything
// except the single entry point `test_needs2_all()` lives in `namespace needs2_test`.
//
// suite_needs.inl already pins the reserves (food/water/sleep), the attrition table
// and the warning leads. This file exists for the half those tests could not reach
// until consumption was wired:
//
//   * `pee` and `poo` have NO autonomous growth. Before `use_best_food` /
//     `use_best_drink` had a call site, `pendingPee` and `pendingPoo` had no producer
//     outside a test, so the whole metering path was dead weight and the numbers in it
//     had never been checked against a clock a player would experience.
//   * The metering RATE, not intake, is the limiter, and that is worth pinning
//     separately because it is counter-intuitive: chugging eight bottles does not
//     bring a bladder emergency forward by one second past 88.0 / 0.10 = 880 s.
//   * `digest` DESTROYS whatever does not fit under the 100 cap. Any assertion of the
//     shape `pee == start + queued` is therefore wrong for `start + queued > 100`,
//     permanently, at any dt and any elapsed time — not merely "not yet".
//   * The cost-first selection rule ([needs.h]) is counted here across every deficit
//     the food bar can hold, so "how often would fit-first ranking have spent HP" is a
//     number read out of data/items.csv rather than an argument.
#include "game/needs.h"
#include "game/embody.h"

namespace needs2_test {

// The reference's own needs period. Every measurement below is driven at this step so
// dt granularity is explicit in the bounds rather than hidden inside them.
constexpr float kStep = 0.25f;

Needs full_clock() {
    Needs n{};
    n.food = kNeedMax;
    n.water = kNeedMax;
    n.sleep = kNeedMax;
    n.seeded = 1;
    return n;
}

bool approx(float a, float b, float tol) {
    const float d = a - b;
    return (d < 0.0f ? -d : d) <= tol;
}

void advance_seconds(Needs& n, float seconds) {
    const int steps = static_cast<int>(seconds / kStep + 0.5f);
    for (int i = 0; i < steps; ++i) needs_advance(n, kStep);
}

// Largest useA among the rows serving one appetite that cost no HP. No item id is
// hardcoded in this file — the table is the source ([AGENTS.md]).
ItemId largest_free(bool hydrating) {
    ItemId best = kInvalidItem;
    std::int16_t hi = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        if (hydrating ? !item_hydrates(id) : !item_feeds(id)) continue;
        if (consumable_hp_cost(id) != 0) continue;
        const std::int16_t a = item_def(id).useA;
        if (a <= 0) continue;
        if (best == kInvalidItem || a > hi) { best = id; hi = a; }
    }
    return best;
}

// ---------------------------------------------------------------------------
// The metering rate, and the two ways a queue fails to land
// ---------------------------------------------------------------------------
void queue_metering_rate() {
    const ItemId bottle = largest_free(/*hydrating=*/true);
    CHECK(bottle != kInvalidItem);
    const float a = static_cast<float>(item_def(bottle).useA);   // filtered_water, 35
    const float perBottle = a * kDrinkPeeShare;                  // 21.0 points
    CHECK(a >= 30.0f);   // so the 8-bottle case below really does overrun the cap

    // ONE BOTTLE, ALL OF IT LANDS. The queue needs exactly
    // `pendingPee / kPeeDigestPerSec` seconds — 21.0 / 0.10 = 210 s — and the time is
    // MEASURED off the clock here rather than asserted from the constant it came from.
    // Drinking at a full water bar restores nothing and still bills the full bladder
    // charge; that is the label-billing rule ([needs.h]) and it is what makes this a
    // clean single-queue measurement.
    Needs one = full_clock();
    one.pee = 0.0f;
    const ConsumeResult sip = apply_consumable(one, bottle, 1000);
    CHECK(sip.used && approx(sip.peeQueued, perBottle, 1e-3f));
    CHECK(approx(one.pendingPee, perBottle, 1e-3f) && one.pee == 0.0f);
    float t = 0.0f;
    for (int i = 0; i < 1440000 && one.pendingPee > 0.0f; ++i) {
        needs_advance(one, kStep);
        t += kStep;
    }
    // Asymmetric on purpose: the loop can only ever OVERSHOOT the exact 210 s, by the
    // step that carries the last fraction of the queue across zero.
    CHECK(t >= perBottle / kPeeDigestPerSec);
    CHECK(t <= perBottle / kPeeDigestPerSec + 2.0f * kStep);
    CHECK(approx(one.pee, perBottle, 1e-3f));                       // all 21.0 landed

    // EIGHT BOTTLES FROM A HALF-FULL BLADDER — queued is 8 * 21.0 = 168.0
    // points, and the RATE still rules: 600 s meters kPeeDigestPerSec * 600 =
    // 60.0 points; 108.0 of the queue is still owed, and the queue as a whole
    // needs 168.0 / 0.10 = 1680 s = 28 min.
    //
    // НЕВОЛЬНОЕ ОБЛЕГЧЕНИЕ (закон владельца 2026-08-28) СМЕНИЛО СУДЬБУ
    // КЛАМПА: бар, дошедший до 100, не стоит и не платит HP — клок сливает
    // его сам, и очередь продолжает метериться в пустое. Точки больше НЕ
    // уничтожаются об кап: 50 стартовых + все 168 из очереди в итоге
    // проходят через тело — 200 в двух сливах, 18 остаются на баре.
    Needs run = full_clock();
    run.pee = 50.0f;
    float queued = 0.0f;
    for (int i = 0; i < 8; ++i) {
        run.water = 0.0f;   // pretend a long trip between bottles
        queued += apply_consumable(run, bottle, 1000).peeQueued;
    }
    CHECK(approx(queued, 8.0f * perBottle, 1e-3f));          // 168.0
    CHECK(approx(run.pendingPee, queued, 1e-3f));
    CHECK(50.0f + queued > kNeedMax);                        // кап встретится
    CHECK(queued > kPeeDigestPerSec * 600.0f);               // и rate тоже

    // Top the other bars back up before running the clock: the loop above
    // zeroes water eight times, and 600 s of drain would fail NeedWater and
    // pollute the rate assertion below. Isolating the need under test.
    run.food = kNeedMax;
    run.water = kNeedMax;
    run.sleep = kNeedMax;

    advance_seconds(run, 600.0f);
    // Бар дошёл до капа на 500-й секунде (50 + 0.1*500) и СЛИЛСЯ; остальные
    // 100 с метерились в пустой: 10.0 на баре. 0.05 of a point, not tighter:
    // 2400 float subtractions accumulate up to ~0.018.
    CHECK(approx(run.pee, 10.0f, 0.05f));
    CHECK(approx(run.pendingPee, queued - kPeeDigestPerSec * 600.0f, 0.05f));  // 108.0
    CHECK((needs_failed_mask(run) & NeedPee) == 0);   // кап — событие, не состояние
    CHECK(needs_hp_rate(run) == 0.0f);                // урона от давлений нет

    // Дожить очередь до конца: ещё один слив на 1500-й секунде общего пути,
    // остаток 218 - 200 = 18.0 на баре, очередь пуста. Допуск шире (0.3):
    // ещё 14400 вычитаний дрейфа.
    advance_seconds(run, 3600.0f);
    CHECK(run.pendingPee == 0.0f);
    CHECK(approx(run.pee, 18.0f, 0.3f));

    // A queue that fits UNDER the cap loses nothing and holds nothing back;
    // one that crosses it voids once and keeps the remainder: 21.0 onto a
    // 90.0 bar crosses at +10.0, voids, and lands the other 11.0.
    Needs tight = full_clock();
    tight.pee = kNeedMax - 10.0f;
    tight.pendingPee = perBottle;
    advance_seconds(tight, 3600.0f);
    CHECK(approx(tight.pee, perBottle - 10.0f, 0.05f));   // 11.0
    CHECK(tight.pendingPee == 0.0f);   // spent, not held as a backlog
}

// ---------------------------------------------------------------------------
// Is the pressure clock something a player can feel?
// ---------------------------------------------------------------------------
void pressure_clock_is_feelable() {
    // THE FLOOR, AND IT CANNOT BE BROKEN BY INTAKE. Metering is the limiter, so from an
    // empty bladder the earliest kPeeWarnAt can arrive is 88.0 / 0.10 = 880 s =
    // 14.67 min however many bottles go in first, and kPooWarnAt is
    // 92.8 / 0.06 = 1546.7 s = 25.78 min. Neither is "seconds"; neither is "hours".
    CHECK(approx(kPeeWarnAt / kPeeDigestPerSec, 880.0f, 1e-2f));
    CHECK(approx(kPooWarnAt / kPooDigestPerSec, 1546.67f, 0.05f));

    Needs flood = full_clock();
    flood.pendingPee = 1000.0f;   // absurd intake: 47 bottles' worth
    flood.pendingPoo = 1000.0f;
    float tPee = 0.0f;
    for (int i = 0; i < 1440000 && (needs_warn_mask(flood) & NeedPee) == 0; ++i) {
        needs_advance(flood, kStep);
        tPee += kStep;
    }
    // 1.0 s of slack, not tighter: the warning fires on the first step STRICTLY past
    // kPeeWarnAt, and 3520 steps of 0.025 accumulate up to ~0.013 points of rounding.
    CHECK(approx(tPee, kPeeWarnAt / kPeeDigestPerSec, 1.0f));
    CHECK(tPee > 840.0f && tPee < 920.0f);

    // ONE MEAL CANNOT DO IT, which is what makes pee/poo a tax on consumption rather
    // than a second timer. The largest free feeding row is liquidator_ration (useA 40):
    // 40 * 0.7 = 28.0 poo and 40 * 0.3 = 12.0 pee. From the worst possible roll
    // (kStartPeeHi = 30, kStartPooHi = 20) that is 42.0 and 48.0 — and then it STOPS,
    // for as long as you like, because an empty queue is not a clock.
    const ItemId ration = largest_free(/*hydrating=*/false);
    CHECK(ration != kInvalidItem && item_def(ration).useA >= 40);
    Needs meal = full_clock();
    meal.pee = kStartPeeHi;
    meal.poo = kStartPooHi;
    meal.food = 0.0f;
    const ConsumeResult ate = apply_consumable(meal, ration, 100);
    CHECK(ate.used && ate.hpCost == 0);
    advance_seconds(meal, 3600.0f);
    CHECK(approx(meal.pee, kStartPeeHi + ate.peeQueued, 1e-2f));   // 42.0
    CHECK(approx(meal.poo, kStartPooHi + ate.pooQueued, 1e-2f));   // 48.0
    CHECK(needs_warn_mask(meal) == (NeedFood | NeedWater | NeedSleep));
    CHECK((needs_warn_mask(meal) & (NeedPee | NeedPoo)) == 0);
    // Three such meals is what it takes from that start: (92.8 - 20) / 28.0 = 2.6.
    CHECK(static_cast<int>((kPooWarnAt - kStartPooHi) / ate.pooQueued) + 1 == 3);

    // THE REALISTIC PATH. Surviving past the water window means drinking, and drinking
    // puts the bladder on a rail: inflow is kWaterDrainPerSec * kDrinkPeeShare =
    // 0.072 points/s whatever bottle is used, because what is queued is proportional to
    // what was drunk. From the mid roll (pee 15) that is (88 - 15) / 0.072 = 1013.9 s =
    // 16.9 min to the warning, and (100 - 15) / 0.072 = 1180.6 s = 19.7 min to
    // overflow. Bowel: (92.8 - 10) / (0.08 * 0.7) = 1478.6 s = 24.6 min.
    //
    // Against suite_needs.inl's windows — water 9.7..13.9 min, food 14.6..20.8 min —
    // that is the right ORDERING: each pressure lands after the reserve whose refill
    // creates it has already forced the player to act once. A survival clock nobody can
    // feel would be one where these arrived first (a bathroom timer) or never (dead
    // constants). Neither is the case.
    CHECK(approx((kPeeWarnAt - 15.0f) / (kWaterDrainPerSec * kDrinkPeeShare) / 60.0f,
                 16.90f, 0.05f));
    CHECK(approx((kNeedMax - 15.0f) / (kWaterDrainPerSec * kDrinkPeeShare) / 60.0f,
                 19.68f, 0.05f));
    CHECK(approx((kPooWarnAt - 10.0f) / (kFoodDrainPerSec * kFeedPooShare) / 60.0f,
                 24.64f, 0.05f));

    // Measured by running that trip rather than by arithmetic: drink whenever a whole
    // bottle would fit, and record when the bladder warns. The run must land AFTER the
    // rail (it cannot drink before the bar has room) and within one bottle-interval of
    // it (a / kWaterDrainPerSec = 291.7 s for the 35-point bottle). Hand-computed
    // expectation is 21.1 min; the band is wider than that because it has not been run.
    const ItemId bottle = largest_free(/*hydrating=*/true);
    const float bottleA = static_cast<float>(item_def(bottle).useA);
    const float rail = (kPeeWarnAt - 15.0f) / (kWaterDrainPerSec * kDrinkPeeShare);
    const float interval = bottleA / kWaterDrainPerSec;
    Needs trip = full_clock();
    trip.pee = 15.0f;
    int bottles = 0;
    float tTrip = 0.0f;
    for (int i = 0; i < 1440000 && (needs_warn_mask(trip) & NeedPee) == 0; ++i) {
        if (kNeedMax - trip.water >= bottleA) {
            apply_consumable(trip, bottle, 1000);
            ++bottles;
        }
        needs_advance(trip, kStep);
        tTrip += kStep;
    }
    CHECK(tTrip > rail);
    CHECK(tTrip < rail + 2.0f * interval);
    CHECK(tTrip / 60.0f > 15.0f && tTrip / 60.0f < 25.0f);
    // FOUR bottles — hand-traced: drinks land at 291.75, 583.5, 875.25 and 1167.0 s
    // (one every bottleA / kWaterDrainPerSec = 291.7 s), and the fourth queue carries
    // pee from 78 across 88 at t = 1267 s. That is a plausible haul, not a hoarder's:
    // filtered_water carries spawn weight 1000 in KITCHEN, MEDICAL and STORAGE.
    CHECK(bottles >= 3 && bottles <= 6);
    // And the reserve it was bought for never failed on the way: the pressure arrives
    // while the player is still winning the fight against thirst, which is what makes
    // it a cost of playing well rather than a second way to lose.
    CHECK(trip.water > 0.0f);

    // ЗАКРЫТЫЙ GAP (2026-08-28): у relieve_needs теперь есть вызывающий
    // (клавиша P), а «застрять на капе» невозможно по построению — клок
    // сливает давление сам (невольное облегчение), урона от давлений нет.
    Needs stuck = full_clock();
    stuck.pee = kNeedMax;
    stuck.poo = kNeedMax;
    CHECK(needs_hp_rate(stuck) == 0.0f);   // даже рукой поставленный кап нем
    ReliefResult burst;
    needs_advance(stuck, kStep, &burst);
    CHECK(burst.pee >= kNeedMax && burst.poo >= kNeedMax); // слились оба
    CHECK(stuck.pee < 1.0f && stuck.poo < 1.0f);
}

// ---------------------------------------------------------------------------
// Cost-first selection, counted over the whole deficit domain
// ---------------------------------------------------------------------------
// Fit-first ranking as a pure function of the table, so "how often would the OLD rule
// have reached for HP" is counted from data/items.csv rather than argued. `preferFree`
// resolves an exact tie in useA: the old rule resolved ties by slot index, i.e. by
// pickup order, so both resolutions are reachable in a real bag and both are counted.
ItemId fit_first_pick(float missing, bool preferFree) {
    ItemId best = kInvalidItem;
    std::int16_t bestAmt = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        if (!item_feeds(id)) continue;
        const std::int16_t a = item_def(id).useA;
        if (a <= 0) continue;
        if (best == kInvalidItem) { best = id; bestAmt = a; continue; }
        const bool bestCovers = static_cast<float>(bestAmt) >= missing;
        const bool thisCovers = static_cast<float>(a) >= missing;
        if (thisCovers && (!bestCovers || a < bestAmt)) { best = id; bestAmt = a; }
        else if (!thisCovers && !bestCovers && a > bestAmt) { best = id; bestAmt = a; }
        else if (a == bestAmt) {
            const bool thisFree = consumable_hp_cost(id) == 0;
            const bool bestFree = consumable_hp_cost(best) == 0;
            if (thisFree != bestFree && thisFree == preferFree) best = id;
        }
    }
    return best;
}

void cost_first_over_every_deficit() {
    // HOW OFTEN FIT-FIRST RANKING BUYS A TIGHTER FIT WITH HEALTH, as a count over the
    // 100 integer deficits the food bar can hold, with all 21 feeding rows available:
    //
    //   deficit 1..4    -> sand_spoiled_ration (useA 4)          ALWAYS charged
    //   deficit 31..32  -> experimental_concentrate (useA 32)    ALWAYS charged
    //   deficit 9..10   -> zhelemish_raw (10) TIES rawmeat (10)      slot order
    //   deficit 11..12  -> infected_mushroom (12) TIES soup_cube (12) slot order
    //
    // 6 of 100 guaranteed, 10 of 100 in the unlucky pickup order, at kRiskyFeedHpCost
    // = 6 HP a press. The two tie bands are the ones that make the case unarguable: the
    // tighter fit there is worth exactly ZERO food points, and it still costs 6 HP plus
    // 3.0 extra points of queued bowel (kRiskyPooShare 1.0 against kFeedPooShare 0.7).
    int chargedLucky = 0, chargedUnlucky = 0;
    for (int d = 1; d <= 100; ++d) {
        const float missing = static_cast<float>(d);
        if (consumable_hp_cost(fit_first_pick(missing, true)) > 0) ++chargedLucky;
        if (consumable_hp_cost(fit_first_pick(missing, false)) > 0) ++chargedUnlucky;
    }
    CHECK(chargedLucky == 6);
    CHECK(chargedUnlucky == 10);

    // ...and the rule that shipped never does it once. All 21 feeding rows in the bag,
    // the charged ones in the LOW slots so a lowest-index bias would show, every
    // integer deficit from 1 to 100.
    NpcPool pool;
    pool.init();
    Registry reg;
    EventBus bus;
    bus.init();
    const NpcId id = pool.spawn();
    pool.height_mm(id) = 1750;
    pool.max_hp(id) = 10000;   // deep enough that 100 charged presses could not kill it
    pool.hp(id) = 10000;
    const Entity body = embody_as_player(reg, pool, id, 0);
    CHECK(body != entt::null);

    Inventory& inv = pool.inventory(id);
    inv.clear();
    int slot = 0;
    for (int pass = 0; pass < 2; ++pass)
        for (std::size_t i = 0; i < kItemCount; ++i) {
            const ItemId iid = static_cast<ItemId>(i + 1);
            if (!item_feeds(iid) || item_def(iid).useA <= 0) continue;
            // `noCost`, not `free`: a local named `free` hides ::free (MSVC /W4 C4459).
            const bool noCost = consumable_hp_cost(iid) == 0;
            if ((pass == 0) == noCost) continue;   // pass 0 = charged rows first
            inv.slots[slot].item = iid;
            inv.slots[slot].count = 255;         // 100 presses cannot exhaust a slot
            ++slot;
        }
    CHECK(slot == 21);                           // 16 Feed + 4 FeedRisky + 1 FeedPsi
    CHECK(consumable_hp_cost(inv.slots[0].item) == kRiskyFeedHpCost);
    CHECK(consumable_hp_cost(inv.slots[4].item) == 0);

    const std::int16_t hp0 = pool.hp(id);
    int freePicks = 0, covered = 0;
    for (int d = 1; d <= 100; ++d) {
        pool.needs(id) = full_clock();
        pool.needs(id).food = kNeedMax - static_cast<float>(d);
        const ConsumeResult r = use_best_food(reg, pool, bus, 0,
                                              static_cast<std::uint64_t>(d));
        CHECK(r.used);
        if (r.hpCost == 0 && consumable_hp_cost(r.item) == 0) ++freePicks;
        // Key 2 still does its job inside the free class: every deficit a free row can
        // cover IS covered, so cost-first is not quietly under-feeding either. 40 is
        // the largest free row, so deficits 1..40 must come out full.
        if (approx(pool.needs(id).food, kNeedMax, 1e-3f)) ++covered;
    }
    // The whole decision as one number: 100 presses across every deficit the bar can
    // hold, and the eat key spent nothing. Fit-first ranking would have spent 6 * 6 =
    // 36 HP at best and 10 * 6 = 60 HP at worst, for at most 8 food points of tighter
    // fit per press (100 s of clock at kFoodDrainPerSec) and 0 points on 4 of them.
    CHECK(freePicks == 100);
    CHECK(pool.hp(id) == hp0);
    CHECK(covered == 40);
    CHECK(!reg.all_of<Dead>(body));
    CHECK(bus.size() == 100);
}

} // namespace needs2_test

static void test_needs2_all() {
    needs2_test::queue_metering_rate();
    needs2_test::pressure_clock_is_feelable();
    needs2_test::cost_first_over_every_deficit();
}
