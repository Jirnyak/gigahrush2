#include "game/macro_sim.h"

#include "core/rng.h"
#include "game/population.h"  // height_for_age

namespace giga::game {

namespace {

constexpr std::uint32_t kDaysPerYear = 365;

// Independent hash streams for the different per-record decisions — salting keeps
// "does this NPC die?" uncorrelated with "who is a birth parent?" etc.
constexpr std::uint32_t kSaltDeath = 0x00d3a7bu;
constexpr std::uint32_t kSaltBirth = 0x00b19b7u;
constexpr std::uint32_t kSaltParent = 0x09a2e70u;
constexpr std::uint32_t kSaltBaby = 0x0ba8100u;

// Migration hash streams (master_prompt §7 #10c) — kept independent of the
// demographic salts so "does this NPC move?" is uncorrelated with life and death.
constexpr std::uint32_t kSaltMigrate = 0x0319a70u;  // does this record depart?
constexpr std::uint32_t kSaltDest    = 0x0de5700u;  // which floor does it pick?
constexpr std::uint32_t kSaltEta     = 0x0e7a411u;  // travel-time jitter

// Reservoir size for birth-parent sampling. Filled during the sweep via
// Algorithm R, so choosing parents costs one linear scan, not a search.
constexpr int kReservoir = 64;

// Per-YEAR old-age death probability: zero below onset, rising quadratically to
// `mortalityPeak` as age approaches maxAge. Reaching maxAge is handled as certain
// death by the caller, so this returns the pre-ceiling curve only.
float year_death_prob(std::uint8_t age, const MacroParams& p) {
    if (age < p.mortalityOnset) return 0.0f;
    if (p.maxAge <= p.mortalityOnset) return p.mortalityPeak;
    float span = static_cast<float>(p.maxAge - p.mortalityOnset);
    float t = static_cast<float>(age - p.mortalityOnset) / span;  // 0..1
    return p.mortalityPeak * t * t;
}

// Uniformly choose a destination floor in [lo,hi], excluding the record's current
// floor when it lies in that band (the reference's resolveDestination picks
// uniformly among candidate floors minus the current one). Route/danger gating is
// NOT ported yet — this side bakes no route metadata — so every in-band floor is an
// equal candidate; that gate is a later refinement ([macrosim.md]). Requires a real
// band (hi > lo), guaranteed by the migrateOn check at the call site.
std::uint16_t pick_dest_floor(NpcId id, std::uint32_t t32, std::uint16_t cur,
                              std::uint16_t lo, std::uint16_t hi) {
    const std::uint32_t count = static_cast<std::uint32_t>(hi - lo) + 1u;  // >= 2
    const std::uint32_t h = hash3(id, t32, kSaltDest);
    if (cur < lo || cur > hi) {
        // Current floor is outside the band (e.g. kNoFloorLabel): no exclusion.
        return static_cast<std::uint16_t>(lo + (h % count));
    }
    std::uint32_t d = h % (count - 1u);  // pick among the (count-1) OTHER floors
    std::uint16_t dst = static_cast<std::uint16_t>(lo + d);
    if (dst >= cur) dst = static_cast<std::uint16_t>(dst + 1u);  // step over current
    return dst;
}

}  // namespace

void MacroSim::init(const NpcPool& pool) {
    ageDays_.assign(pool.capacity(), 0);
    traveling_.assign(pool.capacity(), 0);
    journeys_.clear();
    migCursor_ = 0;
    tick_ = 0;
    day_ = 0.0;
    stats_ = MacroStats{};
}

MacroStats MacroSim::step(NpcPool& pool, const MacroParams& params) {
    const std::uint32_t n = pool.count();  // snapshot: newborns land beyond this
    const int days = params.daysPerTick > 0 ? params.daysPerTick : 1;
    const float yearFrac = static_cast<float>(days) / static_cast<float>(kDaysPerYear);
    const std::uint32_t t32 = static_cast<std::uint32_t>(tick_);

    std::uint32_t living = 0;
    std::uint32_t deaths = 0;

    NpcId reservoir[kReservoir];
    int fertile = 0;  // fertile adults seen so far (drives Algorithm R weighting)

    // ---- Single columnar sweep: age, then old-age mortality, sampling parents.
    for (NpcId id = 0; id < n; ++id) {
        if (!pool.alive(id)) continue;

        // Embodied records (the player included — it is just a record with the
        // NpcPlayer bit, npc_pool.h) are owned by the live micro/ECS sim: it ages
        // and can kill them on the fine clock. The macro sweep must NOT, or it
        // would quietly age the on-screen player to death. Count them among the
        // living, then leave them alone — no aging, no mortality, no parenthood.
        if (pool.embodied(id)) {
            ++living;
            continue;
        }

        // Aging: advance the fractional-year accumulator, roll whole years, and
        // saturate the accumulator once the age ceiling is reached.
        std::uint32_t d =
            static_cast<std::uint32_t>(ageDays_[id]) + static_cast<std::uint32_t>(days);
        std::uint8_t age = pool.age(id);
        while (d >= kDaysPerYear && age < params.maxAge) {
            d -= kDaysPerYear;
            ++age;
        }
        if (age >= params.maxAge) d = kDaysPerYear - 1;
        ageDays_[id] = static_cast<std::uint16_t>(d);
        pool.age(id) = age;

        // Mortality: certain at the ceiling, else the annual curve scaled to this
        // tick. A dead record keeps its slot (npc_pool.h) — count() never drops.
        if (age >= params.maxAge) {
            pool.kill(id);
            ++deaths;
            continue;
        }
        float yp = year_death_prob(age, params);
        if (yp > 0.0f) {
            float roll = rand01(hash3(id, t32, kSaltDeath));
            if (roll < yp * yearFrac) {
                pool.kill(id);
                ++deaths;
                continue;
            }
        }

        ++living;

        // Reservoir-sample fertile adults for the birth pass (Algorithm R, keyed
        // on the stateless hash so the reservoir is a deterministic function of
        // the pool state and tick).
        if (age >= params.fertileLo && age <= params.fertileHi) {
            if (fertile < kReservoir) {
                reservoir[fertile] = id;
            } else {
                std::uint32_t j = hash3(id, t32, kSaltParent) %
                                  static_cast<std::uint32_t>(fertile + 1);
                if (j < static_cast<std::uint32_t>(kReservoir)) reservoir[j] = id;
            }
            ++fertile;
        }
    }

    // ---- Births: reserve draws that hold the population near its target. -----
    // The expected count is the per-capita annual rate scaled to the tick, plus a
    // gentle catch-up toward the target so the society recovers from die-offs.
    // Deterministic rounding: floor + a probabilistic carry on the fraction.
    std::uint32_t births = 0;
    const int nRes = fertile < kReservoir ? fertile : kReservoir;
    if (nRes > 0 && pool.reserve_remaining() > 0) {
        float expected = static_cast<float>(living) * params.birthRate * yearFrac;
        if (living < params.targetPopulation) {
            expected += static_cast<float>(params.targetPopulation - living) * 0.01f;
        }
        std::uint32_t whole = static_cast<std::uint32_t>(expected);
        float frac = expected - static_cast<float>(whole);
        if (rand01(hash3(t32, 0u, kSaltBirth)) < frac) ++whole;
        std::uint32_t room = pool.reserve_remaining();
        if (whole > room) whole = room;

        for (std::uint32_t k = 0; k < whole; ++k) {
            std::uint32_t pick =
                hash3(t32, k + 1u, kSaltParent) % static_cast<std::uint32_t>(nRes);
            NpcId parent = reservoir[pick];
            NpcId baby = pool.spawn();
            if (baby == kInvalidNpc) break;  // reserve exhausted mid-loop

            // Newborn: age 0, stature from age, inherits the parent's floor,
            // faction, and macro cell so it appears where people actually live.
            ageDays_[baby] = 0;
            pool.age(baby) = 0;
            pool.sex(baby) = (hash3(t32, k, kSaltBaby) & 1u) ? SexFemale : SexMale;
            pool.height_mm(baby) = height_for_age(0, hash3(baby, t32, kSaltBaby));
            pool.set_floor(baby, pool.floor(parent));
            pool.cx(baby) = pool.cx(parent);
            pool.cy(baby) = pool.cy(parent);
            pool.cz(baby) = pool.cz(parent);
            pool.faction(baby) = pool.faction(parent);
            pool.max_hp(baby) = 100;
            pool.hp(baby) = 100;
            pool.level(baby) = 1;
            ++births;
            ++living;
        }
    }

    // ---- Migration: a budgeted ring-scan starts multi-tick journeys; due ones
    // land as a pure set_floor relabel (O(1) via the #10b bucket index). This rides
    // the SAME coarse clock as the demographic sweep (one world time) but is
    // O(budget), not O(n): only ~migrateRecordsPerTick records are considered per
    // tick — the reference's bounded-cursor primitive ([macrosim.md]). Off unless a
    // real floor band is configured, so the demographic-only bench stays untouched.
    std::uint32_t departures = 0;
    std::uint32_t arrivals = 0;
    if (params.floorHi > params.floorLo && params.migrateRatePerYear > 0.0f) {
        const double afterDay = day_ + static_cast<double>(days);

        // (1) Land every journey whose ETA has arrived. A record that died or was
        // embodied (pulled onto the live floor) mid-transit forfeits the journey:
        // the micro sim owns embodied floors, and a dead record is off the map.
        std::size_t w = 0;
        for (std::size_t r = 0; r < journeys_.size(); ++r) {
            const Journey j = journeys_[r];
            if (j.etaDay > afterDay) {
                journeys_[w++] = j;  // still travelling
                continue;
            }
            traveling_[j.id] = 0;
            if (pool.alive(j.id) && !pool.embodied(j.id)) {
                pool.set_floor(j.id, j.toFloor);
                ++arrivals;
            }
        }
        journeys_.resize(w);

        // (2) Ring-scan up to `budget` cold records from the persistent cursor,
        // rolling a departure for each and, on success, starting a journey. The
        // cursor wraps over the POST-birth count so newborns eventually migrate too.
        const float departProb = params.migrateRatePerYear * yearFrac;
        const std::uint32_t total = pool.count();
        std::uint32_t budget = params.migrateRecordsPerTick;
        if (budget > total) budget = total;
        NpcId id = total ? migCursor_ % total : 0u;
        for (std::uint32_t k = 0; k < budget; ++k, id = (id + 1u) % total) {
            if (journeys_.size() >= params.maxJourneys) break;
            if (!pool.alive(id) || pool.embodied(id) || traveling_[id]) continue;
            if (rand01(hash3(id, t32, kSaltMigrate)) >= departProb) continue;

            const std::uint16_t cur = pool.floor(id);
            const std::uint16_t dst =
                pick_dest_floor(id, t32, cur, params.floorLo, params.floorHi);
            const std::uint16_t dz =
                (cur >= params.floorLo && cur <= params.floorHi)
                    ? static_cast<std::uint16_t>(dst > cur ? dst - cur : cur - dst)
                    : std::uint16_t{1};
            const float jitter = 0.8f + rand01(hash3(id, t32, kSaltEta)) * 0.55f;
            const double travelDays =
                (static_cast<double>(params.travelBaseDays) +
                 static_cast<double>(params.travelPerFloorDays) *
                     static_cast<double>(dz)) *
                static_cast<double>(jitter);

            journeys_.push_back(Journey{id, dst, afterDay + travelDays});
            traveling_[id] = 1;
            ++departures;
        }
        migCursor_ = total ? id : 0u;
    }

    ++tick_;
    day_ += static_cast<double>(days);
    stats_.living = living;
    stats_.deaths = deaths;
    stats_.births = births;
    stats_.departures = departures;
    stats_.arrivals = arrivals;
    stats_.inTransit = static_cast<std::uint32_t>(journeys_.size());
    stats_.tick = tick_;
    stats_.day = day_;
    return stats_;
}

}  // namespace giga::game
