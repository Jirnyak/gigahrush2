# Test & Verification Standards for Prop Systems in Gigahrush2

**Document Path**: `C:\hades\gigahrush2\.agents\explorer_m1_3\handbook_prop_tests.md`  
**Author**: `explorer_m1_3`  
**Date**: 2026-07-30  
**Target Project**: Gigahrush2 (`C:\hades\gigahrush2`)  

---

## Executive Summary

This handbook establishes the exact testing, static analysis, and verification standards for procedural prop placement (`PropPlacer`) and GPU instancing systems (`PropPass`, `PropMesh`) in Gigahrush2. 

Based on a complete audit of `CMakeLists.txt`, `tools/check_source_rules.cmake`, `tests/world_test.cpp`, `tests/audit_test.cpp`, `tests/game_test.cpp`, and `src/render/prop_placer.cpp`, this document details existing coverage, identifies the mechanical gates governing build integrity, and delivers an actionable test plan for verifying prop placement rules, spatial hashing, bounding box bounds, attribute correctness, and deterministic generation.

---

## 1. Audit of Existing Test Suites & World/Prop Coverage

### 1.1 `tests/world_test.cpp` (Simulation Core Unit Tests)
- **Target & Dependencies**: Builds executable `world_test`, linking only `giga_core` (dependency-free headless core).
- **Assertion Tally**: 108 static `CHECK` sites producing **22,609 execution checks** across loop iterations.
- **Current Coverage**:
  1. `test_wrap()`: Toroidal integer indexing and wrapped shortest-path delta.
  2. `test_nearest_image()`: Shader contract test for minimal-image toroidal rendering calculation (matching `shaders/cube.vert`).
  3. `test_submask()`: 8x8x8 sub-voxel mask operations (`empty`, `full`, `test`, `set`, `intersects`).
  4. `test_grid_toroidal()`: Toroidal 128^3 `MacroGrid` cell lookup and boundary wrapping.
  5. `test_fields()`: Scalar grid fields (`FieldRegistry`, wrapping, type safety).
  6. `test_level_stack()`: Vertical 4D layer stack navigation.
  7. `test_aabb_overlap()`: Swept AABB collision testing against solid macro grid cells.
  8. `test_physics_lands_on_floor()`: Gravity & collision response resting on floor slabs.
  9. `test_fluid_conserves_mass()`: Mass conservation of cellular fluid simulation.
  10. `test_diffusion()`: Hazard/scent field diffusion, boundary flux blocking, flee gradient, determinism, decay.
  11. `test_camera_component_is_movable()`: Camera view matrix derivation.
  12. `test_parallel_for()`: Disjoint multithreaded job system execution.
  13. `test_nav_coarse()`: L1 coarse graph bake topology, symmetry, and seam-free torus routing.
  14. `test_nav_fine()`: L2 fine flow field shortest wrapped path descent and nearest-node assignment.
  15. `test_route_step()`: O(1) tick routing combining coarse reachability and fine flow fields.
- **Prop Coverage Deficit**: `world_test.cpp` tests voxel grids, fields, physics, fluid, diffusion, and navigation, but contains **zero tests for `PropPlacer` or prop generation**.

### 1.2 `tests/audit_test.cpp` & `tests/suite_audit.inl` (Audit Findings & Regressions)
- **Target & Dependencies**: Builds executable `audit_test`, linking `giga_game`.
- **Assertion Tally**: 140 checks, 0 failures.
- **Current Coverage**:
  - `projectile_once()`: Closed double-integration bug via `SelfIntegrating` tag.
  - `ms_timer_drift()`: Closed timer rounding drift via 125 Hz sim step.
  - `gun_kills_counted()`: Closed firearm kill tracking on `PlayerMelee::kills`.
  - `ammo_has_a_source()`: Closed ammo availability in crates and vendor resupply.
  - `descend_not_free()`: Closed contract exploit for historical floor descents.
  - `descend_same_target_once()`: Closed double payout bug for duplicate depth targets.
  - `giver_slot_recycled()`: Closed ABA NPC slot recycling exploit using `NpcHandle`.
  - `hunt_is_findable()`: Closed impossible monster hunt contracts using spawn weight filter.
  - `travel_keeps_opened_crates()`: Closed crate state preservation across elevator floor travel.
- **Prop Coverage Deficit**: `audit_test.cpp` strictly tracks gameplay regressions and contains **no prop-related tests**.

### 1.3 `tests/game_test.cpp` (Gameplay Systems Suite)
- **Target & Dependencies**: Builds executable `game_test`, linking `giga_game`.
- **Assertion Tally**: 213,865 execution checks across 81 suite entry points.
- **Prop Coverage Deficit**: Covers inventory, crafting, loot tables, doors, save/load, quests, and AI, but does not touch `src/render/prop_placer.cpp`.

---

## 2. Test Assertion Count Governance & CMake Regex Pins

### 2.1 Mechanical Pinning Architecture
CTest default behavior evaluates only the process exit code (`0` for success). If a test dispatch call is deleted or a test function returns early, `main()` still returns `0`, rendering test deletions invisible to standard CI.

To eliminate silent coverage regression, `CMakeLists.txt` uses `set_tests_properties` with `PASS_REGULAR_EXPRESSION` to match the exact string printed by `main()`:

```cmake
# 1. world_test regex pin
add_test(NAME world_test COMMAND world_test)
set_tests_properties(world_test PROPERTIES
    PASS_REGULAR_EXPRESSION "22609/22609 checks passed")

# 2. audit_findings regex pin
add_test(NAME audit_findings COMMAND audit_test)
set_tests_properties(audit_findings PROPERTIES
    PASS_REGULAR_EXPRESSION "audit_test: 140 checks, 0 failures")

# 3. game_test regex pin
add_test(NAME game_test COMMAND game_test)
set_tests_properties(game_test PROPERTIES
    PASS_REGULAR_EXPRESSION "game_test: 213865 checks, 0 failures")

# 4. source_rules regex pin (Floor of scanned files)
add_test(NAME source_rules
    COMMAND ${CMAKE_COMMAND} -DGIGA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
            -P ${CMAKE_CURRENT_SOURCE_DIR}/tools/check_source_rules.cmake)
set_tests_properties(source_rules PROPERTIES
    PASS_REGULAR_EXPRESSION "files_scanned=[0-9][0-9][0-9]")
```

### 2.2 Friction Protocol for Test Modifications
Whenever a test is added, updated, or deleted:
1. **The test binary will fail CTest** because the printed check count changes.
2. **Re-configuration is mandatory**: Running `tools\win\build.bat` or `cmake -S . -B build-win` is required to bake updated properties into `build-win/CTestTestfile.cmake`. Editing `CMakeLists.txt` without re-configuring leaves stale regexes in CTest.
3. **Commit Rationale**: The commit message must state the exact count movement and rationale (e.g. `tests: add PropPlacer suite, checks 213865 -> 214500`).

---

## 3. Actionable Test & Verification Plan for `PropPlacer`

### 3.1 Headless Testing Compatibility & Architecture
- **Location**: `src/render/prop_placer.h` & `src/render/prop_placer.cpp`.
- **Dependencies**: `PropPlacer` operates on `giga::MacroGrid` and populates `giga::gpu::PropPass`.
- **Vulkan Decoupling**: While `PropPass` manages GPU buffers, `PropPass::clear_instances()` and `PropPass::add_instance(shape, instance)` operate entirely on CPU memory (`std::vector<PropInstance> cpuInst_[25]`) without requiring Vulkan initialization (`init()`).
- **Test Target Integration**: Unit tests can instantiate `giga::gpu::PropPass propPass;` in a headless environment, execute `placer.populate(grid, propPass);`, and query `placer.total_placed()` as well as the populated `PropInstance` data.

### 3.2 Key Test Suite Scenarios (`tests/suite_props.inl`)

A dedicated suite file `tests/suite_props.inl` must be created and included in `tests/game_test.cpp` or `tests/world_test.cpp` with the following test cases:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                PropPlacer Unit Tests                             │
├───────────────────────────────┬──────────────────────────────────────────────────┤
│ Test Function                 │ Objective / Assertion Criteria                   │
├───────────────────────────────┼──────────────────────────────────────────────────┤
│ test_prop_placer_non_null()   │ Verify total_placed() > 0 on generated grids.    │
│ test_prop_placer_determinism()│ Verify spatial_hash yields bit-identical outputs.│
│ test_prop_placement_rules()   │ Verify 6-neighborhood spatial constraints.      │
│ test_prop_bounds_and_air()    │ Verify props sit inside air cells & valid AABB.  │
│ test_prop_attribute_validity()│ Verify matId, emissive, yaw, and color ranges.   │
│ test_prop_capacity_limits()   │ Verify no shape exceeds kMaxPropInstances (4096).│
└───────────────────────────────┴──────────────────────────────────────────────────┘
```

#### Test Case 1: Non-Null & Density Verification (`test_prop_placer_non_null`)
- **Setup**: Create a `MacroGrid` populated with a demo world (`generate_demo_world(grid, 1337u, WorldGenMode::FloorStack)`).
- **Execution**: Run `PropPlacer placer; PropPass pass; placer.populate(grid, pass);`.
- **Assertions**:
  - `CHECK(placer.total_placed() > 0)`: Ensure props are generated for non-empty worlds.
  - `CHECK(pass.last_draw_count() == 0)`: Before `record()`, draw count remains 0, confirming CPU-only state.

#### Test Case 2: Determinism & Spatial Hash Stability (`test_prop_placer_determinism`)
- **Setup**: Instantiate two identical `MacroGrid` instances with seed `42`.
- **Execution**: Populate `passA` with `placerA` and `passB` with `placerB`.
- **Assertions**:
  - `CHECK(placerA.total_placed() == placerB.total_placed())`.
  - Iterate all 25 shapes (`PropShape::Cylinder` to `PropShape::AcidPool`):
    - `CHECK(passA.cpuInst_[s].size() == passB.cpuInst_[s].size())`.
    - `CHECK(std::memcmp(passA.cpuInst_[s].data(), passB.cpuInst_[s].data(), count * sizeof(PropInstance)) == 0)`.

#### Test Case 3: Neighborhood Placement Rules (`test_prop_placement_rules`)
- **Setup**: Construct a synthetic 8x8x8 `MacroGrid` with controlled solid/air cells.
- **Rule Verification**:
  1. **Ceiling Pipes (`Pipe`, `PipeElbow`, `PipeTee`)**:
     - Place solid cell at `(4, 5, 4)` and air at `(4, 4, 4)`.
     - Assert that generated pipe origin has `y + 1` solid cell (`grid.type(x, y+1, z) != kCellAir`).
  2. **Floor Grates (`Grate`, `RoundGrate`)**:
     - Place solid cell at `(4, 3, 4)` (below) and air at `(4, 4, 4)`.
     - Assert `grid.type(x, y-1, z) != kCellAir`.
  3. **Wall Cabinets (`CabinetBox`, `ControlPanel`)**:
     - Place solid cell at `(3, 4, 4)` (west) and `(4, 3, 4)` (below).
     - Assert cabinet is adjacent to at least one solid wall (`west`, `east`, `north`, or `south`).
  4. **Support Beams (`SupportBeam`)**:
     - Assert `above` is solid and both `west` and `east` are air cells (`kCellAir`).

#### Test Case 4: Bounds, Air Occupancy & Bounding Box (`test_prop_bounds_and_air`)
- **Execution**: For all placed `PropInstance` items across all shapes:
  - **Air Occupancy**: `int cx = static_cast<int>(inst.origin.x / kCellSize); ...`
    - `CHECK(grid.type(cx, cy, cz) == kCellAir)`: Props must spawn in air spaces, never embedded inside solid block geometry.
  - **World Bounds**:
    - `CHECK(inst.origin.x >= 0.0f && inst.origin.x < kMacroDim * kCellSize)`.
    - `CHECK(inst.origin.y >= 0.0f && inst.origin.y < kMacroDim * kCellSize)`.
    - `CHECK(inst.origin.z >= 0.0f && inst.origin.z < kMacroDim * kCellSize)`.

#### Test Case 5: Attribute & Range Validation (`test_prop_attribute_validity`)
- **Assertions**:
  - **Material ID**: `CHECK(inst.matId < 30)`.
  - **Color**: `CHECK(inst.color.r >= 0.0f && inst.color.r <= 1.0f)`, same for `g` and `b`.
  - **Emissive Calibration**:
    - Flood Lamps: `CHECK(lampInst.emissive == 210)`.
    - Crystal Clusters: `CHECK(crystalInst.emissive == 180)`.
    - Acid Pools: `CHECK(acidInst.emissive == 70)`.
  - **Memory Layout**: `static_assert(sizeof(PropInstance) == 32)`.

#### Test Case 6: Capacity Hard Cap (`test_prop_capacity_limits`)
- **Execution**: On a dense grid filled with air/ceilings:
  - Verify that for every shape `s`, `cpuInst_[s].size() <= kMaxPropInstances` (4096).

---

## 4. Static Analysis & Source Rules Enforcement (`check_source_rules.cmake`)

Static analysis in Gigahrush2 is enforced by `tools/check_source_rules.cmake` and executed during CTest as the `source_rules` test target.

### 4.1 Rule Inventory

| Rule # | Rule Name | Scope / Target Files | Violation Pattern | Remediation |
|---|---|---|---|---|
| **Rule 1** | **No Exceptions** | All `.cpp`, `.h`, `.inl` in `src/`, `tests/` | `throw`, `catch`, `try` | Return status code or use `CHECK`/assertions. |
| **Rule 2** | **No RTTI** | All `.cpp`, `.h`, `.inl` in `src/`, `tests/` | `dynamic_cast`, `typeid` | Use `type_tag<T>()` from `src/world/field.h`. |
| **Rule 3** | **Core Math Insulation** | All `.cpp`, `.h`, `.inl` in `src/`, `tests/` | `#include <glm/`, `#include <Eigen/` | Use `src/core/math.h`. |
| **Rule 4** | **`giga_core` Headless Isolation** | `src/world`, `src/sim`, `src/ecs`, `src/core` | `#include <SDL3/`, `<vulkan/`, `<imgui`, `<GLFW/` | Remove platform includes from core simulation. |
| **Rule 5** | **`giga_game` Headless Isolation** | `src/game` | `#include <SDL3/`, `<vulkan/`, `<imgui`, `<GLFW/` | Remove platform includes from gameplay systems. |
| **Rule 6** | **No UTF-8 BOM** | All C++, header, shader files | Byte sequence `0xEF 0xBB 0xBF` | Save as UTF-8 without BOM (`/utf-8` flag set). |
| **Rule 7** | **CSV Data Table Sync** | Generated tables in `src/game/` & `shaders/` | CSV data row count != declared header constant | Re-run script in `tools/` (`gen_item_table.py`, etc.). |
| **Guard** | **Extension Coverage Guard** | All files in `src/`, `tests/` | C++ files with extensions outside `GIGA_CXX_EXTS` | Add missing C++ file extension to list in CMake. |
| **Guard** | **Unwired Test Suite Guard** | `tests/suite_*.inl` | Suite not `#included` or `test_*_all()` not called | `#include` in `tests/*.cpp` and call from `main()`. |

### 4.2 Escape Hatches
- **Line Exemption**: Add `// giga-check: allow <reason>` on the flagged line (e.g. string literal false positives).
- **Unwired Suite Exemption**: Add `// giga-check: unwired-suite <reason>` inside a newly created `tests/suite_*.inl` file while work is in progress. Must be removed once wired up.

---

## 5. Verification Method

To independently verify test standards and static analysis compliance for prop systems:

1. **Static Analysis Check**:
   ```powershell
   cmake -DGIGA_ROOT=C:\hades\gigahrush2 -P C:\hades\gigahrush2\tools\check_source_rules.cmake
   ```
   *Expected Output*: `GIGA_SOURCE_RULES=PASS` and `files_scanned=167` (or higher).

2. **Execute Full Test Suite**:
   ```powershell
   cd C:\hades\gigahrush2\build-win
   ctest --output-on-failure
   ```
   *Expected Output*:
   - `world_test`: `22609/22609 checks passed` (Passed).
   - `audit_findings`: `audit_test: 140 checks, 0 failures` (Passed).
   - `game_test`: `game_test: 213865 checks, 0 failures` (Passed).
   - `source_rules`: `files_scanned=...` (Passed).

3. **Verifying New Prop Suite Addition (`suite_props.inl`)**:
   - Create `tests/suite_props.inl`.
   - `#include "suite_props.inl"` inside `tests/game_test.cpp`.
   - Call `test_props_all()` inside `main()` of `game_test.cpp`.
   - Run `build-win\game_test.exe` to obtain updated check count `N`.
   - Run `tools\win\build.bat` or `cmake -S . -B build-win` to re-configure.
   - Update `PASS_REGULAR_EXPRESSION` for `game_test` in `CMakeLists.txt` to `"game_test: N checks, 0 failures"`.
   - Re-run `ctest` to confirm green verdict across all 4 targets.
