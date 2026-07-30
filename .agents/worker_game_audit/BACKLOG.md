# BACKLOG — worker_game_audit

Lane: game audit + save/travel seams + content port. NOT render/prop.
Updated: 2026-07-31 ~01:24 Samara

## CLOSED this session
| ID | Item | Proof | Commit |
|----|------|-------|--------|
| FOR1 / MAG1 | Elevator body-swap preserves `PlayerRanged` + `PlayerMelee` (magCount, weapon, shots, hits, kills). Capture before `fold_back`, `emplace_or_replace` after `embody_as_player`; lazy-absent stays absent. | **unit GREEN:** `game_test` RC=0 **213917 checks, 0 failures** (pid 39996, dt≈350s, 2026-07-31 ~01:14); pins in `test_elevator`: mag=12 weapon=7 shots=7 hits=3 kills=99 survive up / no-op / down. Fix already on HEAD `9cbb7fb` (`elevator.cpp`); tests on `b6cd6c5`. CMake pin 213899→**213917**. Residual: `RpgStats` still re-rolled by `embody_as_player` (NOT FOR1 scope). Real-game HUD mag-across-`--ride` shot not required for close — body-swap seam is unit-pinned at the exact destroy/rebuild path. | this commit (pin+docs); fix/tests prior mislabeled commits |
| SAV1 | `--action save\|load` one-shot shot harness + stderr `[save]`/`[load]` audit trail | two-phase real game: phase1 `--ride 2 --action save` → `[save] saved: floor -14` + `gigahrush2.sav` 780B + `shot_f9_save.png`; phase2 `--ride 0 --action load` → `[load] loaded: floor -14 @44,35,2` + `shot_f9_load.png` floor -14; `shots/f9_diag.txt` **PROOF=GREEN** | prior cycle |
| SHOT1 | Truncated duplicate `--shot` capture block removed (empty else-if before full save) | main.cpp -8 lines; Release rebuild GREEN | 0f7086c |
| PBS1 | `place_body_safely` after floor travel (keyboard `[`/`]` + `--shot --ride`) | real shot: `shots/shot_travel.png` floor **-14** after `--ride 2`, 901 frames, exit 0, gpu-ms frame 1.94, bodies 632; audit travel arrival GREEN | already on HEAD pre-0f7086c; shot path unblocked by 0f7086c |
| F9 | Full F9 load path (bake guard, travel_to_saved_floor, arrival seam, apply_player_snapshot, sync_armour, place_body_at_cell, apply_opened, honest HUD) | main.cpp links GREEN via vcvars64; game_test 100%; **now also gameplay-proven via SAV1** | landed in 7709b3e + SAV1 harness |
| T1 | Travel capture/apply parity keyboard + --shot | prior 702265d + re-grep CLEAN; both sites call place_body_safely | 702265d |
| A1-9 | suite_audit ledger pins | **audit_test 149 checks, 0 failures** (2026-07-30) | various |
| GT | game_test pin | **game_test 213917 checks, 0 failures** (2026-07-31, was 213879→213899→213917) | this commit pin |

## OPEN / next (priority)
| Pri | ID | Item | Pathspec | Notes |
|-----|----|------|----------|-------|
| P2 | TEX1 | 3 missing roughness ktx2 (rubber_tiles / rusty_metal_03 / rusty_corrugated_iron) | data/textures | non-fatal; albedo+normal OK; roughness mask 0x3400 (3/6); **no mock ktx2** |
| P2 | CNT1 | Content expand status/craft from old giga | data/*.csv + tables | thin: status.csv (~6 rows); port real rows from C:\hades\gigahrush |
| P2 | PAR1 | Re-grep travel sites after every main.cpp foreign commit | src/app/main.cpp read-only unless hole | line drift from light-grid/loot-emissive; WT often foreign-dirty |
| P3 | RPG1 | Optional: preserve `RpgStats` across elevator (embody re-rolls today) | src/game/elevator.cpp + embody | NOT a FOR1 regression — known residual; open only if design wants XP/stats sticky on ride |
| P3 | MAGSHOT | Optional: real-game HUD mag line across `--ride` | main.cpp foreign-aware | unit pin owns body-swap; HUD shot is nicer proof class if main free |
| P3 | M4 | worker_m4 leftovers if unowned | .agents/worker_m4* peek | only src/game scope |
| P3 | SHOTLOG | optional stderr line when place_body_safely relocates body | main.cpp | proof today is floor+PNG+audit; log would make ride path louder |

## LOCKED — do not touch
- src/render/env_detail.* gpu_particle_pass.* gpu_light_grid.* GpuCullPass (foreign WIP)
- shaders/**
- main.cpp propPlacer / light-grid sites (surgical save hunks only if needed)
- .agents/** other lanes; root ORIGINAL_REQUEST.md if foreign
- embody.cpp XP path
- cube_pass.cpp, floor_gen.cpp, shots binaries unless pathspec-asked

## Safe zones
- lane docs under .agents/worker_game_audit/**
- src/game/** except embody if foreign-dirty
- data/** content CSV
- tests/suite_audit.inl + audit pin in CMake
- save/load/travel if main.cpp free of foreign WIP

## Gameplay proof (FOR1 / MAG1) — 2026-07-31 ~01:14
```
runner: python Desktop/_for1_run_test.py  (Popen stdout=file fd; cmd redirects empty)
exe: build-win/Release/game_test.exe
pid=39996 RC=0 dt_s=349.98 outlen=15442
SUM: game_test: 213917 checks, 0 failures
pin path: test_elevator FOR1 block — lazy-absent CHECKs; emplace mag=12 weapon=7
  shots=7 hits=3 kills=99; survive ride up, no-op same floor, ride down
fix: src/game/elevator.cpp ride_elevator capture/restore (HEAD 9cbb7fb, clean WT)
CMake: PASS_REGULAR_EXPRESSION 213899 → 213917 (this commit)
NOT in scope: RpgStats re-roll on embody_as_player (residual RPG1)
```
Feature without this class of proof = DECLINED. Body-swap seam is the load-bearing defect;
unit pin runs the exact fold_back → destroy → embody path production uses.

## Gameplay proof (SAV1 / F9 harness) — 2026-07-30 ~22:15
```
runner: python shots/_run_f9_proof.py  (cwd=build-win/Release, data junction)
phase1: gigahrush2.exe --shot shots/shot_f9_save.png --frames 900 --ride 2 --action save
  exit=0 elapsed=38.9s png=2765798
  [save] saved: floor -14, 0 rub, 0 crates
  sav: build-win/Release/gigahrush2.sav size=780
  shot: saved -> .../shot_f9_save.png (floor -14, 901 frames)
phase2: gigahrush2.exe --shot shots/shot_f9_load.png --frames 900 --ride 0 --action load
  exit=0 elapsed=37.2s png=2765798
  [load] loaded: floor -14 @44,35,2, 0 rub, 0 crates
  shot: saved -> .../shot_f9_load.png (floor -14, 901 frames)
has_save_line=True has_load_line=True save_floor=-14 load_floor=-14
PROOF=GREEN  (shots/f9_diag.txt)
```
Harness: one-shot save/load after rides settle (`shotActionConsumed`, `shotRideDone >= shotRide`, `shotFramesSeen >= 30`); load waits `!nav.baking()`. Stderr `[save]`/`[load]` lines for headless audit (HUD invisible in captures).

## Gameplay proof (SHOT1/PBS1) — 2026-07-30
```
cmd: gigahrush2.exe --shot shots/shot_travel.png --frames 900 --ride 2
cwd: build-win/Release (data junction -> repo data/)
exit=0 elapsed=39.2s
shot: saved -> .../shot_travel.png (floor -14, 901 frames)
gpu-ms: world 1.590 bodies 0.035 hud 0.013 frame 1.941 (instances 45661, bodies 632)
PNG 1280x720 RGB ~2.7 MiB; center sample ~(26,22,19) not black
audit: travel arrival wall(8,8,2)->standable(7,7,1) rings=1 supported=1
```
Feature without this class of proof = DECLINED.

## Architect answers (FOR1 close cycle)
- **Least confident:** Real-game HUD mag across live `--ride` not screenshot-proven this cycle (unit owns the exact body-swap); `RpgStats` still re-rolls; foreign main.cpp dirty may hide ride audit hooks.
- **Biggest missing before close:** Docs said FOR1 OPEN; CMake pin lagged at 213899 vs binary 213917 (ctest would FAIL until pin+reconfigure); pathspec commit+push lag. Now pin+docs closed.
- **Don't realize:** FOR1 code+tests already on origin lineage under mis-titled commits (`9cbb7fb` materials, `b6cd6c5` render) — `git status` hid elevator because HEAD matched; only pin/docs/process lagged. cmd.exe redirects for long tests fail silently — use Python Popen with file fds. Pin is **213917** not handoff's 213899 (+18 from other suites beyond FOR1's share).
- **Implemented-not-integrated / not gameplay-proven:** craft_write/craft_read not in F5 save; NetTerminal craft unit-level DECLINED; utility AI notes in tests; TEX1 no mock ktx2; RpgStats not preserved on elevator (RPG1 optional); F9/SAV1 already PROOF=GREEN prior cycle.
