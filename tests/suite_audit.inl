#include "core/tick.h"
#include "game/room.h"        // FloorRooms — ящики селятся в зонах
#include "game/floor_gen.h"   // rooms_declare
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
//   5. descend_not_free    СНЕСЁН 2026-11-08 вместе с системой контрактов.
//   6. hunt_is_findable    СНЕСЁН 2026-11-08 вместе с системой контрактов.
//   7. stack_max_respected CLOSED. loot.cpp:243-244 clamps a merged slot to stackMax.
//   8. giver_slot_recycled СНЕСЁН 2026-11-08 вместе с системой контрактов. Это
//                          был ЕДИНСТВЕННЫЙ свидетель генерационного хэндла для
//                          `pool.set_recycling(true)`; список гейта recycling в
//                          [src/app/main.cpp] осиротел по пункту Contract::giver.
//
//   9. travel_keeps_opened_crates
//                          CLOSED. refresh_floor_containers destroys every crate on
//                          the arrival LayerId and respawns from a deterministic seed
//                          (main.cpp 0xC0FFEE ^ floor*0x9e3779b9). Without capture
//                          BEFORE streamer.travel and apply AFTER the respawn, loot
//                          -> elevator -> return refills every emptied box. Both
//                          travel sites (keyboard [ ] and --shot) now call
//                          refresh_floor_records / apply_container_records the
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
//   * (The second source this section used to audit — `vendor_resupply`'s buy
//     path — died with the pad shop, [conversation.md]. Ammo now reaches the
//     player through the crate slot below, the corpse bundle, and barter with
//     whoever carries rounds in their own bag.)
//
// So outside of trade the only ammunition is `drop_weapon_ammo`'s bundle and the
// weapon crate's reserved slot; a gun without either is a gun you cannot load.
// (`kNoDescentYet` стоял здесь — базовая линия для Descend-контракта; умер
// вместе с системой контрактов 2026-11-08.)
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
            for (int i = 0; i < kInvSlots; ++i) {
                if (!item_valid(c.inv.slots[i].item) || c.inv.slots[i].count == 0) continue;
                if (static_cast<ItemCategory>(item_def(c.inv.slots[i].item).category) ==
                    ItemCategory::Ammo)
                    crateAmmo = true;
            }
        }
    CHECK(crateAmmo);

    // (b) — the vendor buy path this section used to exercise is deleted
    // ([conversation.md]); the crate slot above and loot.cpp's weapon bundle
    // are the audited sources now, and barter needs no audit of its own here:
    // it moves what EXISTS, it cannot mint a round.
}

// ---------------------------------------------------------------------------
// 5, 5b, 6, 8 — ЧЕТЫРЕ КОНТРАКТНЫХ НАХОДКИ СНЕСЕНЫ 2026-11-08
// ---------------------------------------------------------------------------
// Вместе с системой контрактов/квестов целиком (решение владельца: надстройка
// без мандата в CANON.md, обходила единственный законный путь решения агента —
// спрос/предложение в place.cpp — и платила прямо в кошелёк).
//
// Здесь стояли, и все четыре были ЗАКРЫТЫМИ ПИНАМИ, а не живыми находками:
//   5.  descend_not_free          — Descend платил за спуск, случившийся ДО
//                                   взятия работы; лечение — `Contract::baseline`
//                                   плюс отказ на accept.
//   5b. descend_same_target_once  — две Descend-работы на один |target| не смели
//                                   сидеть Active одновременно (двойная выплата).
//   6.  hunt_is_findable          — Hunt называл вид, который роутер спавна не
//                                   может выкатить (7 офферов из 318).
//   8.  giver_slot_recycled       — переиспользованный слот пула молча передавал
//                                   работу новорождённому. ЭТО БЫЛ ЕДИНСТВЕННЫЙ
//                                   СВИДЕТЕЛЬ генерационного хэндла для
//                                   `pool.set_recycling(true)`: закон «хэндл
//                                   чернеет на kill()» теперь держит только
//                                   suite_npcpool (`handle_valid`), и в списке
//                                   гейта recycling в [src/app/main.cpp] у
//                                   пункта `Contract::giver` больше нет файла.

// ---------------------------------------------------------------------------
// 7. подбор не смеет толкнуть слот за stackMax (теперь pickup_take)
// ---------------------------------------------------------------------------
// Исторический дефект: пылесос находил первый слот с `count < stackMax` и
// доливал ВЕСЬ пакет без переклампа. Лечение живёт в inventory_give
// (clamp-before-store), а этот тест держит ПУТЬ ПОДБОРА на примитиве.
// 2026-11-07: авто-пылесос pickup_step умер (лут — навес «дать предмет»,
// решение владельца), путь = pickup_take по сфокусированной сущности —
// закон клампа обязан пережить смену глагола.
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
    inv.slots[0] = ItemSlot{stacky, static_cast<std::uint8_t>(cap - 1)};

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

    const PickupTakeResult got = pickup_take(reg, pool, bus, drop, sid, 1u);
    std::fprintf(stderr, "[audit] stack: item=%u cap=%u placed=%u slot0=%u/%u\n",
                 static_cast<unsigned>(stacky), static_cast<unsigned>(cap),
                 static_cast<unsigned>(got.placed),
                 static_cast<unsigned>(inv.slots[0].item),
                 static_cast<unsigned>(inv.slots[0].count));
    CHECK(inv.slots[0].count <= cap);
    // Остаток НЕ выброшен молча: кламп долил слот до cap, хвост лёг СВЕЖИМ
    // слотом (инвентарь пуст) — пакет забран целиком, сущность умерла.
    CHECK(got.placed == cap);
    CHECK(got.destroyed);
    CHECK(!reg.valid(drop));
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
// PIN (green): travel keeps crate CONTENTS (v20: записи снимка, не пересев)
// ---------------------------------------------------------------------------
// v20/F (S20.6 закон 2): ветка ревизита НЕ сеет — сущности приходят из
// записей floor-файла. Все travel-пути делают:
//   gather_floor_entities(leaveLayer, floor)          // BEFORE streamer.travel
//   ... travel ...
//   spawn_prop_records / spawn_corpse_records / ...   // restore branch
// This pin is that seam without the streamer and without the file: spawn ->
// mutate -> gather -> destroy -> spawn from records -> assert equal. saveload's
// floor_records_survive_a_restart covers the byte round-trip through the
// floor file; this one covers the in-memory travel seam.
static void travel_keeps_crate_records() {
    World w;
    const int floorZ = -3;
    const FloorKind kind = FloorKind::Residential;
    // Same seed formula main.cpp refresh_floor_containers uses.
    const std::uint32_t seed =
        0xC0FFEEu ^ static_cast<std::uint32_t>(floorZ) * 0x9e3779b9u;
    generate_floor(w, floorZ, floor_spec(kind), 1337u);

    Registry reg;
    rooms_declare(reg.ctx().emplace<FloorRooms>(), floorZ, floor_spec(kind),
                  1337u);
    const LayerId layer = 0;
    const std::uint32_t made =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(made > 4u);

    int openedByHand = 0;
    int deposits = 0;
    int i = 0;
    for (auto e : reg.view<Container, const Transform>()) {
        Container& c = reg.get<Container>(e);
        if ((i % 3) == 0) {
            for (int s = 0; s < kInvSlots; ++s) {
                c.inv.slots[s].item = kInvalidItem;
                c.inv.slots[s].count = 0;
            }
            c.opened = true;
            ++openedByHand;
        } else if ((i % 5) == 0) {
            c.inv.slots[0].item = 40;   // deposit: worn bandages, the state a key could not carry
            c.inv.slots[0].count = 3;
            c.inv.slots[0].condition = 77;
            ++deposits;
        }
        ++i;
    }
    CHECK(openedByHand > 1);
    CHECK(deposits > 0);

    game::FloorEntityState ents;
    const std::size_t gathered =
        gather_floor_entities(reg, layer, floorZ, ents, nullptr);
    CHECK(gathered >= static_cast<std::size_t>(made));
    CHECK(ents.props.size() == static_cast<std::size_t>(made));

    // Tear down — the streamer recycles LayerId; unload's sweep does this.
    std::vector<Entity> dead;
    for (auto e : reg.view<const Container, const Transform>())
        if (reg.get<const Transform>(e).layer == layer) dead.push_back(e);
    CHECK(!dead.empty());
    for (Entity e : dead) reg.destroy(e);

    // Ревизит: НЕ пересев + штамп, а спавн из записей (restore не сеет).
    EventBus bus;
    bus.init();
    const std::size_t remade = spawn_prop_records(
        reg, w, layer, ents.props.data(), ents.props.size(), bus);
    CHECK(remade == static_cast<std::size_t>(made));

    std::size_t openNow = 0, depositNow = 0;
    for (auto e : reg.view<const Container, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const Container& c = reg.get<const Container>(e);
        if (c.opened) {
            ++openNow;
            for (int s = 0; s < kInvSlots; ++s)
                CHECK(c.inv.slots[s].item == kInvalidItem);
        }
        if (c.inv.slots[0].item == 40 && c.inv.slots[0].count == 3 && c.inv.slots[0].condition == 77) ++depositNow;
    }
    CHECK(openNow >= static_cast<std::size_t>(openedByHand));
    CHECK(depositNow >= static_cast<std::size_t>(deposits));   // вклад пережил рейс
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
    // descend_not_free / descend_same_target_once / giver_slot_recycled /
    // hunt_is_findable СНЕСЕНЫ 2026-11-08 с системой контрактов.
    audit_test::stack_max_respected();
    audit_test::budget_vs_demo_cap();
    audit_test::travel_keeps_crate_records();
    audit_test::travel_arrival_not_in_wall();
}

