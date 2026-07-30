# BRIEFING — worker_game_audit

## Mission
Game-audit lane: find, pin, and fix real defects in `src/game/` and the travel/save seams in `src/app/main.cpp`. Keep suite_audit red=defect / green=pin honest. Do not stomp concurrent prop/render agents.

## Identity
- **Agent**: `worker_game_audit`
- **Dir**: `C:\hades\gigahrush2\.agents\worker_game_audit`
- **Repo**: `C:\hades\gigahrush2`
- **Shell**: `git -C C:\hades\gigahrush2`
- **Build**: `tools\win\build.bat` (Release); single-compiler owner — coordinate builds

## Done (do not re-do)
- [x] P2 loot-refill two-site trap closed — commit `702265d`
- [x] Pin `travel_keeps_opened_crates` in `tests/suite_audit.inl` (ledger entry 9 CLOSED)
- [x] CMake audit pin 74 → 140 checks, 0 failures
- [x] Keyboard `[`/`]` path already had capture/apply (pre-existing)
- [x] `--shot` path now has capture BEFORE `streamer.travel` + apply AFTER `refresh_floor_containers`
- [x] F5/F9 save path already used refresh/apply (pre-existing)
- [x] Engineering handoff written to this directory

## Hard constraints
1. **Path-limit git add** — only our files: `src/app/main.cpp` (surgical hunks only), `tests/suite_audit.inl`, `tests/audit_test.cpp`, `CMakeLists.txt` (audit pin line only). Never stage prop/embody/shader dirt.
2. **Foreign dirty — DO NOT TOUCH / DO NOT COMMIT AS OURS**:
   - `src/game/embody.cpp`
   - `src/render/prop_pass.cpp`, `prop_pass.h`, `prop_mesh.cpp`, `prop_placer.*`, `cube_pass.h`
   - `shaders/prop.frag`, `prop.vert`
   - `tests/suite_props.inl`, `suite_rpg.inl`, `world_test.cpp`
   - CMakeLists dirt beyond the audit PASS_REGULAR_EXPRESSION pin
   - main.cpp propPlacer.populate call sites (foreign wiring; leave intact)
3. **Surgical edits only** — Python or small search/replace; CRLF-safe; no whole-file rewrite of main.cpp.
4. **suite_audit ledger 1–9 ALL CLOSED** — next defects need fresh forensic read; do not invent RED findings.
5. **Pin bump**: every new CHECK in suite_audit requires CMake PASS_REGULAR_EXPRESSION update to match printed `audit_test: N checks, 0 failures`.

## Live call sites (main.cpp — line nums drift; re-grep)
| Site | Lines (approx) | capture | apply | notes |
|------|----------------|---------|-------|-------|
| keyboard `[`/`]` | ~955 / ~1003 | yes | yes | pre-702265d |
| F5/F9 save/load | ~1447 / ~1488 | yes | yes | save path |
| `--shot` travel | ~2238 / ~2268 | yes | yes | **702265d** |
| propPlacer.populate | ~626,690,1015,2284 | n/a | n/a | FOREIGN — leave |

## API reminder (`src/game/save.h`)
```cpp
struct OpenedContainerKey { int16_t floor; uint8_t cx,cy,cz,pad_; }; // 6B, NO entity id
size_t refresh_opened_containers(Registry&, LayerId, int floorNumber, vector<OpenedContainerKey>&);
size_t apply_opened_containers(Registry&, LayerId, int floorNumber, const OpenedContainerKey* keys, size_t n, const vec3* openedColour=nullptr);
```
Seed formula: `0xC0FFEE ^ floor*0x9e3779b9`, cap 64.

## Fix pattern (both travel sites)
```
// BEFORE travel:
refresh_opened_containers(reg, leaveLayer, currentFloor, runState.opened);
// travel + refresh_floor_containers(...)
// AFTER respawn:
apply_opened_containers(reg, nl, currentFloor, runState.opened.data(), runState.opened.size());
```

## Next actions (priority order)
1. **Multi-site travel parity grep** — confirm every `streamer.travel` has capture/apply; no third site without it.
2. **Evaluate worker_m4 leftovers** — Utility AI / monster port; only if unowned and in game/ scope.
3. **Fresh forensic** of `src/game/` for a NEW finding → pin in suite_audit → fix → path-limited commit.
4. **Do NOT** chase prop_placer stacking / floodlamp / acid rng — explorer_m3_1 / worker_m1_1 / orchestrator_7.
5. **Do NOT** touch XP/embody (`c620fbf` and dirty embody.cpp) — foreign.

## Read-first list
- `handoff.md` (this lane, full report)
- `src/game/save.h` (OpenedContainerKey + API)
- `tests/suite_audit.inl` (ledger 1–9 + travel_keeps_opened_crates)
- `src/app/main.cpp` — grep `refresh_opened_containers|streamer.travel|refresh_floor_containers`
- `git show 702265d`
- `git status -sb` before any commit (foreign dirt map)

## Verification
```cmd
git -C C:\hades\gigahrush2 show 702265d --stat
tools\win\build.bat Release
ctest --test-dir build-win -C Release -R audit_findings --output-on-failure
```
Expect: `audit_test: 140 checks, 0 failures` until new CHECKs land.
