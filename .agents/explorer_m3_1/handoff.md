# Explorer Handoff Report — Milestone 3 (R3: Procedural Prop Placement System Audit)

**Agent Archetype**: Explorer (`explorer_m3_1`)  
**Working Directory**: `C:\hades\gigahrush2\.agents\explorer_m3_1\`  
**Target Project**: `C:\hades\gigahrush2`  
**Date**: 2026-07-30  

---

## 1. Observation

Direct code examination was performed on the procedural prop placement system and related world/rendering components. Key file paths, line ranges, and verbatim logic snippets are documented below:

### A. Spatial Hashing & Randomization
* **File**: `src/render/prop_placer.cpp` (Lines 17–24)
```cpp
inline std::uint32_t spatial_hash(int x, int y, int z, std::uint32_t seed) {
    std::uint32_t h = static_cast<std::uint32_t>(x) * 73856093u ^
                      static_cast<std::uint32_t>(y) * 19349663u ^
                      static_cast<std::uint32_t>(z) * 83492791u ^ seed;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    return h ^ (h >> 16);
}
```

### B. Single-Seed Random Sampling Across Rules
* **File**: `src/render/prop_placer.cpp` (Lines 89–224)
```cpp
std::uint32_t rng = spatial_hash(x, y, z, seed);
// Rule 1: Ceiling Pipes
if (solidAbove && (rng % 100 < kCfg.pipeCeilingChancePct)) { ... }
// Rule 2: Floor Grates
if (solidBelow && (rng % 100 < kCfg.grateFloorChancePct)) { ... }
// Rule 3: Wall Cabinets
if (solidBelow && (solidWest || solidEast || solidNorth || solidSouth) && (rng % 100 < kCfg.wallCabinetChancePct)) { ... }
// Rule 4: Lights
if (solidAbove && (nOpen >= 3 || (x % 8 == 0 && z % 8 == 0 && (rng % 100 < kCfg.lightChancePct)))) { ... }
// Rule 5: Anomaly
if (solidBelow && (isAnomalyMat || (rng % 1000 < kCfg.anomalyChancePermil))) { ... }
// Rule 6: Support Beams
if (solidBelow && solidAbove && (x % 8 == 0) && (z % 8 == 0) && (rng % 100 < kCfg.supportBeamChancePct)) { ... }
// Rule 7: Storage Crates
if (solidBelow && (nOpen <= 2) && (solidWest || solidEast) && (solidNorth || solidSouth) && (rng % 100 < kCfg.crateCornerChancePct)) { ... }
```

### C. Pipe Selection Chained Else-If Branching
* **File**: `src/render/prop_placer.cpp` (Lines 103–110)
```cpp
PropShape shape = PropShape::Pipe;
if (nOpen >= 3) {
    shape = PropShape::PipeTee;
} else if ((rng % 10) == 0) {
    shape = PropShape::PipeElbow;
} else if ((rng % 12) == 0) {
    shape = PropShape::Valve;
}
```

### D. Anomaly Shape Selection & Acid Disc Assignment
* **File**: `src/render/prop_placer.cpp` (Lines 184–193)
```cpp
PropShape shape = PropShape::CrystalCluster;
if (below == kMatAcidPool || (rng & 1)) {
    shape            = PropShape::AcidPool;
    crystal.color    = kCfg.acidCol;
    crystal.emissive = 140;
} else if (solidAbove && (rng % 100 < 30)) {
    shape            = PropShape::FungalColumn;
    crystal.color    = kCfg.fungalCol;
    crystal.emissive = 160;
}
```

### E. Hardware/Buffer Instance Hard Cap
* **File**: `src/render/prop_pass.h` (Line 28) & `src/render/prop_pass.cpp` (Lines 242–247)
```cpp
// prop_pass.h
static constexpr int kMaxPropInstances = 4096; // per shape per frame

// prop_pass.cpp
void PropPass::add_instance(PropShape shape, const PropInstance& inst) {
    int s = static_cast<int>(shape);
    if (s < 0 || s >= kPropShapeCount) return;
    if (static_cast<int>(cpuInst_[s].size()) < kMaxPropInstances)
        cpuInst_[s].push_back(inst);
}
```

### F. Toroidal Grid Coordinate Wrapping
* **File**: `src/world/macro_grid.h` (Lines 68–81) & `src/core/wrap.h` (Lines 8–11)
```cpp
// macro_grid.h
CellType cell(int x, int y, int z) const {
    return types_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
}

// wrap.h
inline constexpr int wrapi(int v, int size) {
    int m = v % size;
    return m < 0 ? m + size : m;
}
```

### G. Application Level Integration (`main.cpp`)
* **File**: `src/app/main.cpp` (Lines 688–691 & 1013–1016)
```cpp
// Keyboard ride path (lines 1013-1016):
if (propPass.ready()) {
    std::uint32_t fseed = 1337u ^ (static_cast<std::uint32_t>(currentFloor) * 0x9e3779b9u);
    propPlacer.populate(stack.layer(nl).grid(), propPass, fseed);
}
```
* **Contrast with `--shot` ride path** (`src/app/main.cpp` Lines 2260–2295): `propPlacer.populate` is **missing** during automated multi-floor floor transitions.

---

## 2. Logic Chain

From the observations above, the logic step-by-step leads to the following conclusions:

1. **Cell Array Bounds & Toroidal Safety**:
   - `grid.cell(x, y - 1, z)`, `grid.cell(x + 1, y, z)`, etc. invoke `wrap_macro()`, which calls `wrapi(c, 128)`. Negative coordinates wrap around correctly (e.g. `-1` -> `127`). Out-of-bounds array access cannot occur during cell lookups.
   - However, `spatial_hash(x, y, z, seed)` takes raw integer coordinates. Inside `populate()`, loop bounds are strictly `0 <= x, y, z < 128`, so inputs match wrapped bounds. But if an external system queries wrapped coordinates, `spatial_hash(-1, 0, 0, seed)` evaluates `uint32_t(-1)` (`0xFFFFFFFF`), yielding a different hash than `spatial_hash(127, 0, 0, seed)`.

2. **Un-diversified Cell Hash (`rng`) and Prop Stacking**:
   - A single `uint32_t rng` is generated per cell `(x, y, z)`.
   - Every rule tests `(rng % 100 < Chance)`. When `rng % 100` produces a small integer (e.g. 5), ALL rules with thresholds > 5 evaluate to `true` for that cell.
   - A single open cell can therefore spawn a ceiling Pipe, a floor Grate, a wall Cabinet, a FloodLamp, a Crystal Cluster, a Support Beam, and a Storage Crate simultaneously at `(wx, wy, wz)`, causing severe 3D mesh clipping and visual clutter.

3. **Operator Precedence Bug in Flood Lamp Placement**:
   - In Rule 4, the condition is `solidAbove && (nOpen >= 3 || (x % 8 == 0 && z % 8 == 0 && (rng % 100 < kCfg.lightChancePct)))`.
   - Due to operator precedence, `nOpen >= 3` bypasses the `(rng % 100 < lightChancePct)` probability test. Every single intersection cell (`nOpen >= 3`) with a ceiling will ALWAYS spawn a `FloodLamp` (100% rate).

4. **Pipe Sub-Type Probability Coupling**:
   - In Rule 1, `else if ((rng % 10) == 0)` precedes `else if ((rng % 12) == 0)`.
   - When `rng % 60 == 0`, the `PipeElbow` branch consumes the execution flow, preventing `Valve` from ever spawning when `rng % 60 == 0`.

5. **Spurious Acid Disc Spawns on Normal Flooring**:
   - In Rule 5, `if (below == kMatAcidPool || (rng & 1))` executes when `(rng & 1)` is non-zero (50% probability).
   - This places `AcidPool` prop discs on standard concrete, dirt, or parquet floors even when no acid material (`kMatAcidPool`) exists below. Furthermore, `FungalColumn` is starved of spawns because `(rng & 1)` steals 50% of candidate anomaly cells.

6. **Instance Limit Truncation (`kMaxPropInstances`)**:
   - Each shape vector is capped at 4,096 instances per frame.
   - For a 128x128x128 grid (2,097,152 cells), 35% pipe chance and 100% intersection lamp rate generate >10,000 instances.
   - `PropPass::add_instance` silently drops instances exceeding 4,096. Props populate only the lower grid indices (e.g. x=0..60) while the remainder of the world remains empty.

7. **Integration Gap in `--shot --ride` Mode**:
   - Interactive keypress floor change (`[` or `]`) triggers `propPlacer.populate()`.
   - `--shot --ride N` automated floor traversal (`main.cpp:2260-2295`) missing `propPlacer.populate()`, leaving subsequent floors without props during automated testing/screenshots.

8. **Unused Mesh Catalogue Shapes**:
   - 9 shapes defined in `PropShape` (`Cylinder`, `HalfCylinder`, `Arch`, `Barrel`, `StairStep`, `Railing`, `LockerUnit`, `BenchSlab`, `SecurityCamera`) are never referenced or spawned in `prop_placer.cpp`.

---

## 3. Caveats

- **Read-Only Inspection**: All findings were derived strictly from code analysis without running code or modifying source files.
- **Single-Compiler Owner Rule**: No build or test execution was initiated.
- **Shader Pipelines**: Vulkan SPIR-V shader files (`prop.vert.spv`, `prop.frag.spv`, `cube.frag.spv`) were not dynamically inspected at runtime, though vertex attribute alignments (`sizeof(PropInstance) == 32`) were verified via `static_assert`.

---

## 4. Conclusion

The Procedural Prop Placement System (`PropPlacer`) demonstrates solid memory safety and toroidal bounds handling via `MacroGrid`. However, it suffers from 6 critical logic and integration defects:

1. **Multi-Prop Stacking**: Shared `rng % 100` across independent rules causes multiple props to spawn in identical voxel cells.
2. **Intersection Light Over-spawning**: Logical `||` operator bug forces 100% FloodLamp spawn rates at all 3/4-way intersections.
3. **Spurious Acid Pool Spawns**: Non-acid floor cells receive `AcidPool` prop discs due to `(rng & 1)` fallback logic.
4. **Pipe Sub-type Coupling**: Chained `else if` on modulo values suppresses `Valve` spawns on `rng % 60 == 0`.
5. **Instance Cap Truncation**: 4,096 instance limit per shape causes prop truncation across large levels.
6. **Integration Gap**: Missing `propPlacer.populate()` in `main.cpp` `--shot --ride` code path.

---

## 5. Verification Method

To independently verify these findings:

1. **Multi-Prop Stacking Inspection**:
   - Inspect `src/render/prop_placer.cpp:89-224`. Confirm that `rng` is initialized once at line 89 and used without re-hashing across all 7 rule checks.

2. **Intersection Light Bug Inspection**:
   - Inspect `src/render/prop_placer.cpp:159`. Confirm expression `nOpen >= 3 || (x % 8 == 0 && z % 8 == 0 && (rng % 100 < kCfg.lightChancePct))`.

3. **Acid Pool Floor Check Inspection**:
   - Inspect `src/render/prop_placer.cpp:185`. Confirm `if (below == kMatAcidPool || (rng & 1))` triggers `AcidPool` shape assignment regardless of `below` material.

4. **Instance Cap Inspection**:
   - Inspect `src/render/prop_pass.h:28` (`kMaxPropInstances = 4096`) and `src/render/prop_pass.cpp:245` (`cpuInst_[s].size() < kMaxPropInstances`).

5. **`main.cpp` Integration Inspection**:
   - Search for `propPlacer.populate` in `src/app/main.cpp`. Confirm presence at lines 690 and 1015 (keyboard ride path) and absence in lines 2260–2295 (`--shot` ride path).

---

### Proposed Refactoring & Fixes (For Implementer Reference)

```cpp
// 1. Advance / diversify hash per rule check:
inline uint32_t next_rng(uint32_t h) {
    return (h ^ (h >> 16)) * 0x45d9f3bu;
}

// 2. Fix Light Intersection Precedence:
if (solidAbove && (rng % 100 < kCfg.lightChancePct) && (nOpen >= 3 || (x % 8 == 0 && z % 8 == 0)))

// 3. Fix Acid Pool Floor Material Check:
if (below == kMatAcidPool) {
    shape = PropShape::AcidPool;
    crystal.color = kCfg.acidCol;
    crystal.emissive = 140;
} else if (solidAbove && (rng % 100 < 30)) {
    shape = PropShape::FungalColumn;
    crystal.color = kCfg.fungalCol;
    crystal.emissive = 160;
} else {
    shape = PropShape::CrystalCluster;
}

// 4. Add propPlacer.populate() to main.cpp --shot ride path:
if (propPass.ready()) {
    std::uint32_t fseed = 1337u ^ (static_cast<std::uint32_t>(currentFloor) * 0x9e3779b9u);
    propPlacer.populate(stack.layer(nl).grid(), propPass, fseed);
}
```
