# Cross-Cutting Duplication & Generalization Audit — gigahrush2

**Tree:** `/Users/jirnyak/Mirror/gigahrush2` @ `97bdf13e` (branch `torus`)
**Date of every grep in this document:** 2026-08-17
**Scope:** `src/` (~73k LOC), `tests/` (~38k), `shaders/` (~3.7k), `tools/`
**Mode:** READ-ONLY. No repo file was created, modified, or deleted.

**Owner's design law under test:** *minimum number of systems, each maximally general, composing to give maximum functionality.*

---

## 0. Executive summary

The codebase is **not** a sprawl of naive copy-paste. It has a real core layer
(`src/core/wrap.h`, `src/core/math.h`, `src/core/rng.h`, `src/core/tick.h`), a real
codegen pipeline, and in two places (`save.cpp`'s `visit_*` archive templates,
`prop_system.cpp`'s `find_nearest_interactable`) it has already *found* the right
abstraction. The failure mode is different and more interesting:

> **The general primitive exists, is correct, is documented — and is then bypassed
> by 10–100 hand-inlined copies, several of which are subtly wrong.**

Five structural patterns account for almost every finding:

| Pattern | Example | Severity |
|---|---|---|
| **A. Helper exists, callers inline it anyway** | `macro_cell_centre` used 2×, inlined 13×; `wrap_delta_f` never wrapped into a `torus_d2()` so its 3-line triple is written 182× | Correctness (see §1, §2) |
| **B. Two conventions for one question, both live** | `floor()` vs truncate for pos→cell (44 vs 54 sites); RAII-dtor vs manual-`destroy()` for Vulkan | Crash / off-by-one (§2, §16) |
| **C. The general helper is itself wrong on one axis** | `find_nearest_interactable` wraps X and Z, subtracts Y raw | Isotropy (§1) |
| **D. GLSL can't include C++, so the constant is hand-copied — with no assert** | `kMacroDim/kCellSize/kVoxelSize` in 6 places | Silent drift (§3) |
| **E. A ladder of N partial copies of one unwind sequence** | 8 Vulkan teardown ladders in `main.cpp` | Crash (§16) |

**The single highest-value finding is not a duplication count.** It is that the
duplication of the toroidal-distance triple has produced **8 sites that do not wrap
the Y axis at all** (§1.2), in a world the project's own `isotropy-law` says is
x/y/z-equal — and one of those 8 is inside the *shared* helper everything else calls.

---

## 1. Toroidal wrap

### 1.1 Inventory — the single home already exists

`src/core/wrap.h` (56 lines) is the canonical home and it is well-written:

| Function | `wrap.h` line | Semantics |
|---|---|---|
| `wrapi(v, size)` | 8 | int → `[0, size)` |
| `wrapf(v, size)` | 13 | float → `[0, size)` |
| `wrap_delta(a, b, size)` | 19 | shortest signed int delta, assumes normalized operands |
| `wrap_delta_f(a, b, period)` | 37 | shortest signed float delta, branchless, correct for >1 period |
| `nearest_image(abs, ref, period)` | 52 | minimal-image placement for the renderer |

`src/world/types.h:50` adds `wrap_macro(c) = wrapi(c, kMacroDim)`.
The GLSL twin of `nearest_image` is in `shaders/cube.vert` and `wrap.h:48-51` names it
as a deliberate contract pinned by `test_nearest_image` in `tests/world_test.cpp`.
**This is the correct pattern and the file says so.** Nothing below is a criticism of `wrap.h`.

Mask-based wrap (`& 127`) is used in 10 files where the value is provably in range —
`src/game/antourage/antourage.cpp` (6), `shaders/gas_sim.comp` (6),
`tests/suite_destruct.inl` (3), `src/app/main.cpp` (3), `src/world/destruct.cpp` (2),
`src/render/gpu_gas_pass.cpp` (1), `src/game/ai.cpp` (1), `shaders/wire_sim.comp` (1),
`shaders/particle_sim.comp` (1), `shaders/cloth_sim.comp` (1). `% 128` appears **zero**
times. That part is clean.

### 1.2 THE FINDING — `wrap_delta_f` triple inlined 182×, and 8 copies skip Y

`wrap_delta_f` is called on **182 lines across 29 files**. Almost every one is part of the
same 4-line idiom — *"toroidal squared distance between two `vec3`"* — which **has no helper**:

```cpp
const float dx = wrap_delta_f(a.x, b.x, kWorldExtent);
const float dy = wrap_delta_f(a.y, b.y, kWorldExtent);
const float dz = wrap_delta_f(a.z, b.z, kWorldExtent);
const float d2 = dx*dx + dy*dy + dz*dz;
```

Per-file `wrap_delta_f` line counts (complete list, `src/` + `tests/` + `shaders/`):

| Count | File |
|---:|---|
| 32 | `src/game/combat.cpp` |
| 30 | `src/app/main.cpp` |
| 16 | `src/game/ai.cpp` |
| 15 | `tests/e2e_test.cpp` |
| 10 | `src/game/wander.cpp` |
| 9 | `src/game/door.cpp` |
| 6 | `tests/suite_noise.inl` |
| 6 | `src/game/faction_relations.cpp` |
| 5 | `src/game/loot.cpp` |
| 5 | `src/game/investigate.cpp` |
| 5 | `src/game/prop_system.cpp` |
| 4 | `tests/suite_packs.inl` |
| 3 | `tests/suite_samosbor2.inl` |
| 3 | `src/render/gpu_light_grid.cpp` |
| 3 | `src/game/mob_spawn.cpp` |
| 3 | `src/game/hunt.cpp` |
| 3 | `src/game/rumour.cpp` |
| 3 | `src/game/combat.h` |
| 3 | `src/game/samosbor.cpp` |
| 3 | `src/game/container.cpp` |
| 2 | `tests/suite_rooms.inl` |
| 2 | `tests/game_test.cpp` |
| 2 | `src/core/wrap.h` (the definitions) |
| 2 | `src/world/los.cpp` |
| 2 | `src/game/noise.cpp` |
| 2 | `src/audio/spatial_audio.cpp` |
| 1 | `tests/suite_faction2.inl` |
| 1 | `tests/suite_antourage.inl` |
| 1 | `shaders/prop.vert` |

**Because the idiom is hand-written every time, 8 sites got it wrong the same way:
X and Z are wrapped, Y is a raw subtraction.** Complete list (verified by AST-ish scan
today; every one confirmed by reading the surrounding block):

| # | Site | Y line | What it decides |
|---|---|---|---|
| 1 | `src/app/main.cpp:1481-1484` | `1482: float dy = playerPos.y - pos.y;` | `possess_nearest_survivor` — which body you take over |
| 2 | `src/app/main.cpp:3604-3609` | `3606: const float dy = ppos.y - cpos.y;` | corpse-in-reach for looting |
| 3 | `src/app/main.cpp:3634-3640` | `3636: const float dy = ppos.y - tr.pos.y;` | auto-aim target selection |
| 4 | `src/app/main.cpp:3841-3844` | `3842: float dy = tr.pos.y - ppos.y;` | flash-slow radius (applies `apply_slow`) |
| 5 | `src/app/main.cpp:3857-3860` | `3858: float dy = tr.pos.y - ppos.y;` | SporeCarpet acid **damage** radius |
| 6 | `src/app/main.cpp:6476-6479` | `6477: const float dy = ppos.y - npos.y;` | POSSESS SURVIVOR prompt |
| 7 | `src/game/loot.cpp:475-478` | `476: float dy = playerPos.y - tr.pos.y;` | loot pickup radius |
| 8 | **`src/game/prop_system.cpp:561-564`** | `562: const float dy = ppos.y - tr.pos.y;` | **`find_nearest_interactable` — the SHARED helper** |

Site 8 is the important one. `find_nearest_interactable` is called from **11 places** in
`main.cpp` alone (`4083, 4150, 4176, 4202, 4873, 6028, 6089, 6420, 6430, 6451`, plus
`prop_system.cpp:583` `interaction_step`). The project *did* build the general
"nearest interactable" query — and then broke isotropy inside it, so all 11 callers
inherit the bug.

**Why this is a bug and not a shortcut:** the world is a 128³ torus with gravity along
**Z** (`floor_ground_z = 3`, `kArrivalZ = 3`, `regime_down` default `NegZ`). So **X and Y
are the two horizontal axes and Z is up.** These 8 sites therefore wrap *one horizontal
axis and the vertical axis*, and leave *the other horizontal axis* unwrapped. Two bodies
standing 1 m apart across the Y seam (y=255.5 and y=0.5) measure as **255 m apart**. On
`main.cpp:3857` that means the acid cloud does not damage you; on `prop_system.cpp:561`
it means nothing near the Y seam is interactable.

The lead as given said "4 of those in main.cpp". **The true count is 6 in `main.cpp`
plus 2 outside it = 8**, and the one outside is the shared helper.

### 1.3 Sites that correctly use all three axes (for contrast)

`main.cpp:221-225` (light culling), `main.cpp:4116-4122` (nearest box),
`main.cpp:5465-5468` (threat name), `main.cpp:6190-6195` (conversation validity),
`src/world/los.cpp:27-29`, `src/render/gpu_light_grid.cpp:243-245`,
`src/game/combat.cpp:205-207, 357-359, 414-416, 817-819, 834-836`,
`src/game/ai.cpp:723-725, 1195-1197, 1205-1207`, `src/game/hunt.cpp:55-57`,
`src/game/rumour.cpp:82-84`, `src/game/mob_spawn.cpp:669-671`,
`src/game/door.cpp:238-244, 286-292`, `src/game/wander.cpp:272-274`.

The split is arbitrary — same idiom, same file in several cases, different correctness.
That is the signature of hand-inlining.

### 1.4 Proposal

Add to `src/core/wrap.h` (needs `core/math.h`, or template on a `vec3`-like):

```cpp
inline vec3 wrap_delta_v(const vec3& a, const vec3& b, float period = kWorldExtent);
inline float torus_dist2(const vec3& a, const vec3& b, float period = kWorldExtent);
inline float torus_dist (const vec3& a, const vec3& b, float period = kWorldExtent);
```

Then mechanically replace all 182 call sites. The 8 Y-axis bugs disappear *by
construction* — that is the entire argument for the change.

| | |
|---|---|
| **LOC removed** | ~180 lines net (182 triples × ~3 lines → 182 one-liners, +8 lines of helper) |
| **Bugs fixed** | 8 isotropy defects, one of them in a helper with 12 callers |
| **Risk** | **Low mechanically, MEDIUM behaviourally** — fixing sites 4/5/7 *widens* damage/pickup radii near the Y seam. That is the correct behaviour, but it changes gameplay and must be pinned by a test first (a `torus_dist2` unit test at the seam, then a `--shot` diff). |

---

## 2. Cell ↔ world coordinate conversion

### 2.1 Four helpers exist. All four are bypassed.

| Helper | Definition | Direction | Rounding | Declared in | Call sites |
|---|---|---|---|---|---|
| `macro_cell_of(pos, cx, cy, cz)` | `src/game/save.cpp:987` | world→cell | **truncate** | `src/game/save.h:824` | 2 (`save.cpp:783, 1176`) |
| `macro_cell_centre(cx, cy, cz)` | `src/game/save.cpp:994` | cell→world | — | `src/game/save.h:829` | 2 (`save.cpp:1015, 1161`) |
| `cell_of(coord)` | `src/sim/diffusion.cpp:104` | world→cell | **truncate** | file-local | 5 (`diffusion.cpp:194, 481, 482`) |
| `floor_div(v, s)` | `src/sim/physics.cpp:18` | world→voxel | **floor** | file-local `static` | 12 (all inside `aabb_overlaps_solid`) |

Two of them (`macro_cell_of`, `macro_cell_centre`) live in **`game/save.h`** — a
serialization header — which is why nobody outside `save.cpp` finds them. Their correct
home is `src/world/types.h`, next to `wrap_macro` and `macro_index`.

### 2.2 world→cell inlined 98× in 14 files, in TWO incompatible variants

```
grep -rEn 'static_cast<int>\((std::floor\()?[a-zA-Z_.>\[\]]+ *[/] *(kCellSize|cs)' src → 98 hits
```

| File | hits |
|---|---:|
| `src/app/main.cpp` | 32 |
| `src/game/combat.cpp` | 26 |
| `src/game/wander.cpp` | 6 |
| `src/game/ai.cpp` | 6 |
| `src/world/los.cpp` | 3 |
| `src/game/save.cpp` | 3 |
| `src/game/prop_system.cpp` | 3 |
| `src/game/needs.cpp` | 3 |
| `src/game/mob_spawn.cpp` | 3 |
| `src/game/extraction.cpp` | 3 |
| `src/game/door.cpp` | 3 |
| `src/game/console.cpp` | 3 |
| `src/audio/audio_system.cpp` | 3 |
| `src/sim/diffusion.cpp` | 1 |

**The split is 44 `std::floor(p/kCellSize)` vs 54 bare `static_cast<int>(p/kCellSize)`.**
These differ for **any negative coordinate**: for `p ∈ (-2, 0)`, `floor` → `-1` →
`wrap_macro` → `127`; truncation → `0`. `src/game/save.h:534` even *documents* the
truncating one as "the same truncate-and-wrap `macro_cell_of`" — so the codebase knows
there are two conventions and has not reconciled them.

**Complete list of the 54 truncating sites:**

`src/app/main.cpp:186, 2435, 2437, 2439, 3089, 3099, 3101, 3702, 3714, 3716, 4206, 4207,
4208, 6129, 6130, 6436, 6437, 6438, 6490, 6491`;
`src/game/combat.cpp:43, 44, 45, 982, 983, 984, 1623, 1624, 1625`;
`src/game/console.cpp:185, 186, 187`;
`src/game/door.cpp:22, 23, 24`;
`src/game/extraction.cpp:15, 16, 17`;
`src/game/mob_spawn.cpp:609, 610, 611`;
`src/game/prop_system.cpp:138, 139, 140`;
`src/game/save.cpp:989, 990, 991`;
`src/game/wander.cpp:40, 41, 42, 108, 109, 110`;
`src/sim/diffusion.cpp:105`.

### 2.3 Is the divergence live? — Partly YES

Entity positions **are** normalized to `[0, kWorldExtent)` every tick:
`src/sim/physics.cpp:192-194` (noclip) and `:282-284` (main integrator), plus
`src/game/combat.cpp:1507-1509, 166-167, 222-224, 1689-1690` for projectiles. For those,
the two idioms agree and the divergence is **latent**.

It is **live** wherever an *unwrapped intermediate* is fed in:

- **`src/app/main.cpp:3094-3101`** — `px = cx + ox * kCellSize` with `ox ∈ [-8, 8]`.
  When the player is within 16 m of the world origin, `px` goes negative, truncation
  reads cell `0` where `floor` would read cell `127`. This is the wall-finding scan for
  a spawn placement; near the seam it reads the wrong wall.
- **`src/app/main.cpp:3710-3716`** — byte-identical second copy of the same scan, same bug.
- **`src/app/main.cpp:3086-3090`** — `sampleZ = eyeZ - kCellSize`. At low `z`, `sampleZ`
  is negative; `static_cast<int>(-0.5f/2.0f)` is `0`, so the guard
  `if (gz < 0 || gz >= kMacroDim) continue;` never fires and pass 1 re-samples the same
  storey as pass 0 instead of the one below.

### 2.4 cell→world centre inlined 13× (helper used 2×)

`macro_cell_centre` (`save.cpp:994`) exists; the `(float(c) + 0.5f) * kCellSize` triple
is written by hand at:

`src/app/main.cpp:3984-3985`; `src/game/ai.cpp:981-982, 1026-1028, 1047-1048, 1195-1197,
1205-1207`; `src/game/antourage/antourage.cpp:543, 545`; `src/game/container.cpp:349-350`;
`src/game/door.cpp:31-32, 239, 242, 287, 290, 399-400, 423-424`;
`src/game/light_bake.cpp:84-86`; `src/game/mob_spawn.cpp:145-146`;
`src/game/room_zone.cpp:513-514`.

### 2.5 Proposal

Move into `src/world/types.h` (the file that already owns `kCellSize`, `wrap_macro`,
`macro_index`):

```cpp
inline int   cell_of  (float c)               { return wrap_macro(int(std::floor(c / kCellSize))); }
inline ivec3 cell_of  (const vec3& p);
inline vec3  cell_centre(int cx, int cy, int cz);
inline int   voxel_of (float c);   // the floor_div/kVoxelSize form
```

Pick **`floor`** as the one convention (it is the only one correct for negatives, and it
is what physics — the authority on where a body is — already uses). Delete
`save.cpp:987/994`, `diffusion.cpp:104`, `physics.cpp:18` and re-point their callers.

| | |
|---|---|
| **LOC removed** | ~130 (98 conversion sites collapse ~3:1, 13 centre triples collapse 3:1, 4 helpers deleted) |
| **Bugs fixed** | 3 confirmed-live off-by-one-cell reads (`main.cpp:3094, 3710, 3086`) + the latent 54-site fork |
| **Risk** | **MEDIUM.** Switching truncate→floor changes behaviour only for negative inputs, but `save.cpp:989-991` is on the **save-file wire** (`RunState::cx/cy/cz`). Change it and old saves place the player one cell off near the seam. Either bump the save version or keep `macro_cell_of` truncating with a comment naming it a wire-format decision. |

---

## 3. Voxel DDA / raymarch / raycast (C++ and GLSL)

Full inventory: **15 independent marching/stepping loops**, resolving to **3 real
algorithms + 2 degenerate helpers**.

| # | Site | LOC | Domain | Torus | Convention |
|---|---|---:|---|---|---|
| 1 | `src/world/los.cpp:22-106` `los_blockers` | 85 | macro grid | x/y yes; **z = blocker, no wrap** (`:99-102`) | Amanatides–Woo |
| 2 | `src/world/stain.cpp:65-92` | 28 | sub-voxel | all 3 (`stain.cpp:30-32`) | fixed half-atom step |
| 3 | `src/game/combat.cpp:95-169` `grenade_advance` | 75 | macro grid | x/y at end; z clamped solid | plane-crossing reflect walk |
| 4 | `src/game/combat.cpp:2320-2335` melee chip probe | 16 | macro grid | `wrap_macro` ×3 | fixed 8-sample |
| 5 | `src/sim/physics.cpp:84-121` `sweep_axis` | 38 | sub-voxel AABB | via mask lookups | fixed substep + 12-step bisect |
| 6 | `shaders/raymarch.frag:154-184` `march_cell` | 31 | sub-voxel 8³ | n/a (local) | Amanatides–Woo |
| 7 | `shaders/raymarch.frag:186-242` `march` | 57 | macro class + sub-voxel | `& 127` all 3 (`:92-95`) | Amanatides–Woo |
| 8 | `shaders/raymarch.frag:277-281` `giga_shadow` | 5 | → #7 | — | wrapper |
| 9 | `shaders/shadow_march.glsl:42-60` `sm_cell_blocked` | 19 | sub-voxel 8³ | n/a | Amanatides–Woo — clone of #6 |
| 10 | `shaders/shadow_march.glsl:64-97` `giga_shadow` | 34 | macro + sub-voxel | `& 127` all 3 (`:27-30`) | Amanatides–Woo — clone of #7 |
| 11 | `shaders/volumetric_fog.glsl:203-297` | 95 | light grid 64³ | `& (dim-1)` all 3 (`:105`) | 12 IGN-jittered fixed samples |
| 12 | `shaders/particle_sim.comp:66-77` | 12 | sub-voxel mirror | `& 127`/`& 7` | axis-wise single step |
| 13 | `shaders/wire_sim.comp:53-61` `world_land` | 9 | same | same | axis-wise single step |
| 14 | `shaders/cloth_sim.comp:50-58` `world_land` | 9 | same | same | **byte-identical to #13** |
| 15 | `shaders/raymarch.frag:248-270` `voxel_ao` | 23 | sub-voxel | `cell_index` | 3 fixed taps |

Files with **zero** marching code (checked, so the list above is complete):
`src/render/raymarch_pass.cpp`, `src/render/voxel_mirror.cpp`,
`src/render/gpu_light_grid.cpp`, `src/game/nav_cache.cpp`, `shaders/light_grid.comp`
(sphere-vs-cell binning + insertion sort), `shaders/cull.comp` (6 frustum planes).

Correct reuse (no new algorithm): `src/audio/spatial_audio.cpp:104` → `los_blockers`;
`src/game/combat.cpp:1803` → `los_clear`; `shaders/cube.frag:44-45` and
`shaders/prop.frag:22-23` → `#include "shadow_march.glsl"`.

### 3.1 Verbatim GLSL clones

| Helper | Copies | Verdict |
|---|---|---|
| `solid_at(vec3)` | `shaders/particle_sim.comp:34-41`, `shaders/wire_sim.comp:36-43`, `shaders/cloth_sim.comp:33-40` | **3 byte-identical copies** (only the local is named `s` vs `sv`) |
| `world_land(vec3, vec3)` | `shaders/wire_sim.comp:53-61`, `shaders/cloth_sim.comp:50-58` | **2 byte-identical copies including the 8-line comment** |
| cell index + mask bit | `shaders/raymarch.frag:92-95, 104-107` vs `shaders/shadow_march.glsl:27-30, 36-39` | same arithmetic, renamed `sm_*` |
| class-byte unpack | `shaders/raymarch.frag:97-99` vs `shaders/shadow_march.glsl:32-34` | identical |
| grid constants | `shaders/raymarch.frag:88-90` vs `shaders/shadow_march.glsl:23-25` | hand-synced literals, held together **only by a comment** |

**The project already has a working GLSL include mechanism** — `CMakeLists.txt:255`
(`_giga_glsl_includes`) and 11 live `#include` directives across
`cube.frag:36,39,45`, `prop.frag:14,17,18,23`, `raymarch.frag:36,39`,
`particle.vert:3`, `cloth.vert:3`, `wire.vert:3`. So sharing `solid_at` is a one-line
CMake change, not a new capability. There is no technical reason for the 3 copies.

### 3.2 Behavioural forks between "the same" algorithm — these matter more than LOC

**(a) `shaders/raymarch.frag:273` claims a parity that does not exist.**
The comment says *«march() и есть los_clear рендера»*. It is false:
- `los_clear` (`src/world/los.cpp:103`) tests **macro cells only** — a 2 m cell with one
  solid 0.25 m atom fully blocks.
- `march` (`raymarch.frag:210-240`) tests cell class **and sub-voxel bits** — a
  `cls == 2` cell lets a ray through if it misses the atom.
- **Consequence:** a grate / lattice / rubble cell is opaque to bullets, grenades and
  audio, and transparent to light. Nothing pins this.

**(b) Z-wrap disagreement, C++ vs GLSL.** `src/world/los.cpp:99-102` treats
`z < 0 || z >= kMacroDim` as a **blocker**. `shaders/raymarch.frag:93` and
`shaders/shadow_march.glsl:28` do `c &= 127` on **z as well**, so a shadow ray wraps
through the floor/ceiling seam and samples geometry from the other end of the stack.
Reads as light leaking at z=0 / z=127.

**(c) Loop-budget disagreement for an identical query.** `raymarch.frag:210` iterates
**224** macro cells; `shadow_march.glsl:80` iterates **96**. So `giga_shadow` called
from `cube.frag`/`prop.frag` gives up at 192 m while the same call from `raymarch.frag`
does not — a body and the wall behind it get different shadows from the same lamp.

**(d) Constants hand-synced in 6 places with no `static_assert`.**
`kMacroDim=128`, `kCellSize=2.0`, `kVoxelSize=0.25` appear in
`src/world/types.h:17,34,35`; `shaders/raymarch.frag:88-90`;
`shaders/shadow_march.glsl:23-25`; and implicitly as magic numbers in
`shaders/particle_sim.comp:35-36` (`w * 0.5`, `* 8.0`), `shaders/wire_sim.comp:37-38`,
`shaders/cloth_sim.comp:34-35`. **This is a direct violation of the owner's
"constants must derive" law** — `0.5` is `1/kCellSize` written as a literal.

**(e) No CPU↔GPU parity test exists.**
`grep -rniE 'parity|pin.*march|march.*pin|los.*gpu' tests/ *.md` → **zero hits**.
`tests/world_test.cpp:779-866` (`test_los`) pins `los_clear` alone.

### 3.3 Proposal

GLSL cannot include C++ headers, so the honest target is **one C++ + one GLSL, pinned
against each other by a test.**

**New `shaders/voxel_dda.glsl`** — owns `kMacroDim/kCell/kVoxel`, `cell_index`,
`cell_class`, `sub_solid`, `solid_at`, `world_land`, and one
`dda_march(ro, rd, tCap, out DdaHit)` with `#ifdef GIGA_DDA_WANT_MATERIAL` for the
material/stain/AO fields the world pass needs and the shadow ray does not.
`shadow_march.glsl` shrinks from 102 → ~35 lines. Add one entry to
`CMakeLists.txt:255`'s `_giga_glsl_includes`.

**C++ side** — `src/world/los.h` gains
`template <class Visit> void dda_walk(const vec3& a, const vec3& b, Visit&& v);`.
`los_blockers` becomes a ~12-line visitor. `stain.cpp:65-92` (#2) and
`combat.cpp:2320-2335` (#4) become visitors instead of fixed-step samplers — which also
*fixes* them (the melee probe currently skips cells; the stain walk pays 2× the taps).

| | |
|---|---|
| **LOC removed** | ~125–140 net (shadow_march body ~62, `solid_at` ×2 ~16, `world_land` ×1 ~17, stain ~20, melee ~12, los ~10 net) |
| **Added** | ~95 GLSL + ~60 C++ |
| **Risk** | **MEDIUM-HIGH.** Unifying (b) and (c) changes shadows visibly. Do (a)/(b)/(c) as three separate, individually-verified commits, each with a `--shot` before/after. |

---

## 4. Neighbour iteration (6 / 26)

**10 direction tables + 24 ad-hoc loop sites** for one 6-connected primitive.
There is **no 26- or 27-neighbour table anywhere** (`grep -rn 'd < 26\|d < 27'` → 0 hits).

| # | Table | Entries | Order | Consumers |
|---|---|---:|---|---|
| T1 | `src/world/nav.h:77-79` `kNavDir[6][3]` | 6 | **A**: `-x,+x,-y,+y,-z,+z` | nav bake, room_zone, ai, wander, tests |
| T2 | `src/world/lattice.h:70-81` `lattice_neighbor` switch | 6 | **A** | `nav.cpp:79, 182` |
| T3 | `src/world/nav.cpp:62-67` `nbr[6][3]` local literal | 6 | **A** | `bake_node` only — **silent duplicate of T1 in the file that includes `nav.h`** |
| T4 | `src/world/gravity.h:34-44` `regime_down` | 6+2 | **A** (enum order maps 1:1 to T1) | fluid, floor_gen, elevator, container, combat, gas |
| T5 | `src/world/destruct.cpp:150-151` `kDir6` | 6 | **B**: `+x,-x,+y,-y,+z,-z` | `destruct.cpp:173, 206` |
| T6 | `src/game/light_bake.cpp:58-61` `kD[6][3]` | 6 | **B** | `light_bake.cpp:62` |
| T7 | `src/render/body_pass.cpp:34-41` `faces[6]` | 6 | **B** | cube mesh (not cell neighbours) |
| T8 | `src/render/prop_mesh.cpp:83-88` unrolled `push_quad` | 6 | **B** | unit box (not cell neighbours) |
| T9 | `src/sim/fluid.cpp:110-115` `lat[4]` | 4 | frame-relative | lateral spread — **correct isotropy pattern** |
| T10 | `src/core/math.h:87-89` fallback basis | 3 | axis order | `mat4_lookAt` |

Ad-hoc loops: `src/world/nav.cpp:65-77, 110-119, 154-165, 41, 79-86, 182-189`;
`src/game/room_zone.cpp:322-332`; `src/game/ai.cpp:1023-1025, 1191-1193`;
`src/game/wander.cpp:418-420`; `src/world/destruct.cpp:173-186, 206-220`;
`src/game/light_bake.cpp:62-76`; `src/sim/diffusion.cpp:387-392` (deliberately
unrolled hot path, documented `:78-82` — **keep**); `shaders/gas_sim.comp:124-133`
(unrolled, order **B**, doing the same physics as `diffusion.cpp` in order **A**);
`src/sim/fluid.cpp:104-135`; `src/game/door.cpp:228-252` and `:278-302`
(**two byte-identical 5×5×3 = 75-cell box scans**); `src/game/save.cpp:1085-1114`
(17³ = 4913 ring-ordered raster); `src/game/extraction.cpp:22-25`;
`src/game/combat.cpp:744-752` and `:998-1008`; `src/render/intro_ui.cpp:170-173` (2D UI);
`src/game/floors/blame/blame_gen.cpp:637-638` and
`src/game/floors/padic/padic_gen.cpp:542-543` (4 corners);
`src/game/antourage/antourage.cpp:339, 423`.

### 4.1 Verdict on ordering: no live bug, four latent hazards

Both orderings are **axis-paired** (`d >> 1 == axis`, `d & 1 == sign`), so `d ^ 1` means
"reverse" in both. Verified end-to-end that no order-B index is ever stored or compared
against an order-A index: bake writes A (`nav.cpp:117`, `room_zone.cpp:330`), the cache
serialises raw in `d` order (`nav_cache.cpp:159`), every consumer decodes A
(`wander.cpp:418-420`, `ai.cpp:1023-1025, 1191-1193`, `room_zone.cpp:323-325`).
Order-B tables are used only in order-free contexts (flood-fill enumeration, mesh
emission, symmetric flux stencil).

**Hazards:**
1. **`src/game/ai.cpp:1007`** — `if (r.bit != 0 && (r.dir >> 1) != gf.axis)` reads
   "is this step vertical" straight out of `kNavDir`'s bit layout. **No `static_assert`
   anywhere ties `kNavDir[2*a+s]` to axis `a`.** The only guard is
   `tests/suite_utilai.inl:428` (`CHECK(nav::kNavDir[1][2] == 0)`), which pins one entry.
2. **The nav cache would survive a reorder silently.** `src/game/nav_cache.h:116`
   `kNavCacheVersion = 2u` is hand-bumped, not derived from the direction table. Reorder
   `kNavDir` and every on-disk `.navcache` keeps loading and steers bodies along stale
   directions; `nav_cache.h:205-206` (`BadMagic`/`BadVersion`) cannot see it.
3. **`src/world/nav.cpp:62-67`** duplicates `kNavDir` inside the file that includes it.
   Harmless today (BFS expansion is order-free), but it is the copy that will drift.
4. **`src/game/combat.cpp:744` and `:998` hardcode `CellStep d{0,0,-1}`** instead of
   `regime_down`. Under a non-`NegZ` gravity regime both hazard probes read the wrong
   cell. `combat.cpp:993` documents that this is known — an **isotropy-law violation**.

### 4.2 Proposal

New `src/world/dirs.h` (~30 lines) included by `nav.h`, `destruct.cpp`, `light_bake.cpp`:

```cpp
inline constexpr int kDir6[6][3] = {{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}};
constexpr int dir_axis(int d)    { return d >> 1; }
constexpr int dir_sign(int d)    { return (d & 1) ? +1 : -1; }
constexpr int dir_reverse(int d) { return d ^ 1; }
// the pairing, asserted for all 3 axes — closes hazard 1
// GravityRegime enum order ≡ kDir6 index order — closes the T4≡T1 assumption
```

`nav::kNavDir` becomes an alias so no call site changes. Delete T3, T5, T6 (all
order-insensitive, verified). Move `gas_sim.comp`'s unrolled stencil onto a shared
GLSL `const ivec3[6]` in `voxel_dda.glsl`. Fold `door.cpp:278-302` into `:228-252`
behind one `door_pick_near()`.

| | |
|---|---|
| **LOC removed** | ~44 (nav.cpp 6, destruct 2, light_bake 4, gas_sim 8, door 24) |
| **Added** | ~30 |
| **Risk** | **LOW.** The value is the 4 `static_asserts`, not the LOC. |

---

## 12. "Is solid / passable / can I walk here"

**11 independent predicates in C++ + 5 in GLSL, at 4 different resolutions.**

| # | Predicate | Definition | Resolution | Bar | Consumers |
|---|---|---|---|---|---|
| P1 | `nav::blocked` | `src/world/nav.cpp:17-19` | macro cell | `mask.full()` — **1-in-512** | nav coarse graph, flow fields, nearest-node |
| P2 | `room_zone::blocked` | `src/game/room_zone.cpp:60-69` | sub-voxel | **4×4×7 body footprint**, 2 start layers | room flow fields; exported as `room_body_walkable` (`:80-82`, decl `room_zone.h:354`) |
| P3 | `aabb_overlaps_solid` | `src/sim/physics.cpp:24-…` | exact sub-voxel AABB | exact | physics collision, `save.cpp:1018,1027`, `antourage.cpp:736,746`, `sim_bench.cpp:80,85` |
| P4 | `combat::cell_solid` | `src/game/combat.cpp:72-77` | macro cell | `!= kCellAir`, **z out of range = solid** | grenade bounce |
| P5 | `prop_system::is_solid_cell` | `src/game/prop_system.cpp:46-48` | macro cell | `!= kCellAir` | prop niche/wall detection (`:358-361, 440, 444-447`) |
| P6 | `antourage::is_air` | `src/game/antourage/antourage.cpp:84-86` | macro cell | `== kCellAir` | wire/cloth/pipe placement (`:91-92, 208, 212, 280, 570`) |
| P7 | `floor_standable` | `src/game/floor_gen.cpp:102-108` (decl `floor_gen.h:94`) | macro cell | air **+ gravity-down neighbour solid** | `mob_spawn.cpp:49`, `container.cpp:326` |
| P8 | `Sculpt::solid` | `src/game/floors/blame/blame_gen.cpp:88` | macro cell | `at() != kCellAir` | 12 sites in blame_gen (`:246,247,248,341,352,365,453,456,458,459,507,508,509`) |
| P9 | `MacroGrid::solid(c,s)` | `src/world/macro_grid.h:144` | sub-voxel bit | one bit | `prop_system.cpp:208,249`; `padic_module.cpp:52,63` |
| P10 | `SubMask::full/empty` | `src/world/macro_grid.h:90,94` | macro cell | all/no bits | P1, `physics.cpp` fast path |
| P11 | `find_standable_cell` | `src/game/save.cpp:1041` (decl `save.h:860`) | composite | P3 at cell centre + foot support (`:1018, 1027`) | `place_body_safely` (`save.cpp:1170`) → `floor_stream.cpp:234`, `main.cpp:2638, 7174` |
| G1–G3 | `solid_at(vec3)` | `shaders/particle_sim.comp:34`, `wire_sim.comp:36`, `cloth_sim.comp:33` | sub-voxel | one bit | **3 byte-identical copies** |
| G4 | `sub_solid` / `sub_solid_global` | `shaders/raymarch.frag:104, 131` | sub-voxel | one bit + class shortcut | world march, AO |
| G5 | `sm_solid` | `shaders/shadow_march.glsl:36` | sub-voxel | one bit | shadow march |

### 12.1 Where they disagree — the owner's finding, now quantified and extended

`src/game/room_zone.cpp:18-43` contains an *excellent* comment documenting the first
disagreement, with a measured number: using P1's bar for body steering left **62 of ~63
bodies stalled**, because "not fully solid" is a 1-in-512 bar while a body is
4×4×7 sub-voxels. That was fixed by introducing P2 — but **as a second predicate, not by
replacing P1.** So the divergence is now permanent and merely documented as
"STRICTER THAN NAV, NEVER LOOSER" (`room_zone.cpp:40-43`).

The full disagreement matrix for a macro cell containing **one** solid sub-voxel:

| Predicate | verdict | so… |
|---|---|---|
| P1 `nav::blocked` | **passable** | the coarse nav graph routes through it |
| P2 `room_zone::blocked` | **blocked** (if the voxel is in the 4×4 centre, lower 7 layers) | the room flow field refuses it |
| P3 `aabb_overlaps_solid` | **blocked** | physics stops the body dead |
| P4 `cell_solid` | **blocked** | a grenade bounces off it |
| P5/P6/P7/P8 | **blocked** / not-air | worldgen and props treat it as wall |
| G1–G5 | **passable except at the atom** | it renders as mostly empty; light passes |

So a half-carved cell is: routable by coarse nav (P1), unroutable by room fields (P2),
impassable to bodies (P3), bouncy to grenades (P4), and see-through to light (G4).
**P1 is the outlier and it is the one the elevator/HPA* graph is built on.**

Second disagreement — `floor_standable` (P7) is the only predicate that is
**gravity-aware** (`regime_down`). P2, P3 and P11 all hardcode "down = lower Z"
(P2 via `kBodySubLayers` on the mask's Z-word packing, `room_zone.cpp:36-38`). Under a
non-`NegZ` `GravityRegime` the body footprint test measures the wrong axis. This is the
same class of defect as `combat.cpp:744/998` (§4.1 hazard 4).

Third disagreement — the C++ predicates test `!= kCellAir` on the **CellType**;
G1–G5 test the **sub-voxel bit mask**. `src/world/destruct.cpp` can leave a cell with a
non-air CellType and an empty mask (fully carved) or vice versa. Nothing asserts the two
agree.

### 12.2 Proposal

The right shape is **one predicate parameterised by a probe volume**, not N predicates:

```cpp
// src/world/solidity.h
struct Probe { ivec3 subLo, subHi; };            // in sub-voxels, gravity-frame relative
inline constexpr Probe kProbePoint{...};          // 1 voxel   -> replaces P9, G1-G5
inline constexpr Probe kProbeCell{...};           // 8x8x8     -> replaces P1 (as "any"), P4, P5, P6, P8
inline constexpr Probe kProbeBody{...};           // 4x4x7     -> replaces P2
bool occupied(const MacroGrid&, int cx,int cy,int cz, const Probe&, const GravityFrame&);
bool overlaps(const World&, vec3 pos, vec3 half); // P3 stays — it is the exact form
```

P1 keeps its loose bar **only if** it is renamed to say so (`nav_cell_reachable`) and a
test pins `room_body_walkable ⟹ nav_reachable` (the invariant `room_zone.cpp:40-43`
claims but nothing checks).

| | |
|---|---|
| **LOC removed** | ~60 C++ + ~16 GLSL (the 2 duplicate `solid_at`) |
| **Bugs fixed** | the P2 gravity-frame hardcode; the unchecked P1⊇P2 invariant; the CellType-vs-mask disagreement |
| **Risk** | **HIGH.** P1 feeds the baked nav cache (130 MiB on disk, `nav_cache.h:116` version 2). Any change to P1's bar invalidates every cached bake and changes crowd routing globally. Do P2/P3/P4 unification first and leave P1 alone until there is a parity test. |

---

## 11. Entity / agent identity — the conversion mesh

### 11.1 Five id spaces mean "a living thing"

| # | Type | Definition | Width | Stable across | Serialized? |
|---|---|---|---:|---|---|
| I1 | `Entity` = `entt::entity` | `src/ecs/registry.h:13` | 32 | one session, one embodiment | **no** |
| I2 | `NpcId` | `src/game/npc_pool.h:71` | 32 (20 used) | forever (slot index) | **no** — pool is reproduced by `seed_floor_population` |
| I3 | `NpcHandle` | `src/game/npc_pool.h:102` | 32 (20 id + 12 gen) | forever, death-checked | via `quest.h:237` `ar.u32(p.giver)` |
| I4 | `MobRef` | `src/game/mob_spawn.h:43` | — | **has no id at all** | no |
| I5 | `LayerId` | `src/world/level_stack.h:21` | 32 | storage slot, **recycled** | indirectly |

Also `ModuleId` (`floor_registry.h:30`), `ItemId` (`item_table.h:46`),
`QuestId` (`quest.h:112`) — not living things, listed for completeness.

### 11.2 The conversions — and the one that does not exist

**I1 → I2** is trivial and used **74 times**: `reg.get<NpcRef>(e).id` /
`reg.try_get<NpcRef>(player)->id`.

**I2 → I1 has no function.** There is no `entity_for(NpcId)` anywhere:
```
grep -rn "entity_for|entity_of|npc_entity|entity_from|id_to_entity|entity_to_id|npc_for|to_entity|lookup_entity" src → 0 hits
```
Every site that needs it writes a **linear `view<NpcRef>` scan**. All 25 such views:

`src/app/main.cpp:1448, 1474, 1497, 6470`;
`src/game/ai.cpp:557, 649, 717, 1129, 1237, 1264`;
`src/game/combat.cpp:975, 1605, 1811`;
`src/game/encumbrance.cpp:60`; `src/game/faction_relations.cpp:164, 227`;
`src/game/hunt.cpp:41`; `src/game/loot.cpp:355, 411, 493`;
`src/game/needs.cpp:61, 267`; `src/game/rumour.cpp:76`; `src/game/speech.cpp:164`.
(`src/game/ai.h:34` documents a 26th in prose.)

Plus 16 `view<MobRef>` scans: `main.cpp:246, 1056, 3817, 5462`;
`combat.cpp:728, 1600, 1806, 2294`; `investigate.cpp:76`; `loot.cpp:324`;
`mob_spawn.cpp:437, 446`; `rumour.cpp:30`; `samosbor.cpp:591`; `ai.h:24` (prose).

**I4 has no id**, so a mob cannot be named across a save or by a quest — `MobRef`
(`mob_spawn.h:43-49`) carries `kind/level/hp/maxHp/pack` and nothing identifying.
This is an asymmetry with I2, not necessarily wrong (`npc_pool.h:36-38` states mobs are
deliberately not in the macro model), but it means "kill that specific monster" is
unexpressible.

**I2 → I3** is `npc_handle(id, gen)` (`npc_pool.h:107`), `npc_handle_id`,
`npc_handle_gen` (`:112, 113`). `npc_pool.h:22-27` names the **six places that store a
bare `NpcId` across time** and must migrate to I3 before slot recycling can ship:
`Relationship::target`, `NpcRef::id`, `Contract::giver`, `FloorModule::candidate`,
`MacroSim::Journey::id` (`macro_sim.h:336`), `RelationEdge::id`. `quest.h:327` documents
a *deliberate* half-migration — the parameter stays `NpcId`, the stored field is a
handle. `macro_sim.h:114-116` documents another deliberate non-migration.

This is the healthiest part of the mesh: it is **written down, in the header, with the
reason.** But it is still five id spaces with one missing edge and one hand-rolled
comparison helper per consumer (`macro_sim.h:144 social_edge_target`,
`:155 social_edge_set`).

### 11.3 "Is this the player?" — three answers

| Mechanism | Sites |
|---|---:|
| `all_of<CameraTag>` / `view<CameraTag>` | **38** |
| `pool.is_player(id)` / `NpcPlayer` bit (`npc_pool.h:199, 386, 397`) | **27** |
| `e == player` (the `Entity player` local threaded through `main.cpp`) | 4 |

`src/game/embody.h:11` states the design — *"No player singleton"* — and
`embody.h:73` says setting the `NpcPlayer` bit is "the ONLY thing that makes a player".
It is not: 38 sites ask `CameraTag` instead. `npc_pool.cpp:295` records a **live bug
already caused by this**: `kill()` was not clearing `NpcPlayer`.

### 11.4 The dominant query these scans implement

52 sites hand-roll *"nearest entity matching a predicate, on my layer, within reach,
by toroidal distance"* (`bestD2`-shaped):

| Count | File |
|---:|---|
| 25 | `src/app/main.cpp` |
| 9 | `src/game/door.cpp` |
| 6 | `src/game/combat.cpp` |
| 3 | `src/game/rumour.cpp` |
| 3 | `src/game/noise.cpp` |
| 3 | `src/game/hunt.cpp` |
| 3 | `src/game/faction_relations.cpp` |

The generalized versions that **do** exist: `find_nearest_interactable`
(`prop_system.cpp:539`), `nearest_prey` (`hunt.cpp:33`), `nearest_speaker`
(`rumour.cpp:61`), `possess_nearest_survivor` (`main.cpp:1469`),
`door_nearest_shelter` (`door.cpp:434`). **Five parallel specialisations of one query**,
and the most general of them carries the Y-axis bug (§1.2 site 8).

### 11.5 Proposal

1. Add `Entity npc_entity(const Registry&, NpcId)` backed by a
   `std::vector<Entity>` side-index maintained by `embody`/`fold_back`
   (`embody.h:73, 78` are the only two mutation points). O(1) instead of 25 O(n) scans.
2. Add one generic query in `src/game/query.h`:
   ```cpp
   template <class... Cs, class Pred>
   Nearest nearest_entity(const Registry&, vec3 from, LayerId, float reachM, Pred&&);
   ```
   built on `torus_dist2` from §1.4. Re-express all 5 existing specialisations and the
   52 hand-rolled loops on top of it.
3. Make `is_player(Entity)` one function and delete the `CameraTag`-as-player-test idiom.

| | |
|---|---|
| **LOC removed** | ~350 (52 nearest-loops × ~8 lines → ~2, minus ~60 lines of new machinery) |
| **Bugs fixed** | 8 Y-axis sites collapse into 1 correct helper; the `CameraTag`/`NpcPlayer` fork |
| **Risk** | **MEDIUM.** The side-index must be maintained on every embody/fold_back/kill path or it goes stale — the exact failure `npc_pool.cpp:295` already recorded for the `NpcPlayer` bit. Assert `npc_entity(id)` agrees with a debug-only linear scan under a `GIGA_*_DBG` env var (the project's existing idiom, §9). |

---

## 14. Serialization helpers

**Verdict: this is the one cluster that is already right — with one exact duplicate.**

`src/game/save.cpp` uses a single-visitor pattern: one `template <class Ar, class T>
visit_*(Ar&, T&)` per struct, instantiated by both a `Writer` and a `Reader`, so the two
halves of the format cannot drift. `save.cpp:214-216, 238-243` and `save.cpp:50-56`
carry the reasoning. Visitors found: `visit_header` (`:179`), `visit_ledger` (`:203`),
`visit_contract` (`:217`), `visit_book` (`:229`), `visit_needs` (`:244`),
`visit_inventory` (`:258`), and more below.

`src/game/nav_cache.cpp:16-20` explicitly cites `save.cpp` and uses the same pattern
(`ar.u16(g.edge[i][d])` at `:159`, etc.).

**The duplicate:** `nav_cache.cpp` re-implements `Writer` and `Reader` verbatim.

| Class | `save.cpp` | `nav_cache.cpp` | Relationship |
|---|---|---|---|
| `Writer` | `:45-…` (`u8 :49`, `b8 :57`, `u16 :58`, `u32 :62`, `u64 :66`, `i16 :73`, `i32 :77`, `i64 :81`, `f32 :87`) | `:23-48` (`u8 :27`, `u16 :28`, `u32 :32`, `u64 :36`, `i32 :44`) | nav_cache's 5 methods are **line-for-line identical** to save's |
| `Reader` | `:99-177` (`u8 :103`, `b8 :111`, `u16 :116`, `u32 :123`, `u64 :131`, `i16 :138`, `i32 :143`, `i64 :148`, `f32 :153`, `skip :160`) | `:52-97` (`u8 :56`, `u16 :64`, `u32 :71`, `u64 :79`, `i32 :85`) | **byte-identical bodies**, incl. the `b[4]`/`b[8]` locals and the `for (int i = 7; i >= 0; --i)` u64 loop |

Little-endian byte-at-a-time is handled in exactly **one** place per class (`u8`), and
bounds-checking in exactly one (`Reader::u8`) — `nav_cache.cpp:50-51` states this.
So versioning/endianness are **not** duplicated N times; only the two archive classes are.

`nav_cache.cpp` additionally owns file I/O the save path does not:
`read_exact :318`, `write_exact :321`, `write_atomic :333` (temp + rename).
`save.cpp` has no atomic-write equivalent — an asymmetry worth noting: the **nav cache**
is crash-safe on write and the **player's save** is not.

### 14.1 Proposal

Move `Writer`/`Reader` to `src/core/archive.h` (~120 lines, the union of both). Keep
`visit_*` where the structs are. Optionally promote `write_atomic` so `save.cpp` gets
crash-safety for free.

| | |
|---|---|
| **LOC removed** | ~75 (`nav_cache.cpp:23-97` deleted wholesale) |
| **Risk** | **LOW** — pure code motion, both formats already produce identical bytes for identical fields. `tests/suite_saveload.inl` (2053 lines) and `tests/suite_navcache.inl` (1316 lines) both exist and would catch a regression. |

---

## 16. Vulkan resource teardown

### 16.1 Confirmed and larger than the lead: **8 unwind ladders**, not 6

Init order in `src/app/main.cpp` (declaration → `init()`):
`device :1607/1613` → `renderer :1620/1621` → `lightGrid :1631/1632` →
`voxelMirror :1639/1640` → `cubePass :1650/1651` → `raymarchPass :1667/1668` →
`bodyPass :1684/1685` → `propPass :1701/1702` → `cullPass :1708/1709` →
`wirePass :1714/1715` → `clothPass :1721/1722` → `gasPass :1732` →
`particlePass :1739/1740` → `hud :1754/1755`.

| # | Ladder | Lines | Destroys | Missing vs full |
|---|---|---|---:|---|
| L1 | renderer init fail | `1623-1626` | device | — (nothing else exists yet) |
| L2 | voxelMirror init fail | `1642-1647` | lightGrid, renderer, device | — |
| L3 | cubePass init fail | `1654-1660` | voxelMirror, lightGrid, renderer, device | — |
| L4 | raymarchPass init fail | `1672-1679` | voxelMirror, cubePass, lightGrid, renderer, device | — |
| L5 | bodyPass init fail | `1687-1695` | raymarchPass, voxelMirror, cubePass, lightGrid, renderer, device | — |
| L6 | **hud init fail** | `1758-1766` | bodyPass, raymarchPass, voxelMirror, cubePass, renderer, device | **lightGrid, propPass, cullPass, wirePass, clothPass, gasPass, particlePass** |
| L7 | **player == null** | `1993-2002` | hud, bodyPass, raymarchPass, voxelMirror, cubePass, renderer, device | **lightGrid, propPass, cullPass, wirePass, clothPass, gasPass, particlePass — exactly 6 named passes + lightGrid** |
| L8 | normal exit | `7244-7257` | hud, particlePass, clothPass, wirePass, cullPass, propPass, bodyPass, raymarchPass, voxelMirror, cubePass, lightGrid, renderer, device | — (gasPass relies on its dtor) |

**"one of which omits 6 passes" — confirmed exactly at L7.**

### 16.2 The root cause: two lifetime idioms coexist

| Has `~Pass(){destroy();}` | Does **not** |
|---|---|
| `GpuLightGrid` (`gpu_light_grid.h:77`), `PropPass` (`prop_pass.h:33`), `GpuCullPass` (`gpu_cull_pass.h:45`), `WirePass` (`wire_pass.h:45`), `ClothPass` (`cloth_pass.h:47`), `ParticlePass` (`particle_pass.h:47`), `GpuGasPass` (`gpu_gas_pass.h:30`) | `CubePass` (`cube_pass.h:63`), `BodyPass` (`body_pass.h:46`), `RaymarchPass` (`raymarch_pass.h:44`), `VoxelMirror` (`voxel_mirror.h:129`), `ImGuiLayer` (`imgui_layer.h:23`), `VulkanRenderer` (`vk_renderer.h:96`), `VulkanDevice` (`vk_device.h:42`) |

The manual ladder exists **only** because the second column has no destructors. If all
14 had them, `main()` would need **zero** teardown lines and all 8 ladders would vanish.

### 16.3 The ladders are not merely ugly — L6 and L7 crash

`VulkanDevice::destroy()` (`vk_device.cpp:276-295`) sets `device = VK_NULL_HANDLE`
(`:279`) **and destroys the instance** (`:292`). The RAII destructors then run at scope
exit — i.e. **after** `device.destroy()` — and there are two guard idioms:

| Guard | Classes | Behaviour after `device.destroy()` |
|---|---|---|
| **A**: `if (!dev_ \|\| dev_->device == VK_NULL_HANDLE) return;` | `GpuLightGrid` (`gpu_light_grid.cpp:321`), `GpuCullPass` (`gpu_cull_pass.cpp:62`), `GpuGasPass` (`gpu_gas_pass.cpp:296`) | early-return — **safe** |
| **B**: `if (dev_ == nullptr) return;` / `if (!dev_) return;` | `WirePass` (`wire_pass.cpp:342`), `ClothPass` (`cloth_pass.cpp:341`), `ParticlePass` (`particle_pass.cpp:316`), `PropPass` (`prop_pass.cpp:239`) | `dev_` still points at the live stack object → falls through → **`vkDestroyPipeline(VK_NULL_HANDLE, realPipeline, nullptr)`** |

On L6 (`1758`) and L7 (`1993`) the four guard-B passes are fully initialised and are
**not** in the ladder, so their destructors fire after `device.destroy()`. Passing
`VK_NULL_HANDLE` as the `device` parameter is undefined behaviour per spec; the loader
dereferences a dispatch table from a null handle. **These are the ImGui-init-failure and
population-seeding-failure exit paths — i.e. the paths that run when something already
went wrong.**

On the normal path L8, guard-B `destroy()` is idempotent (each nulls `dev_` at the end:
`wire_pass.cpp:358`, `cloth_pass.cpp:357`, `particle_pass.cpp:331`, `prop_pass.cpp:253`),
so the explicit call followed by the destructor is safe.

### 16.4 Two smaller defects in the same cluster

- **Teardown order contradicts its own label.** `main.cpp:7243` says
  `// --- teardown (reverse order)`. Reverse init order would be
  `… raymarchPass, cubePass, voxelMirror, lightGrid`. The actual sequence is
  `… raymarchPass, voxelMirror(:7253), cubePass(:7254), lightGrid`. `voxelMirror` and
  `cubePass` are **swapped** — and `main.cpp:1637-1638` explicitly documents that
  `voxelMirror` must init *before* `cubePass` because cubePass carries its shadow set.
  Every one of L3, L4, L5, L6, L7, L8 has the same inversion.
- **`gasPass` is never explicitly destroyed** — no `gasPass.destroy()` exists anywhere
  (`grep -rn '\.destroy()' src` confirms). It relies on `~GpuGasPass` (guard A), which
  early-returns after `device.destroy()`, so its resources are reclaimed only implicitly
  by `vkDestroyDevice`. Correct by accident, inconsistent by design.

### 16.5 Proposal

1. Give `CubePass`, `BodyPass`, `RaymarchPass`, `VoxelMirror`, `ImGuiLayer`,
   `VulkanRenderer` the same `~X(){destroy();}` + deleted copy that the other 7 have.
2. Normalise **all 11** `destroy()` guards to form **A**
   (`!dev_ || dev_->device == VK_NULL_HANDLE`). This alone closes the L6/L7 crash.
3. Declare the passes in a struct (or just rely on reverse-declaration order) and
   **delete all 8 ladders** — `main()` keeps only `audioSys.shutdown(); SDL_DestroyWindow; SDL_Quit;`.
4. Fix the `voxelMirror`/`cubePass` inversion while the sequence still exists.

| | |
|---|---|
| **LOC removed** | ~55 (8 ladders totalling ~62 lines → ~7) |
| **Bugs fixed** | UB/crash on 2 error-exit paths; the documented-order inversion; `gasPass`'s accidental correctness made deliberate |
| **Risk** | **LOW-MEDIUM.** Destruction order becomes reverse-declaration order, which is what the comment already claims it is. Validate with `VK_LAYER_KHRONOS_validation` on a clean exit and on a forced `hud.init` failure. |

---

## Near-identical files — measured, not assumed

Method: strip blank lines and (for the render pass table) `//` comments, collapse
whitespace, `difflib.SequenceMatcher` on the line sequence.

### Render passes — the real find

| A | B | LOC A | LOC B | ratio | matched lines |
|---|---|---:|---:|---:|---:|
| `src/render/cloth_pass.cpp` | `src/render/wire_pass.cpp` | 317 | 316 | **86.3%** | 273 |
| `src/render/particle_pass.cpp` | `src/render/wire_pass.cpp` | 290 | 316 | **76.2%** | 231 |
| `src/render/cloth_pass.cpp` | `src/render/particle_pass.cpp` | 317 | 290 | **76.1%** | 231 |
| `src/render/body_pass.cpp` | `src/render/prop_pass.cpp` | 259 | 291 | 45.5% | 125 |

All-pairs over all 20 `src/render/*.cpp`; nothing else exceeds 40%.

The three GPU-verlet passes are one system written three times: same descriptor-set
layout creation, same two-pipeline (compute-sim + graphics-draw) construction, same
SSBO pair, same `destroy()`, same guard idiom. Only the vertex format, the sim shader
name, and the constraint solve differ.

Their shaders are less duplicated than their C++:

| A | B | ratio |
|---|---|---:|
| `shaders/wire_sim.comp` | `shaders/cloth_sim.comp` | 57.5% |
| `shaders/wire_sim.comp` | `shaders/particle_sim.comp` | 20.7% |
| `shaders/cloth_sim.comp` | `shaders/particle_sim.comp` | 19.8% |

**Proposal:** one `GpuVerletPass` base (or a `VerletPassDesc` + free functions) owning
descriptor layout, the sim+draw pipeline pair, the SSBO pair, upload, and `destroy()`.
The three passes become ~60-line configs.
**LOC removed: ~380.** **Risk: LOW** — pure refactor, no behaviour, and
`tests/suite_particles.inl` + `tests/suite_antourage.inl` cover the outputs.

### The test-suite pairs — **lead REFUTED**

| A | B | LOC A | LOC B | ratio | shared |
|---|---|---:|---:|---:|---:|
| `tests/suite_needs.inl` | `tests/suite_needs2.inl` | 985 | 364 | **3.7%** | 25 lines |
| `tests/suite_samosbor.inl` | `tests/suite_samosbor2.inl` | 547 | 591 | **2.1%** | 12 lines |
| `tests/suite_props.inl` | `tests/suite_props_game.inl` | 94 | 744 | **1.4%** | 6 lines |

These are **not** near-identical. The `*2` files are genuine continuations, not copies.
The naming is bad (`suite_needs2` tells you nothing) but there is no duplication to
remove. **Do not act on this lead.**

### `padic_gen.cpp` vs `blame_gen.cpp` — **lead mostly refuted**

| A | B | LOC A | LOC B | ratio | shared |
|---|---|---:|---:|---:|---:|
| `src/game/floors/padic/padic_gen.cpp` | `src/game/floors/blame/blame_gen.cpp` | 654 | 677 | **15.0%** | 100 lines |

15% is boilerplate (includes, namespace, `kDim` loops, the 4-corner-post idiom at
`blame_gen.cpp:637-638` / `padic_gen.cpp:542-543`), not a shared algorithm. The
floor-module isolation law is holding. The 100 shared lines are worth a small
`floors/common.h`, nothing more.

---

## Copy-paste blocks inside the big files

Method: strip comments, normalise strings→`S`, numbers→`N`, identifiers→`I`, hash
sliding 12-line windows, keep non-overlapping repeats.

### Findings that are real

**`src/game/combat.cpp` — three projectile spawners share ~30 lines each.**
`spawn_projectile` (`:1108`), `spawn_projectile_dir` (`:1210`), `spawn_grenade` (`:1253`).
Shared skeleton, verified line by line:
- `float speed = projSpeedMmps * 0.001f * kCellSize; if (speed < 1.0f) speed = 12.0f;`
  → `:1114`, `:1215`, `:1259`
- normalise `dir`, bail on `len < 1e-4f` → `:1216-1218`, `:1260-1262`
- `tr.pos = stf ? muzzle_point(...) : {from + u * kMuzzleForward}` → `:1231-1234`, `:1274-1277`
- `emplace<Transform> / <Velocity> / <AABB{0.10}> / <SelfIntegrating> / <Renderable>`
  → `:1236-1243`, `:1279-1287`, and `SelfIntegrating` at `:1195, 1242, 1284`

One `Entity spawn_ballistic(Registry&, LayerId, from, dir, speed, colour, Projectile)`
absorbs all three. **~55 LOC removed. Risk LOW.**

**`src/game/door.cpp:228-252` vs `:278-302`** — two byte-identical 5×5×3 = 75-cell
box scans (`door_query_near` / `door_use_near`). One `door_pick_near()` returning the id.
**~24 LOC. Risk LOW.**

**`src/app/main.cpp:3091-3114` vs `:3708-3726`** — the same 17×17 wall-finding scan
written twice, including the truncating-cell-conversion bug (§2.3). **~24 LOC. Risk LOW.**

### Findings that are NOT debt (reported so they are not re-raised)

- **`item_table.cpp` (3174), `craft_table.cpp` (1488), `mob_table.cpp` (974),
  `speech_table.cpp` (367)** dominate the repeat detector (108×, 69×, 10× repeated
  12-line blocks) — but all four carry a `// GENERATED by tools/gen_*.py` banner on
  line 1. Their repeats are *data rows*. Not debt.
- **`src/game/loot_table.cpp` (363)** has **no** GENERATED banner
  (`loot_table.cpp:1-11` describes a hand transcription from the reference's
  `monster_ecology.ts`). It is the odd one out among the table `.cpp`s and is the one
  that *should* move to CSV + a generator.
- **`main.cpp:53-111`** flagged ×5 — it is the `#include` block. False positive, but it
  surfaced two genuine duplicate includes: `game/macro_sim.h` at **`:58` and `:92`**,
  `sim/fluid.h` at **`:88` and `:122`**.
- **`save.cpp:179-333`** flagged repeatedly — those are the `visit_*` field lists, which
  are exactly what the visitor pattern is *for*. Not debt (see §14).

---

## 7. Math helpers — mild

`src/core/math.h` (104 lines) is used and mostly not bypassed.

| Bypass | Count | Sites |
|---|---:|---|
| inline `sqrt(a*a + b*b [+ c*c])` instead of `length()` | 12 | `src/render/intro_ui.cpp` (4), `src/game/wander.cpp` (2), `src/game/combat.cpp` (2), `src/sim/physics.cpp` (1), `src/render/prop_pass.cpp` (1), `src/game/noise.cpp` (1), `src/audio/spatial_audio.cpp` (1) |
| hand-rolled `a + (b-a)*t` instead of `lerp()` | 5 | — |
| `std::clamp` direct | 34 across 17 files | vs `clamp01` 26 uses, `lerp` 7 uses |

`src/audio/dsp_math.h` (148 lines) is a **second math header**, but it is a legitimate
DSP-domain module (`kPi/kTwoPi/kHalfPi`, `splitmix32`, biquads) — the only overlap with
`core/math.h` is the π constants. Not a duplication finding; it *is* a second PRNG
(`dsp_math.h:19` `splitmix32`), which belongs to §4/RNG.

**Verdict: not a top-20 item.** ~20 LOC, LOW risk, do it opportunistically.

---

## 9. Logging / string formatting — healthier than expected

| Mechanism | Call sites |
|---|---:|
| `std::fprintf` | **177** |
| `std::snprintf` | 127 |
| `ImGui::Text*` | 157 |
| `std::printf` | **0** |
| `std::cout` | **0** |
| `std::cerr` | **0** |
| `std::ostringstream` | **0** |
| `std::to_string` | **0** |

There is essentially **one** diagnostic mechanism (`fprintf(stderr, ...)`), one string
builder (`snprintf`), and one UI text path (ImGui). That is discipline, not sprawl.

11 env-gated debug channels, all following one naming convention:
`GIGA_WIRE_DBG` (2), `GIGA_ANTOURAGE_DEBUG` (2), `GIGA_WIRE_NOSIM`, `GIGA_TEXTURE_DIR`,
`GIGA_PARTICLE_NOSIM`, `GIGA_PARTICLE_DBG`, `GIGA_NO_GPU_CULL`, `GIGA_NO_CRT`,
`GIGA_LIGHT_DBG`, `GIGA_GPU_TIMER`, `GIGA_CARVE_DBG` — plus 2 Vulkan loader vars
(`VK_ICD_FILENAMES`, `VK_DRIVER_FILES`). The only inconsistency is
`GIGA_ANTOURAGE_DEBUG` vs everyone else's `_DBG`.

**Verdict: no action beyond renaming `GIGA_ANTOURAGE_DEBUG` → `GIGA_ANTOURAGE_DBG`.**
A `GIGA_DBG(channel, fmt, ...)` macro over the 11 `getenv` sites would save ~20 lines and
make the channel list enumerable, but this is polish. **LOW priority.**

---

## 4b. RNG and hashing

### 4b.1 The canonical home, and the consolidation that already happened

`src/core/rng.h` (74 lines, header-only, `constexpr`, deps = `<cstdint>` only):

| Symbol | Line | Algorithm | Constants |
|---|---|---|---|
| `hash_u32(u32)` | `:22-29` | lowbias32 | `>>16`, `*0x7feb352d`, `>>15`, `*0x846ca68b`, `>>16` |
| `spatial_hash(x,y,z,seed)` | `:34-41` | prime 3D mix + 2 murmur rounds | `73856093`, `19349663`, `83492791`, `0x45d9f3b` ×2 |
| `hash_u64(u64)` | `:44-51` | splitmix64 finalizer | `0xbf58476d1ce4e5b9`, `0x94d049bb133111eb` |
| `hash2(a,b)` / `hash3(a,b,c)` | `:56-58` / `:59-61` | order-sensitive combine | `0x9e3779b9`, `0x85ebca6b` |
| `rand01(u32)` / `rand_below(u32,n)` | `:64-66` / `:70-72` | top-24-bit float / modulo | `1/16777216.0f` |

`rng.h:6-12` states the stance: stateless hashing of `(id, tick, salt)`, no per-entity
state, no `<random>`, no globals. **41 files `#include "core/rng.h"`.**
`src/game/nav_cache.cpp:103` records that rng.h "now hosts the splitmix finalizer
**that had thirteen copies**" — a consolidation already succeeded once.

### 4b.2 Determinism — a clean bill of health

```
grep -E '\brand\(\)|\bsrand\b|mt19937|minstd|default_random_engine|
         uniform_(int|real)_distribution|random_device|<random>' src shaders tools tests
```
→ **3 hits, all comments/prose**: `src/core/rng.h:12`, `src/game/loot_table.cpp:331`,
`tests/suite_diffusion.inl:372`. **Zero** clock-seeded, `random_device`-seeded or
uninitialised RNGs. Every `<chrono>` use is telemetry or a file mtime, never a seed.
`import random` / `time.time` in `tools/*.py` → **zero**.

**This is a genuine strength and should be stated as such.**

### 4b.3 21 independent implementations in shipping code (canonical count: ~4)

| # | Definition | Algorithm | Deterministic? |
|---|---|---|---|
| 1 | `src/core/rng.h:22,34,44,56,59` | **CANON** | ✅ |
| 2-4 | `src/audio/dsp_math.h:19-24, 26-28, 30-32` `splitmix32*` | **Murmur3 fmix32 body under the name splitmix32** — a *different* mixer from canon | ⚠️ §4b.4 |
| 5 | `src/app/main.cpp:1198-1208` `ParticleRng::next` | xorshift32 (`<<13, >>17, <<5`) | ✅ burst seed |
| 6-8 | `src/render/intro_ui.cpp:77-80, 81-83, 84` | xorshift32 — **copy of #5** | ⚠️ §4b.4 |
| 9 | `src/world/destruct.cpp:119-123` `mix` | ad-hoc probe hash | ✅ |
| 10 | `src/world/destruct.cpp:232-241` `carve_hash` | boost-combine ⊕ murmur | ✅ frozen by `tests/suite_destruct.inl:58-59,74` |
| 11 | `src/game/faction.h:60-62` | ad-hoc 2-step | ✅ |
| 12 | **`src/game/combat.cpp:2072-2076`** | **`hash_u32` inlined character-for-character** | ✅ |
| 13 | `src/game/mob_behaviour.cpp:55` | glibc LCG multiplier `1103515245` as a bare hash | ✅ |
| 14 | `src/game/floors/blame/blame_gen.cpp:64-70` | NR LCG `*1664525 + 1013904223` | ✅ seeded `:110-111` |
| 15 | `src/game/floors/padic/padic_gen.cpp:81-87` | **byte-identical duplicate of #14** | ✅ seeded `:213-216` |
| 16 | `src/game/save.cpp:425-432` `fnv1a_cstr` | FNV-1a 32 | ✅ |
| 17 | `src/game/quest.cpp:184-190` `fnv1a_cstr` | **duplicate of #16** (`:182` admits it) | ✅ |
| 18 | `src/game/ai.h:341-349` `fnv_fold` | **third FNV-1a**, decimal `16777619u` | ✅ |
| 19 | `src/render/screenshot.cpp:15-25` `crc32_of` | CRC-32 `0xEDB88320` | ✅ |
| 20 | `src/game/save.cpp:412-419` `crc32` | **duplicate of #19** | ✅ |
| 21 | `src/game/nav_cache.cpp:110-118` `crc32` | **triplicate of #19** | ✅ |

Test-only (deliberately independent, `tests/suite_quest.inl:105-108` explains why — **not
a defect**): `tests/sim_bench.cpp:65-68`, `tests/suite_quest.inl:110-118`,
`tests/suite_saveload.inl:753-760`, `tests/suite_utilai.inl:143-160`,
`tests/suite_navcache.inl:184`, `tests/suite_economy.inl:59` + `tests/suite_macrosim.inl:61`.

**#12 verified today, line by line.** `src/game/combat.cpp:2072-2076`:
```cpp
seed += 0x9e3779b9u;
std::uint32_t h = seed;
h ^= h >> 16; h *= 0x7feb352du;
h ^= h >> 15; h *= 0x846ca68bu;
h ^= h >> 16;
```
is `giga::hash_u32` (`rng.h:23-27`) verbatim — in a file that already
`#include`s `core/rng.h` at `combat.cpp:31`. The comment at `:2071` even says
"the same idiom the spawner and the loot roller use". **Zero-risk one-line deletion.**

### 4b.4 Six streams seeded from literals and advanced by frame/callback order

None are clock-seeded, but none derive from the world seed either — their output is a
function of frame rate and audio-callback scheduling:

| Stream | Seed literal | Declared | Advanced at |
|---|---|---|---|
| `AudioMixer::mixerRng_` | `0x543210fe` | `src/audio/audio_mixer.h:60` | `audio_mixer.cpp:65`, read `:141,150,156,164,171,173,192,207` |
| `SynthUi::globalRng_` / per-slot `rng` | `0xabcdef12` / `0x900dcafe` | `src/audio/synth_ui.h:33` / `:27` | `synth_ui.cpp:47, 82, 134` |
| `SynthAmbient::crackleRng_` | `0xbeefcafe` | `src/audio/synth_ambient.h:40` | `synth_ambient.cpp:116,118,121` |
| `SynthGeiger::rngState_` | `0x1337beef` | `src/audio/synth_geiger.h:38` | `synth_geiger.cpp:89,109,110` |
| **`IntroFx::seed`** | `0x7E9E71C` | `src/render/intro_ui.h:52` | `intro_ui.cpp:231,233,262-263,312,315,358,365-366,368` — **advanced inside a per-frame update, never re-seeded → frame-rate-dependent by construction** |
| `SubField`/`Field` string maps | — | `src/world/subfield.h:39,217`, `src/world/field.h:20,114` | `std::hash<std::string>` is unspecified — safe only while nothing iterates them order-sensitively |

Audio and intro are presentation-only, so **sim determinism is not broken**. But none of
these is reproducible from a world seed, and `IntroFx` is a wall-clock-driven RNG in all
but name.

### 4b.5 The floor-seed formula written 4×

`1337u ^ (floorNumber * 0x9e3779b9u)` appears independently at:
`src/app/main.cpp:1074` (`wallSeed`), `src/app/main.cpp:1914` (`fseed`),
`tools/xray_map.cpp:64-66` (comment: *"Тот же посев, что в main.cpp"*),
`tests/sim_bench.cpp:190`.
Two more bases live only at their call sites: `0xC0FFEE ^ floor*golden` (containers,
`main.cpp:1037`, copy-pasted into `tests/suite_audit.inl:979`) and
`0xB0B5EED ^ floor*golden` (mobs, `main.cpp:1052`).

Meanwhile the canonical accessor **`FloorStreamer::floor_seed_of`
(`src/game/floor_stream.cpp:68-73`, decl `floor_stream.h:210`) exists** and is used at
`main.cpp:1969, 1977, 2604, 2620, 4810, 4816, 7126, 7144`. **Two seed regimes coexist.**

### 4b.6 GLSL hashes — 4 duplicate pairs, one banned algorithm in use

| # | Site | Algorithm | Note |
|---|---|---|---|
| G1-G3 | `shaders/cube.frag:132-138`, `shaders/prop.frag:37-41`, `shaders/raymarch.frag:288-292` `hash21` | Dave-Hoskins float lattice | **3 byte-identical copies**; `raymarch.frag:283-286` calls itself a "verbatim port" |
| G4 | `cube.frag:141-152`, `prop.frag:43-52`, `raymarch.frag:294-303` `vnoise` | value noise over G1-G3 | **3 identical copies** |
| G5 | `shaders/flicker.glsl:21-46` ↔ **`src/game/flicker.h:26-59`** | 1D Hoskins + `flicker_factor` | ✅ **CORRECT constant-for-constant CPU/GPU mirror**, intentional (`flicker.glsl:5-9`, `flicker.h:3-6`). This is the model. |
| G6 | `shaders/volumetric_fog.glsl:61-63` `ign_jitter` | Interleaved Gradient Noise | — |
| G7 | **`shaders/prop.frag:283`** | **verbatim inline duplicate of G6** — and `prop.frag:17` already `#include`s `volumetric_fog.glsl`, so `ign_jitter()` was in scope | pure copy-paste |
| G8 | **`shaders/volumetric_fog.glsl:194-197`** | **`sin(dot(i, vec2(12.9898,78.233))) * 43758.5453`** | **`shaders/cube.frag:133-135` explicitly BANS this hash**: *"Deliberately not the sin-based one: that has known precision artefacts on some drivers and shows as a diagonal moire."* Two contradictory house rules in one shader set. |

Shaders with no hash at all (verified): `particle_sim.comp`, `gas_sim.comp`,
`cloth_sim.comp`, `wire_sim.comp`, `light_grid.comp`, `cull.comp`, `post_pass.frag`,
`shadow_march.glsl`, `material_surface.glsl`, `particle.frag/vert`, `cloth.frag`,
`wire.frag`, `body.vert`, `prop.vert`.

Apart from flicker, CPU and GPU hash families share **zero constants** — defensible
(nothing needs parity for surface detail) but it means no test can pin them.

### 4b.7 Proposal

| Change | LOC | Risk |
|---|---|---|
| Delete `combat.cpp:2072-2076` → `giga::hash_u32(seed += 0x9e3779b9u)` | −4 | **NONE** |
| `src/core/hash.h`: one CRC-32 (seeded, absorbs `screenshot.cpp`'s form) + one FNV-1a-over-cstr | −27 | LOW — `nav_cache.cpp:100-105` already prescribes exactly this |
| Fold `blame_gen`/`padic_gen` LCGs into one `floors/common.h` | −7 | LOW |
| Replace 3 xorshift32s with `hash2(seed, i++)` (the `loot_table.cpp:37-40` idiom) | −20 | LOW |
| `dsp_math.h:19-32` → `hash_u32` + a Weyl counter (the `samosbor.cpp:56` idiom) | −10 | LOW (audio only) |
| GLSL: `hash21`+`vnoise` into a shared `.glsl` include; delete `prop.frag:283`; make `volumetric_fog.glsl:194-197` use `ign_jitter` | −40 | **MEDIUM** — changes fog dither pattern visibly |
| One `floor_seed_of` — delete the 4 hand-rolled formulas | −8 | **HIGH** — changes worldgen for every floor. Do only with a deliberate regen. |



## 5. CSV / table codegen — 14 generators, one program

### 5.1 Inventory

**14 generators, 3,835 lines of Python, consuming 16 CSVs totalling 990 lines.
That is 3.9 lines of generator per line of data.**

| Generator | LOC | Input CSV(s) | Output |
|---|---:|---|---|
| `tools/gen_quest_table.py` | 438 | quests + items + mobs | `src/game/quest_table.cpp` |
| `tools/gen_material_table.py` | 422 | materials + textures | `src/world/materials.h`, `src/world/material_props.h`, `src/render/material_table.h`, `shaders/material_surface.glsl` |
| `tools/gen_mob_table.py` | 377 | mobs | `src/game/mob_table.cpp` |
| `tools/gen_craft_table.py` | 357 | items + craft_recipes | `src/game/craft_table.cpp` |
| `tools/gen_prop_table.py` | 353 | props + interactables | `src/game/prop_table.h`, `.cpp` |
| `tools/gen_item_table.py` | 344 | items | `src/game/item_table.cpp` |
| `tools/gen_monster_traits.py` | 343 | monster_traits + mobs | `src/game/monster_traits_table.cpp` |
| `tools/gen_economy_table.py` | 264 | economy + items | `src/game/economy_table.cpp` |
| `tools/gen_speech_table.py` | 252 | speech_lines | `src/game/speech_table.cpp` |
| `tools/gen_ranged_table.py` | 213 | weapons_ranged + items | `src/game/ranged_table.cpp` |
| `tools/gen_status_table.py` | 139 | status + items | `src/game/status_table.cpp` |
| `tools/gen_weapon_table.py` | 131 | weapons_melee + items | `src/game/weapon_table.cpp` |
| `tools/gen_particle_table.py` | 109 | particles | `src/game/particle_table.h` |
| `tools/gen_interact_table.py` | 93 | interactables | `src/game/interact_table.h` |

### 5.2 The shared skeleton — 11 phases, present in 14/14

Byte-identical or structurally identical in every generator:

| Phase | Evidence (complete) |
|---|---|
| **1.** `import csv/os/sys` | 14/14 — `gen_item:13`, `gen_interact:16`, `gen_particle:17`, `gen_mob:17`, `gen_weapon:21`, `gen_prop:22`, `gen_monster_traits:25`, `gen_status:27`, `gen_material:32`, `gen_speech:34`, `gen_economy:37`, `gen_craft:37`, `gen_ranged:43`, `gen_quest:67` |
| **2.** `REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))` | **byte-identical 14/14** — `gen_item:17`, `gen_interact:20`, `gen_mob:21`, `gen_particle:21`, `gen_weapon:25`, `gen_prop:26`, `gen_monster_traits:29`, `gen_status:31`, `gen_material:37`, `gen_economy:42`, `gen_speech:38`, `gen_craft:41`, `gen_ranged:47`, `gen_quest:71` |
| **3.** `die(msg)` | 14/14 — `gen_interact:25`, `gen_particle:26`, `gen_weapon:34`, `gen_status:40`, `gen_item:51`, `gen_material:57`, `gen_prop:57`, `gen_economy:59`, `gen_ranged:62`, `gen_mob:74`, `gen_monster_traits:76`, `gen_craft:79`, `gen_speech:80`, `gen_quest:106` |
| **4.** `with open(CSV, encoding="utf-8", newline="") as fh: rows = list(csv.DictReader(fh))` | **23 call sites across 14/14** |
| **5.** `if len(rows) != EXPECTED_ROWS:` | 8/14. `EXPECTED_ITEM_ROWS = 443` written **5 times**: `gen_craft:49`, `gen_status:37`, `gen_weapon:31`, `gen_ranged:53`, + `src/game/item_table.h:49` |
| **6.** numeric coercion | **10 near-clones, 4 names, 4 signatures** — `num` (`gen_item:56`, `gen_monster_traits:81`, `gen_quest:139`, `gen_economy:68`, `gen_status:45`, `gen_prop:62`), `fixed` (`gen_weapon:39`, `gen_ranged:67`, `gen_mob:79`), `fnum` (`gen_material:62`). **`gen_item:56-63` ≡ `gen_monster_traits:81-88` byte-for-byte; `gen_weapon:39-45` ≡ `gen_ranged:67-74` byte-for-byte** |
| **7.** `cpp_string(s)` | **6 byte-identical copies** — `gen_craft:84-85`, `gen_economy:83-84`, `gen_item:110-111`, `gen_mob:136-137`, `gen_quest:148-149`, `gen_speech:85-86`; + a 7th inlined at `gen_prop:205` |
| **8.** enum + dup-name guard + clamped accessor | `gen_interact:35-38,60-63` ≡ `gen_particle:36-38,64-67` |
| **9.** `with open(OUT, "w", encoding="utf-8", newline="\n") as fh:` | **18 call sites, 12/14 identical** |
| **10.** banner + `namespace giga::game {` + FOOTER | 14/14 banner; 14 `namespace` sites in 13 files; **FOOTER byte-identical in 6** |
| **11.** stderr progress + `if __name__ == "__main__": main()` | 13/14 and **14/14** |

### 5.3 Pairwise similarity matrix

Method: strip blank lines, collapse whitespace, `difflib.SequenceMatcher` on line sequences.

| | craft | econ | inter | item | mat | mob | traits | part | prop | quest | ranged | speech | status | weapon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **craft** | — | 8 | 5 | 10 | 3 | 8 | 8 | 5 | 6 | 9 | 8 | 10 | 9 | 9 |
| **economy** | 9 | — | 11 | 10 | 6 | 10 | 9 | 10 | 8 | 11 | 12 | 11 | 13 | 15 |
| **interact** | 7 | 11 | — | 10 | 9 | 9 | 10 | **46** | 8 | 7 | 11 | 13 | 15 | 16 |
| **item** | 9 | 9 | 10 | — | 4 | **17** | **16** | 10 | 9 | 13 | 12 | 11 | 12 | 14 |
| **material** | 4 | 5 | 10 | 5 | — | 4 | 5 | 9 | 5 | 3 | 4 | 5 | 5 | 5 |
| **mob** | 8 | 8 | 9 | **17** | 3 | — | **16** | 9 | 6 | 9 | 9 | 11 | 9 | 11 |
| **traits** | 8 | 9 | 10 | **16** | 4 | **16** | — | 9 | 7 | 11 | 10 | 9 | 7 | 12 |
| **particle** | 7 | 10 | **46** | 10 | 8 | 9 | 9 | — | 8 | 7 | 10 | 12 | 15 | 15 |
| **prop** | 6 | 7 | 10 | 8 | 7 | 6 | 7 | 9 | — | 6 | 9 | 7 | 16 | 10 |
| **quest** | 9 | 10 | 7 | 13 | 4 | 9 | 11 | 7 | 6 | — | 10 | 9 | 10 | 11 |
| **ranged** | 8 | 12 | 11 | 12 | 5 | 9 | 11 | 10 | 8 | 10 | — | 11 | **23** | **36** |
| **speech** | 10 | 10 | 13 | 11 | 5 | 10 | 10 | 12 | 7 | 9 | 11 | — | 12 | 13 |
| **status** | 9 | 13 | 15 | 12 | 5 | 9 | 10 | 15 | **16** | 10 | **23** | 12 | — | **29** |
| **weapon** | 9 | 14 | 16 | 14 | 6 | 11 | 13 | 15 | 10 | 12 | **36** | 13 | **29** | — |

Whole-file ratios understate the problem because each generator's docstring and
per-column emission block are genuinely unique. The **shared-identical-line count** is
the honest measure:

- `gen_weapon` shares **48 of its 100 distinct lines (48%)** with `gen_ranged`
- `gen_interact` shares **36 of 72 (50%)** with `gen_particle`
- `gen_status` shares **31 of 110** with each of `gen_prop` and `gen_ranged`
- `gen_mob` ↔ `gen_monster_traits`: 48 shared; `gen_item` ↔ `gen_mob`: 47 shared

`gen_material_table.py` is the outlier (3–10% against everything) — it emits 4 artifacts
in 2 languages and is **the only script that factored its banner into a function**
(`gen_material_table.py:102 gen_header()`).

### 5.4 Copy-paste measured

**67 distinct normalised lines appear in ≥3 of the 14 generators, accounting for 577
line-instances out of 3,235 — 17.8% of all generator code.**

| Generator | dup lines | total | % |
|---|---:|---:|---:|
| `gen_interact_table.py` | 29 | 74 | **39%** |
| `gen_weapon_table.py` | 35 | 103 | **34%** |
| `gen_particle_table.py` | 30 | 90 | **33%** |
| `gen_status_table.py` | 34 | 112 | **30%** |
| `gen_item_table.py` | 58 | 288 | 20% |
| `gen_monster_traits.py` | 59 | 295 | 20% |
| `gen_ranged_table.py` | 36 | 180 | 20% |
| `gen_mob_table.py` | 54 | 325 | 17% |
| `gen_speech_table.py` | 35 | 211 | 17% |
| `gen_prop_table.py` | 49 | 301 | 16% |
| `gen_economy_table.py` | 33 | 220 | 15% |
| `gen_craft_table.py` | 39 | 308 | 13% |
| `gen_quest_table.py` | 45 | 367 | 12% |
| `gen_material_table.py` | 41 | 361 | 11% |

### 5.5 Two structural holes found while classifying

**HOLE 1 — `src/game/loot_table.cpp` (363 lines) is HAND-WRITTEN. Verified three ways today:**
1. No `// GENERATED by` banner — `loot_table.cpp:1` reads
   `// Per-kind death-drop DATA + the single-drop roll ([loot_table.h]).`
2. **`ls tools/ | grep -i loot` → empty.** No generator exists.
3. **`ls data/ | grep -i loot` → empty.** No CSV exists.

136 `rareDrops` rows + 3 `lootTable` rows were **transcribed by hand** from the TS
reference (`loot_table.cpp:3-5`), emitted as `constexpr MobLoot kMobLootTable[]`
(`:191`), guarded only by a `static_assert` (`:265`) and a **hand-computed**
`kLootTableValueChecksum = 104447` (`loot_table.h:228`). It is outside the drift gate
**by construction** — there is nothing to compare against.

All other table `.cpp`s carry the banner: `item_table.cpp`, `mob_table.cpp`,
`craft_table.cpp`, `speech_table.cpp`, `monster_traits_table.cpp`, `quest_table.cpp`,
`ranged_table.cpp`, `weapon_table.cpp`, `economy_table.cpp`, `prop_table.cpp/.h`,
`status_table.cpp`, `particle_table.h`, `interact_table.h`, `material_table.h`,
`materials.h`, `material_props.h`.
(Minor: `quest_table.cpp:1` uses ASCII `--` where the other 16 use `—`.)

**HOLE 2 — 5 of 14 generated tables ship OUTSIDE the drift gate.**
`tools/check_source_rules.cmake:415-453` registers **9** CSV↔header pairs (verified today
at lines 415, 417, 422, 427, 435, 438, 443, 447, 451): items, mobs, weapons_melee,
weapons_ranged, materials, props, interactables, particles, monster_traits.

**No registration exists for:** `craft_recipes.csv`, `quests.csv`, `speech_lines.csv`,
`status.csv`, `economy.csv`.

The quest hole is **documented as a known bug** at `src/game/quest.h:126-134`:
*"EXPECTED_ROWS bumped and the table regenerated without bumping kQuestCount here → …
That is exactly the hole Rule 7 exists to close."* And
`check_source_rules.cmake:420-422` and `:427-429` each contain an apology for this
recurrence. **It has now recurred five more times.**

**HOLE 3 — one runtime CSV parser, hand-rolled, for an empty file.**
`src/audio/audio_system.cpp:213-227` opens `data/sounds.csv` with `std::fopen` and
hand-rolls `fgets`/`strchr(line,'\n')`/`strchr(line,'\r')`/`strchr(line,',')`. No
quoting, no escaping, 2 columns only. Its slug→enum map is a **third** hand-rolled
name→index table (`audio_system.cpp:195-204`, `{const char*, SoundId}` + `strcmp` loop).
**`data/sounds.csv` is 14 bytes — a header line and nothing else** (verified today).
This is the one table that took the runtime path instead of the codegen path.

Confirmed: **zero CSV is parsed at runtime for game tables.** The only other `ifstream`
hits (`wire_pass.cpp:17`, `cloth_pass.cpp:17`, `particle_pass.cpp:17`) are SPIR-V loaders.

### 5.6 Proposal — one schema-driven generator

`tools/gen_tables.py` (one driver, ~280 lines) + `data/schema/*.toml` (one declarative
schema per table, ~470 lines total). The schema states declaratively what the 14 `main()`
bodies state imperatively: CSV path, output path, struct/array names, expected rows, and
per-column `{csv, cpp, type, scale, range}`, plus `[[index]]` stanzas for the sparse
FK tables and `[[strings]]` for the parallel name arrays.

The driver owns the entire §5.2 skeleton once: REPO resolution, `die`, CSV open + row
gate + FK map building, **one** `coerce(text, type, scale, range)` replacing the 10
clones, **one** `cpp_string`, banner/namespace/footer emission, enum emission, the
progress line.

Seven generators collapse **completely** (schema only, no Python left):
`gen_interact` (93→~25), `gen_particle` (109→~30), `gen_status` (139→~30),
`gen_weapon` (131→~30), `gen_ranged` (213→~40), `gen_prop` (353→~55),
`gen_economy` (264→~40) — **1,302 → ~250**.

Seven keep a small `validate()`/`derive()` hook for genuinely bespoke logic
(`gen_item`'s `spawn_weight`/`room_mask`/`item_mass_g`; `gen_mob`'s bit-vocabulary and
V-shape budget; `gen_monster_traits`' 21→68 dense expansion; `gen_craft`'s recipe
synthesis; `gen_quest`'s `check_fetch`/`check_hunt`/`check_descend`; `gen_speech`'s
bucket sort; `gen_material`'s 4-artifact GLSL codegen) — **2,533 → ~1,140**.

| | LOC |
|---|---:|
| Today (14 generators) | 3,835 |
| After (driver + schemas + hooks) | ~1,640 |
| **Net removed** | **≈ −2,200 (−57%)** |
| Conservative floor (only mechanically-provable duplication) | **≥ −800** |

**Two free structural wins that matter more than the LOC:**
- The driver auto-emits `_giga_csv_vs_header()` registrations into a generated
  `tools/generated_gates.cmake` — **HOLE 2 closes structurally**, and adding a table
  outside the gate becomes impossible rather than merely discouraged.
- A `--check` mode (regenerate to memory, diff the committed artifact, non-zero exit)
  becomes one ctest that kills the whole class of "someone hand-edited a generated .cpp".

Plus: `EXPECTED_ITEM_ROWS = 443` stops being written in 5 places; `data/sounds.csv` joins
the codegen path and deletes ~45 lines of hand-rolled C++ parser; and
`loot_table.cpp`'s 363 hand-transcribed lines become `data/loot_drops.csv` + a schema,
gaining a drift gate and a generator-computed checksum.

**Risk: LOW for the 7 collapsing generators** (output is byte-comparable — regenerate and
`diff`, which is the acceptance test). **MEDIUM for the 7 hook generators.**
**MEDIUM-HIGH for the `loot_table` migration** — the hand checksum `104447` must be
reproduced exactly or `loot_table.h:228`'s `static_assert` fires.

---

## 6. Generated-table access idiom — **15 tables, 15 shapes, zero pairs agreeing**

| Table | Count symbol / type | Base | By-id | Bounds? | On failure | By-name | Validity | Return | Accessor lives |
|---|---|---|---|---|---|---|---|---|---|
| item | `kItemCount` `size_t` | **1** | `item_def` `item_table.h:156` | **NO** | UB | `item_by_string` O(n), case-**sens** | `item_valid` sep. `:153` | `const&` | inline hdr |
| mob | `kMobKindCount` derived | 0 | `mob_def` `mob_table.h:227` | **NO** | UB | `mob_kind_from_token` O(n), case-**insens** | **none** | `const&` | **out-of-line `console.cpp:49`** |
| craft | `kCraftRecipeCount` = `kItemCount` | **1** | `craft_recipe` `craft.h:180` | **NO** | UB | none | none | `const&` | inline hdr |
| craft **sources** | `kCraftSourceCount = 24` `craft.h:211` | 0 | **NONE — raw `kCraftSources[i]`** at `craft.cpp:239,253,279`, `suite_craft.inl:105-106` | — | — | ad-hoc loop `craft.cpp:253` | none | — | — |
| loot | borrows `kMobKindCount` | 0 | `mob_loot(u8)` `loot_table.cpp:283` | **YES** | `kNoLoot` `:279` | none | none | `const&` | **out-of-line `.cpp`** |
| speech | `kSpeechLineCount` +2 more | 0 (2-D) | `speech_bucket` `speech_table.cpp:350` | **YES** | wildcard bucket | none | none | `const&` | **in the GENERATED `.cpp`** |
| monster_traits | `kMonsterTraitRows=21` **≠** width `kMobKindCount=68` | 0 | `monster_traits(u8)` + `(MobKind)` | **YES** | `kDefaultRow` | none | none | `const&` | out-of-line `.cpp` |
| ranged | `kRangedCount = 30` | **1** sparse | **none — only `ranged_for_item`** `ranged_table.h:129` | delegated | **`nullptr`** | none | delegated | **`const*`** | inline hdr |
| weapon | `kMeleeCount = 22` | **0** sparse | **none — only `melee_for_item`** `weapon_table.h:52` | delegated | **`nullptr`** | none | delegated | **`const*`** | inline hdr |
| economy | **3 counts** (`kWealthTierCount`, `kEconomyRows`, `kEconomyBands`) | 0 | `bank_terms` `economy.cpp:42` | **YES — CLAMP to LAST** | last row | none | none | `const&` | out-of-line |
| status | `kStatusCount = 6` | 0 | `status_def` `status.h:88` | **NO** | UB | none | `status_valid` sep. `:84` | `const&` | inline hdr |
| particle | `kParticleKindCount` **`uint8_t`** | 0 | `particle_def` `particle_table.h:51` | **YES — CLAMP to 0** | row 0 | none | none | `const&` | inline hdr, **C array `constexpr` in header** |
| interact | `kInteractCount` **`uint8_t`** | 0 | `interact_def` `interact_table.h:46` | **YES — CLAMP to 0** | row 0 | none | none | `const&` | inline hdr, **C array in header** |
| prop | `kPropCount` `size_t` | 0 | `prop_def` `prop_table.h:91` | **NO** | UB | `prop_id_by_string` `:105`, case-**sens**, sentinel = **cast-past-the-end** | `prop_valid` sep. `:87` | `const&` | inline hdr |
| material | `kMatCount` **`CellType`** | 0 | **NONE — 9 parallel arrays** | mixed | mixed | none | none | **by value** | inline hdr |
| quest | `kQuestCount = 19` | **1** | `quest_def` `quest.h:199` | **NO** | UB | none | `quest_valid` sep. `:196` | `const&` | inline hdr |

### 6.1 The divergence, tallied

| Axis | Distinct conventions | Split |
|---|---:|---|
| Index base | **3** | 1-based: item, craft, quest, ranged-sparse · 0-based: 11 others |
| Bounds policy | **4** | Unchecked/UB: item, mob, craft, status, prop, quest, `kMaterial` (**7**) · Sentinel: loot, speech, traits · Clamp: particle→0, interact→0, economy→**last** · Delegated: ranged, weapon |
| Failure value | **6** | UB · `nullptr` · sentinel struct · row 0 · **last row** · `""` |
| Return category | **3** | `const&` (11) · `const*` (2) · by value (material) |
| Count symbol type | **4** | `size_t` (10) · `uint8_t` (2) · `CellType` (1) · derived-from-enum (2) |
| Storage | **3** | `extern std::array` (10) · `inline constexpr` C array in header (particle, interact, material) · `.cpp`-local `constexpr` C array (loot) |
| Accessor location | **3** | inline header (10) · out-of-line in own `.cpp` (3) · **out-of-line in a *different* `.cpp`** (mob→`console.cpp:49`, economy→`economy.cpp:42`) |
| Validity predicate | **3** | separate `x_valid()` (4) · folded into lookup (6) · absent (3) |
| By-name lookup | **3** | case-sensitive (item, prop) · case-**in**sensitive (mob) · absent (12) |
| Invalid sentinel | **5** | `0` · `Enum::Count` · `static_cast<PropId>(kPropCount)` · `nullptr` · none |

### 6.2 Six of these are bugs, not style

1. **`weapon_table.h:52-56` is 0-based sparse; `ranged_table.h:129-133` is 1-based sparse.**
   Adjacent sibling files, same shape, opposite convention. `ranged_table.h:120-125`
   documents the reason (slot 0 is a real gun) — but the outcome is two APIs where
   identical-looking code means different things.
2. **Three comments propagate a false model of the codebase's own idiom.**
   `loot_table.h:137-138`, `speech.h:166` and `speech_table.cpp:352` all claim to be
   *"bounds-tolerant … the same defensive lookup shape as `mob_def` / `item_def`"*.
   **`item_table.h:156-158` and `mob_table.h:227-229` are plain `kTable[i]` with no
   check.** The claimed exemplar does not exist.
3. **`status.h:88-90` (`status_def`, unchecked) sits two lines above `status.h:92`
   (`status_name`, checked).** Same table, same id, two safety contracts.
   `prop_table.h:91` vs `:95`/`:99` has the identical split.
4. **`bank_terms` clamps to the LAST row** (`economy.cpp:44`) while `particle_def` and
   `interact_def` clamp to the FIRST. An out-of-range economy band silently reads as
   "deepest floor" — **the most expensive answer.**
5. **`kMaterial` has no accessor**, so its clamp is copy-pasted into 5 call sites:
   `src/app/main.cpp:1241, 1273, 1283, 1346, 1363` — all spelling
   `kMaterial[x < kMatCount ? x : 0]` by hand.
6. **`monster_traits` publishes two counts for one array** — `kMonsterTraitRows = 21`
   (`monster_traits.h:230`, which is what the drift gate reads at
   `check_source_rules.cmake:451-452`) vs the array's `kMobKindCount = 68` width (`:238`).

### 6.3 Proposal — `src/game/table.h`, ~70 lines

```cpp
enum class OnOob : std::uint8_t { Clamp0, Sentinel, Null };

template <class Def, class Id, std::size_t N,
          std::size_t Base = 0, OnOob Oob = OnOob::Clamp0>
struct Table {
    static constexpr std::size_t count = N;
    const std::array<Def, N>&         rows;
    const std::array<const char*, N>* names = nullptr;
    const std::array<const char*, N>* ids   = nullptr;
    const Def*                        fallback = nullptr;

    static constexpr bool  valid(Id) noexcept;              // ONE validity rule
    constexpr const Def&   operator[](Id) const noexcept;   // ONE bounds policy
    constexpr const Def*   find(Id) const noexcept;         // ONE nullptr policy
    constexpr const char*  name(Id) const noexcept;         // "" on miss, always
    constexpr Id           by_slug(const char*, bool ci = false) const noexcept;
    constexpr auto begin() const noexcept;                  // ONE iteration idiom
    constexpr auto end()   const noexcept;
    static constexpr Id    invalid() noexcept;              // ONE sentinel
};
```

Each generated header declares one line instead of an accessor block, and
`tools/gen_tables.py` (§5.6) **emits that line from the schema** — so the abstraction and
the codegen land together and cannot drift.

| Deleted | LOC |
|---|---:|
| `item_table.h:153-179` | 27 |
| `mob_table.h:227-245` + `console.cpp:49-55` | 26 |
| `prop_table.h:87-113` | 27 |
| `speech_table.cpp:350-359` + `speech_line_count` | 20 |
| `ranged_table.h:129-144` | 16 |
| `material_props.h:49-51, 84-86, 213-215` | 12 |
| `monster_traits.cpp` accessors | 10 |
| `status.h:84-93` | 10 |
| `economy.cpp:42-50` | 10 |
| `weapon_table.h:49-57` | 9 |
| `quest.h:196-204` | 9 |
| `craft.h:180-182` + `craft.cpp:253` | 8 |
| `loot_table.cpp:279-286` | 8 |
| `interact_table.h:46-49` | 4 |
| `particle_table.h:51-54` | 4 |
| `main.cpp:1241,1273,1283,1346,1363` open-coded clamps | 5 |
| **Total deleted** | **≈ 205** |
| `src/game/table.h` added | +70 |
| **Net** | **≈ −135** |

**The LOC saving is small; that is not the point.** It collapses 4 bounds policies,
6 failure values, 3 return categories, 5 sentinel conventions and 3 accessor locations
into one each — and it makes the **7 currently-unchecked `x_def()` functions uniformly
safe without a per-call-site audit**, which is otherwise impossible to land because there
is no single place to make the change.

**Risk: MEDIUM.** Making `item_def`/`mob_def`/`craft_recipe`/`quest_def` bounds-checked
turns today's UB into a defined fallback — which will *hide* latent bad-id bugs that
currently corrupt memory loudly. Land it with a debug-build `assert` in the fallback path
so the bad ids surface before the clamp silences them.



## 10. Time — 12 notions, one authority, one unasserted conversion

### 10.1 `src/core/tick.h` (36 lines)

```
tick.h:26  kSimHz    = 125
tick.h:27  kSimDt    = 1.0f / kSimHz
tick.h:30  kSimStepMs = 1000 / kSimHz          // == 8, exactly
tick.h:31  static_assert(kSimStepMs * kSimHz == 1000, ...)
```

The header's own rationale: at 120 Hz the integer-ms conversion truncated to 8, so every
authored duration ran **4.17% slow**. 125 Hz makes it exact. **`kTickHz` does not exist**
(0 hits — the prior note's token was wrong; the name is `kSimHz`). Also 0 hits:
`glfwGetTime`, `deltaTime`, `nowMs`, `tickCount`, `frameCount`, `gameTime`, `game_clock`,
`timeOfDay`, `high_resolution_clock`, `system_clock`.

### 10.2 The 12 clocks

| # | Name | Declared | Unit | Advanced by | Authority |
|---|---|---|---|---|---|
| 1 | `frameDt` (SDL perf counter) | `main.cpp:2031-2032`, computed `:2682-2683` | s (float) | per frame | wall, feeds #2 |
| 2 | `simAccum` | `main.cpp:2022` | s (float) | `+= frameDt :3031`; `-= kSimDt :5062` | accumulator |
| 3 | **`simTick`** | `main.cpp:2045` | **ticks (u64)** | `++simTick` at **exactly one site, `main.cpp:5016`** | **AUTHORITATIVE** |
| 4 | `simNow` | `main.cpp:2030` | s (double) | `+= kSimDt :5061` | **dead** — `[[maybe_unused]]`, and `main.cpp:3163` documents `ai_step` as PARKED |
| 5 | integer-ms component timers | §10.4 | ms (u16/u32) | `kSimStepMs` **or** the float form | derived |
| 6 | `MacroSim::tick_` | `macro_sim.h:362` | macro ticks | `main.cpp:5030-5031`, gated `simTick % 250` | derived |
| 7 | `MacroSim::dayTenths_` → `day()` | `macro_sim.h:250, 313` | tenth-days → days | `macro_sim.cpp:251` | **the only calendar** |
| 8 | `BankAccount::lastInterestTick` | `economy.cpp:176-179`, wire `save.cpp:402` | sim ticks | `main.cpp:4786` | derived |
| 9 | `SDL_GetTicks()/1000` shader time | `main.cpp:6720`, `vk_renderer.cpp:641` | s (float) | SDL | **2nd independent wall clock** |
| 10 | `steady_clock` profiling | `main.cpp:1395,1398-1399`; `vk_texture.cpp:593,627,631,634,636`; `nav_async.cpp:54,60,61`; `floor_stream.cpp:306,309,311,314,317,320` | ms | `::now()` | measurement |
| 11 | GPU timestamps | `gpu_timer.cpp:73, 179-210` | GPU ticks → ms | `vkGetQueryPoolResults` | measurement |
| 12 | `file_time_type` LRU stamp | `nav_cache.cpp:4` | file mtime | OS | out-of-band |

Two near-misses, named so they are not mistaken for clocks:
- `io.DeltaTime` (`main.cpp:6553, 6584`) — a **13th** delta source, unsynchronised with #1.
- `frameIndex` (25 hits across `gpu_timer.h/cpp`, `body_pass`, `voxel_mirror`,
  `raymarch_pass`, `prop_pass`) is `VulkanRenderer::currentFrame` (`vk_renderer.h:84`),
  a **frame-in-flight slot index** that wraps mod 2 (`vk_renderer.cpp:727`). It is not a
  frame counter. **A monotonic frame counter does not exist** (`++frame`, `frameCounter`,
  `frameNo`, `frames_++` → 0 hits).

`simTick` is read at **60 sites in `main.cpp`** plus `mob_spawn.h:257,265`,
`mob_spawn.cpp:556,570,627,715,723,736`, `diffusion.h:507,511`, `diffusion.cpp:498,514`.

### 10.3 THE FINDING — the tick-rate `static_assert` is bypassed 4×

Two expressions for "milliseconds per sim step" coexist:

**Form A — the constant `kSimStepMs`** (protected by `tick.h:31`'s `static_assert`),
14 uses: `quest.h:54, 61, 363`; `speech.h:146`
(`static_assert(kSpeechCooldownTicks * kSimStepMs == 3000u)`); `mob_spawn.h:154`
(`static_assert(kFogSpawnPeriodTicks * kSimStepMs == 2000u)`);
`faction_relations.cpp:293, 336`; `economy.h:221`; `macro_sim.h:75`;
`faction_relations.h:39`; `encumbrance.h:62`; `diffusion.h:121`.

**Form B — `static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f)`**, recomputed inline at
**`src/app/main.cpp:3053, 3260, 3338, 4945`** — verified today.

Both are 8 **today**. Form A is protected; **Form B is protected by nothing.** If
`kSimHz` ever moves to a rate that does not divide 1000 (144, 240, 90), Form A fails at
compile time — which is the entire design intent of `tick.h` — while Form B silently
truncates, and **noise (`:3053`), status (`:3338`), samosbor (`:4945`) and `:3260` start
running at a different rate than quest / speech / mob-spawn / faction.**

**This is the exact bug `tick.h:1-7` was written to prevent, reintroduced four times in
`main.cpp`.** The fix is a 4-line edit and is the single highest-severity item in this
audit relative to its cost.

### 10.4 Every integer-ms subsystem

| Subsystem | Step | Advanced with | Storage |
|---|---|---|---|
| Noise | `noise.h:197`, `noise.cpp:137-140` | **Form B** `main.cpp:3053` | `u16` |
| Status | `status.h:126`, `status.cpp:60-71` | **Form B** `main.cpp:3337-3339` | `u32 remainMs[]` |
| Samosbor | `samosbor.h:575`, `samosbor.cpp:440,456-462,526` | **Form B** `main.cpp:4945` | `u32 phaseMs/activeMs` |
| Quest | `quest.h:390`, `quest.cpp:317,351-361` | **Form A** (`quest.h:363`) | `u32 remainingMs` |
| Combat melee | `combat.cpp:683-689, 765-780` | `elapsedMs` | `u16 cooldownMs/windupMs` |
| Combat projectiles | `combat.cpp:1358,1370-1371, 1413,1458-1459` | `elapsedMs` | `u16 ttlMs` |
| Combat ranged | `combat.cpp:1985,1991-1992` | `elapsedMs` | `u16 cooldownMs/reloadMs` |
| Combat mob | `combat.cpp:2213-2216` | `elapsedMs` | `u16 cooldownMs` |
| Faction feud | `faction_relations.cpp:293, 336` | **Form A** | ms |

### 10.5 Two more time defects

**Unbounded sim/wall drift.** `main.cpp:2682` computes `frameDt` with **no clamp**;
`main.cpp:3031` adds it whole to `simAccum`; `main.cpp:3046` caps catch-up at
`guard++ < 8`, i.e. **at most 64 ms of sim per frame**. Any frame longer than 64 ms
(floor load — `floor_stream.cpp:306-320` measures these; texture decode —
`vk_texture.cpp:634`) leaves residue in `simAccum` permanently. Sim time then lags wall
time monotonically. There is no drift readout and no reset except the pause path at
`main.cpp:3029`.

**`simTick` truncated to 32 bits at 11 sites** — `main.cpp:602, 4020, 4238, 4435, 4462,
4494, 4588, 4912, 6348, 6749, 6755`, and on the wire at `economy.h:279`, which documents
the wrap as **"~397 days at 125 Hz"**. `main.cpp:4905` carries a comment acknowledging
the width mismatch.

### 10.6 Verdict on "there is no clock in the build" — PARTIALLY REFUTED

**Wrong in one direction:** there **is** a calendar. `MacroSim::dayTenths_`
(`macro_sim.h:250, 362`) → `double day()` (`macro_sim.h:313`), advancing by
`MacroParams::daysPerTick = 7` (`macro_sim.h:166`, applied `macro_sim.cpp:251`) every
`kMacroPeriodTicks = kSimHz * 2 = 250` ticks (`macro_sim.h:80`) — i.e.
**7 simulated days per 2 real seconds**. It is serialized (`macro_sim.cpp:672` write,
`:692` read) and printed every macro tick (`main.cpp:5039-5041`, `day=%.1f`). Journey
ETAs schedule against it (`macro_sim.h:343 etaTenths`).

**Right in the other:** there is **no time-of-day**. `timeOfDay`, `time_of_day`,
`dayNight`, `day_night`, `isNight`, `sunAngle`, `hourOfDay` → **0 hits**. Nothing has an
hour, nothing has a sun. The calendar's resolution floor is one tenth of a day (2.4 h)
and its step is 7 days, so a time-of-day could not be expressed even if a consumer wanted one.

**Precise restatement for the owner:** the build has a *demographic calendar* (days,
coarse, saved) and **no diegetic wall clock**. All gameplay pacing runs on `simTick`
and integer-ms timers.

### 10.7 Proposal

1. **Replace the 4 Form-B expressions with `giga::kSimStepMs`** (`main.cpp:3053, 3260,
   3338, 4945`). 4 lines. Brings 4 subsystems under the `tick.h:31` assert.
   **LOC ≈ 0. Risk: NONE.** *Do this first.*
2. Promote `simTick` to `struct SimTick { std::uint64_t v; }` in `core/tick.h` with
   `to_ms()/from_ms()/to_seconds()` defined once. Today it is a **local variable in
   `main()`** passed by value into ~12 signatures — `diffusion.h:507` explicitly calls it
   "the caller's own tick counter", i.e. the seam is convention only.
3. Clamp `frameDt` at `main.cpp:2682` and expose the residual `simAccum` as a drift readout.
4. Delete `simNow` (#4) — it is `[[maybe_unused]]` and its one consumer is parked.

---

## 14b. Serialization — the fuller picture

My §14 found 2 copies of the archive pair. **The true count is 3, plus 3 more byte-shapes
and 2 duplicated file-IO shapes — 6 + 2 = 8 in total.**

| # | Shape | Definition | Types | Bounds-checked |
|---|---|---|---|---|
| 1 | `Writer`/`Reader` + `visit_*<Ar>` | `save.cpp:45-95` / `:99-177` (**130 LOC**) | u8 b8 u16 u32 u64 i16 i32 i64 f32 + `skip` | ✅ `save.cpp:103-110` |
| 2 | same | `nav_cache.cpp:23-49` / `:52-98` (**74 LOC**) | u8 u16 u32 u64 i32 | ✅ `:56-63` |
| 3 | same | **`quest.cpp:81-102` / `:106-152` (69 LOC)** | u8 u32 u64 i32 i64 | ✅ `:110-117` |
| 4 | free `put_*` + `ByteReader` | `npc_pool.cpp:410-452` | u8 u16 u32 i16 f32 | ✅ `:433-436` |
| 5 | pointer-bumping `put_u32`/`get_u32` | `craft.cpp:344-359` | u32 only | ❌ **NO** — caller pre-checks at `craft.cpp:373` |
| 6 | free `ms_u*` + `MsReader` | `macro_sim.cpp:628-667` | u8 u16 u32 u64 | struct-level |
| 7 | write-beside-then-rename | `main.cpp:895-938` **and** `nav_cache.cpp:325-355` | — | 2 independent impls |
| 8 | slurp-file-into-vector | **10 copies** — see below | — | 9 check `fread`, **1 does not** |

Shapes 1/2/3 are byte-verbatim where they overlap (verified today):
`save.cpp:49` ≡ `nav_cache.cpp:27` ≡ `quest.cpp:85`;
`save.cpp:62-65` ≡ `nav_cache.cpp:32-35` ≡ `quest.cpp:86-89`;
`save.cpp:123-130` ≡ `nav_cache.cpp:71-78` ≡ `quest.cpp:118-125`.
**273 LOC of byte plumbing**, of which 143 (shapes 2+3) are strict subsets of shape 1.

**The codebase has written the fix down twice and not applied it:**
- `src/game/quest.cpp:78-80` — *"They are byte-for-byte the same convention… Hoisting one
  copy into an internal header is a real cleanup and is reported as such."*
- `src/game/nav_cache.cpp:100-105` — *"A THIRD copy of this loop would be one too many;
  this is the third… the right fix is to promote it to a shared core header the same way
  `src/core/rng.h` now hosts the splitmix finalizer that had thirteen copies."*

### 14b.1 The slurp helper — 10 copies, 2 names, 2 backing APIs, 1 divergence

| Function | Site | Impl |
|---|---|---|
| `read_file` | `src/render/body_pass.cpp:59` | `fopen` |
| `read_file` | `src/render/prop_pass.cpp:27` | `fopen` |
| `read_file` | `src/render/wire_pass.cpp:16` | `std::ifstream` |
| `read_file` | `src/render/cloth_pass.cpp:16` | `std::ifstream` |
| `read_file` | `src/render/particle_pass.cpp:16` | `std::ifstream` |
| `read_spv` | `src/render/raymarch_pass.cpp:96` | `fopen` |
| `read_spv` | `src/render/gpu_gas_pass.cpp:19` | `fopen` |
| `read_spv` | `src/render/gpu_cull_pass.cpp:24` | `fopen` |
| `read_spv` | **`src/render/gpu_light_grid.cpp:26`** | `fopen` — **`:40` discards the `fread` return value; the other nine check it** |
| `read_spv` | `src/render/vk_renderer.cpp:24` | `fopen` |

### 14b.2 Five independent versioning schemes

| Format | Magic | Version | Checksum | Fingerprint | Site |
|---|---|---|---|---|---|
| `run.sav` | `kSaveMagic` | `kSaveVersion` (v16) | CRC-32 payload | item+mob+quest FNV | `save.cpp:591-608`, checks `:635-689` |
| floor file | `kFloorMagic` "GH2F" | `kFloorFileVersion` | CRC-32 blob | none | `save.cpp:1391-1420` |
| nav cache | own | own | CRC-32 **coarse only** | `nodes`/`macroDim` | `nav_cache.cpp:121-135, 693, 826` |
| quest log | none | rides `run.sav` | none | own FNV | `quest.cpp:171-180` |
| craft blob | none | rides `run.sav` | none | none | `craft.cpp:363-377` |

Endianness is implemented **six times, correctly** — six separate correctnesses, not one.

### 14b.3 Revised proposal — `src/core/wire.h`

```
giga::wire::Writer / Reader          // union of the 3 archive pairs
giga::wire::crc32(span, seed)        // the one bit-serial loop
giga::wire::fnv1a(h, cstr)           // the one FNV
giga::wire::write_atomic(path, ...)  // tmp + rename, fclose status checked
giga::wire::slurp(path, out)         // the one file reader
```
Both `Writer` and `Reader` are already archive-polymorphic by template, so **all 20
existing `visit_*` functions compile unchanged.** Mechanical extraction, not redesign.

| Item | LOC |
|---|---:|
| `nav_cache.cpp:23-98` | −74 |
| `quest.cpp:81-152` | −69 |
| CRC-32 ×2 (`nav_cache.cpp:110-118`, `screenshot.cpp:15-24`) | −18 |
| FNV-1a ×1 (`quest.cpp:184-192`) | −9 |
| `npc_pool.cpp:410-452` | −48 |
| `craft.cpp:344-359` (**and gains the bounds check it lacks**) | −16 |
| `macro_sim.cpp:628-667` | −40 |
| 9 of 10 slurp copies | −80 |
| 2nd `write_atomic` (`main.cpp:895-938`) | −35 |
| **Gross** | **−389** |
| Added `src/core/wire.h` | +160 |
| **Net** | **≈ −230** |

**Risk: LOW.** `tests/suite_saveload.inl` (2053) and `tests/suite_navcache.inl` (1316)
cover both formats. The two live defects it makes unexpressible — `craft.cpp`'s missing
bounds check and `gpu_light_grid.cpp:40`'s discarded return — are the real payoff.

---

## 15. ImGui panel boilerplate

### 15.1 Counts and the 14 panels

| Token | Count |
|---|---:|
| `ImGui::Begin*` (all) / `End*` | 30 / 32 |
| ↳ `ImGui::Begin` (windows) | **14** |
| `SetNextWindowPos` / `Size` / `BgAlpha` | 12 / 9 / 2 |
| `PushStyleColor` / `Pop` | 6 / 4 |
| `PushStyleVar` / `Pop` | 2 / 1 (`PopStyleVar(2)`) |
| `ImGuiWindowFlags_` | **41** |

The 14 windows: HUD slots ×4 via helper `hud_ui.cpp:196/215/244`; Workbench
`main.cpp:440/621`; Console `main.cpp:699/746`; debug panel `main.cpp:5109/5677`
(**568-line body**); ЛИФТ `main.cpp:6134/6175`; `##interact_prompt`
`main.cpp:6514/6523`; `##intro` `main.cpp:6540/6569`; `##mainmenu`
`main.cpp:6588/6658`; `Menu` `main.cpp:6673/6707`; `CRT_Overlay`
`imgui_layer.cpp:212/256`; `##conversation` `conversation_ui.cpp:33/75`; `##dice`
`conversation_ui.cpp:88/141`; `##bank` `conversation_ui.cpp:156/185`; Inventory
`inventory_ui.cpp:243/434`.

### 15.2 The duplicated blocks — 78% of flag lines

**Block A — "centred modal", 4 verbatim copies, 8 lines each:**
`conversation_ui.cpp:29-36`, `:84-91`, `:152-159`, `inventory_ui.cpp:239-246`.
The 5-flag expression `NoResize|NoMove|NoCollapse|NoScrollbar|NoTitleBar` is
**byte-identical in all four**, plus 4 preceding `GetMainViewport()` lines.

> **BUG (cosmetic but real):** the vertical anchor differs silently.
> `conversation_ui.cpp:30, 85, 153` use `* 0.6f`; **`inventory_ui.cpp:240` uses `* 0.5f`.**
> The inventory window is centred, the three dialogue windows sit 10% of screen height
> lower. Nothing documents this as intentional — it is exactly the value that drifts when
> a block is copied four times.

**Block B — "screen-centred auto-resize menu", 2 copies:** `main.cpp:6585-6593` and
`:6670-6677`. Identical `AlwaysAutoResize|NoCollapse|NoMove|NoTitleBar|NoSavedSettings`.

**Block C — "transparent overlay", 2 near-copies:** `hud_ui.cpp:216-220` (6 flags) and
`main.cpp:6515-6520` (**the same 6 plus `NoMove`**). Alphas differ too: `0.35f`
(`hud_ui.cpp:214`) vs `0.55f` (`main.cpp:6513`). One extra flag and one different
constant, invisible unless both files are open.

**Block D — `if (!Begin) { End; return; }`, 2 copies:** `main.cpp:440-443`, `:699-703`.

**32 of 41 `ImGuiWindowFlags_` lines (78%) are duplicates or near-duplicates.**

### 15.3 Push/Pop balance — **AUDITED, LEAD REFUTED**

The raw 6-vs-4 and 2-vs-1 counts look like an imbalance. Line-by-line, **every path is
balanced at runtime**:

| Site | Verdict |
|---|---|
| `hud_ui.cpp:67` → `:69` | balanced, unconditional |
| `main.cpp:5217/5220/5223` → `:5226` | balanced — `if/else if/else` at `:5216,5219,5222`, exactly one runs |
| `conversation_ui.cpp:62` → `:68` | balanced — both guarded by `marked` (`:60,61,68`) |
| `inventory_ui.cpp:259` → `:266` | balanced — both inside `if (capacityG > 0)` (`:251`) |
| `imgui_layer.cpp:210,211` → `:257 PopStyleVar(2)` | balanced — count matches |

Begin/End pairing is also correct everywhere, including the two usually-wrong idioms:
`main.cpp:6134` puts `End()` **outside** the `if (Begin(...))` braces (correct);
`main.cpp:440-442` and `:699-703` use `if (!Begin) { End(); return; }` (correct). No
early `return` exists between any `Begin` and its `End`.

**No imbalance bug exists today.** What exists is its precondition: 3 of the 6
`PushStyleColor` calls are conditional, and their matching `Pop` re-derives the guard by
hand 6–7 lines away (`conversation_ui.cpp:61`→`:68`; `inventory_ui.cpp:251`→`:266`;
`main.cpp:5216-5223`→`:5226`). Any `continue`/`return`/`break` inserted between them
corrupts ImGui's style stack for the rest of the frame — manifesting as wrong colours in
an **unrelated** panel. Held off by review discipline alone.

### 15.4 Proposal — `src/app/ui_panel.h`

RAII `Panel` (ctor = `SetNextWindow*` + `Begin`, dtor = unconditional `End`),
`StyleColor`, `StyleVar`, plus three named flag constants `kModalFlags` / `kMenuFlags` /
`kOverlayFlags`. `hud_ui.cpp:196 begin_slot_window` is already 90% of this design and
becomes the `Anchor::Slot` case.

| | |
|---|---|
| **LOC removed** | ~93 gross, **+95 added → net ≈ 0** |
| **Why do it anyway** | (a) 32 duplicated flag lines → 3 constants, so the `hud_ui.cpp:220` vs `main.cpp:6520` divergence becomes impossible; (b) the `0.5f`/`0.6f` anchor divergence becomes a named field; (c) the 3 conditional style pops become unpoppable-wrong; (d) 14 hand-written `ImGui::End()` calls stop being forgettable inside the 568-line body of `main.cpp:5109-5677` |
| **Risk** | **LOW** — UI only, visually verifiable in one `--shot` |

---

## 9b. Logging — addendum to §9

`std::fprintf` is **177 calls in 24 files**, of which **77 are inside the `VK_TRY` macro**
(`src/render/vk_common.h:25-34`) — so the raw count overstates the hand-written surface.
Top files: `main.cpp` 75, `vk_texture.cpp` 24, `vk_device.cpp` 10, `audio_system.cpp` 8,
`prop_pass.cpp` 7, `cube_pass.cpp` 7, `gpu_light_grid.cpp` 6, `voxel_mirror.cpp` 5.

`std::snprintf` is **130 calls in 15 files** (`main.cpp` 45, `console.cpp` 33,
`rumour.cpp` 10, `quest.cpp` 10, `event_bus.cpp` 10), all into hand-rolled `char[N]` with
**11 different hand-picked capacities** in `main.cpp` alone (`:1886 [160]`, `:2069 [200]`,
`:2077 [320]`, `:2078 [160]`, `:2136 [96]`, `:2256 [256]`, `:2259 [160]`, `:2332 [128]`,
`:5598 [200]`, `:6042 [128]`, `:6390 [96]`).

`ImGui::Text*` is **157 calls** across 5 variants (`Text` 70, `TextColored` 45,
`TextUnformatted` 23, `TextDisabled` 18, `TextWrapped` 1).

Two further mechanisms I missed in §9: an in-game console
`std::vector<std::string>` (`main.cpp:2264-2265`, sink `:633-634`, pushes `:728,731,737`)
and the `EventFeed` fixed-line ring (`event_bus.h:324-332`, writer `event_bus.cpp:151`).
**7 mechanisms total.**

**Tag drift:** 41 distinct `[tag]` prefixes, no enum, no registry, nothing filterable —
including near-duplicate pairs **`[prop]` (9) / `[props]` (2)** and
**`[floor]` (1) / `[floors]` (1)**, and `[corp]` vs `[death]` both about corpses.

**Env-var hazards** beyond the naming inconsistency I noted:
- **6 `getenv` calls are on the per-frame/per-tick hot path** — `main.cpp:1077, 1154,
  1184, 1323, 4358, 4447`. `GIGA_WIRE_DBG` is read **twice in one function**
  (`:1154`, `:1184`). The other six sites cache in a `static const bool`
  (`main.cpp:403, 6789, 6790, 6791`, `gpu_timer.cpp:42`, `imgui_layer.cpp:201`).
- **3 vars change simulation behaviour, not logging** — `GIGA_NO_GPU_CULL`,
  `GIGA_WIRE_NOSIM`, `GIGA_PARTICLE_NOSIM` (`main.cpp:6789-6791`). A determinism
  divergence can be caused by an environment variable with **no record in the save**.
- `GIGA_PRESENT_MODE` appears only in `tools/perf_notes.md:211` — **a stale doc for a var
  that does not exist in the build.**



---

## TOP 20 BIGGEST WINS — ranked

Ranked by **(defects closed × structural leverage) ÷ risk**, not by LOC. "LOC" is net
lines removed. "Risk" is the chance of a behavioural regression.

| # | Win | Primitive | Sites | LOC | Bugs closed | Risk | Why here |
|---:|---|---|---|---:|---|---|---|
| **1** | **Replace 4× `static_cast<u32>(kSimDt*1000.0f+0.5f)` with `kSimStepMs`** — `main.cpp:3053, 3260, 3338, 4945` | §10 Time | 4 | 0 | 1 latent (4 subsystems desync on any tick-rate change) | **NONE** | 4-line edit. Brings noise/status/samosbor under `tick.h:31`'s `static_assert`. **The single best cost/benefit item in the audit.** |
| **2** | **Normalise all 11 Vulkan `destroy()` guards to form A; give the 6 dtor-less passes an RAII destructor; delete all 8 unwind ladders** — `main.cpp:1623,1642,1654,1672,1687,1758,1993,7244` | §16 Teardown | 8 | −55 | **UB/crash on 2 error-exit paths** + documented-order inversion | LOW-MED | `wire_pass.cpp:342`, `cloth_pass.cpp:341`, `particle_pass.cpp:316`, `prop_pass.cpp:239` call `vkDestroyPipeline(VK_NULL_HANDLE, ...)` after `vk_device.cpp:279` nulls the handle. Ladder L7 omits exactly 6 passes. |
| **3** | **`torus_dist2()` / `wrap_delta_v()` in `core/wrap.h`; replace all 182 `wrap_delta_f` triples** | §1 Wrap | 182 | −180 | **8 isotropy defects, one inside `find_nearest_interactable` (12 callers)** | MED (behavioural) | `prop_system.cpp:562`, `main.cpp:1482, 3606, 3636, 3842, 3858, 6477`, `loot.cpp:476`. Fixes them *by construction*. Sites 4/5/7 widen damage/pickup radii near the Y seam — pin with a seam test first. |
| **4** | **`src/core/wire.h`** — one `Writer`/`Reader`/`crc32`/`fnv1a`/`write_atomic`/`slurp` | §14b Serialization | 8 shapes | **−230** | `craft.cpp` missing bounds check; `gpu_light_grid.cpp:40` discarded `fread` | **LOW** | 3 archive-pair copies (`save.cpp:45-177`, `nav_cache.cpp:23-98`, `quest.cpp:81-152`), 3 CRC-32, 2 FNV-1a, 10 slurp copies, 2 `write_atomic`. **`nav_cache.cpp:100-105` and `quest.cpp:78-80` already prescribe this fix.** All 20 `visit_*` compile unchanged. |
| **5** | **`tools/gen_tables.py` + `data/schema/*.toml`** — collapse 14 generators | §5 Codegen | 14 | **−2,200** | Closes the 5-table drift-gate hole structurally; adds a `--check` ctest | LOW (7 scripts) / MED (7) | 3,835 Python lines for 990 CSV lines. 577 duplicate line-instances (17.8%). Byte-comparable output = the acceptance test. |
| **6** | **`src/world/types.h`: one `cell_of` (floor) + `cell_centre`; delete the 4 bypassed helpers** | §2 Cell↔world | 98 + 13 | −130 | **3 confirmed-live off-by-one-cell reads** (`main.cpp:3094, 3710, 3086`) + the 44/54 floor-vs-truncate fork | MED | `macro_cell_of`/`macro_cell_centre` live in `save.h` and are used 2× each. **Watch: `save.cpp:989-991` is on the save wire.** |
| **7** | **One `GpuVerletPass` base for wire/cloth/particle** | Near-identical files | 3 | **−380** | none (pure refactor) | **LOW** | `cloth_pass.cpp` ↔ `wire_pass.cpp` = **86.3%** identical; both ↔ `particle_pass.cpp` = 76%. Covered by `suite_particles.inl` + `suite_antourage.inl`. |
| **8** | **`shaders/voxel_dda.glsl`** — one GLSL DDA + `solid_at` + grid constants | §3 DDA | 15 loops | −125 | **3 live behavioural forks**: sub-voxel-vs-macro parity lie (`raymarch.frag:273`), z-wrap disagreement, 224-vs-96 loop budget | MED-HIGH | GLSL include mechanism already exists (`CMakeLists.txt:255`, 11 live `#include`s). 3 byte-identical `solid_at` copies. Split into 3 individually-verified commits. |
| **9** | **`Entity npc_entity(NpcId)` side-index + one generic `nearest_entity()` query** | §11 Identity | 25 + 52 | −350 | 8 Y-axis sites collapse into 1 helper; `CameraTag`-vs-`NpcPlayer` fork | MED | **No `NpcId → Entity` function exists at all** — 25 linear `view<NpcRef>` scans. 52 hand-rolled `bestD2` loops, 5 parallel `nearest_*` specialisations. |
| **10** | **`src/core/hash.h`** — one CRC-32, one FNV-1a-over-cstr; delete `combat.cpp:2072-2076` | §4b RNG | 21 impls | −60 | none (all deterministic today) | **NONE** for the inline; LOW for the rest | `combat.cpp:2072-2076` is `hash_u32` **character-for-character** in a file that includes `core/rng.h` at `:31`. CRC-32 ×3, FNV-1a ×3, xorshift ×3, LCG ×2. |
| **11** | **`src/game/table.h`** — one `Table<Def,Id,N,Base,Oob>` | §6 Table access | 15 | −135 | **7 unchecked `x_def()` become uniformly safe**; `bank_terms` clamp-to-last; 3 false "bounds-tolerant" comments | MED | 15 tables, 15 shapes, **zero pairs agreeing** on 10 axes. Land with a debug `assert` in the fallback so bad ids still surface. |
| **12** | **`src/world/solidity.h`** — one predicate + a probe volume | §12 Passability | 11 C++ + 5 GLSL | −76 | P2's gravity-frame hardcode; the unchecked P1⊇P2 invariant; CellType-vs-mask disagreement | **HIGH** | P1 (`nav.cpp:17`) feeds the 130 MiB baked nav cache. **Do P2/P3/P4 first; leave P1 alone until a parity test exists.** |
| **13** | **`src/world/dirs.h`** — one `kDir6` + 4 `static_assert`s | §4 Neighbours | 10 tables + 24 loops | −44 | `ai.cpp:1007`'s unasserted bit-layout dependency; `nav_cache.h:116` blind to a reorder; `combat.cpp:744/998` hardcoded `{0,0,-1}` | **LOW** | No live ordering bug (verified end-to-end) — the value is the asserts. |
| **14** | **`data/loot_drops.csv` + schema; delete the 363 hand-transcribed lines** | §5.5 Hole 1 | 1 file | −330 | Brings the last table into the drift gate | MED-HIGH | **No `gen_loot_table.py`, no `data/loot*.csv`** — verified today. Guarded only by a **hand-computed** checksum `104447` (`loot_table.h:228`) which must reproduce exactly. |
| **15** | **`src/app/ui_panel.h`** — RAII `Panel`/`StyleColor`/`StyleVar` + 3 flag constants | §15 ImGui | 14 panels | ≈0 | The `0.5f`/`0.6f` anchor divergence; `hud_ui.cpp:220` vs `main.cpp:6520` flag drift; 3 conditional style pops | **LOW** | **32 of 41 flag lines (78%) are duplicates.** Push/Pop balance lead **REFUTED** — all balanced today; this removes the precondition. `hud_ui.cpp:196` is already 90% of the design. |
| **16** | **One `spawn_ballistic()` for the 3 projectile spawners** | Copy-paste | 3 | −55 | none | **LOW** | `combat.cpp:1108, 1210, 1253` share ~30 lines each (`:1114/1215/1259`, `:1231-1234`/`:1274-1277`, `:1236-1243`/`:1279-1287`). |
| **17** | **Clamp `frameDt`; expose `simAccum` drift; promote `simTick` to a type** | §10.5 Time | 1 + 11 | ≈0 | **Unbounded sim/wall drift** after any >64 ms frame; 32-bit truncation at 11 sites (`economy.h:279`: wraps at ~397 days) | LOW | `main.cpp:2682` has no clamp; `:3046` caps catch-up at 8 ticks. Residue never drains. |
| **18** | **`data/sounds.csv` joins codegen; delete the runtime parser** | §5.5 Hole 3 | 1 | −45 | The only hand-rolled CSV parser + a 3rd hand-rolled name→index map | **LOW** | `audio_system.cpp:213-227` + `:195-204`. **The CSV is 14 bytes — a header and nothing else.** |
| **19** | **Fold `door.cpp:278-302` into `:228-252`; dedupe `main.cpp:3091-3114`/`:3708-3726`** | Copy-paste | 4 | −48 | The duplicated wall-scan carries the §2.3 truncation bug **twice** | **LOW** | Two byte-identical 75-cell box scans; two byte-identical 17×17 wall scans. |
| **20** | **`GIGA_LOG(channel, level, ...)`; one env parse; rename `GIGA_ANTOURAGE_DEBUG`** | §9/§9b Logging | 177 + 15 | −90 | 6 hot-path `getenv` calls; `[prop]`/`[props]` and `[floor]`/`[floors]` tag drift; 3 sim-behaviour vars named as debug flags | LOW | 177 unfilterable lines under 41 free-text tags. `GIGA_WIRE_DBG` read **twice in one function** (`main.cpp:1154, 1184`). |

**Cumulative: ≈ −4,500 LOC, ~30 defects closed** (2 crash-class, 11 isotropy/off-by-one,
3 rendering forks, and ~14 latent-on-change).

### Suggested landing order

**Wave 1 — free, no behavioural risk (do today):** #1, #2, #10 (the inline only), #17
(the `frameDt` clamp).
**Wave 2 — pure refactor, test-covered:** #4, #7, #13, #15, #16, #18, #19, #20.
**Wave 3 — needs a pin first:** #3 (seam test), #6 (save-version decision), #9, #11, #5.
**Wave 4 — needs a parity test before touching:** #8, #12, #14.

---

## Leads that were REFUTED — do not act on these

| Lead | Verdict | Evidence |
|---|---|---|
| `suite_needs.inl` ≈ `suite_needs2.inl` | **FALSE — 3.7% similar**, 25 shared lines of 985 | measured today |
| `suite_samosbor.inl` ≈ `suite_samosbor2.inl` | **FALSE — 2.1%**, 12 shared lines | measured today |
| `suite_props.inl` ≈ `suite_props_game.inl` | **FALSE — 1.4%**, 6 shared lines | measured today |
| `padic_gen.cpp` ≈ `blame_gen.cpp` | **MOSTLY FALSE — 15%**, and the 100 shared lines are includes/loops/corner-posts, not an algorithm. The floor-module isolation law is holding. | measured today |
| ImGui `PushStyleColor`/`Pop` imbalance (6 vs 4) | **FALSE — all balanced.** `main.cpp:5217/5220/5223` is an `if/else if/else` (one runs); `conversation_ui.cpp:62`→`:68` and `inventory_ui.cpp:259`→`:266` share a guard; `imgui_layer.cpp:257` is `PopStyleVar(2)`. Begin/End also all correct. | audited line by line |
| "the `wrap_delta_f` Y bug is 4 sites in `main.cpp`" | **UNDERSTATED — 8 sites, 6 in `main.cpp` + `loot.cpp:476` + `prop_system.cpp:562`**, and the last is the shared helper with 12 callers | verified by reading each block |
| "~6 Vulkan teardown copies, one omits 6 passes" | **UNDERSTATED on count, EXACT on the omission — 8 ladders**, and L7 (`main.cpp:1993-2002`) omits exactly 6 named passes + `lightGrid` | read all 8 |
| "there is no clock in the build" | **PARTIALLY REFUTED.** There **is** a calendar (`MacroSim::dayTenths_` → `day()`, 7 sim-days per 2 real seconds, serialized, printed). There is **no time-of-day** — `timeOfDay`/`hourOfDay`/`sunAngle`/`isNight` → 0 hits. | §10.6 |
| `kTickHz` | **Does not exist.** The constant is `kSimHz = 125` (`core/tick.h:26`). | grep |
| item/craft/mob/speech `_table.cpp` are copy-paste debt | **FALSE — all four are GENERATED** (banner on line 1). Their 108×/69×/10× repeated blocks are *data rows*. **`loot_table.cpp` is the one that is not.** | read line 1 of each |

---

## What the codebase already does RIGHT (worth preserving under any refactor)

These are the exemplars any unification should be modelled on, not overwritten:

1. **`src/core/wrap.h`** — correct, documented, with its GLSL twin named as a contract
   (`wrap.h:48-51`) and pinned by `test_nearest_image`.
2. **`src/game/save.cpp`'s `visit_*<Ar>` pattern** — one traversal, two archives, so the
   writer and reader *cannot* drift. 20 visitors across 3 files.
3. **Determinism.** Zero `rand()`, `srand`, `<random>`, `random_device`, or clock-derived
   seed anywhere in `src/`, `shaders/`, `tools/`, `tests/`.
4. **`src/game/flicker.h:26-59` ↔ `shaders/flicker.glsl:21-46`** — a constant-for-constant
   CPU/GPU mirror, deliberate and documented at both ends. This is what §3's
   `voxel_dda.glsl` should aim to be.
5. **`src/core/rng.h`** — a consolidation that already worked once
   (`nav_cache.cpp:103`: the splitmix finalizer "had thirteen copies").
6. **`src/game/loot_table.cpp:37-40`'s `DrawStream`** and **`src/game/light_bake.cpp:37-98`** —
   the two model consumers of the shared primitives.
7. **`src/game/room_zone.cpp:18-43`** — the best comment in the tree: it states a measured
   correction (62 of 63 bodies stalled), names the exact bar that was wrong (1-in-512 vs
   4×4×7 sub-voxels), and states the invariant the new predicate must keep. The only thing
   missing is a test that checks that invariant.
8. **`tools/check_source_rules.cmake`'s `_giga_csv_vs_header` gate** — the right mechanism,
   applied to 9 of 14 tables. §5.6 closes the other 5 structurally.
9. **`src/game/npc_pool.h:22-27`** — names all six places that store a bare `NpcId` across
   time and states what must change before slot recycling can ship. Debt that is written
   down with its exit criteria is not the same as hidden debt.

---

## Method note

- Every count in this document comes from a `grep`, `diff` or Python analysis run on
  2026-08-17 against `97bdf13e`. Where a subordinate analysis produced a claim, the claim
  was re-verified against the file before inclusion — including `quest.cpp:81-152` (3rd
  archive copy), `combat.cpp:2072-2076` (inlined `hash_u32`), the 4
  `kSimDt*1000.0f+0.5f` sites, the absence of `tools/gen_loot_table.py` and
  `data/loot*.csv`, the 9 `_giga_csv_vs_header` registrations, and the 14-byte
  `data/sounds.csv`.
- Similarity figures: blank lines stripped, whitespace collapsed, `//` comments stripped
  for the render-pass matrix only, `difflib.SequenceMatcher` on line sequences.
- Copy-paste detection: comments stripped; strings→`S`, numbers→`N`, identifiers→`I`;
  sliding 12-line window MD5; non-overlapping repeats only. Generated files were checked
  for a `// GENERATED by` banner and their repeats excluded from the debt count.
- **No repo file was created, modified, or deleted.** The only file written is this report.

