# BACKLOG — worker_game_audit

Lane: game audit + save/travel seams + content port. NOT render/prop.
Updated: 2026-07-31 ~17:00 Samara

## CLOSED this session
| ID | Item | Proof | Commit |
|----|------|-------|--------|
| CORP1 | Corpse loot staging: Dead→CorpseLootPending→Corpse; interact no item-loss (stack merge / inv-full leave remainder); suite asserts staged not floor | **unit GREEN:** game_test **215499 checks, 0 failures**; loottable 600 corpses → 833 staged slots, 39 slime_sample_green, floor pickups=0; Betonoed 5..10 slots, rub/kill ~137.3 (window 60..250); interact harden in loot.cpp (resolve player before searched; stackMax partial move; recompute slotCount) | prior |
| FEUD1 | Restore kFeudMinHpPct clamp (isFatalFeud voided it for every feud pair) | suite_faction2.inl floor CHECKs green: citizen bottoms at 50% HP; frail maxHP=2 bottoms at 1; never Dead from feud | prior |
| FOR1 / MAG1 | Elevator body-swap preserves PlayerRanged + PlayerMelee (magCount, weapon, shots, hits, kills). Capture before fold_back, emplace_or_replace after embody_as_player; lazy-absent stays absent. | unit GREEN prior: 213917/0; pins in test_elevator | prior (9cbb7fb / b6cd6c5 + pin docs) |
| SAV1 | `--action save\|load` one-shot shot harness + stderr `[save]`/`[load]` audit trail | two-phase real game PROOF=GREEN floor -14 (shots/f9_diag.txt) | prior cycle |
| SHOT1 | Truncated duplicate `--shot` capture block removed | main.cpp; Release rebuild GREEN | 0f7086c |
| PBS1 | place_body_safely after floor travel (keyboard + --shot --ride) | shot_travel.png floor -14, 901 frames, exit 0 | prior |
| F9 | Full F9 load path | gameplay-proven via SAV1 | 7709b3e + SAV1 |
| T1 | Travel capture/apply parity keyboard + --shot | both sites call place_body_safely | 702265d |
| A1-9 | suite_audit ledger pins | audit_test 149 checks, 0 failures | various |
| GT | game_test pin | **215499 checks, 0 failures** (was 213917; +checks from loottable truth + suite growth) | prior |
| CORPSHOT | Real-game kill→corpse→E→CORPSE LOOTED proof + --action corp harness | **PROOF=GREEN** shots/corp_diag.txt: attack d=29→0, corpse in reach once, CORPSE LOOTED TAKEN 1 ITEMS (+35 RUB); HUD kills:2 loot 35 rub; shot_corp.png; one-press interact (no spam) | c61e04b |
| STATUS | StatusSet wired into main tick + SporeCarpet + WEB dual-apply; slow_step before physics; --action status harness | **PROOF=GREEN** shots/status_diag.txt: APPLY zh+web move_e3=180 rooted=1; tick 180→443→820 as web expires; melee_e3=700; shot_status.png | 538e139 |
| CARVE | Combat proposes CarveProposalQueue POD; app drains via carve_sphere behind !doors.frozen; melee wall ray + bullet wall hit; --action wall harness | **PROOF=GREEN** shots/carve_diag.txt: fly=0 d=6.32→2.00; [carve] COMBAT removed=8/3/1 power=44 r=0.55; shot_carve.png 2.7MiB | this commit |

## OPEN / next (priority)
| Pri | ID | Item | Pathspec | Notes |
|-----|----|------|----------|-------|
| P1 | AIMEM | CLOSED 2026-07-31 — AiMemory floor-leave release GREEN | src/game/ai* + floor_stream | see CLOSED AIMEM |
| P2 | TEX1 | CLOSED 2026-07-31 — 3 roughness ktx2 shipped; live load 6/6 | data/textures | see CLOSED TEX1 |
| P2 | CNT1 | CLOSED 2026-07-31 — status+craft reference parity (no missing rows) | data/*.csv + tables | see CLOSED CNT1 |
| P2 | PAR1 | CLOSED 2026-07-31 — both travel sites still call place_body_safely + ai_release | src/app/main.cpp read-only | see CLOSED PAR1; re-run after foreign main.cpp |

| P3 | RPG1 | Optional: preserve RpgStats across elevator (embody re-rolls today) | src/game/elevator.cpp + embody | NOT FOR1 regression — known residual |
| P3 | MAGSHOT | Optional: real-game HUD mag line across --ride | main.cpp foreign-aware | unit pin owns body-swap |
| P3 | M4 | worker_m4 leftovers if unowned | .agents/worker_m4* peek | only src/game scope |
| P3 | SHOTLOG | optional stderr when place_body_safely relocates body | main.cpp | proof today is floor+PNG+audit |
| P2 | PADIC | CLOSED 2026-07-31 — floor4 stress GREEN (AI+tex+shot) | main harness + src/game | see CLOSED PADIC; Zhirnyak owns mesher stripes |

## LOCKED — do not touch
- src/render/env_detail.* gpu_particle_pass.* gpu_light_grid.* GpuCullPass (foreign WIP)
- shaders/**  (cube.frag.spv / cube_tex.frag.spv often dirty FOREIGN — never stage)
- main.cpp propPlacer / light-grid sites (surgical save hunks only if needed)
- .agents/** other lanes; root ORIGINAL_REQUEST.md if foreign
- embody.cpp XP path
- cube_pass.cpp, floor_gen.cpp, shots binaries unless pathspec-asked
- force-push; git add -A
- **Zhirnyak render lane:** stay off src/render/** (sub_mesh / cube_merge / cube_pass)

## Safe zones
- lane docs under .agents/worker_game_audit/**
- src/game/** except embody if foreign-dirty (loot.cpp, combat.cpp, status* OK this cycle)
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
STATUS CLOSED 2026-07-31 ~15:07 — real-game proof GREEN.

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

## Gameplay proof (STATUS) — 2026-07-31 ~15:07
```
runner: python C:\hades\gigahrush2\shots\_run_status_proof.py
exe: build-win/Release/gigahrush2.exe --shot shots/shot_status.png --frames 480 --ride 0 --action status
exit=0 elapsed=16.6s png=2.7MiB jpg=108881
stderr: [status] APPLY zh+web move_e3=180 rooted=1 zh_ms=180000 web_ms=4200
        [status] tick move_e3=180→443→820 as web root expires then web ends
        melee_e3=700 (ZhelemishSkin) while zh active; aim_e3=1000
Wire:
  main: StatusSet playerStatus; status_step each tick; moveSpeed *= mult / root→0
  main: slow_step before physics_step
  main: SporeCarpet hazard → status_apply SporeHaze (gate=ip4_gasmask scan)
  main: --action status applies ZhelemishSkin + PaupsinaWeb once
  combat: projectile_step optional StatusSet* + Entity; WEB dual-apply PaupsinaWeb
  HUD: status move_e3 / aim_e3 / rooted when any of zh/web/spore active
```

## Architect answers (CARVE close cycle)
- **Least confident:** melee wall ray uses 8 steps along camera_forward within reach; solid contact may miss thin props.
- **Biggest missing:** AIMEM floor-leave release; TEX1 roughness; CNT1 status.csv thin.
- **Don't realize:** aim_player starts fly=true — wall walk proof MUST force ctl->fly=false or gap never closes.
- **Implemented-not-integrated:** optional AiMemory floor-leave release; drop_mob_loot debug path.
- **Next execute:** pathspec commit CARVE → pull --ff-only → push origin main → AIMEM (stay off src/render/** — Zhirnyak).

## Gameplay proof (CARVE) — 2026-07-31 ~16:10
```
runner: python C:\hades\gigahrush2\shots\_run_carve_proof.py
exe: build-win/Release/gigahrush2.exe --shot shots/shot_carve.png --frames 1200 --ride 0 --action wall
exit=0 elapsed=33.2s png=2.7MiB jpg=111027
stderr: [wall] melee toward solid d=6.32 floor=0 frozen=0 fly=0
        [carve] COMBAT removed=8 power=44 r=0.55 at (88.0,66.0,3.0)
        [wall] melee toward solid d=2.00 ... (closed gap)
        [carve] COMBAT removed=1/3/1 power=44 r=0.55 (follow-up hits)
Wire:
  combat.h: CarveProposal / CarveProposalQueue POD; carve_power_from_dmg
  combat.cpp: Hit.onWall+impactPos; projectile wall enqueue; player_melee wall ray 8-step
  main: combatCarves queue; drain carve_sphere behind !doors.frozen; [carve] COMBAT log
  main: --action wall early face+wishDir AFTER input.apply BEFORE controller_step; ctl->fly=false
  harness: shots/_run_carve_proof.py GREEN iff [carve] COMBAT removed>0 + PNG
Design: combat NEVER mutates grid — only proposes; app owns carve_sphere (same as console)
```

Feature without gameplay = DECLINED. CARVE CLOSED 2026-07-31 ~16:10 — real-game proof GREEN.


## CLOSED 2026-07-31 AIMEM
- AiMemory owned in main; passed to ai_step
- ai_release on do_ride leave, --shot travel, FloorStreamer::unload
- Proof: shots/_run_aimem_proof.py PROOF=GREEN max_seen=419 LEAVE+RELEASE mem_rows=4096

## NOTE 2026-07-31 ~16:38 padic visual package for Zhirnyak
- NOTE_TO_ZHIRNYAK.md updated with stripes/ghost/white-dots + shot paths
- shots/shot_padic.jpg 137KB floor 4 (cwd=repo root; textures load; 3 roughness missing TEX1)
- stripes with albedo loaded => UV/mesher more likely than missing ktx2 alone
- game-agent does NOT thrash src/render/**; evidence only

## CLOSED 2026-07-31 TEX1
- Generated via `python tools/fetch_textures.py --map roughness --only rubber_tiles,rusty_metal_03,rusty_corrugated_iron`
- Pure-Python BC7 path (no external ktx/Compressonator required); rubber_tiles used cached Poly Haven Rough jpg; rusty_* procedural fallback where Rough cache missing
- Files: rubber_tiles_roughness.ktx2, rusty_metal_03_roughness.ktx2, rusty_corrugated_iron_roughness.ktx2 (each 5592928 B BC7_UNORM 2048x12)
- PROOF=GREEN: `gigahrush2.exe --shot shots/shot_tex1.png --frames 120 --floor 0` from repo root
  - NO `[tex] ERROR` for the three missing names
  - `[cube] albedo: 6/6 ... normal: 6/6 ... roughness: 6/6 (mask 0xfc00)` (was roughness 3/6 mask 0x3400)
  - stderr: shots/shot_tex1_stderr.txt
- Not a mock: real KTX2 BC7 containers decoded+uploaded by engine

## CLOSED 2026-07-31 CNT1 — reference content parity (no invent)
Audit vs C:\hades\gigahrush (old giga). **No CSV rows missing to port.** Inventing statuses/recipes = DECLINED.

### Status (6/6 design-complete)
- old `systems/status.ts` + `govnyak.ts`: exactly 6 PlayerStatusId
  - zhelemish_skin, paupsina_web, spore_haze, govnyak_relief, govnyak_cough, govnyak_debt
- GH2 `data/status.csv` + `kStatusCount=6` + `gen_status_table.py EXPECTED_ROWS=6` match
- govnyak duration caps old: relief=70s cough=210s debt=480s → CSV 70000/210000/480000 ms exact
- STATUS gameplay wire already PROOF=GREEN (prior); enum append-only — no expansion without new authored content

### Craft (superset of old sources)
- old `craft_recipe_sources.ts`: **23** source ids; GH2 `craft_recipes.csv`: **24** (= 23 + `default_survival_basics`)
- DIFF sources: only OLD=[] ; only GH2=[default_survival_basics] ; common=23
- old source recipeIds unique **40**; GH2 learnable items **46** (= 40 + default set bread/water/bandage/wet_rag_bundle/knife/pipe/chalk/note/ammo_9mm — chalk+ammo already in both)
- only OLD source-recipes missing from GH2 items: **[]** (empty)
- only GH2 extras vs old source refs: bread, knife, note, pipe, water, wet_rag_bundle (the default_survival_basics set — intentional)
- `kCraftSourceCount=24`, `kCraftRecipeCount=kItemCount=446`, suite_craft + gen_craft_table EXPECTED_SOURCE_ROWS=24 already pin
- craft recipes are per-item generated from items.csv composition (old CRAFT_RECIPES same model) — not a thin 24-row recipe list

### Verdict
CNT1 was "port real rows from old giga". Real rows already ported; GH2 is at/above reference. No code change. Proof = static parity audit (this section + shots/_probe_cnt1.py / _probe_cnt1b.py).
Next OPEN: PAR1 (travel re-grep) or PADIC gameplay stress.

## CLOSED 2026-07-31 PAR1 — travel seam re-grep after foreign main.cpp
Read-only audit of `src/app/main.cpp` (4860 lines / 274719 B) via `shots/_probe_par1.py`.
**No hole. No code change.**

### place_body_safely — both travel sites intact
| Site | Line | Path |
|------|------|------|
| keyboard `do_ride` lambda | **1952** | after propPlacer.populate; before save_run_now; return true |
| `--shot` travel (`--ride` / `--floor`) | **4798** | after noise_clear; comment at 4795 explicitly "Same place_body_safely as the keyboard ride path" |

### ai_release — both leave sites intact
| Site | Line | Path |
|------|------|------|
| keyboard `do_ride` leave | **1877** | `game::ai_release(reg, leaveLayer)` before unload |
| `--shot` travel leave | **4723** | same AIMEM leave release under `--shot --ride` |
| FloorStreamer::unload | comment 2324–2325 | documents third release site inside streamer |

### Other seams still wired (no regression)
- `do_ride` lambda @1851; keyboard +/- @2144/2146; `--floor` absolute hop @4694
- `combatCarves` queue + drain behind `!doors.frozen` @1684/3112–3172
- `playerStatus` / `status_step` / `--action status` intact
- `ctl->fly=false` @2293 (wall harness)
- `shotAction` wall/corp/status/save/load all present

### Foreign activity present but non-destructive to travel
- propPlacer ×7, light-grid ×20, GpuCull ×2 keywords in main.cpp
- Travel PBS + ai_release sites untouched by foreign WIP

### Verdict
PAR1 = re-grep after foreign main commits. Both PBS sites + both ai_release sites GREEN. No main.cpp edit. Re-run after next foreign main thrash.
Next OPEN: **PADIC** gameplay stress (`--floor 4`, doors/AI, stay off `src/render/**`).

## CLOSED 2026-07-31 PADIC — floor-module gameplay stress (off render)
```
runner: python C:\hades\gigahrush2\shots\_run_padic_proof.py
exe: build-win/Release/gigahrush2.exe --shot shots/shot_padic_play.png --frames 480 --floor 4 --action attack
cwd: repo root (textures resolve)
exit=0 elapsed=43.3s png=2.7MiB jpg=137117
PROOF=GREEN

stderr highlights:
  [cube] albedo: 6/6 ... normal: 6/6 ... roughness: 6/6 (mask 0xfc00)  ← TEX1 still holds on padic
  [aimem] STEP ... seen=419 (floor0 warmup) then LEAVE+RELEASE on hop
  [nav] bake ... 10 AI brains attached on floor 4 (161 agents wandering)
  [aimem] STEP tick=1020+ layer=0 seen=10 (padic AI live)
  shot: saved -> shot_padic_play.png (floor 4, 481 frames)
  floor autosave header refuse on stale slot (expected regenerate pristine) — non-fatal

Gates:
  floor4=True  tex_ok=True  ai_ok=True  brains=2  max_seen=419  tex_err=0  png_ok=True
```
Scope: game-agent exercises padic as engine stress sample (doors/AI/travel/tex load).
**Does NOT thrash src/render/** — stripes/ghost/UV remain Zhirnyak. Evidence JPEGs for him:
  shots/shot_padic_play.jpg (this run) + prior shots/shot_padic.jpg
No main.cpp / src/game code change this close — harness-only proof.
Next OPEN: P3 optional (RPG1/MAGSHOT/M4/SHOTLOG) or re-PAR1 after foreign main; keep pull/push loop.




