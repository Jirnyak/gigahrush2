# ORIGINAL_REQUEST — worker_game_audit

## User intent chain
1. P2 loot-refill (opened crates refill on elevator return) — DONE in commit `702265d`.
2. User: «ралтай дальше» — max effort on remaining game-audit defects.
3. User: «хендофф пиши» / «хендофф пиши даун» — write proper engineering handoff NOW (not sentinel/orchestrator_7 prop swarm).

## Session packet constraints
- Done: `702265d` fix(game): capture/apply opened crates on `--shot` travel path
- Files committed only: `src/app/main.cpp`, `tests/suite_audit.inl`, `tests/audit_test.cpp`, `CMakeLists.txt`
- ctest `audit_findings`: `audit_test: 140 checks, 0 failures` (was 74)
- Keyboard path already had capture/apply; shot path was the two-site trap — fixed
- DO NOT TOUCH foreign dirty: `.agents/*` (other), `src/game/embody.cpp`, `src/render/prop_pass.cpp`, `shaders/prop.frag`
- Shell: `git -C C:\hades\gigahrush2`; build: `tools\win\build.bat`
- Sentinel handoff only tracks orchestrator_7 recovery — NOT game work
- Next session MUST:
  1. Write engineering handoff (this dir)
  2. Continue max effort from BRIEFING/audit remaining defects without stomping other agents
  3. Surgical Python/CRLF-safe edits only — no whole main.cpp rewrite

## Lane identity
- Agent dir: `.agents/worker_game_audit/`
- Owns: game-audit findings, suite_audit pins, travel/crate/save seams in main.cpp (path-limited)
- Does NOT own: prop_pass, prop_placer, prop.frag, suite_props, embody XP wiring, material chroma
