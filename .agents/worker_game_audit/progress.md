# progress.md — worker_game_audit

## Checked
- [x] Restore session; git status; light-grid unlocked main.cpp
- [x] Wire full F9 load in src/app/main.cpp (save.h contract)
- [x] Proof build with vcvars64 → gigahrush2.exe GREEN
- [x] game_test GREEN includes suite_saveload
- [x] F9 code on HEAD (7709b3e main.cpp hunk; WT clean for our path)
- [x] Write BACKLOG.md this cycle
- [x] Classify locks: gpu_light_grid / render foreign — skip
- [x] SHOT1: delete truncated duplicate `--shot` else-if (0f7086c)
- [x] Release rebuild gigahrush2 + game_test + audit_test after fix
- [x] Real gameplay: `--shot shot_travel.png --frames 900 --ride 2` → floor -14, PNG 2.7MiB, exit 0
- [x] game_test 213879 checks / 0 fail; audit_test 149 checks / 0 fail (travel arrival GREEN)
- [x] place_body_safely on BOTH keyboard (~1140) and --shot ride (~2626)

## In flight
- [ ] push origin main (no force; auth flaky)
- [ ] FOR1 forensic src/game next defect
- [ ] TEX1 optional: 3 missing roughness ktx2 (non-fatal)

## Do not
- stage/commit prop_*, gpu_*, shaders, embody, foreign main hunks
- git add -A / force-push
- commit shots/*.png binaries or _*_test_out.txt junk unless asked

## Cycle report (2026-07-30 ~21:15)
цикл SHOT1+PBS1 | closed: truncated shot block, real ride proof floor-14, suites green |
wip: push | new: FOR1 forensic, TEX1 roughness assets | blockers: origin push auth may fail

## Architect answers (handoff)
- **Least confident:** PNG proves floor travel + live scene, not a pixel-level “body not in wall” assertion; place_body_safely has no stderr line when it relocates. Audit pin covers the algorithm.
- **Biggest missing:** FOR1 — no new RED ledger item; content thin (CNT1); 3 roughness textures missing.
- **Don’t realize:** handoff assumed WT-only place_body + ahead 17; live was clean WT, place_body already HEAD, only SHOT1 corruption on HEAD. Release needs `data` junction for textures.
- **Implemented not gameplay-proven before this cycle:** place_body_safely on --shot (now proven via ride→floor-14+PNG). GpuCullPass foreign — do not touch.
- **Next execute:** pathspec commit docs → push → FOR1 hunt in src/game.
