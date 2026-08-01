# RPGCMBT live gameplay proof plan

## Status
- Unit pin: tests/suite_rpg.inl -> test_rpg_combat_wire (game_test.exe / shots/_run_rpgcmbt_test.py)
- Shot infra: REAL --shot in src/app/main.cpp + src/render/screenshot.h (swapchain capture)
- RpgStats first-spawn attach: NOT a blocker (already attached)

## Exact spawn / RpgStats sites
- ATTACH: src/game/embody.cpp:95 emplace_or_replace RpgStats(random_rpg(pool.level(id), id)) in embody_as_player
- INVOKE: src/game/floor_stream.cpp:204 first-load designate -> embody_as_player
- Death reapply: src/app/main.cpp:3686 carriedRpg after possess_a_survivor
- Elevator preserve: src/game/elevator.cpp:53-89 copy RpgStats across ride if present
- carried seed: src/app/main.cpp:1676 fresh_rpg(1) fallback only
- Call chain: main -> FloorStreamer::ensure_loaded -> floor_stream.cpp:204 -> embody.cpp:95

## Shot CLI (existing)
gigahrush2.exe --shot FILE [--frames N] [--ride N] [--floor N] [--orbit] [--action NAME] [--no-hud]
Parse: main.cpp:1156-1204. Capture: main.cpp:4806-4813.

### Existing --action values (real systems)
- attack, interact, corp, wall, carve, status, save, load

### Prior launch templates
- PADIC: --shot shot_padic_play.png --frames 480 --floor 4 --action attack (cwd=ROOT) runner=_run_padic_proof.py
- WALL: --shot shot_carve.png --frames 1200 --ride 0 --action wall runner=_run_carve_proof.py
- CORP: --action corp runner=_run_corp_proof.py
- TRAVEL: --frames 900 --ride 2 runner=_run_shot.py

Existing PNGs: shot_aimem, shot_carve, shot_corp, shot_f9_load, shot_f9_save, shot_padic, shot_padic_play, shot_place, shot_status, shot_tex1, shot_travel

## Combat scaling
src/game/combat.cpp player_melee_step ~1212-1232:
- With RpgStats: swingDmg=melee_damage; CD from AGI*STR heavy mults
- Without: raw table (identity)

## HUD strings (main.cpp:3823-3837)
- LVL u  XP u / u
- LVL u  (MAX)
- STR u  AGI u  INT u
- STR u  AGI u  INT u   [+pts]
- PSI u / u
- hits taken / kills
- weapon: s (u dmg)  NOTE: table dmg NOT scaled

## Stderr grep
Existing: shot: | [wall] melee toward solid | [corp] | [status] tick | [nav] bake | [pop] seeded
Missing: no [rpgcmbt] scaled dmg/cd line
Proposed: [rpgcmbt] melee dmg=d cd=u str=u agi=u lvl=u weapon=u hit=d

## Blockers
1. B0 spawn attach - CLEAR. embody.cpp:95 attaches on player spawn.
2. B1 no force-high-STR CLI (HARD). random_rpg modest; need patch main ~1498 or shotAction rpgcmbt.
3. B2 no scaled-dmg stderr (HARD). Add fprintf combat.cpp~1232 or main after melee ~3118.
4. B3 HUD weapon unscaled (SOFT). OCR STR/LVL OK.
5. B4 possess omit RpgStats (SOFT). Death reapply 3686; not first-spawn.

## Minimal REAL proof (unit-green first)
Patches:
1. Force sheet on --action rpgcmbt: fresh_rpg(10), STR=20, AGI=20
2. Rate-limited [rpgcmbt] stderr on swing
3. Optional HUD print melee_damage

### Shot command template
cd /d C:\hades\gigahrush2
build-win\Release\gigahrush2.exe --shot shots\shot_rpgcmbt.png --frames 900 --ride 0 --action rpgcmbt 1>shots\shot_rpgcmbt_stdout.txt 2>shots\shot_rpgcmbt_stderr.txt

Fallback: --action wall --frames 1200 (still needs force-STR patch)
cwd=repo root; do NOT pass --no-hud

Green gates: exit0, PNG>1KB, shot: saved, [rpgcmbt] str=20 dmg>table, [wall]/[corp], HUD LVL/STR/AGI/INT

## Files to read next
- src/app/main.cpp
- src/game/embody.cpp:75-98
- src/game/floor_stream.cpp:198-211
- src/game/combat.cpp:1185-1307
- src/game/rpg.h / rpg.cpp
- tests/suite_rpg.inl
- shots/_run_carve_proof.py, shots/_run_padic_proof.py
