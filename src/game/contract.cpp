#include "core/rng.h"
#include "game/contract.h"

#include <cmath>
#include <cstdio>

#include "game/faction_relations.h"

namespace giga::game {

namespace {


// Share of bodies who want something. Most people in a corridor are not hiring, and a
// floor where everyone has a job is a job board rather than a building.
constexpr std::uint32_t kOfferPct = 18;

// Reward as a multiple of what the job costs you.
//
// The reference's own economics doc puts a legal fetch at 1.3..2.0x the consumed value
// and an illegal one at 2.0..3.0x. 1.6x sits inside the legal band, which is the right
// choice while there is no crime model to make the illegal band mean anything.
constexpr float kFetchPayMult = 1.6f;

// A hunt has no consumed value to multiply, so it is priced off the target's own
// difficulty — the same `mob_hp_at_level` curve the monster's HP uses, so a deep-floor
// elite is worth more for exactly the reason it is harder.
constexpr std::int32_t kHuntPayPerHp = 3;

// Descend pays off the band it sends you to, not off distance: being asked to reach
// E4 is a different job from being asked to reach E1 even if both are "go down".
constexpr std::int32_t kDescendPayPerBand = 900;

} // namespace

Contract contract_offer(const NpcPool& pool, NpcId giver, int floorZ,
                        std::uint32_t seed) {
    Contract c;
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(giver) || !p.alive(giver)) return c;

    // Deterministic in (giver, floor): the same person always offers the same job, so
    // walking away and coming back cannot reroll it into something better.
    const std::uint32_t h = hash_u32(static_cast<std::uint32_t>(giver) * 0x9e3779b9u ^
                               static_cast<std::uint32_t>(floorZ) * 0x85ebca6bu ^ seed);
    if ((h % 100u) >= kOfferPct) return c;   // not hiring

    const std::uint8_t band = economy_band(floorZ);
    const std::int32_t bandCap = kLootValueCap[band];
    const std::uint32_t pick = (h >> 8) % 100u;

    if (pick < 45) {
        // FETCH. Pick something that can actually appear at this depth, or the job is
        // impossible — which is the one thing a contract must never be. The reference
        // ships a VISIT quest that can never complete; that is the mistake to avoid.
        ItemId want = kInvalidItem;
        std::uint32_t total = 0;
        for (ItemId id = 1; id <= kItemCount; ++id) {
            const std::uint32_t w = item_weight_on_floor(id, floorZ, 0);
            if (w == 0) continue;
            const ItemDef& d = item_def(id);
            // Something with a price, and cheap enough to be found more than once.
            if (d.value <= 0 || d.value > bandCap / 4) continue;
            total += w;
            // Reservoir choice, so no second pass and no vector.
            if (hash_u32(h ^ total) % total < w) want = id;
        }
        if (want == kInvalidItem) return c;
        const std::int32_t n =
            1 + static_cast<std::int32_t>((h >> 16) %
                                          (item_def(want).stackMax > 1 ? 3u : 2u));
        c.kind = static_cast<std::uint8_t>(ObjectiveKind::Fetch);
        c.subject = want;
        c.target = n;
        c.reward = static_cast<std::int32_t>(
            static_cast<float>(item_def(want).value * n) * kFetchPayMult);
        if (c.reward < 20) c.reward = 20;
    } else if (pick < 80) {
        // HUNT. A kind that can actually be met, which takes two tests and not one.
        const std::uint16_t kind = static_cast<std::uint16_t>(
            hash_u32(h ^ 0x51ed270bu) % static_cast<std::uint32_t>(kMobKindCount));
        const MobDef& md = kMobTable[kind];
        if (md.dmg == 0) return c;   // do not send anyone to hunt scenery
        // **SPAWNABILITY — the other half of "findable", and it was missing.** A floor's
        // roster is built from exactly two fields of the row (mob_spawn.cpp:161-162): a
        // `spawnWeightX10` of 0 is never rolled, and a `floorMask` naming no habitat
        // anchor matches no floor. Fail either for every floor and the kind cannot appear
        // by any path — the quest that can never complete this branch claims to avoid.
        // `dmg > 0` does not exclude them: both offenders hit hard (44 and 24). MEASURED
        // on the live offer stream (512 bodies x the 10 shipped floors, seed 0x9E37 as
        // src/app/main.cpp:844-845 passes it) with only the filter below removed: 318
        // Hunt offers, 7 naming one — CREATOR 3 (idx 13), PSEUDOLIFT 4 (idx 31), both a
        // literal 0 in data/mobs.csv; 311 survive, over 19 distinct kinds on the leanest
        // floor. An older 11 / 307 also named SCULPTURE, whose 0.05 went to 0.1 in
        // bd4db77 — right for that CSV, stale for this one. The floorMask half is vacuous
        // today (0 of 69 rows) and is here because `mask()` in tools/gen_mob_table.py
        // emits 0 for an empty `floors_z` cell — one blank cell reintroduces the bug.
        //
        // GLOBAL rather than per-floor, deliberately. `contract_on_kill`
        // (src/app/main.cpp:593) has no floor gate — a Hunt counts the kind wherever it
        // dies — and the shipped stack {0,1,2,-8,-14,-26,-36,-50,14,30} touches all six
        // anchors, so weight > 0 already means "meetable somewhere this run". Also
        // requiring the kind to live at THIS depth would remove no impossibility, only a
        // reason to descend, and it is measurably expensive: Hunt offers on -50 collapse
        // from 32 to 5 (only 15 of 69 rows carry the ZMinus50 bit) and on +14 from 25 to
        // 10. `minSamosbor` is deliberately not tested either — spawn_floor_mobs never
        // reads it, so even a 99 ("never") row spawns, and gating on it here would invent
        // an impossibility instead of removing one.
        if (md.spawnWeightX10 == 0 || md.floorMask == 0) return c;
        const std::int32_t n = 2 + static_cast<std::int32_t>((h >> 20) % 4u);
        // Danger 5 as the pricing baseline rather than the floor's real hostility: a
        // contract's price must not change because the floor spec was retuned, or the
        // same job would pay differently on two visits to the same floor.
        const std::uint8_t level = mob_level_for_floor(floorZ, /*danger=*/5);
        c.kind = static_cast<std::uint8_t>(ObjectiveKind::Hunt);
        c.subject = kind;
        c.target = n;
        c.reward = kHuntPayPerHp * static_cast<std::int32_t>(
                                       mob_hp_at_level(md.hp, level)) * n / 10;
        if (c.reward < 30) c.reward = 30;
    } else {
        // DESCEND. Deeper than here, and deep enough to be a trip rather than a step.
        const int deeper = floorZ <= 0 ? floorZ - (8 + static_cast<int>((h >> 24) % 16u))
                                       : floorZ + (8 + static_cast<int>((h >> 24) % 16u));
        c.kind = static_cast<std::uint8_t>(ObjectiveKind::Descend);
        c.target = deeper;
        c.reward = kDescendPayPerBand *
                   (static_cast<std::int32_t>(economy_band(deeper)) + 1);
    }

    // Minted HERE and nowhere else: the id above fed the hash, this is the (generation,
    // id) pair that outlives the tick. `giver` is known valid (:46), so `handle()` reads a
    // real generation rather than the 0 an out-of-range id would return. [contract.h]
    c.giver = pool.handle(giver);
    c.state = static_cast<std::uint8_t>(ContractState::Offered);
    return c;
}

bool contract_text(const Contract& c, char* out, std::size_t cap) {
    if (c.giver == kInvalidHandle || !out || cap < 200) return false;
    switch (static_cast<ObjectiveKind>(c.kind)) {
        case ObjectiveKind::Fetch:
            std::snprintf(out, cap,
                          "\xd0\x9f\xd1\x80\xd0\xb8\xd0\xbd\xd0\xb5\xd1\x81\xd0\xb8 "
                          "%s x%d \xd0\xbd\xd0\xb0 \xd0\xbf\xd0\xbb\xd0\xbe\xd1\x89"
                          "\xd0\xb0\xd0\xb4\xd0\xba\xd1\x83 \xe2\x80\x94 %d \xd1\x80"
                          "\xd1\x83\xd0\xb1.",
                          item_name(c.subject), static_cast<int>(c.target),
                          static_cast<int>(c.reward));
            return true;
        case ObjectiveKind::Hunt:
            std::snprintf(out, cap,
                          "\xd0\xa3\xd0\xb1\xd0\xb5\xd0\xb9 %s x%d \xe2\x80\x94 %d "
                          "\xd1\x80\xd1\x83\xd0\xb1.",
                          mob_name(static_cast<MobKind>(c.subject)),
                          static_cast<int>(c.target), static_cast<int>(c.reward));
            return true;
        case ObjectiveKind::Descend:
        default:
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xbf\xd1\x83\xd1\x81\xd1\x82\xd0\xb8\xd1\x81"
                          "\xd1\x8c \xd0\xb4\xd0\xbe %d \xe2\x80\x94 %d \xd1\x80\xd1"
                          "\x83\xd0\xb1.",
                          static_cast<int>(c.target), static_cast<int>(c.reward));
            return true;
    }
}

bool contract_accept(ContractBook& book, const Contract& offer,
                     const RunLedger& led) {
    if (offer.giver == kInvalidHandle) return false;

    // Stamped from the ledger rather than by the caller, so it cannot be forgotten. |z|
    // because depth is bidirectional; clamped to a byte because the stack is bounded at
    // +/-127. Hoisted above both loops because it does not depend on the slot AND because
    // the refusal below has to compare against the exact value that would be written —
    // recomputing it differently there is how this guard would go subtly wrong.
    const int already = led.deepestFloor < 0 ? -led.deepestFloor : led.deepestFloor;
    const std::uint8_t baseline = static_cast<std::uint8_t>(already > 127 ? 127 : already);

    // A Descend job whose target is already behind you is REFUSED here.
    //
    // contract_step's own comment promised exactly this ("A job whose target is already
    // behind you is refused at accept rather than paid") and nothing implemented it, so
    // the job was accepted into a slot it could never leave by playing. contract_step
    // skips it forever on `want <= c.baseline`, `baseline` is written exactly once, and
    // `RunLedger::deepestFloor` only ever rises — so Complete is permanently unreachable.
    // The slot is not unfailable, which is worth stating precisely: contract_on_giver_died
    // and contract_step's liveness check both still fire, so it clears eventually as a
    // FAILURE for a job the player was never able to complete, and it increments
    // book.failed on the way out. Unclearable by play, not unclearable.
    //
    // This is normal-play reachable, not abuse: an offer targets currentFloor -/+ (8 + h%16),
    // so any player who has already been deeper than the offering floor by that margin —
    // i.e. anyone walking back up — is handed a dead job. With three slots, three of those
    // brick the book.
    //
    // Refusing at accept rather than filtering at offer time is deliberate: the offer is
    // generated from (floor, hash) with no ledger in scope, and an offer list that silently
    // changes with the player's history would make the same giver on the same floor show
    // different work for reasons the player cannot see. A refusal is legible; a vanishing
    // offer is not.
    if (offer.kind == static_cast<std::uint8_t>(ObjectiveKind::Descend)) {
        const int want = offer.target < 0 ? -offer.target : offer.target;
        if (want <= static_cast<int>(baseline)) return false;
    }

    for (int i = 0; i < kMaxContracts; ++i) {
        const Contract& s = book.slot[i];
        if (s.state != static_cast<std::uint8_t>(ContractState::Active)) continue;

        // Already holding this exact job from this exact person.
        // `target` is part of identity: two Hunts for the same kind with different
        // counts, or two Fetches for the same item with different counts, are not
        // the same job — and without it a second offer would be refused forever
        // after the first was taken, even when the numbers differed.
        if (s.giver == offer.giver && s.kind == offer.kind &&
            s.subject == offer.subject && s.target == offer.target)
            return false;

        // Descend is special: payout is against |deepestFloor| and |target|, so a job
        // to -20 and a job to +20 are the SAME depth objective, and two jobs to the
        // same |target| from different givers (or the same giver under a second
        // baseline stamp) would both Complete on one descent and double-pay.
        // Three slots, three givers, one walk downstairs — that is the brick.
        // Refuse any second Active Descend whose absolute target collides, regardless
        // of giver, sign, or the baseline that would be stamped this accept.
        if (offer.kind == static_cast<std::uint8_t>(ObjectiveKind::Descend) &&
            s.kind == static_cast<std::uint8_t>(ObjectiveKind::Descend)) {
            const int haveWant = s.target < 0 ? -s.target : s.target;
            const int offerWant = offer.target < 0 ? -offer.target : offer.target;
            if (haveWant == offerWant) return false;
        }
    }
    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& s = book.slot[i];
        if (s.state == static_cast<std::uint8_t>(ContractState::Active)) continue;
        s = offer;
        s.state = static_cast<std::uint8_t>(ContractState::Active);
        s.baseline = baseline;
        s.progress = 0;
        return true;
    }
    return false;   // full; a refusal, not an error
}

void contract_on_kill(ContractBook& book, std::uint8_t mobKind) {
    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& c = book.slot[i];
        if (c.state != static_cast<std::uint8_t>(ContractState::Active)) continue;
        if (c.kind != static_cast<std::uint8_t>(ObjectiveKind::Hunt)) continue;
        if (c.subject != mobKind) continue;
        if (c.progress < c.target) ++c.progress;
    }
}

void contract_on_giver_died(ContractBook& book, NpcId who) {
    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& c = book.slot[i];
        if (c.state != static_cast<std::uint8_t>(ContractState::Active)) continue;
        // The ID HALF of the handle, because `who` is a bare pool id off the event ring
        // and the record is ALREADY DEAD when this runs — `pool.handle(who)` would mint
        // the corpse's bumped generation and match nothing. `npc_handle_id` masks to
        // kNpcPoolBits, so a `who` of kInvalidNpc matches no slot: never a wildcard.
        //
        // Coarser than `handle_valid`, and harmlessly so. The one case it over-matches is
        // a job whose giver died silently (a macro sweep publishes no event) into a slot
        // that was recycled, whose NEW occupant then dies in combat — and the verdict it
        // reaches there, Failed, is the same one contract_step's handle_valid poll reaches
        // for that job on the very next tick. It cannot pay a stranger, only fail earlier.
        if (npc_handle_id(c.giver) != who) continue;
        // Nobody left to pay you. Quietly paying anyway would make the giver decorative,
        // and the whole point of a generation-tagged handle is that the person is real.
        c.state = static_cast<std::uint8_t>(ContractState::Failed);
        ++book.failed;
    }
}

// See the long note in [contract.h]. MEASURED calibration, printed by
// `test_quest_all` on every run so it can be argued with rather than trusted —
// `xp_for_quest` doubles this value, and `xp_for_level(2) == 100`:
//
//   cheapest authored row (3x fetch, floors 0..2)     2.0  ->   40 xp
//   dearest authored row  (8x hunt,  floors 0..2)    12.3  ->  246 xp
//   deep contract         (5x Polzun at |z| = 50)    15.9  ->  318 xp
//   one Tvar kill at level 5, for scale                    ->   94 xp
//
// So an errand is worth about half a kill, a real job several, and no single quest
// is a level. That is the ratio the manifesto's two XP sources imply: kills are the
// bulk, quests are the spine. Note the dearest AUTHORED row pays 246 xp against 180
// roubles — xp and money are deliberately not the same axis, which is the whole
// reason difficulty is composed here instead of read off `reward`.
std::uint16_t objective_difficulty_e1(std::uint8_t kind, std::uint16_t subject,
                                      std::int32_t target, int depthAbsZ,
                                      bool timed) {
    const ObjectiveKind k = static_cast<ObjectiveKind>(kind);

    // 1. KIND — the one enum of objectives. Hunt is dearer than Fetch because it is
    //    the only one that shoots back.
    float d = k == ObjectiveKind::Hunt     ? 12.0f
              : k == ObjectiveKind::Fetch  ? 8.0f
                                           : 10.0f;  // Descend

    // 2. DEPTH — the same curve monsters, loot and resident level already read, so a
    //    job's difficulty moves with the floor for the same reason everything else
    //    does. Not a new notion of "danger", the existing one.
    const float depth01 = mob_depth01(depthAbsZ);
    d += 60.0f * depth01;

    // 3. SUBJECT — what the job is actually ABOUT, read from the subject's own table.
    if (k == ObjectiveKind::Hunt) {
        // How tough THAT creature is at THIS depth. Danger 5 as the baseline for the
        // same reason contract pricing uses it a few lines above: a job must not get
        // harder because a floor spec was retuned.
        const MobKind mk = static_cast<MobKind>(subject);
        if (static_cast<std::size_t>(subject) < kMobKindCount) {
            const std::uint8_t lvl = mob_level_for_floor(depthAbsZ, /*danger=*/5);
            d += static_cast<float>(mob_hp_at_level(mob_def(mk).hp, lvl)) / 12.0f;
        }
    } else if (k == ObjectiveKind::Fetch) {
        // How RARE that item is to find. Scarcity is the difficulty: six bandages off
        // any shelf is not one manometer.
        //
        // RELATIVE TO THE TYPICAL ITEM, ON A LOG SCALE, and the first version of this
        // line got it wrong in a way worth recording. `spawnWeight` is milli-weight on
        // a 0..50,000 range, so normalising linearly against the maximum looked
        // obvious — and was decoration: measured over data/items.csv the MEDIAN weight
        // is 800 and every item any quest actually names sits at 1,000, so
        // `1 - w/50000` returned 0.98 for all of them and the term was a constant
        // +29.4 dressed as a signal. It also silently doubled every quest's payout,
        // which is how it got noticed — one shallow courier job paid a whole level.
        //
        // The range is skewed (min 12, median 800, max 50,000), so the honest scale is
        // logarithmic against the common case: an item ~8x rarer than typical is worth
        // ~18, the rarest in the table saturates, and anything at or above typical is
        // worth 0. Weight 0 means "never spawns randomly" — the hardest case there is,
        // so it takes the cap instead of falling through as if it were common.
        if (item_valid(static_cast<ItemId>(subject))) {
            const std::uint16_t w = item_def(static_cast<ItemId>(subject)).spawnWeight;
            constexpr float kTypicalWeight = 1000.0f;  // measured: what quests name
            float rarity = 30.0f;                      // w == 0: never random
            if (w != 0) {
                rarity = 6.0f * std::log2(kTypicalWeight / static_cast<float>(w));
                if (rarity < 0.0f) rarity = 0.0f;
                if (rarity > 30.0f) rarity = 30.0f;
            }
            d += rarity;
        }
    }

    // 4. COUNT — the row's own target. Descend's `target` is a FLOOR, not a count,
    //    and feeding a floor label into a count term is exactly the double-meaning
    //    hazard [quest.h] warns about, so it is excluded by kind rather than by luck.
    if (k != ObjectiveKind::Descend && target > 1) {
        const float per = k == ObjectiveKind::Hunt ? 14.0f : 5.0f;
        d += per * static_cast<float>(target - 1);
    }

    // 5. A CLOCK — the row's own deadline. Pressure, not arithmetic: the same job
    //    with a timer is a harder job.
    if (timed) d += 10.0f;

    // ...and the next term goes HERE, one line, naming its system.

    if (d < 1.0f) d = 1.0f;
    if (d > 65535.0f) d = 65535.0f;
    return static_cast<std::uint16_t>(d + 0.5f);
}

std::int32_t contract_step(ContractBook& book, const NpcPool& pool, Inventory& inv,
                          RunLedger& led, RpgStats* rpg) {
    std::int32_t paid = 0;

    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& c = book.slot[i];
        if (c.state != static_cast<std::uint8_t>(ContractState::Active)) continue;

        // A giver who died between ticks fails the job. Checked here as well as on the
        // death event, because a body can also be lost to a floor unload rather than to
        // a death, and only one of those publishes.
        //
        // **THE recycling guard.** `handle_valid` is one test for three distinct ways the
        // person can stop being the person: an id past the high-water mark, a cleared
        // alive bit, and — the one a bare id could never see — a stale GENERATION, i.e.
        // the slot was reclaimed and handed to somebody else. `kill()` bumps the counter
        // whether or not the slot is reused, so this covers a plain death too and the old
        // `valid() || alive()` pair is strictly subsumed. Deaths in the macro sweep publish
        // no NpcDied event ([macro_sim.h]), so for those this poll is the ONLY guard, and
        // before the handle it was a poll that answered "somebody is alive at that index"
        // when the question was "is my giver alive". [contract.h]
        if (!pool.handle_valid(c.giver)) {
            c.state = static_cast<std::uint8_t>(ContractState::Failed);
            ++book.failed;
            continue;
        }

        switch (static_cast<ObjectiveKind>(c.kind)) {
            case ObjectiveKind::Fetch: {
                std::int32_t have = 0;
                for (const ItemSlot& s : inv.slots)
                    if (s.item == c.subject) have += s.count;
                c.progress = have;
                if (have < c.target) continue;
                // CONSUME. A courier job that let you keep the cargo would pay twice
                // for the same loot — once as the reward and once as the haul — which
                // is the difference between an errand and a bonus.
                std::int32_t need = c.target;
                for (ItemSlot& s : inv.slots) {
                    if (need <= 0) break;
                    if (s.item != c.subject) continue;
                    const std::int32_t take = s.count < need ? s.count : need;
                    s.count = static_cast<std::uint16_t>(s.count - take);
                    if (s.count == 0) s = ItemSlot{};
                    need -= take;
                }
                break;
            }
            case ObjectiveKind::Hunt:
                if (c.progress < c.target) continue;
                break;
            case ObjectiveKind::Descend: {
                // |z|, because depth is bidirectional and a job to reach the roof is
                // as real as one to reach the basement.
                const int reached = led.deepestFloor < 0 ? -led.deepestFloor
                                                         : led.deepestFloor;
                const int want = c.target < 0 ? -c.target : c.target;
                // **Against where you were WHEN YOU TOOK IT, not against the run's
                // high-water mark.** `RunLedger::deepestFloor` never falls, so comparing
                // to it paid instantly for a descent made before the job existed — and
                // paid AGAIN on every re-accept. An audit measured 900 roubles on accept
                // and 900 more on re-accept with the player never moving: an infinite
                // press, limited only by how fast the accept key could be pressed.
                //
                // `baseline` is stamped at accept time ([contract.h]), so a Descend job
                // now requires progress beyond that point. A job whose target is already
                // behind you is refused by contract_accept and never reaches this loop —
                // that refusal is implemented now; this comment used to promise it while
                // nothing did it, which left slots that could not be cleared by playing.
                if (reached < want) { c.progress = reached; continue; }
                if (want <= c.baseline) continue;   // nothing was actually descended
                c.progress = reached;
                break;
            }
            default:
                continue;
        }

        c.state = static_cast<std::uint8_t>(ContractState::Complete);
        // Paid straight into the banked total: a contract reward is not carried loot
        // and must not be at risk on the walk home. That is what being PAID means, and
        // it is the one thing that makes a contract safer than looting the same value.
        led.banked += c.reward;
        book.earned += c.reward;
        ++book.completed;
        paid += c.reward;

        // XP, through the ONE path that awards it ([rpg.cpp] award_xp, which is also
        // the only thing that levels anyone up). Manifest p.5 asks for XP from quests
        // as well as kills; `xp_for_quest` was written for it and had no caller
        // outside tests until 2026-08-12.
        //
        // `baseline` is |z| already reached when the job was accepted — depth context
        // the row ALREADY carries and already serializes, so nothing had to grow to
        // make this composite honest. Contracts have no deadline field, hence false.
        if (rpg != nullptr)
            award_xp(*rpg, xp_for_quest(objective_difficulty_e1(
                               c.kind, c.subject, c.target,
                               static_cast<int>(c.baseline), /*timed=*/false)));
    }
    return paid;
}

} // namespace giga::game
