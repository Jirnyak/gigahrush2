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
- [x] CORPSHOT: --action corp harness (face/walk/melee → one E on corpse)
- [x] CORPSHOT: stderr [corp] CORPSE LOOTED once per interact edge
- [x] CORPSHOT: empty searched corpse prompt skip / REMAINDER label
- [x] CORPSHOT real-game PROOF=GREEN (corp_diag.txt; TAKEN 1 ITEMS +35 RUB; kills:2)

## In flight
- [ ] pathspec commit CORPSHOT + docs (main.cpp, shots/_run_corp_proof.py, BACKLOG, progress) — no shaders, no scratch
- [ ] pull --ff-only origin main + push origin main (no force)
- [ ] STATUS: wire StatusSet into damage + main tick (P0 code-without-gameplay)
- [ ] CARVE: combat/weapons → carve_sphere (console-only today = PARTIAL)
- [ ] AIMEM: ai_release on floor leave / memory seam audit
- [ ] TEX1 blocked: 3 missing roughness ktx2 — no sources, do not mock
- [ ] CNT1 content thin (status.csv ~6 rows) — port from old gigahrush
- [ ] optional RPG1 RpgStats across elevator; optional MAGSHOT HUD mag across --ride

## Do not
- stage/commit prop_*, gpu_*, shaders/** (cube*.spv FOREIGN dirt), embody XP path
- git add -A / force-push
- commit shots/*.png binaries or large stderr dumps unless pathspec-asked
- mock missing ktx2 textures
- touch cube_pass.cpp, floor_gen.cpp, render/gpu_*
- commit scratch _patch_corp.py / _scan_* / shot_corp_stderr.txt
- **ALLOWED this cycle pathspec:** src/app/main.cpp, shots/_run_corp_proof.py, .agents/worker_game_audit/BACKLOG.md, .agents/worker_game_audit/progress.md

## Cycle report (2026-07-31 ~14:46) — CORPSHOT CLOSED
цикл CORPSHOT | closed: --action corp real kill→corpse→E→loot; PROOF=GREEN;
TAKEN 1 ITEMS (+35 RUB); one-press interact (spam fixed); empty-searched prompt truth |
runner shots/_run_corp_proof.py 2400f ride0 | HUD kills:2 loot 35 rub |
wip: pathspec commit + pull + push | residual OPEN: STATUS P0, CARVE P1, AIMEM P1, TEX1, CNT1 |
blockers: shaders/** dirty foreign — never stage

## Cycle report (2026-07-31 ~10:10) — CORP1 + FEUD1 CLOSED
цикл CORP1/FEUD1 | closed: corpse interact no item-loss; loottable asserts staged not floor;
feud HP floor restored; unit GREEN 215499/0; CMake pin 215499; docs CLOSED |
core pipeline already on main f4695b1; residual quality+pin+docs prior

## Cycle report (2026-07-31 ~01:24) — FOR1 CLOSED
цикл FOR1/MAG1 | closed: mag+melee survive elevator body-swap; unit was 213917/0 |
pin superseded by CORP1 pin 215499 this cycle

## Cycle report (2026-07-30 ~22:20) — SAV1
цикл SAV1 | closed: --action save|load harness, two-phase F9 gameplay PROOF=GREEN floor-14

## Architect answers (CORPSHOT close)
- **Least confident:** Status effects never tick in main loop — largest remaining code-without-gameplay.
- **Biggest missing:** STATUS/CARVE live proofs; commit+push of CORPSHOT still in flight at write time.
- **Don't realize:** TAKEN 0 can be a legitimate empty roll; re-proof got TAKEN 1/+35. Pipeline is real.
- **Implemented-not-integrated:** StatusSet; combat→carve; AiMemory floor-leave release.
- **Next execute:** commit pathspec → pull → push → STATUS or CARVE gameplay integration.
