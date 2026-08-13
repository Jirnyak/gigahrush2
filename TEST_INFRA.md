# E2E Test Infra: Utility AI & Room Navigation

## Test Philosophy
- Requirement-driven, opaque-box testing covering all requirements R1, R2, R3.
- Test runner: `build\bin\game_test.exe` (or `tools\win\build.bat`).
- Test suites: `tests/suite_utilai.inl` and `tests/suite_rooms.inl`.
- Assertions macro: `CHECK(...)`.

## Feature Inventory
| # | Feature | Requirement | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|-------------|:------:|:------:|:------:|:------:|
| 1 | RoleId & RoleTraits values | R1 | 5 | 5 | ✓ | ✓ |
| 2 | kRoomAffordance room bit masks | R2 | 5 | 5 | ✓ | ✓ |
| 3 | score_intents scaling & threat dampening | R3 | 5 | 5 | ✓ | ✓ |

## Coverage Thresholds
- Tier 1: ≥5 tests per feature (basic values & enum constants)
- Tier 2: ≥5 tests per feature (boundary conditions, 0 threat vs 1 threat, role mask zeroing)
- Tier 3: Pairwise interactions (threat + role multiplier + additive terms)
- Tier 4: Real-world application scenarios (Full NPC cycle: Duty patrol, Medic healing under threat, Looter sleep anywhere)
