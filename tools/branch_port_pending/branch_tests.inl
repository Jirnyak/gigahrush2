// Branch tests parked out of tests/game_test.cpp during the
// origin/nav-routing-diffusion merge.
//
// They exercise MacroSim / loot_table / the utility AI, all of which are parked in
// this directory because they compile against the branch hand-written item and mob
// enum catalogs. main csv-generated tables (446 items / 69 mobs + generator +
// source_rules row-count gate) won that argument.
//
// NOTHING HERE IS THROWAWAY. This is real coverage of the macro-society sim -- aging,
// mortality, births, bounded migration, determinism -- and it goes straight back into
// game_test.cpp the moment macro_sim is adapted. Keep the one-entry-point convention
// when restoring: an include plus one call in main().


static void test_macro_aging() {
    NpcPool pool;
    pool.init();
    NpcId a = spawn_aged(pool, 20, 3, 1);
    NpcId b = spawn_aged(pool, 30, 3, 1);
    MacroSim macro;
    macro.init(pool);

    // Isolate aging: no mortality (onset past any reachable age), no births.
    MacroParams p;
    p.daysPerTick = 365;  // exactly one simulated year per tick
    p.maxAge = 200;
    p.mortalityOnset = 200;
    p.birthRate = 0.0f;
    p.targetPopulation = 0;

    for (int i = 0; i < 5; ++i) macro.step(pool, p);
    CHECK(pool.age(a) == 25);
    CHECK(pool.age(b) == 35);
    CHECK(macro.tick() == 5);
    CHECK(pool.count() == 2);  // no births, dead never reclaimed

    // Fractional-year accumulation: 73-day ticks * 5 == exactly one year.
    NpcPool pool2;
    pool2.init();
    NpcId c = spawn_aged(pool2, 40, 0, 0);
    MacroSim m2;
    m2.init(pool2);
    MacroParams q = p;
    q.daysPerTick = 73;
    for (int i = 0; i < 4; ++i) {
        m2.step(pool2, q);
        CHECK(pool2.age(c) == 40);  // not yet a full year
    }
    m2.step(pool2, q);
    CHECK(pool2.age(c) == 41);
}

static void test_macro_mortality() {
    NpcPool pool;
    pool.init();
    const int N = 200;
    for (int i = 0; i < N; ++i) spawn_aged(pool, 99, 5, 2);
    std::uint32_t before = pool.count();
    MacroSim macro;
    macro.init(pool);
    MacroParams p;
    p.daysPerTick = 365;
    p.maxAge = 100;
    p.birthRate = 0.0f;
    p.targetPopulation = 0;  // isolate mortality from births
    MacroStats s = macro.step(pool, p);

    // Everyone crosses 99 -> 100 (the ceiling) = certain death this tick.
    CHECK(s.deaths == static_cast<std::uint32_t>(N));
    CHECK(s.living == 0);
    CHECK(pool.count() == before);  // dead keep their slots
    for (NpcId id = 0; id < before; ++id) CHECK(!pool.alive(id));
}

static void test_macro_births() {
    NpcPool pool;
    pool.init();
    const int N = 50;
    for (int i = 0; i < N; ++i) spawn_aged(pool, 30, 7, 2);  // fertile, floor 7, faction 2
    std::uint32_t before = pool.count();
    MacroSim macro;
    macro.init(pool);
    MacroParams p;
    p.daysPerTick = 365;
    p.maxAge = 200;
    p.mortalityOnset = 200;  // nobody dies, so births are the only change
    p.birthRate = 0.05f;
    p.targetPopulation = 500;  // deficit drives catch-up births
    MacroStats s = macro.step(pool, p);

    CHECK(s.births > 0);
    CHECK(pool.count() == before + s.births);
    CHECK(s.living == static_cast<std::uint32_t>(N) + s.births);  // survivors + newborns
    // Newborns inherit a parent's floor + faction, start at age 0, alive.
    for (NpcId id = before; id < pool.count(); ++id) {
        CHECK(pool.alive(id));
        CHECK(pool.age(id) == 0);
        CHECK(pool.floor(id) == 7);
        CHECK(pool.faction(id) == 2);
    }
    CHECK(pool.reserve_remaining() == kNpcPoolSize - pool.count());
}

static void test_macro_skips_embodied() {
    // The macro sweep must never age or kill an EMBODIED record — those belong to
    // the live micro sim, and the on-screen player is just an embodied record with
    // the NpcPlayer bit. A cold age-99 NPC crosses the ceiling and dies; an
    // embodied age-99 NPC beside it must survive, unaged, still counted as living.
    NpcPool pool;
    pool.init();
    NpcId cold = spawn_aged(pool, 99, 4, 1);
    NpcId hero = spawn_aged(pool, 99, 4, 1);
    pool.set_embodied(hero, true);
    pool.set_player(hero, true);

    MacroSim macro;
    macro.init(pool);
    MacroParams p;
    p.daysPerTick = 365;  // one year: the cold NPC hits maxAge and dies
    p.maxAge = 100;
    p.birthRate = 0.0f;
    p.targetPopulation = 0;
    MacroStats s = macro.step(pool, p);

    CHECK(!pool.alive(cold));       // cold record aged to the ceiling and died
    CHECK(pool.alive(hero));        // embodied record untouched
    CHECK(pool.age(hero) == 99);    // ...and not aged by the macro clock
    CHECK(s.deaths == 1);           // only the cold record
    CHECK(s.living == 1);           // the embodied record still counts as living
}

static void test_macro_determinism() {
    auto build = [](NpcPool& pool) {
        pool.init();
        FloorSpec spec = floor_spec(FloorKind::Residential);
        seed_floor_from_spec(pool, 2, spec, 0xC0FFEEu);
    };
    NpcPool p1, p2;
    build(p1);
    build(p2);
    MacroSim m1, m2;
    m1.init(p1);
    m2.init(p2);
    MacroParams p;
    p.daysPerTick = 30;  // ~monthly ticks
    for (int i = 0; i < 24; ++i) {  // two simulated years
        MacroStats a = m1.step(p1, p);
        MacroStats b = m2.step(p2, p);
        CHECK(a.living == b.living);
        CHECK(a.deaths == b.deaths);
        CHECK(a.births == b.births);
    }
    CHECK(p1.count() == p2.count());
    for (NpcId id = 0; id < p1.count(); ++id) {
        CHECK(p1.age(id) == p2.age(id));
        CHECK(p1.alive(id) == p2.alive(id));
        CHECK(p1.floor(id) == p2.floor(id));
        CHECK(p1.faction(id) == p2.faction(id));
    }
}

static void test_macro_migration() {
    NpcPool pool;
    pool.init();
    const int N = 200;
    const std::uint16_t lo = 10, hi = 13;               // a 4-floor band
    for (int i = 0; i < N; ++i) spawn_aged(pool, 30, lo, 1);  // all start on floor 10
    // One embodied record must be immune to macro migration (micro sim owns it).
    NpcId hero = spawn_aged(pool, 30, lo, 1);
    pool.set_embodied(hero, true);

    MacroSim macro;
    macro.init(pool);
    MacroParams p;
    p.daysPerTick = 30;
    p.mortalityOnset = 200;      // nobody dies
    p.maxAge = 200;
    p.birthRate = 0.0f;          // nobody is born — living is constant
    p.targetPopulation = 0;
    p.floorLo = lo;
    p.floorHi = hi;
    p.migrateRatePerYear = 5.0f; // brisk churn so journeys start every tick

    std::uint64_t totalDep = 0, totalArr = 0;
    bool sawDeparture = false, sawArrival = false;
    for (int t = 0; t < 40; ++t) {
        MacroStats s = macro.step(pool, p);
        CHECK(s.living == static_cast<std::uint32_t>(N) + 1);  // 200 cold + hero
        totalDep += s.departures;
        totalArr += s.arrivals;
        if (s.departures > 0) sawDeparture = true;
        if (s.arrivals > 0) sawArrival = true;
        // Every alive record is always labelled with an in-band floor: they start
        // in-band and migration only ever picks in-band destinations (in-transit
        // records keep their source label, itself in-band).
        for (NpcId id = 0; id < pool.count(); ++id) {
            if (!pool.alive(id)) continue;
            CHECK(pool.floor(id) >= lo && pool.floor(id) <= hi);
        }
    }

    CHECK(sawDeparture);
    CHECK(sawArrival);
    // Journey conservation: everyone who left either arrived or is still en route
    // (nothing dies or is embodied mid-transit here, so no journey is forfeited).
    CHECK(totalDep - totalArr == macro.in_transit());
    // The embodied record never migrated — still on its start floor, still embodied.
    CHECK(pool.embodied(hero));
    CHECK(pool.floor(hero) == lo);
    // Migration actually relocated cold records off floor 10 (not all still home).
    int movedOff = 0;
    for (int i = 0; i < N; ++i)
        if (pool.floor(static_cast<NpcId>(i)) != lo) ++movedOff;
    CHECK(movedOff > 0);
}

static void test_macro_migration_determinism() {
    auto build = [](NpcPool& pool) {
        pool.init();
        for (int i = 0; i < 300; ++i)  // spread across the 20..24 band
            spawn_aged(pool, 30, static_cast<std::uint16_t>(20 + (i % 5)), 1);
    };
    NpcPool p1, p2;
    build(p1);
    build(p2);
    MacroSim m1, m2;
    m1.init(p1);
    m2.init(p2);
    MacroParams p;
    p.daysPerTick = 15;
    p.mortalityOnset = 200;
    p.maxAge = 200;
    p.birthRate = 0.0f;
    p.targetPopulation = 0;
    p.floorLo = 20;
    p.floorHi = 24;
    p.migrateRatePerYear = 3.0f;
    for (int t = 0; t < 30; ++t) {
        MacroStats a = m1.step(p1, p);
        MacroStats b = m2.step(p2, p);
        CHECK(a.departures == b.departures);
        CHECK(a.arrivals == b.arrivals);
        CHECK(a.inTransit == b.inTransit);
    }
    CHECK(m1.in_transit() == m2.in_transit());
    for (NpcId id = 0; id < p1.count(); ++id) {
        CHECK(p1.floor(id) == p2.floor(id));
        CHECK(p1.alive(id) == p2.alive(id));
    }
}

static void test_macro_social() {
    NpcPool pool;
    pool.init();
    const std::uint16_t kFloorCit = 100;  // all-Citizen floor: warm seeds (+)
    const std::uint16_t kFloorMix = 200;  // Citizen + Wild floor: hostile pairs (-)
    const int kPerFloor = 60;
    for (int i = 0; i < kPerFloor; ++i)
        spawn_aged(pool, 30, kFloorCit, FactionCitizen);
    for (int i = 0; i < kPerFloor; ++i)
        spawn_aged(pool, 30, kFloorMix,
                   (i & 1) ? static_cast<std::uint16_t>(FactionWild)
                           : static_cast<std::uint16_t>(FactionCitizen));

    MacroSim macro;
    macro.init(pool);
    MacroParams p;
    p.daysPerTick = 30;
    p.mortalityOnset = 200;  // nobody dies
    p.maxAge = 200;
    p.birthRate = 0.0f;      // nobody is born — the population is static
    p.targetPopulation = 0;
    // Migration stays OFF (floorHi == floorLo == 0), so floors are static and the
    // "co-floor" invariant holds for the whole run.
    p.socialFormRatePerYear = 20.0f;  // formProb >= 1 -> every visited cold record forms
    p.socialRecordsPerTick = 128;     // cover both floors each tick

    std::uint64_t totalEdges = 0;
    for (int t = 0; t < 25; ++t) totalEdges += macro.step(pool, p).socialEdges;
    CHECK(totalEdges > 0);

    int withEdges = 0, negOnMix = 0, negOnCit = 0, edgesSeen = 0;
    for (NpcId id = 0; id < pool.count(); ++id) {
        const auto& rel = pool.relations(id);
        int mine = 0;
        for (int s = 0; s < kRelSlots; ++s) {
            if (rel[s].target == kInvalidNpc) continue;
            ++mine;
            ++edgesSeen;
            const NpcId tgt = rel[s].target;
            CHECK(tgt != id);                          // no self-edges
            CHECK(pool.alive(tgt));                    // target is a live record
            CHECK(pool.floor(tgt) == pool.floor(id));  // co-floor peer
            CHECK(rel[s].affinity >= kRelAffinityMin &&
                  rel[s].affinity <= kRelAffinityMax);
            for (int u = s + 1; u < kRelSlots; ++u)    // no duplicate target
                CHECK(rel[u].target != tgt);
            if (rel[s].affinity < 0) {
                if (pool.floor(id) == kFloorMix) ++negOnMix;
                else ++negOnCit;
            }
            // All-Citizen floor: factionAffinity(Cit,Cit)=50, jitter +-40 -> [10,90].
            if (pool.floor(id) == kFloorCit)
                CHECK(rel[s].affinity >= 10 && rel[s].affinity <= 90);
        }
        if (mine > 0) ++withEdges;
    }
    CHECK(withEdges > 0);
    CHECK(edgesSeen > 0);
    // Faction standing drives the seed SIGN: the all-Citizen floor never produces a
    // hostile edge; the Citizen+Wild floor does (factionAffinity(Cit,Wild) = -25).
    CHECK(negOnCit == 0);
    CHECK(negOnMix > 0);

    // Off by default: with the rate at 0 the pass forms nothing and leaves every
    // relationship block untouched (so the demographic/migration tests are safe).
    NpcPool q;
    q.init();
    for (int i = 0; i < 20; ++i) spawn_aged(q, 30, kFloorCit, FactionCitizen);
    MacroSim m2;
    m2.init(q);
    MacroParams pq;  // socialFormRatePerYear defaults to 0
    pq.mortalityOnset = 200;
    pq.maxAge = 200;
    pq.birthRate = 0.0f;
    pq.targetPopulation = 0;
    std::uint64_t edges0 = 0;
    for (int t = 0; t < 10; ++t) edges0 += m2.step(q, pq).socialEdges;
    CHECK(edges0 == 0);
    for (NpcId id = 0; id < q.count(); ++id)
        CHECK(q.relations(id)[0].target == kInvalidNpc);
}

static void test_macro_social_determinism() {
    auto build = [](NpcPool& pool) {
        pool.init();
        for (int i = 0; i < 120; ++i)
            spawn_aged(pool, 30, static_cast<std::uint16_t>(50),
                       (i % 3 == 0) ? static_cast<std::uint16_t>(FactionWild)
                                    : static_cast<std::uint16_t>(FactionCitizen));
    };
    NpcPool p1, p2;
    build(p1);
    build(p2);
    MacroSim m1, m2;
    m1.init(p1);
    m2.init(p2);
    MacroParams p;
    p.daysPerTick = 20;
    p.mortalityOnset = 200;
    p.maxAge = 200;
    p.birthRate = 0.0f;
    p.targetPopulation = 0;
    p.socialFormRatePerYear = 8.0f;
    p.socialRecordsPerTick = 64;
    for (int t = 0; t < 30; ++t) {
        MacroStats a = m1.step(p1, p);
        MacroStats b = m2.step(p2, p);
        CHECK(a.socialEdges == b.socialEdges);
    }
    for (NpcId id = 0; id < p1.count(); ++id) {
        const auto& r1 = p1.relations(id);
        const auto& r2 = p2.relations(id);
        for (int s = 0; s < kRelSlots; ++s) {
            CHECK(r1[s].target == r2[s].target);
            CHECK(r1[s].affinity == r2[s].affinity);
        }
    }
}

static void test_needs_decay() {
    const float dt = 1.0f / 120.0f; // one sim tick

    // --- Seed: deterministic (pure function of id), lands in each need's band,
    //     and the pending gut pools start empty (fresh body). ---
    Needs a{}, b{};
    seed_needs(a, 12345u);
    seed_needs(b, 12345u);
    for (std::uint8_t n = 0; n < kNeedCount; ++n) {
        CHECK(a.v[n] == b.v[n]);                                   // determinism
        CHECK(a.v[n] >= kNeedSeedLo[n] && a.v[n] <= kNeedSeedHi[n]); // per-need band
    }
    CHECK(a.pendingPee == 0.0f && a.pendingPoo == 0.0f);          // fresh gut

    // Different ids give different rows (the crowd is not in lockstep).
    Needs c{};
    seed_needs(c, 999u);
    bool anyDiff = false;
    for (std::uint8_t n = 0; n < kNeedCount; ++n)
        if (c.v[n] != a.v[n]) anyDiff = true;
    CHECK(anyDiff);

    // A shared pool supplies the attribute block for reserve scaling. Zeroed stats
    // leave the base decay rate untouched, so expected deltas are exactly rate*dt.
    NpcPool pool;
    pool.init();

    // --- One step: reserves fall by exactly rate*dt (stat 0 => unscaled);
    //     pressures HOLD, because a fresh body's pending pools are empty. ---
    {
        NpcId id = pool.spawn();
        pool.set_floor(id, 0);
        for (auto& s : pool.attrs(id)) s = 0; // no attribute slowing
        Registry reg;
        auto e = reg.create();
        reg.emplace<NpcRef>(e).id = id;
        Needs seeded{};
        seed_needs(seeded, 42u);
        reg.emplace<Needs>(e, seeded);
        needs_step(reg, pool, dt);
        const auto& stepped = reg.get<Needs>(e);
        for (std::uint8_t n = 0; n < kFirstPressure; ++n) {
            const float expect = seeded.v[n] - kNeedRatePerSec[n] * dt;
            CHECK(std::fabs(stepped.v[n] - expect) < 1e-4f);
            CHECK(stepped.v[n] < seeded.v[n]);        // reserve fell
        }
        CHECK(stepped.v[NeedPee] == seeded.v[NeedPee]); // pressure held (empty pool)
        CHECK(stepped.v[NeedPoo] == seeded.v[NeedPoo]);
    }

    // --- Digestion: a non-empty pending pool raises its pressure by rate*dt and
    //     drains the pool; over many steps the pool empties and the pressure has
    //     risen by exactly the amount digested (never past it). ---
    {
        NpcId id = pool.spawn();
        pool.set_floor(id, 0);
        Registry reg;
        auto e = reg.create();
        reg.emplace<NpcRef>(e).id = id;
        Needs n{};
        n.v[NeedPee] = 10.0f;
        n.pendingPee = 5.0f;
        reg.emplace<Needs>(e, n);
        needs_step(reg, pool, 1.0f); // dt=1s: digest min(5, 0.10)=0.10
        const auto& d = reg.get<Needs>(e);
        CHECK(std::fabs(d.v[NeedPee] - 10.10f) < 1e-4f); // rose by rate*dt
        CHECK(std::fabs(d.pendingPee - 4.90f) < 1e-4f);  // pool drained equally
        for (int i = 0; i < 100; ++i) needs_step(reg, pool, 1.0f); // drain the rest
        const auto& d2 = reg.get<Needs>(e);
        CHECK(d2.pendingPee <= 1e-3f);                   // pool empty
        CHECK(std::fabs(d2.v[NeedPee] - 15.0f) < 1e-2f); // exactly 10 + 5 digested
    }

    // --- Attribute scaling: a higher governing stat drains its reserve slower.
    //     STR (slot 0) governs food: STR 0 loses 0.08/s, STR 10 loses 0.08/2. ---
    {
        NpcId weak = pool.spawn();
        NpcId hardy = pool.spawn();
        for (auto& s : pool.attrs(weak)) s = 0;
        for (auto& s : pool.attrs(hardy)) s = 0;
        pool.attrs(hardy)[0] = 10; // STR 10 -> foodRate /= (1 + 0.1*10) = /2
        Registry reg;
        auto ew = reg.create();
        reg.emplace<NpcRef>(ew).id = weak;
        auto eh = reg.create();
        reg.emplace<NpcRef>(eh).id = hardy;
        Needs full{};
        for (auto& x : full.v) x = 100.0f;
        reg.emplace<Needs>(ew, full);
        reg.emplace<Needs>(eh, full);
        for (int i = 0; i < 120; ++i) needs_step(reg, pool, dt); // one sim-second
        const float fw = reg.get<Needs>(ew).v[NeedFood];
        const float fh = reg.get<Needs>(eh).v[NeedFood];
        CHECK(fh > fw);                                   // hardy kept more food
        CHECK(std::fabs((100.0f - fw) - 0.08f) < 1e-3f);  // weak lost 0.08 in 1 s
        CHECK(std::fabs((100.0f - fh) - 0.04f) < 1e-3f);  // hardy lost half that
    }

    // --- Clamp: a drained reserve rests exactly at 0, never negative. ---
    {
        NpcId id = pool.spawn();
        for (auto& s : pool.attrs(id)) s = 0;
        Registry reg;
        auto e = reg.create();
        reg.emplace<NpcRef>(e).id = id;
        Needs edge{};
        for (auto& x : edge.v) x = 0.05f;
        reg.emplace<Needs>(e, edge);
        for (int i = 0; i < 2000; ++i) needs_step(reg, pool, dt);
        const auto& settled = reg.get<Needs>(e);
        for (std::uint8_t n = 0; n < kFirstPressure; ++n) {
            CHECK(settled.v[n] >= kNeedMin && settled.v[n] <= kNeedMax);
            CHECK(settled.v[n] == kNeedMin); // fully drained reserve rests at 0
        }
    }

    // --- O(n) over the WHOLE column: one pass advances every agent. ---
    {
        Registry reg;
        const int kN = 500;
        std::vector<Entity> es;
        std::vector<Needs> seeds;
        es.reserve(kN);
        seeds.reserve(kN);
        for (int i = 0; i < kN; ++i) {
            NpcId nid = pool.spawn();
            for (auto& s : pool.attrs(nid)) s = 0;
            auto en = reg.create();
            reg.emplace<NpcRef>(en).id = nid;
            Needs s{};
            seed_needs(s, static_cast<std::uint32_t>(i));
            seeds.push_back(s);
            reg.emplace<Needs>(en, s);
            es.push_back(en);
        }
        needs_step(reg, pool, dt);
        for (int i = 0; i < kN; ++i) {
            const auto& got = reg.get<Needs>(es[i]);
            CHECK(got.v[NeedWater] < seeds[i].v[NeedWater]); // every agent drained
        }
    }
}

static void test_ai_step() {
    const float dt = 1.0f / 120.0f;
    MacroGrid grid; // all air; only read by the flee gradient (when danger != null)

    // Build a comfortable, alive Citizen record standing in a given macro cell.
    auto make_npc = [](NpcPool& pool, std::uint8_t cx, std::uint8_t cy,
                       std::uint8_t cz) -> NpcId {
        NpcId id = pool.spawn();
        pool.set_floor(id, 0);
        pool.height_mm(id) = 1800;
        pool.faction(id) = FactionCitizen;
        pool.hp(id) = 100;
        pool.max_hp(id) = 100;
        for (auto& s : pool.attrs(id)) s = 0;
        pool.cx(id) = cx;
        pool.cy(id) = cy;
        pool.cz(id) = cz;
        return id;
    };

    // --- Embodiment attaches the needs + brain (folded away with the entity). ---
    {
        NpcPool pool; pool.init();
        Registry reg;
        NpcId id = make_npc(pool, 10, 10, 1);
        Entity e = embody(reg, pool, id, 0);
        CHECK(reg.all_of<Needs>(e));
        CHECK(reg.all_of<AiBrain>(e));
        CHECK(reg.get<AiBrain>(e).currentIntent == kIntentNone); // no decision yet
        CHECK(reg.get<AiBrain>(e).decisions == 0);
    }

    // --- One step commits an intent, staggers the next deadline into [1.5, 4.0]s,
    //     and steers the body at walk speed horizontally (v.z left to gravity).
    //     The player (camera-holder) is skipped entirely — no player special case,
    //     just the presence of the CameraTag. ---
    {
        NpcPool pool; pool.init();
        Registry reg;
        NpcId a = make_npc(pool, 40, 40, 1);
        Entity ea = embody(reg, pool, a, 0);
        NpcId pid = make_npc(pool, 42, 42, 1);
        Entity ep = embody_as_player(reg, pool, pid, 0);
        reg.get<Velocity>(ep).v = vec3{9.0f, 9.0f, 9.0f}; // sentinel

        ai_step(reg, pool, nullptr, grid, 0.0, dt); // fresh brains plan at now=0

        const AiBrain& ba = reg.get<AiBrain>(ea);
        CHECK(ba.currentIntent != kIntentNone);      // committed an intent
        CHECK(ba.decisions == 1);                    // planned exactly once
        CHECK(ba.nextDecisionAt >= kRethinkBaseSec); // staggered forward...
        CHECK(ba.nextDecisionAt <=
              kRethinkBaseSec + kRethinkSpreadSec + 1e-3f); // ...into [1.5, 4.0]

        const Velocity& va = reg.get<Velocity>(ea);
        const float sp = std::sqrt(va.v.x * va.v.x + va.v.y * va.v.y);
        CHECK(std::fabs(sp - kNpcWalkSpeed) < 1e-3f); // roams at walk speed
        CHECK(va.v.z == 0.0f);                        // gravity owns z (untouched)

        // The player was skipped: brain untouched, velocity sentinel intact.
        CHECK(reg.get<AiBrain>(ep).currentIntent == kIntentNone);
        CHECK(reg.get<AiBrain>(ep).decisions == 0);
        CHECK(reg.get<Velocity>(ep).v.x == 9.0f);
        CHECK(reg.get<Velocity>(ep).v.z == 9.0f);
    }

    // --- Stagger: an agent past its deadline re-plans; before it, it coasts. ---
    {
        NpcPool pool; pool.init();
        Registry reg;
        NpcId a = make_npc(pool, 20, 20, 1);
        Entity e = embody(reg, pool, a, 0);
        ai_step(reg, pool, nullptr, grid, 0.0, dt); // plan #1 at t=0
        const double deadline =
            static_cast<double>(reg.get<AiBrain>(e).nextDecisionAt);
        CHECK(reg.get<AiBrain>(e).decisions == 1);
        ai_step(reg, pool, nullptr, grid, deadline - 0.5, dt); // still before it
        CHECK(reg.get<AiBrain>(e).decisions == 1);             // did NOT re-plan
        ai_step(reg, pool, nullptr, grid, deadline + 1e-3, dt); // now past it
        CHECK(reg.get<AiBrain>(e).decisions == 2);              // re-planned
    }

    // --- Determinism + identity spread: the same id yields the same steer every
    //     run; two different ids (very likely) roam different headings, so a
    //     uniform crowd does not walk in lockstep. ---
    {
        auto run_first = [&](Velocity& out) {
            NpcPool pool; pool.init();
            Registry reg;
            NpcId id = make_npc(pool, 30, 30, 1); // first spawn -> id 0 every run
            Entity e = embody(reg, pool, id, 0);
            ai_step(reg, pool, nullptr, grid, 0.0, dt);
            out = reg.get<Velocity>(e);
        };
        Velocity v1{}, v2{};
        run_first(v1);
        run_first(v2);
        CHECK(v1.v.x == v2.v.x && v1.v.y == v2.v.y); // identical -> deterministic

        NpcPool pool; pool.init();
        Registry reg;
        NpcId a = make_npc(pool, 30, 30, 1); // id 0
        NpcId b = make_npc(pool, 30, 30, 1); // id 1, same cell
        Entity ea = embody(reg, pool, a, 0);
        Entity eb = embody(reg, pool, b, 0);
        ai_step(reg, pool, nullptr, grid, 0.0, dt);
        const Velocity& va = reg.get<Velocity>(ea);
        const Velocity& vb = reg.get<Velocity>(eb);
        CHECK(va.v.x != vb.v.x || va.v.y != vb.v.y); // headings differ per identity
    }

    // --- Flee steers DOWN the danger gradient. A +x danger ramp saturating to 1.0
    //     at the agent's cell makes flee the argmax AND clears the emergency band,
    //     so the fresh brain commits flee; the body then steers -x (toward lower
    //     danger), with no y component (the ramp is x-only). This is the baked
    //     diffusion field driving locomotion end-to-end. ---
    {
        World world; // bare: all air, so the gradient is a clean central difference
        Field<float>& d = world.fields().get_or_create<float>("danger", 0.0f);
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x)
                    d.at(x, y, z) = clamp01(0.4f + 0.03f * static_cast<float>(x));
        // At x=20 the ramp saturates to 1.0 (x=19 -> 0.97), so d/dx > 0 there and
        // threat reads ~1.0 -> flee ~= 61 (>= the 58 emergency band).
        NpcPool pool; pool.init();
        Registry reg;
        NpcId a = make_npc(pool, 20, 30, 30);
        Entity e = embody(reg, pool, a, 0);
        ai_step(reg, pool, &d, world.grid(), 0.0, dt);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee); // threat picked flee
        const Velocity& v = reg.get<Velocity>(e);
        CHECK(v.v.x < 0.0f);             // flees toward LOWER danger (-x)
        CHECK(std::fabs(v.v.y) < 1e-3f); // pure x ramp -> no lateral component
        CHECK(std::fabs(std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y) - kNpcWalkSpeed) <
              1e-3f);
    }
}
// ---- second parking pass: tests using the branch 6-faction FactionMatrix ----
// main kept its own faction.h (FIVE societies, with the documented palette split --
// red is reserved for danger, never a faction) and its FactionRelations matrix.
// These come back if and when a FactionMatrix equivalent is adapted.


static void test_faction_matrix() {
    FactionMatrix fm; // default-constructs to the ported base

    // Spot-check base cells against the reference seed matrix.
    CHECK(fm.attitude(FactionCitizen, FactionCitizen) == 100); // diagonal = self
    CHECK(fm.attitude(FactionWild, FactionWild) == 100);
    CHECK(fm.attitude(FactionCitizen, FactionWild) == -50);
    CHECK(fm.attitude(FactionCultist, FactionLiquidator) == -50);
    CHECK(fm.attitude(FactionCultist, FactionScientist) == -20);
    CHECK(fm.attitude(FactionCultist, FactionCitizen) == 0);
    CHECK(fm.attitude(FactionPlayer, FactionCitizen) == 50);
    CHECK(fm.attitude(FactionPlayer, FactionWild) == -50);

    // The base is symmetric and the diagonal is 100 for every faction.
    for (int a = 0; a < kFactionCount; ++a) {
        CHECK(fm.attitude(static_cast<std::uint16_t>(a),
                          static_cast<std::uint16_t>(a)) == 100);
        for (int b = 0; b < kFactionCount; ++b) {
            CHECK(fm.attitude(static_cast<std::uint16_t>(a),
                              static_cast<std::uint16_t>(b)) ==
                  fm.attitude(static_cast<std::uint16_t>(b),
                              static_cast<std::uint16_t>(a)));
        }
    }

    // Threshold classification (hostile <= -50, friendly >= 50, band = neutral).
    CHECK(fm.hostile(FactionCitizen, FactionWild));   // -50, exactly on the edge
    CHECK(fm.hostile(FactionWild, FactionCitizen));
    CHECK(!fm.hostile(FactionCultist, FactionScientist)); // -20 is in the band
    CHECK(!fm.friendly(FactionCultist, FactionScientist));
    CHECK(fm.friendly(FactionCitizen, FactionLiquidator)); // 50, on the edge
    CHECK(!fm.friendly(FactionCultist, FactionCitizen));   // 0 is neutral
    CHECK(!fm.hostile(FactionCultist, FactionCitizen));

    // Out-of-range factions read as neutral 0 (never index past the table), and
    // writes to them are ignored.
    CHECK(fm.attitude(99, 0) == 0);
    CHECK(fm.attitude(0, 99) == 0);
    CHECK(!fm.hostile(99, 0) && !fm.friendly(99, 0));
    fm.set(99, 0, 100); // no-op, must not corrupt neighbours
    CHECK(fm.attitude(99, 0) == 0);

    // set + nudge with integer-math clamping at the byte edges.
    fm.set(FactionCitizen, FactionCultist, 0);
    CHECK(fm.attitude(FactionCitizen, FactionCultist) == 0);
    fm.nudge(FactionCitizen, FactionCultist, -30);
    CHECK(fm.attitude(FactionCitizen, FactionCultist) == -30);
    fm.nudge(FactionCitizen, FactionCultist, -1000); // clamp at kAttitudeMin
    CHECK(fm.attitude(FactionCitizen, FactionCultist) == kAttitudeMin);
    fm.nudge(FactionCitizen, FactionCultist, 100000); // clamp at kAttitudeMax
    CHECK(fm.attitude(FactionCitizen, FactionCultist) == kAttitudeMax);

    // nudge_mutual moves both directions together.
    fm.set(FactionLiquidator, FactionCultist, 0);
    fm.set(FactionCultist, FactionLiquidator, 0);
    fm.nudge_mutual(FactionLiquidator, FactionCultist, -20);
    CHECK(fm.attitude(FactionLiquidator, FactionCultist) == -20);
    CHECK(fm.attitude(FactionCultist, FactionLiquidator) == -20);

    // reset_to_base restores the seed after arbitrary mutation.
    fm.reset_to_base();
    CHECK(fm.attitude(FactionCitizen, FactionCultist) == 0);
    CHECK(fm.attitude(FactionLiquidator, FactionCultist) == -50);
    CHECK(fm.attitude(FactionCitizen, FactionCitizen) == 100);
}
// ---- third parking pass: tests using the branch Needs (utility-AI vector) ----
// The branch Needs is an ECS component holding a .v[] vector of 0..100 drives. main
// Needs is the SURVIVAL CLOCK that lives in the pool row, because the elevator
// destroys the body and a component would reset the clock on every floor ride. Same
// name, different type -- no include fixes this, the types have to be reconciled.


static void test_scorer() {
    // A fully comfortable Citizen with no threat: reserves full, pressures empty,
    // full HP. Every scenario below is a one-field mutation of this.
    auto fresh = [] {
        Needs n{};
        n.v[NeedFood] = 100.0f;
        n.v[NeedWater] = 100.0f;
        n.v[NeedSleep] = 100.0f;
        n.v[NeedPee] = 0.0f;
        n.v[NeedPoo] = 0.0f;
        return n;
    };
    auto base = [] {
        Perception p;
        p.idSeed = identity_seed(1234u);
        p.faction = FactionCitizen;
        p.hp = 100.0f;
        p.maxHp = 100.0f;
        return p;
    };
    auto argmax = [](const float s[kIntentCount]) {
        std::uint8_t b = 0;
        for (std::uint8_t i = 1; i < kIntentCount; ++i)
            if (s[i] > s[b]) b = i;
        return b;
    };

    // --- Determinism: same (perception, needs) -> identical scores. ---
    {
        Perception p = base();
        Needs n = fresh();
        n.v[NeedFood] = 20.0f;
        float a[kIntentCount], b[kIntentCount];
        score_intents(p, n, a);
        score_intents(p, n, b);
        for (std::uint8_t i = 0; i < kIntentCount; ++i) CHECK(a[i] == b[i]);
    }

    // --- Range: every intent stays in [0, 100], even under nonsense inputs
    //     (over-damaged HP, out-of-band unit-ish fields, over-100 needs). This
    //     exercises clamp_score's NaN/edge handling and the unitish() bands. ---
    {
        Perception p = base();
        p.hp = -50.0f;
        p.danger = 999.0f;
        p.visibleHostiles = 40.0f;
        p.fire = 255.0f;
        p.samosborActive = true;
        Needs n = fresh();
        for (auto& v : n.v) v = 137.0f;
        float s[kIntentCount];
        score_intents(p, n, s);
        for (std::uint8_t i = 0; i < kIntentCount; ++i)
            CHECK(s[i] >= 0.0f && s[i] <= 100.0f);
    }

    // --- Idle comfortable Citizen: work is the argmax (duty*34 + workDrive*18
    //     ~= 27.7), ahead of the always-on flee baseline (~19.2). ---
    {
        Perception p = base();
        Needs n = fresh();
        float s[kIntentCount];
        score_intents(p, n, s);
        CHECK(argmax(s) == IntentWork);
        CHECK(s[IntentWork] >= 25.0f && s[IntentWork] <= 31.0f); // 27.7 +/- 2.5
    }

    // --- Starving (food -> 0): eat dominates (eatP saturates -> *86 ~= 86). ---
    {
        Perception p = base();
        Needs n = fresh();
        n.v[NeedFood] = 0.0f;
        float s[kIntentCount];
        score_intents(p, n, s);
        CHECK(argmax(s) == IntentEat);
        CHECK(s[IntentEat] >= 83.0f && s[IntentEat] <= 89.0f); // 86 +/- 2.5
    }

    // --- Bladder full (pee -> 100): toilet dominates (toiletP*92 ~= 92). ---
    {
        Perception p = base();
        Needs n = fresh();
        n.v[NeedPee] = 100.0f;
        float s[kIntentCount];
        score_intents(p, n, s);
        CHECK(argmax(s) == IntentToilet);
        CHECK(s[IntentToilet] >= 89.0f && s[IntentToilet] <= 95.0f); // 92 +/- 2.5
    }

    // --- Danger field saturated (danger=1) on an unarmed Citizen: flee is the
    //     argmax (threat*42 + (1-risk)*15 + panic*18 ~= 61.2) AND clears the
    //     emergency band, so #12c's selection FSM will preempt whatever it was
    //     doing. threat also lifts safety above the (now threat-crushed) work. ---
    {
        Perception p = base();
        p.danger = 1.0f;
        Needs n = fresh();
        float s[kIntentCount];
        score_intents(p, n, s);
        CHECK(argmax(s) == IntentFlee);
        CHECK(s[IntentFlee] >= kEmergencyScore);                 // emergency-eligible
        CHECK(s[IntentFlee] >= 58.0f && s[IntentFlee] <= 64.0f); // 61.2 +/- 2.5
        CHECK(s[IntentSafety] > s[IntentWork]);
    }

    // --- Identity jitter: two agents identical but for their id get different
    //     score vectors, so a uniform crowd does not act in lockstep. ---
    {
        Perception pa = base();
        pa.idSeed = identity_seed(7u);
        Perception pb = base();
        pb.idSeed = identity_seed(8u);
        Needs n = fresh();
        float a[kIntentCount], b[kIntentCount];
        score_intents(pa, n, a);
        score_intents(pb, n, b);
        bool anyDiff = false;
        for (std::uint8_t i = 0; i < kIntentCount; ++i)
            if (a[i] != b[i]) anyDiff = true;
        CHECK(anyDiff);
    }

    // --- Stickiness bonus lands on the current intent ONLY (the FSM feeds it in
    //     through Perception so select_intent needs only the raw scores). ---
    {
        Perception p = base();
        Needs n = fresh();
        float without[kIntentCount];
        score_intents(p, n, without);
        p.currentIntent = IntentWork;
        p.stickinessAmount = 10.0f;
        float with[kIntentCount];
        score_intents(p, n, with);
        CHECK(with[IntentWork] > without[IntentWork] + 8.0f); // rose by ~the bonus
        CHECK(with[IntentSocial] == without[IntentSocial]);   // others untouched
    }
}
// ---- fourth parking pass: remaining utility-AI / intent tests ----


static void test_selection() {
    float s[kIntentCount];
    auto reset = [&](float v) { for (auto& x : s) x = v; };

    // Fresh agent (kIntentNone) returns the raw argmax.
    reset(10.0f);
    s[IntentSocial] = 40.0f;
    CHECK(select_intent(s, kIntentNone) == IntentSocial);

    // Argmax ties favour the lower index (strict > in the scan).
    reset(10.0f);
    s[IntentToilet] = 50.0f; // index 3
    s[IntentEat] = 50.0f;    // index 5, same score -> lower index (toilet) wins
    CHECK(select_intent(s, kIntentNone) == IntentToilet);

    // Staying on the current intent when it is already best is a no-op.
    reset(10.0f);
    s[IntentPatrol] = 80.0f;
    CHECK(select_intent(s, IntentPatrol) == IntentPatrol);

    // Hysteresis: a challenger within the switch margin does NOT displace the
    // incumbent (near-ties stick), but one beyond it wins.
    reset(10.0f);
    s[IntentWork] = 50.0f;
    s[IntentEat] = 55.0f; // beats work by 5 < margin 7
    CHECK(select_intent(s, IntentWork) == IntentWork);
    s[IntentEat] = 58.0f; // beats work by 8 > margin 7
    CHECK(select_intent(s, IntentWork) == IntentEat);

    // Emergency override: a survival intent >= kEmergencyScore preempts even when
    // it does NOT clear the switch margin.
    reset(10.0f);
    s[IntentWork] = 55.0f;
    s[IntentFlee] = 59.0f; // 59 < 55 + 7 = 62 (margin fails) but 59 >= 58
    CHECK(select_intent(s, IntentWork) == IntentFlee);

    // ...an emergency intent BELOW the emergency score falls back to the margin
    // rule (so it does NOT preempt here).
    reset(10.0f);
    s[IntentWork] = 55.0f;
    s[IntentFlee] = 57.0f; // emergency intent, but < 58 and < 62
    CHECK(select_intent(s, IntentWork) == IntentWork);

    // A non-emergency intent never takes the emergency path, even above 58: it
    // must clear the margin like any other challenger.
    reset(10.0f);
    s[IntentWork] = 55.0f;
    s[IntentEat] = 60.0f; // 60 < 62, and eat is not an emergency intent
    CHECK(select_intent(s, IntentWork) == IntentWork);
    s[IntentEat] = 63.0f; // now clears the margin
    CHECK(select_intent(s, IntentWork) == IntentEat);
}
// ---- parking pass (log-driven) ----


static void test_loot_table() {
    // Bounds-tolerant spec lookup: OOB kind -> empty (no rare, no loot).
    CHECK(mob_loot(kMobKindCount).rareCount == 0);
    CHECK(mob_loot(kMobKindCount).lootCount == 0);
    // Only three kinds carry a lootTable (reference); most carry rareDrops only.
    CHECK(mob_loot(MobGnome).lootCount == 2);
    CHECK(mob_loot(MobZombie).lootCount == 2);
    CHECK(mob_loot(MobBetonnik).lootCount == 2);
    CHECK(mob_loot(MobSborka).lootCount == 0);
    CHECK(mob_loot(MobSborka).rareCount == 1);

    // Determinism: identical (kind, seed, killer) -> identical result.
    {
        LootResult a = roll_mob_loot(MobGnome, 0xC0FFEEu, true);
        LootResult b = roll_mob_loot(MobGnome, 0xC0FFEEu, true);
        CHECK(a.count == b.count);
        bool same = true;
        for (int i = 0; i < a.count; ++i)
            same = same && a.drops[i].itemId == b.drops[i].itemId &&
                   a.drops[i].count == b.drops[i].count;
        CHECK(same);
    }

    // Sweep invariants over many kinds x seeds: never exceed the cap, every id is
    // a real item (never the none sentinel), loot-only (non-player) never exceeds
    // the 3-stack lootTable cap.
    for (std::uint16_t k = 0; k < kMobKindCount; ++k) {
        for (std::uint32_t s = 1; s <= 3000; ++s) {
            LootResult r = roll_mob_loot(k, s, (s & 1u) != 0);
            CHECK(r.count <= kMaxLootDrops);
            for (int i = 0; i < r.count; ++i) {
                CHECK(r.drops[i].itemId != ItemNone);
                CHECK(r.drops[i].itemId < kItemCount);
                CHECK(r.drops[i].count >= 1);
            }
        }
        // Non-player kill on a lootTable kind: at most 3 stacks, all from loot.
        LootResult lo = roll_mob_loot(MobGnome, k + 7u, false);
        CHECK(lo.count <= 3);
    }

    const int N = 200000;
    const double dN = static_cast<double>(N);
    const float tol = 0.02f;

    // --- rareDrops: single-entry kind, PLAYER kill. Rate ~= its chance, and the
    // only item that can drop is the mapped one; non-player kills drop NOTHING
    // (Sborka has no lootTable). --------------------------------------------
    {
        int dropsPlayer = 0, dropsNonPlayer = 0, wrongItem = 0;
        for (std::uint32_t s = 1; s <= static_cast<std::uint32_t>(N); ++s) {
            LootResult rp = roll_mob_loot(MobSborka, s, true);
            LootResult rn = roll_mob_loot(MobSborka, s, false);
            dropsNonPlayer += rn.count;
            if (rp.count > 0) {
                ++dropsPlayer;
                if (rp.drops[0].itemId != ItemScrapMetal) ++wrongItem;
            }
        }
        CHECK(dropsNonPlayer == 0);                            // gated off without player
        CHECK(wrongItem == 0);                                 // only the mapped rare id
        CHECK(std::fabs(static_cast<double>(dropsPlayer) / dN - 0.03) < tol);
    }

    // --- rareDrops: two-entry kind (Rebar: rebar 0.08 then wire_coil 0.04),
    // first-hit-single. Rebar ~= 0.08; wire_coil ~= (1-0.08)*0.04 = 0.0368. -----
    {
        int rebar = 0, wire = 0, both = 0;
        for (std::uint32_t s = 1; s <= static_cast<std::uint32_t>(N); ++s) {
            LootResult r = roll_mob_loot(MobRebar, s, true);
            bool hasRebar = false, hasWire = false;
            for (int i = 0; i < r.count; ++i) {
                if (r.drops[i].itemId == ItemRebar) hasRebar = true;
                if (r.drops[i].itemId == ItemWireCoil) hasWire = true;
            }
            if (hasRebar) ++rebar;
            if (hasWire) ++wire;
            if (hasRebar && hasWire) ++both;
        }
        CHECK(both == 0);  // first-hit-single: at most ONE rare item, never both
        CHECK(std::fabs(static_cast<double>(rebar) / dN - 0.08) < tol);
        CHECK(std::fabs(static_cast<double>(wire) / dN - 0.0368) < tol);
    }

    // --- lootTable: Gnome (non-player, so ONLY the lootTable rolls). wire_coil
    // ~=0.35 (count 1..2), metal_sheet ~=0.15 (count 1); rebar (rare-only) never
    // appears on a non-player kill. --------------------------------------------
    {
        int wire = 0, sheet = 0, rebar = 0, wireCountBad = 0, sheetCountBad = 0;
        for (std::uint32_t s = 1; s <= static_cast<std::uint32_t>(N); ++s) {
            LootResult r = roll_mob_loot(MobGnome, s, false);
            for (int i = 0; i < r.count; ++i) {
                if (r.drops[i].itemId == ItemWireCoil) {
                    ++wire;
                    if (r.drops[i].count < 1 || r.drops[i].count > 2) ++wireCountBad;
                } else if (r.drops[i].itemId == ItemMetalSheet) {
                    ++sheet;
                    if (r.drops[i].count != 1) ++sheetCountBad;
                } else if (r.drops[i].itemId == ItemRebar) {
                    ++rebar;
                }
            }
        }
        CHECK(rebar == 0);          // rare-only item, gated off without a player kill
        CHECK(wireCountBad == 0);
        CHECK(sheetCountBad == 0);
        CHECK(std::fabs(static_cast<double>(wire) / dN - 0.35) < tol);
        CHECK(std::fabs(static_cast<double>(sheet) / dN - 0.15) < tol);
    }

    // --- lootTable: Betonnik (the mapped betonoed table). rawmeat ~=0.25 (1..2),
    // metal_sheet ~=0.10 (1). ---------------------------------------------------
    {
        int meat = 0, sheet = 0;
        for (std::uint32_t s = 1; s <= static_cast<std::uint32_t>(N); ++s) {
            LootResult r = roll_mob_loot(MobBetonnik, s, false);
            for (int i = 0; i < r.count; ++i) {
                if (r.drops[i].itemId == ItemRawMeat) ++meat;
                else if (r.drops[i].itemId == ItemMetalSheet) ++sheet;
            }
        }
        CHECK(std::fabs(static_cast<double>(meat) / dN - 0.25) < tol);
        CHECK(std::fabs(static_cast<double>(sheet) / dN - 0.10) < tol);
    }
}