// RPG progression — the port of the reference `systems/rpg.ts`.
//
// The reference pins three XP-curve values in its OWN source comment
// (xpForLevel(2)=100, (5)=295, (10)=1020). Those are the highest-value checks in
// this file: they are the reference author's stated intent, not this port's
// arithmetic restated, so they catch a transcription error the formula itself
// cannot. Everything else is either a shape property (monotonicity, asymptote
// ceilings, inverse-never-zero) or a hand-computed reference value.

static void test_rpg_curve() {
    // The three values the reference comment pins.
    CHECK(xp_for_level(2) == 100);
    CHECK(xp_for_level(5) == 295);
    CHECK(xp_for_level(10) == 1020);

    // Level 1 costs nothing to be, and level 0 is not a level.
    CHECK(xp_for_level(0) == 0);
    CHECK(xp_for_level(1) == 0);

    // 75 + 25*rank + 10*rank*(rank-1) spelled out at rank 2 and 3.
    CHECK(xp_for_level(3) == 75 + 50 + 20);    // 145
    CHECK(xp_for_level(4) == 75 + 75 + 60);    // 210

    // Strictly increasing across the whole range — a non-monotonic curve would let
    // a level-up loop stall or skip.
    std::uint32_t prev = xp_for_level(2);
    for (int lv = 3; lv <= kRpgLevelCap; ++lv) {
        const std::uint32_t cur = xp_for_level(static_cast<std::uint8_t>(lv));
        CHECK(cur > prev);
        prev = cur;
    }

    // At the cap: rank 254 -> 75 + 6350 + 10*254*253 = 649,045. Well inside u32,
    // which is what the header claims.
    CHECK(xp_for_level(kRpgLevelCap) == 75u + 25u * 254u + 10u * 254u * 253u);
    CHECK(xp_for_level(kRpgLevelCap) == 649045u);

    // Cumulative sums, including the reference's own first two steps.
    CHECK(total_xp_for_level(1) == 0);
    CHECK(total_xp_for_level(2) == 100);
    CHECK(total_xp_for_level(3) == 245);
    CHECK(total_xp_for_level(4) == 455);
    // The whole ladder fits comfortably in u32 even though the API returns u64.
    CHECK(total_xp_for_level(kRpgLevelCap) < 0xFFFFFFFFull);

    CHECK(clamp_rpg_level(0) == 1);
    CHECK(clamp_rpg_level(-9) == 1);
    CHECK(clamp_rpg_level(1) == 1);
    CHECK(clamp_rpg_level(300) == kRpgLevelCap);
    CHECK(clamp_rpg_attribute(-1) == 0);
    CHECK(clamp_rpg_attribute(999) == kRpgAttributeCap);
}

static void test_rpg_derived() {
    // Level base growth: +1 per level, from 100.
    CHECK(level_hp(1) == 100);
    CHECK(level_hp(2) == 101);
    CHECK(level_hp(10) == 109);
    CHECK(level_psi(1) == 100);
    CHECK(level_psi(50) == 149);

    RpgStats r = fresh_rpg(1);
    CHECK(r.level == 1);
    CHECK(r.xp == 0);
    CHECK(r.attrPoints == 0);
    CHECK(r.attr[0] == 0 && r.attr[1] == 0 && r.attr[2] == 0);
    // A fresh character starts at full PSI, and with no INT that is exactly base.
    CHECK(r.psi == 100);
    CHECK(max_psi(r) == 100);
    CHECK(max_hp(r) == 100);

    // Every multiplier is x1.000 at zero points. This is the check that a wrong
    // shape (e.g. an asymptotic stat coded as linear) most often survives, so it is
    // worth stating for all nine.
    CHECK(str_melee_dmg_mult_e3(r) == 1000);
    CHECK(str_durability_wear_mult_e3(r) == 1000);
    CHECK(agi_move_speed_mult_e3(r) == 1000);
    CHECK(agi_attack_speed_mult_e3(r) == 1000);
    CHECK(agi_ranged_spread_mult_e3(r) == 1000);
    CHECK(int_xp_mult_e3(r) == 1000);
    CHECK(int_psi_cost_mult_e3(r) == 1000);
    CHECK(int_contract_reward_mult_e3(r) == 1000);
    CHECK(int_document_reward_mult_e3(r) == 1000);
    CHECK(int_psi_duration_bonus_sec(r) == 0);

    // LINEAR: STR at +1%/point. 10 points = x1.10 HP and x1.10 melee.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Str)] = 10;
    CHECK(str_melee_dmg_mult_e3(r) == 1100);
    CHECK(max_hp(r) == 110);              // round(100 * 1.10)
    r.attr[static_cast<std::size_t>(Attr::Str)] = 50;
    CHECK(str_melee_dmg_mult_e3(r) == 1500);
    CHECK(max_hp(r) == 150);

    // LINEAR: AGI move speed, +1%/point.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Agi)] = 25;
    CHECK(agi_move_speed_mult_e3(r) == 1250);

    // LINEAR: INT feeds max PSI at +1%/point.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Int)] = 20;
    CHECK(max_psi(r) == 120);
    CHECK(int_psi_duration_bonus_sec(r) == 20);   // +1 s per point, flat

    // INVERSE: 1/(1 + p*k). AGI attack cooldown at k=0.02 — 10 points gives
    // 1/1.2 = 0.8333 -> 833, and the value must always be BELOW 1000 (faster) and
    // never reach 0 no matter how many points go in.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Agi)] = 10;
    CHECK(agi_attack_speed_mult_e3(r) == 833);
    // Spread at k=0.12 — 10 points gives 1/2.2 = 0.4545 -> 455.
    CHECK(agi_ranged_spread_mult_e3(r) == 455);
    r.attr[static_cast<std::size_t>(Attr::Agi)] = kRpgAttributeCap;
    CHECK(agi_attack_speed_mult_e3(r) > 0);       // never free
    CHECK(agi_attack_speed_mult_e3(r) < 1000);
    CHECK(agi_ranged_spread_mult_e3(r) > 0);

    // INVERSE: STR durability wear at k=0.08 — 5 points gives 1/1.4 = 0.7143 -> 714.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Str)] = 5;
    CHECK(str_durability_wear_mult_e3(r) == 714);

    // INVERSE: INT psi cost at k=0.035 — 10 points gives 1/1.35 = 0.7407 -> 741.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Int)] = 10;
    CHECK(int_psi_cost_mult_e3(r) == 741);

    // ASYMPTOTIC, and the ceiling is the whole point: INT's xp bonus saturates at
    // +100% (asymptote 1.0), so no number of points reaches x2.000.
    for (int p = 1; p <= kRpgAttributeCap; ++p) {
        r.attr[static_cast<std::size_t>(Attr::Int)] = static_cast<std::uint8_t>(p);
        CHECK(int_xp_mult_e3(r) <= 2000);
        CHECK(int_contract_reward_mult_e3(r) <= 1500);   // asymptote 0.5
        CHECK(int_document_reward_mult_e3(r) <= 1700);   // asymptote 0.7
    }
    // And it does approach the ceiling: at the cap all three are near their limit.
    r.attr[static_cast<std::size_t>(Attr::Int)] = kRpgAttributeCap;
    CHECK(int_xp_mult_e3(r) > 1990);
    CHECK(int_contract_reward_mult_e3(r) > 1495);
    CHECK(int_document_reward_mult_e3(r) > 1690);
    // Monotone rising, which distinguishes a saturating curve from a clamped one.
    std::uint16_t prevXp = 1000;
    for (int p = 1; p <= 40; ++p) {
        r.attr[static_cast<std::size_t>(Attr::Int)] = static_cast<std::uint8_t>(p);
        const std::uint16_t cur = int_xp_mult_e3(r);
        CHECK(cur > prevXp);
        prevXp = cur;
    }

    // The heavy-weapon GATE: STR speeds up a >=650 ms weapon and does nothing to a
    // lighter one. That branch is why STR is not a universal attack-speed stat.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Str)] = 10;
    CHECK(str_heavy_weapon_speed_mult_e3(r, 649) == 1000);   // light: untouched
    CHECK(str_heavy_weapon_speed_mult_e3(r, 650) < 1000);    // heavy: faster
    CHECK(str_heavy_weapon_speed_mult_e3(r, 650) == 667);    // 1/(1+10*0.05)=0.6667
    CHECK(str_heavy_weapon_speed_mult_e3(r, 2000) == 667);
}

static void test_rpg_melee_and_psi() {
    // The reference's two-branch melee rule, and the branch is easy to get wrong:
    // WITH a weapon, damage is weaponDamage + (level-1); BARE HANDED the weapon
    // number is ignored entirely and damage is the level itself.
    RpgStats r = fresh_rpg(1);
    CHECK(melee_damage(r, 0, 999) == 1);      // bare hands at level 1: 1, not 999
    CHECK(melee_damage(r, 1, 25) == 25);      // armed at level 1: no level bonus

    r = fresh_rpg(10);
    CHECK(melee_damage(r, 0, 999) == 10);     // bare hands: the level
    CHECK(melee_damage(r, 1, 25) == 34);      // 25 + 9

    // STR then multiplies whichever branch produced the base.
    r.attr[static_cast<std::size_t>(Attr::Str)] = 20;   // x1.20
    CHECK(melee_damage(r, 1, 25) == 41);      // round(34 * 1.20) = 40.8 -> 41
    CHECK(melee_damage(r, 0, 0) == 12);       // round(10 * 1.20)

    // A zero-damage weapon still gets the level bonus, and never goes negative.
    r = fresh_rpg(5);
    CHECK(melee_damage(r, 1, 0) == 4);

    // PSI cost: INT makes it cheaper but the floor is 1, never 0 — a free spell is
    // the reference's `max(1, ...)` and the only thing stopping infinite casting.
    r = fresh_rpg(1);
    CHECK(adjusted_psi_cost(0, r) == 0);      // a free effect stays free
    CHECK(adjusted_psi_cost(10, r) == 10);    // no INT: unchanged
    r.attr[static_cast<std::size_t>(Attr::Int)] = 10;
    CHECK(adjusted_psi_cost(10, r) == 7);     // round(10 * 0.7407)
    r.attr[static_cast<std::size_t>(Attr::Int)] = kRpgAttributeCap;
    CHECK(adjusted_psi_cost(1, r) >= 1);      // the floor holds at max INT
    CHECK(adjusted_psi_cost(100, r) >= 1);
}

static void test_rpg_xp_sources() {
    // Per-kind base XP times the monster's own level: base * (1 + 0.22*(L-1)).
    // Sborka is the reference's authored 10, Creator its authored 10,000.
    CHECK(xp_for_monster_kill(MobKind::Sborka, 1) == 10);
    CHECK(xp_for_monster_kill(MobKind::Tvar, 1) == 50);
    CHECK(xp_for_monster_kill(MobKind::Betonnik, 1) == 240);
    CHECK(xp_for_monster_kill(MobKind::Mancobus, 1) == 400);
    CHECK(xp_for_monster_kill(MobKind::Creator, 1) == 10000);

    // Level scaling: 50 * (1 + 0.22*4) = 50 * 1.88 = 94.
    CHECK(xp_for_monster_kill(MobKind::Tvar, 5) == 94);
    // 10 * 1.22 = 12.2 -> 12.
    CHECK(xp_for_monster_kill(MobKind::Sborka, 2) == 12);
    // Level 0 is treated as level 1 rather than shrinking the award.
    CHECK(xp_for_monster_kill(MobKind::Tvar, 0) == 50);

    // An unauthored kind falls through to the reference's default of 10. Panelnik
    // is one of the 33 the reference never lists.
    CHECK(xp_for_monster_kill(MobKind::Panelnik, 1) == 10);
    CHECK(xp_for_monster_kill(MobKind::Paupsina, 1) == 10);

    // Every kind must yield SOMETHING — a zero would make a monster worthless to
    // kill, and the default exists precisely to prevent that.
    for (std::size_t k = 0; k < kMobKindCount; ++k)
        CHECK(xp_for_monster_kill(static_cast<MobKind>(k), 1) >= 10);

    // NPC kills use the flat base of 10 on the same curve.
    CHECK(xp_for_npc_kill(1) == 10);
    CHECK(xp_for_npc_kill(5) == 19);      // 10 * 1.88 = 18.8 -> 19

    // Quest XP: round(20 * difficulty), difficulty arriving x10.
    CHECK(xp_for_quest(10) == 20);        // difficulty 1.0
    CHECK(xp_for_quest(25) == 50);        // difficulty 2.5
    CHECK(xp_for_quest(0) == 0);
}

static void test_rpg_award_and_spend() {
    // One level-up at exactly the threshold, with the remainder carried.
    RpgStats r = fresh_rpg(1);
    std::int16_t hp = 100, maxHp = 100;
    XpAward a = award_xp(r, 100, &hp, &maxHp);
    CHECK(a.granted == 100);
    CHECK(a.levelsGained == 1);
    CHECK(a.newLevel == 2);
    CHECK(!a.atCap);
    CHECK(r.level == 2);
    CHECK(r.xp == 0);
    CHECK(r.attrPoints == 1);             // exactly one point per level

    // One XP short of the next level does nothing but bank it.
    r = fresh_rpg(1);
    a = award_xp(r, 99);
    CHECK(a.levelsGained == 0);
    CHECK(r.level == 1);
    CHECK(r.xp == 99);
    // ... and the hundredth completes it.
    a = award_xp(r, 1);
    CHECK(a.levelsGained == 1);
    CHECK(r.level == 2);

    // MULTIPLE levels from one award, which is the loop the reference uses and the
    // easiest thing to write as a single `if`. 100 + 145 + 210 = 455 = level 4.
    r = fresh_rpg(1);
    a = award_xp(r, 455);
    CHECK(a.levelsGained == 3);
    CHECK(r.level == 4);
    CHECK(r.xp == 0);
    CHECK(r.attrPoints == 3);
    // One XP over, and the surplus is banked toward level 5.
    r = fresh_rpg(1);
    a = award_xp(r, 456);
    CHECK(r.level == 4);
    CHECK(r.xp == 1);

    // A level-up raises max HP and credits the DIFFERENCE to current HP — it is not
    // a full heal. Level 1->2 with 0 STR adds exactly 1 max HP.
    r = fresh_rpg(1);
    hp = 40;
    maxHp = 100;
    award_xp(r, 100, &hp, &maxHp);
    CHECK(maxHp == 101);
    CHECK(hp == 41);                      // +1, NOT refilled to 101

    // PSI, by contrast, IS refilled on level-up — the reference's one exception.
    r = fresh_rpg(1);
    r.psi = 3;
    award_xp(r, 100);
    CHECK(r.psi == max_psi(r));
    CHECK(r.psi == 101);

    // The INT multiplier applies to the awarded amount, once. 10 INT gives
    // x1.0708 (asymptotic), so 1000 XP becomes 1071.
    r = fresh_rpg(1);
    r.attr[static_cast<std::size_t>(Attr::Int)] = 10;
    const std::uint16_t xpMult = int_xp_mult_e3(r);
    a = award_xp(r, 1000);
    CHECK(a.granted == (1000u * xpMult + 500u) / 1000u);
    CHECK(a.granted > 1000);              // INT is a bonus, not a tax

    // A zero award changes nothing at all.
    r = fresh_rpg(3);
    const std::uint32_t xpBefore = r.xp;
    a = award_xp(r, 0);
    CHECK(a.granted == 0);
    CHECK(a.levelsGained == 0);
    CHECK(r.xp == xpBefore);
    CHECK(r.level == 3);

    // AT THE CAP: xp is zeroed, no further levels, and the flag says so. A capped
    // character accumulating xp forever is how the reference's u32 would eventually
    // wrap.
    r = fresh_rpg(kRpgLevelCap);
    a = award_xp(r, 1000000);
    CHECK(a.atCap);
    CHECK(a.levelsGained == 0);
    CHECK(a.newLevel == kRpgLevelCap);
    CHECK(r.xp == 0);
    CHECK(r.level == kRpgLevelCap);

    // A huge award cannot push past the cap, and must terminate rather than spin.
    r = fresh_rpg(1);
    a = award_xp(r, 0xFFFFFFFFu);
    CHECK(r.level == kRpgLevelCap);
    CHECK(r.xp == 0);
    CHECK(a.atCap);

    // ---- spending points ----
    // No points: refused, nothing mutated.
    r = fresh_rpg(1);
    CHECK(!spend_attr_point(r, Attr::Str));
    CHECK(r.attr[static_cast<std::size_t>(Attr::Str)] == 0);

    // STR spend re-derives max HP and credits the gain.
    r = fresh_rpg(1);
    r.attrPoints = 3;
    hp = 50;
    maxHp = 100;
    CHECK(spend_attr_point(r, Attr::Str, &hp, &maxHp));
    CHECK(r.attrPoints == 2);
    CHECK(r.attr[static_cast<std::size_t>(Attr::Str)] == 1);
    CHECK(maxHp == static_cast<std::int16_t>(max_hp(r)));
    CHECK(hp >= 50);                      // credited, never reduced

    // INT spend raises max PSI and credits the gain to current PSI.
    r = fresh_rpg(50);                    // level 50 -> base psi 149
    r.attrPoints = 1;
    r.psi = 10;
    const std::uint16_t psiMaxBefore = max_psi(r);
    CHECK(spend_attr_point(r, Attr::Int));
    CHECK(max_psi(r) > psiMaxBefore);
    CHECK(r.psi == 10 + (max_psi(r) - psiMaxBefore));

    // AGI spend touches neither HP nor PSI.
    r = fresh_rpg(10);
    r.attrPoints = 1;
    r.psi = 7;
    hp = 60;
    maxHp = static_cast<std::int16_t>(max_hp(r));
    const std::int16_t maxHpBefore = maxHp;
    CHECK(spend_attr_point(r, Attr::Agi, &hp, &maxHp));
    CHECK(maxHp == maxHpBefore);
    CHECK(hp == 60);
    CHECK(r.psi == 7);

    // Spending is refused at the attribute cap, and the point is NOT consumed.
    r = fresh_rpg(1);
    r.attrPoints = 5;
    r.attr[static_cast<std::size_t>(Attr::Str)] = kRpgAttributeCap;
    CHECK(!spend_attr_point(r, Attr::Str));
    CHECK(r.attrPoints == 5);

    // Attr::Count is not a spendable attribute.
    r = fresh_rpg(1);
    r.attrPoints = 1;
    CHECK(!spend_attr_point(r, Attr::Count));
    CHECK(r.attrPoints == 1);

    // Every granted point is spendable, and exactly once: level to 4 for 3 points,
    // spend all 3, then be refused.
    r = fresh_rpg(1);
    award_xp(r, 455);
    CHECK(r.attrPoints == 3);
    CHECK(spend_attr_point(r, Attr::Str));
    CHECK(spend_attr_point(r, Attr::Agi));
    CHECK(spend_attr_point(r, Attr::Int));
    CHECK(r.attrPoints == 0);
    CHECK(!spend_attr_point(r, Attr::Str));
}

static void test_rpg_random_build() {
    // random_rpg spends exactly (level-1) points and nothing else.
    for (int lv = 1; lv <= 40; ++lv) {
        const RpgStats r = random_rpg(static_cast<std::uint8_t>(lv), 0xC0FFEEu);
        const int spent = static_cast<int>(r.attr[0]) + r.attr[1] + r.attr[2];
        CHECK(r.level == lv);
        CHECK(spent == lv - 1);
        CHECK(r.attrPoints == 0);         // rolled builds have nothing unspent
        CHECK(r.xp == 0);
        CHECK(r.psi == max_psi(r));
    }

    // Deterministic from (level, seed) — the stateless-hash substitution for the
    // reference's stateful rng(), so an NPC re-embodied later rolls the same build.
    const RpgStats a1 = random_rpg(20, 12345u);
    const RpgStats a2 = random_rpg(20, 12345u);
    CHECK(a1.attr[0] == a2.attr[0]);
    CHECK(a1.attr[1] == a2.attr[1]);
    CHECK(a1.attr[2] == a2.attr[2]);

    // Different seeds give different builds (not a constant function). Over 64
    // seeds at level 30 at least two distinct str values must appear.
    int distinct = 0;
    std::uint8_t firstStr = random_rpg(30, 0u).attr[0];
    for (std::uint32_t s = 1; s < 64; ++s)
        if (random_rpg(30, s).attr[0] != firstStr) { ++distinct; }
    CHECK(distinct > 0);

    // The 34/33/33 split should put every attribute in play over a long roll rather
    // than starving one — a bucketing bug (e.g. `<` vs `<=`) usually zeroes one.
    const RpgStats big = random_rpg(200, 0xABCDEFu);
    CHECK(big.attr[0] > 0);
    CHECK(big.attr[1] > 0);
    CHECK(big.attr[2] > 0);

    // At the level cap the 254 points cannot overflow a single u8 attribute.
    const RpgStats capped = random_rpg(kRpgLevelCap, 7u);
    CHECK(capped.level == kRpgLevelCap);
    CHECK(static_cast<int>(capped.attr[0]) + capped.attr[1] + capped.attr[2] == 254);
}

// ---- Integration: XP actually lands on a real kill -------------------------
//
// Everything above tests the formulas in isolation. This tests the WIRING, which
// is the part that can be complete and still dead: `rpg.h` existed, compiled and
// passed its whole suite while nothing in src/ read it. The check is therefore not
// "does award_xp work" but "does killing a monster reach award_xp at all".
static void test_rpg_kill_awards_xp() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();

    const LayerId layer = 0;

    // The killer, carrying a character sheet. No pool row: this isolates the XP
    // path from the HP-in-the-pool path, which the branch below covers.
    const Entity killer = reg.create();
    reg.emplace<Transform>(killer, Transform{vec3{10.0f, 10.0f, 4.0f}, layer});
    reg.emplace<RpgStats>(killer, fresh_rpg(1));

    // A Tvar, level 1: authored base 50 XP, and 50 < 100 so ONE kill must bank XP
    // without levelling — the level-up branch is exercised separately below.
    const Entity mob = reg.create();
    reg.emplace<Transform>(mob, Transform{vec3{11.0f, 10.0f, 4.0f}, layer});
    reg.emplace<MobRef>(mob, MobRef{static_cast<std::uint8_t>(MobKind::Tvar), 1,
                                    10, 10});
    reg.emplace<Dead>(mob, Dead{killer, 0});

    CHECK(reg.get<RpgStats>(killer).xp == 0);
    const std::uint32_t finalized = finalize_deaths(reg, pool, bus, 1);
    CHECK(finalized == 1);

    // THE assertion: the kill reached award_xp.
    const RpgStats& after = reg.get<RpgStats>(killer);
    CHECK(after.xp == xp_for_monster_kill(MobKind::Tvar, 1));
    CHECK(after.xp == 50);
    CHECK(after.level == 1);              // 50 < the 100 needed for level 2
    CHECK(after.attrPoints == 0);

    // A second Tvar takes the total to 100, which IS the level-2 threshold — so the
    // level-up path fires through the wiring too, not just through award_xp directly.
    const Entity mob2 = reg.create();
    reg.emplace<Transform>(mob2, Transform{vec3{11.0f, 10.0f, 4.0f}, layer});
    reg.emplace<MobRef>(mob2, MobRef{static_cast<std::uint8_t>(MobKind::Tvar), 1,
                                     10, 10});
    reg.emplace<Dead>(mob2, Dead{killer, 0});
    finalize_deaths(reg, pool, bus, 2);

    const RpgStats& after2 = reg.get<RpgStats>(killer);
    CHECK(after2.level == 2);
    CHECK(after2.attrPoints == 1);        // the level granted a spendable point
    CHECK(after2.xp == 0);                // 100 consumed exactly

    // A killer with NO RpgStats must not crash and must not be credited — this is
    // what keeps monster-on-monster kills free. The component is the licence.
    const Entity plainKiller = reg.create();
    reg.emplace<Transform>(plainKiller, Transform{vec3{20.0f, 20.0f, 4.0f}, layer});
    const Entity mob3 = reg.create();
    reg.emplace<Transform>(mob3, Transform{vec3{21.0f, 20.0f, 4.0f}, layer});
    reg.emplace<MobRef>(mob3, MobRef{static_cast<std::uint8_t>(MobKind::Tvar), 1,
                                     10, 10});
    reg.emplace<Dead>(mob3, Dead{plainKiller, 0});
    CHECK(finalize_deaths(reg, pool, bus, 3) == 1);
    CHECK(!reg.any_of<RpgStats>(plainKiller));

    // An unknown/invalid killer (entt::null — the shooter died mid-flight, which
    // [combat.h] documents as possible) must also be a safe no-op.
    const Entity mob4 = reg.create();
    reg.emplace<Transform>(mob4, Transform{vec3{30.0f, 30.0f, 4.0f}, layer});
    reg.emplace<MobRef>(mob4, MobRef{static_cast<std::uint8_t>(MobKind::Sborka), 1,
                                     10, 10});
    reg.emplace<Dead>(mob4, Dead{entt::null, 0});
    CHECK(finalize_deaths(reg, pool, bus, 4) == 1);

    // Level SCALES the award through the wiring: a level-5 Tvar is worth 94, not 50.
    const Entity killer2 = reg.create();
    reg.emplace<Transform>(killer2, Transform{vec3{40.0f, 40.0f, 4.0f}, layer});
    reg.emplace<RpgStats>(killer2, fresh_rpg(1));
    const Entity mob5 = reg.create();
    reg.emplace<Transform>(mob5, Transform{vec3{41.0f, 40.0f, 4.0f}, layer});
    reg.emplace<MobRef>(mob5, MobRef{static_cast<std::uint8_t>(MobKind::Tvar), 5,
                                     10, 10});
    reg.emplace<Dead>(mob5, Dead{killer2, 0});
    finalize_deaths(reg, pool, bus, 5);
    CHECK(reg.get<RpgStats>(killer2).xp == 94);
    CHECK(reg.get<RpgStats>(killer2).xp == xp_for_monster_kill(MobKind::Tvar, 5));
}


// ---------------------------------------------------------------------------
// RPGCMBT — formulas must reach the swing / shot sites in combat.cpp
// ---------------------------------------------------------------------------
// suite_rpg already pins melee_damage / agi_*_mult_e3 arithmetic in isolation.
// Before RPGCMBT those helpers had ZERO callers in combat.cpp: a level-20 STR
// brute swung for the same fist damage as a fresh spawn. This drives the real
// player_melee_step / player_ranged_step entry points and asserts the scaled
// numbers land on MobRef::hp and PlayerMelee/PlayerRanged::cooldownMs.
//
// Identity contract (no RpgStats component): raw table values — the same path
// test_player_shoots exercises, so that pin stays green without edits.
static void test_rpg_combat_wire() {
    const float dt = kSimDt;
    EventBus bus;

    // ---- 1. Melee bare fists, NO RpgStats → table dmg + table CD ------------
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const LayerId layer = 0;

        const NpcId sid = pool.spawn();
        pool.hp(sid) = 100;
        pool.max_hp(sid) = 100;

        const Entity self = reg.create();
        Transform st;
        st.pos = vec3{40.0f, 40.0f, 40.0f};
        st.layer = layer;
        reg.emplace<Transform>(self, st);
        reg.emplace<NpcRef>(self, NpcRef{sid});
        CameraTag cam{};
        cam.yaw = 0.0f;    // face +X
        cam.pitch = 0.0f;
        reg.emplace<CameraTag>(self, cam);

        // 1 m down the look axis — inside bare reach (0.5 cell * 2 m + slack).
        const Entity mob = reg.create();
        Transform mt;
        mt.pos = vec3{41.0f, 40.0f, 40.0f};
        mt.layer = layer;
        reg.emplace<Transform>(mob, mt);
        reg.emplace<MobRef>(mob, MobRef{0, 1, 500, 500});

        const MeleeDef& fist = unarmed_melee();
        CHECK(fist.dmg >= 1);
        CHECK(fist.cooldownMs >= 1);

        const std::int16_t hp0 = reg.get<MobRef>(mob).hp;
        CHECK(player_melee_step(reg, pool, bus, layer, dt, /*wantsAttack=*/true,
                                /*tick=*/1u) == true);
        CHECK(reg.get<MobRef>(mob).hp ==
              hp0 - static_cast<std::int16_t>(fist.dmg));
        CHECK(reg.get<PlayerMelee>(self).cooldownMs == fist.cooldownMs);
    }

    // ---- 2. Melee bare fists, high STR/AGI/level → scaled dmg + scaled CD --
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const LayerId layer = 0;

        const NpcId sid = pool.spawn();
        pool.hp(sid) = 100;
        pool.max_hp(sid) = 100;

        const Entity self = reg.create();
        Transform st;
        st.pos = vec3{40.0f, 40.0f, 40.0f};
        st.layer = layer;
        reg.emplace<Transform>(self, st);
        reg.emplace<NpcRef>(self, NpcRef{sid});
        CameraTag cam{};
        cam.yaw = 0.0f;
        cam.pitch = 0.0f;
        reg.emplace<CameraTag>(self, cam);

        RpgStats rs = fresh_rpg(10);
        rs.attr[static_cast<std::size_t>(Attr::Str)] = 20;
        rs.attr[static_cast<std::size_t>(Attr::Agi)] = 20;
        reg.emplace<RpgStats>(self, rs);

        const Entity mob = reg.create();
        Transform mt;
        mt.pos = vec3{41.0f, 40.0f, 40.0f};
        mt.layer = layer;
        reg.emplace<Transform>(mob, mt);
        reg.emplace<MobRef>(mob, MobRef{0, 1, 500, 500});

        const MeleeDef& fist = unarmed_melee();
        // weaponId 0 = bare hands sentinel — same as combat.cpp heldWeapon default.
        const std::int16_t expectDmg =
            melee_damage(rs, /*weaponId=*/0, static_cast<std::int16_t>(fist.dmg));
        // Fists CD is 340 < kHeavyWeaponCooldownMs (650) → STR heavy mult = 1000.
        // Only AGI shortens the swing.
        const std::uint32_t agiE3 = agi_attack_speed_mult_e3(rs);
        const std::uint32_t strE3 =
            str_heavy_weapon_speed_mult_e3(rs, fist.cooldownMs);
        CHECK(strE3 == 1000u);   // light weapon gate
        const std::uint32_t expectCd =
            (static_cast<std::uint32_t>(fist.cooldownMs) * agiE3 * strE3) /
            1000000u;
        CHECK(expectDmg > static_cast<std::int16_t>(fist.dmg));
        CHECK(expectCd < fist.cooldownMs);
        CHECK(expectCd >= 1u);

        const std::int16_t hp0 = reg.get<MobRef>(mob).hp;
        CHECK(player_melee_step(reg, pool, bus, layer, dt, /*wantsAttack=*/true,
                                /*tick=*/1u) == true);
        CHECK(reg.get<MobRef>(mob).hp == hp0 - expectDmg);
        CHECK(reg.get<PlayerMelee>(self).cooldownMs ==
              static_cast<std::uint16_t>(expectCd));
    }

    // ---- 3. Ranged, NO RpgStats → table cooldown (identity) ----------------
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const LayerId layer = 0;

        const NpcId sid = pool.spawn();
        pool.hp(sid) = 100;
        pool.max_hp(sid) = 100;

        ItemId gun = kInvalidItem;
        const RangedDef* def = nullptr;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (const RangedDef* d = ranged_for_item(i)) {
                if (d->pellets == 1 && d->magazine >= 8 && d->dmg >= 20) {
                    gun = i;
                    def = d;
                    break;
                }
            }
        }
        CHECK(def != nullptr);
        CHECK(gun != kInvalidItem);

        Inventory& inv = pool.inventory(sid);
        inv.slots[0] = ItemSlot{gun, 1};
        inv.slots[1] = ItemSlot{def->ammo, 30};

        const Entity shooter = reg.create();
        Transform st;
        st.pos = vec3{40.0f, 40.0f, 40.0f};
        st.layer = layer;
        reg.emplace<Transform>(shooter, st);
        reg.emplace<NpcRef>(shooter, NpcRef{sid});
        CameraTag cam{};
        cam.yaw = 0.0f;
        cam.pitch = 0.0f;
        reg.emplace<CameraTag>(shooter, cam);
        // Pre-armed: skip the gun-swap + reload branches so tick 0 fires.
        reg.emplace<PlayerRanged>(
            shooter, PlayerRanged{0, 0, def->magazine, gun, 0, 0});

        CHECK(player_ranged_step(reg, pool, layer, /*wantFire=*/true, dt,
                                 /*tick=*/1u) == 1u);
        CHECK(reg.get<PlayerRanged>(shooter).cooldownMs == def->cooldownMs);
    }

    // ---- 4. Ranged, high AGI → shortened cooldown --------------------------
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const LayerId layer = 0;

        const NpcId sid = pool.spawn();
        pool.hp(sid) = 100;
        pool.max_hp(sid) = 100;

        ItemId gun = kInvalidItem;
        const RangedDef* def = nullptr;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (const RangedDef* d = ranged_for_item(i)) {
                if (d->pellets == 1 && d->magazine >= 8 && d->dmg >= 20) {
                    gun = i;
                    def = d;
                    break;
                }
            }
        }
        CHECK(def != nullptr);

        Inventory& inv = pool.inventory(sid);
        inv.slots[0] = ItemSlot{gun, 1};
        inv.slots[1] = ItemSlot{def->ammo, 30};

        const Entity shooter = reg.create();
        Transform st;
        st.pos = vec3{40.0f, 40.0f, 40.0f};
        st.layer = layer;
        reg.emplace<Transform>(shooter, st);
        reg.emplace<NpcRef>(shooter, NpcRef{sid});
        CameraTag cam{};
        cam.yaw = 0.0f;
        cam.pitch = 0.0f;
        reg.emplace<CameraTag>(shooter, cam);

        RpgStats rs = fresh_rpg(10);
        rs.attr[static_cast<std::size_t>(Attr::Agi)] = 20;
        reg.emplace<RpgStats>(shooter, rs);

        reg.emplace<PlayerRanged>(
            shooter, PlayerRanged{0, 0, def->magazine, gun, 0, 0});

        const std::uint32_t agiE3 = agi_attack_speed_mult_e3(rs);
        const std::uint32_t expectCd =
            (static_cast<std::uint32_t>(def->cooldownMs) * agiE3) / 1000u;
        CHECK(agiE3 < 1000u);
        CHECK(expectCd < def->cooldownMs);
        CHECK(expectCd >= 1u);

        CHECK(player_ranged_step(reg, pool, layer, /*wantFire=*/true, dt,
                                 /*tick=*/1u) == 1u);
        CHECK(reg.get<PlayerRanged>(shooter).cooldownMs ==
              static_cast<std::uint16_t>(expectCd));
    }
}

// POSRPG: voluntary camera-hop must carry person-progression the way death
// and the elevator already do. transfer_player_progression is the shared stamp
// (main.cpp possess_nearest_survivor calls it after the CameraTag swap).
static void test_rpg_possess_transfer() {
    Registry reg;
    NpcPool pool;
    pool.init();
    const LayerId layer = 0;

    const NpcId idA = pool.spawn();
    const NpcId idB = pool.spawn();
    CHECK(idA != kInvalidNpc);
    CHECK(idB != kInvalidNpc);
    pool.cx(idA) = 10; pool.cy(idA) = 10; pool.cz(idA) = 1;
    pool.height_mm(idA) = 1750;
    pool.cx(idB) = 12; pool.cy(idB) = 10; pool.cz(idB) = 1;
    pool.height_mm(idB) = 1700;

    // Player body (has RpgStats via embody_as_player) + ordinary resident
    // (no RpgStats — ordinary embody never attaches one).
    Entity from = embody_as_player(reg, pool, idA, layer);
    Entity to = embody(reg, pool, idB, layer);
    CHECK(from != entt::null);
    CHECK(to != entt::null);
    CHECK(reg.all_of<RpgStats>(from));
    CHECK(!reg.all_of<RpgStats>(to));
    CHECK(!reg.all_of<PlayerMelee>(from));
    CHECK(!reg.all_of<PlayerRanged>(from));

    {
        RpgStats& rs = reg.get<RpgStats>(from);
        rs.xp = 777u;
        rs.psi = 42;
        rs.level = 5;
        rs.attrPoints = 3;
        rs.attr[static_cast<std::size_t>(Attr::Str)] = 11;
        rs.attr[static_cast<std::size_t>(Attr::Agi)] = 9;
        rs.attr[static_cast<std::size_t>(Attr::Int)] = 7;
    }
    reg.emplace<PlayerMelee>(from, PlayerMelee{/*cooldownMs=*/0, /*kills=*/99});
    {
        PlayerRanged pr{};
        pr.magCount = 12;
        pr.weapon = static_cast<ItemId>(7);
        pr.shots = 7;
        pr.hits = 3;
        reg.emplace<PlayerRanged>(from, pr);
    }

    transfer_player_progression(reg, from, to);

    // Sheet landed on the destination (NPC body never had one before).
    CHECK(reg.all_of<RpgStats>(to));
    CHECK(reg.get<RpgStats>(to).xp == 777u);
    CHECK(reg.get<RpgStats>(to).psi == 42);
    CHECK(reg.get<RpgStats>(to).level == 5);
    CHECK(reg.get<RpgStats>(to).attrPoints == 3);
    CHECK(reg.get<RpgStats>(to).attr[static_cast<std::size_t>(Attr::Str)] == 11);
    CHECK(reg.get<RpgStats>(to).attr[static_cast<std::size_t>(Attr::Agi)] == 9);
    CHECK(reg.get<RpgStats>(to).attr[static_cast<std::size_t>(Attr::Int)] == 7);

    // Kills MOVED.
    CHECK(reg.all_of<PlayerMelee>(to));
    CHECK(reg.get<PlayerMelee>(to).kills == 99);
    CHECK(reg.get<PlayerMelee>(from).kills == 0);

    // Cumulative shots/hits MOVED; chambered mag STAYS on the abandoned body.
    CHECK(reg.all_of<PlayerRanged>(to));
    CHECK(reg.get<PlayerRanged>(to).shots == 7);
    CHECK(reg.get<PlayerRanged>(to).hits == 3);
    CHECK(reg.get<PlayerRanged>(to).magCount == 0);
    CHECK(reg.get<PlayerRanged>(to).weapon == static_cast<ItemId>(0));
    CHECK(reg.get<PlayerRanged>(from).magCount == 12);
    CHECK(reg.get<PlayerRanged>(from).weapon == static_cast<ItemId>(7));
    CHECK(reg.get<PlayerRanged>(from).shots == 0);
    CHECK(reg.get<PlayerRanged>(from).hits == 0);

    // Idempotent no-op on same entity; invalid handles do not crash.
    transfer_player_progression(reg, to, to);
    CHECK(reg.get<PlayerMelee>(to).kills == 99);
    transfer_player_progression(reg, entt::null, to);
    transfer_player_progression(reg, to, entt::null);
}

// jirnyak §19: death dumps the NPC 8×8 bag into Corpse (8 slots) then same-cell
// Containers (kCellSize grid on the torus). Staged table loot (CorpseLootPending)
// still fills first; inventory overflow lands in the cell container.
//
// finalize_deaths does not require a tag beyond Dead + optional NpcRef/MobRef —
// MobTag is not a component in this codebase. Container::kind is a raw u8
// holding a ContainerKind value (no Crate enumerator; RoomStash is fine).
// Body Y is lowered by 0.45f when the Corpse is built, so the overflow box must
// share the post-flatten cell, not merely the pre-death one.
static void test_death_spills_inventory_to_corpse_and_cell() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();

    const NpcId id = pool.spawn();
    CHECK(id != kInvalidNpc);
    Inventory& inv = pool.inventory(id);
    // Fill more than kMaxCorpseSlots (8) so overflow must hit the container.
    const ItemId a = static_cast<ItemId>(1);
    const ItemId b = static_cast<ItemId>(2);
    for (int i = 0; i < 10; ++i) {
        inv.slots[static_cast<std::size_t>(i)].item = (i < 8) ? a : b;
        inv.slots[static_cast<std::size_t>(i)].count = 1;
    }

    // Place the body so that after finalize's y -= 0.45f both body and box sit
    // in macro cell (1,1,0): floor((2.5-0.45)/2) == floor(2.8/2) == 1.
    Entity mob = reg.create();
    Transform tr;
    tr.pos = {2.5f, 2.5f, 1.0f};
    tr.layer = 0;
    reg.emplace<Transform>(mob, tr);
    reg.emplace<AABB>(mob, AABB{vec3{0.3f, 0.3f, 0.9f}});
    reg.emplace<Renderable>(mob, Renderable{});
    reg.emplace<NpcRef>(mob, NpcRef{id});
    reg.emplace<Dead>(mob, Dead{/*killer*/entt::null, /*channel*/0});

    Entity box = reg.create();
    Transform bt;
    bt.pos = {2.8f, 2.8f, 1.0f};
    bt.layer = 0;
    reg.emplace<Transform>(box, bt);
    Container c{};
    c.kind = static_cast<std::uint8_t>(ContainerKind::RoomStash);
    reg.emplace<Container>(box, c);

    // No CorpseLootPending — pure inventory path.
    const std::uint32_t n = finalize_deaths(reg, pool, bus, /*tick*/2);
    CHECK(n == 1);
    CHECK(reg.all_of<Corpse>(mob));
    // C: труп несёт канонический 64-слотовый контейнер — ВСЯ сумка легла на
    // труп (inventory_give стекует), перелив в ящик клетки не понадобился
    // (путь остался страховкой на действительно полный труп).
    const Inventory& ci = reg.get<Container>(mob).inv;
    int foundA = 0, foundBCorpse = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        if (ci.slots[i].item == a) foundA += static_cast<int>(ci.slots[i].count);
        if (ci.slots[i].item == b)
            foundBCorpse += static_cast<int>(ci.slots[i].count);
    }
    CHECK(foundA == 8);
    CHECK(foundBCorpse == 2);
    const Container& boxC = reg.get<Container>(box);
    int foundB = 0;
    for (std::uint8_t si = 0; si < kInvSlots; ++si)
        if (boxC.inv.slots[si].item == b) foundB += static_cast<int>(boxC.inv.slots[si].count);
    CHECK(foundB == 0);
    // Live bag emptied so a recycled row cannot resurrect loot.
    for (const ItemSlot& s : pool.inventory(id).slots) {
        CHECK(s.item == kInvalidItem);
        CHECK(s.count == 0);
    }
}


static void test_rpg_all() {
    test_rpg_curve();
    test_rpg_derived();
    test_rpg_melee_and_psi();
    test_rpg_xp_sources();
    test_rpg_award_and_spend();
    test_rpg_random_build();
    test_rpg_kill_awards_xp();
    test_rpg_combat_wire();
    test_rpg_possess_transfer();
    test_death_spills_inventory_to_corpse_and_cell();
}

