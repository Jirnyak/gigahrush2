// Needs — the survival clock that makes a descent a *trip* rather than a stroll.
//
// Three reserves DRAIN (food, water, sleep); two pressures FILL (pee, poo). Empty a
// reserve or fill a pressure and it costs HP per second, additively. That clock is
// the whole reason to leave a floor: with no cost to standing still there is no
// decision in going deeper.
//
// EVERY NUMBER HERE IS MEASURED FROM THE TYPESCRIPT REFERENCE, not chosen:
// `systems/needs.ts:22-27` (rates), `:201-213` (attrition), `data/names.ts:316-318`
// (`freshNeeds`), `data/items.ts:32-37` (consumption), `main.ts:3777-3786`
// (exhaustion), and its own `balance.md:42-48` for the window they produce.
//
// STORAGE: THE POOL ROW, NOT AN ECS COMPONENT. `Needs` is a column in `NpcPool`,
// following hp ([combat.h]: "embodied HP is canonical in the pool row"). The
// deciding argument is the elevator: riding one calls `fold_back` then
// `embody_as_player` ([embody.h]), which destroys the player's entity and builds a
// new one. A component would reset the clock on every floor change — turning the
// trip clock into a floor clock, the exact exploit it exists to prevent. The
// alternative ("copy it across at each body swap") is the forget-to-call-it class of
// bug [combat.h]'s one-finalizer design exists to make unrepresentable. Second
// reason: the macro society sim reads and writes `NpcPool` on its own coarse clock
// ([macrosim.md]), so this is where hungry citizens will look. 36 B x 2^20 = 38 MB,
// noise against the pool's 0.48 GiB.
//
// TICK SCOPE: EVERY EMBODIED BODY ON THE LIVE FLOOR — since 2026-08-06, and the
// condition this file set for that is now met. The previous scope was ONLY THE
// CAMERA HOLDER, with this written argument: "at 0.12/s the whole population
// dehydrates inside 14 minutes of play and the building is a morgue before the
// player reaches floor -3, because no citizen has an AI that eats yet. The
// reference survives this with a round-robin cold budget (192 entities/tick) PLUS
// ambient recovery in kitchens and bathrooms (`needs.ts:279-314`); gigahrush2 has
// neither. Widen it when the utility AI (#12) can walk an NPC to a kitchen, not
// before."
//
// It can now. `intent_room_mask` gives a hungry body a kitchen to walk to and the
// utility AI takes ownership of its motion to get there ([room_zone.h], [ai.h],
// [problems.md] §27 legs (a)+(b)); `room_recover` is the reference's ambient
// recovery, ported from the same `needs.ts` lines the paragraph above names. So the
// argument is retired by having its condition satisfied, not by being overruled —
// and the ROUND-ROBIN half is deliberately still not taken, because it is not
// needed: the scope is one floor's embodied bodies (419 on the demo stack, 16,000
// at the design ceiling), which is O(n) in exactly the population the tick already
// walks for physics. The cold 950k stay cold; the macro sim owns their clock
// ([macrosim.md]) and this pass never sees them.
//
// A BODY THE FLOOR HAS ALREADY BEEN LIVING IN IS NOT FRESHLY FED. Seeding 419
// residents with `needs_roll` would put the whole crowd in the same 70..100 band at
// the same instant — a building where everybody ate breakfast simultaneously and
// nobody is hungry for the next nine minutes. `needs_roll_resident` rolls the same
// body and then advances it to a hashed point of its own day. The camera holder is
// the exception and it is keyed on the COMPONENT, never on an identity
// ([jirnyak.md] §9): whoever holds `CameraTag` when their row is first seen is
// starting a trip, so their clock starts at the top. Possess a resident mid-run and
// you inherit THEIR day, because their row is already seeded — which is the right
// answer and costs no code.
//
// ATTRITION GOES THROUGH `apply_damage`, ON A CHANNEL ARMOUR CANNOT SEE. Starving to
// death must be the same death as being clubbed to death — `Dead` tag, one
// `finalize_deaths` ([combat.h] defect 2). But a liquidator vest resists 80 %
// kinetic, and letting it slow starvation 5x is absurd. All five real channels are
// resisted by at least one of the table's 5 armour rows, so there is no free channel
// to borrow: `kAttritionChannel` is one index PAST the last real one, which
// `apply_damage`'s `if (i < kDamageChannels)` guard skips. Unmitigated by
// construction rather than by a zero a future armour row could fill in.
//
// SLEEP COSTS SPEED, NEVER HP. Three HP drains stacking is a death spiral with no
// decision in it. The reference agrees: sleep contributes 0 HP/s and its only tooth
// is a flat x0.5 move-speed multiplier below 10 (not below 0 — the penalty lands
// before the bar empties). That taxes your ability to RUN AWAY, which is what turns
// "one more floor" into a question.
#pragma once

#include <cstdint>

#include "ecs/registry.h"
#include "game/combat.h"      // DamageChannel, kDamageChannels
#include "game/event_bus.h"
#include "game/item_table.h"  // ItemId, UseEffect
#include "game/npc_pool.h"    // Needs is a column there
#include "world/level_stack.h"

namespace giga::game {

inline constexpr float kNeedMax = 100.0f;

// Drain per REAL second (`needs.ts:22-27`).
inline constexpr float kFoodDrainPerSec  = 0.08f;
inline constexpr float kWaterDrainPerSec = 0.12f;
inline constexpr float kSleepDrainPerSec = 0.05f;
static_assert(kWaterDrainPerSec > kFoodDrainPerSec,
              "water must run out before food — that ordering IS the design");

// Pending -> actual pressure, per second (`needs.ts:26-27`). Pee and poo have NO
// autonomous growth: they are metered out of a queue only consumption fills, which
// is what makes them a tax on eating and drinking rather than a second clock.
inline constexpr float kPeeDigestPerSec = 0.10f;
inline constexpr float kPooDigestPerSec = 0.06f;

// HP/s once a need has failed (`needs.ts:201-213`). ADDITIVE: both at once is
// 0.8 HP/s, which is what makes ignoring the clock lethal rather than merely
// irritating. ДАВЛЕНИЯ HP НЕ ГРЫЗУТ (закон владельца 2026-08-28): давление
// на капе сливается самим клоком (`needs_advance` — невольное облегчение,
// где застало); цена — лужа и свидетели (CANON.md S19), не здоровье.
// kOverflowHpPerSec умер вместе со старым законом «стоит на капе и платит».
inline constexpr float kHungerHpPerSec      = 0.3f;   // food  <= 0
inline constexpr float kDehydrationHpPerSec = 0.5f;   // water <= 0

// `main.ts:3777-3786`: flat, binary, no ramp.
inline constexpr float kSleepExhaustedAt = 10.0f;
inline constexpr float kSleepExhaustedSpeedScale = 0.5f;

// Starting values, randomised per body (`names.ts:316-318`). The spread is the
// point: the body you wake up in decides how long your first trip can be.
inline constexpr float kStartFoodLo  = 70.0f, kStartFoodHi  = 100.0f;
inline constexpr float kStartWaterLo = 70.0f, kStartWaterHi = 100.0f;
inline constexpr float kStartSleepLo = 60.0f, kStartSleepHi = 100.0f;
inline constexpr float kStartPeeLo   =  0.0f, kStartPeeHi   =  30.0f;
inline constexpr float kStartPooLo   =  0.0f, kStartPooHi   =  20.0f;

// THE SURVIVAL WINDOW. A reserve `v` at drain `r` lasts `v / r` seconds:
//
//   WATER (0.12/s):  70 ->  583 s =  9.72 min   100 ->  833 s = 13.89 min
//   FOOD  (0.08/s):  70 ->  875 s = 14.58 min   100 -> 1250 s = 20.83 min
//   SLEEP (0.05/s):  60 -> 1200 s = 20.00 min   100 -> 2000 s = 33.33 min
//
// So water 9.72..13.89 min and food 14.58..20.83 min — the figures the reference's
// `balance.md:42-48` states in prose. A brief circulated during this port asked for
// "8..12 on water, 12..18 on food"; those ceilings are ~16 % low (8..12 min of water
// is a start of 57.6..86.4, not 70..100). The FLOORS it was reaching for do hold:
// the unluckiest body still gets >= 8 min of water and >= 12 min of food.
// `suite_needs.inl` asserts both, so drift in either direction goes red.
constexpr float needs_survival_minutes(float startValue, float drainPerSec) {
    return startValue / drainPerSec / 60.0f;
}

// WARNING THRESHOLDS, DERIVED FROM THE RATE. "How long until this hurts" is
// `value / rate`, so a threshold must be `rate * lead` or it silently drifts when a
// rate is retuned. The reference hardcodes 15/15/10/85 (`needs.ts:216-221`) and pays
// for it: at 0.08/s its food warning fires 187 s out against water's 125 s, for no
// authored reason. 120 s is the target lead — mid-band of the 90..150 s a player
// needs to find and use a bottle. Sanity check on that choice: 0.12 * 120 = 14.4,
// within 4 % of the reference's hand-picked 15, so the derived rule reproduces the
// number a human chose and then applies it consistently to food.
inline constexpr float kNeedWarnLeadSec = 120.0f;
inline constexpr float kFoodWarnAt  = kFoodDrainPerSec  * kNeedWarnLeadSec;  //  9.6
inline constexpr float kWaterWarnAt = kWaterDrainPerSec * kNeedWarnLeadSec;  // 14.4
inline constexpr float kSleepWarnAt = kSleepDrainPerSec * kNeedWarnLeadSec;  //  6.0
// Pressures warn by headroom, and their lead is a WORST case: it only elapses while
// the pending queue still has something to meter out.
inline constexpr float kPeeWarnAt = kNeedMax - kPeeDigestPerSec * kNeedWarnLeadSec; // 88.0
inline constexpr float kPooWarnAt = kNeedMax - kPooDigestPerSec * kNeedWarnLeadSec; // 92.8

// What goes in comes out. Structural helper constants in the reference
// (`items.ts:32-34`), not per-item data, so they port verbatim.
inline constexpr float kFeedPooShare  = 0.7f;   // feed(v)      -> pendingPoo += v*0.7
inline constexpr float kFeedPeeShare  = 0.3f;   //              -> pendingPee += v*0.3
inline constexpr float kRiskyPooShare = 1.0f;   // riskyFeed(v) -> pendingPoo += v*1.0
inline constexpr float kRiskyPeeShare = 0.4f;   //              -> pendingPee += v*0.4
inline constexpr float kDrinkPeeShare = 0.6f;   // drink(v)     -> pendingPee += v*0.6

// BOTH DIGEST RATES BEAT THEIR OWN STEADY-STATE INFLOW, which is why a player who
// only replaces what they drain never accumulates a permanent backlog. Drinking at
// exactly `kWaterDrainPerSec` queues 0.12 * 0.6 = 0.072 pee/s against 0.10 of
// metering capacity — 39 % headroom. Eating at `kFoodDrainPerSec` queues
// 0.08 * 0.7 = 0.056 poo/s against 0.06 — 7 % headroom. The bowel margin is thin
// enough that raising `kFoodDrainPerSec` past 0.0857 inverts it and turns poo into a
// debt no amount of walking can pay, so it is asserted here rather than left to be
// discovered later as "the toilet stopped helping".
static_assert(kPeeDigestPerSec > kWaterDrainPerSec * kDrinkPeeShare,
              "pee must meter out faster than continuous drinking queues it");
static_assert(kPooDigestPerSec > kFoodDrainPerSec * kFeedPooShare,
              "poo must meter out faster than continuous eating queues it");

// **THE ONE APPROXIMATION IN THIS FILE.** The reference authors a per-item HP cost
// for risky food in the CSV's `use_b`: 8 (infected_mushroom), 6 (zhelemish_raw),
// 5 (experimental_concentrate), 6 (sand_spoiled_ration). `ItemDef` stops at `useA`
// and does not port `use_b`, so all four cost the median 6 here. Fix when the exact
// numbers are wanted: rename `ItemDef::pad_` (offset 19, currently dead) to
// `std::int8_t useB`, add the column to `tools/gen_item_table.py`, regenerate —
// `sizeof(ItemDef)` stays 20.
inline constexpr std::int16_t kRiskyFeedHpCost = 6;

// Exact, not approximated: `siren_energy` is the ONLY DrinkStim row and
// `sleeping_pills` the ONLY SleepingPills row in all 446 items, so one constant IS
// the per-item value. The test asserts both counts are still 1 — a second such item
// would turn these into approximations, and is the signal `useB` is now needed.
inline constexpr float kDrinkStimSleepBonus = 10.0f;     // items.ts:449
inline constexpr float kSleepingPillsWaterCost = 16.0f;  // items.ts:37
inline constexpr float kSleepingPillsFoodCost  =  8.0f;
inline constexpr std::int16_t kSleepingPillsHpCost = 4;

// The reference's toilet (`interactive.ts:144-166`). No toilet object exists in
// gigahrush2 yet; these are what `relieve_needs` takes when one does. Deliberately
// partial, so a long trip still has to come home.
inline constexpr float kToiletPeeRelief = 70.0f;
inline constexpr float kToiletPooRelief = 65.0f;

// One index past the last real `DamageChannel` — see the header comment.
// `enum class : uint8_t` carries the underlying type's value range, so this cast is
// well-defined, not UB. It also lands in `Dead::channel`, where it reads as
// "attrition"; nothing switches on that field.
inline constexpr DamageChannel kAttritionChannel =
    static_cast<DamageChannel>(kDamageChannels);

// HOW FAR INTO ITS OWN DAY A RESIDENT IS BORN, in seconds — DERIVED FROM THE RATES,
// never picked, for the same reason the warning leads above are. The property that
// has to hold is "a resident may be thirsty at t=0 but must never be ALREADY
// FAILING", because a body that spawns at water 0 is losing HP before it has taken a
// step and its first decision is the IntentHeal deadlock ([hunt.h]:41-42), not a
// walk to the kitchen. Water is the first bar to fail ([needs.h] static_assert), so
// the bound is the UNLUCKIEST water roll's window with 20 % of it left standing:
// 70 / 0.12 * 0.8 = 466.7 s. Retune any drain and this follows it.
inline constexpr float kResidentPhaseMaxSec =
    kStartWaterLo / kWaterDrainPerSec * 0.8f;
static_assert(kStartWaterLo - kWaterDrainPerSec * kResidentPhaseMaxSec > 0.0f,
              "a resident must never be born already dehydrating");

// One byte answers the HUD, the warning line and the damage sum at once.
enum NeedBit : std::uint8_t {
    NeedFood  = 1u << 0,
    NeedWater = 1u << 1,
    NeedSleep = 1u << 2,
    NeedPee   = 1u << 3,
    NeedPoo   = 1u << 4,
};

// What one `needs_step` actually did — the "report what LANDED" shape of
// `DamageResult` and `use_best_heal`.
struct NeedsTick {
    std::int16_t hpLost = 0;      // whole HP taken THIS step, post-clamp
    float speedScale = 1.0f;      // multiply into Controller::moveSpeed
    float secondsToDamage = 0.0f; // 0 while already losing HP
    std::uint8_t failed = 0;      // NeedBit mask: at the limit
    std::uint8_t warned = 0;      // NeedBit mask: inside the warning band
    bool lethal = false;
    bool ticked = false;          // false when no camera holder is on this layer
    // -- the widened scope; the fields above stay ABOUT THE CAMERA HOLDER so every
    //    existing HUD/consumer reads what it always read --
    // Невольный слив клока у НОСИТЕЛЯ КАМЕРЫ этим шагом ([needs_advance]):
    // потребитель рисует лужу тем же стейном, что осознанный канал P.
    std::uint8_t voidedPee = 0;
    std::uint8_t voidedPoo = 0;
    std::uint32_t bodies = 0;     // clocks advanced this step, camera holder included
    std::uint32_t recovering = 0; // of those, standing in a room that restores
    std::uint32_t crowdKilled = 0; // non-camera bodies this step's attrition finished
};

// Deterministic in `seed`, so a record gets the same body across a save/load rather
// than a fresh roll each session.
Needs needs_roll(std::uint32_t seed);

// The same roll, then advanced to a hashed point of that body's own day — see
// `kResidentPhaseMaxSec`. Deterministic in `seed` like the roll it wraps, and built
// by running the REAL `needs_advance` rather than by inventing second bands, so a
// resident's state is always a state the ordinary clock could have produced.
Needs needs_roll_resident(std::uint32_t seed);

// Returns what actually came off, so "you did not need to" is distinguishable
// from "that helped". Filled by `relieve_needs` (canal 1: осознанное, клавиша
// P) and by the clock itself (canal 2: невольный слив на капе).
struct ReliefResult {
    float pee = 0.0f;
    float poo = 0.0f;
};

// The pure clock: no registry, no HP, no allocation. The piece the macro sim can
// reuse on its own coarse clock, and the piece a test can drive without a world.
//
// НЕВОЛЬНОЕ ОБЛЕГЧЕНИЕ (закон владельца 2026-08-28, «оба канала»): давление,
// дошедшее до kNeedMax, СЛИВАЕТСЯ здесь же — тело опорожняется, где застало.
// Один закон для всех тел (S7: игрок = NPC = резидент через needs_roll).
// `voided` (опц.) накапливает слитое — потребитель клока рисует лужу.
void needs_advance(Needs& n, float dt, ReliefResult* voided = nullptr);

// Sleep IS reported when empty, but contributes 0 HP/s — use `needs_hp_rate`.
std::uint8_t needs_failed_mask(const Needs& n);
std::uint8_t needs_warn_mask(const Needs& n);

// HP/s this body is losing, summed over every failed need. 0 when nothing failed.
float needs_hp_rate(const Needs& n);

// Seconds until HP loss begins; 0 if it already has. Pressures only count while
// their pending queue has something left to meter.
float needs_seconds_to_damage(const Needs& n);

// 1.0, or `kSleepExhaustedSpeedScale` below `kSleepExhaustedAt`. `needs_step`
// returns the same value, so the caller needs no second call.
float needs_speed_scale(const Needs& n);

// Advance EVERY embodied body's clock on `layer` and charge it. Rolls each record's
// needs lazily on first sight — the way `player_melee_step` attaches `PlayerMelee`
// lazily — so no spawn, elevator or possession path has to remember to seed them,
// and the camera holder gets `needs_roll` where a resident gets
// `needs_roll_resident` (see the scope note in this file's banner).
//
// АМБИЕНТНАЯ РЕГЕНЕРАЦИЯ ПО ВИДУ КОМНАТЫ УМЕРЛА (rooms-object F): вида нет
// (S12.2), потребление реальное (S12.5) — еда берётся из предмета, а не из
// стояния в «кухне». До agent-goals толпа живёт на медленном клоке нужд;
// смерть от нужд остаётся честной.
//
// NeedsTick's `hpLost` / `failed` / `warned` / `speedScale` / `ticked` stay ABOUT
// THE CAMERA HOLDER, so every existing consumer (HUD, warning line) reads exactly
// what it read before; the crowd is reported through the three new counters.
//
// WHERE IT BELONGS IN THE SIM LOOP (`src/app/main.cpp`) — it is a damage source, so
// it goes LAST among them, immediately before `loot_dead_mobs`:
//
//   input.apply -> controller_step -> wander_step -> physics_step ->
//   player_melee_step -> mob_attack_step -> projectile_step ->
//   >> needs_step << -> loot_dead_mobs -> finalize_deaths -> pickup_step
//
// It MUST precede `finalize_deaths`, or a body that starves this tick dies on the
// next one and the single-death-point contract breaks. Last among damage sources is
// the fair order: a monster's blow lands first, and if the monster already killed you
// `apply_damage` refuses the target, so you cannot be billed for starving after you
// are dead.
//
// No allocation, no exceptions, O(n) in the EMBODIED bodies on one layer.
NeedsTick needs_step(Registry& reg, NpcPool& pool, LayerId layer, float dt,
                     class AiMemory* mem = nullptr, double now = 0.0);

// Keyed off `UseEffect`, never `ItemCategory` — and the distinction is real:
// `calm_brew` is category DRINK and `easter_egg` is category FOOD, but both are
// `HealPsi` and restore nothing. Category would let you "drink" a brew and stay
// thirsty.
bool item_feeds(ItemId id);     // Feed | FeedRisky | FeedPsi   (21 of 446)
bool item_hydrates(ItemId id);  // Drink | DrinkStim            ( 8 of 446)

// What a consumable actually did after clamping into 0..100 — what LANDED, never the
// number on the tin ([loot.h] `use_best_heal`).
struct ConsumeResult {
    ItemId item = kInvalidItem;
    float food = 0.0f;
    float water = 0.0f;
    float sleep = 0.0f;
    float peeQueued = 0.0f;    // added to pendingPee, not to pee
    float pooQueued = 0.0f;
    std::int16_t hpCost = 0;   // risky food / pills; clamped so it can never kill
    bool used = false;
};

// Apply one consumable to one clock. Does NOT touch HP: it reports the cost for the
// caller to route through `apply_damage`, clamped to `hp - 1` because bad food in the
// reference floors at 1 HP (`items.ts:33`) — eating something questionable is a
// gamble you always survive.
//
// Faithfully ported oddity: queued pressure is computed from the item's LABEL, not
// from what landed. Eating a 40-point ration at 99 food wastes the food and still
// bills the full 40 points of digestion — it went through you either way.
ConsumeResult apply_consumable(Needs& n, ItemId item, std::int16_t hp);

// The HP `apply_consumable` will charge for `id`, BEFORE the hp-1 survivability floor
// is applied. 0 for all 17 clean Feed/FeedPsi rows and all 8 Drink/DrinkStim rows;
// `kRiskyFeedHpCost` for the 4 FeedRisky rows; `kSleepingPillsHpCost` for the one
// pill. Public because it is the PRIMARY key of the selection rule below, so a test
// can assert that rule directly instead of inferring it from an outcome.
std::int16_t consumable_hp_cost(ItemId id);

// SELECTION IS TWO-KEY: HP COST FIRST, FIT SECOND.
//
//   1. Anything `consumable_hp_cost` reports 0 for beats anything it charges for,
//      whatever the fit.
//   2. Within one cost class: the smallest portion that still covers the deficit,
//      else the largest available — `use_best_heal`'s rule ([loot.h]).
//   3. Ties in magnitude go to the lowest slot index.
//
// Key 1 is NOT in `use_best_heal` and the divergence is deliberate, not drift: all 12
// `Heal` rows in `data/items.csv` leave `use_b` empty, so healing has no cost to rank
// on, while 4 of the 21 feeding rows charge `kRiskyFeedHpCost` = 6 HP.
//
// WHY FIT CANNOT BE THE PRIMARY KEY. `useA` over the 21 feeding rows, sorted, R =
// FeedRisky: 4R 6 8 10 10R 12 12R 15 16 18 20 20 22 24 25 26 28 30 32R 35 40. Rank on
// fit alone and the eat key is FORCED onto a risky row wherever a risky `useA` is the
// smallest that covers, and pays 6 HP for it:
//
//   deficit 31  -> experimental_concentrate (32, 6 HP) over liquidator_ration (40,
//                  0 HP). The tighter fit is worth 8 food points = 100 s of clock at
//                  `kFoodDrainPerSec`, bought for 6 % of a 100 HP bar.
//   deficit 10  -> zhelemish_raw (10) TIES rawmeat (10), and wins on slot index only.
//   deficit 12  -> infected_mushroom (12) TIES soup_cube (12), likewise.
//
// The ties settle it: identical food, 6 HP more, plus 3.0 more points of queued bowel
// (`kRiskyPooShare` 1.0 against `kFeedPooShare` 0.7) = 50 s more of poo climbing at
// `kPooDigestPerSec` — and which one you get is decided by pickup order. Both risky
// rows in those ties carry spawn weight 1000, exactly matching their clean twins, so
// it is not a rare shape. Scarcity points the same way: 13.0 % of feeding drops by
// spawn weight are risky (2,220 of 17,020 milli), the 16 clean Feed rows are 1..22 RUB
// trash, and HP has exactly one restore path in this build — 12 `Heal` rows at 10..140
// RUB, median 39, for 8..60 points. Paying the scarce resource to save 1..8 points of
// the abundant one is backwards.
//
// A LEXICOGRAPHIC key, not a weighted one, because no measured HP-per-food-point
// exchange rate exists to weight with. And it does not make risky food unreachable,
// which would be the opposite bug: with only `infected_mushroom` in the bag at 0 food,
// 12 points for 6 HP beats 0.3 HP/s forever, and key 1 still picks it because it is
// the only class present. What key 1 actually buys is DEFERRAL — the key is repeatable
// on every press, so eating the free rows first costs nothing and keeps the 6 HP
// unspent until the bag holds nothing else. Deferral is free on the pressure axis too:
// clean food queues 0.7 poo per food point at any portion size, risky queues 1.0.
//
// Consumes one unit, charges any HP cost through `apply_damage` on
// `kAttritionChannel`, publishes `ItemTransferred`.
// Call site: beside `use_best_heal`, after `pickup_step`, on an input edge.
ConsumeResult use_best_food(Registry& reg, NpcPool& pool, EventBus& bus,
                           LayerId layer, std::uint64_t tick);
ConsumeResult use_best_drink(Registry& reg, NpcPool& pool, EventBus& bus,
                            LayerId layer, std::uint64_t tick);

// Осознанное опорожнение (ReliefResult объявлен у needs_advance выше).
ReliefResult relieve_needs(Needs& n, float peeAmount, float pooAmount);

} // namespace giga::game
