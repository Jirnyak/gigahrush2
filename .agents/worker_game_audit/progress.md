# progress.md — worker_game_audit

## Checked (this / prior session)
- [x] Restore session context from packet / compact summary
- [x] Verify commit `702265d` exists and touches only audit files + main.cpp shot site
- [x] Map live main.cpp call sites (keyboard / F5-F9 / --shot / propPlacer foreign)
- [x] Confirm suite_audit ledger 1–9 CLOSED; pin travel_keeps_opened_crates present
- [x] Confirm save.h OpenedContainerKey API (6B, no entity id)
- [x] Map foreign dirty WT (prop swarm, embody, CMake beyond audit pin)
- [x] Create `.agents/worker_game_audit/`
- [x] Write ORIGINAL_REQUEST.md, BRIEFING.md, handoff.md, progress.md

## Unchecked — next session
- [ ] Re-grep all `streamer.travel` sites for capture/apply parity (line drift)
- [ ] `git status -sb` + classify every dirty path as ours vs foreign before edits
- [ ] Forensic pass over `src/game/` for a new defect (ledger is empty of RED)
- [ ] If finding: pin in suite_audit.inl + bump CMake 140→N + surgical fix + path-limited commit
- [ ] Optionally evaluate worker_m4_1 leftovers if unowned and game-scoped
- [ ] Do not stage/commit prop_*, embody.cpp, shaders/prop.*, suite_props, suite_rpg, world_test

## Repo snapshot at handoff write (2026-07-30)
- HEAD: `67fdf52` feat(render): dedicated prop.frag …
- Our commit: `702265d` fix(game): capture/apply opened crates on --shot travel path
- Branch: main ahead of origin by 6
- audit pin: 140 checks, 0 failures
