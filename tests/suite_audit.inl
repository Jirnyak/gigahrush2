#include "core/tick.h"
// Audit suite — one test per defect found by reading the whole of src/game and
// src/render after the 45-commit burst. Included into game_test.cpp, so it uses that
// file's CHECK macro and its `using namespace giga::game`.
//
// EVERY TEST IN HERE THAT CURRENTLY FAILS IS A FINDING. They are written to fail
// against HEAD and to pass once the named defect is fixed, so the fix has a witness
// and the regression has a tripwire. Nothing here fixes anything: a failing test that
// names the bug is worth more than a quiet patch, because the next person reads the
// name.
//
// Currently RED (the findings), in the order they appear below:
//
//   1. projectile_once     projectiles are integrated TWICE per tick — physics_step
//                          and projectile_step both own them, so every bullet flies
//                          at double its authored speed and a bullet stopped by
//                          physics is never destroyed.
//   2. ms_timer_drift      every millisecond timer is driven by
//                          uint16(dt*1000+0.5) = 8 for a 8.3333 ms tick, so all
//                          cooldowns, windups, reloads, TTLs and the samosbor clock
//                          run 4.17% slow with no accumulator to recover the loss.
//   3. gun_kills_counted   a kill by firearm increments no kill counter at all; the
//                          HUD's "kills" is melee-only.
//   4. ammo_has_a_source   all 17 AMMO rows have spawn weight 0, so a weapon crate
//                          cannot contain a round and the vendor cannot sell one.
//                          The only ammo in the game is bundled with a MOB drop.
//   5. descend_not_free    a Descend contract measures RunLedger::deepestFloor with
//                          no baseline at acceptance, so it completes the instant it
//                          is taken — and can be re-taken from the same body for an
//                          unbounded money press.
//   6. hunt_is_findable    contract_offer picks a Hunt kind uniformly over all 69
//                          rows with no spawn-weight or habitat filter, so it can
//                          name a monster that cannot spawn anywhere.
//   7. stack_max_respected pickup_step merges a bundle into a partly-filled slot
//                          without re-checking stackMax, so a slot can hold more
//                          than the item legally stacks.
//
// Currently GREEN (pins, not findings): budget_vs_demo_cap records the numbers behind
// the kMobSpawnCap claim in src/app/main.cpp so the report's arithmetic is machine-
// checked rather than asserted in prose.

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
// 1. Projectiles are integrated twice per tick
// ---------------------------------------------------------------------------
// `projectile_step` integrates position itself (combat.cpp:482-484: wrapf(pos + v*dt)
// on x/y and pos.z += v.z*dt). `physics_step` iterates `view<Transform, Velocity>`
// (physics.cpp:82) and a Projectile carries both — plus an AABB — so the sweep moves
// it a second time and collides it.
//
// Two consequences, both player-visible:
//
//   * every shot travels at 2x its authored muzzle speed, which silently doubles the
//     effective range of all 29 firearms and all 13 ranged monsters and halves the
//     telegraph value of the windup;
//   * physics ZEROES the velocity on a wall hit and leaves the entity flush against
//     an AIR cell, so `projectile_step`'s own solid-cell test never fires and the
//     tracer hangs in the air, lit, until kProjTtlMs (4 s) expires.
//
// Nothing caught it because tests/game_test.cpp test_player_shoots drives
// projectile_step in a loop with no physics_step, which is not the tick order
// src/app/main.cpp uses (physics_step at :787, projectile_step at :820).
static void projectile_once() {
    LevelStack stack;
    LayerId layer = stack.push_layer();   // a fresh layer is all air
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();   // publish() indexes ring_ without checking it exists — see the report

    // gravityPct 0 so the x displacement is exactly speed*dt per integration and the
    // assertion is arithmetic rather than a tolerance on a ballistic arc.
    auto make_shot = [&](vec3 at, vec3 vel) {
        Entity e = reg.create();
        Transform tr;
        tr.pos = at;
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<Velocity>(e, Velocity{vel});
        reg.emplace<AABB>(e, AABB{vec3{0.10f, 0.10f, 0.10f}});
        reg.emplace<Projectile>(e, Projectile{entt::null, 10, kProjTtlMs, 0, 1});
        return e;
    };

    // (a) physics_step must not move a projectile at all: projectile_step owns it.
    {
        Entity p = make_shot(vec3{40.0f, 40.0f, 40.0f}, vec3{30.0f, 0.0f, 0.0f});
        const float x0 = reg.get<Transform>(p).pos.x;
        physics_step(reg, stack, kDt);
        CHECK(reg.get<Transform>(p).pos.x == x0);
        reg.destroy(p);
    }

    // (b) one tick in src/app/main.cpp's real order must advance a shot by exactly
    //     one speed*dt, not two.
    {
        const float speed = 30.0f;
        const int ticks = 12;
        Entity p = make_shot(vec3{40.0f, 40.0f, 40.0f}, vec3{speed, 0.0f, 0.0f});
        for (int i = 0; i < ticks; ++i) {
            physics_step(reg, stack, kDt);      // main.cpp:787
            projectile_step(reg, pool, bus, stack, layer, kDt,
                            static_cast<std::uint64_t>(i));   // main.cpp:820
        }
        CHECK(reg.valid(p));
        if (reg.valid(p)) {
            const float moved = reg.get<Transform>(p).pos.x - 40.0f;
            const float want = speed * static_cast<float>(ticks) * kDt;
            std::fprintf(stderr,
                         "[audit] projectile: %d ticks at %.1f m/s moved %.3f m, "
                         "authored %.3f m (ratio %.2f)\n",
                         ticks, speed, moved, want, moved / want);
            CHECK(std::fabs(moved - want) < 0.01f);
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Every millisecond timer runs 4.17% slow
// ---------------------------------------------------------------------------
// The sim step is 1/120 s = 8.3333 ms, and every consumer converts it with
// `uint16(dt * 1000.0f + 0.5f)`, which is 8 — a third of a millisecond dropped on the
// floor every tick, with no accumulator anywhere to carry it. So an authored 1000 ms
// cooldown takes 125 ticks (1.0417 s), a 30 s samosbor warning takes 31.25 s, and a
// 4 s projectile TTL lasts 4.17 s.
//
// It is uniform, so nothing looks obviously wrong — which is exactly why it is worth a
// test. It is also already baked in as *expected* by
// tests/game_test.cpp test_player_shoots, which derives its boundary as
// `ceil(reloadMs / stepMs)` from the implementation instead of from the spec. That
// test would keep passing after a fix; this one only passes after one.
//
// Sites: combat.cpp:188, :453, :586, :705 and src/app/main.cpp:759.
static void ms_timer_drift() {
    CHECK(step_ms() == 8);   // the quantisation, stated so the arithmetic is visible

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
        // One second of sim time is 120 ticks of 1/120 s. Currently 125.
        std::fprintf(stderr,
                     "[audit] timer: a 1000 ms mob cooldown cleared after %d ticks "
                     "of 1/120 s = %.4f s\n",
                     ticks, static_cast<double>(ticks) * kSimDt);
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
// 3. A firearm kill is counted nowhere
// ---------------------------------------------------------------------------
// `player_melee_step` credits a lethal swing (combat.cpp:758 `++pm.kills`).
// `projectile_step` credits a HIT to PlayerRanged::hits (combat.cpp:562) and credits a
// KILL to nothing — PlayerRanged has no kill field and PlayerMelee is not touched. The
// HUD prints PlayerMelee::kills (src/app/main.cpp:1015-1017) and carries it across
// possession, so it is the tally the player reads; shoot the whole floor dead and it
// stays at zero.
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
    CHECK(reg.get<PlayerRanged>(shooter).hits == 1);         // the hit was credited
    CHECK(reg.get<PlayerMelee>(shooter).kills == 1);         // the KILL was not
}

// ---------------------------------------------------------------------------
// 4. Ammunition has no source except a mob-dropped gun
// ---------------------------------------------------------------------------
// Measured over data/items.csv: all 17 AMMO rows carry spawn_w_milli == 0.
// `item_weight_on_floor` returns 0 for weight 0 (item_table.cpp:2276), and every
// weighted roller in the game filters on it — so:
//
//   * `roll_container(WeaponCrate, ...)` admits Weapon|Ammo (container.cpp:125-128)
//     and can only ever produce weapons. container.h:50 calls the kind "Ammo and a\n//     weapon" and the file header calls it "ammo and access"; neither can happen.
//   * `vendor_stocks(Ammo)` is true (vendor.cpp:26) and `vendor_buy_price` prices it,
//     but `vendor_resupply` — the ONLY buy path wired to a key (src/app/main.cpp:913)
//     — walks Drink, Medicine and Food only (vendor.cpp:155-156).
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
// `contract_step` reads `led.deepestFloor` (contract.cpp:234), which is the deepest
// point of the whole SESSION, and `contract_accept` records no baseline. So a job to
// reach -20, taken after any trip past -20, is already complete on the tick it is
// accepted.
//
// The repeat is the expensive half. `contract_accept` refuses a duplicate only while
// the existing copy is ACTIVE (contract.cpp:151); once it is Complete the slot is
// reusable, and `contract_offer` is deterministic in (giver, floor) — so the same body
// re-offers the identical job every `kOverhearCooldownTicks` (2 s) and every E press
// pays again, forever, without moving. Descend is 20% of all offers
// (contract.cpp:56-101), and the reward is paid straight into `banked`, which is the
// one number the whole extraction loop is scored on.
static void descend_not_free() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    CHECK(pool.alive(giver));

    Contract job{};
    job.giver = giver;
    job.kind = static_cast<std::uint8_t>(ObjectiveKind::Descend);
    job.target = -20;
    job.reward = 900;
    job.state = static_cast<std::uint8_t>(ContractState::Offered);

    RunLedger led{};
    led.deepestFloor = -50;          // already been deeper, earlier in the run
    led.deepestBand = economy_band(-50);
    Inventory inv{};

    ContractBook book{};
    CHECK(contract_accept(book, job, kNoDescentYet));
    const std::int32_t first = contract_step(book, pool, inv, led);
    CHECK(first == 0);   // taking a job must not complete it

    // ...and re-taking it must not pay a second time either.
    CHECK(contract_accept(book, job, kNoDescentYet));
    const std::int32_t second = contract_step(book, pool, inv, led);
    std::fprintf(stderr,
                 "[audit] contracts: Descend(-20) with deepestFloor -50 paid %d rub "
                 "on accept, %d rub on re-accept, player never moved\n",
                 first, second);
    CHECK(second == 0);
}

// ---------------------------------------------------------------------------
// 6. A Hunt contract can name a monster that cannot spawn
// ---------------------------------------------------------------------------
// contract.cpp:84-87 comments "A kind that lives at this depth, so the job is\n// findable" and then picks uniformly over all `kMobKindCount` rows with no
// spawn-weight and no floorMask filter. `spawn_floor_mobs` skips any row with
// `spawnWeightX10 == 0` (mob_spawn.cpp:162), and data/mobs.csv has two such rows —
// CREATOR and PSEUDOLIFT, both with dmg > 0 so the `md.dmg == 0` guard lets them
// through. Neither can appear on any floor by any path, so a Hunt naming one is
// exactly the "quest that can never complete" the same comment says it is avoiding.
//
// The habitat half is worse but softer: a kind whose floorMask excludes every floor
// the building actually labels is equally unhuntable, and nothing checks that either.
static void hunt_is_findable() {
    NpcPool pool;
    pool.init();
    for (int i = 0; i < 512; ++i) pool.spawn();

    const int floors[] = {0, 1, 2, -8, -14, -26, -36, -50, 14, 30};
    int hunts = 0;
    int impossible = 0;
    for (NpcId g = 0; g < 512; ++g)
        for (int z : floors) {
            // 0x9E37u is the seed src/app/main.cpp:843 actually passes, so this is
            // the live offer stream and not a synthetic one.
            const Contract c = contract_offer(pool, g, z, 0x9E37u);
            if (c.giver == kInvalidNpc) continue;
            if (c.kind != static_cast<std::uint8_t>(ObjectiveKind::Hunt)) continue;
            ++hunts;
            if (c.subject >= kMobKindCount ||
                kMobTable[c.subject].spawnWeightX10 == 0)
                ++impossible;
        }
    std::fprintf(stderr,
                 "[audit] contracts: %d Hunt offers scanned, %d name a kind with "
                 "spawn weight 0 (unspawnable)\n",
                 hunts, impossible);
    CHECK(hunts > 0);        // the scan actually exercised the Hunt branch
    CHECK(impossible == 0);  // no offer may name an unspawnable kind
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
// the invariant every other consumer assumes, and loot.h:225 states the opposite
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
// with "the demo floors (|number| <= 4) are far below this anyway, so it is a guard\n// rail rather than a live limit". That comment predates commit 8e0a0d3, which moved
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

} // namespace audit_test

static void test_audit_all() {
    audit_test::projectile_once();
    audit_test::ms_timer_drift();
    audit_test::gun_kills_counted();
    audit_test::ammo_has_a_source();
    audit_test::descend_not_free();
    audit_test::hunt_is_findable();
    audit_test::stack_max_respected();
    audit_test::budget_vs_demo_cap();
}
