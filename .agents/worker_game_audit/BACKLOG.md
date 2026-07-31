# BACKLOG — worker_game_audit

Lane: game audit + save/travel seams + content port. NOT render/prop.
Updated: 2026-07-31 ~14:46 Samara

## CLOSED this session
| ID | Item | Proof | Commit |
|----|------|-------|--------|
| CORP1 | Corpse loot staging: Dead→CorpseLootPending→Corpse; interact no item-loss (stack merge / inv-full leave remainder); suite asserts staged not floor | **unit GREEN:** game_test **215499 checks, 0 failures**; loottable 600 corpses → 833 staged slots, 39 slime_sample_green, floor pickups=0; Betonoed 5..10 slots, rub/kill ~137.3 (window 60..250); interact harden in loot.cpp (resolve player before searched; stackMax partial move; recompute slotCount) | this commit |
| FEUD1 | Restore kFeudMinHpPct clamp (isFatalFeud voided it for every feud pair) | suite_faction2.inl floor CHECKs green: citizen bottoms at 50% HP; frail maxHP=2 bottoms at 1; never Dead from feud | same commit |
| FOR1 / MAG1 | Elevator body-swap preserves PlayerRanged + PlayerMelee (magCount, weapon, shots, hits, kills). Capture before fold_back, emplace_or_replace after embody_as_player; lazy-absent stays absent. | unit GREEN prior: 213917/0; pins in test_elevator | prior (9cbb7fb / b6cd6c5 + pin docs) |
| SAV1 | `--action save\|load` one-shot shot harness + stderr `[save]`/`[load]` audit trail | two-phase real game PROOF=GREEN floor -14 (shots/f9_diag.txt) | prior cycle |
| SHOT1 | Truncated duplicate `--shot` capture block removed | main.cpp; Release rebuild GREEN | 0f7086c |
| PBS1 | place_body_safely after floor travel (keyboard + --shot --ride) | shot_travel.png floor -14, 901 frames, exit 0 | prior |
| F9 | Full F9 load path | gameplay-proven via SAV1 | 7709b3e + SAV1 |
| T1 | Travel capture/apply parity keyboard + --shot | both sites call place_body_safely | 702265d |
| A1-9 | suite_audit ledger pins | audit_test 149 checks, 0 failures | various |
| GT | game_test pin | **215499 checks, 0 failures** (was 213917; +checks from loottable truth + suite growth) | prior |
| CORPSHOT | Real-game kill→corpse→E→CORPSE LOOTED proof + --action corp harness | **PROOF=GREEN** shots/corp_diag.txt: attack d=29→0, corpse in reach once, CORPSE LOOTED TAKEN 1 ITEMS (+35 RUB); HUD kills:2 loot 35 rub; shot_corp.png; one-press interact (no spam) | this commit |

## OPEN / next (priority)
| Pri | ID | Item | Pathspec | Notes |
|-----|----|------|----------|-------|
| P0 | STATUS | StatusSet/status_step never called from main tick — data/status.csv + suite exist, combat never applies | src/game/status*.cpp + main.cpp | code-without-gameplay; wire apply on damage + status_step on tick; real-game proof |
| P1 | CARVE | carve_sphere console/--action carve only — weapons/combat do not call destruct | src/game/destruct* + combat | PARTIAL; need combat hit → carve or explicit weapon carve |
| P1 | AIMEM | AiMemory tested; ai_release on floor leave / pass to ai_step may be incomplete | src/game/ai* + floor_stream | check embody/fold_back release |
| P2 | TEX1 | 3 missing roughness ktx2 (rubber_tiles / rusty_metal_03 / rusty_corrugated_iron) | data/textures | non-fatal; albedo+normal OK; roughness mask 0x3400 (3/6); **no mock ktx2** |
| P2 | CNT1 | Content expand status/craft from old giga | data/*.csv + tables | thin: status.csv (~6 rows); port real rows from C:\hades\gigahrush |
| P2 | PAR1 | Re-grep travel sites after every main.cpp foreign commit | src/app/main.cpp read-only unless hole | line drift from light-grid/loot-emissive; WT often foreign-dirty |
| P3 | RPG1 | Optional: preserve RpgStats across elevator (embody re-rolls today) | src/game/elevator.cpp + embody | NOT FOR1 regression — known residual |
| P3 | MAGSHOT | Optional: real-game HUD mag line across --ride | main.cpp foreign-aware | unit pin owns body-swap |
| P3 | M4 | worker_m4 leftovers if unowned | .agents/worker_m4* peek | only src/game scope |
| P3 | SHOTLOG | optional stderr when place_body_safely relocates body | main.cpp | proof today is floor+PNG+audit |

## LOCKED — do not touch
- src/render/env_detail.* gpu_particle_pass.* gpu_light_grid.* GpuCullPass (foreign WIP)
- shaders/**  (cube.frag.spv / cube_tex.frag.spv often dirty FOREIGN — never stage)
- main.cpp propPlacer / light-grid sites (surgical save hunks only if needed)
- .agents/** other lanes; root ORIGINAL_REQUEST.md if foreign
- embody.cpp XP path
- cube_pass.cpp, floor_gen.cpp, shots binaries unless pathspec-asked
- force-push; git add -A

## Safe zones
- lane docs under .agents/worker_game_audit/**
- src/game/** except embody if foreign-dirty (loot.cpp, faction_relations.cpp OK this cycle)
- data/** content CSV
- tests/suite_loottable.inl, suite_audit.inl + pins in CMake
- save/load/travel if main.cpp free of foreign WIP

## CORP1 architect proof block — 2026-07-31
```
Pipeline (main ~2380): damage → loot_dead_mobs → finalize_deaths → Corpse → interact (~2091, reach 2.2f)
Dead-window staging keeps finalize sole Corpse emplacer
POD fixed arrays kMaxCorpseSlots=8, trivially_copyable
Systems pure: loot writes data, finalize moves, interact drains
drop_mob_loot = non-prod/debug for kill path (floor Pickup gold carpet FIXED)
loot_corpse_interact: resolve CameraTag player BEFORE searched=true / slot mutation;
  stack merge moves only space up to stackMax; remainder stays on corpse;
  inventory full → break, leave remainder; recompute corpse.slotCount after drain

suite_loottable.inl blocks 6–7:
  Assert CorpseLootPending + filled slots + 0 floor Pickups
  Kind-authored slime_sample_green in staged slots
  Betonoed Boss: 5..10 staged slots; rub/kill 60..250; floor=0
  Measured: 600 corpses → 833 staged slots, 39 slime_sample_green; floor=0; Betonoed ~137.3 rub/kill

FEUD1: removed isFatalFeud bypass (rel_row self != rel_row foe was always true for feud pairs)
  → kFeudMinHpPct=50 + absolute floor 1 always for non-CameraTag foes

game_test: 215499 checks, 0 failures (prior red 215499/2 faction-only; after FEUD1: 0)
Runner: python -u C:\hades\run_gt.py → C:\hades\gigahrush2_gt_out.txt
Exe: C:\hades\gigahrush2\build-win\Release\game_test.exe
CMake pin: 213917 → 215499 (checks added from suite tighten + growth, 0 failures)
FOREIGN dirty not staged: shaders/cube.frag.spv, shaders/cube_tex.frag.spv
```
Feature without unit pin = DECLINED. CORPSHOT CLOSED 2026-07-31 ~14:46 — real-game proof GREEN.

## Gameplay proof (FOR1 / MAG1) — 2026-07-31 ~01:14
```
runner: python Desktop/_for1_run_test.py
exe: build-win/Release/game_test.exe
SUM: game_test: 213917 checks, 0 failures (superseded pin → 215499 this cycle)
fix: elevator.cpp ride capture/restore PlayerRanged+PlayerMelee
```

## Gameplay proof (SAV1 / F9 harness) — 2026-07-30 ~22:15
```
phase1: --ride 2 --action save → floor -14, sav 780B, shot_f9_save.png PROOF=GREEN
phase2: --ride 0 --action load → floor -14 @44,35,2, shot_f9_load.png
```

## Gameplay proof (SHOT1/PBS1) — 2026-07-30
```
--shot shot_travel.png --frames 900 --ride 2 → floor -14, PNG ~2.7 MiB, exit 0
```

## Gameplay proof (CORPSHOT) — 2026-07-31 ~14:46
```
runner: python C:\hades\gigahrush2\shots\_run_corp_proof.py
exe: build-win/Release/gigahrush2.exe --shot shots/shot_corp.png --frames 2400 --ride 0 --action corp
exit=0 elapsed=48.0s png=2.7MiB
stderr: [corp] attack mob d=29.53→0.04 → corpse in reach — interact (ONCE)
        [corp] CORPSE LOOTED: TAKEN 1 ITEMS (+35 RUB) floor=0  (once; spam fixed)
HUD shot_corp_view.jpg: kills:2 | loot 35 rub (1/64) | [E] LOOT CORPSE | HP 70
Harness: face nearest MobRef, wishDir walk-in, attackHeld; one E on Corpse≤2.2m
Empty searched corpses no longer keep LOOT CORPSE prompt forever
```

## Architect answers (CORPSHOT close cycle)
- **Least confident:** Status effects (StatusSet) still never tick in main — highest remaining code-without-gameplay. Carve still console-only.
- **Biggest missing:** STATUS/CARVE/AIMEM integration proofs; TEX1 roughness sources; CNT1 content depth.
- **Don't realize:** Empty corpse loot (TAKEN 0) can be a real roll, not a pipeline bug — second CORPSHOT run took 1 item/+35 RUB. CORP1 unit pin already closed; CORPSHOT was the gameplay proof class.
- **Implemented-not-integrated:** StatusSet/status_step; combat→carve; optional AiMemory floor-leave release; drop_mob_loot debug path.
- **Next execute:** pathspec commit CORPSHOT → pull --ff-only → push origin main → STATUS wire or CARVE combat path → real-game proof.
