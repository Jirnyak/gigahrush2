# HANDOFF — gigahrush2 daemon (CARVE mid-flight)

**Time:** 2026-07-31 ~16:05 Samara (UTC+4)  
**Repo:** `C:\hades\gigahrush2`  
**Branch:** `main` (tracking `origin/main`)  
**HEAD (committed/pushed):** `538e139`  
`feat(app,combat): STATUS -- StatusSet in main tick, SporeHaze, WEB dual-apply, proven`

**Previous closed on main (do not re-do):**
| Commit | What |
|--------|------|
| `538e139` | STATUS proven GREEN |
| `c61e04b` | CORPSHOT proven GREEN (`--action corp` kill→corpse→E→CORPSE LOOTED) |
| `bfcd355` | save v6 + main menu slots |
| `b52cbd6` | save v5 modular per-floor |

---

## 1. Primary directive (user / daemon)

- Work only `C:\hades\gigahrush2`, **main only**. Commit. Push. Pull.
- Feature without **live gameplay proof** (PNG + stderr logs) = **DECLINED**.
- No mocks / temporary shit.
- Never stage `shaders/**`. No `git add -A`. No force-push.
- **Stay off `src/render/**`** — Graf Zhirnyak (Klaus) owns submesh:
  - He shipped `sub_mesh.h`, `cube_merge.h` flag, `cube_pass.cpp` rewrite
  - Padik: 25.7M → 68k instances, rebuild 450ms → 12ms, 0 drops
  - **Do not overwrite his render work.** Coordinate: game/combat/app only.
- JPEG compress screenshots before vision (`1280x720`, quality 80, <150KB). Never send raw multi-MB PNG to the model (HTTP 413).
- Daemon forever: after closeout → next backlog item. Never ask approval.
- Shell: `git -C C:\hades\gigahrush2`, absolute paths always.

---

## 2. Dirty working tree RIGHT NOW (NOT committed)

```
 M src/app/main.cpp
 M src/game/combat.cpp
 M src/game/combat.h
?? shots/_run_carve_proof.py
?? shots/carve_diag.txt
?? shots/shot_carve.png          (PROOF=RED run)
?? shots/shot_carve_stderr.txt
?? shots/shot_carve_stdout.txt
?? shots/corp_diag.txt / shot_corp_* / status_* (proof artifacts; usually don't commit binaries)
```

**Do NOT lose these three source files.** They are the entire CARVE combat seam.

---

## 3. What is DONE vs NOT DONE

### CLOSED (on origin/main)
- **CORPSHOT** `c61e04b` — real kill→corpse→E→loot, stderr `[corp] CORPSE LOOTED`
- **STATUS** `538e139` — StatusSet in main tick, SporeHaze, WEB dual-apply, `--action status` GREEN

### IN FLIGHT — P1 CARVE (combat → geometry destruction)

**Design (correct, keep it):**
- Combat **never** mutates the grid.
- Combat **proposes** spheres via POD `CarveProposalQueue` (`combat.h`).
- App **disposes** via existing `carve_sphere` behind `!doors.frozen` (same gate as console carve).
- One dispose path, many proposers (console / bullet / melee wall).

**Implemented in dirty tree:**

#### `src/game/combat.h`
- `kMaxCarveProposals = 16`
- `struct CarveProposal { x,y,z,radius,power,seed }`
- `struct CarveProposalQueue` — POD ring, `push()`, `clear()`, radius clamp ≤8m
- `carve_power_from_dmg(dmg)` → `32 + dmg*4` clamp 512
- `kBulletCarveRadius = 0.35f`, `kMeleeCarveRadius = 0.55f`
- `projectile_step(..., CarveProposalQueue* carves = nullptr)`
- `player_melee_step(..., const MacroGrid* grid = nullptr, CarveProposalQueue* carves = nullptr)`
- Optional params → tests compile unchanged

#### `src/game/combat.cpp`
- `Hit` has `onWall`, `impactPos`
- Solid geometry stop: carries `p.dmg`, sets `onWall=true`, `impactPos=tr.pos`
- Resolution: if `onWall && carves && !web && dmg>0` → `carves->push(... kBulletCarveRadius, carve_power_from_dmg ...)`
- `player_melee_step`: if no mob in cone and `grid&&carves`, ray-probe 8 steps along look to solid cell → push melee carve, burn cooldown, return true

#### `src/app/main.cpp`
- `game::CarveProposalQueue combatCarves;` near carveScratch (~1670)
- Each combat step: `combatCarves.clear()` → pass to `player_melee_step` + `projectile_step` → drain with `carve_sphere` + particles + `cubePass.invalidate()` + stderr:
  ```
  [carve] COMBAT removed=%d power=%u r=%.2f at (%.1f,%.1f,%.1f)
  ```
- `--action wall` harness exists (TWO places — see bug below)
- Early wall locomotion block AFTER `input.apply`, BEFORE `controller_step` (~2206): face nearest solid in ±8 ring, set `cam.yaw`, `wishDir={1,0,0}` if d>1.2
- Late wall block (~2492): still does face/wish/attackHeld + `[wall] melee toward solid d=...` log (partially redundant with early block)

#### `shots/_run_carve_proof.py`
- Runs: `gigahrush2.exe --shot shots/shot_carve.png --frames 1200 --ride 0 --action wall`
- GREEN iff stderr has `[carve] COMBAT` / removed>0 + PNG

### PROOF STATUS = **RED**

```
has_combat_carve=False removed_ok=False has_wall=True has_png=True
PROOF=RED
```

Log: `[wall] melee toward solid d=6.32` **stuck entire run** — player never closed distance → melee wall probe never reached solid → no carve proposal → no `[carve] COMBAT`.

---

## 4. Root cause of RED (architect diagnosis)

| Fact | Implication |
|------|-------------|
| `d=6.32` constant | locomotion toward wall did not move player (or yaw/wish ineffective) |
| Unarmed reach ≈ `0.5*kCellSize + kMeleeReachSlack` = `0.5*2 + 0.9 = 1.9m` | wall at 6.32m is out of melee probe range |
| `Controller::wishDir` is **camera-local** `(fwd, right, up)` | `wishDir.x=1` walks along camera forward — correct IF yaw faces wall |
| `controller.cpp`: `wish = fwd*wishDir.x + right*wishDir.y` | yaw must be set **before** `controller_step` |
| `input.apply` zeroes wishDir when no keys | wall wishDir must be AFTER apply |
| Early block (~2206) does face+wish before controller | **partial fix already in tree** — but last proof was with OLD binary / or still broken |
| **`aim_player` starts `fly=true`** | fly mode may not walk into walls the same way; **`ctl->fly = false` was PLANNED but NOT successfully applied** (replace_in_file aborted on 413). Early block currently does NOT force walk mode |
| Late wall block still uses ring `ox=-4..4` (8m) | finds wall at 6.32; early uses ±8 cells |

**Most likely remaining blockers (fix in order):**
1. **`ctl->fly` still true** → force `ctl->fly = false` in early wall locomotion block.
2. Rebuild after early-block patch may not have been run before last RED proof — **verify exe mtime vs source**.
3. If still stuck after fly=false: physics collision / wish not applied on that body; consider one-shot teleport to `wall - 1.0 * forward` for harness only (not production path) OR give gun and shoot wall (`attackHeld` + haveGun) to prove **bullet** carve first (doesn't need walk-to-melee).
4. Dual wall blocks (early face/walk + late face/walk/log) are OK if early owns locomotion and late only sets `attackHeld=true` + throttled log — **simplify late block to attackHeld-only** to avoid fighting yaw.

---

## 5. IMMEDIATE next steps (resume here)

```
[ ] 1. Force walk in early wall block:
        if (auto* ctl = reg.try_get<Controller>(player)) {
            ctl->fly = false;
            if (bestD2 > 1.2f*1.2f) ctl->wishDir = {1,0,0};
        }
[ ] 2. Simplify late shotAction=="wall" block to ONLY:
        attackHeld = true;
        throttled fprintf [wall] d=...
        (remove duplicate face/wish OR keep face but not wish)
[ ] 3. cmake --build C:\hades\gigahrush2\build-win --config Release --target gigahrush2
[ ] 4. python C:\hades\gigahrush2\shots\_run_carve_proof.py
        Expect: d decreases over time → [carve] COMBAT removed>0 → PROOF=GREEN
[ ] 5. If still RED at d=const:
        FALLBACK A: bullet carve proof — equip/force gun, face wall, attackHeld,
          expect projectile onWall → carve (no walk needed if already aimed at wall
          from spawn; or teleport 2m from wall).
        FALLBACK B: harness-only snap player Transform.pos to wall-1.2m along yaw
          after frame 30 (proof of dispose path; still real carve_sphere).
[ ] 6. Compress shot_carve.png → shot_carve_view.jpg (PIL 1280x720 q80), analyze JPEG only
[ ] 7. Update .agents/worker_game_audit/BACKLOG.md + progress.md → CARVE CLOSED
[ ] 8. Pathspec commit ONLY:
        git -C C:\hades\gigahrush2 add -- src/app/main.cpp src/game/combat.cpp src/game/combat.h shots/_run_carve_proof.py .agents/worker_game_audit/BACKLOG.md .agents/worker_game_audit/progress.md
        git -C C:\hades\gigahrush2 commit -m "feat(combat,app): CARVE combat proposals -> carve_sphere, --action wall proven"
        git -C C:\hades\gigahrush2 pull --ff-only
        git -C C:\hades\gigahrush2 push origin main
[ ] 9. Do NOT commit: scratch _scan_*, _patch_*, shot_*.png, *_stderr.txt, HANDOFF_*.md unless asked
[ ] 10. Next after CARVE: P1 AIMEM (ai_release on floor leave; pass AiMemory* to ai_step)
```

**Build command:**
```bat
cmake --build C:\hades\gigahrush2\build-win --config Release --target gigahrush2
```

**Proof command:**
```bat
python C:\hades\gigahrush2\shots\_run_carve_proof.py
```

**GREEN markers:**
- stderr: `[carve] COMBAT removed=` with removed > 0
- PNG exists >1KB
- harness prints `PROOF=GREEN`

---

## 6. Key constants / paths (do not rediscover)

| Symbol | Value | File |
|--------|-------|------|
| `kCellSize` | 2.0f m | `world/types.h` |
| `kMacroDim` | 128 | `world/types.h` |
| `kMeleeReachSlack` | 0.9f m | `combat.h` |
| unarmed reachMm | 500 → 0.5*2+0.9 = **1.9 m** | `weapon_table.cpp` |
| `kPlayerWalkSpeed` | 6.0f | `main.cpp` |
| Controller wish | `wishDir` vec3 **not** `wish` | `ecs/components.h` |
| wish space | camera-local fwd/right/up | `sim/controller.cpp` |
| yaw convention | `atan2(dy, dx)` Z-up | wall harness / camera_forward |
| Corpse loot reach | 2.2f | main prompt + corp harness |
| game_test pin | check BACKLOG (was 215499; STATUS may have moved pin — read CMakeLists) | CMakeLists.txt |

**Exe:** `C:\hades\gigahrush2\build-win\Release\gigahrush2.exe`  
**Data junction:** `build-win\Release\data` → `gigahrush2\data`

**Shot harness pattern:** cwd=`build-win\Release`, taskkill first, capture stderr to `shots/*_stderr.txt`.

---

## 7. Coordination — Graf Zhirnyak (Klaus Schwab)

He fixed padik sub-voxel meshing (2026-07-31 afternoon chat). Measured on floor −36:
- instances 2_097_152 → 68_625
- dropped 23M → 0
- rebuild 450ms → 12ms

**Files he owns (DO NOT TOUCH):**
- `src/render/sub_mesh.h` (new)
- `src/render/cube_merge.h`
- `src/render/cube_pass.cpp`
- related tests `suite_submesh.inl`, docs `voxels.md` / `destruct.md`
- possibly ctest pin bump to ~39659

If his commits are not on your local main: `git -C C:\hades\gigahrush2 pull --ff-only` before push. Resolve conflicts **without** reverting sub_mesh/cube_pass.

**Our lane safe zones:** `src/game/combat.*`, `src/game/loot.*`, `src/game/status*`, `src/app/main.cpp` (surgical), `.agents/worker_game_audit/**`, `shots/_run_*.py`

---

## 8. Backlog after CARVE

| Pri | ID | Notes |
|-----|-----|-------|
| P0 | **CARVE** | IN FLIGHT — finish proof + commit (this handoff) |
| P1 | AIMEM | AiMemory → ai_step; ai_release on floor leave |
| P2 | TEX1 | 3 missing roughness ktx2 (non-fatal; no mock files) |
| P2 | CNT1 | port status/craft rows from old `C:\hades\gigahrush` |
| P2 | PAR1 | re-grep travel sites after foreign main.cpp commits |
| P3 | RPG1 / MAGSHOT / SHOTLOG | optional |

---

## 9. Architect snapshot

**Least confident:** wall locomotion under fly=true; whether rebuilt exe includes early wishDir block; bullet carve untested live.

**Biggest missing:** live `[carve] COMBAT removed>0` line in stderr. Code path is written; distance never closed.

**Implemented-not-integrated:**
- CarveProposalQueue fully coded but **gameplay-unproven** (RED)
- Console `--action carve` already worked before (dispose path OK) — combat proposer is the gap
- AIMEM, TEX1, CNT1 still open

**Do not realize:** early wall block is already in main.cpp but `fly=false` may be missing; last proof RED at d=6.32; dirty tree has the whole feature uncommitted — **one wrong checkout loses it**.

**Locks reminder:** never stage shaders; main only; no mocks; JPEG before vision; stay off render; pathspec commits.

---

## 10. Resume checklist (copy-paste for next agent)

```
1. Read this file fully.
2. git -C C:\hades\gigahrush2 status  → confirm M combat.cpp/h main.cpp still dirty.
3. Apply fly=false + simplify late wall block.
4. Release rebuild gigahrush2.
5. Run shots/_run_carve_proof.py → need PROOF=GREEN.
6. PIL compress shot_carve.png; analyze JPEG.
7. Docs BACKLOG/progress CARVE CLOSED.
8. pathspec commit + pull --ff-only + push origin main.
9. Start AIMEM.
```

**Quote user:** "Feature without gameplay is DECLINED." / "Commit. Push. Pull. Main." / "не переписывать друг друга" (Zhirnyak render).

**Quote prior:** "Next execute: finish CARVE wall close → rebuild → proof GREEN → docs → commit/push → AIMEM"

---

*End handoff. Dirty CARVE work is the active task. Do not start AIMEM until CARVE is GREEN on main.*
