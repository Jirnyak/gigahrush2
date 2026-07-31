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
- [x] STATUS: StatusSet playerStatus in main; status_step + moveSpeed fold + root
- [x] STATUS: slow_step before physics_step
- [x] STATUS: SporeCarpet → SporeHaze (gasmask gate scan)
- [x] STATUS: WEB projectile dual-apply PaupsinaWeb (combat.cpp braces)
- [x] STATUS: --action status + [status] APPLY/tick stderr
- [x] STATUS real-game PROOF=GREEN (status_diag.txt; move_e3=180 rooted=1 → 820)
- [x] CARVE: CarveProposalQueue POD in combat.h; wall/melee/bullet enqueue
- [x] CARVE: main drain carve_sphere + [carve] COMBAT stderr
- [x] CARVE: --action wall early fly=false + wishDir post-input.apply
- [x] CARVE real-game PROOF=GREEN (carve_diag.txt; removed=8 power=44 r=0.55; d=6.32->2.00 fly=0)

## In flight
- [ ] pathspec commit CARVE + docs (main.cpp, combat.h/cpp, shots/_run_carve_proof.py, BACKLOG, progress) — no shaders, no scratch
- [ ] pull --ff-only origin main + push origin main (no force)
- [ ] AIMEM: ai_release on floor leave / memory seam audit
- [ ] TEX1 blocked: 3 missing roughness ktx2 — no sources, do not mock
- [ ] CNT1 content thin (status.csv ~6 rows) — port from old gigahrush
- [ ] optional RPG1 RpgStats across elevator; optional MAGSHOT HUD mag across --ride


## Do not
- stage/commit prop_*, gpu_*, shaders/** (cube*.spv FOREIGN dirt), embody XP path
- git add -A / force-push
- commit shots/*.png binaries or large stderr dumps unless pathspec-asked
- mock missing ktx2 textures
- touch cube_pass.cpp, floor_gen.cpp, render/gpu_* / sub_mesh (Zhirnyak)
- commit scratch _patch_* / _scan_* / shot_*_stderr.txt
- **ALLOWED this cycle pathspec:** src/app/main.cpp, src/game/combat.h, src/game/combat.cpp, shots/_run_carve_proof.py, .agents/worker_game_audit/BACKLOG.md, .agents/worker_game_audit/progress.md

## Cycle report (2026-07-31 ~16:10) — CARVE CLOSED
→ CARVE | closed: combat proposals → carve_sphere; --action wall PROOF=GREEN;
[carve] COMBAT removed=8 power=44 r=0.55; fly=0 d=6.32→2.00; shot_carve.png |
runner shots/_run_carve_proof.py 1200f ride0 | residual OPEN: AIMEM P1, TEX1, CNT1 |
blockers: shaders/** dirty foreign — never stage; stay off src/render/** (Zhirnyak)

## Cycle report (2026-07-31 ~15:07) — STATUS CLOSED
цикл STATUS | closed: StatusSet in main tick; SporeHaze on SporeCarpet; WEB→PaupsinaWeb;
slow_step live; --action status PROOF=GREEN move_e3=180 rooted=1 → 443 → 820 |
runner shots/_run_status_proof.py 480f ride0 | melee_e3=700 under ZhelemishSkin |
wip: pathspec commit + pull + push | residual OPEN: CARVE P1, AIMEM P1, TEX1, CNT1 |
blockers: shaders/** dirty foreign — never stage; stay off src/render/** (Zhirnyak)

## Cycle report (2026-07-31 ~14:46) — CORPSHOT CLOSED
цикл CORPSHOT | closed: --action corp real kill→corpse→E→loot; PROOF=GREEN;
TAKEN 1 ITEMS (+35 RUB); one-press interact (spam fixed); empty-searched prompt truth |
runner shots/_run_corp_proof.py 2400f ride0 | HUD kills:2 loot 35 rub | commit c61e04b

## Cycle report (2026-07-31 ~10:10) — CORP1 + FEUD1 CLOSED
цикл CORP1/FEUD1 | closed: corpse interact no item-loss; loottable asserts staged not floor;
feud HP floor restored; unit GREEN 215499/0; CMake pin 215499; docs CLOSED |
core pipeline already on main f4695b1; residual quality+pin+docs prior

## Cycle report (2026-07-31 ~01:24) — FOR1 CLOSED
цикл FOR1/MAG1 | closed: mag+melee survive elevator body-swap; unit was 213917/0 |
pin superseded by CORP1 pin 215499 this cycle

## Cycle report (2026-07-30 ~22:20) — SAV1
цикл SAV1 | closed: --action save|load harness, two-phase F9 gameplay PROOF=GREEN floor-14

## Architect answers (STATUS close)
- **Least confident:** SporeHaze gate `gate != 0`; WEB only on playerEntity hit.
- **Biggest missing:** AIMEM floor-leave; TEX1; CNT1. (CARVE CLOSED)
- **Don't realize:** mults stack (zh×web); Slowed CAP + StatusSet coexist.
- **Implemented-not-integrated:** combat→carve; AiMemory floor-leave release.
- **Next execute:** commit pathspec → pull --rebase → push → CARVE (off render).

## Cycle AIMEM 2026-07-31 (game/app domain — parallel to Zhirnyak padic/render)

**Domain split:** Zhirnyak owns `src/render/**` + padic + door seed + `--floor`. This agent owns game/app AI/combat/status/corps wiring. No cross-touch.

**Done:**
- `game::AiMemory aiMem` owned in main (no global); `aiCfg.memory = true`
- `ai_step(..., &aiMem)` every sim tick; periodic `[aimem] STEP` stderr (seen/replan/rows/writes/coal)
- `ai_release` on: keyboard `do_ride` leave, `--shot` travel leave, `FloorStreamer::unload` before fold_back
- Proof harness `shots/_run_aimem_proof.py`: 900 frames `--ride 1`
- **PROOF=GREEN** exit=0 max_seen=419 STEP=37 LEAVE=1 RELEASE=1 brains attached after async nav bake; mem_rows=4096 writes>=2 coal>=8 PNG ok
- Note: released=0 on leave is correct when brains never held MotionOwner::Ai (own_ai=0); contract still fires; memory column survives floor fold via NpcId

**Files:** src/app/main.cpp, src/game/floor_stream.cpp, shots/_run_aimem_proof.py, BACKLOG, progress

**Not touched:** src/render/**, shaders/**

**Next (this agent, non-render):** TEX1 missing ktx2 roughness (logged in aimem stderr), CNT1 status.csv thin, scan unintegrated game systems; step-assist is physics — coordinate if needed. Zhirnyak continues padic tails (RAM sandwich, step 0.25, door tick load).
