#include "game/contract.h"

#include <cstdio>

#include "game/faction_relations.h"

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
    const std::uint32_t h = mix(static_cast<std::uint32_t>(giver) * 0x9e3779b9u ^
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
            if (mix(h ^ total) % total < w) want = id;
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
        // HUNT. A kind that lives at this depth, so the job is findable.
        const std::uint16_t kind = static_cast<std::uint16_t>(
            mix(h ^ 0x51ed270bu) % static_cast<std::uint32_t>(kMobKindCount));
        const MobDef& md = kMobTable[kind];
        if (md.dmg == 0) return c;   // do not send anyone to hunt scenery
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

    c.giver = giver;
    c.state = static_cast<std::uint8_t>(ContractState::Offered);
    return c;
}

bool contract_text(const Contract& c, char* out, std::size_t cap) {
    if (c.giver == kInvalidNpc || !out || cap < 200) return false;
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

bool contract_accept(ContractBook& book, const Contract& offer) {
    if (offer.giver == kInvalidNpc) return false;
    for (int i = 0; i < kMaxContracts; ++i) {
        const Contract& s = book.slot[i];
        // Already holding this exact job from this exact person.
        if (s.state == static_cast<std::uint8_t>(ContractState::Active) &&
            s.giver == offer.giver && s.kind == offer.kind &&
            s.subject == offer.subject)
            return false;
    }
    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& s = book.slot[i];
        if (s.state == static_cast<std::uint8_t>(ContractState::Active)) continue;
        s = offer;
        s.state = static_cast<std::uint8_t>(ContractState::Active);
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
        if (c.giver != who) continue;
        // Nobody left to pay you. Quietly paying anyway would make the giver
        // decorative, and the whole point of a stable NpcId is that the person is real.
        c.state = static_cast<std::uint8_t>(ContractState::Failed);
        ++book.failed;
    }
}

std::int32_t contract_step(ContractBook& book, const NpcPool& pool, Inventory& inv,
                          RunLedger& led) {
    NpcPool& p = const_cast<NpcPool&>(pool);
    std::int32_t paid = 0;

    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& c = book.slot[i];
        if (c.state != static_cast<std::uint8_t>(ContractState::Active)) continue;

        // A giver who died between ticks fails the job. Checked here as well as on the
        // death event, because a body can also be lost to a floor unload rather than to
        // a death, and only one of those publishes.
        if (!p.valid(c.giver) || !p.alive(c.giver)) {
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
                    if (s.count == 0) s.item = kInvalidItem;
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
                c.progress = reached;
                if (reached < want) continue;
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
    }
    return paid;
}

} // namespace giga::game
