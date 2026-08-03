// Samosbor tests — the depth-scaled pressure clock. Included into game_test.cpp,
// so it uses that file's CHECK macro and its `using namespace giga::game`.
//
// The load-bearing assertion in here is MONOTONICITY of the duty cycle in |z|.
// Everything else in samosbor.h is a number that a designer may legitimately
// retune; monotonicity is the design itself. If a later edit "tidies" the
// interpolation and makes a deep floor calmer than a shallow one, nothing else in
// the game notices — the floor still loads, the mobs still spawn, the clock still
// ticks, and the descent simply stops being frightening. That is the regression
// this file exists to catch.
//
// This is a .inl and not a .cpp on purpose: game_test.cpp owns the CHECK macro
// and the counters, so the include has to land AFTER that macro rather than up
// among the ordinary includes. It carries its own `#include` of the system under
// test so game_test.cpp's diff stays two lines.

#include "game/samosbor.h"

static void test_samosbor_all() {
    { // ---- test_samosbor_variant_table ----
        // Row index must equal the enum, or a weighted pick returns the wrong row.
        std::uint32_t total = 0;
        for (std::size_t i = 0; i < kSamosborVariantCount; ++i) {
            const SamosborVariantDef& d = kSamosborVariants[i];
            CHECK(d.variant == static_cast<std::uint8_t>(i));
            CHECK(kSamosborVariantNames[i] != nullptr);
            // The authored bands from the reference (balance.md:108).
            CHECK(d.durationMultX100 >= 82 && d.durationMultX100 <= 115);
            CHECK(d.spawnMultX100 >= 52 && d.spawnMultX100 <= 118);
            CHECK(d.sealDeltaSec >= -2 && d.sealDeltaSec <= 4);
            CHECK(d.weight >= 3 && d.weight <= 60);
            total += d.weight;
        }
        // 60+20+16+14+4+3+4. samosbor_pick_variant's fallback is unreachable only
        // while this holds, which is why it is asserted rather than assumed.
        CHECK(total == kSamosborWeightTotal);
        CHECK(total == 121u);

        // The authored weights, verbatim.
        CHECK(samosbor_variant_def(SamosborVariant::Classic).weight == 60);
        CHECK(samosbor_variant_def(SamosborVariant::Wet).weight == 20);
        CHECK(samosbor_variant_def(SamosborVariant::Electric).weight == 16);
        CHECK(samosbor_variant_def(SamosborVariant::Meat).weight == 14);
        CHECK(samosbor_variant_def(SamosborVariant::Maronary).weight == 4);
        CHECK(samosbor_variant_def(SamosborVariant::Istotit).weight == 3);
        CHECK(samosbor_variant_def(SamosborVariant::Veretar).weight == 4);

        // Classic is the modal variant and the three rare ones stay rare — 11/121 is
        // 9.1%, which is what keeps them reading as events rather than as weather.
        const std::uint32_t rare = samosbor_variant_def(SamosborVariant::Maronary).weight +
                                   samosbor_variant_def(SamosborVariant::Istotit).weight +
                                   samosbor_variant_def(SamosborVariant::Veretar).weight;
        CHECK(rare == 11u);
        // Classic is the single heaviest row — and only just short of half the
        // pool at 60/121 = 49.6%, which is the measured number and NOT "more than
        // half". Worth pinning as an inequality over the other six rather than as
        // a majority, because a majority is what it looks like and is not.
        for (std::size_t i = 1; i < kSamosborVariantCount; ++i)
            CHECK(kSamosborVariants[i].weight <
                  kSamosborVariants[static_cast<std::size_t>(SamosborVariant::Classic)]
                      .weight);
        CHECK(static_cast<std::uint32_t>(
                  samosbor_variant_def(SamosborVariant::Classic).weight) * 2u < total);

        // Sampling reproduces the weights, and every variant is reachable. A silent
        // off-by-one in the cumulative scan would strand the last row at 0 draws.
        SamosborRng rng{1234u};
        std::uint32_t hits[kSamosborVariantCount] = {};
        constexpr int kDraws = 121000;
        for (int i = 0; i < kDraws; ++i)
            ++hits[static_cast<std::size_t>(samosbor_pick_variant(rng))];
        for (std::size_t i = 0; i < kSamosborVariantCount; ++i) {
            CHECK(hits[i] > 0);
            const double want = static_cast<double>(kSamosborVariants[i].weight) *
                                (static_cast<double>(kDraws) / total);
            const double got = static_cast<double>(hits[i]);
            CHECK(std::fabs(got - want) < want * 0.10);
        }

        // The weighted mean durationMult must stay near 1.0, or the variant roster
        // itself would bias the depth curve the whole system is built on.
        double weighted = 0.0;
        for (std::size_t i = 0; i < kSamosborVariantCount; ++i)
            weighted += static_cast<double>(kSamosborVariants[i].weight) *
                        (kSamosborVariants[i].durationMultX100 * 0.01);
        weighted /= static_cast<double>(total);
        CHECK(weighted > 0.99 && weighted < 1.03);   // 1.0147
    }

    { // ---- test_samosbor_depth_curve_is_monotonic ----
        // ---- the assertion that protects the design -------------------------
        // Duty cycle never decreases with depth. Walked past kFloorZSpan so the
        // saturation clamp is covered too.
        float prev = -1.0f;
        for (int z = 0; z <= kFloorZSpan + 12; ++z) {
            const float duty = samosbor_duty01(z);
            CHECK(duty >= prev);
            prev = duty;

            // Depth is BIDIRECTIONAL: the roof at +50 is exactly as hostile as the
            // basement at -50. Nothing here may assume descent means negative.
            CHECK(samosbor_duty01(-z) == duty);

            // The two lerps the duty cycle is made of, each monotone on its own.
            if (z > 0) {
                CHECK(samosbor_duration_mean_ms(z) >= samosbor_duration_mean_ms(z - 1));
                CHECK(samosbor_cooldown_mean_ms(z) <= samosbor_cooldown_mean_ms(z - 1));
                CHECK(samosbor_duration_mean_ms(-z) == samosbor_duration_mean_ms(z));
                CHECK(samosbor_cooldown_mean_ms(-z) == samosbor_cooldown_mean_ms(z));
            }
        }
        // Strictly increasing over the live band, not merely non-decreasing: a flat
        // stretch would be a floor range where descending buys nothing.
        for (int z = 0; z < kFloorZSpan; ++z)
            CHECK(samosbor_duty01(z + 1) > samosbor_duty01(z));

        // ---- the endpoints ---------------------------------------------------
        // 30 s of hazard per 30 min at the surface: 30 / 1830 = 1.64%.
        CHECK(samosbor_duration_mean_ms(0) == 30u * 1000u);
        CHECK(samosbor_cooldown_mean_ms(0) == 30u * 60u * 1000u);
        CHECK(samosbor_duty01(0) > 0.014f);
        CHECK(samosbor_duty01(0) < 0.025f);

        // 15 min of hazard per 16 min at |z| = 50: 900 / 960 = 93.75%. A deep floor
        // is almost continuously in samosbor, and that IS the descent pressure.
        CHECK(samosbor_duration_mean_ms(50) == 15u * 60u * 1000u);
        CHECK(samosbor_cooldown_mean_ms(50) == 60u * 1000u);
        CHECK(samosbor_duty01(50) > 0.85f);
        CHECK(samosbor_duty01(-50) > 0.85f);
        CHECK(std::fabs(samosbor_duty01(50) - 0.9375f) < 0.001f);

        // The midpoint, so a future edit cannot satisfy both endpoints with a step
        // function and call it a curve. |z| = 25 is 7 min 45 s per 23 min 15 s.
        CHECK(std::fabs(samosbor_duty01(25) - 0.3333f) < 0.005f);

        // Roughly a 57x spread between the ends. The gradient is the whole feature.
        CHECK(samosbor_duty01(50) / samosbor_duty01(0) > 40.0f);
    }

    { // ---- test_samosbor_samplers_realize_the_curve ----
        // samosbor_duty01() is a closed form. It is only worth anything if the
        // rng-driven samplers actually land on it — a jitter that was not mean-1
        // (or a variant multiplier applied twice) would make the analytic curve a
        // comfortable lie.
        const int zs[] = {0, 10, 25, 40, 50, -50};
        for (int z : zs) {
            SamosborRng rng{0xA5A5u + static_cast<std::uint32_t>(z * 7919)};
            double sumD = 0.0, sumC = 0.0;
            constexpr int kSamples = 20000;
            for (int i = 0; i < kSamples; ++i) {
                sumD += samosbor_duration_ms(z, SamosborVariant::Classic, rng);
                sumC += samosbor_cooldown_ms(z, rng);
            }
            const float sampled = static_cast<float>(sumD / (sumD + sumC));
            CHECK(std::fabs(sampled - samosbor_duty01(z)) < 0.01f);
        }

        // Every draw stays inside the documented bounds, both floors included.
        // Accumulated into one flag rather than one CHECK per draw: 20000 draws x
        // 7 variants x 2 bounds is 280k CHECKs for one bit of information, and
        // game_test is a suite other work waits on.
        SamosborRng rng{77u};
        bool durInBounds = true, cdInBounds = true;
        for (int i = 0; i < 20000; ++i) {
            for (std::size_t v = 0; v < kSamosborVariantCount; ++v) {
                const std::uint32_t d =
                    samosbor_duration_ms(0, static_cast<SamosborVariant>(v), rng);
                // 30 s * 1.25 * 1.15 = 43.1 s is the widest a surface roll can go.
                if (d < kSamosborDurationFloorMs || d > 44u * 1000u) durInBounds = false;
            }
            const std::uint32_t c50 = samosbor_cooldown_ms(50, rng);
            if (c50 < kSamosborCooldownFloorMs || c50 > 76u * 1000u)  // 60 s * 1.25
                cdInBounds = false;
        }
        CHECK(durInBounds);
        CHECK(cdInBounds);

        // The new-game timer is depth-independent 120..180 s (balance.md:102,
        // main.ts:3272) and every later gap comes off the curve instead.
        bool firstInBounds = true;
        std::uint32_t firstLo = 0xFFFFFFFFu, firstHi = 0;
        for (int i = 0; i < 5000; ++i) {
            const std::uint32_t first = samosbor_first_cooldown_ms(rng);
            if (first < kSamosborFirstTimerMinMs || first > kSamosborFirstTimerMaxMs)
                firstInBounds = false;
            firstLo = std::min(firstLo, first);
            firstHi = std::max(firstHi, first);
        }
        CHECK(firstInBounds);
        // And it actually spans the band rather than sitting on one endpoint.
        CHECK(firstLo < kSamosborFirstTimerMinMs + 2000u);
        CHECK(firstHi > kSamosborFirstTimerMaxMs - 2000u);

        // Variant durationMult actually reaches the duration. Meat (1.15) must
        // outlast maronary (0.82) on average by roughly 1.40x.
        double meat = 0.0, maronary = 0.0;
        for (int i = 0; i < 40000; ++i) {
            meat += samosbor_duration_ms(30, SamosborVariant::Meat, rng);
            maronary += samosbor_duration_ms(30, SamosborVariant::Maronary, rng);
        }
        const double ratio = meat / maronary;
        CHECK(ratio > 1.30 && ratio < 1.50);
    }

    { // ---- test_samosbor_state_machine ----
        SamosborRng rng{2026u};
        SamosborState st = samosbor_new_game(rng);
        CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
        CHECK(st.count == 0);
        CHECK(!samosbor_active(st));
        // Idle is the new-game timer minus the warning it ends with.
        CHECK(st.phaseMs >= kSamosborFirstTimerMinMs - kSamosborWarningMs);
        CHECK(st.phaseMs <= kSamosborFirstTimerMaxMs - kSamosborWarningMs);

        // Walk one full cycle at 16 ms and record the phase order and the dwell in
        // each phase. Deep floor, so the cycle is short enough to walk exactly.
        constexpr std::uint32_t kDt = 16;
        const int floorZ = -50;
        std::uint32_t dwell[static_cast<std::size_t>(SamosborPhase::Count)] = {};
        int warnings = 0, actives = 0, seals = 0, ends = 0, cycles = 0;
        std::uint8_t order[8] = {};
        int orderN = 0;
        order[orderN++] = st.phase;

        // Per-tick invariants accumulate into flags; one CHECK each after the walk.
        bool fromMatched = true, toMatched = true, changedMatched = true;
        bool orderFit = true;
        for (int i = 0; i < 400000 && cycles < 1; ++i) {
            const std::uint8_t before = st.phase;
            const SamosborTransition tr = samosbor_step(st, kDt, floorZ, rng);
            dwell[before] += kDt;
            if (tr.from != before) fromMatched = false;
            if (tr.to != st.phase) toMatched = false;
            if (tr.changed != (tr.steps != 0)) changedMatched = false;
            if (tr.warningBegan) ++warnings;
            if (tr.activeBegan) ++actives;
            if (tr.sealed) ++seals;
            if (tr.activeEnded) ++ends;
            if (tr.cycleEnded) ++cycles;
            if (tr.changed) {
                if (orderN < 8) order[orderN++] = st.phase;
                else orderFit = false;
            }
        }
        CHECK(fromMatched);
        CHECK(toMatched);
        CHECK(changedMatched);
        CHECK(orderFit);

        // Idle -> Warning -> Active -> Aftermath -> Idle, no phase skipped.
        CHECK(orderN == 5);
        CHECK(order[0] == static_cast<std::uint8_t>(SamosborPhase::Idle));
        CHECK(order[1] == static_cast<std::uint8_t>(SamosborPhase::Warning));
        CHECK(order[2] == static_cast<std::uint8_t>(SamosborPhase::Active));
        CHECK(order[3] == static_cast<std::uint8_t>(SamosborPhase::Aftermath));
        CHECK(order[4] == static_cast<std::uint8_t>(SamosborPhase::Idle));

        CHECK(warnings == 1);
        CHECK(actives == 1);
        CHECK(ends == 1);
        CHECK(cycles == 1);
        CHECK(st.count == 1);
        // ONE seal per cycle, not a per-tick drain. Model it as a DoT and a 15-minute
        // samosbor at |z| = 50 deals 3600 HP instead of 4.
        CHECK(seals == 1);

        // Phase durations are what the constants say, within one tick.
        const std::size_t iW = static_cast<std::size_t>(SamosborPhase::Warning);
        const std::size_t iA = static_cast<std::size_t>(SamosborPhase::Active);
        const std::size_t iF = static_cast<std::size_t>(SamosborPhase::Aftermath);
        CHECK(dwell[iW] >= kSamosborWarningMs);
        CHECK(dwell[iW] < kSamosborWarningMs + kDt * 2);
        CHECK(dwell[iF] >= kSamosborAftermathMs);
        CHECK(dwell[iF] < kSamosborAftermathMs + kDt * 2);
        // Active dwell must be inside the |z| = 50 band: 15 min * 0.75 * 0.82 up to
        // 15 min * 1.25 * 1.15.
        CHECK(dwell[iA] > 550u * 1000u);
        CHECK(dwell[iA] < 1300u * 1000u);

        // A step that crosses no boundary reports nothing, so a caller can early-out
        // on !changed instead of diffing the phase itself.
        const SamosborTransition quiet = samosbor_step(st, kDt, floorZ, rng);
        CHECK(!quiet.changed);
        CHECK(quiet.steps == 0);
        CHECK(!quiet.warningBegan && !quiet.activeBegan && !quiet.sealed);
        CHECK(!quiet.activeEnded && !quiet.cycleEnded);
        CHECK(quiet.from == quiet.to);

        // dt == 0 is a no-op, not a transition. (A paused frame must not advance the
        // hazard clock.)
        const std::uint32_t before = st.phaseMs;
        const SamosborTransition zero = samosbor_step(st, 0, floorZ, rng);
        CHECK(!zero.changed);
        CHECK(st.phaseMs == before);

        // phase01 fills 0 -> 1 and never overshoots.
        CHECK(samosbor_phase01(st) >= 0.0f && samosbor_phase01(st) <= 1.0f);

        // A single huge dt is bounded, does not spin, and does not silently run
        // several samosbors. Four crossings is one cycle.
        SamosborState big;
        samosbor_arm(big, 60u * 1000u);
        const SamosborTransition jump = samosbor_step(big, 24u * 60u * 60u * 1000u, 50, rng);
        CHECK(jump.steps <= 4);
        CHECK(big.count <= 1);
        CHECK(big.phase < static_cast<std::uint8_t>(SamosborPhase::Count));

        // The seal moment carries the variant's shift: electric seals 14 s out,
        // maronary 8 s, classic 10 s.
        CHECK(samosbor_seal_before_end_ms(SamosborVariant::Classic) == 10u * 1000u);
        CHECK(samosbor_seal_before_end_ms(SamosborVariant::Electric) == 14u * 1000u);
        CHECK(samosbor_seal_before_end_ms(SamosborVariant::Maronary) == 8u * 1000u);
    }

    { // ---- test_samosbor_duty_cycle_end_to_end ----
        // The strongest form of the depth claim: run the real state machine for 24
        // simulated hours and measure the wall-clock fraction actually spent Active.
        // This goes through variant selection, jitter, the warning carve-out and the
        // aftermath accounting, so it catches the class of bug the pure-function test
        // cannot — e.g. an aftermath added on top of the cooldown instead of carved
        // out of it, which stretches every gap and biases the duty cycle down.
        struct Case { int z; float lo; float hi; };
        const Case cases[] = {
            {  0, 0.010f, 0.030f},   // ~1.6%: 30 s per 30 min
            { 25, 0.28f,  0.39f},    // ~33.3%
            { 50, 0.85f,  0.97f},    // ~93.8%: 15 min per 16 min
            {-50, 0.85f,  0.97f},    // the roof is the basement
        };
        for (const Case& c : cases) {
            SamosborRng rng{0xC0FFEEu ^ static_cast<std::uint32_t>(c.z * 131071)};
            SamosborState st;
            samosbor_arm(st, samosbor_cooldown_mean_ms(c.z));
            // 200 ms ticks over 24 simulated hours. Coarser than a frame on
            // purpose: 24 h is what makes even the 30.5-minute surface cycle
            // repeat ~47 times, and the granularity error (200 ms on a 30 s active
            // phase, 0.7%) is an order of magnitude inside the tolerances below.
            constexpr std::uint32_t kDt = 200;
            constexpr std::uint64_t kTicks = 24ull * 60ull * 60ull * 1000ull / kDt;
            std::uint64_t activeTicks = 0;
            for (std::uint64_t i = 0; i < kTicks; ++i) {
                samosbor_step(st, kDt, c.z, rng);
                if (samosbor_active(st)) ++activeTicks;
            }
            const float duty = static_cast<float>(activeTicks) /
                               static_cast<float>(kTicks);
            CHECK(duty > c.lo);
            CHECK(duty < c.hi);
            // And it lands on what the closed form predicted.
            CHECK(std::fabs(duty - samosbor_duty01(c.z)) < 0.05f);
            // A completed cycle is progression, and a deep floor grinds through many
            // more of them per hour than a shallow one.
            CHECK(st.count > 0);
        }
    }

    { // ---- test_samosbor_threat_backoff ----
        // The rule the reference specified in prose (balance.md:510, "должен") and
        // never shipped: its only spawn gates are a global 4096-actor soft cap and a
        // one-cell occupancy check, neither of which is a local density budget.
        //
        // Why it has to exist: at |z| = 50 a floor is Active ~94% of the time, so the
        // fog spawn tick effectively never stops. Without a local back-off it fills
        // the whole 40 m bubble around the player and the frame budget dies — the
        // failure is a floor that cannot be entered, not a floor that is too hard.

        // Normal ceiling: 6 in the outer radius still spawns, 7 backs off.
        CHECK(samosbor_fog_spawn_allowed(ThreatCensus{0, 6, 0}, false));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{0, 7, 0}, false));

        // The rare spike is exactly the high-risk lift of that gate: 8..10.
        CHECK(samosbor_fog_spawn_allowed(ThreatCensus{0, 7, 0}, true));
        CHECK(samosbor_fog_spawn_allowed(ThreatCensus{0, 9, 0}, true));

        // The hard maximum ignores highRisk. There is no floor hostile enough.
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{0, 10, 0}, true));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{0, 10, 0}, false));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{0, 30, 0}, true));

        // Local crowding backs off regardless of the outer count or the floor: 4
        // inside 24 m means you are surrounded, and a fifth is not a fight.
        CHECK(samosbor_fog_spawn_allowed(ThreatCensus{3, 3, 0}, false));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{4, 4, 0}, true));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{4, 9, 0}, true));

        // Line-of-fire gate. Dormant until a caller fills withLos (samosbor_census
        // cannot — see the header), but the predicate honours it today so the day it
        // is filled nothing else has to change.
        CHECK(samosbor_fog_spawn_allowed(ThreatCensus{2, 5, 2}, false));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{2, 5, 3}, false));
        CHECK(!samosbor_fog_spawn_allowed(ThreatCensus{2, 5, 3}, true));

        // ---- the failure mode, driven to saturation --------------------------
        // Spawn while allowed and never re-examine anything else. This is what an
        // unguarded fog tick does on a deep floor, and the population must bound.
        {
            ThreatCensus c;
            int spawned = 0;
            for (int tick = 0; tick < 100000; ++tick) {
                if (!samosbor_fog_spawn_allowed(c, true)) continue;
                ++spawned;
                if (c.withinOuter < 0xFFu) ++c.withinOuter;
            }
            CHECK(c.withinOuter == kThreatHardMaxOuter);
            CHECK(spawned == kThreatHardMaxOuter);
        }
        {
            // Same, on an ordinary floor: it settles at the normal ceiling.
            ThreatCensus c;
            for (int tick = 0; tick < 100000; ++tick)
                if (samosbor_fog_spawn_allowed(c, false)) ++c.withinOuter;
            CHECK(c.withinOuter == kThreatBackoffOuter);
            CHECK(c.withinOuter <= kThreatPressureMax);
        }
        {
            // Spawns landing close in settle on the near gate first, which is the
            // point: the outer budget must not be spendable all in one room.
            ThreatCensus c;
            for (int tick = 0; tick < 100000; ++tick)
                if (samosbor_fog_spawn_allowed(c, true)) { ++c.withinNear; ++c.withinOuter; }
            CHECK(c.withinNear == kThreatBackoffNear);
            CHECK(c.withinOuter == kThreatBackoffNear);
            CHECK(c.withinOuter < kThreatHardMaxOuter);
        }

        // Headroom agrees with the predicate and saturates at 0 rather than wrapping
        // (it is unsigned; an underflow here would read as 255 free slots).
        CHECK(samosbor_threat_headroom(ThreatCensus{0, 0, 0}, false) == kThreatBackoffNear);
        CHECK(samosbor_threat_headroom(ThreatCensus{0, 6, 0}, false) == 1);
        CHECK(samosbor_threat_headroom(ThreatCensus{0, 7, 0}, false) == 0);
        CHECK(samosbor_threat_headroom(ThreatCensus{3, 3, 0}, false) == 1);
        CHECK(samosbor_threat_headroom(ThreatCensus{4, 4, 0}, true) == 0);
        CHECK(samosbor_threat_headroom(ThreatCensus{0, 30, 0}, true) == 0);
        for (std::uint8_t n = 0; n <= 20; ++n) {
            const ThreatCensus c{static_cast<std::uint8_t>(n > 6 ? 6 : n), n, 0};
            const bool ok = samosbor_fog_spawn_allowed(c, true);
            CHECK(ok == (samosbor_threat_headroom(c, true) > 0));
        }

        // ---- the target band -------------------------------------------------
        // Normal near-player pressure 3..7, rising with depth; the spike band only
        // on a high-risk floor.
        CHECK(samosbor_threat_target(0, SamosborVariant::Classic, false) == 3);
        CHECK(samosbor_threat_target(50, SamosborVariant::Classic, false) == 7);
        CHECK(samosbor_threat_target(-50, SamosborVariant::Classic, false) == 7);
        for (int z = 0; z <= kFloorZSpan; ++z) {
            const std::uint8_t t = samosbor_threat_target(z, SamosborVariant::Classic, false);
            CHECK(t >= kThreatPressureMin && t <= kThreatPressureMax);
            if (z > 0)
                CHECK(t >= samosbor_threat_target(z - 1, SamosborVariant::Classic, false));
        }
        // Never 0 and never above the spike cap, for every variant and depth.
        for (std::size_t v = 0; v < kSamosborVariantCount; ++v)
            for (int z = -60; z <= 60; ++z)
                for (int hr = 0; hr < 2; ++hr) {
                    const std::uint8_t t = samosbor_threat_target(
                        z, static_cast<SamosborVariant>(v), hr != 0);
                    CHECK(t >= 1 && t <= kThreatSpikeMax);
                }
        // spawnMult separates a loud variant from a quiet one. Istotit (0.52)
        // deliberately dips below the authored 3 floor — a quiet variant that
        // "creates, heals and marks shelters" is the design, not a clamp bug.
        CHECK(samosbor_threat_target(50, SamosborVariant::Meat, true) >
              samosbor_threat_target(50, SamosborVariant::Istotit, true));
        CHECK(samosbor_threat_target(0, SamosborVariant::Istotit, false) <
              kThreatPressureMin);
    }

    { // ---- test_samosbor_census_and_kind_gate ----
        // The census is what feeds the back-off, and it has to be toroidal: a mob 2 m
        // away across the wrap seam is 2 m away, not kWorldExtent - 2. Getting that
        // wrong disables the back-off near a boundary, which is where a corridor
        // meets the seam.
        Registry reg;
        const LayerId layer = 0;
        const vec3 origin{1.0f, 1.0f, 1.0f};

        auto add_mob = [&](vec3 pos, LayerId l) {
            Entity e = reg.create();
            Transform tr;
            tr.pos = pos;
            tr.layer = l;
            reg.emplace<Transform>(e, tr);
            reg.emplace<MobRef>(e, MobRef{0, 1, 10, 10});
            return e;
        };

        CHECK(samosbor_census(reg, layer, origin).withinOuter == 0);

        add_mob(vec3{2.0f, 1.0f, 1.0f}, layer);                 // 1 m: near
        add_mob(vec3{1.0f, 1.0f + 30.0f, 1.0f}, layer);          // 30 m: outer only
        add_mob(vec3{1.0f, 1.0f + 60.0f, 1.0f}, layer);          // 60 m: neither
        // Across the seam: x = kWorldExtent - 1 is 2 m from x = 1 on a torus.
        add_mob(vec3{kWorldExtent - 1.0f, 1.0f, 1.0f}, layer);
        // A different layer never counts, however close it is.
        add_mob(vec3{1.0f, 1.0f, 1.0f}, static_cast<LayerId>(layer + 1));

        const ThreatCensus c = samosbor_census(reg, layer, origin);
        CHECK(c.withinNear == 2);     // the 1 m mob and the seam-crossing one
        CHECK(c.withinOuter == 3);    // plus the 30 m one
        CHECK(c.withLos == 0);        // documented hole: no line-of-fire query yet
        // The invariant the predicate depends on.
        CHECK(c.withinOuter >= c.withinNear);
        CHECK(c.withLos <= c.withinOuter);

        // Radii are authored in cells and a cell is 2 m, so 12/20 cells are 24/40 m.
        // static_assert, not CHECK: these are facts about the constants, so they
        // belong to the build rather than to a test run (same call as
        // test_inventory's kInvSlots assert).
        static_assert(kThreatNearRadiusM == 24.0f);
        static_assert(kThreatOuterRadiusM == 40.0f);
        static_assert(kSamosborFogRadiusM == 8.0f);

        // ---- the join with the existing mob table ---------------------------
        // MobDef::minSamosbor is a HARD gate, not a weight nudge: surviving
        // samosbors is what unlocks the deeper roster, so SamosborState::count is a
        // progression axis.
        MobDef early{};
        early.minSamosbor = 0;
        MobDef third{};
        third.minSamosbor = 3;
        MobDef never{};
        never.minSamosbor = 99;

        CHECK(samosbor_allows_kind(early, 0));
        CHECK(!samosbor_allows_kind(third, 0));
        CHECK(!samosbor_allows_kind(third, 2));
        CHECK(samosbor_allows_kind(third, 3));
        CHECK(samosbor_allows_kind(third, 40));
        CHECK(!samosbor_allows_kind(never, 50));
        CHECK(!samosbor_allows_kind(never, 98));

        // The measured shape of the real table, pinned because it is a content
        // TRAP and not a nice property: exactly ONE of the 69 kinds is spawnable
        // at count 0. Use this predicate as a floor's only roster filter on a
        // fresh floor and the roster collapses from 69 kinds to one — which is
        // why the reference defaults an absent count to 1 instead of 0
        // (data/monster_ecology.ts:1891). If a future data pass moves these
        // counts, this check fails and someone reads the note on
        // samosbor_allows_kind before wiring it into spawn_floor_mobs.
        int fromStart = 0, gated = 0, sentinel = 0;
        for (std::size_t i = 0; i < kMobKindCount; ++i) {
            const MobDef& d = kMobTable[i];
            if (d.minSamosbor == 99) { ++sentinel; continue; }
            if (samosbor_allows_kind(d, 0)) ++fromStart;
            else ++gated;
        }
        CHECK(fromStart == 1);
        CHECK(gated == 66);
        CHECK(sentinel == 1);
        CHECK(fromStart + gated + sentinel == static_cast<int>(kMobKindCount));

        // At an effective count of 1 — the reference's default — the roster opens
        // up to a usable width, which is the evidence that the workaround above
        // is the right one rather than a hack.
        int atOne = 0;
        for (std::size_t i = 0; i < kMobKindCount; ++i)
            if (kMobTable[i].minSamosbor != 99 && samosbor_allows_kind(kMobTable[i], 1))
                ++atOne;
        CHECK(atOne == 14);

        // Every kind except the 99 sentinel is reachable eventually, so no row is
        // dead content.
        int everReachable = 0;
        for (std::size_t i = 0; i < kMobKindCount; ++i)
            if (samosbor_allows_kind(kMobTable[i], 98)) ++everReachable;
        CHECK(everReachable == 67);
    }

    { // ---- test_samosbor_unsheltered_pressure ----
        const SamosborPressure p = samosbor_unsheltered_pressure(SamosborVariant::Classic);
        CHECK(p.fogRadiusCells == 4);
        CHECK(p.fogStrength == 155);
        CHECK(p.hpDamage == 4);
        // PSI is carried, NOT applied: DamageChannel::Psi exists in combat.h as a
        // mitigation channel but there is no PSI resource in the tree to drain. The
        // number lives here so it lives in exactly one place the day a pool lands;
        // routing it through apply_damage as HP would double the HP cost and hide
        // the hole.
        CHECK(p.psiDamage == 3);

        // Same for every variant today, and the header says why the parameter exists
        // anyway (the reference's fog seed is per-variant via fogSeedMult).
        for (std::size_t v = 0; v < kSamosborVariantCount; ++v) {
            const SamosborPressure q =
                samosbor_unsheltered_pressure(static_cast<SamosborVariant>(v));
            CHECK(q.hpDamage == p.hpDamage && q.psiDamage == p.psiDamage);
        }

        // The structural relationship between the phase constants. Warning plus
        // aftermath plus a breath of idle must fit inside the shortest cooldown the
        // curve can ever produce, or the machine would have to overlap phases.
        // Compile-time facts, so they are asserted at compile time.
        static_assert(kSamosborCooldownFloorMs ==
                      kSamosborWarningMs + kSamosborAftermathMs + kSamosborMinIdleMs);
        static_assert(kSamosborCooldownAtDepthMs >= kSamosborCooldownFloorMs);
        // 30 s, not balance.md's stale 18 — see the provenance note in samosbor.h.
        static_assert(kSamosborWarningMs == 30u * 1000u);
    }
}
