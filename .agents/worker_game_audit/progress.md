# progress.md — worker_game_audit

## Checked
- [x] Restore session; git status; light-grid unlocked main.cpp
- [x] Wire full F9 load in src/app/main.cpp (save.h contract)
- [x] Proof build with vcvars64 → gigahrush2.exe GREEN
- [x] game_test GREEN includes suite_saveload
- [x] F9 code on HEAD (7709b3e main.cpp hunk; WT clean for our path)
- [x] Write BACKLOG.md this cycle
- [x] Classify locks: gpu_light_grid / render foreign — skip
- [x] SHOT1: delete truncated duplicate --shot else-if (0f7086c)
- [x] Release rebuild gigahrush2 + game_test + audit_test after fix
- [x] Real gameplay: --shot shot_travel.png --frames 900 --ride 2 → floor -14, PNG 2.7MiB, exit 0
- [x] place_body_safely on BOTH keyboard and --shot ride
- [x] SAV1: wire --action save|load one-shot after rides + stderr [save]/[load]
- [x] SAV1 two-phase real proof PROOF=GREEN (f9_diag.txt)
- [x] FOR1: elevator capture/restore PlayerRanged+PlayerMelee already on HEAD
- [x] FOR1: test_elevator pins; game_test was 213917/0; pin docs closed prior cycle
- [x] CORP1: loot_corpse_interact production harden (player resolve, stack merge, inv-full, slotCount)
- [x] CORP1: suite_loottable.inl blocks 6–7 truth (staged slots, 0 floor Pickups, slime_green, Betonoed)
- [x] FEUD1: faction_relations.cpp remove isFatalFeud bypass; kFeudMinHpPct floor always for NPCs
- [x] game_test GREEN **215499 checks, 0 failures** (was 2 faction failures pre-FEUD1)
- [x] CMake pin 213917 → **215499**
- [x] CORP1/FEUD1: BACKLOG + progress CLOSED + architect notes

## In flight
- [ ] pathspec commit CORP1+FEUD1+pin+docs (no shaders)
- [ ] pull --no-rebase origin main + push origin main (no force)
- [ ] CORPSHOT: real-game corpse loot kill→body→E interact proof (optional proof-class upgrade)
- [ ] TEX1 blocked: 3 missing roughness ktx2 — no sources, do not mock
- [ ] CNT1 content thin (status.csv ~6 rows) — port from old gigahrush
- [ ] optional RPG1 RpgStats across elevator; optional MAGSHOT HUD mag across --ride

## Do not
- stage/commit prop_*, gpu_*, shaders/** (cube*.spv FOREIGN dirt), embody XP path
- git add -A / force-push
- commit shots/*.png binaries or large stderr dumps unless pathspec-asked
- mock missing ktx2 textures
- touch cube_pass.cpp, floor_gen.cpp, render/gpu_*
- **ALLOWED this cycle pathspec:** src/game/loot.cpp, src/game/faction_relations.cpp, tests/suite_loottable.inl, CMakeLists.txt, .agents/worker_game_audit/BACKLOG.md, .agents/worker_game_audit/progress.md

## Cycle report (2026-07-31 ~10:10) — CORP1 + FEUD1 CLOSED
цикл CORP1/FEUD1 | closed: corpse interact no item-loss; loottable asserts staged not floor;
feud HP floor restored; unit GREEN 215499/0; CMake pin 215499; docs CLOSED |
core pipeline already on main f4695b1; residual quality+pin+docs this commit |
wip: pathspec commit + pull + push | residual OPEN: CORPSHOT real-game; TEX1 no mock; CNT1;
RPG1/MAGSHOT optional | blockers: shaders/** dirty foreign — never stage

## Cycle report (2026-07-31 ~01:24) — FOR1 CLOSED
цикл FOR1/MAG1 | closed: mag+melee survive elevator body-swap; unit was 213917/0 |
pin superseded by CORP1 pin 215499 this cycle

## Cycle report (2026-07-30 ~22:20) — SAV1
цикл SAV1 | closed: --action save|load harness, two-phase F9 gameplay PROOF=GREEN floor-14

## Architect answers (CORP1 close)
- **Least confident:** Real-game corpse interact never shot this cycle — only unit pin. Feud clamp vs suite green; live NPC-vs-NPC never-kill not playtested.
- **Biggest missing (pre-close):** Docs OPEN + uncommitted polish + pin in WT only. Fixed this cycle.
- **Don't realize:** CORP1 core wired since f4695b1; residual is interact harden + suite truth + FEUD1 + pin + docs + push. Shader spv = FOREIGN. game_test buffers ~6 min.
- **Implemented-not-integrated:** CORP1 path fully wired. CORPSHOT open for gameplay proof class. drop_mob_loot debug-only for kill path.
- **Next execute:** commit pathspec → pull → push → CORPSHOT / CNT1 / TEX1 (no mocks).
