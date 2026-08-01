// Timed player statuses — the table, the composition rules, and the two traps.
//
// **Trap 1: composition must be multiplicative, and it must be measured on the real
// path.** Two independent slows have to both bite. A test that only checked "move
// multiplier is 540 while webbed" would pass on an implementation that OVERWRITES
// instead of composing, and the bug only shows up the first time a player is webbed
// while carrying zhelemish skin.
//
// **Trap 2: the root window is a LEADING window.** Paupsina roots for 0.65 s out of a
// 4.2 s effect, so `status_is_rooted` must be true at landing and false 700 ms later
// while the status is still ACTIVE. An off-by-one that inverts the comparison gives a
// status that roots for its last 0.65 s instead of its first, which reads as working
// (you do get rooted) and is wrong.
//
// Everything here runs the shipped integer path. No formula is re-derived in the test:
// a formula duplicated into a test is a formula that agrees with itself.
//
// ASCII only in every printf, deliberately: the display names in data/status.csv are
// Cyrillic and this host's console is CP1251, so printing one emits mojibake that reads
// as corruption. Names are asserted non-empty and their BYTES counted instead, exactly
// as suite_economy.inl does.

#include <cstdio>
#include <cstring>

#include "game/status.h"

namespace giga::game {

static void test_status_all() {
    { // ---- 1. every authored row resolves and is internally consistent ----
        static_assert(kStatusCount == 6);
        CHECK(kStatusTable.size() == kStatusCount);
        CHECK(kStatusNames.size() == kStatusCount);

        for (std::size_t i = 0; i < kStatusCount; ++i) {
            const StatusDef& d = kStatusTable[i];
            CHECK(d.durationMs > 0);
            CHECK(d.altDurationMs > 0);
            CHECK(d.moveMultE3 > 0);
            CHECK(d.aimMultE3 > 0);
            // A root cannot outlast the effect that carries it.
            CHECK(d.rootMs <= d.durationMs);
            CHECK(kStatusNames[i] != nullptr);
            CHECK(std::strlen(kStatusNames[i]) > 0);
            // Cyrillic, so the name is real content and not a placeholder id. Counted
            // by BYTE and never text-searched: a text-mode grep reports zero Cyrillic
            // on this host in files that measurably hold thousands of lead bytes.
            std::size_t lead = 0;
            for (const char* p = kStatusNames[i]; *p; ++p)
                if (static_cast<unsigned char>(*p) == 0xD0u ||
                    static_cast<unsigned char>(*p) == 0xD1u) ++lead;
            CHECK(lead > 0);
        }
    }

    { // ---- 2. the reference's authored numbers, verbatim ----
        // status.ts:39-42 and govnyak.ts:30-32. These are the numbers the port exists
        // to carry; if one moves, the port stopped matching the reference.
        const StatusDef& web = status_def(StatusId::PaupsinaWeb);
        CHECK(web.durationMs == 4200);      // PAUPSINA_WEB_DURATION_SEC  4.2
        CHECK(web.rootMs == 650);           // PAUPSINA_WEB_ROOT_SEC      0.65
        CHECK(web.moveMultE3 == 540);       // PAUPSINA_WEB_MOVE_MULT     0.54
        CHECK(web.altMoveMultE3 == 220);    // PAUPSINA_WEB_ROOT_MULT     0.22

        const StatusDef& haze = status_def(StatusId::SporeHaze);
        CHECK(haze.durationMs == 4800);     // SPORE_HAZE_DURATION_SEC            4.8
        CHECK(haze.altDurationMs == 2200);  // SPORE_HAZE_PROTECTED_DURATION_SEC  2.2
        CHECK(haze.aimMultE3 == 1650);      // SPORE_HAZE_AIM_SPREAD_MULT         1.65
        CHECK(haze.altAimMultE3 == 1180);   // ..._PROTECTED_AIM_SPREAD_MULT      1.18
        // The gate resolved to a real item at generation time. `ip4_gasmask` — and the
        // id is worth pinning: the obvious spelling `gasmask_ip4` does not exist in
        // items.csv, and a wrong gate would read at runtime as "never protected".
        CHECK(haze.gateItem != 0);
        CHECK(item_valid(haze.gateItem));

        const StatusDef& zh = status_def(StatusId::ZhelemishSkin);
        CHECK(zh.durationMs == 180000);     // RAW_DURATION      180 s
        CHECK(zh.altDurationMs == 150000);  // TREATED_DURATION  150 s
        CHECK(zh.moveMultE3 == 820);        // MOVE_MULT         0.82
        CHECK(zh.meleeMultE3 == 700);       // MELEE_DAMAGE_MULT 0.7
        CHECK(zh.healMultE3 == 550);        // HEAL_MULT         0.55
        CHECK(zh.waterDrainE3 == 45);       // WATER_DRAIN       0.045

        // govnyak.ts:30-32 — the three the reference keeps in a different file, which
        // is why they read as missing from status.ts.
        CHECK(status_def(StatusId::GovnyakRelief).durationMs == 70000);
        CHECK(status_def(StatusId::GovnyakCough).durationMs == 210000);
        CHECK(status_def(StatusId::GovnyakDebt).durationMs == 480000);
    }

    { // ---- 3. landing, expiry, and the refresh rule ----
        StatusSet s{};
        CHECK(!status_active(s, StatusId::SporeHaze));
        CHECK(status_move_mult_e3(s) == 1000);   // a clean set changes nothing
        CHECK(status_aim_mult_e3(s) == 1000);
        CHECK(status_melee_mult_e3(s) == 1000);  // STATMELEE identity
        CHECK(status_heal_mult_e3(s) == 1000);
        CHECK(!status_is_rooted(s));

        status_apply(s, StatusId::SporeHaze, false);
        CHECK(status_active(s, StatusId::SporeHaze));
        CHECK(status_aim_mult_e3(s) == 1650);

        // The ALT column is latched at LANDING. Re-applying with the gasmask on must
        // not SHORTEN a haze already running — the longer remaining time wins.
        status_apply(s, StatusId::SporeHaze, true);
        CHECK(status_aim_mult_e3(s) == 1650);    // still the bare-faced value

        // ... and stepping past the end clears it.
        const std::uint32_t gone = status_step(s, 4800);
        CHECK(gone == 1);
        CHECK(!status_active(s, StatusId::SporeHaze));
        CHECK(status_aim_mult_e3(s) == 1000);

        // A fresh haze WITH the mask on takes the short duration and the mild spread.
        StatusSet m{};
        status_apply(m, StatusId::SporeHaze, true);
        CHECK(status_aim_mult_e3(m) == 1180);
        CHECK(status_step(m, 2200) == 1);        // 2.2 s, not 4.8
        CHECK(!status_active(m, StatusId::SporeHaze));
    }

    { // ---- 4. THE ROOT IS A LEADING WINDOW (trap 2) ----
        StatusSet s{};
        status_apply(s, StatusId::PaupsinaWeb, false);
        CHECK(status_is_rooted(s));                 // rooted the instant it lands
        CHECK(status_move_mult_e3(s) == 220);       // and it is the ROOT multiplier

        status_step(s, 700);                        // past the 650 ms root
        CHECK(status_active(s, StatusId::PaupsinaWeb));  // still webbed...
        CHECK(!status_is_rooted(s));                     // ...but free to move
        CHECK(status_move_mult_e3(s) == 540);        // now the walking multiplier
    }

    { // ---- 5. COMPOSITION IS MULTIPLICATIVE (trap 1) ----
        StatusSet s{};
        status_apply(s, StatusId::ZhelemishSkin, false);
        status_apply(s, StatusId::PaupsinaWeb, false);
        // Both are held at once.
        CHECK(status_active(s, StatusId::ZhelemishSkin));
        CHECK(status_active(s, StatusId::PaupsinaWeb));

        // 0.82 zhelemish x 0.22 paupsina-root = 0.1804 -> 180 with round-to-nearest.
        // An implementation that OVERWROTE instead of composing would print 220 here,
        // and one that only applied the first would print 820.
        CHECK(status_move_mult_e3(s) == 180);

        status_step(s, 700);   // web out of its root, zhelemish still running
        // 0.82 x 0.54 = 0.4428 -> 443.
        CHECK(status_move_mult_e3(s) == 443);
        // STATMELEE: zhelemish melee 0.7 still active after web leaves root;
        // paupsina melee is identity 1000 so fold stays 700.
        CHECK(status_melee_mult_e3(s) == 700);
        CHECK(status_heal_mult_e3(s) == 550);

        status_step(s, 4200);  // web expires entirely; zhelemish is a 180 s effect
        CHECK(!status_active(s, StatusId::PaupsinaWeb));
        CHECK(status_active(s, StatusId::ZhelemishSkin));
        CHECK(status_move_mult_e3(s) == 820);
    }

    { // ---- 6. a drain is a RATE, so drains ADD ----
        StatusSet s{};
        CHECK(status_water_drain_e3(s) == 0);
        status_apply(s, StatusId::ZhelemishSkin, false);
        CHECK(status_water_drain_e3(s) == 45);
        // Only zhelemish carries a drain today, so the sum is still 45 with others up.
        status_apply(s, StatusId::PaupsinaWeb, false);
        CHECK(status_water_drain_e3(s) == 45);
    }

    { // ---- 7. stacking, and the cap ----
        StatusSet s{};
        // The govnyak three accumulate intensity; the other three do not.
        CHECK(status_def(StatusId::GovnyakCough).stacks == 1);
        CHECK(status_def(StatusId::PaupsinaWeb).stacks == 0);

        for (int i = 0; i < 10; ++i) status_apply(s, StatusId::GovnyakCough, false);
        // Capped, not unbounded — ten doses do not give ten times the cough.
        CHECK(s.intensityE3[static_cast<std::size_t>(StatusId::GovnyakCough)] ==
              kStatusIntensityCapE3);

        // A non-stacking status stays at unity however often it lands.
        status_apply(s, StatusId::PaupsinaWeb, false);
        status_apply(s, StatusId::PaupsinaWeb, false);
        CHECK(s.intensityE3[static_cast<std::size_t>(StatusId::PaupsinaWeb)] == 1000);
    }

    { // ---- 8. an out-of-range id is refused rather than trusted ----
        StatusSet s{};
        const StatusId bad = static_cast<StatusId>(kStatusCount + 3);
        CHECK(!status_valid(bad));
        status_apply(s, bad, false);          // must not write out of bounds
        CHECK(!status_active(s, bad));
        CHECK(std::strlen(status_name(bad)) == 0);
        // Nothing landed, so every query is still neutral.
        CHECK(status_move_mult_e3(s) == 1000);
    }

    std::printf("[test] suite_status: table and composition verified\n");
}

} // namespace giga::game
