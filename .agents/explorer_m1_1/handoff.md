# Milestone 1 (R1: Procedural Prop Mesh Generators & GPU Instancing) — Handoff Report

## 1. Observation

### File & Scope Summary
- **Target Files Examined**:
  - `src/render/prop_mesh.h` (99 lines)
  - `src/render/prop_mesh.cpp` (951 lines)
  - `src/render/prop_pass.h` (79 lines)
  - `src/render/prop_pass.cpp` (312 lines)
  - `shaders/prop.vert` (67 lines)
  - `shaders/prop.frag` (257 lines)
  - `src/render/prop_placer.h` & `src/render/prop_placer.cpp` (231 lines)
  - `tests/suite_props.inl` (141 lines)

### Verification of the 25 `PropShape` Generators
All 25 `PropShape` enum values are defined in `prop_mesh.h` and dispatched in `build_prop_mesh` in `prop_mesh.cpp`:

| Index | `PropShape` Name | Function Call | Status | Observed Defect / Issue |
|---|---|---|---|---|
| 0 | `Cylinder` | `build_cylinder` | Valid | Correct 16-side vertical pillar ($r=0.30$, $h=2.00$) |
| 1 | `HalfCylinder` | `build_half_cylinder` | Valid | Correct 8-side half-pipe with flat back and half-circle caps |
| 2 | `Arch` | `build_arch` | Valid | Correct extruded half-ring ($r_\text{outer}=1.0, r_\text{inner}=0.6, d=0.5$) |
| 3 | `Barrel` | `build_barrel` | Valid | Correct 12-side barrel with waist bulge ($r_\text{mid}=0.35, r_\text{edge}=0.28$) |
| 4 | `StairStep` | `build_stair_step` | **Defective** | **Degenerate Quads & Normal**: Front face ($z=0$) has duplicate vertices creating zero-area triangles; side faces pass 4 points for triangles causing degenerate index references; sloped normal `{0.0f, 1.0f, -0.53f}` is unnormalized (length ~1.13). |
| 5 | `Pipe` | `build_pipe` | Valid | Correct horizontal pipe along X axis ($r=0.15, l=2.00$) |
| 6 | `PipeElbow` | `build_pipe_elbow` | **CRITICAL DEFECT** | **2D Flat Mesh**: Cross-section calculation at `prop_mesh.cpp:320` uses `C.z + rSec * (std::cos(ca) * R.z)` where `R.z` is `0.0f` (because bend radial `R = {cos(sa), sin(sa), 0}`). `pos.z` is $0.0$ for ALL vertices, collapsing the 90° pipe elbow into a flat 2D shape in the Z=0 plane. |
| 7 | `PipeTee` | `build_pipe_tee` | Valid | Horizontal pipe along X + vertical branch along Y ($l=1.0$) |
| 8 | `Valve` | `build_valve` | Minor Defect | 3D Torus rim math is valid; spoke offsets `rSpoke * cos(ba)` are added directly to X regardless of spoke angle $a$, skewing spoke cross-sections at diagonal angles. |
| 9 | `Grate` | `build_grate` | Valid (simplified) | $2\times 2\text{ m}$ grid of $9\times 9$ crossing bars. Bar end caps omitted. |
| 10 | `RoundGrate` | `build_round_grate` | Valid (simplified) | Round ventilation grate ($r=0.50$). Outer ring + 2 cross bars. |
| 11 | `CabinetBox` | `build_cabinet_box` | Valid | Electrical cabinet ($0.4\times 1.8\times 0.2\text{ m}$) with inset front door quad. |
| 12 | `ControlPanel` | `build_control_panel` | **Defective** | **Inverted Normal**: Sloped top surface normal calculated at `prop_mesh.cpp:523` as `{0.0f, d/slopeLen, (h-hFront)/slopeLen}` = `{0.0f, 0.8f, +0.6f}`. Normal points into console interior (+Z) instead of outward/forward (-Z), causing inverted lighting & specular. |
| 13 | `Railing` | `build_railing` | **Defective** | **Leftover Stubs & Duplicate Geometry**: Line 539 contains a leftover `push_cylinder_sides(v, idx, r, h, h, 8)` call with $y_0=y_1=h$, pushing 16 degenerate vertices and 32 degenerate indices. Post loop line 550 calls `push_cylinder_sides(v, idx, r, 0.0f, h, 8)` without horizontal offset, pushing duplicate un-translated cylinders at $x=0$. |
| 14 | `SupportBeam` | `build_support_beam` | Valid | Steel H-section beam ($4.0\text{ m}$ long). Top/bottom flanges + web plate. |
| 15 | `CrateBox` | `build_crate_box` | Minor Defect | 6 main faces chamfered. Line 591 duplicates left face quad with `{-0.707, 0, 0}` instead of vertical chamfer. |
| 16 | `CrateLong` | `build_crate_long` | Valid | Long crate ($2.0\times 0.6\times 0.6\text{ m}$) with lid seam quad. |
| 17 | `LockerUnit` | `build_locker_unit` | Valid | Locker unit ($0.5\times 1.8\times 0.3\text{ m}$) with door recess. |
| 18 | `BenchSlab` | `build_bench_slab` | Valid | Bench slab ($2.0\times 0.45\times 0.40\text{ m}$) with leg bottom quads. |
| 19 | `Terminal` | `build_terminal` | Valid | Pedestal base + angled screen panel ($15^\circ$ backward tilt). |
| 20 | `SecurityCamera` | `build_security_camera` | **Defective** | **Inverted Dome Normals**: Dome vertex Y coordinates use $-dr \cdot \sin(\phi)$ (pointing downward), but normals use $+\sin(\phi)$ in Y, causing normals to point inward toward bracket instead of outward. |
| 21 | `FloodLamp` | `build_flood_lamp` | **Defective** | **Inverted Cone Normals**: Cone side face winding produces $+Y$ normals, but assigned normal vectors use $Y = -0.7\text{f}$ (pointing downward into lamp interior). |
| 22 | `FungalColumn` | `build_fungal_column` | **Defective** | **Stepped Ring Discontinuities**: Column loop calculates $r_0, r_1$ per step, but calls `push_cylinder_sides` with constant $r_\text{Avg}$, producing stepped cylinder rings with T-junction gaps between adjacent rings. |
| 23 | `CrystalCluster` | `build_crystal_cluster` | **Defective** | **Un-translated Base Caps**: Base caps for all 5 crystals call `push_cap(v, idx, cr.r, 0.0f, sides, false)` hardcoded at origin $(0,0,0)$. The 4 off-center crystals do not get base caps under their bases; instead 5 caps overlap at the origin. |
| 24 | `AcidPool` | `build_acid_pool` | Valid | Acid pool disk ($r=0.8, \text{thick}=0.04$) with rippled top surface, cylinder rim, bottom cap, and 12 edge bubble hemispheres. |

### Vulkan Pipeline & Buffer Management Audit (`prop_pass.cpp`)
1. **Device Buffer Allocation**:
   - `PropMesh` buffers (`vertexBuffer`, `indexBuffer`, `vertexMem`, `indexMem`) created via `VulkanBuffer::create_device_local` with `VK_BUFFER_USAGE_VERTEX_BUFFER_BIT` and `VK_BUFFER_USAGE_INDEX_BUFFER_BIT`. Cleaned up via `PropMesh::destroy(VkDevice)`.
   - Instance buffers: `instBufs_[s][f]` created via `VulkanBuffer::create_host_visible` with capacity `4096 * 32 = 128 KiB` per shape per frame in flight (50 buffers, 6.4 MiB total). Memory is persistently mapped (`buf.mapped`).
2. **Vertex Binding Attributes Alignment**:
   - **Binding 0** (Per-Vertex, stride 24, `VK_VERTEX_INPUT_RATE_VERTEX`):
     - Loc 0: `inPos` (`R32G32B32_SFLOAT`, offset 0)
     - Loc 1: `inNormal` (`R32G32B32_SFLOAT`, offset 12)
   - **Binding 1** (Per-Instance, stride 32, `VK_VERTEX_INPUT_RATE_INSTANCE`):
     - Loc 2: `inOrigin` (`R32G32B32_SFLOAT`, offset 0)
     - Loc 3: `inYaw` (`R32_SFLOAT`, offset 12)
     - Loc 4: `inColor` (`R32G32B32_SFLOAT`, offset 16)
     - Loc 5: `inMat` (`R8_UINT`, offset 28)
     - Loc 6: `inEmissive` (`R8_UINT`, offset 29)
     - Loc 7: `inFlags` (`R8_UINT`, offset 30)
     - Loc 8: `inAnimPhase` (`R8_UNORM`, offset 31)
   - Attribute locations 0..8 match `PropVertex` (24 bytes) and `PropInstance` (32 bytes) layout and `shaders/prop.vert` declarations exactly.
3. **Draw Recording (`record()`)**:
   - Loops through 25 shapes, performs CPU toroidal distance culling (`distSq > fogEndSq`), copies up to `kMaxPropInstances` (4096) to host-visible instance memory, binds vertex & instance buffers, binds uint32 index buffer, and records `vkCmdDrawIndexed`. Push constants (128-byte `CubePush` block) pushed to pipeline layout.

---

## 2. Logic Chain

1. **`PipeElbow` (Shape 6) Collapse Reasoning**:
   - Observation: `prop_mesh.cpp:319-325` defines:
     `auto pos = [&](vec3 C, vec3 R, vec3 T, float ca) -> vec3 { return {C.x + rSec * (std::cos(ca) * R.x), C.y + rSec * std::sin(ca), C.z + rSec * (std::cos(ca) * R.z)}; };`
   - Premise: Bend arc vector $R = \{\cos(sa), \sin(sa), 0.0\text{f}\}$. Therefore $R.z = 0.0\text{f}$.
   - Deduction: $C.z + rSec \cdot (\cos(ca) \cdot 0.0\text{f}) = 0.0\text{f}$. Every vertex position output has $z = 0.0\text{f}$. The entire 3D tube geometry collapses into a 2D planar figure on the Z=0 plane.

2. **`ControlPanel` (Shape 12) Inverted Normal Reasoning**:
   - Observation: `prop_mesh.cpp:523` calculates slope normal as `slopeN = {0.0f, d, h - hFront};` normalized to `{0.0f, 0.8f, +0.6f}`.
   - Premise: The sloped panel surface extends from front ($z=0, y=h_\text{Front}=0.7$) to back ($z=d=0.4, y=h=1.0$).
   - Deduction: As $y$ increases, $z$ increases (moving backward). The outward surface vector facing the player must point UP ($+Y$) and FORWARD ($-Z$). A positive $+0.6\text{f}$ Z-component points into the interior of the console cabinet, causing light and specular calculations in `prop.frag` to treat the top face as facing away from front lights.

3. **`Railing` (Shape 13) Leftover & Duplicate Geometry Reasoning**:
   - Observation: Line 539 calls `push_cylinder_sides(v, idx, r, h, h, 8);` with $y_0 = y_1 = h$.
   - Observation: Line 550 inside loop `for (int p = 0; p < 2; ++p)` calls `push_cylinder_sides(v, idx, r, 0.0f, h, 8);` without applying $x$-offset $p \cdot \text{len}$.
   - Deduction: Line 539 generates 16 degenerate vertices and 32 degenerate index entries at height $h$. Line 550 generates two identical vertical cylinder posts at $x=0$ regardless of $p$, missing the post at $x=\text{len}$.

4. **`CrystalCluster` (Shape 23) Base Cap Offset Reasoning**:
   - Observation: `prop_mesh.cpp:808` calls `push_cap(v, idx, cr.r, 0.0f, sides, false);` inside the crystal loop.
   - Premise: `push_cap` creates cap vertices centered at $(0.0\text{f}, 0.0\text{f}, 0.0\text{f})$.
   - Deduction: The 4 off-center crystals in the cluster (at offsets $(0.12, 0.05)$, $(-0.10, 0.08)$, etc.) receive base caps rendered at $(0,0,0)$ rather than at their respective crystal bases, resulting in 5 overlapping base caps at the origin.

5. **`SecurityCamera` & `FloodLamp` Normal Inversion Reasoning**:
   - Observation: In `SecurityCamera` (line 680), $y_0 = -dr \cdot \sin(\phi)$, but $n_{00}.y = +\sin(\phi)$.
   - Observation: In `FloodLamp` (line 711), face winding produces $+Y$ outward normals, but assigned $n.y = -0.7\text{f}$.
   - Deduction: Lighting in shaders depends on $n \cdot L$. Inverting normal signs causes ambient/specular lighting to shade external surfaces as shadowed and internal/hidden surfaces as lit.

---

## 3. Caveats

- **Runtime Execution**: In accordance with the SINGLE-COMPILER OWNER RULE, no builds or tests were executed. Observations are based on static code analysis of C++ source files, Vulkan headers, and GLSL shaders.
- **Placer Usage**: 9 shapes (`Cylinder`, `HalfCylinder`, `Arch`, `Barrel`, `StairStep`, `Railing`, `LockerUnit`, `BenchSlab`, `SecurityCamera`) are currently omitted from `PropPlacer::populate()`. While they are fully functional in `PropMesh` and `PropPass`, they will not appear in procedurally generated levels until placed.

---

## 4. Conclusion

1. **Completeness**: All 25 `PropShape` enum values are declared, implemented, and dispatched in `build_prop_mesh`. The Vulkan device buffer management, per-instance vertex binding layout, push constant forwarding, and dynamic instancing in `PropPass` are correctly structured and memory-aligned.
2. **Defects Identified**:
   - **Critical**: `PipeElbow` collapses to a 2D flat shape ($z=0$).
   - **Severe**: `ControlPanel` top normal inverted ($+Z$ instead of $-Z$); `SecurityCamera` dome normals inverted in Y; `FloodLamp` cone normals inverted in Y; `Railing` has leftover degenerate cylinder and un-translated duplicate posts at $x=0$; `CrystalCluster` base caps un-translated at origin.
   - **Moderate**: `StairStep` has degenerate quads/triangles and unnormalized slope normal; `FungalColumn` has stepped cylinder ring discontinuities; `CrateBox` line 591 duplicates left face; `Valve` spokes skewed at diagonal angles.

---

## 5. Verification Method

To independently verify these findings when compilation/testing is performed by the build owner:

1. **Unit Test Execution**:
   Run the prop test suite:
   ```bash
   build-win/bin/world_test --gtest_filter=*Prop*
   ```
2. **Mesh Vertex Inspection**:
   - Inspect `PipeElbow` generated vertices to verify non-zero $Z$ positions.
   - Inspect `ControlPanel` sloped top normal vector to verify negative $Z$ component.
   - Inspect `Railing` vertex count to confirm removal of line 539 degenerate cylinder vertices and verification of post positions at $x=0.0$ and $x=2.0$.
   - Inspect `CrystalCluster` base cap vertex origins to confirm alignment with crystal center offsets.
