// Samosbor HUD / crowd tests -- the beat, the alarm, the samosbor rumours, and the
// population ratchet the fog spawner is one keyword away from.
//
// suite_samosbor.inl pins the clock and the pure curve; suite_samosbor2.inl pins the
// fog-spawn seam. This file exists for the three things neither of them reaches:
//
//   * **The ratchet, A/B.** samosbor.h used to assert the fog population "cannot
//     ratchet by wiring the spawner, because the removal is inside the same function as
//     the addition". That is true only of an UNCONDITIONAL call site. `activeEnded` is
//     delivered on the tick `samosbor_step` moves the phase to Aftermath, so the
//     natural-looking `if (samosbor_active(st)) samosbor_fog_tick(...)` is false on
//     exactly the tick that carries the despawn edge, and `warningBegan` -- the safety
//     net -- is swallowed the same way. Both forms are driven here over two complete
//     cycles, with one seed and one anchor sequence. Unconditional returns to the
//     authored baseline; guarded strands a cycle's worth of monsters and then adds more
//     on top of them. The whole point is that the guarded form is the one that looks
//     correct.
//   * **The beat is a LEVEL, not an edge.** `samosbor_beat` takes no transition, so the
//     banner cannot go stale, cannot be missed by a skipped tick, and needs no latch in
//     `src/app/main.cpp`. Driven tick by tick at z = 0 and COUNTED, because "the Warning
//     banner holds for the whole 30 s window" is a claim about 3750 consecutive ticks
//     and nothing else in the tree would notice it shrinking to four seconds.
//   * **The samosbor rumours.** `rumour.cpp` had zero test coverage of any kind. Its
//     four clock-driven kinds are the only channel in the game that says what a variant
//     does before it does it, and the five-argument shim must keep every one of them
//     unreachable -- `src/app/main.cpp` calls the shim today, so a kind that leaks
//     through it is a wrong sentence on a live HUD.
//
// Also a regression guard for the finding that mattered most in the port: the
// unsheltered cost is a ONE-SHOT at the seal, not a DoT. Billed per tick, 40 minutes of
// samosbor at |z| = 50 is 300000 ticks x 4 HP = 1.2 million damage against a body with
// a few hundred. Counted here as "sealed fires once per cycle", which is the shape of
// the bug rather than one of its symptoms.
//
// A .inl and not a .cpp: game_test.cpp owns CHECK and the `using namespace`, so the
// include has to land after them. Own includes for the systems under test.

#include <cstring>

#include "core/tick.h"
#include "ecs/components.h"
#include "game/embody.h"      // NpcRef -- what makes a body a speaker
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/mob_spawn.h"
#include "game/npc_pool.h"
#include "game/rumour.h"
#include "game/samosbor.h"
#include "world/macro_grid.h"
#include "world/world.h"

namespace samosborhud_detail {

// Mobs stand on the module's ground storey, one cell above the base slab
// (mob_spawn.cpp's kGroundZ). Restated because fog placement is only legal there.
inline constexpr int kTestGroundZ = 1;

// A cell centre on the ground storey -- where a pressure anchor has to sit for the fog
// spawner's z-consistency test to have any legal candidates at all.
inline giga::vec3 ground_pos(int cx, int cy) {
    return giga::vec3{(static_cast<float>(cx) + 0.5f) * giga::kCellSize,
                      (static_cast<float>(cy) + 0.5f) * giga::kCellSize,
                      static_cast<float>(kTestGroundZ) * giga::kCellSize + 0.9f};
}

// Air cells in the fog spawner's legal annulus around a cell. A PRECONDITION, not a
// feature test: an anchor with no standable arrival cell would fail every spawn
// assertion below for a reason that has nothing to do with the budget, and checking it
// separately is what turns "spawned == 0" from a mystery into a diagnosis.
inline int annulus_air(const giga::World& w, int acx, int acy) {
    int n = 0;
    for (int dy = -giga::game::kThreatOuterRadiusCells;
         dy <= giga::game::kThreatOuterRadiusCells; ++dy)
        for (int dx = -giga::game::kThreatOuterRadiusCells;
             dx <= giga::game::kThreatOuterRadiusCells; ++dx) {
            const int r2 = dx * dx + dy * dy;
            if (r2 < giga::game::kThreatNearRadiusCells *
                         giga::game::kThreatNearRadiusCells)
                continue;
            if (r2 > giga::game::kThreatOuterRadiusCells *
                         giga::game::kThreatOuterRadiusCells)
                continue;
            if (w.grid().cell(acx + dx, acy + dy, kTestGroundZ) == giga::kCellAir) ++n;
        }
    return n;
}

// Is every byte of `s` a legal UTF-8 sequence?
//
// Not paranoia about snprintf. Every player-facing string in hand-written source in this
// tree is written as \x escapes, so the bytes are identical whatever the editing host's
// code page is; the Cyrillic ones are wrapped across several string literals to stay
// inside the column limit; and a wrap placed one token early SPLITS a two-byte
// character. The result still compiles, still prints, and renders as two replacement
// glyphs -- invisible to every other test in the tree. This is the check that sees it.
// Literals are plain `int` and not `0x80u`: `*p` is an unsigned char, so it promotes to
// int, and mixing it with an unsigned literal is a signed/unsigned comparison. This tree
// builds /W4 with zero warnings.
inline bool valid_utf8(const char* s) {
    const unsigned char* p = reinterpret_cast<const unsigned char*>(s);
    while (*p != 0) {
        int need;
        if (*p < 0x80) need = 0;
        else if ((*p & 0xE0) == 0xC0) need = 1;
        else if ((*p & 0xF0) == 0xE0) need = 2;
        else if ((*p & 0xF8) == 0xF0) need = 3;
        else return false;   // a continuation byte, or 0xF8+, where a lead must be
        ++p;
        for (int i = 0; i < need; ++i, ++p)
            if ((*p & 0xC0) != 0x80) return false;
    }
    return true;
}

// A line is deliverable: non-empty, in bounds, and not a mangled multi-byte sequence.
inline bool speakable(const char* s, std::size_t cap) {
    return s[0] != 0 && std::strlen(s) < cap && valid_utf8(s);
}

// What one drive of the clock plus the fog spawner observed.
struct DriveResult {
    std::uint32_t cycles = 0;          // cycleEnded transitions seen
    std::uint32_t seals = 0;           // sealed transitions seen; must equal cycles
    std::uint32_t peakFog = 0;         // most FogSpawn heads live at once
    std::uint32_t endFog[2] = {0, 0};  // fog heads still alive at each cycleEnded
    std::uint32_t totalSpawned = 0;
    std::uint32_t totalDespawned = 0;
    std::uint32_t authoredAtEnd = 0;   // non-fog heads left on the layer
    std::uint64_t ticks = 0;
};

// Drive two complete samosbor cycles at |z| = 50 with the fog spawner attached, and
// report what the population did.
//
// `guardCallOnActive` is the whole experiment: false is the call site samosbor.h asks
// for, true is the one that looks right and leaks.
//
// The anchor MOVES at each cycle boundary, which is not decoration. With a fixed anchor
// the leaked heads stay inside the 40 m census bubble, the next cycle's demand comes out
// at zero, and the bug reads as "7 heads that should not be there" rather than as growth.
// A player walks: 85 m is 14 s at the demo's 6 m/s, and a samosbor cycle at |z| = 50 is
// over 15 minutes. Moving is the normal case, and it is what turns the leak into a
// ratchet.
inline DriveResult drive_two_cycles(const giga::World& w, int floorZ,
                                    std::uint8_t danger, giga::vec3 anchorA,
                                    giga::vec3 anchorB, std::uint32_t authored,
                                    bool guardCallOnActive) {
    using namespace giga;
    using namespace giga::game;

    DriveResult out;
    Registry reg;
    const LayerId layer = 0;

    // The floor's own population, placed OUTSIDE both census bubbles so it neither
    // suppresses fog demand nor gets counted as a fog head. It exists for exactly one
    // assertion: `despawn_layer_fog_mobs` must take the tagged heads and nothing else.
    for (std::uint32_t i = 0; i < authored; ++i) {
        Entity e = reg.create();
        Transform tr;
        tr.pos = vec3{anchorA.x + static_cast<float>(i) * 0.5f, anchorA.y + 90.0f,
                      anchorA.z};
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<MobRef>(e, MobRef{0, 1, 10, 10});
    }

    SamosborRng rng{0x5A303B0Du};
    SamosborState st;
    samosbor_arm(st, kSamosborArmFloorMs);
    vec3 anchor = anchorA;

    // 600000 ticks is 4800 s of sim time. Two cycles at |z| = 50 cost ~1920 s (two
    // ~15 min Active phases plus ~120 s of everything else), so the guard is 2.5x the
    // budget and exists only so a broken clock cannot hang ctest.
    for (std::uint64_t t = 0; t < 600000u && out.cycles < 2u; ++t) {
        const SamosborTransition tr =
            samosbor_step(st, static_cast<std::uint32_t>(kSimStepMs), floorZ, rng);
        if (tr.sealed) ++out.seals;

        FogTickReport rep;
        if (!guardCallOnActive || samosbor_active(st))
            rep = samosbor_fog_tick_at(reg, w, st, tr, layer, anchor, floorZ, danger, t);
        out.totalSpawned += rep.spawned;
        out.totalDespawned += rep.despawned;

        // The count can only move on a tick that spawned or despawned, so sampling here
        // is exact AND avoids an O(n) sweep on the other 99.9% of ticks.
        if (rep.spawned != 0u || rep.despawned != 0u) {
            const std::uint32_t live = count_layer_fog_mobs(reg, layer);
            if (live > out.peakFog) out.peakFog = live;
        }

        if (tr.cycleEnded) {
            out.endFog[out.cycles < 2u ? out.cycles : 1u] =
                count_layer_fog_mobs(reg, layer);
            ++out.cycles;
            anchor = anchorB;   // the player walked
        }
        out.ticks = t + 1u;
    }

    out.authoredAtEnd = count_layer_mobs(reg, layer) - count_layer_fog_mobs(reg, layer);
    return out;
}

} // namespace samosborhud_detail

static void test_samosborhud_all() {
    using namespace samosborhud_detail;

    { // ---- test_samosborhud_beat_is_a_level_not_an_edge ---------------------
        // Drive one whole cycle at z = 0 a tick at a time and COUNT the beats. The point
        // is duration: an edge-driven banner would be one tick long, and no assertion
        // about a single `samosbor_beat` return value would ever say so.
        //
        // z = 0 and not -50 so the Active phase is ~19-35 s rather than ~15 min: the
        // whole cycle is then ~80 s of sim time and the exact tick counts stay legible.
        SamosborRng rng{0x5A303B0Du};
        SamosborState st;
        // Arm at the floor so the drive does not spend the 120..180 s new-game timer.
        // kSamosborArmFloorMs is 33 s: 3 s of Idle then the 30 s window. Both are exact
        // multiples of kSimStepMs (8), which is what makes the tick counts below exact
        // rather than off-by-one -- each boundary lands with dt fully consumed.
        samosbor_arm(st, kSamosborArmFloorMs);
        CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
        CHECK(st.phaseMs == kSamosborArmFloorMs - kSamosborWarningMs);
        CHECK(st.phaseMs == 3000u);

        std::uint32_t nIdleNone = 0, nWarning = 0, nImpact = 0, nSeal = 0;
        std::uint32_t nClear = 0, nNoneInActive = 0, nBeatInIdle = 0;
        std::uint32_t seals = 0, cycles = 0;
        bool alarmAgrees = true;
        bool pulseInRange = true;
        bool warningNeverSilent = true;
        std::uint32_t activeTotalMs = 0;

        for (int i = 0; i < 200000 && cycles == 0; ++i) {
            const SamosborTransition tr =
                samosbor_step(st, static_cast<std::uint32_t>(kSimStepMs), 0, rng);
            if (tr.sealed) ++seals;
            if (tr.activeBegan) activeTotalMs = st.phaseTotalMs;
            if (tr.cycleEnded) ++cycles;

            const SamosborBeat b = samosbor_beat(st);
            const SamosborAlarm a = samosbor_alarm(st);
            // The alarm and the beat are one answer. Two readings that can disagree is
            // the failure mode `samosbor_alarm` exists to remove, so it is asserted on
            // every tick of a whole cycle rather than at three sampled states.
            if (a.beat != static_cast<std::uint8_t>(b)) alarmAgrees = false;
            if (a.on != (b != SamosborBeat::None)) alarmAgrees = false;
            if (a.on && !speakable(a.text, kSamosborBeatTextCap)) alarmAgrees = false;
            if (!a.on && a.text[0] != 0) alarmAgrees = false;
            if (a.pulse < 0.0f || a.pulse > 1.0f) pulseInRange = false;

            switch (static_cast<SamosborPhase>(st.phase)) {
                case SamosborPhase::Idle:
                    if (b == SamosborBeat::None) ++nIdleNone; else ++nBeatInIdle;
                    break;
                case SamosborPhase::Warning:
                    if (b == SamosborBeat::Warning) ++nWarning;
                    else warningNeverSilent = false;
                    break;
                case SamosborPhase::Active:
                    if (b == SamosborBeat::Impact) ++nImpact;
                    else if (b == SamosborBeat::Seal) ++nSeal;
                    else ++nNoneInActive;
                    break;
                default:
                    if (b == SamosborBeat::Clear) ++nClear;
                    break;
            }
        }

        CHECK(cycles == 1u);
        CHECK(alarmAgrees);
        CHECK(pulseInRange);
        CHECK(warningNeverSilent);
        // NOTHING on Idle, and the fifth beat that is not there is deliberate: a "you
        // survived N" line keyed on early Idle would fire on the first frame of a new
        // run and on every single floor arrival, because samosbor_new_game and
        // samosbor_enter_floor both arm straight into Idle. Clear covers that beat.
        CHECK(nBeatInIdle == 0u);
        // Exactly 3000 / kSimStepMs = 375, and the two off-by-ones that look like they
        // should make it 374 cancel each other out. The loop reads state AFTER each
        // step, so the armed 3000 ms that samosbor_arm wrote is never observed at full
        // value — but the tick that ends the cycle transitions BACK to Idle and IS
        // observed, which puts the missing observation back. This asserted 374 when
        // written and measured 375; the count was right and the reasoning was one step
        // short. Stated as the equation rather than as a literal so it survives a
        // tick-rate change.
        CHECK(nIdleNone == 3000u / static_cast<std::uint32_t>(kSimStepMs));

        // **THE WHOLE 30 s WINDOW, TO THE TICK.** 30000 / 8 = 3750. This is the
        // assertion the file exists for: the banner is not a 4 s flash on an edge, it is
        // the level for the entire decision window, with the countdown inside it.
        CHECK(nWarning == kSamosborWarningMs / static_cast<std::uint32_t>(kSimStepMs));
        CHECK(nWarning == 3750u);

        // Impact is the first 4 s of Active, exactly. It cannot be truncated by the seal
        // at z = 0: the shortest Active here is 30 s * 0.75 * 0.82 = 18.45 s and the
        // latest seal is electric's at 14 s, so the earliest seal lands 4.45 s in.
        CHECK(activeTotalMs >= 18000u);
        CHECK(nImpact ==
              kSamosborBeatImpactMs / static_cast<std::uint32_t>(kSimStepMs));   // 500
        // Seal holds for its 3 s window. One tick of slack, because the Active phase's
        // duration is an arbitrary millisecond count and the seal therefore does not
        // land on a tick boundary the way the 30 s window does.
        CHECK(nSeal >= kSamosborBeatSealMs / static_cast<std::uint32_t>(kSimStepMs));
        CHECK(nSeal <=
              kSamosborBeatSealMs / static_cast<std::uint32_t>(kSimStepMs) + 1u);
        // Clear expires INSIDE the Aftermath phase, which is what the static_assert in
        // samosbor.h promises. If it did not, this count would come out at 12 s of ticks
        // rather than 4.
        CHECK(nClear + 1u >=
              kSamosborBeatClearMs / static_cast<std::uint32_t>(kSimStepMs));
        CHECK(nClear <= kSamosborBeatClearMs / static_cast<std::uint32_t>(kSimStepMs));
        CHECK(nClear < kSamosborAftermathMs / static_cast<std::uint32_t>(kSimStepMs));
        // And the middle of a long Active is deliberately quiet. A banner that never
        // goes away is a banner the player stops reading.
        CHECK(nNoneInActive > 0u);

        // ONE seal for the whole cycle -- the DoT regression, counted. At 4 HP a tick a
        // 15-minute Active at |z| = 50 would bill 450000 HP instead of 4.
        CHECK(seals == 1u);
        CHECK(samosbor_unsheltered_pressure(SamosborVariant::Classic).hpDamage ==
              kSamosborUnshelteredHp);
    }

    { // ---- test_samosborhud_alarm_is_one_call --------------------------------
        // The shape the call site depends on: one call, no buffer, no latch, and a
        // string that is safe to hand straight to ImGui::TextColored("%s", ...).
        SamosborState off;   // Idle, never armed
        const SamosborAlarm quiet = samosbor_alarm(off);
        CHECK(!quiet.on);
        CHECK(quiet.text[0] == 0);
        CHECK(quiet.pulse == 0.0f);
        CHECK(quiet.beat == static_cast<std::uint8_t>(SamosborBeat::None));

        // The measured ceiling. samosbor.h claims the longest beat is Warning at 121
        // bytes: 73 of literal, plus 41 for the longest display name, plus 2 for the
        // seconds and 5 for a saturated count. Built here rather than trusted, because
        // it is the number kSamosborBeatTextCap (160) was chosen against.
        SamosborState worst;
        worst.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
        worst.variant = static_cast<std::uint8_t>(SamosborVariant::Meat);
        worst.phaseMs = kSamosborWarningMs;        // -> "30", two digits
        worst.phaseTotalMs = kSamosborWarningMs;
        worst.count = 0xFFFFu;                     // -> "65535", five digits
        const SamosborAlarm loud = samosbor_alarm(worst);
        CHECK(loud.on);
        CHECK(loud.beat == static_cast<std::uint8_t>(SamosborBeat::Warning));
        CHECK(valid_utf8(loud.text));
        CHECK(std::strlen(loud.text) == 121u);
        // 38 bytes of margin, which is one more display name's worth. Stated as an
        // equation so a renamed variant that eats the margin fails here rather than
        // truncating on the HUD.
        CHECK(std::strlen(loud.text) + 38u == kSamosborBeatTextCap - 1u);

        // Every one of the four live beats renders. Built by hand because reaching Seal
        // and Clear honestly costs a whole cycle, which the block above already drives.
        SamosborState imp = worst;
        imp.phase = static_cast<std::uint8_t>(SamosborPhase::Active);
        imp.phaseTotalMs = 900u * 1000u;
        imp.phaseMs = 900u * 1000u;                // elapsed 0 -> Impact
        const SamosborAlarm impact = samosbor_alarm(imp);
        CHECK(impact.beat == static_cast<std::uint8_t>(SamosborBeat::Impact));
        CHECK(speakable(impact.text, kSamosborBeatTextCap));

        SamosborState sea = imp;
        sea.variant = static_cast<std::uint8_t>(SamosborVariant::Classic);
        sea.sealed = true;
        sea.phaseMs = kSamosborSealBeforeEndMs - 1000u;   // 1 s past the seal
        const SamosborAlarm seal = samosbor_alarm(sea);
        CHECK(seal.beat == static_cast<std::uint8_t>(SamosborBeat::Seal));
        CHECK(speakable(seal.text, kSamosborBeatTextCap));

        SamosborState aft = imp;
        aft.phase = static_cast<std::uint8_t>(SamosborPhase::Aftermath);
        aft.phaseTotalMs = kSamosborAftermathMs;
        aft.phaseMs = kSamosborAftermathMs;               // elapsed 0 -> Clear
        const SamosborAlarm clear = samosbor_alarm(aft);
        CHECK(clear.beat == static_cast<std::uint8_t>(SamosborBeat::Clear));
        CHECK(speakable(clear.text, kSamosborBeatTextCap));

        // The Seal branch's ordering trap: `phaseMs <= sealAt` must be tested BEFORE the
        // subtraction, or the unsigned difference wraps for the whole first half of
        // every Active phase and the Seal banner becomes permanent. Mid-phase with
        // `sealed` already true is exactly that case.
        SamosborState mid = sea;
        mid.phaseMs = 400u * 1000u;
        CHECK(samosbor_beat(mid) == SamosborBeat::None);

        // A raw buffer below the cap is refused rather than truncated, and `out` is left
        // untouched so a caller can hold its previous line. `sizeof(small)`, never a
        // hand-written 160: claiming a cap the buffer does not have is how a refusal test
        // turns into the overflow it was written to prevent.
        char small[64] = {'x', 0};
        CHECK(!samosbor_beat_text(worst, small, sizeof(small)));
        CHECK(small[0] == 'x');
        char full[kSamosborBeatTextCap] = {'x', 0};
        CHECK(!samosbor_beat_text(off, full, sizeof(full)));   // beat None, cap fine
        CHECK(full[0] == 'x');

        // The fast pulse is the TAIL of the window, not the whole of it. 4 Hz over the
        // last 5 s is the one place in the cycle where the RATE carries information, and
        // an alarm that always blinks fast is one the player stops reading.
        std::uint32_t slowPeaks = 0, fastPeaks = 0;
        float prev = -1.0f;
        bool wasRising = false;
        SamosborState win = worst;
        win.count = 0;
        for (std::uint32_t left = kSamosborWarningMs;
             left > static_cast<std::uint32_t>(kSimStepMs);
             left -= static_cast<std::uint32_t>(kSimStepMs)) {
            win.phaseMs = left;
            const float p = samosbor_beat_pulse01(win);
            // A rise-then-fall latch, and NOT a "p dropped below the previous sample
            // while above 0.9" test. The 250 ms fast period is 31 samples wide on an
            // 8 ms grid, so several consecutive samples sit above 0.9 on the way down
            // and a bare threshold counts the same peak three or four times. The latch
            // counts one apex per period, which is what a period count means.
            if (p > prev) {
                wasRising = true;
            } else if (wasRising && p < prev) {
                if (left < kSamosborBeatFastPulseMs) ++fastPeaks; else ++slowPeaks;
                wasRising = false;
            }
            prev = p;
        }
        // 25 s of 1 Hz then 5 s of 4 Hz -> 25 and 20 apexes. Bands with one period of
        // slack at each end, because the sweep starts and stops mid-period.
        CHECK(slowPeaks >= 24u);
        CHECK(slowPeaks <= 26u);
        CHECK(fastPeaks >= 19u);
        CHECK(fastPeaks <= 21u);
        CHECK(fastPeaks > slowPeaks * 3u / 4u);   // 4x the rate over 1/5 of the window
    }

    { // ---- test_samosborhud_variant_prose_is_paired --------------------------
        // The variant tables are three parallel arrays indexed by the enum, and the ONE
        // thing that can be silently wrong in them is the PAIRING: a shifted row gives
        // maronary's clause to meat and nothing else in the game notices. Maronary and
        // Veretar are pinned because they are the two whose confusion costs the player
        // most -- one rewrites what your items are, the other deletes them outright.
        CHECK(std::strcmp(samosbor_variant_effect_ru(SamosborVariant::Maronary),
                          "\xd0\xb2\xd0\xb5\xd1\x89\xd0\xb8 \xd1\x81\xd1\x82\xd0\xb0"
                          "\xd0\xbd\xd1\x83\xd1\x82 \xd0\xbd\xd0\xb5 \xd1\x81\xd0\xb2"
                          "\xd0\xbe\xd0\xb8\xd0\xbc\xd0\xb8") == 0);
        CHECK(std::strcmp(samosbor_variant_effect_ru(SamosborVariant::Veretar),
                          "\xd1\x87\xd1\x82\xd0\xbe-\xd1\x82\xd0\xbe \xd0\xb8\xd1\x81"
                          "\xd1\x87\xd0\xb5\xd0\xb7\xd0\xbd\xd0\xb5\xd1\x82 \xd0\xb8 "
                          "\xd0\xbe\xd1\x81\xd1\x82\xd0\xb0\xd0\xb2\xd0\xb8\xd1\x82 "
                          "\xd0\xb1\xd0\xb5\xd0\xbb\xd1\x8b\xd0\xb9 \xd0\xbf\xd0\xb5"
                          "\xd1\x81\xd0\xbe\xd0\xba") == 0);
        CHECK(std::strcmp(samosbor_variant_name_ru(SamosborVariant::Meat),
                          "\xd0\x9a\xd1\x80\xd0\xb0\xd1\x81\xd0\xbd\xd1\x8b\xd0\xb9 "
                          "\xd0\xb1\xd0\xb8\xd0\xbe\xd0\xbb\xd0\xbe\xd0\xb3\xd0\xb8"
                          "\xd1\x87\xd0\xb5\xd1\x81\xd0\xba\xd0\xb8\xd0\xb9") == 0);
        // The two byte figures samosbor.h and rumour.h size their caps against.
        CHECK(std::strlen(samosbor_variant_name_ru(SamosborVariant::Meat)) == 41u);
        CHECK(std::strlen(samosbor_variant_effect_ru(SamosborVariant::Veretar)) == 68u);

        // Every row present, well-formed, and distinct from every other. A duplicated
        // clause is the other way a shifted row hides.
        bool allOk = true, allDistinct = true;
        for (std::size_t i = 0; i < kSamosborVariantCount; ++i) {
            const SamosborVariant v = static_cast<SamosborVariant>(i);
            if (!valid_utf8(samosbor_variant_name_ru(v))) allOk = false;
            if (!valid_utf8(samosbor_variant_effect_ru(v))) allOk = false;
            if (samosbor_variant_name_ru(v)[0] == 0) allOk = false;
            if (samosbor_variant_effect_ru(v)[0] == 0) allOk = false;
            for (std::size_t j = i + 1; j < kSamosborVariantCount; ++j)
                if (std::strcmp(samosbor_variant_effect_ru(v),
                                samosbor_variant_effect_ru(
                                    static_cast<SamosborVariant>(j))) == 0)
                    allDistinct = false;
        }
        CHECK(allOk);
        CHECK(allDistinct);

        // The two clamped accessors, which exist because SamosborState::variant is a raw
        // byte a truncated save can put outside 0..6 and the HUD reads it every frame. An
        // unclamped index there is a read past a 7-pointer array handed to snprintf.
        CHECK(samosbor_variant_name_ru(static_cast<SamosborVariant>(200)) ==
              samosbor_variant_name_ru(SamosborVariant::Classic));
        CHECK(samosbor_variant_effect_ru(static_cast<SamosborVariant>(7)) ==
              samosbor_variant_effect_ru(SamosborVariant::Classic));
    }

    { // ---- test_samosborhud_fog_population_returns_to_baseline ---------------
        // **THE RATCHET, A/B.** Two complete cycles, one seed, one anchor sequence, one
        // difference: whether the fog tick is called unconditionally or behind
        // `if (samosbor_active(st))`.
        World w;
        const FloorSpec& spec = floor_spec(FloorKind::Derelict);
        generate_floor(w, -50, spec, 11u);
        const std::uint8_t danger = danger_for_hostility(spec.hostility);
        CHECK(danger == 5);                       // Derelict is the high-risk floor
        CHECK(danger >= kFogHighRiskDanger);

        // Preconditions, so a failure below is a diagnosis rather than a mystery. Both
        // anchors must offer standable arrival cells in the 24..40 m annulus; 32
        // placement tries against a 47.8%-of-square geometric filter need a few hundred
        // air cells to be a certainty rather than a coin flip.
        //
        // (34, 94) is 42.4 cells = 84.9 m from (64, 64), and that separation is chosen
        // rather than convenient. The first cycle's stranded heads sit in the 24..40 m
        // annulus around anchorA, so the nearest of them is 84.9 - 40 = 44.9 m from
        // anchorB -- outside its 40 m census radius. If the two anchors were 80 m apart
        // the boundary heads would land at exactly 40 m, `d2 > outerR2` would count them,
        // and the second cycle's demand would be quietly reduced by the very leak the
        // block is trying to measure. Toroidal distance, not Euclidean: both axes wrap at
        // kWorldExtent (256 m), and 84.9 m is the shorter way round on each.
        CHECK(annulus_air(w, 64, 64) > 200);
        CHECK(annulus_air(w, 34, 94) > 200);
        const vec3 anchorA = ground_pos(64, 64);
        const vec3 anchorB = ground_pos(34, 94);

        const std::uint32_t kAuthored = 5;
        const DriveResult good =
            drive_two_cycles(w, -50, danger, anchorA, anchorB, kAuthored, false);
        const DriveResult bad =
            drive_two_cycles(w, -50, danger, anchorA, anchorB, kAuthored, true);

        // Both drives really did complete two cycles, and each cycle sealed exactly
        // once. The ratchet comparison is only meaningful if the clocks agree.
        CHECK(good.cycles == 2u);
        CHECK(bad.cycles == 2u);
        CHECK(good.seals == 2u);
        CHECK(bad.seals == 2u);
        CHECK(good.ticks == bad.ticks);

        // The fog really ran. A drive where nothing spawned would satisfy every
        // "returns to baseline" assertion vacuously, which is the way this test could
        // pass while proving nothing.
        CHECK(good.totalSpawned > 0u);
        CHECK(good.peakFog > 0u);
        // Saturation, not accumulation: with the anchor stationary inside a cycle the
        // census counts every head fog added (they all land inside the outer radius by
        // construction), so demand falls to zero at the target. The target at |z| = 50 is
        // lerp(3,7,1.0) = 7 scaled by the variant's spawnMult and capped at the high-risk
        // 10, so no cycle may ever hold more than 10 at once.
        //
        // The UPPER bound is the correctness claim -- it is the back-off actually holding
        // over ~450 spawn attempts per Active phase, which is the assertion samosbor.h
        // calls "the one function whose absence is a crash rather than a balance
        // complaint". The lower bound is only non-vacuity and `totalSpawned > 0` already
        // carries that, so it is left at 1 rather than pinned to the target: a floor whose
        // annulus happens to be tight can legitimately lose heads to the AIR test.
        //
        // Cast because kThreatSpikeMax is a uint8_t, which promotes to int and would
        // otherwise be a signed/unsigned comparison against a uint32_t under /W4.
        CHECK(good.peakFog <= static_cast<std::uint32_t>(kThreatSpikeMax));
        CHECK(good.peakFog >= 1u);

        // **THE ASSERTION.** Unconditional: every head fog put on the floor is gone by
        // the end of the cycle that spawned it, twice, and what is left is exactly the
        // authored population.
        CHECK(good.endFog[0] == 0u);
        CHECK(good.endFog[1] == 0u);
        CHECK(good.totalDespawned == good.totalSpawned);
        CHECK(good.authoredAtEnd == kAuthored);

        // Guarded: identical clock, identical spawns, and NOTHING is ever removed. The
        // despawn edge arrives on a tick whose phase is already Aftermath, so the guard
        // is false exactly when the cleanup is needed; `warningBegan`, the safety net
        // written for precisely this case, is swallowed the same way.
        CHECK(bad.totalDespawned == 0u);
        CHECK(bad.endFog[0] > 0u);
        // And it COMPOUNDS once the player moves. The second cycle's census looks at a
        // fresh bubble 85 m away, reports it empty, and fills it on top of the heads
        // stranded by the first. Both of these assertions rest on the anchor-separation
        // precondition above; if that CHECK fails, these two are the symptom, not the bug.
        CHECK(bad.endFog[1] > bad.endFog[0]);
        CHECK(bad.peakFog > good.peakFog);
        // The authored population is untouched either way: despawn_layer_fog_mobs takes
        // the tagged heads and only those.
        CHECK(bad.authoredAtEnd == kAuthored);

        // Scale, so the leak is a number rather than an adjective. Two cycles already
        // strand more than one target band's worth of permanent extra monsters, and every
        // later cycle adds another band on a floor that is in samosbor 94% of the time.
        CHECK(bad.endFog[1] >= static_cast<std::uint32_t>(kThreatPressureMin) * 2u);
    }

    { // ---- test_samosborhud_samosbor_rumours ---------------------------------
        // rumour.cpp had no test coverage of any kind before this block.
        Registry reg;
        NpcPool pool;
        pool.init();
        const LayerId layer = 0;
        const int floorZ = -50;

        // A listener plus a crowd. Positions are irrelevant to rumour_for (it takes the
        // speaker id), but nearest_speaker needs them, so everyone stands together.
        Transform at;
        at.pos = vec3{80.0f, 80.0f, 4.0f};
        at.layer = layer;

        const NpcId me = pool.spawn();
        pool.hp(me) = 30000;
        pool.max_hp(me) = 30000;
        pool.faction(me) = static_cast<std::uint16_t>(Faction::Citizens);
        pool.set_player(me, true);
        Entity player = reg.create();
        reg.emplace<Transform>(player, at);
        reg.emplace<NpcRef>(player, NpcRef{me});
        reg.emplace<CameraTag>(player, CameraTag{});

        // A live mob on the layer, so the Threat band has something true to say. Without
        // it Threat falls back to the duty-cycle line and a Fog answer would no longer
        // identify a Fog-band speaker, which is what the scan below relies on.
        Entity mob = reg.create();
        reg.emplace<Transform>(mob, at);
        reg.emplace<MobRef>(mob, MobRef{static_cast<std::uint8_t>(MobKind::Shadow), 1,
                                        100, 100});

        constexpr int kCrowd = 64;
        NpcId crowd[kCrowd];
        for (int i = 0; i < kCrowd; ++i) {
            crowd[i] = pool.spawn();
            pool.hp(crowd[i]) = 30000;
            pool.max_hp(crowd[i]) = 30000;
            pool.faction(crowd[i]) = static_cast<std::uint16_t>(Faction::Citizens);
            Entity b = reg.create();
            reg.emplace<Transform>(b, at);
            reg.emplace<NpcRef>(b, NpcRef{crowd[i]});
        }
        CHECK(nearest_speaker(reg, layer) != kInvalidNpc);

        // **THE SHIM MUST STAY MUTE.** src/app/main.cpp calls the five-argument form, so
        // any samosbor kind reachable through it is a wrong sentence on a live HUD. The
        // trap is Lull: a default SamosborState is Idle with phaseMs == 0, the shortest
        // remainder there is, so the obvious "is the fog close?" predicate would make a
        // never-armed clock the most urgent state in the machine.
        bool shimMute = true;
        std::uint32_t shimFogBand = 0;
        char line[160];
        bool shimSpeaks = true;
        for (int i = 0; i < kCrowd; ++i) {
            const Rumour r = rumour_for(reg, pool, crowd[i], layer, floorZ);
            if (!r.valid) shimSpeaks = false;
            if (!rumour_text(r, line, sizeof(line))) shimSpeaks = false;
            else if (!speakable(line, sizeof(line))) shimSpeaks = false;
            if (r.kind == RumourKind::Imminent || r.kind == RumourKind::Variant ||
                r.kind == RumourKind::Veteran || r.kind == RumourKind::Lull)
                shimMute = false;
            if (r.kind == RumourKind::Fog) ++shimFogBand;
        }
        CHECK(shimMute);
        CHECK(shimSpeaks);
        // The Fog band is 25% of the deterministic split, so a 64-body crowd should hold
        // a dozen or so. Asserted only as "not zero", because the exact share depends on
        // the pool ids the crowd happened to get and the point here is that the scan below
        // has a subject at all.
        CHECK(shimFogBand > 0u);

        // A Fog-band speaker: the one slot that follows the clock.
        NpcId fogSpeaker = kInvalidNpc;
        for (int i = 0; i < kCrowd && fogSpeaker == kInvalidNpc; ++i)
            if (rumour_for(reg, pool, crowd[i], layer, floorZ).kind == RumourKind::Fog)
                fogSpeaker = crowd[i];
        CHECK(fogSpeaker != kInvalidNpc);

        // --- WARNING overrides EVERY speaker. For 30 s the whole floor tells you the
        //     same urgent thing, which is worth more than a body still having an opinion
        //     about crate prices.
        SamosborState warn;
        warn.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
        warn.phaseTotalMs = kSamosborWarningMs;
        warn.phaseMs = 12001u;                   // -> 13 s, rounded UP
        warn.variant = static_cast<std::uint8_t>(SamosborVariant::Maronary);
        bool allImminent = true;
        for (int i = 0; i < kCrowd; ++i) {
            const Rumour r = rumour_for(reg, pool, crowd[i], layer, floorZ, warn);
            if (r.kind != RumourKind::Imminent) allImminent = false;
            if (r.value != 13) allImminent = false;
            if (r.subject != warn.variant) allImminent = false;
            if (!rumour_text(r, line, sizeof(line))) allImminent = false;
            else if (!speakable(line, sizeof(line))) allImminent = false;
        }
        CHECK(allImminent);

        // --- ACTIVE: the Fog slot names the variant and what it does. This is the only
        //     place in the game that states a variant's effect in words.
        SamosborState act;
        act.phase = static_cast<std::uint8_t>(SamosborPhase::Active);
        act.phaseTotalMs = 900u * 1000u;
        act.phaseMs = 500u * 1000u;
        act.variant = static_cast<std::uint8_t>(SamosborVariant::Veretar);
        act.count = 3;
        const Rumour var = rumour_for(reg, pool, fogSpeaker, layer, floorZ, act);
        CHECK(var.kind == RumourKind::Variant);
        CHECK(var.subject == act.variant);
        CHECK(var.value == 3);
        CHECK(rumour_text(var, line, sizeof(line)));
        CHECK(speakable(line, sizeof(line)));
        // The crowd and the HUD alarm must name the variant with the SAME word; two
        // spellings of one event reaching the player is the drift a shared table exists
        // to stop. std::strstr, because the rumour wraps the name in a sentence.
        CHECK(std::strstr(line, samosbor_variant_name_ru(SamosborVariant::Veretar)) !=
              nullptr);
        CHECK(std::strstr(line, samosbor_variant_effect_ru(SamosborVariant::Veretar)) !=
              nullptr);

        // --- IDLE, fog close: the beat the crowd had nothing to say about. Two forms,
        //     split at 90 s, both rounding UP.
        SamosborState soon;
        soon.phase = static_cast<std::uint8_t>(SamosborPhase::Idle);
        // A surface-sized Idle, so every `phaseMs` set below stays <= phaseTotalMs and the
        // state is one the clock could actually produce.
        soon.phaseTotalMs = 30u * 60u * 1000u;
        soon.phaseMs = 60001u;                   // + 30 s window -> 91 s, rounded UP
        const Rumour lull = rumour_for(reg, pool, fogSpeaker, layer, floorZ, soon);
        CHECK(lull.kind == RumourKind::Lull);
        CHECK(lull.value == 91);
        CHECK(rumour_text(lull, line, sizeof(line)));
        CHECK(speakable(line, sizeof(line)));
        // 64 bytes of literal plus one digit for a 2-minute count. The "min" form is the
        // ceiling rumour.h's 160-byte cap is measured against.
        CHECK(std::strlen(line) == 65u);

        soon.phaseMs = 30000u;                   // + 30 s -> 60 s, under the 90 s split
        const Rumour lullSec = rumour_for(reg, pool, fogSpeaker, layer, floorZ, soon);
        CHECK(lullSec.kind == RumourKind::Lull);
        CHECK(lullSec.value == 60);
        CHECK(rumour_text(lullSec, line, sizeof(line)));
        CHECK(speakable(line, sizeof(line)));
        CHECK(std::strlen(line) == 56u);         // 54 of literal plus two digits

        // The horizon, exactly. At the boundary the crowd speaks; one millisecond past
        // it they are back to the floor's duty cycle.
        soon.phaseMs = kRumourLullSpeakMs - kSamosborWarningMs;
        CHECK(rumour_for(reg, pool, fogSpeaker, layer, floorZ, soon).kind ==
              RumourKind::Lull);
        soon.phaseMs = kRumourLullSpeakMs - kSamosborWarningMs + 1u;
        // `soon.count` is 0, so the Veteran branch below it is gated off and the fallback
        // is unambiguously the floor's duty cycle.
        CHECK(soon.count == 0u);
        const Rumour far_ = rumour_for(reg, pool, fogSpeaker, layer, floorZ, soon);
        CHECK(far_.kind == RumourKind::Fog);
        // And it is the duty-cycle number, per mille: 93.8% at |z| = 50.
        CHECK(far_.value > 900);
        CHECK(far_.value <= 1000);

        // --- AFTERMATH must NEVER produce a Lull. phaseMs there is the aftermath's own
        //     12 s countdown, so adding the warning window to it would name a moment a
        //     whole cooldown too early -- the exact mistake the HUD already shipped once
        //     when it labelled the Aftermath remainder "to warning".
        SamosborState aft;
        aft.phase = static_cast<std::uint8_t>(SamosborPhase::Aftermath);
        aft.phaseTotalMs = kSamosborAftermathMs;
        aft.phaseMs = 4000u;
        aft.count = 4;
        bool noLullInAftermath = true;
        for (int i = 0; i < kCrowd; ++i)
            if (rumour_for(reg, pool, crowd[i], layer, floorZ, aft).kind ==
                RumourKind::Lull)
                noLullInAftermath = false;
        CHECK(noLullInAftermath);

        // --- VETERAN: the run's count and the roster that count actually unlocked. The
        //     one rumour that makes the minSamosbor progression axis visible.
        SamosborState vet;
        vet.phase = static_cast<std::uint8_t>(SamosborPhase::Idle);
        vet.phaseTotalMs = 30u * 60u * 1000u;
        vet.phaseMs = 20u * 60u * 1000u;         // far outside the lull horizon
        std::uint32_t veterans = 0;
        bool veteranNumbersReal = true;
        const std::uint16_t kCounts[2] = {3u, 7u};
        for (int i = 0; i < kCrowd; ++i) {
            for (std::uint16_t c : kCounts) {
                vet.count = c;
                const Rumour r = rumour_for(reg, pool, crowd[i], layer, floorZ, vet);
                if (r.kind != RumourKind::Veteran) continue;
                ++veterans;
                if (r.value != static_cast<std::int32_t>(c)) veteranNumbersReal = false;
                // The roster size is asked of the SAME function the fog spawner asks,
                // which is what makes the sentence checkable rather than flavour.
                if (r.subject != static_cast<std::uint16_t>(
                                     samosbor_fog_roster(floorZ, c).n))
                    veteranNumbersReal = false;
                if (!rumour_text(r, line, sizeof(line))) veteranNumbersReal = false;
                else if (!speakable(line, sizeof(line))) veteranNumbersReal = false;
            }
        }
        CHECK(veterans > 0u);
        CHECK(veteranNumbersReal);
        // count 0 has no veterans to be: the gate is `count > 0`, so a fresh run's crowd
        // falls back to the duty cycle instead of claiming to have survived nothing.
        vet.count = 0;
        bool noVeteranAtZero = true;
        for (int i = 0; i < kCrowd; ++i)
            if (rumour_for(reg, pool, crowd[i], layer, floorZ, vet).kind ==
                RumourKind::Veteran)
                noVeteranAtZero = false;
        CHECK(noVeteranAtZero);

        // The roster really does open with the count, which is the fact the Veteran line
        // is reporting. Measured at ZMinus50.
        CHECK(samosbor_fog_roster(floorZ, 3).n < samosbor_fog_roster(floorZ, 7).n);

        // --- The four floor facts are UNMOVED by the clock. 75% of the crowd stays a
        //     stable, re-checkable source, which is the half of the contract that makes
        //     the other half worth listening to.
        bool floorFactsStable = true;
        for (int i = 0; i < kCrowd; ++i) {
            const Rumour base = rumour_for(reg, pool, crowd[i], layer, floorZ);
            if (base.kind == RumourKind::Fog) continue;   // the one slot that moves
            const Rumour withClock =
                rumour_for(reg, pool, crowd[i], layer, floorZ, act);
            if (withClock.kind != base.kind) floorFactsStable = false;
            if (withClock.subject != base.subject) floorFactsStable = false;
            if (withClock.value != base.value) floorFactsStable = false;
        }
        CHECK(floorFactsStable);

        // Determinism in (speaker, floor): the same body says the same thing, so walking
        // back to them repeats it rather than rolling dice.
        bool repeatable = true;
        for (int i = 0; i < kCrowd; ++i) {
            const Rumour a = rumour_for(reg, pool, crowd[i], layer, floorZ, vet);
            const Rumour b = rumour_for(reg, pool, crowd[i], layer, floorZ, vet);
            if (a.kind != b.kind || a.subject != b.subject || a.value != b.value)
                repeatable = false;
        }
        CHECK(repeatable);

        // An invalid speaker and an undersized buffer are both refusals, not crashes.
        CHECK(!rumour_for(reg, pool, kInvalidNpc, layer, floorZ, act).valid);
        char tiny[80] = {'x', 0};
        CHECK(!rumour_text(var, tiny, sizeof(tiny)));
        CHECK(tiny[0] == 'x');
        CHECK(!rumour_text(Rumour{}, line, sizeof(line)));   // valid == false
    }
}
