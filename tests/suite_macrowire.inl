// MacroSim <-> FloorStreamer integration ([macro_sim.h] + [floor_stream.h]).
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga::game`.
//
// suite_macrosim.inl already proves MacroSim's demographics against SYNTHETIC pools.
// This suite covers the one seam it cannot: the macro tick running WHILE a floor is
// embodied, which is exactly what main.cpp now does (a step() every kMacroPeriodTicks
// beside the 125 Hz sim). The commit that landed MacroSim flagged this seam "NOT
// VERIFIED in the running game" because nothing drove step() against a live floor.
//
// THE LOAD-BEARING PROPERTY: step() must never touch an EMBODIED record. The active
// floor's crowd and the player are live ECS bodies owned by the micro sim; if the
// macro sweep aged, killed or migrated one of them it would desync the body from its
// cold row — silently age the on-screen player toward death, or teleport a visible
// NPC's floor label out from under its body. macro_sim.cpp guards this at every pass
// (aging/mortality/birth-parent, migration land + depart, social), and this asserts
// the guard holds through a real streamer load rather than a hand-set NpcEmbodied bit.

static void test_macrowire_all() {
    // ---- The wiring's exact shape, reproduced headless. ----------------------
    // main.cpp: pool.init() -> add_module per floor -> set_floors_from(registry) ->
    // ensure_loaded(0) -> the sim loop steps macro every kMacroPeriodTicks. Here the
    // ECS/streamer half is real; only the 125 Hz loop is replaced by a direct step().
    Registry ecs;
    NpcPool pool;
    pool.init();
    FloorRegistry reg;
    LevelStack stack;

    FloorStreamer stream;
    stream.init(stack, /*keepRadius=*/0);
    // The demo stack's shape: sparse and signed, mostly below the hub — the reason
    // migration draws from a registered set and not a [lo,hi] band ([macro_sim.h]).
    const std::int16_t kStack[5] = {-50, -14, 0, 14, 30};
    for (int i = 0; i < 5; ++i) {
        const std::uint32_t fseed =
            1337u ^ (static_cast<std::uint32_t>(kStack[i]) * 0x9e3779b9u);
        stream.add_module(reg, static_cast<int>(kStack[i]), FloorKind::Residential,
                          fseed);
    }

    MacroSim macro;
    macro.init();
    // set_floors_from AFTER the module loop, exactly as main.cpp orders it: the
    // registry is the authoritative live set, so this reads all five labels.
    macro.set_floors_from(reg);
    CHECK(macro.floor_count() == 5u);

    // Load ONLY floor 0. Its crowd embodies into ECS bodies; the other four floors'
    // records exist in the cold pool but are seeded lazily on first load, so at this
    // point only floor 0 has any records at all.
    NpcId playerId = kInvalidNpc;
    LoadResult start = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(start.player != entt::null);
    CHECK(playerId != kInvalidNpc);
    const std::uint32_t pop = floor_spec(FloorKind::Residential).population;
    CHECK(pool.count() == pop);
    CHECK(pool.alive() == pop);

    // The embodied set: every record labelled floor 0 is a live body after the load.
    // Snapshot each one's id, age and floor label so a macro step that touched any of
    // them would show as a changed column here.
    const std::vector<NpcId> embodied = pool.floor_bucket(0);
    CHECK(!embodied.empty());
    CHECK(embodied.size() == pop);   // the whole floor-0 crowd is live
    std::vector<std::uint8_t> ageBefore(embodied.size());
    std::vector<std::int16_t> floorBefore(embodied.size());
    for (std::size_t k = 0; k < embodied.size(); ++k) {
        const NpcId id = embodied[k];
        CHECK(pool.embodied(id));           // the load embodied it
        ageBefore[k] = pool.age(id);
        floorBefore[k] = pool.floor(id);
    }
    // The player is one of the embodied records and carries the NpcPlayer bit.
    CHECK(pool.embodied(playerId));
    CHECK(pool.is_player(playerId));
    const std::uint8_t playerAgeBefore = pool.age(playerId);

    // ---- Run the macro tick many times over the live floor. ------------------
    // 400 steps at daysPerTick 7 = 2,800 simulated days ~= 7.7 years, well past the
    // onset of old-age mortality, so the cold society genuinely churns. targetPopulation
    // 0 latches the seeded living count on the first step (main.cpp's default).
    MacroParams p{};   // defaults, exactly as main.cpp constructs them
    std::uint32_t totalDeaths = 0;
    std::uint32_t totalBirths = 0;
    std::uint32_t totalDepartures = 0;
    for (int t = 0; t < 400; ++t) {
        const MacroStats s = macro.step(pool, p);
        totalDeaths += s.deaths;
        totalBirths += s.births;
        totalDepartures += s.departures;
        // Every tick: the living tally never loses the dead. Same invariant
        // suite_macrosim leans on, re-checked here because embodied records are
        // COUNTED among the living without being aged, and an off-by-one in that
        // branch would show as living != alive.
        CHECK(s.living == pool.alive());
    }

    // ---- The load-bearing assertion: embodied records were NOT touched. ------
    // Not one of floor 0's live bodies aged a single year, changed floor label, or
    // died, across 7.7 simulated years of macro time — because step() skips embodied
    // records at every pass. If this fails, the wiring is ageing the on-screen crowd.
    for (std::size_t k = 0; k < embodied.size(); ++k) {
        const NpcId id = embodied[k];
        CHECK(pool.alive(id));                    // never killed by the macro sweep
        CHECK(pool.embodied(id));                 // still live
        CHECK(pool.age(id) == ageBefore[k]);      // never aged
        CHECK(pool.floor(id) == floorBefore[k]);  // never migrated off floor 0
    }
    CHECK(pool.age(playerId) == playerAgeBefore); // the player above all
    CHECK(pool.is_player(playerId));
    CHECK(pool.embodied(playerId));

    // ---- And the cold society genuinely evolved. -----------------------------
    // The point of wiring it at all: SOMETHING happened off-screen. Over 7.7 years the
    // cold floors must have seen old-age deaths and replacement births (closed loop),
    // and with five registered floors migration must have started journeys. These are
    // existence checks, not exact counts — suite_macrosim owns the demographic
    // arithmetic; this only proves the tick is live in the integrated setup.
    //
    // NOTE only floor 0 is seeded (the other four load lazily), so the whole cold
    // society is floor 0's own non-embodied records. There are none: ensure_loaded
    // embodied the ENTIRE floor-0 crowd. So with a single loaded floor the cold set is
    // empty and nothing can evolve — which is itself the thing to assert, because it
    // proves the embodied guard did not leak. We then load a second floor COLD (via a
    // bucket that stays folded) to give the macro tick something to chew on.
    CHECK(totalDeaths == 0u);      // every record was embodied -> untouchable
    CHECK(totalBirths == 0u);      // no cold fertile adult -> no parent -> no birth
    CHECK(totalDepartures == 0u);  // embodied records never depart

    // Seed a SECOND floor's crowd into the cold pool WITHOUT embodying it, the state
    // the streamer leaves every non-active floor in once it has been visited and
    // folded back. seed_floor_from_spec is what ensure_loaded calls internally; calling
    // it directly gives a cold, un-embodied crowd on floor -14. The -14 module is
    // registered but never LOADED here, so this seeding is the whole of the cold
    // society the macro tick sees.
    const FloorSpec& spec = floor_spec(FloorKind::Residential);
    seed_floor_from_spec(pool, -14, spec, 4242u);
    const std::uint32_t coldPop = pool.count() - pop;
    CHECK(coldPop > 0u);
    // Force BOTH demographic events within a couple hundred ticks rather than decades,
    // by splitting the cold crowd's ages deterministically by index:
    //   * odd ids  -> 99: one year of macro time (52 ticks) tips them over maxAge (100)
    //     into certain death, and the pre-ceiling curve kills some even sooner.
    //   * even ids -> 30: squarely inside the fertile window (18..45), so the birth
    //     reservoir is never empty and replacement births can actually fire.
    // Ageing everyone into the mortality window (the naive version of this) would leave
    // no fertile parent and births could never happen — the closed loop needs someone
    // to be born FROM. The embodied floor-0 crowd is left exactly as it was.
    const std::vector<NpcId> cold = pool.floor_bucket(-14);
    CHECK(cold.size() == coldPop);
    for (std::size_t k = 0; k < cold.size(); ++k) {
        const NpcId id = cold[k];
        CHECK(!pool.embodied(id));
        pool.age(id) = (k & 1u) ? 99 : 30;
    }

    std::uint32_t coldDeaths = 0;
    std::uint32_t coldBirths = 0;
    std::uint32_t coldDepartures = 0;
    for (int t = 0; t < 200; ++t) {
        const MacroStats s = macro.step(pool, p);
        coldDeaths += s.deaths;
        coldBirths += s.births;
        coldDepartures += s.departures;
        CHECK(s.living == pool.alive());
        // The embodied floor-0 crowd stays frozen every single tick, even while the
        // cold floor is dying and migrating around it.
        CHECK(pool.age(playerId) == playerAgeBefore);
    }
    // Old age took some cold records; the closed loop replaced them; and with five
    // registered floors the migration ring-scan started journeys off the cold floor.
    CHECK(coldDeaths > 0u);
    CHECK(coldBirths > 0u);
    CHECK(coldDepartures > 0u);

    // Final guard: floor 0's bodies are STILL untouched after 600 total macro steps.
    for (std::size_t k = 0; k < embodied.size(); ++k) {
        const NpcId id = embodied[k];
        CHECK(pool.alive(id));
        CHECK(pool.embodied(id));
        CHECK(pool.age(id) == ageBefore[k]);
        CHECK(pool.floor(id) == floorBefore[k]);
    }
}
