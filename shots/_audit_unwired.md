# Audit - unwired game-lane features

Date: 2026-07-31
Lane: game audit only (no src/render, no dental-crm)
Scope: features that EXIST in code but are NOT on the live main/combat gameplay path.

## Top 3 (ranked)

### 1. ATTR1 - spend_attr_point dead to gameplay

Impact: High. Blast: Tiny. Invent: None.
Impl: src/game/rpg.h:214, src/game/rpg.cpp:355, src/app/main.cpp:3834-3836 HUD tease, tests/suite_rpg.inl:323+
Callers from main/combat: none.
Not a gap: combat.cpp:205-218 award_xp levels + attrPoints.
Next patch: main 1/2/3 keys -> spend_attr_point(*rs, Attr, &hp, &maxHp); HUD help.

### 2. SAVRPG - F5/F9 save/load drops RpgStats (+ craft known-bits)

Impact: High. Blast: Medium. Invent: None.
Impl live: main.cpp:1676/3299/3686 carriedRpg; elevator.cpp:58-89 hadRpg; craft_write/read craft.h:400+/craft.cpp:360+; craft live main.cpp:1715/3552+
Save gap: save.h PlayerSnapshot:330 and SaveState:352 have no RpgStats/craft; save_run_now main.cpp:1814-1843 skips them; save.cpp:364+ never visits craft_write.
Next patch: bump kSaveVersion; embed RpgStats + craft blob; capture/restore in save_run_now + F9 load.

### 3. AGIMV - agi_move_speed_mult_e3 unused on move

Impact: Medium-high. Blast: Tiny. Invent: None.
Impl: rpg.h:145 / rpg.cpp:220; suite_rpg.inl:77,98.
Live move main.cpp:2396-2399: kPlayerWalkSpeed * needs.speedScale * status only - no AGI mult.
Next patch: multiply by agi_move_speed_mult_e3(*rs)/1000.f when RpgStats present.

## Candidate sweep

- XP on kill: WIRED combat.cpp:205-218
- level-up: WIRED inside award_xp
- PlayerRanged mag body-swap: WIRED elevator.cpp:46-84; HUD :3865
- inventory equip melee: WIRED auto best-in-bag
- craft/scrap gameplay: WIRED; only persist dead
- psi spend: DEFER needs.cpp:344 Psi not modelled
- str_durability_wear_mult_e3: DEFER no wear tick
- int_contract/xp_for_quest: lower pri flat pay

## Execute order
1. ATTR1  2. AGIMV  3. SAVRPG
