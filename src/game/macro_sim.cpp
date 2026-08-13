#include "game/macro_sim.h"

#include "game/npc_pool.h"
#include "core/rng.h"

#include "game/faction_relations.h"  // FactionRelations, rel_row
#include "game/floor_registry.h"     // kMinFloor / kMaxFloor / kFloorSlots
#include "game/population.h"         // height_for_age
#include "game/item_table.h"

namespace giga::game {

namespace {

constexpr std::uint32_t kDaysPerYear = 365;
constexpr std::uint64_t kTenthsPerDay = 10;

// STATELESS hashing is the whole determinism strategy: every per-record decision is a
// hash of (id, tick, salt), so there is no per-NPC RNG state to carry, the sweep does
// not depend on iteration order, and the same (pool, params, step count) reproduces
// bit-for-bit. Uses giga::hash2 / hash3 / rand01 from core/rng.h (single source).

// Independent hash streams for the different per-record decisions — salting keeps
// "does this NPC die?" uncorrelated with "who is a birth parent?" and so on. Every
// one is XORed with MacroParams::seed at the call site, which the branch version
// declared and then never used: its `seed` knob documented itself as "salts the
// deterministic hashes" while appearing in no hash at all, so two differently-seeded
// runs evolved identically.
constexpr std::uint32_t kSaltDeath        = 0x00d3a7bu;
constexpr std::uint32_t kSaltBirth        = 0x00b19b7u;
constexpr std::uint32_t kSaltParent       = 0x09a2e70u;
constexpr std::uint32_t kSaltBaby         = 0x0ba8100u;
constexpr std::uint32_t kSaltMigrate      = 0x0319a70u;  // does this record depart?
constexpr std::uint32_t kSaltDest         = 0x0de5700u;  // which floor does it pick?
constexpr std::uint32_t kSaltEta          = 0x0e7a411u;  // travel-time jitter
constexpr std::uint32_t kSaltSocial       = 0x05c1a10u;  // does it form an edge?
constexpr std::uint32_t kSaltSocialPeer   = 0x0bdd1e5u;  // which co-floor peer?
constexpr std::uint32_t kSaltSocialJitter = 0x0777e13u;  // seed-affinity jitter

// A visited record makes a few deterministic tries to land on a valid distinct
// co-floor peer before giving up this tick.
constexpr std::uint32_t kSocialCandidateTries = 8;

// Co-floor candidate selection for social edges.
//
// Uses NpcPool's per-floor bucket index (`pool.floor_bucket(label)`), which is kept
// up-to-date by set_floor() and spawn()/kill(). Candidates are selected by hashing
// into the floor's live roster vector.


// Symmetric +/- jitter added to the faction-pair baseline when seeding a new edge, so
// same-faction pairs do not all start at an identical affinity.
constexpr int kSocialSeedJitter = 40;

// Reservoir size for birth-parent sampling. Filled during the sweep via Algorithm R,
// so choosing parents costs one linear scan and never a search.
constexpr int kReservoir = 64;

// Per-YEAR old-age death probability: zero below onset, rising quadratically to
// `mortalityPeak` as age approaches maxAge. Reaching maxAge is handled as certain
// death by the caller, so this returns the pre-ceiling curve only.
float year_death_prob(int age, const MacroParams& p) {
    const int onset = static_cast<int>(p.mortalityOnset);
    const int ceiling = static_cast<int>(p.maxAge);
    if (age < onset) return 0.0f;
    if (ceiling <= onset) return p.mortalityPeak;
    const float span = static_cast<float>(ceiling - onset);
    const float t = static_cast<float>(age - onset) / span;  // 0..1
    return p.mortalityPeak * t * t;
}

// Baseline affinity between two records' diplomatic rows — the symmetric
// quarter-scaled average of the two directed matrix cells. It biases a NEWLY formed
// edge toward the societies' standing: two Citizens meet warm (+50 from the +100
// diagonal), a Citizen and a Wild meet cold (-25 from the -50 pair), and both numbers
// fall straight out of kBaseFactionMatrix rather than being authored here.
//
// `rel_row` and not `body_row`, matching `bodies_hostile` — the one existing
// NPC-vs-NPC consumer. A person asks who they are dealing with diplomatically, so the
// player's own standing applies rather than the faction of the body they wear
// ([faction_relations.h] documents that asymmetry at length). It is moot for cold
// records, which are never the camera holder, but agreeing with the neighbouring
// mechanic costs nothing and disagreeing with it would be a trap.
//
// `(sum + 2) >> 2` is floor((sum + 2) / 4) for the signed sum; arithmetic right shift
// on a negative value is floor-division in C++20 and later. Range: [-25, 50].
int faction_affinity(const FactionRelations& fr, const NpcPool& pool, NpcId a,
                     NpcId b) {
    const std::uint8_t ra = rel_row(pool, a);
    const std::uint8_t rb = rel_row(pool, b);
    const int sum = static_cast<int>(fr.at(ra, rb)) + static_cast<int>(fr.at(rb, ra));
    return (sum + 2) >> 2;
}

// Ensure record `a` holds a relationship edge toward `b`, seeded from the pair's
// faction baseline plus deterministic jitter. Slot policy, in order: a STALE edge that
// names b's id (the ABA slot) -> first empty -> first stale -> evict the weakest LIVE
// edge (min |affinity|). Returns true iff a NEW edge was created and adds every stale
// slot it reclaims to `dropped`, so a drop is a published number rather than a silent
// overwrite. An already-present LIVE edge is left untouched, because nothing off-screen
// raises the combat/quest events that drive drift and there is no baseline pull-back —
// this pass only GROWS the graph.
//
// STALENESS IS NOT A SPECIAL CASE HERE, IT IS WHY THE SCAN ORDER CHANGED. The scan used
// to ask `row[si].target == b` first and stop. Under recycling that is a SLOT
// comparison, not a person comparison: if a's row holds a dead man's edge and `b` is
// the newborn who inherited his id, the old scan answered "already acquainted",
// returned false, and left the corpse's affinity standing in for a stranger —
// permanently, because nothing ever revisits an existing edge. So a stale slot must not
// answer that question, must not be evictable by an affinity it no longer means, and
// must be reusable. Reclaiming the ABA slot FIRST is what keeps a row free of duplicate
// targets (one stale + one live edge to the same id is exactly the duplicate
// [suite_macrosim.inl] block 5 forbids), and preferring a genuinely empty slot over any
// other stale one is what keeps the slot a fresh edge lands in bit-identical for every
// pool that never recycles.
//
// One-directional on purpose: it writes a's row and not b's, so "acquaintance" is
// asymmetric until b's own probe happens to draw a. Two writes would double the
// DEMAND-column traffic for a symmetry the reference does not have.
bool form_edge(NpcPool& pool, const FactionRelations& fr, NpcId a, NpcId b,
               std::uint32_t jitterSalt, std::uint32_t& dropped) {
    // First call in the process materializes rel_ — 128 B/row, the widest column in
    // the pool ([npc_pool.h] "Column allocation policy"). Reached only when the
    // caller asked for the social pass AND handed over a matrix.
    std::array<Relationship, kRelSlots>& row = pool.relations(a);
    int aba = -1;         // stale slot naming b's id — a stranger wearing b's number
    int firstEmpty = -1;
    int firstStale = -1;
    int weakest = 0;
    int weakestMag = 0x7fffffff;
    for (int s = 0; s < kRelSlots; ++s) {
        const std::size_t si = static_cast<std::size_t>(s);
        if (row[si].target == kInvalidNpc) {
            if (firstEmpty < 0) firstEmpty = s;  // remember, but keep scanning for b
            continue;                            // empty slots are not evictable
        }
        if (!social_edge_live(pool, row[si])) {
            // A corpse's edge, or a stranger's once the slot was recycled. Not an
            // acquaintance and not weighed against live edges by affinity.
            if (aba < 0 && row[si].target == b) aba = s;
            if (firstStale < 0) firstStale = s;
            continue;
        }
        if (row[si].target == b) return false;  // already acquainted — leave it
        const int mag = row[si].affinity < 0 ? -static_cast<int>(row[si].affinity)
                                             : static_cast<int>(row[si].affinity);
        if (mag < weakestMag) {
            weakestMag = mag;
            weakest = s;
        }
    }
    int pick = weakest;          // every slot live: evict the least-invested one
    bool reclaim = false;
    if (aba >= 0)             { pick = aba;        reclaim = true; }
    else if (firstEmpty >= 0) { pick = firstEmpty; }
    else if (firstStale >= 0) { pick = firstStale; reclaim = true; }
    if (reclaim) ++dropped;
    const std::size_t slot = static_cast<std::size_t>(pick);

    const int base = faction_affinity(fr, pool, a, b);
    // The JITTER HASH STILL EATS THE BARE ID. `b` feeds hash3 as an id, exactly as
    // before, so every affinity this pass has ever produced is reproduced bit-for-bit;
    // the generation is stamped afterwards, by social_edge_set, and enters no hash.
    // Feeding a handle in here would have re-rolled every edge in the game.
    const std::uint32_t range = static_cast<std::uint32_t>(2 * kSocialSeedJitter + 1);
    const int jit =
        static_cast<int>(hash3(a, b, jitterSalt) % range) - kSocialSeedJitter;
    int val = base + jit;
    if (val < kSocialAffinityMin) val = kSocialAffinityMin;
    if (val > kSocialAffinityMax) val = kSocialAffinityMax;
    social_edge_set(row[slot], pool, b, static_cast<std::int16_t>(val));
    return true;
}

} // namespace

void MacroSim::init() {
    // Release rather than clear: a second init() must not leave the scratch looking
    // materialized (non-empty capacity) while reading as never-touched, the same trap
    // npc_pool.cpp's drop_column exists for.
    ageDays_.clear();
    ageDays_.shrink_to_fit();
    traveling_.clear();
    traveling_.shrink_to_fit();
    journeys_.clear();
    journeys_.shrink_to_fit();
    floors_.clear();
    floorIdx_.clear();
    migCursor_ = 0;
    socCursor_ = 0;
    latchedTarget_ = 0;
    tick_ = 0;
    dayTenths_ = 0;
    stats_ = MacroStats{};
}

void MacroSim::ensure_rows(std::uint32_t rows) {
    if (static_cast<std::uint32_t>(ageDays_.size()) >= rows) return;
    // Geometric, for the reason npc_pool.cpp's grow_column spells out: resize(n)
    // allocates for n exactly, so a fixed-chunk step copies the whole column at every
    // boundary — 232 boundaries and ~14 GB of memcpy to reach the 950k target.
    std::size_t next = ageDays_.empty() ? static_cast<std::size_t>(kNpcLazyChunk)
                                        : ageDays_.size() * 2u;
    if (next < static_cast<std::size_t>(rows)) next = static_cast<std::size_t>(rows);
    if (next > static_cast<std::size_t>(kNpcPoolSize))
        next = static_cast<std::size_t>(kNpcPoolSize);
    // resize(n) VALUE-initializes the new rows, i.e. zeros them, which is what a
    // never-aged / not-travelling record must read as. The two columns are always
    // resized together, so ageDays_.size() is the single authority for both.
    ageDays_.resize(next);
    traveling_.resize(next);
}

void MacroSim::set_floors(const std::int16_t* labels, std::uint32_t count) {
    static_assert(kFloorSlots == 255, "the label -> index map covers the legal range");
    static_assert(kFloorSlots <= 32767, "an index into floors_ must fit std::int16_t");
    floors_.clear();
    floorIdx_.assign(static_cast<std::size_t>(kFloorSlots), static_cast<std::int16_t>(-1));
    if (labels == nullptr) return;
    for (std::uint32_t i = 0; i < count; ++i) {
        const int f = static_cast<int>(labels[i]);
        if (f < kMinFloor || f > kMaxFloor) continue;   // not a legal label
        const std::size_t slot = static_cast<std::size_t>(f - kMinFloor);
        if (floorIdx_[slot] >= 0) continue;             // duplicate
        floorIdx_[slot] = static_cast<std::int16_t>(floors_.size());
        floors_.push_back(static_cast<std::int16_t>(f));
    }
}

void MacroSim::set_floors_from(const FloorRegistry& reg) {
    std::int16_t labels[kFloorSlots] = {};
    std::uint32_t n = 0;
    for (int f = kMinFloor; f <= kMaxFloor; ++f) {
        if (reg.module_at(f) == kInvalidModule) continue;
        labels[n++] = static_cast<std::int16_t>(f);
    }
    set_floors(labels, n);
}

int MacroSim::floor_index(std::int16_t label) const {
    if (floorIdx_.empty()) return -1;
    const int n = static_cast<int>(label);
    if (n < kMinFloor || n > kMaxFloor) return -1;
    return static_cast<int>(floorIdx_[static_cast<std::size_t>(n - kMinFloor)]);
}

MacroStats MacroSim::step(NpcPool& pool, const MacroParams& params,
                          const FactionRelations* factions) {
    const std::uint32_t n = pool.count();  // snapshot: newborns land beyond this
    ensure_rows(n);

    const int days = params.daysPerTick > 0 ? params.daysPerTick : 1;
    const float yearFrac =
        static_cast<float>(days) / static_cast<float>(kDaysPerYear);
    const std::uint32_t t32 = static_cast<std::uint32_t>(tick_);

    // Every stream is seeded, so two differently-seeded runs diverge. Computed once
    // per step rather than per record.
    const std::uint32_t sDeath   = kSaltDeath ^ params.seed;
    const std::uint32_t sBirth   = kSaltBirth ^ params.seed;
    const std::uint32_t sParent  = kSaltParent ^ params.seed;
    const std::uint32_t sBaby    = kSaltBaby ^ params.seed;
    const std::uint32_t sMigrate = kSaltMigrate ^ params.seed;
    const std::uint32_t sDest    = kSaltDest ^ params.seed;
    const std::uint32_t sEta     = kSaltEta ^ params.seed;
    const std::uint32_t sSocial  = kSaltSocial ^ params.seed;
    const std::uint32_t sPeer    = kSaltSocialPeer ^ params.seed;

    // "Hold whatever the pool starts with" (targetPopulation == 0). Latched on the
    // first step that sees a population, not in init(), because the caller seeds the
    // world between the two.
    if (latchedTarget_ == 0) latchedTarget_ = pool.alive();

    std::uint32_t living = 0;
    std::uint32_t deaths = 0;

    NpcId reservoir[kReservoir] = {};
    int fertile = 0;  // fertile adults seen so far (drives Algorithm R weighting)

    // ---- Single columnar sweep: age, then old-age mortality, sampling parents. ----
    for (NpcId id = 0; id < n; ++id) {
        if (!pool.alive(id)) continue;

        // Embodied records (the player included — it is just a record with the
        // NpcPlayer bit) are owned by the live micro/ECS sim, which ages and can kill
        // them on the fine clock. The macro sweep must NOT, or it would quietly age
        // the on-screen player to death. Count them among the living, then leave them
        // alone — no aging, no mortality, no parenthood.
        if (pool.embodied(id)) {
            ++living;
            continue;
        }

        // Aging: advance the fractional-year accumulator, roll whole years, and
        // saturate the accumulator once the age ceiling is reached. The loop (rather
        // than one conditional decrement) is what makes a daysPerTick above 365 legal.
        std::uint32_t d = static_cast<std::uint32_t>(ageDays_[id]) +
                          static_cast<std::uint32_t>(days);
        int age = static_cast<int>(pool.age(id));
        const int maxAge = static_cast<int>(params.maxAge);
        while (d >= kDaysPerYear && age < maxAge) {
            d -= kDaysPerYear;
            ++age;
        }
        if (age >= maxAge) d = kDaysPerYear - 1;
        ageDays_[id] = static_cast<std::uint16_t>(d);
        pool.age(id) = static_cast<std::uint8_t>(age);

        // Mortality: certain at the ceiling, else the annual curve scaled to this
        // tick. A dead record keeps its slot ([npc_pool.h]) — count() never drops,
        // which is exactly why births are a one-way draw on the reserve (see the
        // horizon note in macro_sim.h).
        if (age >= maxAge) {
            pool.kill(id);
            ++deaths;
            continue;
        }
        const float yp = year_death_prob(age, params);
        if (yp > 0.0f && rand01(hash3(id, t32, sDeath)) < yp * yearFrac) {
            pool.kill(id);
            ++deaths;
            continue;
        }

        if (params.enableColdNeeds) {
            bool fed = false;
            auto& inv = pool.inventory(id);
            for (int i = 0; i < game::kInvSlots; ++i) {
                if (inv.slots[i].item != 0 && game::item_def(inv.slots[i].item).category == static_cast<std::uint8_t>(game::ItemCategory::Food)) {
                    --inv.slots[i].count;
                    if (inv.slots[i].count == 0) inv.slots[i].item = 0;
                    fed = true;
                    break;
                }
            }
            
            if (fed) {
                pool.needs(id).food = game::kColdFedLevel;
            } else {
                pool.needs(id).food -= game::kColdStarveStep;
                if (pool.needs(id).food <= 0.0f) {
                    pool.kill(id);
                    ++deaths;
                    continue;
                }
            }
        }

        ++living;

        // Reservoir-sample fertile adults for the birth pass (Algorithm R, keyed on
        // the stateless hash so the reservoir is a deterministic function of the pool
        // state and tick, not of arrival order).
        if (age >= static_cast<int>(params.fertileLo) &&
            age <= static_cast<int>(params.fertileHi)) {
            if (fertile < kReservoir) {
                reservoir[fertile] = id;
            } else {
                const std::uint32_t j = hash3(id, t32, sParent) %
                                        static_cast<std::uint32_t>(fertile + 1);
                if (j < static_cast<std::uint32_t>(kReservoir)) reservoir[j] = id;
            }
            ++fertile;
        }
    }

    // ---- Births: a closed loop on the target. --------------------------------
    // births = deaths (exact replacement) + an optional open-loop growth rate + a
    // first-order pull toward the target, the whole surplus clamped to
    // maxGrowthPerYear. Replacement makes the target stationary BY CONSTRUCTION
    // instead of by hoping an authored birth rate happens to equal an EMERGENT crude
    // death rate — see the MacroParams comment for the modelled drift figures.
    // Deterministic rounding: floor plus a probabilistic carry on the fraction.
    std::uint32_t births = 0;
    std::uint32_t blocked = 0;
    const std::uint32_t target =
        params.targetPopulation != 0u ? params.targetPopulation : latchedTarget_;
    const int nRes = fertile < kReservoir ? fertile : kReservoir;
    if (nRes > 0) {
        float expected = static_cast<float>(deaths);
        expected += static_cast<float>(living) * params.growthRatePerYear * yearFrac;
        if (target > living) {
            expected += static_cast<float>(target - living) *
                        params.recoverGainPerYear * yearFrac;
        }
        const float ceiling =
            static_cast<float>(deaths) +
            static_cast<float>(living) * params.maxGrowthPerYear * yearFrac;
        if (expected > ceiling) expected = ceiling;
        if (expected < 0.0f) expected = 0.0f;  // a negative param must not underflow

        std::uint32_t whole = static_cast<std::uint32_t>(expected);
        const float frac = expected - static_cast<float>(whole);
        if (rand01(hash3(t32, 0u, sBirth)) < frac) ++whole;

        // The reserve floor is not decoration: the plast is what every runtime spawn
        // draws from and the pool never gives a slot back.
        std::uint32_t room = pool.reserve_remaining();
        room = room > params.reserveFloor ? room - params.reserveFloor : 0u;
        if (whole > room) {
            blocked = whole - room;
            whole = room;
        }

        for (std::uint32_t k = 0; k < whole; ++k) {
            const std::uint32_t pick =
                hash3(t32, k + 1u, sParent) % static_cast<std::uint32_t>(nRes);
            const NpcId parent = reservoir[pick];
            const NpcId baby = pool.spawn();
            if (baby == kInvalidNpc) break;  // reserve exhausted mid-loop
            ensure_rows(baby + 1u);

            // Newborn: age 0, stature from age, inheriting the parent's floor label,
            // macro cell and faction so it belongs where people actually live.
            //
            // A NEWBORN IS EMBODIED ON THE FLOOR'S NEXT LOAD. This paragraph used to say
            // the opposite — that embody_crowd walks a module's fixed `[firstId, count)`
            // range, that a newborn's id is at the pool tail outside every range, and
            // that births are therefore invisible "until a per-floor roster replaces the
            // fixed range". That roster HAS replaced it: FloorModule dropped firstId and
            // count, and floor_stream.cpp:109 states the crowd IS
            // `pool.floor_bucket(number)`, which embody_crowd copies and walks. The
            // `set_floor` three lines below puts the baby in the parent's bucket, which is
            // exactly the membership embody_crowd reads.
            //
            // Mortality was already visible (embody_crowd skips the dead). Both directions
            // of the demography now reach the player.
            ageDays_[baby] = 0;
            pool.age(baby) = 0;
            pool.sex(baby) = (hash3(t32, k, sBaby) & 1u) ? SexFemale : SexMale;
            pool.height_mm(baby) =
                height_for_age(static_cast<std::uint8_t>(0), hash3(baby, t32, sBaby));
            // set_floor, not a write through floor(): the accessor is read-only so the
            // per-floor bucket index cannot desync, and a newborn must land in its
            // parent bucket to be part of that floor roster.
            pool.set_floor(baby, pool.floor(parent));
            pool.cx(baby) = pool.cx(parent);
            pool.cy(baby) = pool.cy(parent);
            pool.cz(baby) = pool.cz(parent);
            pool.faction(baby) = pool.faction(parent);
            pool.max_hp(baby) = 100;
            pool.hp(baby) = 100;
            pool.level(baby) = static_cast<std::uint8_t>(1);
            ++births;
            ++living;
        }
    }

    // ---- Migration: a budgeted ring-scan starts multi-tick journeys; due ones land
    // as a pure relabel. This rides the SAME coarse clock as the demographic sweep
    // (one world time) but is O(budget), not O(n): only ~migrateRecordsPerTick records
    // are considered per tick. Off until set_floors() has registered two destinations.
    //
    // A relabel is macro-internal on this side. `pool.floor()` has exactly one other
    // writer (seed_floor_from_spec) and NO reader in src/ — [save.h] restates that as
    // of 2026-07-29 — so a migration cannot desync the streamer, and equally cannot
    // yet move a body. The label is the society's truth; embodiment catches up when a
    // per-floor roster lands.
    const std::uint64_t tenths =
        static_cast<std::uint64_t>(days) * kTenthsPerDay;
    const std::uint64_t afterTenths = dayTenths_ + tenths;
    std::uint32_t departures = 0;
    std::uint32_t arrivals = 0;

    // (1) Land every journey whose ETA has arrived. A record that died or was embodied
    // (pulled onto the live floor) mid-transit forfeits the journey: the micro sim owns
    // embodied floors, and a dead record is off the map.
    //
    // OUTSIDE the migration gate on purpose. If the landing pass sat inside it, turning
    // migration off (or clearing the destination set) mid-run would strand every
    // in-flight record with its `traveling_` byte set, freezing it out of migration for
    // the rest of the session and leaving `inTransit` reporting a number that can never
    // fall. Journeys already started are owed a landing regardless of the gate.
    if (!journeys_.empty()) {
        std::size_t w = 0;
        for (std::size_t r = 0; r < journeys_.size(); ++r) {
            const Journey j = journeys_[r];
            if (j.etaTenths > afterTenths) {
                journeys_[w++] = j;  // still travelling
                continue;
            }
            traveling_[j.id] = 0;
            // `alive` alone stops being sufficient the moment the pool recycles: a
            // traveller who died in transit can have had its slot handed to a newborn,
            // and that newborn IS alive — so the journey would teleport a stranger to a
            // dead traveller's destination. Comparing the generation is the ABA test.
            //
            // A no-op while recycling is off (a generation only advances when a slot is
            // reused, and a dead record already fails pool.alive), which is why this
            // lands BEFORE the arming line rather than with it.
            if (pool.alive(j.id) && pool.generation(j.id) == j.gen &&
                !pool.embodied(j.id)) {
                // A journey landing IS the O(1) relabel set_floor() exists for: it
                // splices the record out of its old floor bucket and into the new one.
                pool.set_floor(j.id, static_cast<std::int16_t>(j.toFloor));
                ++arrivals;
            }
        }
        journeys_.resize(w);
    }

    if (floors_.size() >= 2u && params.migrateRatePerYear > 0.0f) {
        // (2) Ring-scan up to `budget` cold records from the persistent cursor. The
        // cursor wraps over the POST-birth count so newborns eventually migrate too.
        const float departProb = params.migrateRatePerYear * yearFrac;
        const std::uint32_t total = pool.count();
        if (total > 0u) {
            std::uint32_t budget = params.migrateRecordsPerTick;
            if (budget > total) budget = total;
            const std::uint32_t inFlight =
                static_cast<std::uint32_t>(journeys_.size());
            const std::uint32_t room =
                params.maxJourneys > inFlight ? params.maxJourneys - inFlight : 0u;
            const std::uint32_t nFloors =
                static_cast<std::uint32_t>(floors_.size());

            NpcId id = migCursor_ % total;
            for (std::uint32_t k = 0; k < budget; ++k, id = (id + 1u) % total) {
                if (!pool.alive(id) || pool.embodied(id) || traveling_[id]) continue;
                // The journey cap does NOT break the loop. The branch broke out here,
                // which froze the cursor at the cap: the same handful of records were
                // re-visited every tick forever and the rest of the pool was never
                // considered again. Skipping keeps the cursor sweeping.
                if (departures >= room) continue;
                if (rand01(hash3(id, t32, sMigrate)) >= departProb) continue;

                const std::int16_t cur = pool.floor(id);
                const int ci = floor_index(cur);

                // Uniform over the registered SET, excluding the current floor when it
                // is in the set — done in index space, so a sparse stack costs nothing.
                const std::uint32_t h = hash3(id, t32, sDest);
                std::int16_t dst = 0;
                int dz = 1;
                if (ci < 0) {
                    // Not on a registered floor (a maze-bed record, or a label the
                    // caller dropped): no exclusion, and no meaningful distance.
                    dst = floors_[h % nFloors];
                } else {
                    std::uint32_t d = h % (nFloors - 1u);
                    if (d >= static_cast<std::uint32_t>(ci)) ++d;
                    dst = floors_[d];
                    dz = static_cast<int>(dst) - static_cast<int>(cur);
                    if (dz < 0) dz = -dz;
                }

                // Distance is in LABEL space, i.e. storeys: the building descends
                // physically, so |dst - cur| is how far a traveller actually walks.
                // Index distance would make a sparse stack's 44-storey gap cost the
                // same as an adjacent floor.
                const float jitter = 0.8f + rand01(hash3(id, t32, sEta)) * 0.55f;
                float travelDays = (params.travelBaseDays +
                                    params.travelPerFloorDays *
                                        static_cast<float>(dz)) * jitter;
                if (travelDays < 0.0f) travelDays = 0.0f;  // a negative cast is UB
                std::uint64_t travelTenths = static_cast<std::uint64_t>(
                    travelDays * static_cast<float>(kTenthsPerDay) + 0.5f);
                if (travelTenths == 0u) travelTenths = 1u;  // never land on departure

                Journey j{};
                j.id = id;
                j.toFloor = dst;
                // Stamp WHO is travelling, not only where to. A pure read of a recorded
                // column, so it costs nothing and cannot affect determinism.
                j.gen = pool.generation(id);
                j.etaTenths = afterTenths + travelTenths;
                journeys_.push_back(j);
                traveling_[id] = 1;
                ++departures;
            }
            migCursor_ = id;
        }
    }

    // ---- Social: a budgeted ring-scan that LAZILY forms per-NPC relationship edges
    // toward co-floor peers, each seeded from the caller's live faction matrix.
    // O(budget), not O(n). It reads POST-migration labels, so "co-floor" means the
    // roster after this tick's arrivals. Only grows the graph; event-driven drift
    // lands with the systems that raise those events (combat, quests).
    //
    // Every edge it writes carries its target's GENERATION (form_edge -> social_edge_set),
    // so a visited record also reclaims the edges it holds toward people who have since
    // died or whose slot has been recycled into somebody else. That reclamation is the
    // only place stale edges are ever removed — a reader must still validate, because a
    // record's own probe may not come round for many ticks ([macro_sim.h]).
    std::uint32_t socialEdges = 0;
    std::uint32_t socialStale = 0;
    if (factions != nullptr && params.socialFormRatePerYear > 0.0f &&
        params.socialRecordsPerTick > 0u) {
        const float formProb = params.socialFormRatePerYear * yearFrac;
        const std::uint32_t total = pool.count();
        if (total >= 2u) {
            std::uint32_t budget = params.socialRecordsPerTick;
            if (budget > total) budget = total;
            NpcId id = socCursor_ % total;
            for (std::uint32_t k = 0; k < budget; ++k, id = (id + 1u) % total) {
                // Cold records only: embodied social life is the utility-AI's job on
                // the live floor, not the macro pass's.
                if (!pool.alive(id) || pool.embodied(id)) continue;
                if (rand01(hash3(id, t32, sSocial)) >= formProb) continue;

                const std::int16_t label = pool.floor(id);

                // Exact co-floor lookup via pool.floor_bucket(label)
                const std::vector<NpcId>& bucket = pool.floor_bucket(label);
                if (bucket.size() < 2u) continue;  // no one else on this floor

                NpcId peer = kInvalidNpc;
                const std::size_t bucketSize = bucket.size();
                for (std::uint32_t attempt = 0; attempt < kSocialCandidateTries;
                     ++attempt) {
                    const std::size_t idx = hash3(id, t32 + attempt, sPeer) % bucketSize;
                    const NpcId cand = bucket[idx];
                    if (cand == id) continue;
                    if (!pool.alive(cand) || pool.embodied(cand)) continue;
                    peer = cand;
                    break;
                }
                if (peer == kInvalidNpc) continue;

                if (form_edge(pool, *factions, id, peer,
                              kSaltSocialJitter ^ params.seed ^ t32, socialStale)) {
                    ++socialEdges;
                }
            }
            socCursor_ = id;
        }
    }

    ++tick_;
    dayTenths_ += tenths;
    stats_.living = living;
    stats_.deaths = deaths;
    stats_.births = births;
    stats_.birthsBlocked = blocked;
    stats_.departures = departures;
    stats_.arrivals = arrivals;
    stats_.inTransit = static_cast<std::uint32_t>(journeys_.size());
    stats_.socialEdges = socialEdges;
    stats_.socialStaleDropped = socialStale;
    stats_.reserveRemaining = pool.reserve_remaining();
    stats_.target = target;
    stats_.tick = tick_;
    stats_.dayTenths = dayTenths_;
    return stats_;
}

// ---------------------------------------------------------------------------
// Wholesale state travel ([save.h] v6)
// ---------------------------------------------------------------------------
namespace {

void ms_u8(std::vector<std::uint8_t>& o, std::uint8_t v) { o.push_back(v); }
void ms_u16(std::vector<std::uint8_t>& o, std::uint16_t v) {
    o.push_back(static_cast<std::uint8_t>(v & 0xFFu));
    o.push_back(static_cast<std::uint8_t>((v >> 8) & 0xFFu));
}
void ms_u32(std::vector<std::uint8_t>& o, std::uint32_t v) {
    for (int i = 0; i < 4; ++i)
        o.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
}
void ms_u64(std::vector<std::uint8_t>& o, std::uint64_t v) {
    for (int i = 0; i < 8; ++i)
        o.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
}

struct MsReader {
    const std::uint8_t* p;
    std::size_t n;
    std::size_t at = 0;
    bool ok = true;
    std::uint8_t u8() {
        if (at >= n) { ok = false; return 0; }
        return p[at++];
    }
    std::uint16_t u16() {
        const std::uint32_t a = u8(), b = u8();
        return static_cast<std::uint16_t>(a | (b << 8));
    }
    std::uint32_t u32() {
        std::uint32_t v = 0;
        for (int i = 0; i < 4; ++i) v |= static_cast<std::uint32_t>(u8()) << (i * 8);
        return v;
    }
    std::uint64_t u64() {
        std::uint64_t v = 0;
        for (int i = 0; i < 8; ++i) v |= static_cast<std::uint64_t>(u8()) << (i * 8);
        return v;
    }
};

} // namespace

void MacroSim::save_state(std::vector<std::uint8_t>& out) const {
    out.clear();
    ms_u64(out, tick_);
    ms_u64(out, dayTenths_);
    ms_u32(out, migCursor_);
    ms_u32(out, socCursor_);
    ms_u32(out, static_cast<std::uint32_t>(ageDays_.size()));
    for (std::uint16_t v : ageDays_) ms_u16(out, v);
    ms_u32(out, static_cast<std::uint32_t>(traveling_.size()));
    for (std::uint8_t v : traveling_) ms_u8(out, v);
    ms_u32(out, static_cast<std::uint32_t>(journeys_.size()));
    for (const Journey& j : journeys_) {
        ms_u32(out, j.id);
        ms_u16(out, static_cast<std::uint16_t>(j.toFloor));
        ms_u16(out, j.gen);
        ms_u64(out, j.etaTenths);
    }
}

bool MacroSim::load_state(const std::uint8_t* bytes, std::size_t n) {
    if (!bytes || n < 8 + 8 + 4 + 4 + 4) return false;
    MsReader r{bytes, n};
    const std::uint64_t tick = r.u64();
    const std::uint64_t dayTenths = r.u64();
    const std::uint32_t mig = r.u32();
    const std::uint32_t soc = r.u32();
    const std::uint32_t ages = r.u32();
    if (ages > kNpcPoolSize) return false;
    std::vector<std::uint16_t> ageDays(ages);
    for (std::uint32_t i = 0; i < ages; ++i) ageDays[i] = r.u16();
    const std::uint32_t trav = r.u32();
    if (!r.ok || trav > kNpcPoolSize) return false;
    std::vector<std::uint8_t> traveling(trav);
    for (std::uint32_t i = 0; i < trav; ++i) traveling[i] = r.u8();
    const std::uint32_t jn = r.u32();
    if (!r.ok || jn > kNpcPoolSize) return false;
    std::vector<Journey> journeys(jn);
    for (std::uint32_t i = 0; i < jn; ++i) {
        journeys[i].id = r.u32();
        journeys[i].toFloor = static_cast<std::int16_t>(r.u16());
        journeys[i].gen = r.u16();
        journeys[i].etaTenths = r.u64();
    }
    if (!r.ok || r.at != n) return false;
    tick_ = tick;
    dayTenths_ = dayTenths;
    migCursor_ = mig;
    socCursor_ = soc;
    ageDays_ = std::move(ageDays);
    traveling_ = std::move(traveling);
    journeys_ = std::move(journeys);
    stats_ = MacroStats{};
    return true;
}

} // namespace giga::game
