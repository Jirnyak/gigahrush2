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

static void test_rpg_all() {
    test_rpg_curve();
    test_rpg_derived();
    test_rpg_melee_and_psi();
    test_rpg_xp_sources();
    test_rpg_award_and_spend();
    test_rpg_random_build();
}
