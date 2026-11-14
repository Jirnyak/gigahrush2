#include "game/needs.h"

#include <cmath>

#include "core/wrap.h"       // wrap_macro — the body's cell is a toroidal lookup
#include "ecs/components.h"
#include "game/embody.h"     // NpcRef
#include "game/inventory.h"
#include "game/witness.h"    // deed_publish — невольный слив = деяние (S19)
#include "world/destruct.h"  // set_sub_material / sub_material_at — моча как материя
#include "world/materials.h" // kMatUrine; воздух — kCellAir (macro_grid.h)
#include "world/types.h"     // kCellSize — pos -> macro cell, the one conversion
#include "world/world.h"     // World::gravity — уклон лужи по гравитации

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

// (`find_player` / `use_best_for` — мгновенный путь утоления НОСИТЕЛЯ КАМЕРЫ,
// со своим поиском тела по `CameraTag` и своим правилом выбора из сумки, —
// СНЕСЕНЫ 2026-11-14: утоление одной дверью для любого тела, окном `Acting`,
// предмет выбирает человек кнопкой «Использовать» (CANON S27.1, [game/serve.h]).)

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

// Salt for the substitute needs roll. Distinct from every other hash stream so
// the substituted values are uncorrelated with worldgen and the macro tick.
// Приехал из анонимного пространства `ai.cpp` вместе с `needs_for` 2026-10-01 —
// значение то же, поэтому ни одно решение ни одного тела не сдвинулось.
inline constexpr std::uint32_t kSaltNeedsSubstitute = 0x0a1eed5u;

void needs_new_trip(NpcPool& pool, NpcId id) {
    if (!pool.valid(id)) return;
    pool.needs(id) = needs_roll(giga::hash_u32(id + 1u));
}

Needs needs_row_for(NpcPool& pool, NpcId id) {
    const Needs& row = pool.needs(id);
    if (row.seeded != 0) return row;
    return needs_roll(giga::hash2(id, kSaltNeedsSubstitute));
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

void needs_advance(Needs& n, float dt, ReliefResult* voided) {
    if (dt <= 0.0f) return;
    n.food  = clamp_need(n.food  - kFoodDrainPerSec  * dt);
    n.water = clamp_need(n.water - kWaterDrainPerSec * dt);
    n.sleep = clamp_need(n.sleep - kSleepDrainPerSec * dt);
    digest(n.pendingPee, n.pee, kPeeDigestPerSec * dt);
    digest(n.pendingPoo, n.poo, kPooDigestPerSec * dt);
    // НЕВОЛЬНОЕ ОБЛЕГЧЕНИЕ (владелец 2026-08-28): кап не состояние, а
    // событие — давление слилось, бар пошёл заново, очередь продолжает
    // метериться в пустое. Урона от давлений больше не существует.
    if (n.pee >= kNeedMax) {
        if (voided) voided->pee += n.pee;
        n.pee = 0.0f;
    }
    if (n.poo >= kNeedMax) {
        if (voided) voided->poo += n.poo;
        n.poo = 0.0f;
    }
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
    // Additive across every failed need, capped by nothing: both at once is
    // 0.8 HP/s. Sleep is absent on purpose — see the header. Давления тоже:
    // кап сливается клоком (невольное облегчение), урона не существует.
    const std::uint8_t f = needs_failed_mask(n);
    float rate = 0.0f;
    if (f & NeedFood)  rate += kHungerHpPerSec;
    if (f & NeedWater) rate += kDehydrationHpPerSec;
    return rate;
}

float needs_seconds_to_damage(const Needs& n) {
    if (needs_hp_rate(n) > 0.0f) return 0.0f;

    float soonest = n.food / kFoodDrainPerSec;
    const float water = n.water / kWaterDrainPerSec;
    if (water < soonest) soonest = water;

    // Давления к урону больше не ведут (кап сливается клоком) — часами
    // повреждения они быть перестали; предупреждение живёт в warn_mask.
    return soonest;
}

float needs_speed_scale(const Needs& n) {
    float scale = 1.0f;
    if (n.sleep < kSleepExhaustedAt) scale *= kSleepExhaustedSpeedScale; // 0.5f exhaustion penalty
    if (n.food <= 0.0f)              scale *= 0.75f; // 25% starvation penalty
    if (n.water <= 0.0f)             scale *= 0.65f; // 35% dehydration penalty
    return scale;
}

bool relief_urine(World& w, const vec3& pos, std::vector<std::uint32_t>& cells) {
    // Метры → глобальный субвоксель → клетка тора + атом в ней. Те же три
    // свёртки, что у универсальной кисти (`app/main.cpp`, писатель Brush).
    const float sv = kCellSize / static_cast<float>(kSubDim);
    const int gx = static_cast<int>(std::floor(pos.x / sv));
    const int gy = static_cast<int>(std::floor(pos.y / sv));
    const int gz = static_cast<int>(std::floor(pos.z / sv));
    const auto cell = [](int g) {
        return wrap_macro(static_cast<int>(
            std::floor(static_cast<float>(g) / static_cast<float>(kSubDim))));
    };
    const auto atom = [](int g) { return ((g % kSubDim) + kSubDim) % kSubDim; };
    const int cx = cell(gx), cy = cell(gy), cz = cell(gz);
    const int sx = atom(gx), sy = atom(gy), sz = atom(gz);
    if (w.grid().mask(cx, cy, cz).test(sub_bit(sx, sy, sz))) return false;
    if (sub_material_at(w, cx, cy, cz, sx, sy, sz) != kCellAir) return false;
    set_sub_material(w, cx, cy, cz, sx, sy, sz, kMatUrine);
    cells.push_back(static_cast<std::uint32_t>(macro_index(cx, cy, cz)));
    return true;
}

NeedsTick needs_step(Registry& reg, NpcPool& pool, LayerId layer, float dt,
                     AiMemory* mem, double now, EventBus* bus,
                     std::uint64_t tick, World* world,
                     std::vector<std::uint32_t>* excreted) {
    NeedsTick out;
    if (dt <= 0.0f) return out;

    // ONE SWEEP over the embodied bodies of this layer, camera holder included as an
    // ordinary row. There is no player branch in the loop — only a per-body question
    // ("does this entity hold CameraTag") that decides which seed roll it gets and
    // whose numbers land in the report ([jirnyak.md] §9: key on the component, never
    // on an identity).
    //
    // ITERATING WHILE DAMAGING — SAFE BECAUSE THE POOL IS WARMED, not because no
    // component is born. The old note here said `apply_damage` "creates NO
    // component" — false: on a lethal blow it emplaces `Dead` ([combat.cpp]
    // apply_damage tail), and the BIRTH of a pool under a live view is the class
    // `mob_attack_step` is split in two for. So the `Dead` pool is warmed before
    // the view opens (the rule `place_errand_step` and `serve_step` follow);
    // emplacing an element into an existing pool moves nothing this view holds.
    // (Caught by the review of the satiation door, 2026-11-14.)
    (void)reg.storage<Dead>();
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
        // reload — and every body is seeded at its own point of the day, so a
        // floor is not 419 people who all ate breakfast on the same frame.
        //
        // ВЕТКИ «ЕСЛИ НОСИТЕЛЬ КАМЕРЫ — СЫТЫЙ БРОСОК» ЗДЕСЬ БОЛЬШЕ НЕТ
        // (решение владельца 2026-11-14, ответ (б): «сытый старт сохранить, но
        // как данные начала новой игры, а не ветку в клоке»; S27.17 п.7 «везде
        // особенного игрока выжечь»). Клок сеет любую строку одним законом;
        // сытым начинает тело, которое НОВАЯ ИГРА назвала началом поездки, —
        // `needs_new_trip`, шагом новой игры, до первого тика.
        if (n.seeded == 0) n = needs_roll_resident(giga::hash_u32(id + 1u));

        ReliefResult voided;
        needs_advance(n, dt, &voided);
        // ДЕЯНИЕ «невольный слив» (S19): позиция и тело в руках только
        // здесь. Цена/уместность/свидетели — целиком у witness_step.
        if (bus != nullptr && (voided.pee > 0.0f || voided.poo > 0.0f))
            deed_publish(*bus, kVerbToilet, e, kInvalidNpc, tr.pos, tick);
        // МОЧА — материя мира, и у ЛЮБОГО тела (S7, S27.17 п.7): субвоксель
        // `kMatUrine` в точке тела, дальше её ведёт автомат. Ветки «если это
        // носитель камеры» здесь нет: прежде клок отдавал флажок только про
        // камеру, и толпа сливалась бесследно.
        if (voided.pee > 0.0f && world != nullptr && excreted != nullptr &&
            relief_urine(*world, tr.pos, *excreted))
            ++out.puddles;
        ++out.bodies;

        // АМБИЕНТНАЯ РЕГЕНЕРАЦИЯ ПО ВИДУ КОМНАТЫ УМЕРЛА (rooms-object F,
        // S12.2: вида нет; S12.5: потребление РЕАЛЬНОЕ — NPC берёт предмет и
        // ест его). Возвращает agent-goals: цель «есть» ведёт к комнате с
        // предложением, изъятие предмета из контейнера двигает нужду.

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
            if (gain > 0) hp = static_cast<std::int16_t>(hp + gain);
        }

        if (camera) {
            out.ticked = true;
            out.failed = needs_failed_mask(n);
            out.warned = needs_warn_mask(n);
            out.speedScale = needs_speed_scale(n);
            out.secondsToDamage = needs_seconds_to_damage(n);
        }

        const float rate = needs_hp_rate(n);
        if (rate <= 0.0f) continue;

        // HP is an integer and the slowest drain is 0.1 HP/s, which at the 125 Hz sim
        // step is 0.00083 HP — truncating that to an int every step would make
        // starvation cost exactly nothing, forever. So the fraction is BANKED in the
        // row and only whole HP is ever spent. The debt is deliberately not forgiven
        // when a need is topped back up: unpaid damage is still owed.
        n.hpDebt += rate * dt;
        if (n.hpDebt < 1.0f) continue;

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

std::int16_t consumable_hp_cost(ItemId id) {
    if (!item_valid(id)) return 0;
    switch (static_cast<UseEffect>(item_def(id).useEffect)) {
        case UseEffect::FeedRisky:     return kRiskyFeedHpCost;
        case UseEffect::SleepingPills: return kSleepingPillsHpCost;
        default:                       return 0;
    }
}

ConsumeResult apply_consumable(Needs& n, ItemId item, std::int16_t hp,
                               float share) {
    ConsumeResult out;
    if (!item_valid(item)) return out;
    if (share <= 0.0f) return out;
    if (share > 1.0f) share = 1.0f;

    const UseEffect eff = static_cast<UseEffect>(item_def(item).useEffect);
    // ДОЛЯ ПРЕДМЕТА (окно-поток, S27.1 2026-11-14): каждая величина ниже — от
    // `a`, и умножение здесь ОДНО, поэтому бар, очередь пищеварения и побочки
    // таблетки текут в одной пропорции. Цена HP — НЕ доля: её платят один раз,
    // когда предмет взят (см. `hpCost` ниже и [game/serve.h]).
    const float a = static_cast<float>(item_def(item).useA) * share;
    if (a <= 0.0f) return out;   // nothing to give; `used` stays false

    float pooShare = 0.0f;
    float peeShare = 0.0f;
    // ONE source for the cost, because the room's selection rule ranks on it
    // (`best_lying@serve.cpp`): a switch here and a second switch there would drift,
    // and the drift would be invisible — selection would keep calling a row free
    // while eating it charged 6 HP.
    const std::int16_t cost = consumable_hp_cost(item);

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
            break;

        case UseEffect::Drink:
            out.water = top_up(n.water, a);
            peeShare = kDrinkPeeShare;
            break;

        case UseEffect::DrinkStim:
            out.water = top_up(n.water, a);
            out.sleep = top_up(n.sleep, kDrinkStimSleepBonus * share);
            peeShare = kDrinkPeeShare;
            break;

        case UseEffect::SleepingPills:
            // The one item that restores sleep, and it charges for it in the other
            // three bars. Not a food or a drink: `item_feeds`/`item_hydrates` both
            // reject it; through the one door it is the verb `sleep`.
            out.sleep = top_up(n.sleep, a);
            n.water = clamp_need(n.water - kSleepingPillsWaterCost * share);
            n.food  = clamp_need(n.food  - kSleepingPillsFoodCost * share);
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

float needs_body_total(VerbId verb) {
    // Один switch «глагол → бар» живёт в `needs_satisfy`; этот — его вопрос
    // «чей объём»: у запасов объём даёт МЕСТО или предмет, у облегчения — ТЕЛО.
    return verb == kVerbToilet ? kNeedMax : 0.0f;
}

SatisfyResult needs_satisfy(Needs& n, VerbId verb, float amount) {
    SatisfyResult out;
    // Запас: бар РАСТЁТ, и сколько реально легло, отвечает `top_up` — тот же
    // файловый хелпер, которым кладёт в бар `apply_consumable`. Своя копия
    // клампа здесь была написана и СНЕСЕНА тем же часом: «что ЛАНДЕД, а не
    // число на жестянке» — правило в три строки, и вторая его реализация
    // рядом с первой есть ровно тот дефект, от которого правило и существует.
    //
    // Нулевая величина у запаса — «место ничего не даёт», и это `served ==
    // false` ЗНАЧЕНИЕМ: вызывающий по нему решает, начинать ли деяние.
    const auto fill = [&](float& bar) {
        if (amount <= 0.0f) return false;
        out.gained = top_up(bar, amount);
        out.served = true;
        return true;
    };
    switch (verb) {
        case kVerbSleep:
            fill(n.sleep);
            break;
        case kVerbEat:
            if (!fill(n.food)) break;
            // Что входит — то выходит: доли те же, что у предмета, и от
            // ЗАЯВЛЕННОЙ величины (см. шапку в [needs.h]).
            n.pendingPoo += amount * kFeedPooShare;
            n.pendingPee += amount * kFeedPeeShare;
            out.pooQueued = amount * kFeedPooShare;
            out.peeQueued = amount * kFeedPeeShare;
            break;
        case kVerbDrink:
            if (!fill(n.water)) break;
            n.pendingPee += amount * kDrinkPeeShare;
            out.peeQueued = amount * kDrinkPeeShare;
            break;
        case kVerbToilet: {
            // ДАВЛЕНИЕ, А НЕ ЗАПАС: бар падает. Сколько снять — `amount`, а
            // ВЕЛИЧИНУ ДЕЯНИЯ облегчения называет тело (`needs_body_total`):
            // окно-поток делит её на кванты, и за всё окно тело опорожняется
            // целиком — закон клавиши P владельца 2026-08-28 на любое тело.
            if (amount <= 0.0f) break;
            const ReliefResult r = relieve_needs(n, amount, amount);
            out.gained = r.pee + r.poo;
            out.relievedPee = r.pee;
            // «Нечего снимать» — тоже отказ значением: пустое тело не
            // облегчается, и вызывающий не начнёт деяния, которое ничего не даст.
            out.served = out.gained > 0.0f;
            break;
        }
        default:
            break; // глагол не про клок нужд — served остаётся false
    }
    return out;
}

} // namespace giga::game
