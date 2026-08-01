"""Append test_rpg_combat_wire to suite_rpg.inl and wire into test_rpg_all."""
from pathlib import Path

path = Path("tests/suite_rpg.inl")
text = path.read_text(encoding="utf-8")

if "test_rpg_combat_wire" in text:
    print("ALREADY patched")
    raise SystemExit(0)

marker = "static void test_rpg_all() {"
if marker not in text:
    raise SystemExit("marker test_rpg_all not found")

pin = r'''
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

'''

# Insert pin before test_rpg_all and add call
new_text = text.replace(
    marker,
    pin + marker,
    1,
)

old_all = """static void test_rpg_all() {
    test_rpg_curve();
    test_rpg_derived();
    test_rpg_melee_and_psi();
    test_rpg_xp_sources();
    test_rpg_award_and_spend();
    test_rpg_random_build();
    test_rpg_kill_awards_xp();
}"""

new_all = """static void test_rpg_all() {
    test_rpg_curve();
    test_rpg_derived();
    test_rpg_melee_and_psi();
    test_rpg_xp_sources();
    test_rpg_award_and_spend();
    test_rpg_random_build();
    test_rpg_kill_awards_xp();
    test_rpg_combat_wire();
}"""

if old_all not in new_text:
    raise SystemExit("test_rpg_all body not found for call insert")
new_text = new_text.replace(old_all, new_all, 1)

path.write_text(new_text, encoding="utf-8", newline="\n")
print("PATCHED suite_rpg.inl")
print("lines", new_text.count("\n") + 1)
print("has combat_wire", "test_rpg_combat_wire" in new_text)
