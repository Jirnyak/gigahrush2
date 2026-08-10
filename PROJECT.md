# Project: gigahrush2 Spec 04 Implementation

## Architecture
C++/Vulkan rendering engine. Key components:
- `src/app/main.cpp`: Main render loop, pass execution, push constant setup, envvar checks.
- `src/render/gpu_timer.h`: GPU timer query pool and pass enum channels.
- `src/render/voxel_mirror.cpp`: Voxel engine page pool management and fluid simulation buffer sync.
- `shaders/cube.frag`, `shaders/raymarch.frag`: Fragment shaders handling lighting, samosbor pulse, and raymarching push constants.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | GPU Timer Passes | Add `GpuPass` enum channels (`GpuLightGrid`, `VoxelMirrorFlush`, `GpuCull`, `SimWireClothParticle`, `PropPass`, `DrawWireClothParticle`) and `mark_begin/end` in `main.cpp` | M1 | ORIGINAL_REQUEST §1 |
| 2 | Envvar Caching & CubePass Removal | Cache `GIGA_WIRE_NOSIM` and `GIGA_PARTICLE_NOSIM` into `static const bool` in `main.cpp`. Remove dead references to `shaders/cube.vert` and `CubePass` across codebase | M2 | ORIGINAL_REQUEST §2 |
| 3 | Samosbor Pulse & PC Torus Overload | Fix `samosborPulse` calculations and separate `pc.torus.w` overloading into dedicated fields in shaders (`cube.frag`, `raymarch.frag`) and host push constant structs | M3 | ORIGINAL_REQUEST §3 |
| 4 | Voxel Dynamic Page Allocation | In `src/render/voxel_mirror.cpp`, allocate 768 MiB page pool dynamically per page instead of upfront | M4 | ORIGINAL_REQUEST §4 |
| 5 | Voxel Fluid Dirty Cell Updates | In `src/render/voxel_mirror.cpp`, send fluid updates via dirty cells rather than re-uploading full 8 MiB | M5 | ORIGINAL_REQUEST §5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | GPU Timer Passes | `src/render/gpu_timer.h`, `src/app/main.cpp` | None | PLANNED |
| M2 | Envvar Caching & CubePass Removal | `src/app/main.cpp`, shaders & codebase | M1 | PLANNED |
| M3 | Samosbor Pulse & Torus Separation | `shaders/cube.frag`, `shaders/raymarch.frag`, host PC structs | None | PLANNED |
| M4 | Voxel Dynamic Page Pool | `src/render/voxel_mirror.cpp` | None | PLANNED |
| M5 | Voxel Fluid Dirty Cells | `src/render/voxel_mirror.cpp` | M4 | PLANNED |

## Interface Contracts
- `gpu_timer.h`: GpuPass enum entries match array indexing for timestamps.
- `voxel_mirror.cpp`: Dynamic page allocation preserves page index mapping and GPU host visible memory binding.
- Shaders & Host PC: Push constant struct layout in C++ must strictly match GLSL std430 / push_constant layout in `cube.frag` and `raymarch.frag`.

## Code Layout
- `src/app/main.cpp`
- `src/render/gpu_timer.h`
- `src/render/voxel_mirror.cpp`, `src/render/voxel_mirror.h`
- `shaders/cube.frag`, `shaders/raymarch.frag`
