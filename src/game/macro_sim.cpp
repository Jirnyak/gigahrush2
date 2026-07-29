#include "game/macro_sim.h"

#include "game/faction_relations.h"  // FactionRelations, rel_row
#include "game/floor_registry.h"     // kMinFloor / kMaxFloor / kFloorSlots
#include "game/population.h"         // height_for_age

namespace giga::game {

namespace {

constexpr std::uint32_t kDaysPerYear = 365;
constexpr std::uint64_t kTenthsPerDay = 10;

// splitmix32 finalizer, as in wander.cpp / hunt.cpp / population.cpp /
// faction_relations.cpp / mob_spawn.cpp. Duplicated for the same reason all five
// duplicate it: three lines, wanted inlined, and a shared header between otherwise
// independent systems buys nothing. The branch this module was ported from shipped a
// src/core/rng.h for exactly this; on this side the file-local copy is the
// established convention, and introducing a sixth-caller core header to replace five
// identical copies is a tree-wide cleanup, not a line item in a society sim.
std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// STATELESS hashing is the whole determinism strategy: every per-record decision is a
// hash of (id, tick, salt), so there is no per-NPC RNG state to carry, the sweep does
// not depend on iteration order, and the same (pool, params, step count) reproduces
// bit-for-bit. Order-sensitive and well-mixed, so consecutive ids at a fixed tick
// spread across the whole range.
std::uint32_t hash2(std::uint32_t a, std::uint32_t b) {
    return mix(a ^ (mix(b) * 0x9e3779b9u + 0x85ebca6bu));
}
std::uint32_t hash3(std::uint32_t a, std::uint32_t b, std::uint32_t c) {
    return hash2(hash2(a, b), c);
}
// Uniform float in [0, 1) from a hash word (top 24 bits -> exact 2^-24 spacing).
float rand01(std::uint32_t h) {
    return static_cast<float>(h >> 8) * (1.0f / 16777216.0f);
}

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

// Half-width of the ID WINDOW a social probe searches for a co-floor peer.
//
// This replaces the branch's per-floor bucket index, which lived inside its NpcPool
// and does not exist on this side (`floor_bucket` / `set_floor` are absent; the floor
// column has one writer in seed_floor_from_spec and had zero readers before this
// file). Rebuilding a roster per tick would put an O(n) counting sort back into a
// pass whose whole point is being O(budget), so the probe exploits a documented
// property of this tree instead: **a floor's crowd is one CONTIGUOUS id run.**
// `seed_floor_from_spec` bump-allocates `spec.population` consecutive slots and
// FloorStreamer remembers the range as `[firstId, firstId + count)` ([floor_stream.h]
// — that invariant is what stops the population growing per visit), so id-adjacency
// implies floor-adjacency for every seeded record.
//
// 512 sized against the widest floor in main.cpp's demo stack: Residential carries
// 420 records, so a +/-512 window spans a whole floor's roster and then some. The
// label is re-checked on every candidate, so a probe can never form a cross-floor
// edge — a window that lands off the floor costs throughput, never correctness.
//
// Known limit, stated rather than hidden: a NEWBORN's id is at the pool tail among
// other newborns from other floors, so its window is mixed and most of its eight
// tries miss. Newborns therefore acquire edges more slowly than seeded records. The
// clean fix is the same per-floor index the branch had, in NpcPool, where a floor
// streamer would also want it.
constexpr std::uint32_t kSocialProbeSpan = 512;

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
// faction baseline plus deterministic jitter. Slot policy = existing -> first-empty ->
// evict-weakest (min |affinity|). Returns true iff a NEW edge was created: an
// already-present edge is left untouched, because nothing off-screen raises the
// combat/quest events that drive drift and there is no baseline pull-back — this pass
// only GROWS the graph.
//
// One-directional on purpose: it writes a's row and not b's, so "acquaintance" is
// asymmetric until b's own probe happens to draw a. Two writes would double the
// DEMAND-column traffic for a symmetry the reference does not have.
bool form_edge(NpcPool& pool, const FactionRelations& fr, NpcId a, NpcId b,
               std::uint32_t jitterSalt) {
    // First call in the process materializes rel_ — 128 B/row, the widest column in
    // the pool ([npc_pool.h] "Column allocation policy"). Reached only when the
    // caller asked for the social pass AND handed over a matrix.
    std::array<Relationship, kRelSlots>& row = pool.relations(a);
    int firstEmpty = -1;
    int weakest = 0;
    int weakestMag = 0x7fffffff;
    for (int s = 0; s < kRelSlots; ++s) {
        const std::size_t si = static_cast<std::size_t>(s);
        if (row[si].target == b) return false;  // already acquainted — leave it
        if (row[si].target == kInvalidNpc) {
            if (firstEmpty < 0) firstEmpty = s;  // remember, but keep scanning for b
            continue;                            // empty slots are not evictable
        }
        const int mag = row[si].affinity < 0 ? -static_cast<int>(row[si].affinity)
                                             : static_cast<int>(row[si].affinity);
        if (mag < weakestMag) {
            weakestMag = mag;
            weakest = s;
        }
    }
    const std::size_t slot =
        static_cast<std::size_t>(firstEmpty >= 0 ? firstEmpty : weakest);

    const int base = faction_affinity(fr, pool, a, b);
    const std::uint32_t range = static_cast<std::uint32_t>(2 * kSocialSeedJitter + 1);
    const int jit =
        static_cast<int>(hash3(a, b, jitterSalt) % range) - kSocialSeedJitter;
    int val = base + jit;
    if (val < kSocialAffinityMin) val = kSocialAffinityMin;
    if (val > kSocialAffinityMax) val = kSocialAffinityMax;
    row[slot].target = b;
    row[slot].affinity = static_cast<std::int16_t>(val);
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
            // It will NOT be embodied by FloorStreamer, and that is a wiring gap
            // rather than a bug here: embody_crowd walks the module's fixed
            // `[firstId, count)` range ([floor_stream.h]) and a newborn's id is at the
            // pool tail, outside every module's range. Mortality IS visible on a
            // floor's next load (embody_crowd skips the dead); births are not, until
            // a per-floor roster replaces the fixed range.
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
    std::uint32_t socialEdges = 0;
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

                // Bounded probe over the id window around `id` (see kSocialProbeSpan
                // for why a window stands in for a per-floor bucket here). Clamped to
                // the pool rather than offset, so ids near either end stay in range.
                const std::uint32_t lo =
                    id > kSocialProbeSpan ? id - kSocialProbeSpan : 0u;
                std::uint32_t hi = id + kSocialProbeSpan + 1u;
                if (hi > total) hi = total;
                const std::uint32_t span = hi - lo;
                if (span < 2u) continue;  // no one else in reach

                NpcId peer = kInvalidNpc;
                for (std::uint32_t attempt = 0; attempt < kSocialCandidateTries;
                     ++attempt) {
                    const NpcId cand = lo + hash3(id, t32 + attempt, sPeer) % span;
                    if (cand == id) continue;
                    if (!pool.alive(cand) || pool.embodied(cand)) continue;
                    if (pool.floor(cand) != label) continue;  // never cross-floor
                    peer = cand;
                    break;
                }
                if (peer == kInvalidNpc) continue;

                if (form_edge(pool, *factions, id, peer,
                              kSaltSocialJitter ^ params.seed ^ t32)) {
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
    stats_.reserveRemaining = pool.reserve_remaining();
    stats_.target = target;
    stats_.tick = tick_;
    stats_.dayTenths = dayTenths_;
    return stats_;
}

} // namespace giga::game
