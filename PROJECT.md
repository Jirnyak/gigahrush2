# Project: gigahrush2 Spec 02 Voxel Physics and Fluids

## Architecture
- Modules:
  - `src/game/combat.h` & `src/app/main.cpp`: Carve proposal queue (`CarveProposalQueue`), `DropReason` enum (`None`, `QueueFull`, `InvalidRadiusPower`, `BakeInProgress`), `droppedBake` metric counter, stderr logging `[carve] proposals=... dropped_full=... dropped_degen=... dropped_bake=... clamped=...`.
  - `src/world/types.h`, `src/world/destruct.h`, `src/world/destruct.cpp`: Derived sub-chunk bitshift and mask constants (`kSubDimBits`, `kSubVoxelsBits`, `kSubVoxelsMask`, `kSubMask`, `kMacroBits`, `kMacroMask`), 64-bit key integers (`uint64_t` in `CarveScratch` and key functions), power-of-two assertion.
  - `src/sim/fluid.cpp`: Gravity regime fallback for `GravityRegime::Custom` via `regime_from_vector`, symmetric neighbor evaluation and outflow scaling in lateral distribution loop.
  - `tests/`: `suite_combat.inl`, `suite_destruct.inl`, `suite_gravity_regimes.inl`, `game_test`, `world_test`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1. Carving Queue Metrics | Log/assert on dropped proposals in `CarveProposalQueue` (`combat.h` and `main.cpp`) due to capacity, 0 radius/power, or baking | M1 | ORIGINAL_REQUEST §R1 |
| 2 | R2. De-hardcode kSubDim | Derive bitshift/mask expressions from `kSubDim` in `types.h`, `destruct.h`, `destruct.cpp`, promote keys to uint64_t, ensure `kSubDim=16` works | M2 | ORIGINAL_REQUEST §R2 |
| 3 | R3. Fluid Anisotropy & Gravity Fixes | Use `regime_from_vector` for `Custom` regime in `fluid.cpp`, fix neighbor evaluation anisotropy bug in distribution loop | M3 | ORIGINAL_REQUEST §R3 |
| 4 | Build & Test Suite & Runtime Proof | MSVC clean build (`cmake --build build -j 12`), `ctest` pass, stdout/stderr log proof of `[carve]` drop logging | M4 | ORIGINAL_REQUEST §Acceptance Criteria |

## Code Layout
- `src/game/combat.h`
- `src/app/main.cpp`
- `src/world/types.h`, `src/world/destruct.h`, `src/world/destruct.cpp`
- `src/sim/fluid.cpp`
- `tests/suite_combat.inl`, `tests/suite_destruct.inl`, `tests/suite_gravity_regimes.inl`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 0 | Codebase Survey | Full survey of combat.h, destruct.cpp, fluid.cpp, test infra | none | DONE |
| 1 | Carving Queue Metrics (R1) | `src/game/combat.h`, `src/app/main.cpp`, `tests/suite_combat.inl` | M0 | IN_PROGRESS |
| 2 | De-hardcode kSubDim (R2) | `src/world/types.h`, `src/world/destruct.h`, `src/world/destruct.cpp`, `tests/suite_destruct.inl` | M0 | PLANNED |
| 3 | Fluid Anisotropy & Gravity Fixes (R3) | `src/sim/fluid.cpp`, `tests/suite_gravity_regimes.inl` | M0 | PLANNED |
| 4 | Final Build, Test & Runtime Proof (M4) | MSVC build, ctest, stdout/stderr log proof | M1, M2, M3 | PLANNED |

## Interface Contracts
- `CarveProposalQueue`: `DropReason` enum (`None`, `QueueFull`, `InvalidRadiusPower`, `BakeInProgress`), `droppedBake` counter, POD static assert.
- `types.h` derived constants: `compile_log2`, `kSubDimBits`, `kSubVoxelsBits`, `kSubVoxelsMask`, `kSubMask`, `kMacroBits`, `kMacroMask`.
- `fluid.cpp`: gravity regime fallback `if (r == GravityRegime::Custom) r = regime_from_vector(world.gravity().global);`.
