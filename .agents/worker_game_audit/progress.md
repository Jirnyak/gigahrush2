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
- [x] SAV1: wire `--action save|load` one-shot after rides + stderr `[save]`/`[load]`
- [x] SAV1 Release rebuild (vcvars64, `/m:1` after parallel cl Permission denied)
- [x] SAV1 two-phase real proof PROOF=GREEN (f9_diag.txt):
  - phase1 ride2 save → floor -14, sav 780B, shot_f9_save.png
  - phase2 ride0 load → `[load] loaded: floor -14 @44,35,2`, shot_f9_load.png floor -14

## In flight
- [ ] push origin main (no force; auth flaky)
- [ ] FOR1 forensic src/game next defect
- [ ] TEX1 blocked: 3 missing roughness ktx2 — no sources, do not mock

## Do not
- stage/commit prop_*, gpu_*, shaders, embody, foreign main hunks, env_detail/prop_placer WIP
- git add -A / force-push
- commit shots/*.png binaries or large stderr dumps unless pathspec-asked
- mock missing ktx2 textures

## Cycle report (2026-07-30 ~22:20)
цикл SAV1 | closed: --action save|load harness, two-phase F9 gameplay PROOF=GREEN floor-14 |
wip: pathspec commit + push | new: FOR1 forensic | blockers: TEX1 no roughness sources; foreign render WIP dirty

## Architect answers (handoff)
- **Least confident:** load proof asserts floor + cell via stderr/shot line, not pixel body-vs-wall; PNG body placement not automated.
- **Biggest missing:** FOR1 — no new RED ledger item; TEX1 assets absent; CNT1 content thin.
- **Don’t realize:** cmd.exe redirects for gigahrush2 often fail silently — use Python Popen cwd=Release; findstr `[load]` is regex (brackets); load must wait `!nav.baking()` or one-shot never fires during hub bake.
- **Implemented not gameplay-proven before this cycle:** F9 full load was code-complete (7709b3e) but unproven headless — now SAV1 PROOF=GREEN. NetTerminal craft still unit-level DECLINED. TEX1 blocked.
- **Next execute:** pathspec commit main.cpp + docs → push → FOR1 hunt in src/game.
