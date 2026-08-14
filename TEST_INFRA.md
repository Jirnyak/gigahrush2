# E2E Test Infra: GigaHrush 2 (Problems 11, 15, 21, 29)

## Test Philosophy
- Opaque-box, requirement-driven.
- Full regression prevention for all existing tests (`world_test`, `audit_test`, `game_test`, `e2e_test`).
- Zero tolerance for mock implementations, static allocation violations, or non-POD ECS components.

## Feature Inventory & Test Mapping
| # | Feature | Source (Requirement) | Test Suite / Verification Mechanism |
|---|---------|----------------------|-------------------------------------|
| 1 | Problem 15: Deep Gravity Frame Isotropy | ORIGINAL_REQUEST §R2 | `tests/suite_gravity_regimes.inl`, `game_test`, `world_test` |
| 2 | Problem 11: Multi-Floor Symmetry & Layer Independence | ORIGINAL_REQUEST §R1 | `tests/suite_elevator.inl`, `tests/suite_save.inl`, `tests/suite_stream.inl`, `world_test` |
| 3 | Problem 21: MacroSim Slicing & Amortized Aging | ORIGINAL_REQUEST §R3 | `tests/suite_macrosim.inl`, `macro_bench.exe`, `game_test` |
| 4 | Problem 29: Modular Decomposition of main.cpp | ORIGINAL_REQUEST §R4 | `tools/check_source_rules.cmake`, `tools/check_wired.cmake`, `gigahrush2.exe --shot proof_multiride.png` |

## Test Architecture
- Test runner: CMake CTest & target binaries (`world_test.exe`, `audit_test.exe`, `game_test.exe`, `e2e_test.exe`).
- Source rules validator: `cmake -P tools/check_source_rules.cmake`.
- Wired entry points validator: `cmake -P tools/check_wired.cmake`.
- Visual/Headless proof: `gigahrush2.exe --shot proof.png`.

## Coverage Goals
- 100% pass on all 4 problem domains.
- 0 source rule violations.
- 0 warnings under MSVC/Clang Release build.
