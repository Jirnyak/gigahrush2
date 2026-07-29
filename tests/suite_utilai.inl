// Utility AI — the arbitration suite.
//
// This suite exists for ONE reason, and it is not "does the scorer add up". It is
// that main already has systems which write `Velocity`, so switching a utility AI
// on without settling ownership makes two systems fight over the same body every
// tick and the crowd jitters — a bug that reads as broken physics and is not.
// The parked branch driver (`tools/branch_port_pending/ai.cpp`) was exactly that
// second writer. So the load-bearing blocks here are:
//
//   Block 4 — SINGLE WRITER. A per-tick sentinel probe measures, per body,
//             whether `ai_step` wrote it and whether `wander_step` wrote it, and
//             asserts the two sets never intersect. Both counts are also asserted
//             NON-ZERO, because "no double write" is vacuous if one of the two
//             systems never wrote anything.
//   Block 5 — THE GUARD, from both sides. Force every body Ai-owned and prove
//             wander writes none; force every body Wander-owned and prove wander
//             writes them. This is what pins the one-line guard in wander.cpp.
//   Block 3 — HYSTERESIS, measured. Intent switches per 100 re-plans with the
//             hysteresis on and off, printed as real numbers. A utility AI
//             without hysteresis thrashes, and a thrash you cannot count is not a
//             claim.
//
// !! Block 5 (and therefore Block 4) FAILS UNTIL the guard lands in
// !! src/game/wander.cpp:
// !!     if (ai_owns_motion(reg, e)) continue;   // [ai.h] single-writer rule
// !! placed with the other per-entity exclusions in `wander_step` — immediately
// !! after its `if (reg.all_of<CameraTag>(e)) continue;` line, and wander.cpp also
// !! needs `#include "game/ai.h"`. Measured on this tree: without the guard this
// !! suite is 1005 checks / 3 fails and reports 300 double-writes over 200 ticks;
// !! with it, 1005 / 0 and 0 double-writes. That failure is the point: the guard IS
// !! the mechanism, so a suite that passed without it would be measuring nothing.
//
// WHAT THIS SUITE DOES **NOT** PROVE, so nobody reads the pass as broader than it
// is. The disjointness above covers `ai_step` and `wander_step` only.
// `investigate_step` is out of scope by TYPE (it views `const MobRef`, and this
// system refuses MobRef bodies) — a static argument, not a measurement.
// `faction_feud_step` is a DIFFERENT matter: it is wired in main.cpp, it views
// <Transform, Velocity, const NpcRef> and writes Velocity, and it has no guard. It
// is not driven here, so this suite is silent about it. See [ai.h] "STATE OF THAT
// RULE" — that is a second one-line guard, still owed.
//
// A .inl and not a .cpp for the reason suite_samosbor.inl states: game_test owns
// the CHECK macro, so the include has to land after it, and the suite carries its
// own #include of the system under test to keep that diff two lines.

#include "game/ai.h"
#include "game/needs.h"   // needs_roll — NOT reachable from game_test.cpp's prelude
#include "game/wander.h"  // wander_init / wander_step / kWanderPeriod
#include "sim/diffusion.h"
#include "world/field.h"
#include "world/nav.h"

namespace utilai {

// ---------------------------------------------------------------------------
// The arena.
//
// A bare MacroGrid + a hand-written node-0 flow slice, the way
// suite_behaviours.inl does it: a full `World` is ~138 MiB and a real
// `bake_fine` is 128 MiB and seconds of BFS, and neither buys anything here —
// `wander_step` reads one flow byte and `ai_step` reads a float field and a
// wall test. Everything below shares ONE arena.
// ---------------------------------------------------------------------------

// The sentinel. Neither steerer can produce it: `wander_step` writes 0 or
// dir*speed, `ai_step` writes dir*kFleeSpeed. So "x still equals kSentX" is an
// exact, not statistical, answer to "did anybody write this body".
constexpr float kSentX = 777.0f;
constexpr float kSentY = -777.0f;

inline bool is_sentinel(const Velocity& v) {
    return v.v.x == kSentX && v.v.y == kSentY;
}

// Layer under test. A bare id: nothing here pushes a LevelStack layer, because
// neither system reads the stack — `Transform::layer` is only ever compared.
constexpr LayerId kLayer = 0;

// Put an embodied NPC record on the floor at a macro cell centre.
inline Entity make_body(Registry& reg, NpcPool& pool, int cx, int cy, int cz,
                        Faction f, NpcId& outId) {
    const NpcId id = pool.spawn();
    pool.faction(id) = static_cast<std::uint16_t>(f);
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    const Entity e = embody(reg, pool, id, kLayer);
    reg.get<Transform>(e).pos =
        vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
             (static_cast<float>(cy) + 0.5f) * kCellSize,
             (static_cast<float>(cz) + 0.5f) * kCellSize};
    outId = id;
    return e;
}

// A node-0 flow slice that says "+x" in every cell, so `wander_step` takes its
// common horizontal-step branch and writes a NON-ZERO velocity. Only node 0 is
// needed: a zeroed CoarseGraph makes `coarse_next` return 0 for every pair, so
// the hop every body reads is always node 0 (the same trick suite_behaviours.inl
// documents).
inline void fill_flow_plus_x(nav::FineNav& fine) {
    fine.flow.assign(kMacroCells, static_cast<std::uint8_t>(1)); // kNavDir[1] = +x
}

// Snapshot every body's Velocity to the sentinel.
inline void arm_sentinels(Registry& reg, const std::vector<Entity>& bodies) {
    for (Entity e : bodies) reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
}

} // namespace utilai

static void test_utilai_all() {
    using namespace utilai;

    // ======================================================================
    // 1. The scorer is pure, and the ranking responds to the inputs that are
    //    actually live (needs + danger), not to the stubbed ones.
    // ======================================================================
    {
        Needs fresh = needs_roll(12345u);
        CHECK(fresh.seeded != 0);

        Perception p;
        p.idSeed = identity_seed(7u);
        p.faction = static_cast<std::uint16_t>(Faction::Citizens);
        p.hp = 100.0f;
        p.maxHp = 100.0f;
        p.danger = 0.0f;

        float a[kIntentCount];
        float b[kIntentCount];
        score_intents(p, fresh, a);
        score_intents(p, fresh, b);
        // Purity: same inputs, same output, bit for bit. No stored RNG, no clock.
        for (int i = 0; i < kIntentCount; ++i) CHECK(a[i] == b[i]);

        // Every score is inside the band the reference clamps to.
        for (int i = 0; i < kIntentCount; ++i) {
            CHECK(a[i] >= 0.0f);
            CHECK(a[i] <= 100.0f);
        }

        // A calm, healthy, fresh-needs citizen does NOT flee, and does not pick a
        // survival intent at all. This is the "stubbed inputs contribute 0"
        // invariant stated as behaviour: with no threat and no unmet need, the
        // ranking is decided by faction traits alone.
        const std::uint8_t calm = select_intent_raw(a);
        CHECK(calm != IntentFlee);
        CHECK(calm != IntentSafety);
        CHECK(calm != IntentHeal);   // hp == maxHp -> healthPressure 0

        // Turn the one live threat channel up and flee must overtake it. Nothing
        // else changed, so this isolates the diffusion field's contribution.
        p.danger = 100.0f;
        float hot[kIntentCount];
        score_intents(p, fresh, hot);
        CHECK(hot[IntentFlee] > a[IntentFlee]);
        CHECK(select_intent_raw(hot) == IntentFlee);

        // A zeroed (never-seeded) Needs row reads as total crisis. This is exactly
        // the trap ai.cpp's `needs_for` substitution exists to avoid, and pinning
        // it here means a future change that drops the substitution shows up as a
        // crowd that eats forever rather than as a silent behaviour shift.
        Needs unseeded{};
        CHECK(unseeded.seeded == 0);
        float starving[kIntentCount];
        p.danger = 0.0f;
        score_intents(p, unseeded, starving);
        const std::uint8_t crisis = select_intent_raw(starving);
        CHECK(crisis == IntentDrink || crisis == IntentEat);
        CHECK(starving[IntentDrink] > a[IntentDrink]);
    }

    // ======================================================================
    // 2. select_intent's hysteresis, as an algebraic contract on 13 numbers.
    // ======================================================================
    {
        float s[kIntentCount];
        for (int i = 0; i < kIntentCount; ++i) s[i] = 0.0f;

        // No valid incumbent -> raw argmax.
        s[IntentWork] = 30.0f;
        CHECK(select_intent(s, kIntentNone) == IntentWork);

        // A challenger inside the margin does NOT take over.
        s[IntentSocial] = 30.0f + kSwitchMargin - 0.5f;
        CHECK(select_intent(s, IntentWork) == IntentWork);
        // Strictly past the margin, it does.
        s[IntentSocial] = 30.0f + kSwitchMargin + 0.5f;
        CHECK(select_intent(s, IntentWork) == IntentSocial);

        // An emergency intent BELOW the emergency score still needs the margin.
        for (int i = 0; i < kIntentCount; ++i) s[i] = 0.0f;
        s[IntentWork] = 55.0f;
        s[IntentFlee] = kEmergencyScore - 1.0f;    // 57: highest, but not emergency
        CHECK(s[IntentFlee] > s[IntentWork]);
        CHECK(s[IntentFlee] <= s[IntentWork] + kSwitchMargin);
        CHECK(select_intent(s, IntentWork) == IntentWork);
        // At or above it, it preempts immediately, margin or no margin.
        s[IntentFlee] = kEmergencyScore;
        CHECK(select_intent(s, IntentWork) == IntentFlee);
        CHECK(intent_is_emergency(IntentFlee));
        CHECK(!intent_is_emergency(IntentWork));

        // A NON-emergency intent at the same score does not get the shortcut.
        for (int i = 0; i < kIntentCount; ++i) s[i] = 0.0f;
        s[IntentWork] = 55.0f;
        s[IntentSocial] = kEmergencyScore;
        CHECK(select_intent(s, IntentWork) == IntentWork);

        // Ties favour the lower index, which is why the enum order is frozen.
        for (int i = 0; i < kIntentCount; ++i) s[i] = 42.0f;
        CHECK(select_intent_raw(s) == 0);

        // The stickiness curve's stated band.
        CHECK(stickiness_amount(0.0f) == kStickBase);
        CHECK(stickiness_amount(1000.0f) == kStickBase + kStickCap);
        CHECK(stickiness_amount(10.0f) > stickiness_amount(1.0f));
    }

    // ======================================================================
    // 3. HYSTERESIS, MEASURED: intent switches per 100 re-plans, on vs off.
    //
    //    The cadence is forced to 0 s so every tick is a re-plan — at the
    //    shipping [1.5, 4.0] s cadence, 100 ticks (0.8 s at kSimHz) would hold at
    //    most ONE re-plan and the measurement could not distinguish anything.
    //    So the number below is honestly "switches per 100 RE-PLANS", and the
    //    print says so.
    //
    //    The oscillation is the danger field, flipped every tick between two
    //    values chosen to straddle the work/flee ranking boundary for a Citizen
    //    with fresh needs (crossover at threat ~= 0.101; the two values sit at
    //    0.02 and 0.25, so the raw ranking flips by a margin that clears the
    //    +/-2.5 identity jitter on every id). The field is flat, so its GRADIENT
    //    is zero and nobody takes motion ownership — this block measures the
    //    brain's mind, not its steering.
    // ======================================================================
    std::uint32_t switchesOn = 0;
    std::uint32_t switchesOff = 0;
    {
        constexpr int kBodies = 8;
        constexpr int kTicks = 100;
        constexpr float kCalmDanger = 2.0f;  // threat 0.02 -> work leads
        constexpr float kScaryDanger = 25.0f; // threat 0.25 -> flee leads

        MacroGrid grid;              // all air; only the gradient's wall test reads it
        Field<float> danger(0.0f);

        for (int arm = 0; arm < 2; ++arm) {
            const bool hyst = (arm == 0);

            Registry reg;
            NpcPool pool;
            pool.init();

            std::vector<Entity> bodies;
            for (int i = 0; i < kBodies; ++i) {
                NpcId id = 0;
                bodies.push_back(
                    make_body(reg, pool, 20 + i, 20, 1, Faction::Citizens, id));
            }
            CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(kBodies));

            AiConfig cfg;
            cfg.enabled = true;
            cfg.hysteresis = hyst;
            cfg.rethinkBaseSec = 0.0f;   // re-plan every tick
            cfg.rethinkSpreadSec = 0.0f;

            double now = 0.0;
            std::uint32_t replans = 0;
            for (int t = 0; t < kTicks; ++t) {
                danger.fill((t % 2) == 0 ? kCalmDanger : kScaryDanger);
                const AiTick tick =
                    ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
                CHECK(tick.considered == static_cast<std::uint32_t>(kBodies));
                replans += tick.replanned;
                now += static_cast<double>(kSimDt);
            }
            // Every body re-planned on every tick, so "per 100 ticks" and "per
            // 100 re-plans" are the same number here. Asserted, not assumed: a
            // cadence that quietly stopped firing would make a switch count of 0
            // look like perfect hysteresis.
            CHECK(replans == static_cast<std::uint32_t>(kBodies * kTicks));

            std::uint32_t total = 0;
            for (Entity e : bodies) total += reg.get<AiBrain>(e).switches;
            if (hyst) switchesOn = total; else switchesOff = total;

            // Nobody owns motion: the field is flat, so there is no gradient to
            // flee down and every body delegates. Proven here so block 4's
            // non-zero ai-write count cannot be explained by this block.
            for (Entity e : bodies)
                CHECK(reg.get<AiBrain>(e).motion ==
                      static_cast<std::uint8_t>(MotionOwner::Wander));
        }

        std::fprintf(stdout,
                     "[utilai] intent switches over %d re-plans (%d bodies x %d "
                     "ticks): hysteresis ON = %u, OFF = %u\n",
                     kBodies * kTicks, kBodies, kTicks, switchesOn, switchesOff);
        std::fprintf(stdout,
                     "[utilai] per 100 re-plans per body: ON = %.1f, OFF = %.1f\n",
                     100.0 * static_cast<double>(switchesOn) /
                         static_cast<double>(kBodies * kTicks),
                     100.0 * static_cast<double>(switchesOff) /
                         static_cast<double>(kBodies * kTicks));

        // The claim, stated as an assertion rather than as a print. Without
        // hysteresis the committed intent follows the oscillation and flips on
        // essentially every re-plan; with it, the incumbent's stickiness plus the
        // switch margin holds it, and flee never reaches the emergency score that
        // would bypass them.
        CHECK(switchesOff >= static_cast<std::uint32_t>(kBodies * (kTicks - 20)));
        CHECK(switchesOn <= static_cast<std::uint32_t>(kBodies));
        CHECK(switchesOff > switchesOn * 10u + 10u);
    }

    // ======================================================================
    // 4 + 5. SINGLE WRITER, and the guard that makes it true.
    //
    // Arena: danger is FLAT ZERO for x < 64 (no threat, no gradient -> work wins
    // -> wander owns) and a RAMP for x >= 64 (real threat AND a real gradient ->
    // flee wins -> ai owns). Group A stands in the calm half, group B in the
    // ramp, so both ownerships are exercised in the same tick by the same call.
    //
    // The probe, each tick, in the SHIPPING order (ai_step before wander_step,
    // which is a contract and not a preference — see ai.h):
    //     arm sentinels -> ai_step   -> record who moved  (aiWrote)
    //     arm sentinels -> wander_step -> record who moved (wanderWrote)
    //     assert no body is in both sets
    // Re-arming between the two calls is sound because NEITHER system reads
    // Velocity to decide anything: wander reads Transform/WanderTarget/the flow
    // byte, ai reads AiBrain/the pool row/the danger field. Overwriting the
    // component between them cannot change either decision, and it makes each
    // system's write individually observable instead of hidden behind the other's.
    // ======================================================================
    {
        constexpr int kGroup = 12;   // bodies per group
        constexpr int kTicks = 200;  // >> kWanderPeriod, so every body is visited

        MacroGrid grid;   // all air
        Field<float> danger(0.0f);
        for (int x = 64; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>((x - 63) * 4);

        nav::CoarseGraph coarse{};   // next[i][j] == 0 for every pair -> hop 0
        nav::FineNav fine;
        fill_flow_plus_x(fine);
        CHECK(!fine.flow.empty());              // or wander_step returns at once
        CHECK(nav::coarse_next(coarse, 17, 42) == 0);
        CHECK(nav::kNavDir[1][2] == 0);         // +x really is a horizontal step

        Registry reg;
        NpcPool pool;
        pool.init();

        std::vector<Entity> groupA;   // calm half: wander must own these
        std::vector<Entity> groupB;   // ramp half: ai must own these
        std::vector<Entity> all;
        for (int i = 0; i < kGroup; ++i) {
            NpcId id = 0;
            groupA.push_back(
                make_body(reg, pool, 20 + i, 30, 1, Faction::Citizens, id));
            groupB.push_back(
                make_body(reg, pool, 70 + i, 30, 1, Faction::Citizens, id));
        }
        for (Entity e : groupA) all.push_back(e);
        for (Entity e : groupB) all.push_back(e);

        // The field really does carry a usable gradient where group B stands, and
        // really does not where group A stands. Asserted so an ownership result
        // can never be blamed on a dead field.
        const vec3 gB = diffusion_gradient(danger, grid, 70, 30, 1);
        const vec3 gA = diffusion_gradient(danger, grid, 20, 30, 1);
        CHECK(gB.x * gB.x + gB.y * gB.y > kMinFleeGrad2);
        CHECK(gA.x * gA.x + gA.y * gA.y <= kMinFleeGrad2);

        CHECK(wander_init(reg, kLayer, 0x51ee7u) ==
              static_cast<std::uint32_t>(2 * kGroup));
        CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(2 * kGroup));

        AiConfig cfg;
        cfg.enabled = true;   // hysteresis left ON: this is the shipping config

        std::uint32_t aiWrites = 0, wanderWrites = 0, doubleWrites = 0;
        std::uint32_t wanderWroteAiOwned = 0;   // the guard violation counter
        std::uint32_t aiWroteWanderOwned = 0;
        std::uint32_t aOwnedByAi = 0, bOwnedByWander = 0;

        std::vector<bool> aiWrote(all.size(), false);
        double now = 0.0;
        for (int t = 0; t < kTicks; ++t) {
            arm_sentinels(reg, all);
            const AiTick tick =
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
            CHECK(tick.considered == static_cast<std::uint32_t>(2 * kGroup));
            CHECK(tick.aiOwned + tick.wanderOwned == tick.considered);

            for (std::size_t i = 0; i < all.size(); ++i) {
                aiWrote[i] = !is_sentinel(reg.get<Velocity>(all[i]));
                if (aiWrote[i]) ++aiWrites;
                // A write must match the token the same call published. Checked
                // both ways, because "ai wrote a body it said wander owned" is
                // just as much a broken contract as the reverse.
                const bool owned = ai_owns_motion(reg, all[i]);
                if (aiWrote[i] && !owned) ++aiWroteWanderOwned;
            }

            arm_sentinels(reg, all);
            wander_step(reg, grid, pool, coarse, fine, kLayer,
                        static_cast<std::uint64_t>(t));

            for (std::size_t i = 0; i < all.size(); ++i) {
                const bool w = !is_sentinel(reg.get<Velocity>(all[i]));
                if (w) ++wanderWrites;
                if (w && aiWrote[i]) ++doubleWrites;
                if (w && ai_owns_motion(reg, all[i])) ++wanderWroteAiOwned;
            }

            // Ownership must be stable per group across the whole run: the danger
            // field never changes, so a body that flips group is a bug in the
            // arbitration, not noise.
            for (Entity e : groupA)
                if (ai_owns_motion(reg, e)) ++aOwnedByAi;
            for (Entity e : groupB)
                if (!ai_owns_motion(reg, e)) ++bOwnedByWander;

            now += static_cast<double>(kSimDt);
        }

        std::fprintf(stdout,
                     "[utilai] %d ticks x %d bodies: ai_step wrote Velocity %u "
                     "times, wander_step %u times, BOTH in one tick %u times\n",
                     kTicks, 2 * kGroup, aiWrites, wanderWrites, doubleWrites);

        // THE assertion this whole lane exists for.
        CHECK(doubleWrites == 0);
        // ...and it is not vacuous: both systems really did steer.
        CHECK(aiWrites > 0);
        CHECK(wanderWrites > 0);
        // Neither system wrote a body the token did not assign it. The first of
        // these is what the one-line wander.cpp guard buys; if it is non-zero,
        // the guard is missing (see the file header).
        CHECK(wanderWroteAiOwned == 0);
        CHECK(aiWroteWanderOwned == 0);
        // Group membership held for the whole run.
        CHECK(aOwnedByAi == 0);
        CHECK(bOwnedByWander == 0);

        // Steering direction: group B flees UP-field, i.e. down the danger
        // gradient. The ramp rises with +x, so a fleeing body must move in -x.
        arm_sentinels(reg, all);
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
        for (Entity e : groupB) {
            const Velocity& v = reg.get<Velocity>(e);
            CHECK(v.v.x < 0.0f);
            CHECK(v.v.z == 0.0f);   // z is gravity's, never the steerer's
            const float sp = std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y);
            CHECK(std::fabs(sp - kFleeSpeed) < 1e-3f);
        }
        for (Entity e : groupA) CHECK(is_sentinel(reg.get<Velocity>(e)));

        // ---- Block 5: the guard, forced from both sides --------------------
        // Independent of what the brain chose above: set the token by hand and
        // check `wander_step` honours it. This is the guard's contract test, and
        // it is the one that fails loudly if the one-line edit in wander.cpp is
        // missing.
        for (Entity e : all)
            reg.get<AiBrain>(e).motion = static_cast<std::uint8_t>(MotionOwner::Ai);
        std::uint32_t wroteWhileAllAiOwned = 0;
        for (int t = 0; t < kTicks; ++t) {
            arm_sentinels(reg, all);
            wander_step(reg, grid, pool, coarse, fine, kLayer,
                        static_cast<std::uint64_t>(t));
            for (Entity e : all)
                if (!is_sentinel(reg.get<Velocity>(e))) ++wroteWhileAllAiOwned;
        }
        CHECK(wroteWhileAllAiOwned == 0);

        for (Entity e : all)
            reg.get<AiBrain>(e).motion =
                static_cast<std::uint8_t>(MotionOwner::Wander);
        std::uint32_t wroteWhileAllDelegated = 0;
        for (int t = 0; t < kTicks; ++t) {
            arm_sentinels(reg, all);
            wander_step(reg, grid, pool, coarse, fine, kLayer,
                        static_cast<std::uint64_t>(t));
            for (Entity e : all)
                if (!is_sentinel(reg.get<Velocity>(e))) ++wroteWhileAllDelegated;
        }
        // Every body, once per kWanderPeriod: the counts below bound the stagger
        // rather than pin it, so a period change does not break the test.
        CHECK(wroteWhileAllDelegated >= static_cast<std::uint32_t>(2 * kGroup));
        std::fprintf(stdout,
                     "[utilai] guard: wander_step wrote %u times with the token "
                     "held by ai, %u times with it delegated\n",
                     wroteWhileAllAiOwned, wroteWhileAllDelegated);
    }

    // ======================================================================
    // 6. DEFAULT OFF, and off means inert.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x * 2);

        Registry reg;
        NpcPool pool;
        pool.init();
        NpcId id = 0;
        const Entity e = make_body(reg, pool, 80, 40, 1, Faction::Citizens, id);
        CHECK(ai_init(reg, kLayer) == 1u);

        // The default-constructed config is the shipping one, and it is OFF.
        const AiConfig defaults;
        CHECK(!defaults.enabled);

        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        double now = 0.0;
        for (int t = 0; t < 50; ++t) {
            const AiTick tick =
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt);
            CHECK(tick.considered == 0);
            CHECK(tick.replanned == 0);
            CHECK(tick.aiOwned == 0);
            now += static_cast<double>(kSimDt);
        }
        // Nothing steered, nothing decided, and the token never left wander.
        CHECK(is_sentinel(reg.get<Velocity>(e)));
        const AiBrain& b = reg.get<AiBrain>(e);
        CHECK(b.currentIntent == kIntentNone);
        CHECK(b.decisions == 0);
        CHECK(b.motion == static_cast<std::uint8_t>(MotionOwner::Wander));
        CHECK(!ai_owns_motion(reg, e));

        // A body with NO brain at all is invisible to the guard, which is what
        // makes the wander.cpp edit additive: with ai_init never called, every
        // existing steerer behaves exactly as before.
        NpcId bare = 0;
        const Entity naked = make_body(reg, pool, 10, 40, 1, Faction::Wild, bare);
        CHECK(!reg.all_of<AiBrain>(naked));
        CHECK(!ai_owns_motion(reg, naked));
    }

    // ======================================================================
    // 7. Ownership is re-derived every tick, so a dying gradient hands the body
    //    back, and possession hands it back too.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x * 2);

        Registry reg;
        NpcPool pool;
        pool.init();
        NpcId id = 0;
        const Entity e = make_body(reg, pool, 80, 40, 1, Faction::Citizens, id);
        CHECK(ai_init(reg, kLayer) == 1u);

        AiConfig cfg;
        cfg.enabled = true;

        double now = 0.0;
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        CHECK(ai_owns_motion(reg, e));

        // Flatten the field. The intent is STICKY (still flee), but the gradient
        // it needs is gone, so ownership goes back to wander on the same call —
        // which is why ai_step must run before wander_step: the handback is
        // honoured on the tick it happens, not one tick later.
        danger.fill(90.0f);
        now += static_cast<double>(kSimDt);
        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        const AiTick t2 = ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        CHECK(!ai_owns_motion(reg, e));
        CHECK(t2.wanderOwned == 1);
        CHECK(t2.aiOwned == 0);
        CHECK(is_sentinel(reg.get<Velocity>(e)));   // ai wrote nothing

        // Restore the gradient, take ownership back, then POSSESS the body. A
        // camera holder is driven by controller_step, so the brain must release
        // it — otherwise the body would be skipped by wander AND written by both
        // the controller and the AI, which is the same double-write bug wearing a
        // player's clothes.
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x * 2);
        now += static_cast<double>(kSimDt);
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
        CHECK(ai_owns_motion(reg, e));

        reg.emplace<CameraTag>(e, CameraTag{});
        reg.emplace<Controller>(e, Controller{7.0f, {0, 0, 0}, false});
        now += static_cast<double>(kSimDt);
        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        const AiTick t3 = ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
        CHECK(!ai_owns_motion(reg, e));
        CHECK(t3.considered == 0);   // out of scope entirely once possessed
        CHECK(is_sentinel(reg.get<Velocity>(e)));

        // ai_release is the answer to "enabled was cleared mid-run": without it a
        // body left holding the token would be skipped by wander forever and
        // stand still. Re-check it on a body the AI does own.
        reg.remove<CameraTag>(e);
        reg.remove<Controller>(e);
        now += static_cast<double>(kSimDt);
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
        CHECK(ai_owns_motion(reg, e));
        CHECK(ai_release(reg, kLayer) == 1u);
        CHECK(!ai_owns_motion(reg, e));
        CHECK(ai_release(reg, kLayer) == 0u);   // idempotent
    }

    // ======================================================================
    // 8. Determinism. Two identical runs must agree on every decision and every
    //    velocity — the whole AI stores no RNG state, only identity hashes, so
    //    any divergence means something is reading uninitialised memory or a
    //    clock.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x);

        std::vector<std::uint32_t> intents[2];
        std::vector<std::uint32_t> decisions[2];
        std::vector<float> vx[2];

        for (int run = 0; run < 2; ++run) {
            Registry reg;
            NpcPool pool;
            pool.init();
            std::vector<Entity> bodies;
            for (int i = 0; i < 16; ++i) {
                NpcId id = 0;
                bodies.push_back(make_body(reg, pool, 60 + i, 50, 1,
                                           static_cast<Faction>(i % 5), id));
            }
            ai_init(reg, kLayer);

            AiConfig cfg;
            cfg.enabled = true;
            double now = 0.0;
            for (int t = 0; t < 600; ++t) {   // ~4.8 s: several full re-plan cycles
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
                now += static_cast<double>(kSimDt);
            }
            for (Entity e : bodies) {
                const AiBrain& b = reg.get<AiBrain>(e);
                intents[run].push_back(b.currentIntent);
                decisions[run].push_back(b.decisions);
                vx[run].push_back(reg.get<Velocity>(e).v.x);
            }
            // The staggered cadence really did fire several times per body, so
            // the comparison covers re-planning and not just the first commit.
            for (std::uint32_t d : decisions[run]) CHECK(d >= 2u);
        }
        CHECK(intents[0].size() == intents[1].size());
        for (std::size_t i = 0; i < intents[0].size(); ++i) {
            CHECK(intents[0][i] == intents[1][i]);
            CHECK(decisions[0][i] == decisions[1][i]);
            CHECK(vx[0][i] == vx[1][i]);
        }
    }
}
