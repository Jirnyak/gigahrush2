#include "core/tick.h"
// Audit suite — one test per defect found by reading the whole of src/game and
// src/render after the 45-commit burst. Compiled as its own translation unit by
// tests/audit_test.cpp — NOT included into game_test.cpp any more, because sharing an
// exit code with ~45 real regression gates demoted all of them to stderr; read that
// file's header for the pinned-count contract. It still uses that file's CHECK macro and
// its `using namespace giga::game`.
//
// EVERY TEST IN HERE THAT CURRENTLY FAILS IS A FINDING. They are written to fail
// against HEAD and to pass once the named defect is fixed, so the fix has a witness
// and the regression has a tripwire. A test whose defect is FIXED stays, inverted: it
// stops being a report and becomes the pin that fails again the day the fix is reverted.
// Deleting it would trade a permanent guard for a one-line ctest saving.
//
// The ledger, in the order the tests appear below. Statuses re-derived by reading the
// live source on 2026-07-29; only 1 and 6 were edited by that pass.
//
//   1. projectile_once     CLOSED, now a two-sided pin. Projectiles were integrated
//                          TWICE per tick — physics_step iterated <Transform, Velocity>
//                          and projectile_step integrated them again — so every shot
//                          flew at double its authored speed and double gravity. Fixed
//                          by the `SelfIntegrating` tag (components.h:77) plus
//                          `entt::exclude<SelfIntegrating>` at physics.cpp:85, tagged at
//                          both spawn sites (combat.cpp:498, :537).
//   2. ms_timer_drift      CLOSED by the tick rate. kSimHz is 125, so
//                          uint16(dt*1000+0.5) is exactly 8 ms and an authored duration
//                          means what it says ([core/tick.h]).
//   3. gun_kills_counted   CLOSED. combat.cpp:834 credits a lethal shot to
//                          PlayerMelee::kills — the counter the HUD prints and the one
//                          that survives a body swap.
//   4. ammo_has_a_source   CLOSED without touching the data. A weapon crate reserves
//                          slot 0 for the cheapest affordable ammo
//                          (container.cpp:187-212) and vendor_resupply walks Ammo last
//                          (vendor.cpp:251-255). All 17 AMMO rows still carry
//                          spawn_w_milli 0, which is exactly why the crate has to force
//                          the slot instead of rolling for it.
//   5. descend_not_free    CLOSED, and the TEST is what had to change. The game side had
//                          already landed twice over: `Contract::baseline` is stamped
//                          inside contract_accept so the caller cannot forget it, and a
//                          Descend offer whose target is already behind the run is
//                          refused outright (contract.cpp:209-211). What kept this red
//                          was the test itself, and not for a reason a number could fix:
//                          it stamped the baseline from `kNoDescentYet` (deepestFloor 0)
//                          and then stepped against a ledger saying -50, which reads as
//                          "descended from 0 to -50 AFTER accepting" — so paying 900 was
//                          CORRECT and `first == 0` asserted a state real play cannot
//                          produce. Worse, the line after it wanted the re-accept to
//                          SUCCEED, which only happens while the slot is not Active, i.e.
//                          only if the first step DID pay. No implementation satisfies
//                          both halves. Rewritten to drive the guard that was never
//                          witnessed: contract_accept now gets the REAL ledger, and the
//                          assertion is that it REFUSES (:209-211 was untested — nothing
//                          in the tree passed it a ledger that had already passed the
//                          target, so deleting that guard again would have gone
//                          unnoticed). Branch (b) is the tripwire that stops (a) from
//                          passing vacuously: the same job taken by a run that has NOT
//                          been there is accepted, pays nothing until the descent, pays
//                          exactly 900 once, and is then refused on re-accept by the same
//                          guard — which is the repeat exploit, closed and pinned.
//   6. hunt_is_findable    CLOSED. contract_offer picked a Hunt kind uniformly over all
//                          69 rows with no spawn-weight filter, so 7 of 318 live offers
//                          named a monster that can never appear. Now guarded on the
//                          same two row fields the spawn roster reads
//                          (contract.cpp Hunt branch, mob_spawn.cpp:271).
//                          The count was 11 until 2026-07-29 and is 7 now, RE-MEASURED
//                          by linking this same test object against a contract.cpp with
//                          only that filter removed: `hunts=318 impossible=7
//                          survive=311`. The old figure was right for the CSV it was
//                          taken on — SCULPTURE's authored weight then went 0.05 -> 0.1
//                          (commit bd4db77, "a quantization bug that had silently
//                          deleted a monster"), so it rounds to 1 and is spawnable, and
//                          only CREATOR and PSEUDOLIFT still round to 0. The figures
//                          below and in contract.{h,cpp} are the re-measured ones.
//   7. stack_max_respected CLOSED. loot.cpp:243-244 clamps a merged slot to stackMax.
//   8. giver_slot_recycled CLOSED by this lane, and it is the reason the lane exists.
//                          `Contract::giver` was a bare `NpcId` resting on "the pool
//                          never reclaims a slot", which stopped being true when the
//                          intrusive free list landed ([npc_pool.h] "Slot recycling").
//                          Armed, a giver killed by the MACRO sweep publishes no NpcDied
//                          event, so `contract_on_giver_died` never fires; the slot goes
//                          to a newborn; and `contract_step`'s liveness poll — then
//                          `valid(id) && alive(id)` — saw a living record at that index
//                          and PAID the job out to somebody who never offered it. `giver`
//                          is now an `NpcHandle` and the poll is `handle_valid`, so a
//                          bumped generation fails the job. This test is the witness: it
//                          arms recycling, proves the ABA actually happened (the newborn
//                          gets the giver's exact id and reads as alive), and requires the
//                          job to FAIL rather than transfer. MEASURED against the bare-id
//                          body (same test object, one function reverted): 62 checks /
//                          FIVE failures — paid 700 not 0, banked 700 not 0, state 2
//                          (Complete) not 3 (Failed), failed 0 not 1, completed 1 not 0.
//                          Against the handle body, 62 checks / 0 failures.
//
//   9. travel_keeps_opened_crates
//                          CLOSED. refresh_floor_containers destroys every crate on
//                          the arrival LayerId and respawns from a deterministic seed
//                          (main.cpp 0xC0FFEE ^ floor*0x9e3779b9). Without capture
//                          BEFORE streamer.travel and apply AFTER the respawn, loot
//                          -> elevator -> return refills every emptied box. Both
//                          travel sites (keyboard [ ] and --shot) now call
//                          refresh_opened_containers / apply_opened_containers the
//                          same way F5/F9 already did. This pin is the destroy+
//                          respawn seam those sites share — no entity id in the key.
//  10. travel_arrival_not_in_wall
//                          CLOSED. ride_elevator keeps x/y and sets z=arrivalCoord
//                          (kArrivalCoord=2). ~1-in-5 Residential columns are solid at
//                          that z ([save.h]). place_body_safely is implemented and
//                          unit-tested; F9 called place_body_at_cell; keyboard and
//                          --shot did not. Without the call the body freezes in a
//                          wall forever (physics backs out to zero every tick). Pin
//                          witnesses wall landing → place_body_safely → free of
//                          solid, velocity zeroed — the seam main.cpp now runs.
//
// Currently GREEN (pins, not findings): budget_vs_demo_cap records the numbers behind
// the kMobSpawnCap claim in src/app/main.cpp so the report's arithmetic is machine-
// checked rather than asserted in prose. ms_timer_drift joined it once core/tick.h
// moved the sim to 125 Hz — read its own comment for why it stays in the file.
// travel_keeps_opened_crates pins the travel-time crate capture/apply seam.
// travel_arrival_not_in_wall pins the post-ride place_body_safely seam.

//
// A word on why this index matters more than it looks. This file's whole value rests on
// red meaning "a real defect is live right now". An entry that stays red after its fix,
// or prose that keeps asserting a defect in the present tense, teaches the next reader
// to skim past red — and then a genuine finding gets skimmed past too. Reclassifying is
// therefore not bookkeeping; it is the maintenance that keeps the other six honest.

#include "game/needs.h"
#include "game/samosbor.h"
#include "game/vendor.h"

namespace audit_test {

constexpr float kDt = kSimDt;

// The millisecond step every ms-based timer in the tree is actually fed. Computed the
// same way combat.cpp, needs.cpp and src/app/main.cpp compute it, so this is not a
// restatement of an ideal — it is what the game runs on.
inline std::uint16_t step_ms() {
    return static_cast<std::uint16_t>(kDt * 1000.0f + 0.5f);
}

// A monster kind that swings, for tests that need a live threat.
inline std::uint8_t a_biting_kind() {
    for (std::size_t k = 0; k < kMobKindCount; ++k)
        if (kMobTable[k].dmg > 0 && kMobTable[k].meleeReachMm > 0)
            return static_cast<std::uint8_t>(k);
    return 0;
}

// ---------------------------------------------------------------------------
// 1. Projectiles were integrated twice per tick — CLOSED, pinned from both sides
// ---------------------------------------------------------------------------
// `projectile_step` integrates position itself (combat.cpp:694-696: wrapf(pos + v*dt)
// on x/y and pos.z += v.z*dt). `physics_step` iterates `view<Transform, Velocity>`
// and a Projectile carries both — plus an AABB — so the sweep used to move it a second
// time and collide it. Two consequences, both player-visible:
//
//   * every shot travelled at 2x its authored muzzle speed, which silently doubled the
//     effective range of all 29 firearms and all 13 ranged monsters and halved the
//     telegraph value of the windup;
//   * physics ZEROES the velocity on a wall hit and leaves the entity flush against
//     an AIR cell, so `projectile_step`'s own solid-cell test never fired and the
//     tracer hung in the air, lit, until kProjTtlMs (4 s) expired.
//
// The fix is one tag and one exclusion: `SelfIntegrating` (components.h:77),
// `entt::exclude<SelfIntegrating>` at physics.cpp:85, and an `emplace` at both spawn
// sites (combat.cpp:498 for a monster's lob, :537 for the player's flat shot). A tag in
// the CORE rather than a `Projectile` test inside physics_step, because `src/sim` may
// not include `src/game` ([AGENTS.md] layering).
//
// **This test builds its shot by hand and therefore has to add the tag by hand.** The
// alternative — driving a real spawn — is not available: both `spawn_projectile` and
// `spawn_projectile_dir` live in combat.cpp's anonymous namespace, so the only exported
// way to create a projectile is `player_ranged_step` (needs a camera holder, a gun in a
// pool inventory, a loaded magazine, and therefore a live AMMO row — finding 4) or
// `mob_attack_step` (needs a ranged kind, a target inside its shot band, and a windup to
// elapse). Either would make an arithmetic assertion about ONE integration depend on the
// weapon table, the ammo economy and the hunt-licence rules. Hand-building keeps the
// measurement about integration and nothing else; the cost is that the tag has to be
// written here too, and case (c) is what stops that from being a silent lie.
//
// Nothing caught the original because tests/game_test.cpp test_player_shoots drives
// projectile_step in a loop with no physics_step, which is not the tick order
// src/app/main.cpp uses (physics_step at :789, projectile_step at :822).
static void projectile_once() {
    LevelStack stack;
    LayerId layer = stack.push_layer();   // a fresh layer is all air
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();   // publish() indexes ring_ without checking it exists — see the report

    // gravityPct 0 so the x displacement is exactly speed*dt per integration and the
    // assertion is arithmetic rather than a tolerance on a ballistic arc. `tagged`
    // selects whether this shot carries `SelfIntegrating` — the real spawn sites always
    // do, and case (c) below is the one place a false is wanted.
    auto make_shot = [&](vec3 at, vec3 vel, bool tagged) {
        Entity e = reg.create();
        Transform tr;
        tr.pos = at;
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<Velocity>(e, Velocity{vel});
        reg.emplace<AABB>(e, AABB{vec3{0.10f, 0.10f, 0.10f}});
        // Exactly what combat.cpp:498 and :537 do. Without it this entity is not the
        // thing the game ships and the measurement below is about a different object.
        if (tagged) reg.emplace<SelfIntegrating>(e);
        reg.emplace<Projectile>(e, Projectile{entt::null, 10, kProjTtlMs, 0, 1});
        return e;
    };

    const float speed = 30.0f;
    const int ticks = 12;
    // 30 m/s * 12 ticks * 8 ms = 2.880 m. One integration is 2.880, two is 5.760.
    const float want = speed * static_cast<float>(ticks) * kDt;

    // (a) physics_step must not move a projectile at all: projectile_step owns it.
    //     Exact equality, not a tolerance — the excluded entity is never written, so a
    //     single float of drift here means the exclusion stopped working.
    {
        Entity p = make_shot(vec3{40.0f, 40.0f, 40.0f}, vec3{speed, 0.0f, 0.0f}, true);
        const float x0 = reg.get<Transform>(p).pos.x;
        physics_step(reg, stack, kDt);
        CHECK(reg.get<Transform>(p).pos.x == x0);
        reg.destroy(p);
    }

    // (b) one tick in src/app/main.cpp's real order must advance a shot by exactly
    //     one speed*dt, not two. Ratio 1.00 is the pass; delete the
    //     `entt::exclude<SelfIntegrating>` at physics.cpp:85 and this prints 5.760 m
    //     against an authored 2.880 m, ratio 2.00 — the original finding, restated as a
    //     number rather than as prose.
    {
        Entity p = make_shot(vec3{40.0f, 40.0f, 40.0f}, vec3{speed, 0.0f, 0.0f}, true);
        for (int i = 0; i < ticks; ++i) {
            physics_step(reg, stack, kDt);      // main.cpp:789
            projectile_step(reg, pool, bus, stack, layer, kDt,
                            static_cast<std::uint64_t>(i));   // main.cpp:822
        }
        CHECK(reg.valid(p));
        if (reg.valid(p)) {
            const float moved = reg.get<Transform>(p).pos.x - 40.0f;
            std::fprintf(stderr,
                         "[audit] projectile: %d ticks at %.1f m/s moved %.3f m, "
                         "authored %.3f m (ratio %.2f; 2.00 would mean physics.cpp "
                         "integrates it too)\n",
                         ticks, speed, moved, want, moved / want);
            CHECK(std::fabs(moved - want) < 0.01f);
            reg.destroy(p);
        }
    }

    // (c) THE TRIPWIRE, and the reason (a) and (b) are not circular. An identical shot
    //     with the tag WITHDRAWN is still integrated by both systems and still moves
    //     exactly twice as far — so the exclusion is proven to be what does the work,
    //     and the pass in (b) cannot be an accident of a loose tolerance or of a
    //     projectile_step that quietly stopped moving anything.
    //
    //     It also splits the two ways this can regress, which read identically in a log
    //     otherwise: (a)+(b) failing while (c) passes means the exclude<> in physics.cpp
    //     is gone; (c) failing alone means physics_step stopped integrating at all, or
    //     `SelfIntegrating` acquired a second reader that changed what an untagged
    //     entity does.
    {
        Entity p = make_shot(vec3{40.0f, 40.0f, 40.0f}, vec3{speed, 0.0f, 0.0f}, false);
        for (int i = 0; i < ticks; ++i) {
            physics_step(reg, stack, kDt);
            projectile_step(reg, pool, bus, stack, layer, kDt,
                            static_cast<std::uint64_t>(i));
        }
        CHECK(reg.valid(p));
        if (reg.valid(p)) {
            const float moved = reg.get<Transform>(p).pos.x - 40.0f;
            std::fprintf(stderr,
                         "[audit] projectile: the same shot UNTAGGED moved %.3f m "
                         "(ratio %.2f), which is the bug the tag closes\n",
                         moved, moved / want);
            CHECK(std::fabs(moved - 2.0f * want) < 0.02f);
            reg.destroy(p);
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Millisecond timers keep exact time — FIXED, now a tripwire
// ---------------------------------------------------------------------------
// This was a finding and is now a pin. What it caught: at 120 Hz the step is 8.3333 ms,
// every consumer converted it with `uint16(dt * 1000.0f + 0.5f)` = 8, and a third of a
// millisecond went on the floor every tick with no accumulator to carry it — so an
// authored 1000 ms cooldown ran 1.0417 s and a 30 s samosbor warning ran 31.25 s. It was
// uniform, which is why nothing looked obviously wrong and why it needed a test.
//
// The fix was not an accumulator. core/tick.h:26 moved the sim to kSimHz = 125, which
// makes the step exactly 8.0 ms and the conversion lossless, and tick.h:31-33 then pins
// that property with a static_assert(kSimStepMs * kSimHz == 1000) so the build fails if
// anyone moves the rate back to a value that does not divide a second. Choosing the rate
// over an accumulator is worth understanding rather than just recording: an accumulator
// would have added per-timer residue state to a deterministic sim, i.e. more state to
// serialise, desync and replay, to compensate for an arithmetic problem the rate itself
// could delete. Do NOT "improve" this by adding one.
//
// Why the test stays after passing. It reads kSimDt (kDt, :86) rather than restating a
// rate, and both bounds are written as kSimHz and 30 * kSimHz, so it measures whatever
// the sim is configured to do instead of a number a human retyped. Both bounds pass with
// ZERO margin — 125 <= 125 and 3750 <= 3750 — which is the useful part: reintroduce any
// residue and the step stops being integral, every loop below needs one extra tick, and
// both CHECKs fail on the first one. A test that only passes exactly is a better tripwire
// than one with slack.
//
// One caveat left in place deliberately: tests/game_test.cpp test_player_shoots still
// derives its boundary as `ceil(reloadMs / stepMs)` from the implementation rather than
// from the spec, so it would pass under either rate and proves nothing about timing.
//
// Sites the fix reaches: combat.cpp:202 (mob_attack_step), :607 (slow_step), :657
// (projectile_step), :862 (player_ranged_step), :990 (player_melee_step), plus the
// `uint16(dt*1000+0.5)` in src/app/main.cpp's loop — all fed kSimDt, so all now convert
// to exactly 8. Note FIVE sites in combat.cpp, not the four this list used to name:
// player_melee_step acquired one after the list was written, which is the argument for
// naming the function beside each number rather than the number alone.
static void ms_timer_drift() {
    // 8 is the correct step at 125 Hz, not a quantisation loss. Stated so the arithmetic
    // the rest of this test depends on is visible at the top.
    CHECK(step_ms() == 8);

    // (a) a mob's attack cooldown. mob_attack_step decrements exactly once per call,
    //     before any early-out, so this measures the timer and nothing else.
    {
        LevelStack stack;
        LayerId layer = stack.push_layer();
        Registry reg;
        NpcPool pool;
        pool.init();
        EventBus bus;
    bus.init();   // publish() indexes ring_ without checking it exists — see the report

        Entity m = reg.create();
        Transform tr;
        tr.pos = vec3{40.0f, 40.0f, 40.0f};
        tr.layer = layer;
        reg.emplace<Transform>(m, tr);
        reg.emplace<MobRef>(m, MobRef{a_biting_kind(), 1, 100, 100});
        reg.emplace<MobCombat>(m, MobCombat{1000, 0});   // exactly one second

        int ticks = 0;
        while (reg.get<MobCombat>(m).cooldownMs > 0 && ticks < 400) {
            mob_attack_step(reg, stack.layer(layer).grid(), pool, bus, layer, kDt,
                            static_cast<std::uint64_t>(ticks));
            ++ticks;
        }
        // One second of sim time is kSimHz ticks, by definition of the rate. Printed
        // rather than hardcoded so a future rate change cannot leave this message lying
        // about what was measured — which is exactly what the old "1/120 s" text did.
        std::fprintf(stderr,
                     "[audit] timer: a 1000 ms mob cooldown cleared after %d ticks "
                     "of 1/%d s = %.4f s\n",
                     ticks, kSimHz, static_cast<double>(ticks) * kSimDt);
        CHECK(ticks <= kSimHz);   // one second is kSimHz ticks, by definition
    }

    // (b) the samosbor clock, fed the same way by src/app/main.cpp:757-761. A 30 s
    //     warning window must open 30 s after the Idle phase ends, not 31.25 s.
    {
        SamosborState st;
        SamosborRng rng{0x5A303B0Du};
        samosbor_arm(st, 60u * 1000u);   // 30 s of Idle, then Warning
        const std::uint32_t dtMs =
            static_cast<std::uint32_t>(kDt * 1000.0f + 0.5f);
        int ticks = 0;
        bool warned = false;
        while (!warned && ticks < 8000) {
            warned = samosbor_step(st, dtMs, /*floorZ=*/0, rng).warningBegan;
            ++ticks;
        }
        std::fprintf(stderr,
                     "[audit] timer: a 30 s samosbor Idle->Warning took %d ticks "
                     "= %.3f s\n",
                     ticks, static_cast<double>(ticks) * kSimDt);
        CHECK(warned);
        CHECK(ticks <= 30 * kSimHz);
    }
}

// ---------------------------------------------------------------------------
// 3. A firearm kill was counted nowhere — CLOSED, now a pin
// ---------------------------------------------------------------------------
// What it caught: `player_melee_step` credited a lethal swing (combat.cpp:1042
// `++pm.kills`) and `projectile_step` credited a HIT to PlayerRanged::hits
// (combat.cpp:827) but credited a KILL to nothing — PlayerRanged has no kill field and
// PlayerMelee was not touched. The HUD prints PlayerMelee::kills and carries it across
// possession, so it is the tally the player reads; you could shoot a whole floor dead
// and it stayed at zero.
//
// Fixed at combat.cpp:834, inside projectile_step's lethal branch:
// `if (auto* pm = reg.try_get<PlayerMelee>(h.source)) ++pm->kills;` — the shot is
// credited to the same counter the melee path uses, so one number covers both.
//
// Asserted on PlayerMelee::kills because that is the counter the HUD reads and the one
// that survives a body swap. Any fix that lands the kill in a counter the HUD prints
// satisfies the intent; this pins that it lands somewhere.
static void gun_kills_counted() {
    LevelStack stack;
    LayerId layer = stack.push_layer();
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();   // publish() indexes ring_ without checking it exists — see the report

    NpcId sid = pool.spawn();
    pool.hp(sid) = 100;
    pool.max_hp(sid) = 100;

    Entity shooter = reg.create();
    Transform st;
    st.pos = vec3{40.0f, 40.0f, 40.0f};
    st.layer = layer;
    reg.emplace<Transform>(shooter, st);
    reg.emplace<NpcRef>(shooter, NpcRef{sid});
    reg.emplace<CameraTag>(shooter, CameraTag{});
    reg.emplace<PlayerMelee>(shooter, PlayerMelee{0, 0});
    reg.emplace<PlayerRanged>(shooter, PlayerRanged{});

    Entity mob = reg.create();
    Transform mt;
    mt.pos = vec3{45.0f, 40.0f, 40.0f};
    mt.layer = layer;
    reg.emplace<Transform>(mob, mt);
    reg.emplace<MobRef>(mob, MobRef{a_biting_kind(), 1, 1, 1});   // one hit kills it

    // A player round already in flight, one step short of the target.
    Entity shot = reg.create();
    Transform pt;
    pt.pos = vec3{44.6f, 40.0f, 40.0f};
    pt.layer = layer;
    reg.emplace<Transform>(shot, pt);
    reg.emplace<Velocity>(shot, Velocity{vec3{30.0f, 0.0f, 0.0f}});
    reg.emplace<AABB>(shot, AABB{vec3{0.10f, 0.10f, 0.10f}});
    reg.emplace<Projectile>(shot, Projectile{shooter, 50, kProjTtlMs,
                                             kPlayerGravityPct, 1});

    std::uint32_t hits = 0;
    for (int i = 0; i < 20 && reg.valid(shot); ++i)
        hits += projectile_step(reg, pool, bus, stack, layer, kDt,
                                static_cast<std::uint64_t>(i));

    CHECK(hits == 1);
    CHECK(reg.all_of<Dead>(mob));                            // it died
    CHECK(reg.get<PlayerRanged>(shooter).hits == 1);         // the hit is credited
    CHECK(reg.get<PlayerMelee>(shooter).kills == 1);         // and now so is the KILL
}

// ---------------------------------------------------------------------------
// 4. Ammunition has no source except a mob-dropped gun
// ---------------------------------------------------------------------------
// Measured over data/items.csv: all 17 AMMO rows carry spawn_w_milli == 0.
// `item_weight_on_floor` returns 0 for weight 0 (item_table.cpp:2276), and every
// weighted roller in the game filters on it — so:
//
//   * `roll_container(WeaponCrate, ...)` admits Weapon|Ammo (container.cpp:98-100)
//     and can only ever produce weapons. container.h:51 calls the kind "Ammo and a
//     weapon" and the file header calls it "ammo and access"; neither can happen.
//   * `vendor_stocks(Ammo)` is true (vendor.cpp:52) and `vendor_buy_price` prices it,
//     but `vendor_resupply` — the ONLY buy path wired to a key (src/app/main.cpp:1255)
//     — walked Drink, Medicine and Food only, so the promise and the one key-wired buy
//     path disagreed. Ammo is in that list now, last (vendor.cpp:251-255); the two-step
//     history, including the "fix" that picked the wrong row, is at vendor.cpp:227-236.
//
// So the only ammunition in the game is `drop_weapon_ammo`, bundled onto a firearm
// that fell off a corpse. Loot a gun out of a crate, or buy your way back to strength
// at the pad, and you have a gun you can never load.
// A run that has not descended: the strict baseline for a Descend job.
static const RunLedger kNoDescentYet{};
static void ammo_has_a_source() {
    // The premise, from the data rather than from prose.
    int ammoRows = 0, ammoSpawnable = 0;
    for (ItemId id = 1; id <= kItemCount; ++id) {
        const ItemDef& d = item_def(id);
        if (static_cast<ItemCategory>(d.category) != ItemCategory::Ammo) continue;
        ++ammoRows;
        if (d.spawnWeight != 0) ++ammoSpawnable;
    }
    CHECK(ammoRows == 17);
    CHECK(ammoSpawnable == 0);   // GREEN: this is the cause, not the defect

    // (a) a weapon crate must be able to hold a round.
    bool crateAmmo = false;
    const int floors[] = {0, -8, -14, -26, -36, -50, 14, 30};
    for (int z : floors)
        for (std::uint32_t s = 0; s < 256 && !crateAmmo; ++s) {
            const Container c = roll_container(ContainerKind::WeaponCrate, z,
                                              s * 0x9e3779b9u + 1u);
            for (int i = 0; i < kContainerSlots; ++i) {
                if (!item_valid(c.item[i]) || c.count[i] == 0) continue;
                if (static_cast<ItemCategory>(item_def(c.item[i]).category) ==
                    ItemCategory::Ammo)
                    crateAmmo = true;
            }
        }
    CHECK(crateAmmo);

    // (b) the vendor stocks ammo, so the one wired buy path must be able to sell it.
    {
        RunLedger led{};
        led.banked = 200000;
        Inventory inv{};
        vendor_resupply(inv, led, 50000);
        bool boughtAmmo = false;
        for (const ItemSlot& s : inv.slots) {
            if (!item_valid(s.item) || s.count == 0) continue;
            if (static_cast<ItemCategory>(item_def(s.item).category) ==
                ItemCategory::Ammo)
                boughtAmmo = true;
        }
        CHECK(vendor_stocks(ItemCategory::Ammo));   // the promise
        CHECK(boughtAmmo);                          // the delivery
    }
}

// ---------------------------------------------------------------------------
// 5. A Descend contract pays for a descent that happened before it existed
// ---------------------------------------------------------------------------
// What it caught: `contract_step` reads `led.deepestFloor` (contract.cpp:320), which is
// the deepest point of the whole SESSION, and `contract_accept` recorded no baseline. So
// a job to reach -20, taken after any trip past -20, was already complete on the tick it
// was accepted. `Contract::baseline` closes that (contract.cpp:227, compared at :336),
// and a Descend whose target is already behind the run is now REFUSED at accept
// (contract.cpp:209-211).
//
// The repeat was the expensive half. `contract_accept` refuses a duplicate only while
// the existing copy is ACTIVE (contract.cpp:217); once it is Complete the slot is
// reusable, and `contract_offer` is deterministic in (giver, floor) — so the same body
// re-offers the identical job every `kOverhearCooldownTicks` (2 s) and every E press
// paid again, forever, without moving. Descend is 20% of all offers (contract.cpp:58-143
// splits Fetch 45 / Hunt 35 / Descend 20 on `pick`), and the reward is paid straight
// into `banked`, which is the one number the whole extraction loop is scored on.
//
// **What this test measures now, and why the old version could not.** It used to accept
// with `kNoDescentYet` and step against a ledger at -50, which is not a state play can
// reach: that reads as a descent made AFTER accepting, so paying was right and
// `first == 0` was asserting against the implementation of a job that works. The real
// hole was one line up and had no witness at all — nothing in the tree drove
// `contract_accept` with a ledger that had already passed the target, so the guard at
// :209-211 could have been deleted and every test would still have passed. So (a) drives
// exactly that and requires a REFUSAL, and (b) is the tripwire that keeps (a) from being
// satisfied by a Descend job that simply never works.
static void descend_not_free() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    CHECK(pool.alive(giver));

    Contract job{};
    job.giver = pool.handle(giver);
    job.kind = static_cast<std::uint8_t>(ObjectiveKind::Descend);
    job.target = -20;
    job.reward = 900;
    job.state = static_cast<std::uint8_t>(ContractState::Offered);

    Inventory inv{};

    // (a) THE REFUSAL. A run already at -50 cannot take a job to reach -20: the target is
    //     behind it, so there is no descent left to make and no way for the slot to ever
    //     complete. Refused at accept, and therefore never occupying one of three slots.
    {
        RunLedger led{};
        led.deepestFloor = -50;      // already been deeper, earlier in the run
        led.deepestBand = economy_band(-50);
        ContractBook book{};
        CHECK(!contract_accept(book, job, led));
        // Refused means NOT WRITTEN. A guard that returned false after stamping the slot
        // would still brick the book, which is the failure mode this finding is about.
        CHECK(book.slot[0].state != static_cast<std::uint8_t>(ContractState::Active));
        const std::int32_t paid = contract_step(book, pool, inv, led);
        std::fprintf(stderr,
                     "[audit] contracts: Descend(-20) offered to a run already at -50 "
                     "was refused at accept; the book paid %d rub and holds %u done / "
                     "%u failed\n",
                     paid, book.completed, book.failed);
        CHECK(paid == 0);
        CHECK(led.banked == 0);
        // Not a FAILURE either. An unclearable slot that eventually fails still charges
        // the player a failure for work they were never able to do.
        CHECK(book.completed == 0 && book.failed == 0);
    }

    // (b) THE TRIPWIRE, and the reason (a) is not vacuous. The identical job taken by a
    //     run that has NOT been there is accepted, pays NOTHING until the descent is
    //     actually made, pays exactly once when it is — and is then refused on re-accept
    //     by the same guard as (a), which is the infinite-press exploit closed at the
    //     accept seam instead of at the payout.
    {
        RunLedger led{};             // deepestFloor 0: a run still at the top
        ContractBook book{};
        CHECK(contract_accept(book, job, led));
        CHECK(book.slot[0].baseline == 0);                 // stamped from the ledger
        CHECK(contract_step(book, pool, inv, led) == 0);   // taken, not yet earned
        led.deepestFloor = -20;                            // NOW the descent happens
        CHECK(contract_step(book, pool, inv, led) == 900);
        CHECK(led.banked == 900);                          // and into banked, not carried
        CHECK(contract_step(book, pool, inv, led) == 0);   // paid once, not every tick
        // The repeat, priced by the guard rather than by the payout: the run is at -20
        // now, so `want <= baseline` and the same offer is dead to this player.
        CHECK(!contract_accept(book, job, led));
    }
}

// ---------------------------------------------------------------------------
// 5b. Two Descend jobs to the same |target| must not both sit Active — CLOSED
// ---------------------------------------------------------------------------
// contract_accept used to dedupe only on (giver, kind, subject). Descend stores its
// depth in `target` and pays against |target|, so two Active slots aimed at the same
// absolute depth — different givers, opposite signs, or a second baseline stamp —
// both Complete on one walk and double-pay. Three slots, three givers, one descent:
// that is the brick. The accept seam now refuses any second Descend whose |target|
// collides with an Active one, regardless of giver or sign.
static void descend_same_target_once() {
    NpcPool pool;
    pool.init();
    const NpcId a = pool.spawn();
    const NpcId b = pool.spawn();
    CHECK(pool.alive(a) && pool.alive(b));

    RunLedger led{};             // deepestFloor 0
    ContractBook book{};
    Inventory inv{};

    Contract jobA{};
    jobA.giver = pool.handle(a);
    jobA.kind = static_cast<std::uint8_t>(ObjectiveKind::Descend);
    jobA.target = -20;
    jobA.reward = 900;
    jobA.state = static_cast<std::uint8_t>(ContractState::Offered);

    Contract jobB = jobA;
    jobB.giver = pool.handle(b);
    jobB.target = -20;           // same absolute depth, other person
    jobB.reward = 1100;          // different purse so a double-pay is visible as 2000

    Contract jobRoof = jobA;
    jobRoof.giver = pool.handle(b);
    jobRoof.target = 20;         // opposite sign, same |target|

    // (a) first accept lands; second same-|target| from another giver is refused.
    CHECK(contract_accept(book, jobA, led));
    CHECK(book.slot[0].state == static_cast<std::uint8_t>(ContractState::Active));
    CHECK(!contract_accept(book, jobB, led));
    CHECK(book.slot[1].state != static_cast<std::uint8_t>(ContractState::Active));

    // (b) opposite-sign same |target| is also refused — payout is absolute.
    CHECK(!contract_accept(book, jobRoof, led));

    // (c) one descent pays exactly once, from the single Active slot.
    led.deepestFloor = -20;
    const std::int32_t paid = contract_step(book, pool, inv, led);
    std::fprintf(stderr,
                 "[audit] contracts: two givers offered Descend(|20|); book held one "
                 "Active slot and paid %d rub (want 900, not 2000)\n",
                 paid);
    CHECK(paid == 900);
    CHECK(led.banked == 900);
    CHECK(book.completed == 1);
    CHECK(book.failed == 0);

    // (d) a DIFFERENT depth still accepts into a free slot — the guard is per-|target|,
    //     not a blanket "one Descend ever".
    Contract jobDeep = jobA;
    jobDeep.giver = pool.handle(b);
    jobDeep.target = -40;
    jobDeep.reward = 1800;
    // After (c) slot 0 is Complete, so the book has a free (non-Active) slot again —
    // accept reuses it, so slot 0 becomes Active with the deeper job. The pin is that
    // accept returns true and exactly one Active Descend(|40|) sits in the book.
    CHECK(contract_accept(book, jobDeep, led));
    int activeDeep = 0;
    for (int i = 0; i < kMaxContracts; ++i)
        if (book.slot[i].state == static_cast<std::uint8_t>(ContractState::Active) &&
            book.slot[i].kind == static_cast<std::uint8_t>(ObjectiveKind::Descend) &&
            (book.slot[i].target == -40 || book.slot[i].target == 40))
            ++activeDeep;
    CHECK(activeDeep == 1);
}

// ---------------------------------------------------------------------------
// 8. A recycled slot silently transferred a contract to a stranger — CLOSED
// ---------------------------------------------------------------------------

// `Contract::giver` was a bare `NpcId`, and contract.h justified that with "NpcPool never
// reclaims a slot and id == slot forever". That was true when it was written and stopped
// being true when the intrusive free list landed ([npc_pool.h] "Slot recycling"): armed,
// `kill()` queues the slot and `spawn()` hands it to the next newborn, so an id names one
// record AT A TIME rather than forever.
//
// The failure that opens is silent, and the silence is the whole problem:
//
//   * `contract_on_giver_died` is called from ONE place — the frame-top NpcDied drain in
//     src/app/main.cpp — so it covers combat deaths and nothing else. A death in the macro
//     sweep publishes no event ([macro_sim.h]).
//   * `contract_step`'s liveness poll was therefore the only guard for those, and it asked
//     `valid(id) && alive(id)`: "is somebody alive at that index", not "is my giver alive".
//   * So: giver dies in the sweep, slot goes to a newborn, poll passes, and the job runs
//     to completion against a person who never offered it — paying out of a stranger's
//     pocket. Nothing logs it and nothing fails.
//
// `giver` is an `NpcHandle` now and the poll is `pool.handle_valid`, which fails on a
// bumped generation whether or not the slot was reused. This test is the witness AND the
// reason src/app/main.cpp can arm recycling: it proves the ABA actually happens (the
// newborn takes the giver's exact id and reads as alive) and then requires the job to FAIL
// instead of transfer.
//
// **Measured on both sides, not reasoned about.** This same translation unit was linked
// once against the handle body and once against a copy of contract.cpp with only the
// liveness poll reverted to `valid(id) && alive(id)`: handle 62 checks / 0 failures,
// bare id 62 checks / FIVE failures, all five below — paid 700 not 0, banked 700 not 0,
// state 2 (Complete) not 3 (Failed), `failed` 0 not 1, `completed` 1 not 0. So the test
// cannot pass by accident on either side, and the payout it prevents is a real 700
// roubles rather than a lingering slot.
//
// Armed HERE and not in the shipping pool, deliberately: a test is exactly where an
// unshipped policy belongs, and the guard has to be proven against the policy before
// main.cpp turns it on.
static void giver_slot_recycled() {
    NpcPool pool;
    pool.init();
    pool.set_recycling(true);
    CHECK(pool.recycling());

    // A Hunt already at its target, so the bare-id version does not merely keep the job
    // alive — it PAYS. The finding is a payout, not a lingering slot, and the assertion
    // should read as one.
    const NpcId giver = pool.spawn();
    Contract job{};
    job.giver = pool.handle(giver);
    job.kind = static_cast<std::uint8_t>(ObjectiveKind::Hunt);
    job.subject = a_biting_kind();
    job.target = 1;
    job.reward = 700;
    job.state = static_cast<std::uint8_t>(ContractState::Offered);

    ContractBook book{};
    CHECK(contract_accept(book, job, kNoDescentYet));
    contract_on_kill(book, static_cast<std::uint8_t>(job.subject));
    CHECK(book.slot[0].progress == 1);      // one contract_step away from 700 roubles

    // The giver dies the way NOTHING reports: in the macro sweep. No NpcDied event is
    // published, so `contract_on_giver_died` is deliberately NOT called here — that is
    // precisely the gap contract_step's poll has to cover on its own.
    pool.kill(giver);
    const NpcId newborn = pool.spawn();
    CHECK(newborn == giver);                // the ABA actually happened, not hypothetically
    CHECK(pool.recycled() == 1);            // ...out of the free list, not off the tail
    CHECK(pool.alive(newborn));             // and the stored id reads as LIVING again
    // The one bit of state a bare id could not see.
    CHECK(pool.generation(newborn) != npc_handle_gen(job.giver));

    RunLedger led{};
    Inventory inv{};
    const std::int32_t paid = contract_step(book, pool, inv, led);
    std::fprintf(stderr,
                 "[audit] contracts: giver id %u recycled into a newborn (gen %u -> %u); "
                 "the job paid %d rub and ended in state %u (3 = Failed)\n",
                 static_cast<unsigned>(giver),
                 static_cast<unsigned>(npc_handle_gen(job.giver)),
                 static_cast<unsigned>(pool.generation(newborn)), paid,
                 static_cast<unsigned>(book.slot[0].state));
    CHECK(paid == 0);
    CHECK(led.banked == 0);
    CHECK(book.slot[0].state == static_cast<std::uint8_t>(ContractState::Failed));
    CHECK(book.failed == 1);
    CHECK(book.completed == 0);

    // And the guard DISCRIMINATES rather than refusing everything: a handle minted from
    // the newborn — the same slot, the current generation — is valid. Without this the
    // test above would also pass against a handle_valid that always returned false.
    CHECK(pool.handle_valid(pool.handle(newborn)));
}

// ---------------------------------------------------------------------------
// 6. A Hunt contract could name a monster that cannot spawn — CLOSED
// ---------------------------------------------------------------------------
// contract.cpp's Hunt branch comments "a kind that lives at this depth, so the job is
// findable" and then picked uniformly over all `kMobKindCount` rows with no
// spawn-weight and no floorMask filter. `spawn_floor_mobs` skips any row with
// `spawnWeightX10 == 0` (mob_spawn.cpp:271), and data/mobs.csv has TWO such rows today —
// CREATOR (idx 13) and PSEUDOLIFT (idx 31), both authored as a literal 0 — each with
// dmg > 0 (44 and 24), so the `md.dmg == 0` guard let both through. Neither can appear on
// any floor by any path, so a Hunt naming one was exactly the "quest that can never
// complete" the same comment claims to avoid.
//
// MEASURED before the fix rather than remembered — same test object, linked against a
// contract.cpp with only the spawnability filter removed: 318 Hunt offers, 7 impossible
// (CREATOR 3, PSEUDOLIFT 4), 311 surviving. The older "11 of 318 / SCULPTURE 4" reading
// was taken on an earlier CSV: SCULPTURE's weight went 0.05 -> 0.1 in commit bd4db77, so
// it rounds to 1 now and is spawnable. `floorMask == 0` is still vacuous against the data
// (0 of 69 rows, re-measured the same way) and is kept for the reason contract.cpp gives.
//
// The habitat half is checked here as `floorMask != 0` — a row naming no anchor at all
// matches no floor — and deliberately NOT as "must live at THIS floor's anchor", because
// that overshoot costs more than the bug: measured, it drops Hunt offers on -50 from 32
// to 5, since only 15 of 69 rows carry the ZMinus50 bit. A Hunt has no floor gate
// (`contract_on_kill`, src/app/main.cpp:593) and the shipped stack covers all six
// anchors, so a weight-bearing kind is already meetable somewhere in the run.
//
// So the test guards both directions. `impossible == 0` is the finding; `leanestKinds` is
// the overshoot, because a filter that passed the first assertion by naming the same
// three monsters on every floor would be a worse contract system than the broken one.
static void hunt_is_findable() {
    NpcPool pool;
    pool.init();
    for (int i = 0; i < 512; ++i) pool.spawn();

    // Floor-major, so per-floor variety can be counted without a second pass.
    // `contract_offer` is a pure function of (giver, floorZ, seed), so the order the
    // pairs are visited in cannot change a single answer.
    const int floors[] = {0, 1, 2, -8, -14, -26, -36, -50, 14, 30};
    int hunts = 0;
    int impossible = 0;
    int leanestFloor = 0;
    int leanestKinds = static_cast<int>(kMobKindCount) + 1;
    for (int z : floors) {
        bool named[kMobKindCount] = {};
        int distinct = 0;
        for (NpcId g = 0; g < 512; ++g) {
            // 0x9E37u is the seed src/app/main.cpp:844-845 actually passes, so this is
            // the live offer stream and not a synthetic one.
            const Contract c = contract_offer(pool, g, z, 0x9E37u);
            // kInvalidHandle, not kInvalidNpc: `giver` is an NpcHandle now (finding 8).
            // The two constants are the same 0xFFFFFFFF — deliberately, so that no live
            // handle can collide with either ([npc_pool.h] reserves generation 0xFFF) —
            // so this is a naming fix and not a behaviour change; the offer counts below
            // are unchanged by it.
            if (c.giver == kInvalidHandle) continue;
            if (c.kind != static_cast<std::uint8_t>(ObjectiveKind::Hunt)) continue;
            ++hunts;
            if (c.subject >= kMobKindCount ||
                kMobTable[c.subject].spawnWeightX10 == 0 ||
                kMobTable[c.subject].floorMask == 0) {
                ++impossible;
                continue;
            }
            if (!named[c.subject]) {
                named[c.subject] = true;
                ++distinct;
            }
        }
        if (distinct < leanestKinds) {
            leanestKinds = distinct;
            leanestFloor = z;
        }
    }
    std::fprintf(stderr,
                 "[audit] contracts: %d Hunt offers scanned, %d name an unspawnable "
                 "kind; leanest floor %d offers %d distinct targets\n",
                 hunts, impossible, leanestFloor, leanestKinds);
    CHECK(hunts > 0);          // the scan actually exercised the Hunt branch
    CHECK(impossible == 0);    // no offer may name a kind the roster cannot roll
    // 311 of the 318 pre-fix offers survive the guard. A guard that has started eating
    // most of the stream is a bug in the guard, not a stricter contract system. The
    // threshold sits well under the measurement so a CSV edit is not a false alarm.
    CHECK(hunts >= 240);
    // Measured 19-30 distinct kinds per floor after the fix (leanest: -36 with 19).
    // 8 is the line between "this floor has its own bestiary" and "everyone here wants
    // the same thing killed".
    CHECK(leanestKinds >= 8);
}

// ---------------------------------------------------------------------------
// 7. pickup_step can push a slot past its stack maximum
// ---------------------------------------------------------------------------
// loot.cpp:227-241 finds the first slot holding this item with `count < stackMax` and
// then adds the whole bundle to it without re-checking the cap. `drop_weapon_ammo`
// clamps the PICKUP to stackMax (loot.cpp:151-152), so a single bundle is legal and a
// second one merged on top is not.
//
// Low damage on its own — ItemSlot::count is 16 bits, so nothing wraps — but it breaks
// the invariant every other consumer assumes, and loot.cpp:225 states the opposite
// outright ("no silent discard, which is what makes 64 slots a real constraint").
static void stack_max_respected() {
    LevelStack stack;
    LayerId layer = stack.push_layer();
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();   // publish() indexes ring_ without checking it exists — see the report

    // Any stackable item; the smallest cap makes the overflow largest relative to it.
    ItemId stacky = kInvalidItem;
    for (ItemId id = 1; id <= kItemCount; ++id)
        if (item_def(id).stackMax >= 4 && item_def(id).stackMax <= 64) {
            stacky = id;
            break;
        }
    CHECK(stacky != kInvalidItem);
    if (stacky == kInvalidItem) return;
    const std::uint8_t cap = item_def(stacky).stackMax;

    NpcId sid = pool.spawn();
    Inventory& inv = pool.inventory(sid);
    inv.slots[0] = ItemSlot{stacky, static_cast<std::uint16_t>(cap - 1)};

    Entity me = reg.create();
    Transform mt;
    mt.pos = vec3{40.0f, 40.0f, 40.0f};
    mt.layer = layer;
    reg.emplace<Transform>(me, mt);
    reg.emplace<NpcRef>(me, NpcRef{sid});
    reg.emplace<CameraTag>(me, CameraTag{});

    Entity drop = reg.create();
    Transform dt;
    dt.pos = mt.pos;
    dt.layer = layer;
    reg.emplace<Transform>(drop, dt);
    reg.emplace<Pickup>(drop, Pickup{stacky, cap});

    const std::int32_t got = pickup_step(reg, pool, bus, layer, 1u);
    std::fprintf(stderr, "[audit] stack: item=%u cap=%u got=%d slot0=%u/%u\n",
                 static_cast<unsigned>(stacky), static_cast<unsigned>(cap), got,
                 static_cast<unsigned>(inv.slots[0].item),
                 static_cast<unsigned>(inv.slots[0].count));
    CHECK(inv.slots[0].count <= cap);
}

// ---------------------------------------------------------------------------
// PIN (green): what kMobSpawnCap actually costs
// ---------------------------------------------------------------------------
// src/app/main.cpp:224-227 caps every floor's monster spawn at 600 and justifies it
// with "the demo floors (|number| <= 4) are far below this anyway, so it is a guard
// rail rather than a live limit". That comment predates commit 8e0a0d3, which moved
// the stack to {0, 1, 2, -8, -14, -26, -36, -50, 14, 30} to reach the mob ecology's
// real habitat anchors. Six of those ten floors now ask for more than 600 heads, and
// the four deepest all ask for over 800 — so from -14 downward every floor spawns the
// same 600 and the V-shape budget the whole depth curve is built on is flat.
//
// The truncation is silent: `spawn_floor_mobs` clamps `want` to the cap, trims the
// last pack to fit (mob_spawn.cpp:239), and its return value — the only place the
// shortfall could surface — is discarded by `refresh_floor_mobs`.
//
// Green on purpose. It pins the arithmetic the finding rests on; raising the cap does
// not make it red, and that is correct — the defect lives in main.cpp, not here.
static void budget_vs_demo_cap() {
    const std::uint8_t dRes = danger_for_hostility(floor_spec(FloorKind::Residential).hostility);
    const std::uint8_t dInd = danger_for_hostility(floor_spec(FloorKind::Industrial).hostility);
    const std::uint8_t dDer = danger_for_hostility(floor_spec(FloorKind::Derelict).hostility);
    const std::uint8_t dCom = danger_for_hostility(floor_spec(FloorKind::Commercial).hostility);

    // Under the cap: the hub and its two neighbours, plus the first derelict.
    CHECK(mob_count_for_floor(0, dRes, theme_for_kind(FloorKind::Residential)) < 600);
    CHECK(mob_count_for_floor(1, dCom, theme_for_kind(FloorKind::Commercial)) < 600);
    CHECK(mob_count_for_floor(2, dInd, theme_for_kind(FloorKind::Industrial)) < 600);
    CHECK(mob_count_for_floor(-8, dDer, theme_for_kind(FloorKind::Derelict)) < 600);

    // Over it: six floors, silently truncated.
    CHECK(mob_count_for_floor(-14, dInd, theme_for_kind(FloorKind::Industrial)) > 600);
    CHECK(mob_count_for_floor(-26, dDer, theme_for_kind(FloorKind::Derelict)) > 600);
    CHECK(mob_count_for_floor(-36, dInd, theme_for_kind(FloorKind::Industrial)) > 600);
    CHECK(mob_count_for_floor(-50, dDer, theme_for_kind(FloorKind::Derelict)) > 600);
    CHECK(mob_count_for_floor(14, dCom, theme_for_kind(FloorKind::Commercial)) > 600);
    CHECK(mob_count_for_floor(30, dRes, theme_for_kind(FloorKind::Residential)) > 600);

    // And the deepest four are all far enough over that the cap erases the gradient
    // between them entirely: they would differ by thousands and all deliver 600.
    CHECK(mob_count_for_floor(-50, dDer, theme_for_kind(FloorKind::Derelict)) >
          mob_count_for_floor(-36, dInd, theme_for_kind(FloorKind::Industrial)));
    CHECK(mob_count_for_floor(-36, dInd, theme_for_kind(FloorKind::Industrial)) > 800);
}

// ---------------------------------------------------------------------------
// PIN (green): travel destroy+respawn keeps looted crates empty
// ---------------------------------------------------------------------------
// main.cpp refresh_floor_containers tears down every Container on the arrival layer and
// re-rolls spawn_floor_containers with seed 0xC0FFEE ^ floor*0x9e3779b9. That is correct
// for a first visit. A RETURN visit must re-empty crates whose OpenedContainerKey was
// captured on the way out — otherwise loot → elevator → return is a free refill.
//
// The keyboard [ ] path and the --shot ride path both do:
//   refresh_opened_containers(leaveLayer, floor)   // BEFORE streamer.travel
//   ... travel + refresh_floor_containers ...
//   apply_opened_containers(nl, floor, keys)       // AFTER respawn
// This pin is that seam without the streamer: spawn → open → capture → destroy →
// respawn same seed → apply → assert empty. saveload's opened_crates_survive_a_restart
// covers the F5/F9 byte round-trip; this one covers the in-memory travel path.
static void travel_keeps_opened_crates() {
    World w;
    const int floorZ = -3;
    const FloorKind kind = FloorKind::Residential;
    // Same seed formula main.cpp refresh_floor_containers uses.
    const std::uint32_t seed =
        0xC0FFEEu ^ static_cast<std::uint32_t>(floorZ) * 0x9e3779b9u;
    generate_floor(w, floorZ, floor_spec(kind), 1337u);

    Registry reg;
    const LayerId layer = 0;
    const std::uint32_t made =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(made > 4u);

    int openedByHand = 0;
    int i = 0;
    for (auto e : reg.view<Container, const Transform>()) {
        if ((i++ % 3) != 0) continue;
        Container& c = reg.get<Container>(e);
        for (int s = 0; s < kContainerSlots; ++s) {
            c.item[s] = kInvalidItem;
            c.count[s] = 0;
        }
        c.opened = true;
        ++openedByHand;
    }
    CHECK(openedByHand > 1);

    std::vector<OpenedContainerKey> opened;
    // Foreign-floor key must survive a floor-scoped refresh (travel only rewrites the
    // floor being left).
    opened.push_back(OpenedContainerKey{2, 66, 66, 1, 0});
    const std::size_t fromFloor =
        refresh_opened_containers(reg, layer, floorZ, opened);
    CHECK(fromFloor == static_cast<std::size_t>(openedByHand));
    CHECK(opened.size() == 1u + fromFloor);
    CHECK(opened[0].floor == 2);

    // Tear down — the streamer recycles LayerId; refresh_floor_containers does this.
    std::vector<Entity> dead;
    for (auto e : reg.view<const Container, const Transform>())
        if (reg.get<const Transform>(e).layer == layer) dead.push_back(e);
    CHECK(!dead.empty());
    for (Entity e : dead) reg.destroy(e);

    const std::uint32_t remade =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(remade == made);

    // Without apply, every remade crate is full again — the refill bug.
    const std::size_t hits = apply_opened_containers(
        reg, layer, floorZ, opened.data(), opened.size());
    CHECK(hits >= static_cast<std::size_t>(openedByHand));

    std::size_t openNow = 0;
    for (auto e : reg.view<const Container, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const Container& c = reg.get<const Container>(e);
        if (!c.opened) continue;
        ++openNow;
        for (int s = 0; s < kContainerSlots; ++s) CHECK(c.item[s] == kInvalidItem);
    }
    CHECK(openNow >= static_cast<std::size_t>(openedByHand));
    CHECK(hits == openNow);
}

// ---------------------------------------------------------------------------
// PIN (green): elevator arrival is not left inside a wall
// ---------------------------------------------------------------------------
// ride_elevator keeps x/y from the departed floor and plants z = kArrivalCoord
// ([elevator.cpp]). Wall lattices of two floor kinds do not align, so ~1-in-5
// Residential columns at z=2 are solid ([save.h] measurement). place_body_safely
// resolves the body's current cell to a standable neighbour and zeroes Velocity.
//
// F9 already called place_body_at_cell. Keyboard [ ] and --shot did not — the
// body froze forever (physics backs out of solid every tick). Both travel sites
// in main.cpp now call place_body_safely after the arrival seam.
//
// This pin is the seam without the streamer: body planted in a known wall cell
// with residual velocity → place_body_safely → free of solid, velocity zero.
// suite_saveload already unit-tests the helper; this is the audit ledger witness
// that the travel path must keep calling it.
static void travel_arrival_not_in_wall() {
    const vec3 kBodyHalf{0.4f, 0.4f,
                         body_half_height(static_cast<std::uint16_t>(1750))};

    LevelStack stack;
    const LayerId layer = stack.push_layer();
    // Generate into the live layer — same shape suite_saveload uses. place_body_safely
    // reads the World the body stands in.
    generate_floor(stack.layer(layer), /*floorZ=*/-26,
                   floor_spec(FloorKind::Residential), 1337u);

    // A wall cell at the arrival storey with a standable neighbour — FOUND in
    // the built grid (the module's BSP walls are seed-derived, not a lattice a
    // constant could name; same convention as suite_saveload's find_wall_probe).
    int wallX = -1, wallY = -1;
    for (int y = 4; y < kMacroDim - 4 && wallX < 0; ++y)
        for (int x = 4; x < kMacroDim - 4 && wallX < 0; ++x) {
            const vec3 c = macro_cell_centre(static_cast<std::uint8_t>(x),
                                             static_cast<std::uint8_t>(y),
                                             kArrivalCoord);
            if (!aabb_overlaps_solid(stack.layer(layer), c, kBodyHalf)) continue;
            for (int dy = -1; dy <= 1 && wallX < 0; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    if (!dx && !dy) continue;
                    const vec3 nb = macro_cell_centre(
                        static_cast<std::uint8_t>(wrap_macro(x + dx)),
                        static_cast<std::uint8_t>(wrap_macro(y + dy)), kArrivalCoord);
                    if (!aabb_overlaps_solid(stack.layer(layer), nb, kBodyHalf) &&
                        stack.layer(layer).grid().cell(wrap_macro(x + dx),
                                                       wrap_macro(y + dy),
                                                       kArrivalCoord - 1) != kCellAir) {
                        wallX = x;
                        wallY = y;
                        break;
                    }
                }
        }
    CHECK(wallX >= 0);

    const vec3 wallCentre =
        macro_cell_centre(static_cast<std::uint8_t>(wallX),
                          static_cast<std::uint8_t>(wallY), kArrivalCoord);
    CHECK(aabb_overlaps_solid(stack.layer(layer), wallCentre, kBodyHalf));


    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = wallCentre;
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e, Velocity{vec3{12.0f, -3.0f, 4.0f}});
    reg.emplace<AABB>(e, AABB{kBodyHalf});

    // Premise: without the call, the body is inside solid with leftover speed —
    // the soft-lock ride_elevator alone produces.
    CHECK(aabb_overlaps_solid(stack.layer(layer),
                              reg.get<Transform>(e).pos, kBodyHalf));
    CHECK(reg.get<Velocity>(e).v.x != 0.0f);

    const PlacedCell placed = place_body_safely(reg, stack.layer(layer), e);
    CHECK(placed.ok);
    CHECK(placed.moved);
    CHECK(!aabb_overlaps_solid(stack.layer(layer),
                               reg.get<Transform>(e).pos, kBodyHalf));
    // Zeroing Velocity is not tidiness: a carried-over fall drives the body
    // through the floor it was just placed on. [save.h]
    CHECK(reg.get<Velocity>(e).v.x == 0.0f);
    CHECK(reg.get<Velocity>(e).v.y == 0.0f);
    CHECK(reg.get<Velocity>(e).v.z == 0.0f);

    std::fprintf(stderr,
                 "[audit] travel arrival: wall (%u,%u,%u) -> standable "
                 "(%u,%u,%u) rings=%d supported=%d\n",
                 static_cast<unsigned>(wallX), static_cast<unsigned>(wallY),
                 static_cast<unsigned>(kArrivalCoord),
                 static_cast<unsigned>(placed.cx),
                 static_cast<unsigned>(placed.cy),
                 static_cast<unsigned>(placed.cz), placed.rings,
                 placed.supported ? 1 : 0);
}

} // namespace audit_test

static void test_audit_all() {
    audit_test::projectile_once();
    audit_test::ms_timer_drift();
    audit_test::gun_kills_counted();
    audit_test::ammo_has_a_source();
    audit_test::descend_not_free();
    audit_test::descend_same_target_once();
    audit_test::giver_slot_recycled();
    audit_test::hunt_is_findable();
    audit_test::stack_max_respected();
    audit_test::budget_vs_demo_cap();
    audit_test::travel_keeps_opened_crates();
    audit_test::travel_arrival_not_in_wall();
}

