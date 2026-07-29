// Macro society tick tests ([macro_sim.h]). Included into game_test.cpp, so it uses
// that file's CHECK macro and its `using namespace giga::game`.
//
// Four properties are load-bearing and each gets its own block:
//
// 1. THE POPULATION IS STATIONARY. The branch this was ported from had an OPEN-LOOP
//    birth rate plus a catch-up of 1% of the deficit PER TICK. Modelled from main.cpp's
//    1,930-record demo stack against kNpcActiveTarget, that spawns 9,481 newborns on
//    the FIRST tick. The closed loop (births = deaths + gain x deficit, clamped) makes
//    the target stationary by construction, and `living == pool.alive()` is checked
//    every single tick because a demographic pass that loses count of its own dead is
//    the one failure mode that produces plausible-looking garbage.
//
// 2. DETERMINISM IS BIT-EXACT. Two pools seeded identically, ticked identically with
//    migration AND the social graph on, must fold to the same digest. A third run with
//    a different `MacroParams::seed` must DIVERGE — the branch declared that knob,
//    documented it as "salts the deterministic hashes", and then never used it in any
//    hash, so differently-seeded runs were identical.
//
// 3. MIGRATION IS BOUNDED. Not "fast" — bounded. Asserted as a work count at two pool
//    sizes 20x apart, never as a wall clock. The timings are PRINTED so the numbers are
//    real, and asserted on nothing, because a CI machine's load is not a property of
//    this code.
//
// 4. A NEGATIVE FLOOR LABEL ROUND-TRIPS. The pool's floor column is std::int16_t
//    precisely because the building descends ([npc_pool.h]); the branch stored it
//    unsigned, where floor -50 reads back as 65486. Migration is the FIRST writer of
//    that column outside seeding, so it is the first thing that could reintroduce the
//    wrap.
//
// Memory note: an NpcPool is 306.0 MiB of EAGER columns after init(), so the
// determinism block holds ~612 MiB while two are alive. That is deliberate and scoped.

#include <chrono>
#include <cstdio>

#include "core/tick.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/macro_sim.h"
#include "game/npc_pool.h"
#include "game/population.h"

static void test_macrosim_all() {
    // The cadence is derived from kSimHz, so a stale 120 cannot creep back in. This is
    // a fact about the build, not about a run, so it is a static_assert.
    static_assert(kSimHz == 125, "the sim is 125 Hz; 120 is the stale figure");
    static_assert(kMacroPeriodTicks == 250u, "2.000 s of sim time per macro tick");
    static_assert(kMacroPeriodTicks * static_cast<std::uint32_t>(kSimStepMs) == 2000u,
                  "and it is EXACT, because kSimStepMs is exactly 8 ms at 125 Hz");

    // Fold a whole pool plus the macro clock into one word. FNV-1a: order-sensitive,
    // and every column that a tick can touch goes in, so a divergence anywhere shows.
    auto digest = [](NpcPool& p, const MacroSim& s, bool withRel) -> std::uint64_t {
        std::uint64_t h = 1469598103934665603ull;
        auto fold = [&h](std::uint64_t v) {
            h ^= v;
            h *= 1099511628211ull;
        };
        fold(p.count());
        fold(p.alive());
        fold(s.tick());
        fold(s.day_tenths());
        fold(s.in_transit());
        for (NpcId id = 0; id < p.count(); ++id) {
            fold(p.alive(id) ? 1u : 0u);
            fold(p.age(id));
            fold(p.sex(id));
            fold(p.level(id));
            // Through uint16_t so a negative label folds as its exact bit pattern.
            fold(static_cast<std::uint16_t>(p.floor(id)));
            fold(p.faction(id));
            fold(static_cast<std::uint16_t>(p.hp(id)));
            fold(p.height_mm(id));
            fold(p.cx(id));
            fold(p.cy(id));
            fold(p.cz(id));
            if (!withRel) continue;
            // Only when the social pass ran: relations() is a DEMAND column and the
            // first call materializes 128 B/row ([npc_pool.h]).
            const std::array<Relationship, kRelSlots>& row = p.relations(id);
            for (int sl = 0; sl < kRelSlots; ++sl) {
                const std::size_t si = static_cast<std::size_t>(sl);
                fold(row[si].target);
                fold(static_cast<std::uint16_t>(row[si].affinity));
            }
        }
        return h;
    };

    // The demo stack's shape: sparse and mostly BELOW the hub, which is the whole
    // reason destinations are drawn from a registered set instead of a [lo,hi] band.
    const std::int16_t kStack[5] = {-50, -14, 0, 14, 30};

    { // ---- 1. the population is stationary, and living never loses the dead ----
        NpcPool pool;
        pool.init();
        for (int i = 0; i < 5; ++i) {
            // 800 per floor, seeded as one contiguous id run each — the invariant the
            // social probe leans on ([macro_sim.cpp] kSocialProbeSpan).
            seed_floor_population(pool, static_cast<int>(kStack[i]), 800u,
                                  100u + static_cast<std::uint32_t>(i));
        }
        CHECK(pool.count() == 4000u);
        CHECK(pool.alive() == 4000u);

        MacroSim sim;
        sim.init();
        MacroParams p{};   // targetPopulation 0 -> latch whatever the pool starts with

        std::uint32_t lo = 0xFFFFFFFFu;
        std::uint32_t hi = 0;
        std::uint32_t totalDeaths = 0;
        std::uint32_t totalBirths = 0;
        bool aliveMatches = true;
        bool targetLatched = true;
        std::uint32_t peakDeaths = 0;
        std::printf("  macrosim: population curve (4000 seeded, 7 days/tick, "
                    "target latched)\n");
        for (int t = 0; t < 400; ++t) {
            const MacroStats st = sim.step(pool, p);
            // THE bookkeeping invariant: the sweep's own tally must equal the pool's
            // maintained counter, every tick, or one of the two is lying.
            if (st.living != pool.alive()) aliveMatches = false;
            if (st.target != 4000u) targetLatched = false;
            if (st.living < lo) lo = st.living;
            if (st.living > hi) hi = st.living;
            if (st.deaths > peakDeaths) peakDeaths = st.deaths;
            totalDeaths += st.deaths;
            totalBirths += st.births;
            if (t % 50 == 0 || t == 399) {
                std::printf("    tick %3d  living %5u  deaths %4u  births %4u  "
                            "reserve %7u  day %.0f\n",
                            t, st.living, st.deaths, st.births, st.reserveRemaining,
                            static_cast<double>(st.dayTenths) * 0.1);
            }
        }
        CHECK(aliveMatches);
        CHECK(targetLatched);   // the latch fired once and never moved
        // Modelled band for this exact algorithm at n=4000 over 400 ticks (7.67
        // simulated years) is [+0.00%, +0.12%]; 2% is the guard rail, not the claim.
        CHECK(lo >= 4000u - 80u);
        CHECK(hi <= 4000u + 80u);
        // Slots consumed == births, because the pool never reclaims one.
        CHECK(pool.count() == 4000u + totalBirths);
        CHECK(pool.alive() == 4000u + totalBirths - totalDeaths);
        std::printf("    over 400 ticks: living %u..%u (target 4000), deaths %u, "
                    "births %u, peak deaths/tick %u, slots consumed %u of %u\n",
                    lo, hi, totalDeaths, totalBirths, peakDeaths,
                    pool.count() - 4000u, kNpcPoolSize - 4000u);
    }

    { // ---- 2. determinism, and the seed knob is actually live ----
        FactionRelations rel = kBaseFactionMatrix;
        MacroParams p{};
        p.migrateRatePerYear = 4.0f;        // heavy, so journeys start every tick
        p.migrateRecordsPerTick = 256;
        p.socialFormRatePerYear = 8.0f;     // heavy, so the graph really grows
        p.socialRecordsPerTick = 256;

        std::uint64_t dA = 0;
        std::uint64_t dB = 0;
        std::uint32_t edgesA = 0;
        { // two pools, independently built, ticked in lockstep
            NpcPool a;
            NpcPool b;
            a.init();
            b.init();
            for (int i = 0; i < 5; ++i) {
                seed_floor_population(a, static_cast<int>(kStack[i]), 400u, 7u + static_cast<std::uint32_t>(i));
                seed_floor_population(b, static_cast<int>(kStack[i]), 400u, 7u + static_cast<std::uint32_t>(i));
            }
            CHECK(a.count() == b.count());

            MacroSim sa;
            MacroSim sb;
            sa.init();
            sb.init();
            sa.set_floors(kStack, 5u);
            sb.set_floors(kStack, 5u);
            CHECK(sa.floor_count() == 5u);

            for (int t = 0; t < 40; ++t) {
                const MacroStats x = sa.step(a, p, &rel);
                const MacroStats y = sb.step(b, p, &rel);
                edgesA += x.socialEdges;
                // Every published tally must agree, not just the final state.
                if (x.living != y.living || x.deaths != y.deaths ||
                    x.births != y.births || x.departures != y.departures ||
                    x.arrivals != y.arrivals || x.inTransit != y.inTransit ||
                    x.socialEdges != y.socialEdges) {
                    CHECK(false);
                    break;
                }
            }
            dA = digest(a, sa, /*withRel=*/true);
            dB = digest(b, sb, /*withRel=*/true);
        }
        CHECK(dA == dB);
        CHECK(edgesA > 0u);   // the run has to have DONE something to be worth pinning

        { // a different seed must produce a different society
            NpcPool c;
            c.init();
            for (int i = 0; i < 5; ++i) {
                seed_floor_population(c, static_cast<int>(kStack[i]), 400u, 7u + static_cast<std::uint32_t>(i));
            }
            MacroSim sc;
            sc.init();
            sc.set_floors(kStack, 5u);
            MacroParams q = p;
            q.seed = p.seed ^ 0x5bd1e995u;
            for (int t = 0; t < 40; ++t) (void)sc.step(c, q, &rel);
            CHECK(digest(c, sc, /*withRel=*/true) != dA);
        }
        std::printf("    macrosim: 40 ticks x 2000 records, %u edges formed, "
                    "digest 0x%016llx reproduced exactly\n",
                    edgesA, static_cast<unsigned long long>(dA));
    }

    { // ---- 3. migration is BOUNDED: the same work at 20x the population ----
        // Budgets deliberately small and the population deliberately large, so an O(n)
        // term would show as a departure count that tracks the pool size.
        MacroParams p{};
        p.migrateRecordsPerTick = 64;
        p.migrateRatePerYear = 20.0f;     // ~38% of every visited record departs
        p.maxJourneys = 128;              // caps the LANDING pass independently
        p.travelBaseDays = 0.5f;
        p.travelPerFloorDays = 0.0f;      // flat ETA, so landings bunch up

        double msSmall = 0.0;
        double msLarge = 0.0;
        for (int pass = 0; pass < 2; ++pass) {
            const std::uint32_t per = pass == 0 ? 400u : 8000u;   // 2,000 vs 40,000
            NpcPool pool;
            pool.init();
            for (int i = 0; i < 5; ++i) {
                seed_floor_population(pool, static_cast<int>(kStack[i]), per,
                                      21u + static_cast<std::uint32_t>(i));
            }
            MacroSim sim;
            sim.init();
            sim.set_floors(kStack, 5u);

            bool bounded = true;
            std::uint32_t maxDep = 0;
            std::uint32_t maxArr = 0;
            const auto t0 = std::chrono::steady_clock::now();
            for (int t = 0; t < 60; ++t) {
                const MacroStats st = sim.step(pool, p);
                if (st.departures > p.migrateRecordsPerTick) bounded = false;
                if (st.inTransit > p.maxJourneys) bounded = false;
                if (st.arrivals > p.maxJourneys) bounded = false;
                if (st.departures > maxDep) maxDep = st.departures;
                if (st.arrivals > maxArr) maxArr = st.arrivals;
            }
            const auto t1 = std::chrono::steady_clock::now();
            const double ms =
                std::chrono::duration<double, std::milli>(t1 - t0).count() / 60.0;
            if (pass == 0) msSmall = ms; else msLarge = ms;

            CHECK(bounded);
            CHECK(maxDep > 0u);            // it actually migrated
            CHECK(maxDep <= 64u);          // ...within the budget, at BOTH sizes
            CHECK(maxArr <= 128u);
            // Every label still legal and still in the registered set.
            bool inSet = true;
            for (NpcId id = 0; id < pool.count(); ++id) {
                // LIVING records only. A corpse is deliberately on no floor: kill()
                // set_floor()s it to kNoFloorLabel so a floor roster stays a clean list
                // of the living, which is what streaming enumerates. Mortality runs every
                // step here, so without this the assertion fails on the first death.
                if (!pool.alive(id)) continue;
                const int f = static_cast<int>(pool.floor(id));
                bool found = false;
                for (int i = 0; i < 5; ++i)
                    if (f == static_cast<int>(kStack[i])) found = true;
                if (!found) inSet = false;
            }
            CHECK(inSet);
            std::printf("    macrosim: %u records, budget 64/tick -> max departures "
                        "%u, max arrivals %u, %.3f ms/step\n",
                        pool.count(), maxDep, maxArr, ms);
        }
        // NOT a CHECK. The sweep is O(n) by design and only the migration pass claims
        // to be bounded, so wall time IS expected to grow with the population; what
        // must not grow is the migration work, and that is asserted above as a count.
        std::printf("    macrosim: step cost 2,000 -> 40,000 records: %.3f -> %.3f "
                    "ms/step (20x population; the O(n) sweep, not the bounded pass)\n",
                    msSmall, msLarge);
    }

    { // ---- 4. a negative floor label survives a migration relabel ----
        // Mortality and births OFF, so the only thing that can change is the label:
        // any drift in count()/alive() here would be this block's own fault.
        NpcPool pool;
        pool.init();
        seed_floor_population(pool, -50, 200u, 909u);
        CHECK(pool.count() == 200u);
        CHECK(pool.floor(0) == -50);
        CHECK(pool.floor(0) < 0);

        MacroSim sim;
        sim.init();
        sim.set_floors(kStack, 5u);

        MacroParams p{};
        p.maxAge = 255;              // nobody reaches it in 60 ticks
        p.mortalityPeak = 0.0f;      // and no curve deaths either
        p.migrateRatePerYear = 40.0f;
        p.migrateRecordsPerTick = 256;   // > count, so the cursor covers everyone
        p.travelBaseDays = 0.1f;
        p.travelPerFloorDays = 0.0f;

        std::uint32_t dep = 0;
        std::uint32_t arr = 0;
        for (int t = 0; t < 60; ++t) {
            const MacroStats st = sim.step(pool, p);
            CHECK(st.deaths == 0u);
            CHECK(st.births == 0u);
            dep += st.departures;
            arr += st.arrivals;
        }
        CHECK(pool.count() == 200u);
        CHECK(pool.alive() == 200u);
        // Journey conservation: nothing died and nothing was embodied, so every
        // started journey either landed or is still in flight. A leak here is a
        // record permanently stuck with traveling_ set, which would silently freeze
        // it out of all future migration.
        CHECK(dep == arr + sim.in_transit());
        CHECK(dep > 0u);

        int negatives = 0;
        int positives = 0;
        int offOrigin = 0;
        bool legal = true;
        for (NpcId id = 0; id < pool.count(); ++id) {
            const int f = static_cast<int>(pool.floor(id));
            if (f < kMinFloor || f > kMaxFloor) legal = false;
            bool found = false;
            for (int i = 0; i < 5; ++i)
                if (f == static_cast<int>(kStack[i])) found = true;
            if (!found) legal = false;
            if (f < 0) ++negatives;
            if (f > 0) ++positives;
            if (f != -50) ++offOrigin;
        }
        CHECK(legal);
        CHECK(offOrigin > 0);   // people actually moved
        CHECK(positives > 0);   // ...upward, across the sign boundary
        CHECK(negatives > 0);   // ...and a negative label still READS as negative
        std::printf("    macrosim: 200 records seeded on floor -50, %u departures / "
                    "%u arrivals -> %d still negative, %d positive, %d off origin\n",
                    dep, arr, negatives, positives, offOrigin);
    }

    { // ---- 5. the social graph is faction-consistent, co-floor and duplicate-free --
        FactionRelations rel = kBaseFactionMatrix;
        // Two floors: one pure Citizen, one half Citizen / half Wild. The base matrix
        // makes the first warm (+100 diagonal -> base +50) and the cross pairs on the
        // second cold (-50 -> base -25), so the SIGN of a fresh edge is decided by
        // faction standing and by nothing authored here.
        FloorSpec pureCit{};
        pureCit.kind = FloorKind::Residential;
        pureCit.name = "citizens";
        pureCit.population = 400;
        pureCit.factionMix[0] = 1;
        pureCit.hostility = 0.0f;
        pureCit.minAge = 20;
        pureCit.maxAge = 40;

        FloorSpec mixed = pureCit;
        mixed.name = "citizens+wild";
        mixed.factionMix[static_cast<std::size_t>(Faction::Wild)] = 1;

        NpcPool pool;
        pool.init();
        (void)seed_floor_from_spec(pool, 0, pureCit, 4001u);
        const NpcId mixedFirst = pool.count();
        (void)seed_floor_from_spec(pool, -14, mixed, 4002u);
        CHECK(pool.count() == 800u);

        MacroSim sim;
        sim.init();
        MacroParams p{};
        p.maxAge = 255;
        p.mortalityPeak = 0.0f;
        p.socialRecordsPerTick = 256;
        p.socialFormRatePerYear = 20.0f;

        { // off unless BOTH the rate and a matrix are supplied
            MacroSim probe;
            probe.init();
            const MacroStats noMatrix = probe.step(pool, p, nullptr);
            CHECK(noMatrix.socialEdges == 0u);
            MacroParams zero = p;
            zero.socialFormRatePerYear = 0.0f;
            const MacroStats noRate = probe.step(pool, zero, &rel);
            CHECK(noRate.socialEdges == 0u);
        }

        std::uint32_t edges = 0;
        for (int t = 0; t < 40; ++t) edges += sim.step(pool, p, &rel).socialEdges;
        CHECK(edges > 100u);   // enough of a graph for the checks below to mean anything

        int warmOnPure = 0;
        int coldOnPure = 0;
        int negativeOnMixed = 0;
        int total = 0;
        bool wellFormed = true;
        for (NpcId id = 0; id < pool.count(); ++id) {
            const std::array<Relationship, kRelSlots>& row = pool.relations(id);
            for (int s = 0; s < kRelSlots; ++s) {
                const std::size_t si = static_cast<std::size_t>(s);
                const NpcId tgt = row[si].target;
                if (tgt == kInvalidNpc) continue;
                ++total;
                if (tgt == id) wellFormed = false;                       // no self-edge
                if (tgt >= pool.count()) wellFormed = false;             // no dangling
                if (pool.floor(tgt) != pool.floor(id)) wellFormed = false; // co-floor
                if (row[si].affinity < kSocialAffinityMin ||
                    row[si].affinity > kSocialAffinityMax) wellFormed = false;
                for (int o = 0; o < s; ++o)                              // no duplicate
                    if (row[static_cast<std::size_t>(o)].target == tgt) wellFormed = false;
                if (id < mixedFirst) {
                    if (row[si].affinity > 0) ++warmOnPure; else ++coldOnPure;
                } else if (row[si].affinity < 0) {
                    ++negativeOnMixed;
                }
            }
        }
        CHECK(wellFormed);
        CHECK(total > 0);
        // Citizen+Citizen is base +50 with +/-40 of jitter, so the WHOLE range is
        // positive: a single cold edge on the pure floor means the faction seed is not
        // being read, which is the one bug this block exists to catch.
        CHECK(coldOnPure == 0);
        CHECK(warmOnPure > 0);
        CHECK(negativeOnMixed > 0);
        std::printf("    macrosim: %d edges — pure-Citizen floor %d warm / %d cold, "
                    "Citizen+Wild floor %d hostile-leaning\n",
                    total, warmOnPure, coldOnPure, negativeOnMixed);
    }

    { // ---- 6. the reserve floor stops births, and SAYS it stopped them ----
        // The pool never reclaims a slot, so births are a one-way draw on the reserve
        // plast that every runtime spawn also draws from. At the design size that wall
        // arrives after ~2.9 simulated years (see the macro_sim.h banner); this checks
        // the guard rail rather than the wall, by setting a floor above the reserve.
        NpcPool pool;
        pool.init();
        seed_floor_population(pool, 0, 2000u, 55u);
        MacroSim sim;
        sim.init();

        MacroParams p{};
        p.targetPopulation = 4000u;         // a real deficit, so births are wanted
        p.reserveFloor = kNpcPoolSize;      // ...and no room at all to grant them
        const std::uint32_t before = pool.count();
        std::uint32_t blocked = 0;
        std::uint32_t born = 0;
        for (int t = 0; t < 20; ++t) {
            const MacroStats st = sim.step(pool, p);
            blocked += st.birthsBlocked;
            born += st.births;
            CHECK(st.target == 4000u);
        }
        CHECK(born == 0u);
        CHECK(blocked > 0u);                // the refusal is REPORTED, not silent
        CHECK(pool.count() == before);      // and no slot was consumed

        p.reserveFloor = 0u;
        const MacroStats open = sim.step(pool, p);
        CHECK(open.births > 0u);            // ...and births resume when there is room
        CHECK(open.birthsBlocked == 0u);
        CHECK(pool.count() == before + open.births);
        std::printf("    macrosim: reserve floor refused %u births over 20 ticks, "
                    "then %u landed once it was lifted\n",
                    blocked, open.births);
    }

    { // ---- 7. set_floors_from() reads the live registry, and rejects nonsense ----
        FloorRegistry reg;
        reg.assign(-50, static_cast<ModuleId>(0));
        reg.assign(-14, static_cast<ModuleId>(1));
        reg.assign(0, static_cast<ModuleId>(2));
        MacroSim sim;
        sim.init();
        CHECK(sim.floor_count() == 0u);     // init() clears the destination set
        sim.set_floors_from(reg);
        CHECK(sim.floor_count() == 3u);

        // Out-of-range and duplicate labels are dropped rather than indexed.
        const std::int16_t dirty[6] = {0, 0, 30, 30, -128, 127};
        sim.set_floors(dirty, 6u);
        CHECK(sim.floor_count() == 3u);     // {0, 30, 127}; -128 is below kMinFloor
        sim.set_floors(nullptr, 9u);
        CHECK(sim.floor_count() == 0u);     // and migration is off again
    }
}
