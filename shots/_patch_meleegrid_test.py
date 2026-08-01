# MELEEGRID: append player_melee WallBrace soak pin to suite_behaviours.inl
from pathlib import Path

p = Path(r"C:\hades\gigahrush2\tests\suite_behaviours.inl")
t = p.read_text(encoding="utf-8")

marker = "        CHECK(expectedCover > expectedOpen);\n    }\n}\n"
if marker not in t:
    raise SystemExit("end marker not found")

block = r'''        CHECK(expectedCover > expectedOpen);
    }

    // ---- 18. MELEEGRID: player_melee_step forwards grid → WallBrace soak ----
    // Section 14 pins apply_damage(..., &grid) directly. That does not prove the
    // live player swing path: player_melee_step had `grid` for wall-chip carves
    // but forgot to pass it into apply_damage, so Панельник braced against a wall
    // soaked bullets (projectile_step) and mob swings (mob_attack_step) but took
    // full fist damage. This block is the path that was broken.
    {
        EventBus bus18;
        const MeleeDef& fist = unarmed_melee();
        CHECK(fist.dmg >= 1);

        // Braced: player at cell 54,50 looking +X; Panelnik at 55,50 (wall at 56,50).
        // Reach bare = 0.5 cell * kCellSize + slack ≈ 1.0+ m; 2 m gap is inside.
        {
            Registry regB;
            NpcPool poolB;
            poolB.init();
            const Entity self = spawn_viewer(regB, layer, vec3{108.0f, 100.0f, 3.0f});
            regB.get<CameraTag>(self).yaw = 0.0f;   // +X
            regB.get<CameraTag>(self).pitch = 0.0f;
            const Entity pan = spawn_at(regB, layer, MobKind::Panelnik,
                                        vec3{110.0f, 100.0f, 3.0f});
            // High HP so fist never kills; we only care about applied soak.
            regB.get<MobRef>(pan).hp = 500;
            regB.get<MobRef>(pan).maxHp = 500;
            const std::int16_t hp0 = regB.get<MobRef>(pan).hp;
            CHECK(player_melee_step(regB, poolB, bus18, layer, 0.016f,
                                    /*wantsAttack=*/true, /*tick=*/1u,
                                    &grid, /*carves=*/nullptr) == true);
            const std::int16_t applied =
                static_cast<std::int16_t>(hp0 - regB.get<MobRef>(pan).hp);
            // round(fist.dmg * kWallBraceIncoming); same arithmetic as §14.
            const int expect = static_cast<int>(
                static_cast<float>(fist.dmg) * kWallBraceIncoming + 0.5f);
            const int floorExpect = (expect < 1 && fist.dmg > 0) ? 1 : expect;
            CHECK(applied == static_cast<std::int16_t>(floorExpect));
            CHECK(applied < static_cast<std::int16_t>(fist.dmg));
            std::printf("[behaviours] MELEEGRID braced: raw=%u applied=%d "
                        "(expect %d @ x%.2f)\n",
                        static_cast<unsigned>(fist.dmg),
                        static_cast<int>(applied), floorExpect,
                        kWallBraceIncoming);
        }

        // Open: same geometry as §14 open cell — no adjacent wall → full damage.
        {
            Registry regO;
            NpcPool poolO;
            poolO.init();
            // Player south of open pan, looking +Y.
            const Entity self = spawn_viewer(regO, layer, vec3{100.0f, 108.0f, 3.0f});
            regO.get<CameraTag>(self).yaw = 1.5707963f;  // +Y
            regO.get<CameraTag>(self).pitch = 0.0f;
            const Entity pan = spawn_at(regO, layer, MobKind::Panelnik,
                                        vec3{100.0f, 110.0f, 3.0f});
            regO.get<MobRef>(pan).hp = 500;
            regO.get<MobRef>(pan).maxHp = 500;
            const std::int16_t hp0 = regO.get<MobRef>(pan).hp;
            CHECK(player_melee_step(regO, poolO, bus18, layer, 0.016f,
                                    /*wantsAttack=*/true, /*tick=*/1u,
                                    &grid, /*carves=*/nullptr) == true);
            const std::int16_t applied =
                static_cast<std::int16_t>(hp0 - regO.get<MobRef>(pan).hp);
            CHECK(applied == static_cast<std::int16_t>(fist.dmg));
            std::printf("[behaviours] MELEEGRID open: raw=%u applied=%d\n",
                        static_cast<unsigned>(fist.dmg),
                        static_cast<int>(applied));
        }
    }
}
'''

t2 = t.replace(marker, block, 1)
if t2 == t:
    raise SystemExit("replace failed")
p.write_text(t2, encoding="utf-8", newline="\n")
print("patched suite_behaviours.inl, +MELEEGRID section 18")
