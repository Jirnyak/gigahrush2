# BACKLOG — worker_game_audit

Lane: game audit + save/travel seams + content port. NOT render/prop.
Updated: 2026-07-30 ~22:20 Samara

## CLOSED this session
| ID | Item | Proof | Commit |
|----|------|-------|--------|
| SAV1 | `--action save\|load` one-shot shot harness + stderr `[save]`/`[load]` audit trail | two-phase real game: phase1 `--ride 2 --action save` → `[save] saved: floor -14` + `gigahrush2.sav` 780B + `shot_f9_save.png`; phase2 `--ride 0 --action load` → `[load] loaded: floor -14 @44,35,2` + `shot_f9_load.png` floor -14; `shots/f9_diag.txt` **PROOF=GREEN** | pending this commit |
| SHOT1 | Truncated duplicate `--shot` capture block removed (empty else-if before full save) | main.cpp -8 lines; Release rebuild GREEN | 0f7086c |
| PBS1 | `place_body_safely` after floor travel (keyboard `[`/`]` + `--shot --ride`) | real shot: `shots/shot_travel.png` floor **-14** after `--ride 2`, 901 frames, exit 0, gpu-ms frame 1.94, bodies 632; audit travel arrival GREEN | already on HEAD pre-0f7086c; shot path unblocked by 0f7086c |
| F9 | Full F9 load path (bake guard, travel_to_saved_floor, arrival seam, apply_player_snapshot, sync_armour, place_body_at_cell, apply_opened, honest HUD) | main.cpp links GREEN via vcvars64; game_test 100%; **now also gameplay-proven via SAV1** | landed in 7709b3e + SAV1 harness |
| T1 | Travel capture/apply parity keyboard + --shot | prior 702265d + re-grep CLEAN; both sites call place_body_safely | 702265d |
| A1-9 | suite_audit ledger pins | **audit_test 149 checks, 0 failures** (2026-07-30) | various |
| GT | game_test pin | **game_test 213879 checks, 0 failures** (2026-07-30) | n/a run |

## OPEN / next (priority)
| Pri | ID | Item | Pathspec | Notes |
|-----|----|------|----------|-------|
| P1 | FOR1 | Fresh forensic src/game defect | src/game/** free files | ledger empty of RED; find real bug, pin, fix |
| P2 | TEX1 | 3 missing roughness ktx2 (rubber_tiles / rusty_metal_03 / rusty_corrugated_iron) | data/textures | non-fatal; albedo+normal OK; roughness mask 0x3400 (3/6); **no mock ktx2** |
| P2 | CNT1 | Content expand status/craft from old giga | data/*.csv + tables | thin: status.csv (~6 rows); port real rows from C:\hades\gigahrush |
| P2 | PAR1 | Re-grep travel sites after every main.cpp foreign commit | src/app/main.cpp read-only unless hole | line drift from light-grid/loot-emissive |
| P3 | M4 | worker_m4 leftovers if unowned | .agents/worker_m4* peek | only src/game scope |
| P3 | SHOTLOG | optional stderr line when place_body_safely relocates body | main.cpp | proof today is floor+PNG+audit; log would make ride path louder |

## LOCKED — do not touch
- src/render/env_detail.* gpu_particle_pass.* gpu_light_grid.* GpuCullPass (foreign WIP)
- shaders/**
- main.cpp propPlacer / light-grid sites (surgical save hunks only if needed)
- .agents/** other lanes; root ORIGINAL_REQUEST.md if foreign
- embody.cpp XP path

## Safe zones
- lane docs under .agents/worker_game_audit/**
- src/game/** except embody if foreign-dirty
- data/** content CSV
- tests/suite_audit.inl + audit pin in CMake
- save/load/travel if main.cpp free of foreign WIP

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
