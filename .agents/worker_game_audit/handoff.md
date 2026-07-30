# Handoff Report — worker_game_audit

**Agent**: `worker_game_audit`  
**Working Directory**: `C:\hades\gigahrush2\.agents\worker_game_audit`  
**Lane**: Game audit (`src/game` defects + travel/save crate seams) — **NOT** prop/orchestrator_7 swarm  
**Date**: 2026-07-30  

---

## 1. Observation

### 1.1 Shipped fix — commit `702265d`
```
702265d fix(game): capture/apply opened crates on --shot travel path
 CMakeLists.txt        |  4 +--
 src/app/main.cpp      | 15 ++++++++
 tests/audit_test.cpp  |  1 +
 tests/suite_audit.inl | 96 +++++++++++++++++++++++++++++++++++++++++++++++++++
 4 files changed, 114 insertions(+), 2 deletions(-)
```

**Defect (two-site trap):**  
`refresh_floor_containers` destroys every `Container` on the arrival `LayerId` and respawns from seed `0xC0FFEE ^ floor*0x9e3779b9` (cap 64). That is correct for a first visit. A **return** visit must re-empty crates whose `OpenedContainerKey` was captured on the way out — otherwise loot → elevator → return is a free refill.

There are **two** interactive travel sites in `main.cpp`:
1. **Keyboard** `[` / `]` — already called `refresh_opened_containers` BEFORE `streamer.travel` and `apply_opened_containers` AFTER `refresh_floor_containers`.
2. **`--shot` automated ride** — called travel + refresh_floor_containers **without** capture/apply. That was the live hole.

F5/F9 save/load already used the same API for the byte round-trip; saveload tests cover that path. The missing pin was the **in-memory destroy+respawn seam** shared by keyboard and shot.

### 1.2 Live call sites (re-grepped 2026-07-30; line nums drift)
| Symbol | Lines | Role |
|--------|-------|------|
| `refresh_floor_containers` def | ~292 | destroy+respawn crates |
| `propPlacer` member | ~481 | FOREIGN prop wiring |
| `propPlacer.populate` | ~626, ~690, ~1015, ~2284 | FOREIGN — do not edit as ours |
| keyboard capture | ~955 | `refresh_opened_containers` before travel |
| keyboard `streamer.travel` | ~958 | |
| keyboard refresh_floor | ~998 | |
| keyboard apply | ~1003 | `apply_opened_containers` |
| F5/F9 capture | ~1447 | |
| F5/F9 apply | ~1488 | |
| **--shot capture** | **~2238** | **added in 702265d** |
| --shot `streamer.travel` | ~2241 | |
| --shot refresh_floor | ~2264 | |
| **--shot apply** | **~2268** | **added in 702265d** |

### 1.3 API (`src/game/save.h`)
```cpp
struct OpenedContainerKey {
    int16_t floor;   // in-game floor number, never LayerId
    uint8_t cx, cy, cz;
    uint8_t pad_;    // 6 B total; NO entity id (ids recycle)
};
static_assert(sizeof(OpenedContainerKey) == 6);

size_t refresh_opened_containers(Registry&, LayerId, int floorNumber,
                                 std::vector<OpenedContainerKey>& set);
// drop keys for floorNumber, re-scan opened crates on layer, append

size_t apply_opened_containers(Registry&, LayerId, int floorNumber,
                               const OpenedContainerKey* keys, size_t n,
                               const vec3* openedColour = nullptr);
// AFTER spawn_floor_containers; re-open + empty matched crates
```

Key is (floor, macro cell). Expected collision ~13% of Residential floors → one crate lost, never item dupe. Strong fix would be `spawnIndex` on `Container` — not this lane's header to own.

### 1.4 Pin contract
- Test: `audit_test::travel_keeps_opened_crates` in `tests/suite_audit.inl`
- Flow: spawn → open every 3rd → capture (+ foreign-floor key) → destroy all Container → respawn same seed → apply → assert emptied + foreign key survived refresh
- CMake: `PASS_REGULAR_EXPRESSION "audit_test: 140 checks, 0 failures"`
- `tests/audit_test.cpp`: `#include "game/save.h"`
- Ledger entry **9. travel_keeps_opened_crates — CLOSED**

### 1.5 suite_audit ledger (all CLOSED / green pins)
| # | Name | Status |
|---|------|--------|
| 1 | projectile_once | CLOSED pin (SelfIntegrating) |
| 2 | ms_timer_drift | CLOSED pin (125 Hz) |
| 3 | gun_kills_counted | CLOSED pin |
| 4 | ammo_has_a_source | CLOSED pin |
| 5 | descend_not_free | CLOSED pin |
| 5b | descend_same_target_once | CLOSED pin |
| 6 | hunt_is_findable | CLOSED pin |
| 7 | stack_max_respected | CLOSED pin |
| 8 | giver_slot_recycled | CLOSED pin (NpcHandle) |
| 9 | travel_keeps_opened_crates | CLOSED pin (**702265d**) |
| — | budget_vs_demo_cap | GREEN pin (documents kMobSpawnCap truncation; defect in main policy, not red finding) |

**Zero deliberately-red findings remain.** Next work = fresh forensic discovery, not finishing an open ledger item.

### 1.6 Repo state at handoff
- HEAD: `67fdf52` feat(render): dedicated prop.frag shader…
- main **ahead of origin by 6**
- Our commit sits under prop commits: `702265d` then prop_pass / prop.frag work
- Working tree heavily dirty with **foreign** prop/embody/agent files

### 1.7 Foreign dirty — DO NOT TOUCH / DO NOT COMMIT AS OURS
| Path | Owner / note |
|------|----------------|
| `src/render/prop_pass.*`, `prop_mesh.cpp`, `prop_placer.*` | prop swarm (worker_m1_1, explorer_m3_1, orchestrator_7) |
| `shaders/prop.frag`, `prop.vert` | prop R1–R4 |
| `src/render/cube_pass.h` | prop-related |
| `src/game/embody.cpp` | XP / body path (c620fbf + dirty) |
| `tests/suite_props.inl`, `suite_rpg.inl`, `world_test.cpp` | other lanes |
| `CMakeLists.txt` beyond audit pin | world_test links prop sources; pins 22618/213879 area |
| `main.cpp` propPlacer.populate sites | foreign wiring left in place; our hunks are only opened-crate capture/apply |
| `.agents/*` other workers | never rewrite other agents' packets |

### 1.8 Concurrent agents (do not stomp)
- **orchestrator_7** — prop recovery R1–R4 active
- **explorer_m3_1** — prop_placer defects (stacking, floodlamp `||`, acid `rng&1`, populate coverage) = FOREIGN
- **worker_m1_1** — prop mesh + placer handoff exists; owns those files
- **worker_m4 / worker_m4_1** — Utility AI / monster port; may be stale unowned — evaluate only if still game-scoped and unowned
- **worker_m1** material chroma — foreign
- **sentinel** — tracks orchestrator_7 recovery, **not** game-audit work

---

## 2. Logic Chain

1. **Why capture must be BEFORE travel**  
   Only one floor is resident. Opened crates on the floor being left exist as live ECS entities only until unload. `refresh_opened_containers` rewrites the in-memory key set for that floor number from the registry. After travel those entities are gone.

2. **Why apply must be AFTER `refresh_floor_containers`**  
   Respawn creates new entities with `opened=false` and full loot. `apply_opened_containers` matches keys by (floor, cell), sets opened, empties slots. Apply-before-spawn is a no-op.

3. **Why no entity id in the key**  
   EnTT recycles handles; streamer destroys/recreates crates every visit. Generator is deterministic in (floorNumber, seed) → same cell → same crate identity for persistence.

4. **Why two call sites were a trap**  
   Keyboard path was fixed earlier; `--shot` is a separate code path that also calls `streamer.travel` + `refresh_floor_containers`. Fixing one site without grepping the other leaves the bug in automated/CI visual runs.

5. **Why the pin does not use FloorStreamer**  
   Isolates the destroy+respawn seam (spawn → open → capture → destroy → respawn → apply). Saveload tests already cover F5/F9 bytes. Avoids coupling audit_test to the full streamer stack.

6. **Why ledger is all green and that matters**  
   suite_audit value = red means live defect. Keeping CLOSED entries inverted as pins preserves tripwires. Inventing red without a real bug teaches readers to ignore red.

---

## 3. Caveats

1. **Path-limit `git add`** — WT has dozens of foreign modifications. Never `git add -A` or `git add src/app/main.cpp` without reviewing the diff hunks. Prefer:
   ```cmd
   git -C C:\hades\gigahrush2 add tests/suite_audit.inl tests/audit_test.cpp
   git -C C:\hades\gigahrush2 add -p src/app/main.cpp
   git -C C:\hades\gigahrush2 add -p CMakeLists.txt
   ```
   Stage only audit pin lines in CMake and only capture/apply hunks in main.cpp.

2. **Line number drift** — propPlacer and other agents insert lines in main.cpp. Always re-grep; do not trust this handoff's absolute lines after further commits.

3. **Pin bump math** — new CHECKs change the printed count. CMake `PASS_REGULAR_EXPRESSION` must match exactly or ctest fails even when tests pass.

4. **CRLF** — Windows repo; use Python writes with newline handling or editors that preserve CRLF. No whole-file rewrite of main.cpp.

5. **Single-compiler owner** — do not fight prop lane for `build-win`. Coordinate or build when free.

6. **main.cpp is multiply dirty** — our 702265d hunks coexist with uncommitted propPlacer.populate calls. Diff carefully; do not revert foreign lines while editing.

7. **budget_vs_demo_cap** — green pin documenting silent mob cap truncation on deep floors. Raising `kMobSpawnCap` is a design/policy change in main.cpp, not a silent one-line "fix" without product intent.

8. **Cell-key collision** — known ~13% Residential; do not "fix" by stuffing entity ids into OpenedContainerKey.

---

## 4. Conclusion

**P2 loot-refill is done.** Both keyboard and `--shot` travel paths capture opened crates before `streamer.travel` and apply after `refresh_floor_containers`. Pin `travel_keeps_opened_crates` witnesses the seam (140 audit checks, 0 failures). suite_audit findings 1–9 are all CLOSED pins.

**This lane's next job is not prop work.** Prop mesh/placer/shader defects are owned by worker_m1_1 / explorer_m3_* / orchestrator_7. Game-audit continues with: (A) travel-site parity re-grep, (B) optional worker_m4 scope check, (C) fresh forensic read of `src/game/` for a new pinned finding, (D) surgical path-limited commits only.

---

## 5. Next session MUST

| Pri | Action | Notes |
|-----|--------|-------|
| A | Multi-site travel parity | `findstr /n "streamer.travel refresh_opened_containers apply_opened_containers" src\app\main.cpp` — every travel must pair capture+apply |
| B | worker_m4 leftovers | Peek `.agents/worker_m4_1/` — take only if unowned + `src/game` scope |
| C | XP/embody | **Foreign** (`embody.cpp`, c620fbf) — do not touch |
| D | New forensic | Read `src/game/*.cpp` for a real defect; pin then fix; bump 140→N |
| E | Not props | No prop_pass, prop_placer, prop.frag, suite_props |

### Edit / commit recipe
```cmd
git -C C:\hades\gigahrush2 status -sb
git -C C:\hades\gigahrush2 diff -- src/app/main.cpp tests/suite_audit.inl
REM surgical edit via Python or search_replace — CRLF safe
tools\win\build.bat Release
ctest --test-dir build-win -C Release -R audit_findings --output-on-failure
git -C C:\hades\gigahrush2 add tests/suite_audit.inl tests/audit_test.cpp
git -C C:\hades\gigahrush2 add -p src/app/main.cpp
git -C C:\hades\gigahrush2 add -p CMakeLists.txt
git -C C:\hades\gigahrush2 commit -m "fix(game): <one-line defect>"
```

### Verification commands
```cmd
git -C C:\hades\gigahrush2 show 702265d --stat
git -C C:\hades\gigahrush2 log --oneline -8
findstr /n "refresh_opened_containers apply_opened_containers streamer.travel" C:\hades\gigahrush2\src\app\main.cpp
tools\win\build.bat Release
ctest --test-dir build-win -C Release -R audit --output-on-failure
```

---

## 6. Artifact index

| File | Purpose |
|------|---------|
| `.agents/worker_game_audit/ORIGINAL_REQUEST.md` | User intent chain + packet constraints |
| `.agents/worker_game_audit/BRIEFING.md` | Cold-start mission for next agent |
| `.agents/worker_game_audit/handoff.md` | This report |
| `.agents/worker_game_audit/progress.md` | Checklist |
| `src/game/save.h` | OpenedContainerKey + refresh/apply API |
| `src/app/main.cpp` | Travel sites (~955/1003, ~2238/2268), F5/F9 (~1447/1488) |
| `tests/suite_audit.inl` | Ledger + travel_keeps_opened_crates |
| `tests/audit_test.cpp` | TU driver + save.h include |
| `CMakeLists.txt` | audit_test PASS_REGULAR_EXPRESSION 140 |
| commit `702265d` | Canonical shipped fix |

---

## 7. Fix pattern (copy-paste for any new travel site)

```cpp
// BEFORE streamer.travel — while leaveLayer still has live crates:
game::refresh_opened_containers(reg, leaveLayer, currentFloor, runState.opened);

game::RideResult ride = streamer.travel(/* ... */);

// AFTER arrival crates exist:
refresh_floor_containers(reg, stack.layer(nl), /* floor */, nl);
game::apply_opened_containers(
    reg, nl, currentFloor,
    runState.opened.data(), runState.opened.size());
// do not remove foreign propPlacer.populate if present — not our line to delete
```
