# BRIEFING — 2026-07-29T23:26:00Z

## Mission
Implement Utility AI activation in `src/app/main.cpp` and finish porting remaining monster systems (pack target sharing, wet terrain queries & traits, counterplay mechanics) in `src/game/combat.cpp` / `mob_behaviour.h`.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: C:\hades\gigahrush2\.agents\worker_m4
- Original parent: 270e6be6-8a5b-4297-9101-9029a85f796f
- Milestone: Milestone 4 - Utility AI Activation & Monster Systems Porting

## 🔒 Key Constraints
- Code modification: minimal changes, high quality, no hardcoding, genuine implementation.
- All tests must pass: `world_test`, `audit_test`, `game_test`, `source_rules`.
- Zero compiler errors/warnings, 100% green ctest.

## Current Parent
- Conversation ID: 270e6be6-8a5b-4297-9101-9029a85f796f
- Updated: 2026-07-29T23:26:00Z

## Task Summary
- **What to build**:
  1. Utility AI activation in `src/app/main.cpp` (`aiCfg.enabled`, `hysteresis`, `memory`, `ai_init`, `ai_release`, `ai_step(&aiMemory)`).
  2. Pack behavior target sharing (`MobPackMode::Crowd`) in `combat.cpp` / `mob_behaviour.h`.
  3. Wet terrain queries & traits (`Lotochnik` 0.58x damage reduction, `FogShark` speed/damage scaling) in `combat.cpp`.
  4. Monster counterplay mechanics (cutting weapons vs plant roots, fire vs swarm) in `combat.cpp`.
- **Success criteria**: All 4 ctest targets pass, no regression, clean build.

## Change Tracker
- **Files modified**: None yet
- **Build status**: Configuring / building baseline
- **Pending issues**: None

## Quality Status
- **Build/test result**: In progress
- **Lint status**: Clean
- **Tests added/modified**: TBD

## Loaded Skills
- None

## Key Decisions Made
- Investigating codebase and running initial build.

## Artifact Index
- `.agents/worker_m4/ORIGINAL_REQUEST.md` — User request
- `.agents/worker_m4/BRIEFING.md` — Current briefing
- `.agents/worker_m4/progress.md` — Liveness heartbeat
