// Predation — monsters hunting the crowd, and the ten-minute survivor count.
//
// [hunt.h] is a rate-control design, so the assertion that matters is a
// MEASUREMENT, not an opinion: run a real floor — real generator, real spawner, real
// nav bake, real physics, real combat — for a simulated ten minutes at the shipping
// kSimHz tick ([core/tick.h]), and count who is left. Everything else in this suite is
// a guard around that number.
//
// The floor under test is the composite the whole feature was deferred over, and it
// is not a contrivance: the two halves genuinely co-occur. `floor_spec_for(15)`
// resolves to Residential (population 420) and `mob_count_for_floor(15, danger 1,
// Living)` resolves to ~600 heads at level 3. Floor 15 really is 420 residents
// against 600 monsters — the "bloodbath on load" named in combat.h and monsters.md.
//
// This is a .inl and not a .cpp for the reason suite_samosbor.inl states: game_test
// owns the CHECK macro, so the include has to land after it, and the suite carries
// its own #include of the system under test to keep that diff two lines.

#include "core/tick.h"   // kSimDt / kSimHz — never a bare 1/120 ([core/tick.h])
#include "game/hunt.h"

static void test_hunt_all() {
    const float dt = kSimDt;

    // The weakest kind in the table that can swing at all — SBORKA, 3 damage on a
    // 0.65 s cooldown. Chosen the same way test_faction_gates_hunting chooses, and
    // deliberately the weakest: if predation works with the feeblest monster in the
    // game it works with all of them, and the timings below are worst-case.
    std::uint8_t weakKind = 0;
    for (std::size_t k = 0; k < kMobKindCount; ++k)
        if (kMobTable[k].dmg > 0 && kMobTable[k].meleeReachMm > 0) {
            weakKind = static_cast<std::uint8_t>(k);
            break;
        }
    CHECK(kMobTable[weakKind].dmg > 0);
    // 30 HP, not the 100 a real resident carries: at 3 damage a swing the weakest
    // kind needs 34 swings and 22 s to take 100 HP down, which is longer than one
    // hunting window on purpose ([hunt.h] is sized on the spawn-weighted 13.8 s, not
    // on the outlier). A shorter body keeps this unit test inside one window without
    // pretending the window is longer than it is.
    const std::int16_t kFrailHp = 30;

    // ---- 1. The licence is pure, SCARCE, and expires in whole windows -------
    {
        std::uint32_t licensed = 0;
        for (std::uint32_t id = 1; id <= 6000u; ++id)
            if (mob_hunts_npcs(id, 500u)) ++licensed;
        // 6000/kHuntShare is the expectation. A hash is not a shuffle, so this is a
        // band — but one tight enough that a gate stuck open or shut fails it.
        const std::uint32_t want = 6000u / kHuntShare;
        CHECK(licensed > want / 2u);
        CHECK(licensed < want * 2u);

        // A licence must last long enough for a fight to finish, or predation only
        // ever produces wounded bodies. Measure a window that starts cleanly: find a
        // false->true transition, which by construction is an epoch boundary, and
        // then measure the run.
        std::uint32_t probe = 0;
        std::uint64_t start = 0;
        for (std::uint32_t id = 1; id < 400u && probe == 0; ++id) {
            bool prev = mob_hunts_npcs(id, 0);
            for (std::uint64_t t = 1; t < kHuntEpochTicks * 64u; ++t) {
                const bool now = mob_hunts_npcs(id, t);
                if (now && !prev) { probe = id; start = t; break; }
                prev = now;
            }
        }
        CHECK(probe != 0);
        std::uint64_t run = 0;
        while (run < kHuntEpochTicks * 16u && mob_hunts_npcs(probe, start + run))
            ++run;
        // Whole windows, never a fragment: the licence is a function of the epoch
        // alone, so a run beginning on a boundary can only be a multiple of one.
        CHECK(run % kHuntEpochTicks == 0u);
        CHECK(run >= kHuntEpochTicks);              // covers the 13.8 s time-to-kill
        CHECK(run < kHuntEpochTicks * 16u);         // and it really does expire
    }

    // ---- 2. A monster kills a resident, and the death goes through the ONE
    //         finalizer ------------------------------------------------------
    // One monster, one resident, standing on each other: this asserts the damage and
    // death PATH, not who happened to meet whom on a floor.
    {
        LevelStack stack;
        LayerId layer = stack.push_layer();
        Registry reg;
        NpcPool pool;
        pool.init();
        EventBus bus;
        bus.init();
        bus.set_logging(true);

        const NpcId victimId = pool.spawn();
        pool.hp(victimId) = kFrailHp;
        pool.max_hp(victimId) = kFrailHp;
        pool.faction(victimId) = static_cast<std::uint16_t>(Faction::Citizens);
        const std::uint32_t aliveBefore = pool.alive();

        Entity body = reg.create();
        Transform bt;
        bt.pos = vec3{40.0f, 40.0f, 4.0f};
        bt.layer = layer;
        reg.emplace<Transform>(body, bt);
        reg.emplace<NpcRef>(body, NpcRef{victimId});

        Entity mob = reg.create();
        reg.emplace<Transform>(mob, bt);            // same cell: unmissable
        reg.emplace<MobRef>(mob, MobRef{weakKind, 1, 100, 100});
        reg.emplace<MobCombat>(mob, MobCombat{0, 0});

        // Entity ids come from the registry, so the licensed and unlicensed ticks are
        // FOUND rather than chosen.
        const std::uint32_t mobKey =
            static_cast<std::uint32_t>(entt::to_integral(mob));
        std::uint64_t hunting = 0;
        while (hunting < kHuntEpochTicks * 4096u && !mob_hunts_npcs(mobKey, hunting))
            ++hunting;
        std::uint64_t quiet = 0;
        while (quiet < kHuntEpochTicks * 4096u && mob_hunts_npcs(mobKey, quiet))
            ++quiet;
        CHECK(mob_hunts_npcs(mobKey, hunting));
        CHECK(!mob_hunts_npcs(mobKey, quiet));

        // Unlicensed, and the resident is standing INSIDE its jaws: it must not lose
        // a single point. Without this the gate could be decorative and every other
        // assertion here would still pass.
        for (int i = 0; i < 600; ++i)
            mob_attack_step(reg, stack.layer(layer).grid(), pool, bus, layer, dt,
                            quiet);
        CHECK(pool.hp(victimId) == kFrailHp);

        // Licensed: the fight runs, and it finishes inside one window.
        std::uint32_t swings = 0;
        std::uint64_t t = hunting;
        while (t < hunting + kHuntEpochTicks && pool.hp(victimId) > 0) {
            swings += mob_attack_step(reg, stack.layer(layer).grid(), pool, bus,
                                      layer, dt, t);
            ++t;
        }
        CHECK(swings > 0);                          // monsters DO kill residents
        CHECK(pool.hp(victimId) == 0);
        CHECK(t < hunting + kHuntEpochTicks);

        // THE death contract, checked in the gap. apply_damage tagged Dead and did
        // NOT destroy, so right now the body still exists and the pool row is still
        // alive. Everything that hooks NpcDied — loot, an A-Life record, a contract —
        // depends on this window existing ([combat.h] defect 2).
        CHECK(reg.valid(body));
        CHECK(reg.all_of<Dead>(body));
        CHECK(pool.alive(victimId));
        CHECK(pool.alive() == aliveBefore);

        const std::size_t logBefore = bus.log().size();
        CHECK(finalize_deaths(reg, pool, bus, t) == 1);
        // ...and only now. NpcPool::kill was reached, the slot was NOT reclaimed, and
        // exactly one NpcDied names the victim and the killer.
        CHECK(!reg.valid(body));
        CHECK(!pool.alive(victimId));
        CHECK(pool.valid(victimId));                // an id stays valid forever
        CHECK(pool.alive() == aliveBefore - 1u);
        std::uint32_t died = 0;
        for (std::size_t i = logBefore; i < bus.log().size(); ++i) {
            if (bus.log()[i].type != EventType::NpcDied) continue;
            ++died;
            CHECK(bus.log()[i].a == victimId);
            CHECK(bus.log()[i].b == 0xFFu);         // a body, not a mob kind
            CHECK(bus.log()[i].c ==
                  static_cast<std::uint32_t>(entt::to_integral(mob)));
        }
        CHECK(died == 1);
    }

    // ---- 3. A Cultist resident is spared, and it is the BODY that saves it ---
    // Same monster, same cell, same licence, same tick count: the only difference is
    // the faction byte. This is the faction matrix's second live consumer and it has
    // to resolve through `body_row`, exactly like the first.
    {
        LevelStack stack;
        LayerId layer = stack.push_layer();

        auto damage_taken = [&](Faction f) -> std::int16_t {
            Registry reg;
            NpcPool pool;
            pool.init();
            EventBus bus;
            bus.init();
            const NpcId id = pool.spawn();
            pool.hp(id) = 30000;              // unkillable on purpose: this measures
            pool.max_hp(id) = 30000;          // damage taken, not survival
            pool.faction(id) = static_cast<std::uint16_t>(f);

            Entity b = reg.create();
            Transform bt;
            bt.pos = vec3{60.0f, 60.0f, 4.0f};
            bt.layer = layer;
            reg.emplace<Transform>(b, bt);
            reg.emplace<NpcRef>(b, NpcRef{id});

            Entity mob = reg.create();
            reg.emplace<Transform>(mob, bt);
            reg.emplace<MobRef>(mob, MobRef{weakKind, 1, 100, 100});
            reg.emplace<MobCombat>(mob, MobCombat{0, 0});

            const std::uint32_t key =
                static_cast<std::uint32_t>(entt::to_integral(mob));
            std::uint64_t t0 = 0;
            while (t0 < kHuntEpochTicks * 4096u && !mob_hunts_npcs(key, t0)) ++t0;
            for (std::uint64_t t = t0; t < t0 + kHuntEpochTicks; ++t)
                mob_attack_step(reg, stack.layer(layer).grid(), pool, bus, layer, dt,
                                t);
            return static_cast<std::int16_t>(30000 - pool.hp(id));
        };

        CHECK(damage_taken(Faction::Citizens) > 0);
        CHECK(damage_taken(Faction::Cultists) == 0);   // the one society left alone
        CHECK(damage_taken(Faction::Liquidators) > 0);
        CHECK(damage_taken(Faction::Scientists) > 0);
        CHECK(damage_taken(Faction::Wild) > 0);        // -60 is past the -50 boundary

        // The steering half must agree with the attack half. Gating one and not the
        // other is the bug wander.cpp documents: a cultist would be chased forever
        // and never swung at, which reads as broken pathfinding rather than safety.
        {
            Registry reg;
            NpcPool pool;
            pool.init();
            const NpcId cul = pool.spawn();
            pool.hp(cul) = 100;
            pool.max_hp(cul) = 100;
            pool.faction(cul) = static_cast<std::uint16_t>(Faction::Cultists);
            Entity b = reg.create();
            Transform bt;
            bt.pos = vec3{60.0f, 60.0f, 4.0f};
            bt.layer = layer;
            reg.emplace<Transform>(b, bt);
            reg.emplace<NpcRef>(b, NpcRef{cul});

            CHECK(nearest_prey(reg, pool, layer, bt.pos, kHuntRadius).e ==
                  entt::null);
            pool.faction(cul) = static_cast<std::uint16_t>(Faction::Citizens);
            CHECK(nearest_prey(reg, pool, layer, bt.pos, kHuntRadius).e == b);
            // The radius is real, not decorative.
            const vec3 away{bt.pos.x + kHuntRadius + 1.0f, bt.pos.y, bt.pos.z};
            CHECK(nearest_prey(reg, pool, layer, away, kHuntRadius).e == entt::null);
            // And a body already scheduled to die is not worth a window.
            reg.emplace<Dead>(b, Dead{entt::null, 0});
            CHECK(nearest_prey(reg, pool, layer, bt.pos, kHuntRadius).e ==
                  entt::null);
        }
    }

    // ---- 4. The player is still attacked normally, and still outranks the crowd
    {
        LevelStack stack;
        LayerId layer = stack.push_layer();
        Registry reg;
        NpcPool pool;
        pool.init();
        EventBus bus;
        bus.init();

        const NpcId me = pool.spawn();
        pool.hp(me) = 30000;
        pool.max_hp(me) = 30000;
        pool.faction(me) = static_cast<std::uint16_t>(Faction::Citizens);
        pool.set_player(me, true);
        const NpcId local = pool.spawn();
        pool.hp(local) = 30000;
        pool.max_hp(local) = 30000;
        pool.faction(local) = static_cast<std::uint16_t>(Faction::Citizens);

        Transform at;
        at.pos = vec3{80.0f, 80.0f, 4.0f};
        at.layer = layer;

        Entity player = reg.create();
        reg.emplace<Transform>(player, at);
        reg.emplace<NpcRef>(player, NpcRef{me});
        reg.emplace<CameraTag>(player, CameraTag{});

        Entity neighbour = reg.create();
        reg.emplace<Transform>(neighbour, at);       // the same cell as the player
        reg.emplace<NpcRef>(neighbour, NpcRef{local});

        Entity mob = reg.create();
        reg.emplace<Transform>(mob, at);
        reg.emplace<MobRef>(mob, MobRef{weakKind, 1, 100, 100});
        reg.emplace<MobCombat>(mob, MobCombat{0, 0});

        const std::uint32_t key = static_cast<std::uint32_t>(entt::to_integral(mob));
        std::uint64_t quiet = 0;
        while (quiet < kHuntEpochTicks * 4096u && mob_hunts_npcs(key, quiet)) ++quiet;
        std::uint64_t hunting = 0;
        while (hunting < kHuntEpochTicks * 4096u && !mob_hunts_npcs(key, hunting))
            ++hunting;

        // Unlicensed: the crowd is invisible, the player is not. This is the
        // regression that would hurt most — a rate limiter that accidentally
        // throttled the player's own beating.
        for (int i = 0; i < 600; ++i)
            mob_attack_step(reg, stack.layer(layer).grid(), pool, bus, layer, dt,
                            quiet);
        CHECK(pool.hp(me) < 30000);
        CHECK(pool.hp(local) == 30000);

        // Licensed, with both bodies in the same cell: the player STILL wins, because
        // it is inside kHuntRadius ([hunt.h] rule 1).
        const std::int16_t playerBefore = pool.hp(me);
        const std::int16_t neighbourBefore = pool.hp(local);
        for (int i = 0; i < 600; ++i)
            mob_attack_step(reg, stack.layer(layer).grid(), pool, bus, layer, dt,
                            hunting);
        CHECK(pool.hp(me) < playerBefore);
        CHECK(pool.hp(local) == neighbourBefore);
    }

    // ---- 5. THE MEASUREMENT: ten minutes on a real 420-vs-600 floor ---------
    {
        LevelStack stack;
        LayerId layer = stack.push_layer();
        const FloorSpec& spec = floor_spec(FloorKind::Residential);
        // Generated straight INTO the stack layer, not copied grid-only: physics reads
        // the 8^3 sub-voxel masks, and a grid-only copy drops the crowd through the
        // slab and quietly measures a floor nobody is standing on.
        generate_floor(stack.layer(layer), 15, spec, 4242u);

        Registry reg;
        NpcPool pool;
        pool.init();
        EventBus bus;
        bus.init();

        CHECK(seed_floor_from_spec(pool, 15, spec, 77u) != kInvalidNpc);
        std::uint32_t residents = 0, exempt = 0;
        for (NpcId id = 0; id < pool.count(); ++id) {
            if (!pool.alive(id)) continue;
            embody(reg, pool, id, layer);
            ++residents;
            if (!mob_hostile_to(pool, id)) ++exempt;
        }
        const std::uint32_t mobs = spawn_floor_mobs(
            reg, stack.layer(layer), 15, danger_for_hostility(spec.hostility),
            theme_for_kind(FloorKind::Residential), layer, 31u, 0,
            FloorKind::Residential);

        nav::CoarseGraph coarse;
        nav::FineNav fine;
        nav::bake_coarse(stack.layer(layer).grid(), coarse);
        nav::bake_fine(stack.layer(layer).grid(), fine);
        wander_init(reg, layer, 5u);

        // The scenario is pinned. If the floor stops being 420-vs-600 the survivor
        // number stops meaning what it says.
        CHECK(residents == 420);
        CHECK(exempt > 20u && exempt < 80u);   // the {7,1,1,0,1} mix, ~1 in 10 Cultist
        CHECK(mobs > 500u && mobs < 700u);

        // NO camera holder, deliberately. That is the WORST case for the crowd: with
        // a player on the floor every monster within 20 m is pulled off the residents
        // entirely, so measuring without one measures pure predation and cannot
        // flatter the design.
        // Ten minutes of SIM TIME, derived from the rate rather than retyped. The
        // literal 72000 this used to be was 600 s only at 120 Hz; at the shipping
        // kSimHz = 125 it was 9.6 minutes, so the headline "10 min" undersold the
        // window by 24 s. `kMinute` also feeds the per-minute buckets below, which is
        // the part that could not be fixed by halves: raising the total without it
        // would index perMinute[10] and write off the end of the array.
        const std::uint64_t kMinute = 60u * static_cast<std::uint64_t>(kSimHz);
        const std::uint64_t kTenMinutes = 10u * kMinute;
        const std::uint32_t startAlive = pool.alive();
        std::uint32_t deaths = 0;
        std::uint32_t perMinute[10] = {};
        std::uint64_t hunterSum = 0;
        std::uint32_t hunterSamples = 0;
        std::uint32_t peakHunters = 0;

        for (std::uint64_t t = 0; t < kTenMinutes; ++t) {
            wander_step(reg, stack.layer(layer).grid(), pool, coarse, fine, layer, t);
            physics_step(reg, stack, dt);
            mob_attack_step(reg, stack.layer(layer).grid(), pool, bus, layer, dt, t);
            projectile_step(reg, pool, bus, stack, layer, dt, t);
            const std::uint32_t d = finalize_deaths(reg, pool, bus, t);
            deaths += d;
            perMinute[static_cast<std::size_t>(t / kMinute)] += d;
            // The bus ring holds one drain cycle (4096) and the game drains it every
            // tick; nothing drains it here, so drain it or the deaths past 4096 would
            // be counted as drops instead of published.
            bus.clear();

            // The cost driver, counted from the SHIPPING predicate rather than
            // estimated: prey pair-tests per tick are (licensed mobs) x (live bodies).
            // Every 5 s of sim time. Expressed in kSimHz so the sample COUNT stays at
            // 120 across a rate change — a bare 600 would have sampled every 4.8 s.
            if (t % (5u * static_cast<std::uint64_t>(kSimHz)) == 0u) {
                std::uint32_t h = 0;
                for (auto m : reg.view<const MobRef>())
                    if (mob_hunts_npcs(
                            static_cast<std::uint32_t>(entt::to_integral(m)), t))
                        ++h;
                hunterSum += h;
                ++hunterSamples;
                if (h > peakHunters) peakHunters = h;
            }
        }

        const std::uint32_t survivors = pool.alive();
        const double meanHunters =
            static_cast<double>(hunterSum) /
            static_cast<double>(hunterSamples ? hunterSamples : 1u);
        std::printf("  hunt: 10 min, floor 15, %u residents (%u Cultist-exempt) vs "
                    "%u monsters L3 -> %u survivors, %u dead (%.1f%%)\n",
                    residents, exempt, mobs, survivors, deaths,
                    100.0 * static_cast<double>(deaths) /
                        static_cast<double>(residents));
        std::printf("  hunt: deaths per minute:");
        for (int m = 0; m < 10; ++m)
            std::printf(" %u", perMinute[static_cast<std::size_t>(m)]);
        std::printf("\n  hunt: licensed hunters mean %.1f peak %u of %u (1 in %u); "
                    "prey pair-tests/tick ~%.0f\n",
                    meanHunters, peakHunters, mobs, kHuntShare,
                    meanHunters * static_cast<double>(survivors));

        // Every death went through the finalizer, so the pool arithmetic closes
        // EXACTLY. A body removed by any other route would leave this short.
        CHECK(startAlive - survivors == deaths);
        CHECK(pool.count() == residents);       // and no slot was ever reclaimed

        // THE DESIGN GATE, and the number this whole file exists to produce.
        //
        // Measured at kHuntShare 32: 361 survivors of 420, 59 dead, 14.0%. The band is
        // wide on purpose — float arithmetic and the physics sweep are not guaranteed
        // bit-identical between MSVC and Clang, so pinning ±3 would fail on the other
        // host for no design reason. It is still narrow enough to catch the two
        // failures that matter: predation silently switching itself off, and predation
        // eating the floor.
        CHECK(deaths >= 20u);                   // monsters really are a threat
        CHECK(survivors >= 300u);               // and the crowd really does survive
        CHECK(survivors <= 400u);
        // The hard floor, independent of tuning: below half the crowd the systems that
        // read the crowd — rumours, contracts, the faction census, the body you
        // respawn into — are running on a morgue.
        CHECK(survivors * 2u > residents);
        // And the rate must be roughly FLAT rather than accelerating. Acceleration
        // means wounded bodies are piling up faster than they are finished, which is
        // what a too-short kHuntEpochTicks produces — the failure that looks fine at
        // ten minutes and empties the floor at thirty.
        std::uint32_t firstHalf = 0, secondHalf = 0;
        for (int m = 0; m < 5; ++m) firstHalf += perMinute[static_cast<std::size_t>(m)];
        for (int m = 5; m < 10; ++m) secondHalf += perMinute[static_cast<std::size_t>(m)];
        CHECK(secondHalf < firstHalf * 3u + 20u);
    }
}
