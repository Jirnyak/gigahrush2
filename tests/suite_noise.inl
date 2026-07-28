// Noise-as-information, and the one consumer wired to it.
//
// The claim this suite has to earn is specific: **a monster that could not have seen
// the player changes what it does because the player fired a gun.** Everything else
// here is the scaffolding that makes that claim non-vacuous — the field is bounded,
// the eviction policy cannot swallow a gunshot, the sweep really does expire things,
// and hearing beats nothing while sight beats hearing.
//
// The measured numbers are printed, not just asserted, because "it changed" is not a
// result — a distance in metres against a control run is.
//
// Included here rather than in game_test.cpp so that file keeps exactly two new lines.
#include <ctime>

#include "core/tick.h"   // giga::kSimDt - the sim is 125 Hz, never hardcode it
#include "game/investigate.h"
#include "game/noise.h"

static void test_noise_field_bounds() {
    NoiseField f;
    CHECK(f.quiet());
    CHECK(f.live() == 0);
    CHECK(f.dropped == 0);

    NoiseProfile p;
    p.radius = 10.0f;
    p.ttlMs = 1000;
    p.severity = 3;
    p.source = NoiseSource::WeaponFire;

    const std::uint32_t id = noise_publish(f, 0, vec3{10, 10, 2}, p, 7u);
    CHECK(id == 1);                 // ids start at 1; 0 means "no noise"
    CHECK(!f.quiet());
    CHECK(f.live() == 1);

    // A degenerate profile is REFUSED, not clamped up into something audible.
    NoiseProfile bad;
    bad.radius = 0.0f;
    bad.ttlMs = 1000;
    bad.source = NoiseSource::Door;
    CHECK(noise_publish(f, 0, vec3{0, 0, 0}, bad, 0) == 0);
    bad.radius = 5.0f;
    bad.ttlMs = 0;
    CHECK(noise_publish(f, 0, vec3{0, 0, 0}, bad, 0) == 0);
    bad.ttlMs = 500;
    bad.source = NoiseSource::None;
    CHECK(noise_publish(f, 0, vec3{0, 0, 0}, bad, 0) == 0);
    CHECK(f.dropped == 3);
    CHECK(f.live() == 1);           // none of the three landed

    // A layer past one byte is refused rather than aliased onto (id % 256) — a
    // gunshot must never become audible on a different floor.
    CHECK(noise_publish(f, 300u, vec3{0, 0, 0}, p, 0) == 0);
    CHECK(noise_publish(f, kNoiseLayerMax, vec3{0, 0, 0}, p, 0) != 0);

    // Radius is capped, so no data error can make one event audible across a torus
    // whose half-period is the maximum meaningful distance.
    NoiseProfile huge = p;
    huge.radius = 4000.0f;
    const std::uint32_t hid = noise_publish(f, 0, vec3{0, 0, 0}, huge, 0);
    CHECK(hid != 0);
    const Noise* found = nullptr;
    for (const Noise& s : f.slot)
        if (s.id == hid) found = &s;
    CHECK(found != nullptr);
    if (found) CHECK(found->radius == kNoiseRadiusCap);
}

static void test_noise_fades() {
    NoiseField f;
    NoiseProfile p;
    p.radius = 12.0f;
    p.ttlMs = 100;
    p.severity = 3;
    p.source = NoiseSource::WeaponFire;
    CHECK(noise_publish(f, 0, vec3{20, 20, 2}, p, 0) != 0);

    // The fade is what makes this a field of RECENT noises rather than a log.
    CHECK(noise_step(f, 40) == 0);
    CHECK(f.live() == 1);
    CHECK(noise_step(f, 40) == 0);
    CHECK(f.live() == 1);
    CHECK(noise_step(f, 40) == 1);   // 120 > 100: expired
    CHECK(f.live() == 0);
    CHECK(f.quiet());
    // Sweeping a quiet field is free and must not underflow the counter.
    CHECK(noise_step(f, 1000) == 0);
    CHECK(f.live() == 0);

    // Age enters the score, so a stale loud noise can lose to a fresh quiet one.
    // Two severity-3 records at the same distance, one 2 s older: the fresh one wins.
    NoiseField g;
    NoiseProfile old = p;
    old.ttlMs = 4000;
    const std::uint32_t oldId = noise_publish(g, 0, vec3{10, 10, 0}, old, 0);
    noise_step(g, 2000);
    const std::uint32_t newId = noise_publish(g, 0, vec3{10, 10, 0}, old, 0);
    CHECK(oldId != 0 && newId != 0);
    float d = 0.0f;
    const Noise* best = loudest_heard(g, 0, vec3{10, 10, 0}, 1.0f, 0, 0, &d);
    CHECK(best != nullptr);
    if (best) CHECK(best->id == newId);
}

static void test_noise_overflow_keeps_the_gunshot() {
    // THE policy difference from the event bus, and the reason it exists: a ring full
    // of quiet events must not be able to swallow a gunshot.
    NoiseField f;
    NoiseProfile quietOne;
    quietOne.radius = 3.0f;
    quietOne.ttlMs = 5000;
    quietOne.severity = 1;
    quietOne.source = NoiseSource::Footstep;

    for (std::size_t i = 0; i < kNoiseCap; ++i)
        CHECK(noise_publish(f, 0, vec3{1, 1, 0}, quietOne, 0) != 0);
    CHECK(f.live() == kNoiseCap);
    CHECK(f.dropped == 0);

    // The field is full of severity-1 footsteps. A rifle still gets in.
    NoiseProfile shot;
    shot.radius = 24.0f;
    shot.ttlMs = 2800;
    shot.severity = 4;
    shot.source = NoiseSource::WeaponFire;
    const std::uint32_t sid = noise_publish(f, 0, vec3{50, 50, 2}, shot, 0);
    CHECK(sid != 0);
    CHECK(f.live() == kNoiseCap);   // it replaced a slot, it did not grow the field
    CHECK(f.dropped == 0);

    // ...and it is the one a listener now hears from 30 m, where no footstep reaches.
    float d = 0.0f;
    const Noise* best = loudest_heard(f, 0, vec3{50, 30, 2}, 1.0f, 2, 0, &d);
    CHECK(best != nullptr);
    if (best) {
        CHECK(best->id == sid);
        CHECK(best->severity == 4);
        CHECK(d > 19.0f && d < 21.0f);
    }

    // Now fill the rest with rifles and try to squeeze a footstep in: THAT is refused,
    // and counted, rather than displacing something that matters more.
    for (std::size_t i = 0; i < kNoiseCap; ++i) noise_publish(f, 0, vec3{1, 1, 0}, shot, 0);
    CHECK(f.live() == kNoiseCap);
    const std::uint32_t before = f.dropped;
    CHECK(noise_publish(f, 0, vec3{1, 1, 0}, quietOne, 0) == 0);
    CHECK(f.dropped == before + 1);
}

static void test_noise_hearing_geometry() {
    NoiseField f;
    NoiseProfile p;
    p.radius = 10.0f;
    p.ttlMs = 2000;
    p.severity = 3;
    p.source = NoiseSource::WeaponFire;

    // x/y wrap and z does NOT. A noise 2 m from the far seam is 4 m away across the
    // wrap, not kWorldExtent - 4 away; the same offset in z is a real 250 m.
    CHECK(noise_publish(f, 0, vec3{2.0f, 10.0f, 4.0f}, p, 0) != 0);
    const Noise n = f.slot[0];
    CHECK(n.id != 0);
    const float across = noise_distance(n, vec3{kWorldExtent - 2.0f, 10.0f, 4.0f});
    CHECK(across > 3.9f && across < 4.1f);
    const float upStack = noise_distance(n, vec3{2.0f, 10.0f, kWorldExtent - 2.0f});
    CHECK(upStack > 249.0f);        // z is a storey axis, not a torus

    // hearingMult scales the radius — the reference's whole model of a sharp-eared
    // kind. At 11 m a radius-10 noise is inaudible flat and audible at 1.12x.
    const vec3 ear{13.0f, 10.0f, 4.0f};   // 11 m away
    CHECK(!noise_audible(n, ear, 1.0f));
    CHECK(noise_audible(n, ear, kInvestigateHearing));
    CHECK(noise_audible(n, ear, kBeamHearing));

    // Layer scoping: the same position on another layer hears nothing at all.
    CHECK(loudest_heard(f, 0, vec3{2, 10, 4}, 1.0f, 0, 0, nullptr) != nullptr);
    CHECK(loudest_heard(f, 1, vec3{2, 10, 4}, 1.0f, 0, 0, nullptr) == nullptr);

    // Severity gate, and the self-filter. A monster must not investigate its own
    // muzzle: 13 of the 69 kinds shoot.
    CHECK(loudest_heard(f, 0, vec3{2, 10, 4}, 1.0f, 4, 0, nullptr) == nullptr);
    NoiseField g;
    CHECK(noise_publish(g, 0, vec3{2, 10, 4}, p, 99u) != 0);
    CHECK(loudest_heard(g, 0, vec3{2, 10, 4}, 1.0f, 0, 99u, nullptr) == nullptr);
    CHECK(loudest_heard(g, 0, vec3{2, 10, 4}, 1.0f, 0, 98u, nullptr) != nullptr);

    // Louder wins over nearer. A severity-4 rifle at the edge of its radius beats a
    // severity-2 crate underfoot: severity*10 dominates nearness*8 by construction.
    NoiseField h;
    NoiseProfile crate = container_open_noise();
    NoiseProfile rifle;
    rifle.radius = 24.0f;
    rifle.ttlMs = 2800;
    rifle.severity = 4;
    rifle.source = NoiseSource::WeaponFire;
    const std::uint32_t crateId = noise_publish(h, 0, vec3{40, 40, 2}, crate, 0);
    const std::uint32_t rifleId = noise_publish(h, 0, vec3{62, 40, 2}, rifle, 0);
    CHECK(crateId != 0 && rifleId != 0);
    const Noise* pick = loudest_heard(h, 0, vec3{40, 40, 2}, 1.0f, 2, 0, nullptr);
    CHECK(pick != nullptr);
    if (pick) CHECK(pick->id == rifleId);
}

static void test_noise_weapon_profiles() {
    // Every one of the 29 firearms produces a legal, in-band profile — a table-driven
    // radius means a new CSV row is automatically as loud as its numbers deserve, and
    // this is what catches a row that would make it silent or world-spanning.
    int loudEnoughToBeatSight = 0;
    float minR = 1e9f, maxR = -1e9f;
    for (std::size_t i = 0; i < kRangedCount; ++i) {
        const NoiseProfile p = weapon_fire_noise(kRangedTable[i]);
        CHECK(p.source == NoiseSource::WeaponFire);
        CHECK(p.ttlMs == 2800);
        CHECK(p.radius >= 9.0f && p.radius <= 24.0f);
        CHECK(p.severity >= 2 && p.severity <= 4);
        // The banding must agree with the radius it was derived from.
        if (p.radius >= 21.0f) CHECK(p.severity == 4);
        else if (p.radius >= 13.0f) CHECK(p.severity == 3);
        else CHECK(p.severity == 2);
        if (p.radius < minR) minR = p.radius;
        if (p.radius > maxR) maxR = p.radius;
        // Audible beyond the 20 m sight radius once the investigation bonus applies:
        // that band is the ONLY place "heard but not seen" can happen.
        if (p.radius * kInvestigateHearing > kAggroRadius) ++loudEnoughToBeatSight;
    }
    std::printf("noise: 29 guns, radius %.1f..%.1f m, %d of 29 audible past the "
                "%.0f m sight radius\n", minR, maxR, loudEnoughToBeatSight,
                kAggroRadius);
    // At least the heavy rifles must clear it, or the primitive cannot be shown to do
    // anything sight does not already do.
    CHECK(loudEnoughToBeatSight > 0);

    // Nothing else publishes above the investigation threshold by accident.
    CHECK(body_fall_noise().severity == 2);
    CHECK(container_open_noise().severity == 2);
    CHECK(container_open_noise().radius == 7.0f);
}

// The stagger contract between investigate_step and wander_step. If these two ever compute
// different slots, a mob is claimed by both systems on alternating ticks and vibrates
// between a target and a sound. Asserted rather than trusted because the hash is
// duplicated across the two files on purpose ([hunt.cpp]).
static void test_hunt_shares_the_wander_stagger() {
    Registry reg;
    NoiseField f;
    NpcPool pool;
    pool.init();

    // A mob with no noise anywhere: investigate_step must not touch it on ANY tick, which is
    // also the proof that the quiet early-out really is an early-out.
    Entity m = reg.create();
    reg.emplace<Transform>(m, Transform{vec3{40, 40, 2}, 0});
    reg.emplace<Velocity>(m, Velocity{vec3{1, 2, 3}});
    reg.emplace<MobRef>(m, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, 40, 40});
    for (std::uint64_t t = 0; t < 32; ++t) CHECK(investigate_step(reg, f, pool, 0, t) == 0);
    CHECK(reg.get<Velocity>(m).v.x == 1.0f);   // untouched, not zeroed

    // Now make a noise it can hear, and find the tick it is visited on. Exactly one
    // tick in kWanderPeriod, which is the stagger working.
    NoiseProfile p;
    p.radius = 30.0f;
    p.ttlMs = 60000;
    p.severity = 4;
    p.source = NoiseSource::WeaponFire;
    CHECK(noise_publish(f, 0, vec3{60, 40, 2}, p, 0) != 0);
    int visits = 0;
    for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
        if (investigate_step(reg, f, pool, 0, t) == 1) ++visits;
    CHECK(visits == 1);
}

// ---------------------------------------------------------------------------
// The demonstration
// ---------------------------------------------------------------------------
// A monster 22 m away cannot see the player: sight aggro is kAggroRadius = 20 m, and
// there is no line-of-sight test anywhere in the tree, so > 20 m is unambiguously
// outside every way the mob previously had of knowing anything existed. The player
// fires a rifle. Measured: how much ground the mob covers toward the shot, against a
// bit-identical control run with the shot silenced.
//
// Attribution is what `soundSteers` is for. It counts only the passes in which
// `investigate_step` steered the mob — and `investigate_step` refuses any mob inside sight range —
// so a non-zero count is proof the movement was caused by hearing and not by seeing.
// The mob does eventually close inside 20 m and sight takes over from there, which is
// correct behaviour ("heard it, walked over, then saw you") and is why the count and
// not the final distance carries the attribution.
static void test_noise_moves_a_monster_that_cannot_see_you() {
    // Physics needs a real floor; wander needs a baked nav or it no-ops. Both are the
    // live systems, not stubs — the point is to measure the game, not a harness.
    World w;
    generate_floor(w, /*number=*/0, floor_spec(FloorKind::Industrial), 4242u);
    nav::CoarseGraph coarse{};
    nav::bake_coarse(w.grid(), coarse);
    nav::FineNav fine;
    nav::bake_fine(w.grid(), fine);

    // Two identical worlds-in-miniature: same seeds, same positions, same ticks. The
    // ONLY difference is whether the gunshot is published.
    struct Run {
        Registry reg;
        NoiseField noise;
        NpcPool pool;
        Entity mob = entt::null;
        Entity player = entt::null;
        float startD = 0.0f;
    };

    // A standable pair of cells 11 cells (22 m) apart on the same row: air, with
    // something solid under it. Derived from the floor rather than hardcoded, because a
    // body spawned inside a pillar is a physics measurement, not a hearing one.
    auto standable = [&](int x, int y) {
        return w.grid().cell(wrap_macro(x), y, 1) == kCellAir &&
               w.grid().cell(wrap_macro(x), y, 0) != kCellAir;
    };
    // 26 m: deep in the hearing-only band, between the 20 m sight radius and a rifle's
    // 24 m x 1.12 investigation hearing = 26.9 m. It was 11 cells / 22 m, which is
    // inside that band on paper and useless in practice: only 2 m of clearance, so the
    // mob wanders into SIGHT within about a second and sight aggro then drives the
    // audible and silent runs identically — contaminating the one thing measured here.
    const int kGapCells = 13;
    int px = 0, py = 0;
    for (int y = 30; y < 100 && !px; ++y)
        for (int x = 30; x < 100; ++x)
            if (standable(x, y) && standable(x + kGapCells, y)) { px = x; py = y; break; }
    CHECK(px != 0);

    const vec3 playerPos{(static_cast<float>(px) + 0.5f) * kCellSize,
                         (static_cast<float>(py) + 0.5f) * kCellSize,
                         kCellSize + 0.9f};
    const float gap = static_cast<float>(kGapCells) * kCellSize;
    const vec3 mobPos{playerPos.x + gap, playerPos.y, playerPos.z};

    auto setup = [&](Run& r) {
        r.pool.init();
        NpcId pid = r.pool.spawn();
        r.pool.height_mm(pid) = 1750;
        r.player = embody_as_player(r.reg, r.pool, pid, /*layer=*/0);
        CHECK(r.player != entt::null);
        r.reg.get<Transform>(r.player).pos = playerPos;
        // A gun and a magazine's worth of ammo, so the shot is a real shot through
        // player_ranged_step and not a hand-made noise.
        Inventory& inv = r.pool.inventory(pid);
        ItemId gun = kInvalidItem;
        const RangedDef* def = nullptr;
        for (ItemId id = 1; id <= kItemCount && !def; ++id) {
            const RangedDef* d = ranged_for_item(id);
            // The loudest class in the table: a heavy round, single pellet.
            if (d && d->dmg >= 100) { gun = id; def = d; }
        }
        CHECK(def != nullptr);
        inv.slots[0] = ItemSlot{gun, 1};
        if (def) inv.slots[1] = ItemSlot{def->ammo, 40};
        // Pre-armed: weapon already drawn, magazine already full.
        //
        // Without this the test cannot fire at all, and it is worth recording why,
        // because the failure reads as a noise bug and is not one. On its first call
        // player_ranged_step sees pr.weapon (0) != gun, takes the gun-swap branch
        // which empties the magazine, then finds magCount == 0, STARTS A RELOAD and
        // returns 0 ([combat.cpp]). The shot would land some reloadMs later — but this
        // test requests fire only on tick 0, so no shot ever happened: shotsFired
        // stayed 0 and soundSteers, live() and the distance delta all failed as
        // consequences of a mob that never shot, not of anything it failed to hear.
        // Arming the magazine here keeps the "fire exactly once, on tick 0" design,
        // which is what makes the loud and silent runs identical in every other way.
        if (def)
            r.reg.emplace_or_replace<PlayerRanged>(
                r.player, PlayerRanged{0, 0, def->magazine, gun, 0, 0});

        // A Zombie: Plain behaviour, ordinary speed, nothing special to confound the
        // measurement.
        r.mob = r.reg.create();
        r.reg.emplace<Transform>(r.mob, Transform{mobPos, 0});
        r.reg.emplace<Velocity>(r.mob, Velocity{});
        r.reg.emplace<AABB>(r.mob, AABB{vec3{0.4f, 0.4f, 0.9f}});
        r.reg.emplace<GravityAffected>(r.mob, GravityAffected{});
        r.reg.emplace<MobRef>(
            r.mob, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, 40, 40});
        r.reg.emplace<MobCombat>(r.mob, MobCombat{});
        CHECK(wander_init(r.reg, 0, 99u) > 0);
        r.startD = std::sqrt(
            wrap_delta_f(mobPos.x, playerPos.x, kWorldExtent) *
                wrap_delta_f(mobPos.x, playerPos.x, kWorldExtent) +
            wrap_delta_f(mobPos.y, playerPos.y, kWorldExtent) *
                wrap_delta_f(mobPos.y, playerPos.y, kWorldExtent));
    };

    Run loud, silent;
    setup(loud);
    setup(silent);
    // The mob starts outside every way it could previously have known anything.
    CHECK(loud.startD > kAggroRadius);
    CHECK(std::fabs(loud.startD - silent.startD) < 1e-4f);

    const float dt = giga::kSimDt;
    const std::uint32_t dtMs = static_cast<std::uint32_t>(dt * 1000.0f + 0.5f);
    LevelStack stack;
    // The stack has to own the floor for physics; one layer, index 0.
    stack.push_layer();
    stack.layer(0).grid() = w.grid();

    std::uint32_t shotsFired = 0;
    std::uint32_t soundSteers = 0;
    // 350 ticks = 2.80 s at the 125 Hz sim tick: the gunshot's whole life, so the
    // window is the noise's TTL rather than an arbitrary count. It was 300 ticks /
    // 2.5 s written against a 120 Hz tick, and both halves of that had to move.
    const int kWindowTicks = 350;
    for (std::uint64_t t = 0; t < static_cast<std::uint64_t>(kWindowTicks); ++t) {
        for (Run* r : {&loud, &silent}) {
            const bool audible = (r == &loud);
            noise_step(r->noise, dtMs);
            wander_step(r->reg, stack.layer(0).grid(), r->pool, coarse, fine, 0, t);
            const std::uint32_t heard = investigate_step(r->reg, r->noise, r->pool, 0, t);
            if (audible) soundSteers += heard;
            physics_step(r->reg, stack, dt);
            // Fire once, on tick 0. The silent run fires the same shot with no sink,
            // so the projectile, the ammo spend and the cooldown are identical and the
            // ONLY difference between the two runs is the noise record.
            if (t == 0) {
                const std::uint32_t s = player_ranged_step(
                    r->reg, r->pool, 0, /*wantFire=*/true, dt, t,
                    audible ? &r->noise : nullptr);
                if (audible) shotsFired += s;
            }
        }
    }

    auto dist_to_player = [&](Run& r) {
        const vec3 mp = r.reg.get<Transform>(r.mob).pos;
        const float dx = wrap_delta_f(mp.x, playerPos.x, kWorldExtent);
        const float dy = wrap_delta_f(mp.y, playerPos.y, kWorldExtent);
        return std::sqrt(dx * dx + dy * dy);
    };
    const float loudEnd = dist_to_player(loud);
    const float silentEnd = dist_to_player(silent);

    std::printf("noise: gunshot demo — %s at %.1f m, %d ticks (%.2f s)\n"
                "  start    : %.2f m  (sight radius %.0f m, so it cannot see him)\n"
                "  heard    : %.2f m  (closed %+.2f m)\n"
                "  silenced : %.2f m  (closed %+.2f m)\n"
                "  delta    : %.2f m | %u sound-steers while blind | %u shot | "
                "%u live noise\n",
                mob_name(MobKind::Zombie), gap, kWindowTicks,
                static_cast<double>(kWindowTicks) * dt,
                loud.startD, kAggroRadius,
                loudEnd, loud.startD - loudEnd,
                silentEnd, loud.startD - silentEnd,
                silentEnd - loudEnd, soundSteers, shotsFired,
                static_cast<unsigned>(loud.noise.live()));

    // The shot happened, was heard, and was acted on WHILE the mob was outside sight
    // range — investigate_step refuses any mob inside it, so a non-zero count is the
    // attribution.
    CHECK(shotsFired == 1);
    CHECK(soundSteers > 0);
    CHECK(loud.noise.live() == 1);
    // The audible run closed real ground toward the player.
    CHECK(loud.startD - loudEnd > 4.0f);   // measured 7.82 m

    // ...and it ended closer than the silent control. The threshold is 0.5 m and NOT
    // the 4 m first written here, and the difference is a limit of THIS TEST rather
    // than of the system, so it is recorded instead of quietly relaxed.
    //
    // The control is not an independent random walk. Both runs share wander seed 99u
    // and follow the same baked nav route, and that route already leads toward the
    // player's region: the silent mob closes 6.73 m of the 7.82 m the audible one
    // does. The noise can therefore only NUDGE an already-playerward path, and a 4 m
    // differential is unachievable by construction — it would need the control to
    // stand still. Nobody had ever seen that, because shotsFired == 1 above failed
    // first: the shot never happened, so this line had never once run against a mob
    // that actually heard anything.
    //
    // Two things were fixed besides the number. The start gap went 11 -> 13 cells
    // (22 -> 26 m): at 22 m a mob sits only 2 m outside the 20 m sight radius, wanders
    // into sight within about a second, and SIGHT aggro then drives both runs
    // identically — contaminating exactly the thing being measured. 26 m sits deep in
    // the hearing-only band (a rifle reaches 24 m x 1.12 = 26.9 m), and the window is
    // now 350 ticks = 2.80 s, the gunshot's real TTL rather than an arbitrary 300.
    // Together those took the effect from 11 sound-steers / 0.34 m to 33 / 1.09 m.
    //
    // So 0.5 m is a measured floor with ~2x margin, not a number picked to pass. What
    // carries the real claim is soundSteers above: 33 deliberate steers toward a
    // noise, by a mob that could not see the player.
    CHECK(silentEnd - loudEnd > 0.5f);     // measured 1.09 m

    // And the mechanism, not just the outcome: with the noise expired the same mob
    // stops being steered by it at all.
    noise_clear(loud.noise);
    CHECK(loud.noise.quiet());
    std::uint32_t after = 0;
    for (std::uint64_t t = 400; t < 400 + kWanderPeriod; ++t)
        after += investigate_step(loud.reg, loud.noise, loud.pool, 0, t);
    CHECK(after == 0);
}

// Sight beats sound, and the deaf kind stays deaf. Two behavioural contracts that are
// invisible in the demo above because the mob there is Plain and far away.
static void test_hunt_precedence_and_deaf_kinds() {
    NoiseField f;
    NoiseProfile p;
    p.radius = 40.0f;
    p.ttlMs = 60000;
    p.severity = 4;
    p.source = NoiseSource::WeaponFire;
    // A noise 30 m away in -x, a player 5 m away in +x.
    CHECK(noise_publish(f, 0, vec3{10, 50, 2}, p, 0) != 0);

    Registry reg;
    NpcPool pool;
    pool.init();
    NpcId pid = pool.spawn();
    pool.height_mm(pid) = 1750;
    Entity player = embody_as_player(reg, pool, pid, 0);
    reg.get<Transform>(player).pos = vec3{45, 50, 2};

    Entity m = reg.create();
    reg.emplace<Transform>(m, Transform{vec3{40, 50, 2}, 0});
    reg.emplace<Velocity>(m, Velocity{});
    reg.emplace<MobRef>(m, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, 40, 40});

    // The player is 5 m away — well inside sight aggro — so the sound is ignored no
    // matter how loud it is. Checked across a full stagger period so this cannot pass
    // by the mob simply not being visited.
    std::uint32_t steered = 0;
    for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
        steered += investigate_step(reg, f, pool, 0, t);
    CHECK(steered == 0);

    // Move the player out of sight range and the same mob investigates.
    reg.get<Transform>(player).pos = vec3{40 + kAggroRadius + 5.0f, 50, 2};
    steered = 0;
    for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
        steered += investigate_step(reg, f, pool, 0, t);
    CHECK(steered == 1);
    // ...and it is steered TOWARD the noise, i.e. away from the player (-x).
    CHECK(reg.get<Velocity>(m).v.x < 0.0f);

    // Безэхий is deaf until revealed, which does not exist yet, so it refuses.
    // Checked through investigate_hear, which is the pure decision with no world at all.
    const vec3 at{40, 50, 2};
    CHECK(investigate_hear(f, MobBehaviour::Plain, 0, at, 0).heard);
    CHECK(!investigate_hear(f, MobBehaviour::DeadEcho, 0, at, 0).heard);
    // The delta points at the sound, and the distance is the real toroidal one.
    const InvestigateHeard hh = investigate_hear(f, MobBehaviour::Plain, 0, at, 0);
    CHECK(hh.dx < 0.0f);
    CHECK(hh.dist > 29.0f && hh.dist < 31.0f);
    CHECK(hh.noiseId != 0);
    CHECK(hh.severity == 4);

    // An immobile kind is architecture, not a searcher: a spore carpet that walks to
    // a gunshot is a worse bug than one that ignores it.
    Entity plant = reg.create();
    reg.emplace<Transform>(plant, Transform{vec3{40, 50, 2}, 0});
    // A sentinel, so "unchanged" is distinguishable from "written to zero".
    reg.emplace<Velocity>(plant, Velocity{vec3{7.0f, -7.0f, 0.0f}});
    reg.emplace<MobRef>(
        plant, MobRef{static_cast<std::uint8_t>(MobKind::Borshchevik), 1, 40, 40});
    CHECK(has_flag(mob_def(MobKind::Borshchevik).aiFlags, AiFlag::Immobile));
    for (std::uint64_t t = 0; t < kWanderPeriod; ++t) investigate_step(reg, f, pool, 0, t);
    CHECK(reg.get<Velocity>(plant).v.x == 7.0f);
    CHECK(reg.get<Velocity>(plant).v.y == -7.0f);
}

// Cost. The claim "free when nobody is shooting" has to be a number, not an adjective.
static void test_noise_cost() {
    Registry reg;
    NoiseField f;
    NpcPool pool;
    pool.init();

    // A realistic floor's worth of monsters, all on one layer.
    const int kMobs = 300;
    for (int i = 0; i < kMobs; ++i) {
        Entity e = reg.create();
        const float x = static_cast<float>((i * 37) % 120) * kCellSize;
        const float y = static_cast<float>((i * 53) % 120) * kCellSize;
        reg.emplace<Transform>(e, Transform{vec3{x, y, 2.0f}, 0});
        reg.emplace<Velocity>(e, Velocity{});
        reg.emplace<MobRef>(
            e, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, 40, 40});
    }

    const int kTicks = 12000;   // 100 s of sim at 120 Hz
    std::uint32_t sink = 0;

    const std::clock_t q0 = std::clock();
    for (int t = 0; t < kTicks; ++t) {
        noise_step(f, 8);
        sink += investigate_step(reg, f, pool, 0, static_cast<std::uint64_t>(t));
    }
    const std::clock_t q1 = std::clock();

    // Now a full field, so every pass does the real work: 64 records scored against
    // every mob in its stagger slot.
    NoiseProfile p;
    p.radius = 48.0f;
    p.ttlMs = 60000;
    p.severity = 4;
    p.source = NoiseSource::WeaponFire;
    for (std::size_t i = 0; i < kNoiseCap; ++i)
        noise_publish(f, 0, vec3{static_cast<float>(i * 3), 60.0f, 2.0f}, p, 0);
    CHECK(f.live() == kNoiseCap);

    const std::clock_t l0 = std::clock();
    for (int t = 0; t < kTicks; ++t) {
        noise_step(f, 0);   // 0 ms so nothing expires and the load stays constant
        sink += investigate_step(reg, f, pool, 0, static_cast<std::uint64_t>(t));
    }
    const std::clock_t l1 = std::clock();

    const double quietUs =
        1e6 * static_cast<double>(q1 - q0) / CLOCKS_PER_SEC / kTicks;
    const double loudUs =
        1e6 * static_cast<double>(l1 - l0) / CLOCKS_PER_SEC / kTicks;
    std::printf("noise: cost per sim tick with %d mobs — quiet %.3f us, "
                "worst case (%zu records live) %.3f us  [%u steers]\n",
                kMobs, quietUs, kNoiseCap, loudUs, sink);
    CHECK(sink > 0);
    // The quiet path must be genuinely free, not merely cheap. 5 us at 120 Hz would
    // be 0.06% of a tick; asserting a loose ceiling still catches the regression that
    // matters (someone removing the quiet() early-out).
    CHECK(quietUs < 5.0);
}

static void test_noise_all() {
    test_noise_field_bounds();
    test_noise_fades();
    test_noise_overflow_keeps_the_gunshot();
    test_noise_hearing_geometry();
    test_noise_weapon_profiles();
    test_hunt_shares_the_wander_stagger();
    test_noise_moves_a_monster_that_cannot_see_you();
    test_hunt_precedence_and_deaf_kinds();
    test_noise_cost();
}
