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
// СТУХЛО / поправка 2026-11-06 (matwej.md §13). The paragraph below retires the
// narrow-scope argument on a condition that is NOT met on HEAD. `room_zone.h`,
// `intent_room_mask` and `room_recover` are all absent from the tree — demolished
// with the per-room-kind flow fields by rooms-object F — so the utility AI does
// NOT today walk a hungry body to a kitchen (every non-flee intent delegates to
// `wander_step`, see [ai.h]), and there is no ambient-recovery pass at all. The
// WIDE TICK SCOPE IS REAL AND STAYS: this file does tick every embodied body on
// the live floor, and that is the measured fact. What is false is the stated
// JUSTIFICATION — the morgue hazard the old argument named is therefore still
// open, not answered, and it is exactly what matwej.md §21 move G ("arrived ->
// consumed -> need goes back up") is for. Nearest live machinery to build on:
// `place_pick` ([game/place.h]), which scores declared rooms by demand x supply.
//
// ~~It can now. `intent_room_mask` gives a hungry body a kitchen to walk to and
// the utility AI takes ownership of its motion to get there ([room_zone.h],
// [ai.h], [problems.md] §27 legs (a)+(b)); `room_recover` is the reference's
// ambient recovery, ported from the same `needs.ts` lines the paragraph above
// names. So the argument is retired by having its condition satisfied, not by
// being overruled~~ — it was retired by being OVERRULED, which is a different
// thing and leaves a debt.
//
// Still true, and independent of the above: the ROUND-ROBIN half is deliberately
// still not taken, because it is not
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
#include <vector>

#include "core/math.h"        // clamp01 / smoothstep01 — кривые давления ниже
#include "ecs/registry.h"
#include "game/combat.h"      // DamageChannel, kDamageChannels
#include "game/event_bus.h"
#include "game/item_table.h"  // ItemId, UseEffect
#include "game/npc_pool.h"    // Needs is a column there
#include "game/verb_table.h"  // VerbId, kVerbPatienceE3 — колено кривой из строки
#include "world/level_stack.h"

namespace giga {
class World;
}

namespace giga::game {

struct FloorRooms;

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

inline constexpr float kHermeticSleepAmbientPerSec = 0.08f; // net +0.03/s в гермоукрытии (компенсирует kSleepDrainPerSec 0.05)
inline constexpr float kHermeticHealAmbientPerSec  = 0.05f; // 1 HP за 20 сек в стерильном боксе

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
//
// (Хелпер `needs_survival_minutes` СНЕСЁН 2026-09-30 решением владельца: ноль
// вызывающих в `src/`, жил ровно в восьми `static_assert`'ах сьюта. Сами
// утверждения на месте — `v / r / 60` выписано в сьюте локальным constexpr, то
// есть окно выживания по-прежнему валит СБОРКУ при ретюне скоростей расхода.)

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

// (`kToiletPeeRelief` 70 / `kToiletPooRelief` 65 — «референсный унитаз» —
// СНЕСЕНЫ 2026-11-14: их не читал ни один вызывающий, только тест, а облегчение
// деянием опорожняет тело ЦЕЛИКОМ — `needs_satisfy`, CANON S27.1.)

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

// --- ДАВЛЕНИЕ НУЖДЫ: ОДНА КРИВАЯ НА ВСЕХ ЧИТАТЕЛЕЙ -------------------------
//
// Эти три жили файловыми хелперами в анонимном пространстве `ai.cpp` (кривые
// референса `npc_utility.ts`, дословно) и переехали сюда 2026-10-01, когда у
// них появился ВТОРОЙ читатель — вектор спроса агента ([game/place.h],
// CANON S12.3 четвёртый стол словаря глаголов).
//
// Почему переезд, а не копия: интент-арбитр (`score_intents`) и выбор МЕСТА
// обязаны понимать «насколько я голоден» ОДНИМ числом. Две кривые над одной
// величиной — ровно форма §64 (два закона об одном взаимном положении,
// различающиеся единицами = гарантированный предельный цикл): тело решало бы
// «хочу есть» по одной кривой, а место под это «хочу» выбирало бы по другой.
// Здесь они потому, что величина — это `Needs`, а не ИИ.
//
// ЕДИНИЦЫ: на входе шкала 0..100 самой колонки, на выходе ВСЕГДА 0..1.
//
// КОЛЕНО КРИВОЙ — ИЗ СТРОКИ ГЛАГОЛА, А НЕ ИЗ ЭТОГО ФАЙЛА (решение владельца
// 2026-11-08: «порог нелинейности — из kVerbPatienceE3»).
//
// ЧТО БЫЛО: четыре нужды с РАЗНЫМ авторским терпением (`verbs.csv`: сортир
// 200, жажда 300 — и строка прямо говорит «жажда чуть острее голода», — голод
// 350, сон 600) делили ОДНО жёстко заданное колено `smoothstep01(0.18, 0.82)`.
// То есть различие было написано в данных и не читалось НИГДЕ: мера
// `grep -rn kVerbPatienceE3 src/` давала НОЛЬ читателей, а двадцать чисел
// столбца судил только тест, пинящий сам столбец, — тот класс, про который в
// этом дереве сказано «тест проверяет сам символ = сносить».
//
// ЧТО СТАЛО: терпение есть ДОЛЯ НЕДОСТАТКА, КОТОРУЮ АГЕНТ СТЕРПИТ, то есть
// НАЧАЛО рампы. `shelter` 0 — «не терпит вовсе», давление растёт с первого же
// недостатка; `wander` 1000 — «никогда не срочно», рампы нет вовсе. Порядок
// остальных выпадает из данных сам и совпадает с их прозой: сортир терпит 20 %
// пузыря, жажда 30 % (строка CSV: «чуть острее голода»), голод 35 %, сон 60 %,
// боль 15 %.
//
// НАПРАВЛЕНИЕ РАМПЫ ПОЙМАЛИ ТЕСТЫ, И ЭТО СТОИТ ЗАПИСАТЬ. Первая версия читала
// терпение как КОНЕЦ рампы (полная срочность при `x == p`) — и свежий житель с
// 30 % пузыря мгновенно получал полную срочность сортира, то есть вся толпа
// рождалась в аварии. Красные гейты `suite_utilai` назвали это с первого
// прогона: модель была правдоподобной и неверной.
//
// ЦЕНА НАЗВАНА: это БАЛАНСНОЕ ИЗМЕНЕНИЕ, не рефакторинг. Прежние 0.18/0.82
// были одним коленом для всех и к данным отношения не имели; теперь колено
// РАЗНОЕ и приходит из строки.
inline float verb_pressure(VerbId verb, float shortage01) {
    const float x = clamp01(shortage01);
    const float p = verb < kVerbCount
                        ? static_cast<float>(kVerbPatienceE3[verb]) * 0.001f
                        : 1.0f;
    // Полное терпение — вырожденная рампа (`smoothstep01` поделил бы на ноль):
    // срочности нет, пока недостаток не стал полным. Это «никогда не срочно и
    // никогда не ноль» глагола `wander` буквально.
    if (p >= 1.0f) return x >= 1.0f ? 1.0f : 0.0f;
    return smoothstep01(p, 1.0f, x);
}

// Запас к нулю -> к единице. Шкала недостатка — та же 72 из референса: бар
// считается «пустым» на 72 единицах убыли, дальше кривая уже на полке.
inline float needs_low_pressure(VerbId verb, float v) {
    return verb_pressure(verb, clamp01((72.0f - v) / 72.0f));
}
// Давление к капу -> к единице (сортир: бар РАСТЁТ, а не убывает).
inline float needs_high_pressure(VerbId verb, float v) {
    return verb_pressure(verb, clamp01(v / kNeedMax));
}
// Недостаток здоровья — такая же нужда со своей строкой (`heal`, терпение 150
// — «боль не терпит»), поэтому и кривая та же. Прежде здесь стояла ЛИНЕЙНАЯ
// доля потерянного HP — третья кривая над третьей величиной, единственная без
// колена; теперь колено приходит из строки, как у остальных.
inline float needs_health_pressure(float hp, float maxHp) { // 0 на полном HP
    const float lost = maxHp > 0.0f ? clamp01(1.0f - hp / maxHp) : 0.0f;
    return verb_pressure(kVerbHeal, lost);
}

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
    // (`voidedPee`/`voidedPoo` — невольный слив ТОЛЬКО носителя камеры, по
    // которому приложение рисовало лужу ему одному на литерале −Z, — СНЕСЕНЫ
    // 2026-11-14: мочу пишет сам клок любому телу материей мира,
    // `relief_urine`, CANON S27.17 п.7 «везде особенного игрока выжечь».)
    std::uint32_t puddles = 0;    // субвокселей мочи невольного слива этим шагом — у ЛЮБОГО тела
    std::uint32_t bodies = 0;     // clocks advanced this step, camera holder included
    std::uint32_t recovering = 0; // of those, standing in a room that restores
    std::uint32_t crowdKilled = 0; // non-camera bodies this step's attrition finished
};

// Deterministic in `seed`, so a record gets the same body across a save/load rather
// than a fresh roll each session.
Needs needs_roll(std::uint32_t seed);

// Строка нужд, КОТОРУЮ СЛЕДУЕТ ЧИТАТЬ решателю, — и она одна на всех решателей.
//
// Непросеянная строка (`seeded == 0`) есть все нули, а нули кривые выше читают
// как «голоден, обезвожен И не спал» — то есть вся толпа встала бы на еду. До
// 2026-10-01 подстановка жила файловым хелпером `needs_for` в анонимном
// пространстве `ai.cpp`; второй читатель (вектор спроса, [game/place.h])
// обязан подставлять ТО ЖЕ, иначе интент «хочу есть» и выбор места под это
// «хочу» считались бы по разным строкам одного тела.
//
// Подстановка ЛОКАЛЬНА: обратно в пул не пишется ничего, поэтому решатель
// по-прежнему не мутирует общего состояния и невидим для сейва. Пул берётся
// по изменяемой ссылке только потому, что у `NpcPool::needs` нет const-формы.
Needs needs_row_for(NpcPool& pool, NpcId id);

// НАЧАЛО ПОЕЗДКИ — сытое тело (решение владельца 2026-11-14, ответ (б): «сытый
// старт сохранить, но как данные начала новой игры, а не ветку в клоке»).
// Строка нужд тела, которое новая игра назвала началом поездки, — свежий бросок
// по полосам старта (`kStart*` — данные выше), а не точка чужих суток. Зовёт
// его ШАГ НОВОЙ ИГРЫ (`floor_stream`, назначение камеры при входе без игрока),
// а не клок: клок сеет любую строку одним законом (`needs_roll_resident`).
// Вселившийся в жителя наследует ЕГО сутки — строка уже засеяна.
void needs_new_trip(NpcPool& pool, NpcId id);

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
//   >> needs_step << -> loot_dead_mobs -> finalize_deaths -> pickup_take (E)
//
// It MUST precede `finalize_deaths`, or a body that starves this tick dies on the
// next one and the single-death-point contract breaks. Last among damage sources is
// the fair order: a monster's blow lands first, and if the monster already killed you
// `apply_damage` refuses the target, so you cannot be billed for starving after you
// are dead.
//
// No allocation, no exceptions, O(n) in the EMBODIED bodies on one layer.
// bus+tick — ДЕЯНИЕ «невольный слив» (S19): клок нужд — единственное место,
// знающее и тело, и позицию, и факт слива; один шов закрывает NPC и игрока
// разом. Уместность туалета зануляет цену у ПОТРЕБИТЕЛЯ (witness_step) —
// ветки «в туалете бесплатно» здесь нет по построению.
//
// `world`+`excreted` (опц.) — МОЧА невольного слива у ЛЮБОГО тела, одной
// функцией с облегчением двери утоления (`relief_urine`). Невольный слив — не
// выбор места, поэтому лужа у него всегда: «естественно только лужа» (владелец
// 2026-08-28). До 2026-11-14 её рисовало приложение, и только носителю камеры.
NeedsTick needs_step(Registry& reg, NpcPool& pool, LayerId layer, float dt,
                     class AiMemory* mem = nullptr, double now = 0.0,
                     EventBus* bus = nullptr, std::uint64_t tick = 0,
                     World* world = nullptr,
                     std::vector<std::uint32_t>* excreted = nullptr,
                     const FloorRooms* rooms = nullptr);

// МОЧА — МАТЕРИЯ МИРА, А НЕ ПЯТНО (решение владельца 2026-11-14: «по замыслу
// просто создаётся в области писи — или для начала просто в точке тела —
// субвоксель материала мочи, и дальше она агностично работает через клеточный
// автомат, то есть никаких новых систем»). Один дом на оба канала облегчения:
// невольный слив клока (`needs_step`) и осознанное облегчение двери утоления
// вне места, которое даёт сортир ([game/serve.h]). Пишет `count` субвокселей
// `kMatUrine` тем же законом, что универсальная кисть: материал — истина, бит
// твёрдости у текучего снят. Первый — в точке тела, следующие — в ближайшие
// воздушные атомы вокруг (грани, рёбра, углы; порядок фиксирован), чтобы кучка
// легла лужицей, а не стопкой. Атом не воздух (твердь, уже лужа) пропускается;
// дальше соседей окрестности 3³ не ищет — искать место не дело выделения.
// Возвращает, сколько записано. Индекс клетки каждого атома добавляется в
// `cells`: долг писателя (`GeomWriter::Excretion`, [game/geom_writer.h])
// платит вызывающий одной дверью `geometry_changed`. Заменила пятно-«лужу» на
// стейне (2026-11-14).
int relief_urine(World& w, const vec3& pos, int count,
                 std::vector<std::uint32_t>& cells);

// СРЕДНЕЕ ЧИСЛО АТОМОВ МОЧИ ЗА ПОЛНЫЙ ПОПИС — ЧИСЛО ВЛАДЕЛЬЦА (2026-11-14:
// «процесс писанья делает вероятность, что появится субвоксель мочи, каждый
// тик, покуда процесс идёт — маленькую; полный попис в среднем даёт несколько
// субвокселей, лужицу… порядка 4»). Объём не считается — это игра: окно
// облегчения роняет атом с шансом `kReliefUrineAtoms / длина окна` за тик,
// прерванное — сколько успело. Лужица от двух атомов в блоке Марголуса по
// закону автомата не истаивает (одиночка — брызг и тает), поэтому место, где
// мочатся часто, копит «парашу». Невольный слив — мгновенный, процесса нет:
// он отдаёт те же `kReliefUrineAtoms` разом.
inline constexpr int kReliefUrineAtoms = 4;

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
//
// `share` (окно-поток, 2026-11-14): ДОЛЯ предмета, которая ложится сейчас —
// окно деяния отдаёт предмет квантами, по `тиков/длина` за опрос. Все величины
// (бар, очередь, побочки) — в этой доле; `hpCost` отчитывается ЦЕЛИКОМ, его
// платят один раз, когда предмет взят.
ConsumeResult apply_consumable(Needs& n, ItemId item, std::int16_t hp,
                               float share = 1.0f);

// The HP `apply_consumable` will charge for `id`, BEFORE the hp-1 survivability floor
// is applied. 0 for all 17 clean Feed/FeedPsi rows and all 8 Drink/DrinkStim rows;
// `kRiskyFeedHpCost` for the 4 FeedRisky rows; `kSleepingPillsHpCost` for the one
// pill. Public because it is the PRIMARY key of the room's selection rule (below), so a test
// can assert that rule directly instead of inferring it from an outcome.
std::int16_t consumable_hp_cost(ItemId id);

// ВЫБОР ПРЕДМЕТА, КОТОРЫЙ ДЕЛАЕТ МИР, — ЦЕНА HP ПЕРВЫМ КЛЮЧОМ. Им живёт
// единственное оставшееся правило выбора — ящик комнаты в деянии
// (`best_lying@serve.cpp`: цена, затем аргмакс величины). Из СВОЕЙ сумки мир
// больше не выбирает: предмет выбирает человек кнопкой «Использовать», и окно
// деяния его помнит (CANON S27.1). Снесённый 2026-11-14 `use_best_food/drink`
// держал второе правило («наименьшая покрывающая порция») ради консольных
// `eat`/`drink` — умерли вместе с ним. Довод за первый ключ остаётся, и он
// числовой:
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
// which would be the opposite bug: with only `infected_mushroom` in the box at 0 food,
// 12 points for 6 HP beats 0.3 HP/s forever, and key 1 still picks it because it is
// the only class present. What key 1 actually buys is DEFERRAL — the rule is repeated
// on every deed, so eating the free rows first costs nothing and keeps the 6 HP
// unspent until the bag holds nothing else. Deferral is free on the pressure axis too:
// clean food queues 0.7 poo per food point at any portion size, risky queues 1.0.

// Осознанное опорожнение (ReliefResult объявлен у needs_advance выше).
ReliefResult relieve_needs(Needs& n, float peeAmount, float pooAmount);

// --- УТОЛЕНИЕ ГЛАГОЛОМ: ОДНА ДВЕРЬ ДЛЯ ДЕЯНИЯ НУЖДЫ (CANON S24) -----------
//
// Что это и чем НЕ является. `apply_consumable` утоляет ПРЕДМЕТОМ (ресурс,
// S12.3: «хлеб — как ресурс»), и ключ у него — `UseEffect` строки предмета.
// Здесь утоляет МЕСТО (возможность: «плита даёт есть»), и ключ — ГЛАГОЛ. Два
// ключа у одного бара были бы §64, поэтому ключ ровно один на каждый источник
// и шкала у обоих одна: очки того же словаря глаголов, то есть те же 0..100
// бара (койка 17 — это семнадцать очков сна, хлеб 15 — пятнадцать очков еды).
//
// ПОЧЕМУ ОЧЕРЕДЬ ПИЩЕВАРЕНИЯ ЗАПОЛНЯЕТСЯ И ЗДЕСЬ. Иначе у одного и того же
// деяния было бы ДВА исхода: съесть хлеб из ящика — и заплатить сортиром, а
// «поесть у плиты» — и не заплатить. Доли те же (`kFeedPooShare` и далее), и
// считаются они от ЗАЯВЛЕННОЙ величины, а не от легшей, — дословно та же
// оговорка, что у `apply_consumable` («40 очков при 99 еды тратит еду и всё
// равно выставляет счёт на 40: через тебя оно прошло либо так, либо так»).
//
// СОРТИР — ЕДИНСТВЕННЫЙ ГЛАГОЛ, У КОТОРОГО БАР ПАДАЕТ, А НЕ РАСТЁТ, и уходит
// он в `relieve_needs`; `gained` — СУММА СНЯТОГО с двух давлений. Объём деяния
// облегчения называет тело (`needs_body_total`), а не место: предложение
// сортира у места — вес решения «куда идти». Пятого случая здесь нет: глагол,
// которого этот клок не обслуживает, нулевая величина и пустое тело у сортира
// отвечают `served == false` ЗНАЧЕНИЕМ, а не тишиной, чтобы вызывающий мог не
// начинать деяние.
struct SatisfyResult {
    float gained = 0.0f;    // очков легло на бар (или снято с давлений)
    float peeQueued = 0.0f; // в очередь пищеварения, не в сам бар
    float pooQueued = 0.0f;
    // Сколько мочи ВЫШЛО из тела — физика, а не бухгалтерия: по нему дверь
    // утоления решает лужу (вышло не у места, которое даёт сортир), и ветки
    // «если это сортир» у неё нет.
    float relievedPee = 0.0f;
    bool served = false;    // этот глагол клок нужд обслуживает
};
SatisfyResult needs_satisfy(Needs& n, VerbId verb, float amount);

// ЧЕЙ ОБЪЁМ У ДЕЯНИЯ: сколько отдаёт САМО ТЕЛО за всё окно (> 0), или 0 —
// объём даёт место либо предмет. У облегчения — всё давление (`kNeedMax`):
// опорожняешься целиком где бы ни стоял, место решает только уместность и
// лужу. Окно-поток делит этот объём на кванты (CANON S27.1).
float needs_body_total(VerbId verb);

} // namespace giga::game
