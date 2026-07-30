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
- [x] FOR1: elevator capture/restore PlayerRanged+PlayerMelee already on HEAD (`9cbb7fb`)
- [x] FOR1: test_elevator pins already on HEAD (`b6cd6c5`) — mag/weapon/shots/hits/kills survive rides
- [x] FOR1: clean game_test RC=0 **213917 checks, 0 failures** (pid 39996, dt≈350s, 2026-07-31)
- [x] FOR1: CMake pin 213899 → 213917
- [x] FOR1: BACKLOG + progress CLOSED Russian/architect notes

## In flight
- [ ] push origin main (no force; auth flaky historically)
- [ ] TEX1 blocked: 3 missing roughness ktx2 — no sources, do not mock
- [ ] CNT1 content thin (status.csv ~6 rows)
- [ ] optional RPG1 RpgStats across elevator; optional MAGSHOT HUD mag across --ride

## Do not
- stage/commit prop_*, gpu_*, shaders, embody, foreign main/combat/door/loot hunks, env_detail/prop_placer WIP
- git add -A / force-push
- commit shots/*.png binaries or large stderr dumps unless pathspec-asked
- mock missing ktx2 textures
- touch cube.frag*, cube_pass.cpp, floor_gen.cpp

## Cycle report (2026-07-31 ~01:24) — FOR1 CLOSED
цикл FOR1/MAG1 | closed: mag+melee survive elevator body-swap; unit GREEN 213917/0;
CMake pin 213917; docs CLOSED | code already on HEAD mislabeled commits 9cbb7fb/b6cd6c5 |
wip: pathspec commit pin+docs + push | residual OPEN: TEX1 no mock; CNT1; RPG1 optional;
MAGSHOT optional | blockers: foreign WT dirty main/combat/door/loot — not staged

## Cycle report (2026-07-30 ~22:20) — SAV1
цикл SAV1 | closed: --action save|load harness, two-phase F9 gameplay PROOF=GREEN floor-14 |
wip was: pathspec commit + push + FOR1 | FOR1 now CLOSED this cycle

## Architect answers (FOR1 close)
- **Least confident:** Real-game HUD mag across live `--ride` not shot this cycle; RpgStats still re-rolls on embody; foreign main may hide ride hooks.
- **Biggest missing (pre-close):** Docs OPEN + pin lag 213899 vs binary 213917 + uncommitted process. Fixed this cycle.
- **Don't realize:** Fix+tests already on main under wrong commit titles — status hid elevator (HEAD match). cmd redirects empty — Python file fds. Pin is 213917 not handoff 213899.
- **Implemented-not-integrated:** craft not in F5; NetTerminal craft DECLINED unit-only; TEX1 blocked; RpgStats=RPG1 optional; F9/SAV1 already PROOF=GREEN.
- **Next execute:** pathspec commit CMakeLists.txt + .agents/worker_game_audit/{BACKLOG,progress}.md → push origin main no-force → TEX1/CNT1 or PAR1 if main free.
