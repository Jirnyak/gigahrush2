## 2026-07-30T03:59:47Z
You are teamwork_preview_explorer for Gigahrush2 Milestone 1 (MobBehaviour Dispatchers & Test Coverage).

Working Directory: `C:\hades\gigahrush2\.agents\explorer_m1_next\`
Project Root: `C:\hades\gigahrush2`

Target & Instructions:
1. Investigate requirement R1: Wire `behaviour_incoming_mult` for defender mitigation in `apply_damage` (`src/game/combat.cpp`), `facing_damage_mult`, and `burst_damage_mult`.
2. Inspect uncommitted changes in `src/game/combat.h`, `src/game/combat.cpp`, `src/game/mob_behaviour.hpp`, `tests/suite_behaviours.inl`, `tests/game_test.cpp`, `tests/suite_monster.inl`, and `tests/suite_audit.inl`.
3. Determine what is currently implemented, what is missing or incomplete, and what specific code/test updates are needed in `src/game/combat.cpp` and `tests/suite_behaviours.inl`.
4. Produce a detailed handoff report at `C:\hades\gigahrush2\.agents\explorer_m1_next\handoff.md` with:
   - Analysis of current uncommitted state
   - Exact locations and logic required for `behaviour_incoming_mult`, `facing_damage_mult`, and `burst_damage_mult`
   - Explicit assertion requirements for `tests/suite_behaviours.inl`
   - Recommended implementation strategy for the worker.
5. Send a summary message to parent once done referencing `handoff.md`.
