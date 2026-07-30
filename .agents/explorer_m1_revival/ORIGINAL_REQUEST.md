## 2026-07-30T04:00:19Z

You are teamwork_preview_explorer for Gigahrush2 Milestone 1 Revival (MobBehaviour Dispatchers & Test Coverage).

Working Directory: `C:\hades\gigahrush2\.agents\explorer_m1_revival\`
Project Root: `C:\hades\gigahrush2`

CRITICAL INSTRUCTION: DO NOT READ `.agents/orchestrator/plan.md` OR ANY OLD PLAN FILES IN `.agents/`. They belong to an old, finished wave.
Your scope is EXCLUSIVELY defined by `C:\hades\gigahrush2\.agents\orchestrator_2\ORIGINAL_REQUEST.md` (Requirement R1).

Task:
1. Read `C:\hades\gigahrush2\.agents\orchestrator_2\ORIGINAL_REQUEST.md`.
2. Inspect `src/game/combat.h`, `src/game/combat.cpp`, `src/game/mob_behaviour.hpp`, `tests/suite_behaviours.inl`, `tests/game_test.cpp`, `tests/suite_monster.inl`, and `tests/suite_audit.inl`.
3. Analyze requirement R1:
   - Wire `behaviour_incoming_mult` for defender mitigation in `apply_damage` (`src/game/combat.cpp`).
   - Wire `facing_damage_mult` and `burst_damage_mult`.
   - Update `tests/suite_behaviours.inl` with explicit assertions for each behavior effect.
4. Produce a clear, comprehensive handoff report at `C:\hades\gigahrush2\.agents\explorer_m1_revival\handoff.md` detailing:
   - Current code status and uncommitted changes in `src/game/` and `tests/`
   - Exact code modifications needed in `apply_damage` in `src/game/combat.cpp`
   - Exact test assertions needed in `tests/suite_behaviours.inl`
   - Step-by-step implementation strategy for the worker.
5. Send a message to parent when done referencing `handoff.md`.
