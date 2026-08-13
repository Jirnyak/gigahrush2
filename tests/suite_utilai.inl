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
// Blocks 9-15 cover MEMORY (`AiMemory`, [ai.h] banner). Same standard: the point
// is never "the ring stores bytes", it is that a remembered fact CHANGES AN
// OUTCOME, with the difference printed as a number.
//
//   Block 9  — the ring. DEMAND allocation (0 bytes until the first write, then
//              the 4096-row chunk), the footprint table printed at demo scale and
//              at 2^20, payload round-trips, COALESCING (200 sightings of one cell
//              collapse to one trace, not eight), weakest-first eviction, lazy
//              expiry, and the payload-family guard.
//   Block 10 — MEMORY CHANGES THE MIND, twice. First as pure arithmetic: the same
//              Perception with and without one remembered danger mark, flee score
//              printed both ways. Then end to end through the driver, with the
//              LIVE recorder in the loop: hot field -> bodies flee and file a
//              trace -> field EVAPORATES -> the remembering arm keeps fleeing and
//              the forgetting arm goes back to work. Both counts printed.
//   Block 11 — the grudge is SIGNED BY FACTION. One remembered attacker moves
//              Liquidators toward combat and Citizens toward flight; measured as
//              committed-intent counts over 512 identities, all four printed.
//   Block 12 — MEMORY CHANGES THE MOTION, and the single-writer rule survives it.
//              A flat (gradient-free) danger field gives flee no live direction;
//              with memory the body steers away from the remembered cell and takes
//              the token, without memory it delegates. Then block 4's double-write
//              probe re-run with memory ON.
//   Block 13 — the TTL and the freshness curve are real: the age at which the
//              memory stops changing the decision is measured and printed, and the
//              trace is invisible at its TTL.
//   Block 14 — determinism, including every memory row, folded into one FNV-1a
//              digest the way suite_macrosim does for the pool columns.
//   Block 15 — memory is keyed by NpcId, so it SURVIVES the body. Fold the record
//              back, re-embody it (what an elevator ride does) and the recall is
//              unchanged while the AiBrain is fresh.
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

// FNV-1a byte fold, the same primitive suite_macrosim digests pool columns with.
// Used in block 14 to reduce every memory row of every body to one number, so a
// determinism failure is one comparison instead of hundreds.
inline void fold_u32(std::uint32_t& h, std::uint32_t v) {
    for (int b = 0; b < 4; ++b) {
        h ^= (v >> (b * 8)) & 0xFFu;
        h *= 16777619u;
    }
}
inline void fold_f32(std::uint32_t& h, float f) {
    // Exact, and without <cstring>: seconds at millisecond resolution, which is
    // finer than anything this suite advances by (kSimDt == 8 ms).
    fold_u32(h, static_cast<std::uint32_t>(f * 1000.0f + 0.5f));
}
inline std::uint32_t digest_memory(const AiMemory& mem, NpcId id,
                                   std::uint32_t h = 2166136261u) {
    const MemoryRow& r = mem.row(id);
    for (int i = 0; i < kMemSlots; ++i) {
        fold_u32(h, r.slot[i].packed);
        fold_f32(h, r.slot[i].seenAt);
    }
    return h;
}

// A calm, healthy, full-needs Citizen's Perception — the baseline every memory
// block perturbs. Every stubbed field keeps its zero/-1 default, so the ONLY
// difference between the two arms of a measurement is the memory.
//
// With `needs_roll` bands (food/water 70..100, sleep 60..100, pee 0..30,
// poo 0..20) every pressure curve reads exactly 0, and at full HP so does
// healthPressure — so `urgent == 0` for this body and the arithmetic in the
// comments below is exact rather than approximate.
inline Perception calm_citizen(std::uint32_t npcId, Faction f = Faction::Citizens) {
    Perception p;
    p.idSeed = identity_seed(npcId);
    p.faction = static_cast<std::uint16_t>(f);
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    return p;
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

    // ======================================================================
    // 9. THE RING ITSELF: DEMAND allocation, the footprint, coalescing,
    //    weakest-first eviction, lazy expiry, and the payload-family guard.
    // ======================================================================
    {
        // The packed word is the reason a trace is 8 B and a row 64 B, so pin both
        // payload families round-trip through it — including the extremes, where a
        // one-bit-narrow field would silently alias.
        for (int c = 0; c < kMacroDim; c += 17) {
            const std::uint32_t pay = mem_pack_cell(c, kMacroDim - 1 - c, (c + 5) % kMacroDim);
            CHECK(mem_cell_x(pay) == c);
            CHECK(mem_cell_y(pay) == kMacroDim - 1 - c);
            CHECK(mem_cell_z(pay) == (c + 5) % kMacroDim);
        }
        CHECK(mem_pack_cell(127, 127, 127) == kMemPayloadMask); // 21 bits, all set

        // Strength survives the 7-bit quantisation to within one step. (Not HALF a
        // step: 0.5 lands exactly on a tie, rounds up to 64/127, and sits at
        // precisely half a step away — an assertion at half a step would be a
        // coin-flip on the rounding rule.)
        const MemoryTrace probe = mem_trace(MemDanger, mem_pack_cell(3, 4, 5), 0.5f, 12.0f);
        CHECK(probe.kind() == MemDanger);
        CHECK(probe.payload() == mem_pack_cell(3, 4, 5));
        CHECK(std::fabs(probe.strength() - 0.5f) < 1.0f / 127.0f);
        CHECK(mem_trace(MemDanger, 0u, 0.0f, 0.0f).strength() == 0.0f);
        CHECK(mem_trace(MemDanger, 0u, 1.0f, 0.0f).strength() == 1.0f);
        CHECK(mem_trace(MemDanger, 0u, 9.0f, 0.0f).strength() == 1.0f);  // clamped
        CHECK(mem_trace(MemDanger, 0u, -9.0f, 0.0f).strength() == 0.0f); // clamped
        CHECK(probe.seenAt == 12.0f);
        CHECK(!probe.empty());
        CHECK(MemoryTrace{}.empty());   // a zeroed slot is EMPTY, not a fact about cell 0

        // --- DEMAND: zero until the first write ---------------------------
        AiMemory mem;
        CHECK(mem.rows() == 0u);
        CHECK(mem.resident_bytes() == 0u);
        CHECK(mem.live_traces(7u, 0.0) == 0u);      // legal on an unallocated id
        CHECK(mem.row(999999u).slot[0].empty());    // ...and returns the blank row

        CHECK(ai_remember_cell(mem, 7u, MemDanger, 40, 40, 1, 1.0f, 0.0));
        CHECK(mem.rows() == kMemChunk);             // one chunk, not 2^20
        CHECK(mem.resident_bytes() >= kMemChunk * sizeof(MemoryRow));
        CHECK(mem.live_traces(7u, 0.0) == 1u);
        CHECK(mem.writes() == 1u);
        CHECK(mem.coalesced() == 0u);

        std::fprintf(stdout,
                     "[utilai] memory footprint: trace %zu B, row %zu B (%d slots) "
                     "-> %.1f KiB resident after 1 write (%u rows); projected %.1f "
                     "MiB at the 950k active target, %.1f MiB at the full 2^20\n",
                     sizeof(MemoryTrace), sizeof(MemoryRow), kMemSlots,
                     static_cast<double>(mem.resident_bytes()) / 1024.0, mem.rows(),
                     static_cast<double>(kNpcActiveTarget) *
                         static_cast<double>(sizeof(MemoryRow)) / 1048576.0,
                     static_cast<double>(kNpcPoolSize) *
                         static_cast<double>(sizeof(MemoryRow)) / 1048576.0);

        // --- COALESCING: the property that makes the ring survive a hot cell ---
        // A body re-plans forever while standing in the same place. Without
        // coalescing that fills all eight slots with one fact and then starts
        // evicting real ones.
        for (int t = 1; t < 200; ++t)
            CHECK(ai_remember_cell(mem, 7u, MemDanger, 40, 40, 1, 1.0f,
                                   static_cast<double>(t) * 0.1));
        CHECK(mem.live_traces(7u, 20.0) == 1u);   // still ONE trace, not eight
        CHECK(mem.writes() == 1u);
        CHECK(mem.coalesced() == 199u);
        CHECK(mem.evictions() == 0u);
        std::fprintf(stdout,
                     "[utilai] coalescing: 200 sightings of one cell -> %u live "
                     "trace(s), %u write(s), %u coalesce(s), %u eviction(s)\n",
                     mem.live_traces(7u, 20.0), mem.writes(), mem.coalesced(),
                     mem.evictions());
        // The refreshed trace carries the LAST sighting's time, so it is young — a
        // coalesce that kept the FIRST timestamp would let a fact the body is
        // standing in front of expire while it watches.
        CHECK(std::fabs(mem.row(7u).slot[0].seenAt - 19.9f) < 1e-3f);

        // --- Fill, then EVICT the weakest --------------------------------
        AiMemory ring;
        for (int i = 0; i < kMemSlots; ++i) {
            // Descending strength: slot i holds 1.0 - 0.1*i, so slot 7 is weakest.
            CHECK(ai_remember_cell(ring, 3u, MemFood, 50 + i, 60, 1,
                                   1.0f - 0.1f * static_cast<float>(i), 0.0));
        }
        CHECK(ring.live_traces(3u, 0.0) == static_cast<std::uint32_t>(kMemSlots));
        CHECK(ring.writes() == static_cast<std::uint32_t>(kMemSlots));
        CHECK(ring.evictions() == 0u);
        const std::uint32_t keptSlot1 = ring.row(3u).slot[1].packed;
        // The ninth fact must displace the WEAKEST (slot 7), not the oldest.
        CHECK(ai_remember_cell(ring, 3u, MemFood, 99, 99, 1, 1.0f, 0.0));
        CHECK(ring.live_traces(3u, 0.0) == static_cast<std::uint32_t>(kMemSlots));
        CHECK(ring.evictions() == 1u);
        CHECK(ring.row(3u).slot[kMemSlots - 1].payload() == mem_pack_cell(99, 99, 1));
        CHECK(ring.row(3u).slot[1].packed == keptSlot1); // an innocent slot survived

        // --- LAZY EXPIRY: a trace dies by TTL, with no sweep pass ---------
        CHECK(mem_ttl_sec(MemDanger) == 900.0f);
        CHECK(mem_ttl_sec(MemFood) == 720.0f);
        CHECK(mem_ttl_sec(MemNone) == 0.0f);
        AiMemory aging;
        CHECK(ai_remember_cell(aging, 5u, MemDanger, 10, 10, 1, 1.0f, 0.0));
        CHECK(aging.live_traces(5u, 899.0) == 1u);
        CHECK(aging.live_traces(5u, 900.0) == 0u); // exactly at the TTL: gone
        // ...and the dead slot is REUSED rather than a ninth allocated.
        CHECK(ai_remember_cell(aging, 5u, MemFood, 11, 11, 1, 1.0f, 901.0));
        CHECK(aging.live_traces(5u, 901.0) == 1u);
        CHECK(aging.writes() == 2u);
        CHECK(aging.evictions() == 0u);
        CHECK(aging.row(5u).slot[0].kind() == MemFood); // slot 0, the expired one

        // The freshness curve is the reference's: 30 at t=0, 0 at exactly 900 s.
        CHECK(mem_freshness(0.0f) == kMemFreshnessMax);
        CHECK(mem_freshness(29.0f) == kMemFreshnessMax);
        CHECK(mem_freshness(30.0f) == kMemFreshnessMax - 1.0f);
        CHECK(mem_freshness(900.0f) == 0.0f);
        CHECK(mem_freshness(5000.0f) == 0.0f);

        // --- Payload families cannot be crossed --------------------------
        AiMemory guard;
        CHECK(!ai_remember_cell(guard, 1u, MemFoe, 1, 2, 3, 1.0f, 0.0));
        CHECK(!ai_remember_actor(guard, 1u, MemDanger, 42u, 1.0f, 0.0));
        CHECK(!ai_remember_actor(guard, 1u, MemFoe, kInvalidNpc, 1.0f, 0.0));
        CHECK(!guard.remember(1u, MemNone, 0u, 1.0f, 0.0));
        CHECK(guard.rows() == 0u);   // every refusal allocated nothing
        CHECK(ai_remember_actor(guard, 1u, MemFoe, 1234u, 1.0f, 0.0));
        CHECK(ai_recall(guard, 1u, 0, 0, 0, 0.0).foe == 1234u);

        // forget() clears a row without shrinking the column.
        AiMemory forgetful;
        CHECK(ai_remember_cell(forgetful, 2u, MemDanger, 1, 1, 1, 1.0f, 0.0));
        forgetful.forget(2u);
        CHECK(forgetful.live_traces(2u, 0.0) == 0u);
        CHECK(forgetful.rows() == kMemChunk);
        forgetful.forget(999999u);   // out of range: legal no-op
    }

    // ======================================================================
    // 10. MEMORY CHANGES THE MIND.
    //
    //     The whole lane exists for this block. Everything else is plumbing.
    // ======================================================================
    float fleeCold = 0.0f;
    float fleeRemembered = 0.0f;
    {
        // ---- 10a: as pure arithmetic, one body, one trace ----------------
        // The Needs row is the same in both arms and every stubbed Perception field
        // stays at its default, so the ONLY difference is one remembered fact.
        const Needs needs = needs_roll(0xBEEFu);
        Perception cold = calm_citizen(11u);
        float scoresCold[kIntentCount];
        score_intents(cold, needs, scoresCold);
        const std::uint8_t pickCold = select_intent_raw(scoresCold);
        fleeCold = scoresCold[IntentFlee];

        AiMemory mem;
        CHECK(ai_remember_cell(mem, 11u, MemDanger, 64, 64, 1, 1.0f, 0.0));
        // Recall AT the remembered cell, one instant later: proximity 1, freshness
        // 1, strength 1 -> rememberedThreat 1.0 -> threat pressure kMemThreatWeight.
        const MemoryRecall r = ai_recall(mem, 11u, 64, 64, 1, 0.0);
        CHECK(r.live == 1u);
        CHECK(std::fabs(r.threat - 1.0f) < 1e-6f);
        CHECK(!r.haveAway);   // the mark is on the body's OWN cell: no bearing

        Perception warm = calm_citizen(11u);
        apply_recall(r, warm.faction, warm);
        CHECK(std::fabs(warm.rememberedThreat - 1.0f) < 1e-6f);
        float scoresWarm[kIntentCount];
        score_intents(warm, needs, scoresWarm);
        const std::uint8_t pickWarm = select_intent_raw(scoresWarm);
        fleeRemembered = scoresWarm[IntentFlee];

        // A calm Citizen with full needs works. The same Citizen, having SEEN
        // something here, runs — with the live danger field reading exactly zero in
        // both arms.
        CHECK(cold.danger == 0.0f);
        CHECK(warm.danger == 0.0f);
        CHECK(pickCold == IntentWork);
        CHECK(pickWarm == IntentFlee);
        CHECK(pickCold != pickWarm);
        // The shift is exactly threat*42 = kMemThreatWeight*42 = 29.4 on flee, and
        // it is the SAME number for every identity because the per-intent jitter is
        // a function of identity only and therefore cancels in the difference.
        CHECK(std::fabs((fleeRemembered - fleeCold) - kMemThreatWeight * 42.0f) < 0.01f);
        // ...and work is suppressed by the same threat pressure it raised flee by.
        CHECK(scoresWarm[IntentWork] < scoresCold[IntentWork]);

        std::fprintf(stdout,
                     "[utilai] MEMORY CHANGES THE DECISION (live danger field == 0 "
                     "in BOTH arms): forgets -> '%s' (flee %.1f); remembers one "
                     "danger mark -> '%s' (flee %.1f), delta +%.1f\n",
                     kIntentName[pickCold], static_cast<double>(fleeCold),
                     kIntentName[pickWarm], static_cast<double>(fleeRemembered),
                     static_cast<double>(fleeRemembered - fleeCold));

        // The same trace one recall-radius away carries no threat at all, which is
        // what keeps memory LOCAL rather than a floor-wide alarm. The trace is still
        // THERE (live == 1) — it just does not reach.
        const MemoryRecall far = ai_recall(mem, 11u, 64 + kMemRecallCells, 64, 1, 0.0);
        CHECK(far.live == 1u);
        CHECK(far.threat == 0.0f);
        CHECK(!far.haveAway);

        // And the distance is TOROIDAL. A mark at x=1 with the body at x=127 is TWO
        // cells away the short way round and 126 the long way; naive arithmetic
        // would put it far outside the recall radius and the memory would be
        // silent across the seam ([AGENTS.md] x/y/z wrap).
        // The long way really is out of range — a static_assert and not a CHECK,
        // because both sides are compile-time constants and MSVC /W4 rejects a
        // constant runtime condition (C4127).
        static_assert(kMacroDim - 2 > kMemRecallCells,
                      "the seam test needs the long way round to be out of recall "
                      "range, or it proves nothing about toroidal distance");
        AiMemory seamMem;
        CHECK(ai_remember_cell(seamMem, 12u, MemDanger, 1, 40, 1, 1.0f, 0.0));
        const MemoryRecall seam = ai_recall(seamMem, 12u, kMacroDim - 1, 40, 1, 0.0);
        CHECK(seam.live == 1u);
        CHECK(seam.threat > 0.0f);
        CHECK(seam.haveAway);
        CHECK(seam.awayX < 0.0f);   // the mark is +2 toroidally, so run in -x
        CHECK(std::fabs(seam.awayY) < 1e-6f);
        // Proximity is measured on the SHORT path: 2 cells of 12 -> 1 - 2/12.
        CHECK(std::fabs(seam.threat - (1.0f - 2.0f / static_cast<float>(kMemRecallCells))) <
              1e-5f);
    }
    {
        // ---- 10b: end to end through the driver, with the LIVE recorder --
        // Phase 1 runs a hot danger field: bodies flee on the FIELD and file a
        // trace. Phase 2 zeroes the field — the diffusion field evaporates, which
        // is what [diffusion.md] says it does. The question is what the crowd does
        // next, and it is the difference between a crowd that learns and one that
        // walks back into the corridor.
        //
        // Hysteresis is OFF here for the reason block 3 turns it off for its own
        // measurement: with it on, the incumbent's +5..12 stickiness would hold
        // flee in BOTH arms and the number would measure stickiness, not memory.
        constexpr int kBodies = 12;
        constexpr int kHot = 10;   // ticks of live danger
        constexpr int kCold = 10;  // ticks after it evaporates

        MacroGrid grid;
        std::uint32_t fleeing[3] = {0, 0, 0};
        std::uint32_t traces[3] = {0, 0, 0};

        for (int arm = 0; arm < 3; ++arm) {
            // arm 0: no store at all       (the pre-memory behaviour, bit for bit)
            // arm 1: a store, cfg.memory OFF (proves the flag, not just the pointer)
            // arm 2: a store, cfg.memory ON
            Field<float> danger(0.0f);
            Registry reg;
            NpcPool pool;
            pool.init();
            AiMemory store;
            std::vector<Entity> bodies;
            std::vector<NpcId> ids;
            for (int i = 0; i < kBodies; ++i) {
                NpcId id = 0;
                bodies.push_back(
                    make_body(reg, pool, 30 + i, 70, 1, Faction::Citizens, id));
                ids.push_back(id);
            }
            CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(kBodies));

            AiConfig cfg;
            cfg.enabled = true;
            cfg.hysteresis = false;
            cfg.memory = (arm == 2);
            cfg.rethinkBaseSec = 0.0f;
            cfg.rethinkSpreadSec = 0.0f;
            AiMemory* memPtr = (arm == 0) ? nullptr : &store;

            double now = 0.0;
            danger.fill(100.0f);   // unitish -> 1.0: maximum severity, worth filing
            for (int t = 0; t < kHot; ++t) {
                const AiTick tick = ai_step(reg, pool, &danger, grid, kLayer, now,
                                            kSimDt, cfg, memPtr);
                CHECK(tick.considered == static_cast<std::uint32_t>(kBodies));
                now += static_cast<double>(kSimDt);
            }
            // A live field of 100 makes every Citizen flee, in every arm — so the
            // two arms enter phase 2 from the SAME mental state and only differ in
            // what they kept.
            for (Entity e : bodies)
                CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);

            // Exactly one trace per body: the first re-plan wrote it and the other
            // nine coalesced into it. This is the coalescing property proven on the
            // real driver rather than on the store in isolation.
            if (arm == 2) {
                CHECK(store.writes() == static_cast<std::uint32_t>(kBodies));
                CHECK(store.coalesced() ==
                      static_cast<std::uint32_t>(kBodies * (kHot - 1)));
                CHECK(store.evictions() == 0u);
            } else {
                CHECK(store.writes() == 0u);       // nullptr, or the flag is off
                CHECK(store.resident_bytes() == 0u);
            }

            // --- the field evaporates ---
            danger.fill(0.0f);
            for (int t = 0; t < kCold; ++t) {
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, memPtr);
                now += static_cast<double>(kSimDt);
            }
            for (int i = 0; i < kBodies; ++i) {
                if (reg.get<AiBrain>(bodies[i]).currentIntent == IntentFlee)
                    ++fleeing[arm];
                traces[arm] += store.live_traces(ids[static_cast<std::size_t>(i)], now);
            }
        }

        std::fprintf(stdout,
                     "[utilai] danger field went to ZERO after %d hot ticks; %d "
                     "bodies still fleeing: no store = %u, store+memory OFF = %u, "
                     "store+memory ON = %u (live traces %u / %u / %u)\n",
                     kHot, kBodies, fleeing[0], fleeing[1], fleeing[2], traces[0],
                     traces[1], traces[2]);

        // With the field gone and nothing remembered, work (27.7) beats flee (19.2)
        // for every Citizen with full needs by more than the +/-2.5 jitter can
        // close, so this is 0 rather than "small".
        CHECK(fleeing[0] == 0u);
        CHECK(fleeing[1] == fleeing[0]);   // the flag really is the switch
        // With the trace, threat pressure is kMemThreatWeight -> flee 48.6 against
        // a next-best 33.3, a 12.8-point margin the jitter cannot close either.
        CHECK(fleeing[2] == static_cast<std::uint32_t>(kBodies));
        CHECK(traces[0] == 0u);
        CHECK(traces[1] == 0u);
        CHECK(traces[2] == static_cast<std::uint32_t>(kBodies));
    }

    // ======================================================================
    // 11. THE GRUDGE IS SIGNED BY FACTION.
    //
    //     One remembered attacker, two factions, the same Perception. The bonus is
    //     spent through the affordance slot and DIVIDED by `risk`, so a Liquidator
    //     (risk 0.74) turns and fights while a Citizen (risk 0.32) runs. Measured
    //     over 512 identities because the deciding margin is inside the +/-2.5
    //     identity jitter band for a single body — a per-id assertion would be
    //     luck, a distribution is a measurement.
    // ======================================================================
    {
        const Needs needs = needs_roll(0x5EEDu);
        AiMemory mem;

        // The near-tie arena, chosen so combat and flee are the top two and the
        // third-best intent is >15 points behind: armed, one visible hostile at
        // 16 m. Pre-grudge the Citizen margin is combat +2.3; the grudge shifts it
        // by 10*(0.32-0.68) = -3.6, i.e. across zero.
        auto arena = [&](std::uint32_t id, Faction f) {
            Perception p = calm_citizen(id, f);
            p.armed = true;
            p.visibleHostiles = 1.0f;
            p.threatDistance = 16.0f;
            return p;
        };

        constexpr std::uint32_t kIds = 512;
        std::uint32_t combatCold[2] = {0, 0};
        std::uint32_t fleeCold2[2] = {0, 0};
        std::uint32_t combatWarm[2] = {0, 0};
        std::uint32_t fleeWarm[2] = {0, 0};
        const Faction sides[2] = {Faction::Citizens, Faction::Liquidators};

        for (int s = 0; s < 2; ++s) {
            for (std::uint32_t id = 1; id <= kIds; ++id) {
                Perception cold = arena(id, sides[s]);
                float a[kIntentCount];
                score_intents(cold, needs, a);
                const std::uint8_t pc = select_intent_raw(a);
                if (pc == IntentCombat) ++combatCold[s];
                if (pc == IntentFlee) ++fleeCold2[s];

                // The same body, having been hurt by somebody it can still name.
                mem.forget(id);
                CHECK(ai_remember_actor(mem, id, MemFoe, id + 100000u, 1.0f, 0.0));
                const MemoryRecall r = ai_recall(mem, id, 0, 0, 0, 0.0);
                CHECK(r.foe == id + 100000u);
                CHECK(std::fabs(r.grudge - 1.0f) < 1e-6f);
                CHECK(r.threat == 0.0f);   // a grudge is not a place

                Perception warm = arena(id, sides[s]);
                apply_recall(r, warm.faction, warm);
                // The signed split, asserted directly on the coefficients so the
                // distribution below has a mechanism behind it and not a guess.
                const FactionTraits& tr = faction_traits(warm.faction);
                CHECK(std::fabs(warm.localScore[IntentCombat] -
                                kMemAffordanceCap * tr.risk) < 1e-4f);
                CHECK(std::fabs(warm.localScore[IntentFlee] -
                                kMemAffordanceCap * (1.0f - tr.risk)) < 1e-4f);
                float b[kIntentCount];
                score_intents(warm, needs, b);
                const std::uint8_t pw = select_intent_raw(b);
                if (pw == IntentCombat) ++combatWarm[s];
                if (pw == IntentFlee) ++fleeWarm[s];
            }
        }

        std::fprintf(stdout,
                     "[utilai] one remembered attacker, %u identities each: "
                     "Citizens combat %u->%u flee %u->%u | Liquidators combat "
                     "%u->%u flee %u->%u\n",
                     kIds, combatCold[0], combatWarm[0], fleeCold2[0], fleeWarm[0],
                     combatCold[1], combatWarm[1], fleeCold2[1], fleeWarm[1]);

        // CITIZENS: the grudge pushes them OFF combat and ONTO flight, and it moves
        // a real share of the population rather than two bodies at the edge of the
        // jitter band. The arena's pre-grudge Citizen margin is combat +2.3 and the
        // grudge shifts it to -1.3, so with jitter differences triangular on
        // (-5, +5) the analytic flip rate is ~58% of the population; the bound below
        // is an eighth of it, i.e. deliberately loose.
        CHECK(fleeWarm[0] > fleeCold2[0] + kIds / 8u);
        CHECK(combatWarm[0] < combatCold[0]);

        // LIQUIDATORS: the same insult pushes them ONTO combat, and here the claim
        // can be absolute rather than statistical. Their pre-grudge contest is
        // combat 49.7 against patrol 47.1 — a 2.6 margin the jitter flips for some
        // identities — while the grudge widens it to 9.96, past anything +/-2.5 per
        // intent can close. So EVERY Liquidator fights, and not all of them did.
        CHECK(combatWarm[1] == kIds);
        CHECK(combatCold[1] < kIds);
        // ...and the effect is opposite in SIGN, not merely different in size: flee
        // peaks at 23.4 for a Liquidator in this arena, so it never wins either way.
        CHECK(fleeCold2[1] == 0u);
        CHECK(fleeWarm[1] == 0u);
    }

    // ======================================================================
    // 12. MEMORY CHANGES THE MOTION — and the single-writer rule survives it.
    //
    //     A FLAT danger field has no gradient, so flee has no live direction and
    //     today's code hands the body straight back to wander. With a remembered
    //     danger cell it now runs away from that cell instead. Three groups in one
    //     arena exercise all three arbitration paths in the SAME tick:
    //
    //       A  calm half, no memory      -> wander owns  (work wins, not flee)
    //       B  ramp half, live gradient  -> ai owns via the FIELD
    //       C  calm half, one memory     -> ai owns via MEMORY
    // ======================================================================
    {
        constexpr int kGroup = 8;
        constexpr int kTicks = 200;

        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 64; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>((x - 63) * 4);

        nav::CoarseGraph coarse{};
        nav::FineNav fine;
        fill_flow_plus_x(fine);

        Registry reg;
        NpcPool pool;
        pool.init();
        AiMemory mem;

        std::vector<Entity> groupA, groupB, groupC, all;
        for (int i = 0; i < kGroup; ++i) {
            NpcId a = 0, b = 0, c = 0;
            groupA.push_back(make_body(reg, pool, 20 + i, 30, 1, Faction::Citizens, a));
            groupB.push_back(make_body(reg, pool, 70 + i, 30, 1, Faction::Citizens, b));
            groupC.push_back(make_body(reg, pool, 20 + i, 44, 1, Faction::Citizens, c));
            // Group C remembers something 8 cells to the +x — inside the 12-cell
            // recall radius, so it both scares them and gives them a bearing.
            CHECK(ai_remember_cell(mem, c, MemDanger, 28 + i, 44, 1, 1.0f, 0.0));
        }
        for (Entity e : groupA) all.push_back(e);
        for (Entity e : groupB) all.push_back(e);
        for (Entity e : groupC) all.push_back(e);

        // The arena really is what the three groups need it to be.
        const vec3 gA = diffusion_gradient(danger, grid, 20, 30, 1);
        const vec3 gB = diffusion_gradient(danger, grid, 70, 30, 1);
        const vec3 gC = diffusion_gradient(danger, grid, 20, 44, 1);
        CHECK(gA.x * gA.x + gA.y * gA.y <= kMinFleeGrad2);   // no live direction
        CHECK(gB.x * gB.x + gB.y * gB.y > kMinFleeGrad2);    // a live direction
        CHECK(gC.x * gC.x + gC.y * gC.y <= kMinFleeGrad2);   // no live direction

        CHECK(wander_init(reg, kLayer, 0x51ee7u) ==
              static_cast<std::uint32_t>(3 * kGroup));
        CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(3 * kGroup));

        AiConfig cfg;
        cfg.enabled = true;   // hysteresis ON: this is the shipping config

        // ---- one tick, the whole arbitration table ------------------------
        arm_sentinels(reg, all);
        const AiTick t1 = ai_step(reg, pool, &danger, grid, kLayer, 0.0, kSimDt, cfg, &mem);
        CHECK(t1.considered == static_cast<std::uint32_t>(3 * kGroup));
        CHECK(t1.aiOwned + t1.wanderOwned == t1.considered);
        CHECK(t1.wanderOwned == static_cast<std::uint32_t>(kGroup));     // A
        CHECK(t1.aiOwned == static_cast<std::uint32_t>(2 * kGroup));     // B + C
        CHECK(t1.memoryFled == static_cast<std::uint32_t>(kGroup));      // C only
        for (Entity e : groupA) CHECK(!ai_owns_motion(reg, e));
        for (Entity e : groupB) CHECK(ai_owns_motion(reg, e));
        for (Entity e : groupC) CHECK(ai_owns_motion(reg, e));
        // Group C runs in -x, away from the cell it remembers, at flee pace.
        for (Entity e : groupC) {
            const Velocity& v = reg.get<Velocity>(e);
            CHECK(v.v.x < 0.0f);
            CHECK(std::fabs(v.v.y) < 1e-4f);
            CHECK(v.v.z == 0.0f);   // z is gravity's, never a steerer's
            CHECK(std::fabs(std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y) - kFleeSpeed) <
                  1e-3f);
        }
        for (Entity e : groupA) CHECK(is_sentinel(reg.get<Velocity>(e)));
        std::fprintf(stdout,
                     "[utilai] one tick, 3 groups x %d: wander owns %u, ai owns %u "
                     "(of which %u steered by a REMEMBERED cell with a flat live "
                     "field), group C |v| = %.2f m/s in -x\n",
                     kGroup, t1.wanderOwned, t1.aiOwned, t1.memoryFled,
                     static_cast<double>(kFleeSpeed));

        // ---- the same group C with NO memory delegates instead ------------
        // The measured difference in MOTION, isolated: nothing changed but the
        // store pointer.
        {
            Registry reg2;
            NpcPool pool2;
            pool2.init();
            std::vector<Entity> cOnly;
            for (int i = 0; i < kGroup; ++i) {
                NpcId c = 0;
                cOnly.push_back(
                    make_body(reg2, pool2, 20 + i, 44, 1, Faction::Citizens, c));
            }
            CHECK(ai_init(reg2, kLayer) == static_cast<std::uint32_t>(kGroup));
            arm_sentinels(reg2, cOnly);
            const AiTick t0 =
                ai_step(reg2, pool2, &danger, grid, kLayer, 0.0, kSimDt, cfg, nullptr);
            CHECK(t0.aiOwned == 0u);
            CHECK(t0.wanderOwned == static_cast<std::uint32_t>(kGroup));
            CHECK(t0.memoryFled == 0u);
            CHECK(t0.recalled == 0u);
            for (Entity e : cOnly) CHECK(is_sentinel(reg2.get<Velocity>(e)));
        }

        // ---- SINGLE WRITER, re-proven with memory ON ---------------------
        // Block 4 proved it before memory existed. Memory adds a second way to
        // acquire the token, so the probe has to be re-run or the proof is stale.
        std::uint32_t aiWrites = 0, wanderWrites = 0, doubleWrites = 0;
        std::uint32_t wanderWroteAiOwned = 0, aiWroteWanderOwned = 0;
        std::vector<bool> aiWrote(all.size(), false);
        double now = 0.0;
        for (int t = 0; t < kTicks; ++t) {
            arm_sentinels(reg, all);
            const AiTick tick =
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, &mem);
            CHECK(tick.aiOwned + tick.wanderOwned == tick.considered);
            for (std::size_t i = 0; i < all.size(); ++i) {
                aiWrote[i] = !is_sentinel(reg.get<Velocity>(all[i]));
                if (aiWrote[i]) ++aiWrites;
                if (aiWrote[i] && !ai_owns_motion(reg, all[i])) ++aiWroteWanderOwned;
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
            now += static_cast<double>(kSimDt);
        }
        std::fprintf(stdout,
                     "[utilai] memory ON, %d ticks x %d bodies: ai_step wrote "
                     "Velocity %u times, wander_step %u times, BOTH in one tick %u "
                     "times\n",
                     kTicks, 3 * kGroup, aiWrites, wanderWrites, doubleWrites);
        CHECK(doubleWrites == 0);
        CHECK(aiWrites > 0);
        CHECK(wanderWrites > 0);
        CHECK(wanderWroteAiOwned == 0);
        CHECK(aiWroteWanderOwned == 0);

        // ai_release still hands every token back with memory live, so clearing
        // `enabled` cannot leave a body frozen ([ai.h]).
        CHECK(ai_release(reg, kLayer) == static_cast<std::uint32_t>(2 * kGroup));
        CHECK(ai_release(reg, kLayer) == 0u);
    }

    // ======================================================================
    // 13. THE TTL AND THE FRESHNESS CURVE ARE REAL.
    //
    //     A memory that never fades is a permanent state change wearing a
    //     timestamp. Measure the age at which the remembered danger stops winning
    //     the argument, and print it.
    // ======================================================================
    {
        const Needs needs = needs_roll(0xFADEu);
        AiMemory mem;
        CHECK(ai_remember_cell(mem, 21u, MemDanger, 33, 33, 1, 1.0f, 0.0));

        auto picks_flee = [&](double at) {
            const MemoryRecall r = ai_recall(mem, 21u, 33, 33, 1, at);
            Perception p = calm_citizen(21u);
            apply_recall(r, p.faction, p);
            float s[kIntentCount];
            score_intents(p, needs, s);
            return select_intent_raw(s) == IntentFlee;
        };

        CHECK(picks_flee(0.0));      // just seen: flee by >12 points
        CHECK(!picks_flee(900.0));   // at the TTL: the trace is invisible

        // Scan for the crossover. Analytically it is 780 s for a jitter-free body
        // (84*threat > 8.5, threat = 0.7*freshness/30), and the +/-2.5 per-intent
        // jitter can move it one freshness step in either direction — hence the
        // asserted band rather than an exact equality.
        int revertAt = -1;
        for (int age = 0; age <= 900; age += 30) {
            if (!picks_flee(static_cast<double>(age))) {
                revertAt = age;
                break;
            }
        }
        CHECK(revertAt >= 600);
        CHECK(revertAt < 900);
        // Monotone: once forgotten, it stays forgotten. A curve that flickered
        // would put the crowd back into the thrash hysteresis exists to stop.
        for (int age = revertAt; age <= 1200; age += 30)
            CHECK(!picks_flee(static_cast<double>(age)));

        std::fprintf(stdout,
                     "[utilai] freshness: a remembered danger mark stops changing "
                     "the decision at age %d s and expires entirely at %.0f s "
                     "(live traces %u -> %u)\n",
                     revertAt, static_cast<double>(mem_ttl_sec(MemDanger)),
                     mem.live_traces(21u, 0.0), mem.live_traces(21u, 900.0));
    }

    // ======================================================================
    // 14. DETERMINISM, memory included. The store holds no RNG, only identity
    //     hashes and recorded facts, so two identical runs must produce
    //     byte-identical rows — folded into one FNV-1a digest the way
    //     suite_macrosim digests the pool columns.
    // ======================================================================
    {
        MacroGrid grid;
        std::uint32_t digest[2] = {0, 0};
        std::vector<std::uint32_t> intents[2];
        std::vector<float> vx[2];
        std::vector<std::uint32_t> traces[2];

        for (int run = 0; run < 2; ++run) {
            Field<float> danger(0.0f);
            for (int x = 0; x < kMacroDim; ++x)
                for (int y = 0; y < kMacroDim; ++y)
                    for (int z = 0; z < kMacroDim; ++z)
                        danger.at(x, y, z) = static_cast<float>(x);

            Registry reg;
            NpcPool pool;
            pool.init();
            AiMemory mem;
            std::vector<Entity> bodies;
            std::vector<NpcId> ids;
            for (int i = 0; i < 16; ++i) {
                NpcId id = 0;
                bodies.push_back(make_body(reg, pool, 60 + i, 50, 1,
                                           static_cast<Faction>(i % 5), id));
                ids.push_back(id);
            }
            ai_init(reg, kLayer);

            AiConfig cfg;
            cfg.enabled = true;
            double now = 0.0;
            std::uint32_t recalls = 0, replans = 0;
            for (int t = 0; t < 600; ++t) {   // ~4.8 s: several full re-plan cycles
                // Damage one body on a fixed schedule so RECORDER 1 (the HP-drop
                // path) is exercised too, not just the danger sampler.
                if (t == 100 || t == 300) {
                    std::int16_t& hp = pool.hp(ids[3]);
                    hp = static_cast<std::int16_t>(hp - 25);
                }
                const AiTick tick =
                    ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, &mem);
                recalls += tick.recalled;
                replans += tick.replanned;
                now += static_cast<double>(kSimDt);
            }
            std::uint32_t h = 2166136261u;
            for (std::size_t i = 0; i < bodies.size(); ++i) {
                const AiBrain& b = reg.get<AiBrain>(bodies[i]);
                intents[run].push_back(b.currentIntent);
                vx[run].push_back(reg.get<Velocity>(bodies[i]).v.x);
                traces[run].push_back(mem.live_traces(ids[i], now));
                h = digest_memory(mem, ids[i], h);
                fold_u32(h, b.currentIntent);
                fold_u32(h, b.decisions);
            }
            digest[run] = h;

            if (run == 0) {
                // The HP-drop recorder really fired, so the digest covers it.
                CHECK(reg.get<AiBrain>(bodies[3]).lastHp == 50);
                CHECK(mem.live_traces(ids[3], now) >= 1u);
                // Cost, as a measured figure rather than a claim: recalls happen on
                // a re-plan or while fleeing, never unconditionally per tick.
                std::fprintf(stdout,
                             "[utilai] cost over 600 ticks x 16 bodies: %u re-plans, "
                             "%u recalls (%.2f recalls per body per tick vs %d ticks "
                             "of unconditional scanning that were avoided)\n",
                             replans, recalls,
                             static_cast<double>(recalls) / (600.0 * 16.0), 600);
                CHECK(recalls >= replans);      // every re-plan recalls...
                CHECK(recalls <= 600u * 16u);   // ...and nothing recalls twice a tick
            }
        }
        CHECK(digest[0] == digest[1]);
        for (std::size_t i = 0; i < intents[0].size(); ++i) {
            CHECK(intents[0][i] == intents[1][i]);
            CHECK(vx[0][i] == vx[1][i]);
            CHECK(traces[0][i] == traces[1][i]);
        }
        std::fprintf(stdout,
                     "[utilai] determinism: FNV-1a over every memory row + intent + "
                     "decision count, two independent runs = 0x%08x / 0x%08x\n",
                     digest[0], digest[1]);
    }

    // ======================================================================
    // 15. MEMORY OUTLIVES THE BODY.
    //
    //     Keyed by NpcId, not by Entity — which is the whole reason it is a pool-
    //     indexed column and not a component. An elevator ride destroys the body
    //     and builds a new one ([embody.h] fold_back -> embody), so a component
    //     would wipe what the person knows on every floor change. The AiBrain
    //     SHOULD reset (it is scheduling state); the memory must not.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);   // flat zero: only memory can cause a flee
        Registry reg;
        NpcPool pool;
        pool.init();
        AiMemory mem;
        NpcId id = 0;
        Entity e = make_body(reg, pool, 55, 55, 1, Faction::Citizens, id);
        CHECK(ai_remember_cell(mem, id, MemDanger, 55, 55, 1, 1.0f, 0.0));
        CHECK(ai_init(reg, kLayer) == 1u);

        AiConfig cfg;
        cfg.enabled = true;
        ai_step(reg, pool, &danger, grid, kLayer, 0.0, kSimDt, cfg, &mem);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        const std::uint32_t before = digest_memory(mem, id);
        const std::uint16_t decisionsBefore = reg.get<AiBrain>(e).decisions;
        CHECK(decisionsBefore > 0u);

        // Ride the elevator: the record folds back and re-embodies as a NEW entity.
        fold_back(reg, pool, id, e);
        CHECK(!reg.valid(e));
        e = embody(reg, pool, id, kLayer);
        reg.get<Transform>(e).pos = vec3{55.5f * kCellSize, 55.5f * kCellSize,
                                        1.5f * kCellSize};
        CHECK(ai_init(reg, kLayer) == 1u);          // a brand-new brain...
        CHECK(reg.get<AiBrain>(e).decisions == 0u); // ...with no history
        CHECK(reg.get<AiBrain>(e).currentIntent == kIntentNone);
        CHECK(digest_memory(mem, id) == before);    // ...but the memory is intact

        // And it still decides the same way on the other side of the ride.
        const AiTick after = ai_step(reg, pool, &danger, grid, kLayer,
                                     static_cast<double>(kSimDt), kSimDt, cfg, &mem);
        CHECK(after.recalled == 1u);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        std::fprintf(stdout,
                     "[utilai] body destroyed and rebuilt (the elevator path): brain "
                     "decisions %u -> 0, memory digest 0x%08x -> 0x%08x, intent "
                     "still '%s'\n",
                     decisionsBefore, before, digest_memory(mem, id),
                     kIntentName[reg.get<AiBrain>(e).currentIntent]);
    }

    // ======================================================================
    // Roles ([role.h]): the archetype row moves the scorer, and only through
    // the terms it names.
    // ======================================================================
    {
        // role_for is a pure hash: same (id, kind) -> same role, forever.
        for (NpcId id = 0; id < 64; ++id)
            CHECK(role_for(id, FloorKind::Derelict) ==
                  role_for(id, FloorKind::Derelict));
        // A zero weight is a PROHIBITION, not a low chance: Residential floors
        // roll no Cultists, whatever the id. 4096 draws would catch a leak of
        // 1/256 with near certainty.
        for (NpcId id = 0; id < 4096; ++id)
            CHECK(role_for(id, FloorKind::Residential) != RoleId::Cultist);
        // Derelict actually uses its 40% Cultist row — the distribution is a
        // property, not a hope. 4096 draws at true p=0.63 (weights 40/63) cannot
        // plausibly land below 1024.
        int cultists = 0;
        for (NpcId id = 0; id < 4096; ++id)
            if (role_for(id, FloorKind::Derelict) == RoleId::Cultist) ++cultists;
        CHECK(cultists > 1024);

        // Additive trait terms, on a scorer that is otherwise identical input.
        // Resident is the all-ones/near-zero row, so it is the control arm.
        Needs fresh = needs_roll(999u);
        Perception p;
        p.idSeed = identity_seed(7u);
        p.faction = static_cast<std::uint16_t>(Faction::Citizens);
        p.hp = 100.0f;
        p.maxHp = 100.0f;
        p.localScore[IntentWork] = 1.0f; // a remembered workplace nearby
        p.nearbyWounded01 = 1.0f;        // everyone around is bleeding

        float asResident[kIntentCount];
        p.role = static_cast<std::uint8_t>(RoleId::Resident);
        score_intents(p, fresh, asResident);
        float asLooter[kIntentCount];
        p.role = static_cast<std::uint8_t>(RoleId::Looter);
        score_intents(p, fresh, asLooter);
        float asMedic[kIntentCount];
        p.role = static_cast<std::uint8_t>(RoleId::Medic);
        score_intents(p, fresh, asMedic);

        // (patrol execution is tested in its own block below)
        // scavengeDrive is a RESPONSE gain, not an absolute boost: the Looter's
        // 0.2 workDrive suppresses ordinary work harder than one recall adds
        // (the first draft of this check asserted the absolute and was wrong).
        // So measure the DELTA a remembered workplace makes, per role.
        Perception p0 = p;
        p0.localScore[IntentWork] = 0.0f;
        float resBase[kIntentCount];
        p0.role = static_cast<std::uint8_t>(RoleId::Resident);
        score_intents(p0, fresh, resBase);
        float lootBase[kIntentCount];
        p0.role = static_cast<std::uint8_t>(RoleId::Looter);
        score_intents(p0, fresh, lootBase);
        CHECK(asLooter[IntentWork] - lootBase[IntentWork] >
              asResident[IntentWork] - resBase[IntentWork]);
        // careDrive: Medic 1.0 vs Resident 0.05 on the same wounded ward.
        CHECK(asMedic[IntentHeal] > asResident[IntentHeal]);
        // And the role must not leak into terms its row does not name: eating is
        // role-blind, so all three arms agree bit-for-bit.
        CHECK(asLooter[IntentEat] == asResident[IntentEat]);
        CHECK(asMedic[IntentEat] == asResident[IntentEat]);
    }

    // ======================================================================
    // Patrol execution (ai_patrol_step) — a route, a claim, and a frame.
    // Synthetic nav (the vectors are public), no floor bake needed.
    // ======================================================================
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        NpcId id = 0;
        Entity e = make_body(reg, pool, 32, 32, 1, Faction::Citizens, id);
        CHECK(ai_init(reg, kLayer) == 1u);
        AiBrain& brain = reg.get<AiBrain>(e);
        brain.currentIntent = IntentPatrol;

        // Uniform synthetic flow: every cell of every field says "step +x"
        // (kNavDir[1]); every cell's anchor is node 0; every pair reachable
        // (zeroed dist != kUnreachable).
        nav::CoarseGraph coarse{};
        nav::FineNav fine;
        fine.nearest.assign(kMacroCells, 0);
        fine.flow.assign(static_cast<std::size_t>(nav::kNodes) * kMacroCells, 1);

        // 1. EMPTY BAKE IS A NO-OP, not UB — the wander_step rule. No plan may
        //    be attached and no claim taken while the async bake is in flight.
        nav::FineNav unbaked;
        ai_patrol_step(reg, coarse, unbaked, kLayer, kSimDt);
        CHECK(!reg.all_of<PatrolPlan>(e));
        CHECK(!ai_owns_motion(reg, e));

        // 2. THE STEP: lazily attaches the plan, picks a REACHABLE leg, steers
        //    +x toward the next cell centre, and CLAIMS the body — wander's
        //    ai_owns_motion guard is what makes that a single-writer fact.
        ai_patrol_step(reg, coarse, fine, kLayer, kSimDt);
        CHECK(reg.all_of<PatrolPlan>(e));
        CHECK(reg.get<PatrolPlan>(e).nodeTo < nav::kNodes);
        CHECK(ai_owns_motion(reg, e));
        Velocity& vel = reg.get<Velocity>(e);
        CHECK(vel.v.x > 0.0f);  // along the flow...
        CHECK(vel.v.y == 0.0f); // ...and only along it
        CHECK(vel.v.z == 0.0f); // the gravity axis belongs to physics (NegZ)

        // 3. THE FRAME: under PosX the flow's +x step is a step ALONG gravity —
        //    walking cannot spend it, so the fallback walks toward the target
        //    node's COLUMN in the (y, z) tangent plane and the x sentinel
        //    survives. Mutation (write vel.v.z/x unconditionally, the marko
        //    version) -> red here.
        GravityField sideways;
        sideways.regime = GravityRegime::PosX;
        sideways.global = vec3{9.81f, 0.0f, 0.0f};
        brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
        vel.v = vec3{0.25f, 0.0f, 0.0f};
        ai_patrol_step(reg, coarse, fine, kLayer, kSimDt, &sideways);
        CHECK(ai_owns_motion(reg, e));
        CHECK(vel.v.x == 0.25f); // gravity-axis sentinel untouched
        // The tangent write happened (toward the node column) or is an owned
        // zero if the body already stands on it — both are claims, not shoves;
        // what may NOT happen is a write along x. Nudge the body off any column
        // and the tangent speed must be real:
        reg.get<Transform>(e).pos.y += 3.0f * kCellSize;
        brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
        ai_patrol_step(reg, coarse, fine, kLayer, kSimDt, &sideways);
        CHECK(vel.v.x == 0.25f);
        CHECK(vel.v.y != 0.0f || vel.v.z != 0.0f);

        // 4. ARBITRATION: an Ai-owned body is NOT re-steered — the claim guard,
        //    with the polarity run both ways (owned -> untouched).
        brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
        vel.v = vec3{0.0f, 7.0f, 0.0f};
        ai_patrol_step(reg, coarse, fine, kLayer, kSimDt);
        CHECK(vel.v.y == 7.0f);
    }
}
