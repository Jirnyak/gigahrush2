# 07 — SIM / WORLD / CORE: LEGACY & DEAD CODE AUDIT

Repo `/Users/jirnyak/Mirror/gigahrush2`, branch `torus`, verified by grep/read **2026-08-17**.
Every claim carries `file:line`. Docs in this tree were treated as suspects, not sources.

Scope LOC (measured `wc -l`): `src/sim` 1979, `src/world` 2627, `src/core` 328, `src/ecs` 171,
plus `nav_cache` 1354, `samosbor` 1545, `noise` 625, `prop_system` 851, `antourage` 1215,
`room_zone` 1021. **Total audited: 11 716 LOC.**

---

## 0. HEADLINE FINDINGS (the five that matter)

| # | Finding | Class | Evidence |
|---|---|---|---|
| 1 | **`nav_cache.{cpp,h}` (1354 LOC) is 100 % dead in the shipped game.** The gate `nav_bake()` is `navBake_ \|\| !navCacheDir_.empty()`; `navBake_` defaults false and `set_nav_bake` / `set_nav_cache_dir` are **never called anywhere in `src/`** (tests only). 8 of its 13 public functions have zero `src` callers. | DEAD | `src/game/floor_stream.h:171,324`; `src/game/floor_stream.cpp:348-352`; `set_nav_cache_dir` grep → 0 hits in `src/` |
| 2 | **`fluid_step` has no caller outside tests.** The `"fluid"` field is seeded once by the generators and then **never evolves**, yet 4 consumers read it every tick as if it were live. `fluid.cpp` (170) + `fluid.h` (105) = 275 LOC of unwired solver. | UNWIRED / DEAD-FIELD | `src/sim/fluid.cpp:43`; seeded `src/game/floors/padic/padic_gen.cpp:594-621`, `blame_gen.cpp:672-677`; read `src/game/container.cpp:339`, `mob_spawn.cpp:50,235,605`, `monster_traits.cpp:66`, `render/voxel_mirror.cpp:269`; app comment admits it at `src/app/main.cpp:5045-5060` |
| 3 | **"post-samosbor re-bake / stitch" is cited in 6 headers and does not exist.** `samosbor_step` mutates a clock only — no carve, no geometry write, no nav/diffusion invalidation. Самосбор (self-assembly) never assembles anything. | SPEC-LIE | cited `src/world/nav.h:14,121,133`, `src/core/jobs.h:5`, `src/sim/diffusion.h:261,283`; actual effect list `src/app/main.cpp:3256-3325` (log line, fog scale, one-shot HP/psi on unsheltered player) |
| 4 | **`z` is treated as non-toroidal in two live systems, against the written law.** `AGENTS.md:206` and `world.md:31` both say "x/y/z wrap; W does not". `los.cpp` and `noise.cpp` wrap x/y and *subtract* z, and `los.cpp` fabricates an AGENTS.md citation to justify it. | ISOTROPY-VIOLATION + SPEC-LIE | `src/world/los.cpp:29,97-102`; `src/game/noise.cpp:235-241`; `src/game/noise.h:109` |
| 5 | **`carve_at` and `set_sub_material` have ZERO callers anywhere — including tests.** They are the two halves of the "layered materials / paint over concrete over iron" story that `destruct.h:19-23` and `destruct.md` both sell as built. Nothing paints a sub-material through the sanctioned API. | DEAD | `src/world/destruct.h:123,135`; `src/world/destruct.cpp:262,337`; grep across `src` + `tests` → definition sites only |

---

## 1. FIELD LIVENESS — every grid/buffer the sim owns

Cost basis: `kMacroDim=128` → 2 097 152 cells (`src/world/types.h:17-19`); `float` field = **8.00 MiB**;
`SubMask` = 8×u64 = 64 B → mask array = **128 MiB**; `CellType`=u16 → types array = **4 MiB**.

### 1a. `FieldRegistry` fields (dense `Field<T>`, `src/world/field.h:29-47`)

| Field | Allocated | Written by | **READ by a real consumer** | Mem/layer | Verdict |
|---|---|---|---|---|---|
| `"danger"` (`kDangerField`) | `diffusion.cpp:185` lazily on first deposit | `ai_panic_publish_step` → `diffusion_driver_add_at` (`src/game/ai.cpp:1250`); swept `diffusion_tick` (`main.cpp:3175`) | **YES** — AI flee steering `src/game/ai.cpp:861`; audio danger bed `main.cpp:7029-7033`; HUD | 8 MiB + 8 MiB back + 256 KiB + 4 KiB = **16.25 MiB** while hot | **LIVE** |
| `"fluid"` (`kFluidField`) | `padic_gen.cpp:595`, `blame_gen.cpp:673` — **on every floor, always** | Generators only (`padic_gen.cpp:602-621`, values `0.8f`/`0.5f`). `fluid_step` never called. | Read-only: crate flotation `container.cpp:339`, mob placement `mob_spawn.cpp:50`, wet trait `monster_traits.cpp:66`, GPU tint `voxel_mirror.cpp:269` | **8.00 MiB × every resident layer**, permanently | **FROZEN-FIELD** (data live, solver DEAD) |
| `"gas"` (`kGasField`) | `padic_gen.cpp:599`, `blame_gen.cpp:677` on every floor | Generators only (`padic_gen.cpp:623-632`, value `0.6f`) | Read **once per (floor,layer) change** to upload to GPU: `main.cpp:6831-6833`. The actual gas sim runs on GPU (`gpu_gas_pass`). | **8.00 MiB × every resident layer**, permanently, for a one-shot upload | **DEAD-FIELD in RAM** — should be a transient staging buffer, not a resident `Field<float>` |

Total per-layer permanently-resident dead/frozen field RAM: **16 MiB** (fluid + gas).
With the `FloorStreamer` slot pool (`floor_stream.cpp:52`) that multiplies by the slot count.

### 1b. `SubFieldRegistry` fields (paged, `src/world/subfield.h:47-164`)

| Field | Allocated | Written by | READ by | Cost | Verdict |
|---|---|---|---|---|---|
| `"sub_material"` (`CellType`) | `destruct.cpp:270`, `save.cpp:1365`, `padic_gen.cpp:571`, `blame_gen.cpp:661,685` | generators via raw `ensure_page`; `remove_key` drops pages `destruct.cpp:74` | `sub_material_at` `destruct.cpp:252`; GPU mirror `voxel_mirror.cpp:257,344,572`; save `save.cpp:1258` | 8 MiB page table + 1 KiB/mixed cell | **LIVE** |
| `"stain"` (`StainRGB`) | `stain.cpp:37` lazily on first paint | `stain_paint`/`stain_splat` — 2 call sites: `main.cpp:4234` (urine), `combat.cpp:1956` (blood) | GPU mirror `voxel_mirror.cpp:309,354,622` → raymarch | 8 MiB page table + 1.5 KiB/stained cell | **LIVE** |

`SubField<T>::at/page/ensure_page/drop_page/collapse_if_uniform/clear/reserve_pages/pages_in_use/bytes`
— `reserve_pages`, `pages_in_use`, `bytes` have no `src` callers (introspection only). Minor.

### 1c. Baked / non-registry buffers

| Buffer | Where | Cost | Read by | Verdict |
|---|---|---|---|---|
| `MacroGrid::masks_` | `macro_grid.h:164` | **128 MiB / layer** | physics, nav, diffusion, render, everything | **LIVE** |
| `MacroGrid::types_` | `macro_grid.h:163` | **4 MiB / layer** | materials, render | **LIVE** |
| `nav::FineNav::flow` | `nav.h:91` | **128 MiB** | `wander.cpp:418` via `coarse_next`+`nearest_node`; `ai.cpp:1154` | **LIVE** (through `AsyncBake`) |
| `nav::FineNav::nearest` | `nav.h:101` (`uint8`, 2 MiB) | 2 MiB | `wander.cpp:377`, `ai.cpp:1154` | **LIVE** |
| `nav::AsyncBake::pendingFine_` | `nav_async.h:107` | **+130 MiB during a bake** (260 MiB peak) | worker only | LIVE, but doubles peak |
| `FloorStreamer::nav_[]` (`FloorNav`) | `floor_stream.cpp:352-368` | 130 MiB **if enabled** | nothing — `nav_at` never called from `src/app` | **DEAD (gated off)** |
| `RoomZones::flow[bit]` | `room_zone.h:410` | 2 MiB per baked bit | `room_route` → `ai.cpp` errand branch | **LIVE** |
| `RoomZones::nearRoom[bit]` | `room_zone.h:413` | ~2 KiB per bit | `room_route` fallback | **LIVE** |
| `DiffusionScratch::back / open / hotGroups` | `diffusion.h:265-270` | 8 MiB + 256 KiB + 4 KiB | the sweep | **LIVE** |
| `FluidScratch::delta` | `fluid.h:63` | 8 MiB **when stepped** — never allocated in production | — | **DEAD** |
| `NoiseField` | `noise.h:149` | 2 KiB POD | `investigate.cpp:34`, `main.cpp:5492`, audio | **LIVE** |

**No `cellular`, `temperature`, `pressure`, `heat` or `charge` field exists.** `fields.md:33` and
`destruct.md` name them; `grep get_or_create<` across `src` returns exactly the 5 fields above.
`src/sim/cellular.h` does not exist (`destruct.md` cites it — see §8).

---

## 2. `diffusion.h` = 513 lines — WHAT IS ACTUALLY IN IT

Measured: **400 comment lines, 78 code lines, 35 blank — 77 % comment.**

- **Not templated bloat.** Zero templates in the header. One `template <class OpenFn> gradient_impl`
  lives in the `.cpp` anonymous namespace (`diffusion.cpp:116-134`) and is instantiated twice.
- **Channels instantiated: ONE.** `kDangerField = "danger"` (`diffusion.h:163`). `DiffusionParams::field`
  is a `std::string` so more are *possible*; nothing in `src` ever passes a different name.
- **Consumers of that one channel: 3** — `ai.cpp:861` (flee gradient), `main.cpp:7029` (audio),
  HUD. Verdict: **LIVE and correctly wired.** This is the best-engineered file in scope
  (zero-group skip, bit-identical A/B, double accumulator, quiet gate).
- The header is a *measurement log*, not an interface. Lines 20-117 are ~100 lines of
  benchmark prose that belongs in `performance.md` or the test that prints the numbers.
  **MERGE candidate: move lines 20-117 out; the header drops to ~200.**
- One real defect hidden by the prose: `DiffusionParams::field` is `std::string` **by value in a
  default argument** on 8 API functions (`diffusion.h:324,340,349,416,472,478,490,511`) — a
  `std::string` construction per call on paths documented as allocation-free.

### `samosbor.h` = 928 lines — same disease, worse ratio

Measured: **669 comment, 185 code, 74 blank — 72 % comment.**
- It is **not** a header full of implementation: the tables are `extern const std::array<...>`
  (`samosbor.h:231,236,252,264`) defined in `samosbor.cpp:78+`. Correct split.
- What *is* in the header: **19 `inline constexpr` tuning constants** + 8 `static_assert`s +
  ~10 trivial inline accessors. The rest is essay.
- Comment `samosbor.h:225-230` itself says the 7×5 B table "is not worth a CSV". Fine — but
  **8 of 15 public samosbor functions have zero `src` callers** (see §5 table).

### Comment-density table (whole scope, measured today)

| File | total | comment | code | cmt% |
|---|---|---|---|---|
| `sim/diffusion.h` | 513 | 400 | 78 | **77 %** |
| `game/samosbor.h` | 928 | 669 | 185 | **72 %** |
| `game/room_zone.h` | 441 | 300 | 112 | **68 %** |
| `game/noise.h` | 333 | 227 | 77 | **68 %** |
| `game/nav_cache.h` | 391 | 265 | 100 | **67 %** |
| `world/nav.h` | 158 | 95 | 43 | 60 % |
| `sim/drag.h` | 57 | 34 | 16 | 59 % |
| `sim/fluid.h` | 105 | 58 | 31 | 55 % |
| `ecs/components.h` | 156 | 83 | 55 | 53 % |
| `world/destruct.cpp` | 359 | 40 | 291 | 11 % |
| `world/stain.cpp` | 96 | 3 | 79 | 3 % |

**5 headers in scope are >65 % comment and total 2606 lines for 552 lines of code.**
~2050 lines of prose. That prose is where every SPEC-LIE in §8 lives.

---

## 3. ISOTROPY VIOLATIONS

Reference law: `src/world/gravity.h:14-28` (`GravityRegime`, 8 values) and
`gravity.h:56-84` (`GravityFrame{axis,upSign,tanA,tanB,pull}`).

| # | Site | Violation | Severity |
|---|---|---|---|
| I1 | `src/world/los.cpp:27-29` | `d = {wrap_delta_f(x), wrap_delta_f(y), b.z - a.z}` — z not wrapped | **HIGH** — combat fragment LOS is wrong across the z seam |
| I2 | `src/world/los.cpp:97-102` | `if (cell.z < 0 \|\| cell.z >= kMacroDim) ++blockers;` with a **fabricated** AGENTS.md citation | **HIGH** |
| I3 | `src/game/noise.cpp:235-241` | `dz = n.z - pos.z`; comment conflates in-layer z with the W stack, but `Noise` already has a separate `layer` byte (`noise.h:120`) | **HIGH** — hearing is wrong across the z seam |
| I4 | `src/game/floors/padic/padic_gen.cpp:602-632` | water hardcoded `z=0..2`, sumps at `z=1`, gas at `z=3..15`; `regime_down`/`GravityFrame` never consulted, even though the file *sets* the regime 25 lines earlier (`:578`) | **HIGH** — the module declares a frame and then ignores it |
| I5 | `src/ecs/components.h:78,81` | `CameraTag::yaw` "around world +Z (up)"; `eyeOffset{0,0,0.7f}` | MEDIUM — known camera-frame debt |
| I6 | `src/ecs/components.h:31` | `AABB half{0.4f,0.4f,0.9f}` — z is the tall axis by literal | MEDIUM |
| I7 | `src/sim/physics.cpp:202` | `vec3 up{0,0,1}` default when the entity has no `GravityAffected` | LOW (fallback only) |
| I8 | `src/world/macro_grid.h:33-56` | `kCentreZ`, `lowest_layer()`, `lowest_layer_centre()` — Z-frame shorthands beside the general `face_layer()`. **`lowest_layer()` has ZERO callers** (grep); `lowest_layer_centre()` has one (`prop_system.cpp:457`, which also hardcodes `z+1`) | MEDIUM + DEAD |
| I9 | `src/game/prop_system.cpp:116` | `AngularVelocity{vec3{impulse.z, impulse.x, 2.0f}}` — axis letters shuffled, `2.0f` magic on z | MEDIUM |
| I10 | `src/game/prop_system.cpp:173` | `impulse = normalize(projVel)*3.0f + vec3{0,0,1}` — hardcoded up | MEDIUM |
| I11 | `src/game/room_zone.h:71-75` | room taxonomy is X/Y only; "a room is a COLUMN through every storey" | MEDIUM (self-declared) |
| I12 | `src/game/combat.cpp:405,1145,2059` | `vec3 up{0,0,1}` literals | MEDIUM |
| I13 | `src/game/ai.cpp` recall trace is `(x,y)` data (`ai.cpp:1258`, `tangent(recall.awayX, recall.awayY, 0.0f)`) | MEDIUM |

**The gravity frame's own dead surface:** `GravityField::region` (`gravity.h:132`) and its
`RegionFn` typedef are **never assigned anywhere in `src/`** → `at(pos)` always returns `global`
→ `GravityRegime::Custom` is **unreachable** → 8 of 13 `Custom` handling branches
(`ai.cpp:617,1118`, `wander.cpp:128`, `combat.cpp:747,1001`, `controller.cpp:38`,
`faction_relations.cpp:200`, `gravity.h:156`) are dead. Also **only `NegZ` is ever set**
(`padic.h:53 kPadicGravity = NegZ`, `blame_gen.cpp:663`, `gravity.h:126` default). `regime_up()`
is used only via `up_vector()`. `axis_frame()` is header-internal.
→ **The whole 8-regime machine has one live value.** Classify: LEGACY-BY-ANTICIPATION, keep the
enum (it is cheap and the discipline it enforces is real), delete `RegionFn`/`region`.

**Clean, exemplary isotropy** (no findings): `src/sim/drag.h` (derived `kAirDragCoef=0.19`,
isotropic mean-face area), `src/sim/controller.cpp:25-68` (frame-built walk basis),
`src/sim/fluid.cpp:77-115` (frame-driven down + tangents), `src/game/antourage/antourage.cpp`
(uses `gravity_frames`, `face_layer`, `antourage_face_pack`).

---

## 4. DUPLICATED PRIMITIVES — the key question

| Primitive | Implementations | Sites | Proposed single home |
|---|---|---|---|
| **RNG / hash** | **9+** | `core/rng.h:22,34,44,56,59` (canonical) · `world/destruct.cpp:232` `carve_hash` · `world/destruct.cpp:119` `VisitedSet::mix` · `audio/dsp_math.h:19` `splitmix32` · `game/samosbor.h:183`+`samosbor.cpp:56` `SamosborRng` · `game/combat.cpp:2068-2074` inline splitmix · `padic_gen.cpp:82` LCG `1664525` · `blame_gen.cpp:65` LCG `1664525` · `floor_gen.h:173` xorshift stream | `core/rng.h` |
| **`rand01` (h>>8 × 2⁻²⁴)** | **4 byte-identical copies** | `core/rng.h:64-66` · `world/stain.cpp:22-24` · `game/needs.cpp:21` · `game/samosbor.cpp:61` | `core/rng.h::rand01` |
| **world→cell conversion** | **2 incompatible forms, 82 sites** | truncate `static_cast<int>(p/kCellSize)` — **55 sites** (`diffusion.cpp:104`, `door.cpp:22-24`, `wander.cpp:40-42`, `save.cpp:989-991`, `mob_spawn.cpp:609-611`, `prop_system.cpp:138-139`, `combat.cpp:982,1623`, `main.cpp:2435,6129,6490`…) vs `std::floor(...)` — **27 sites** (`ai.cpp:681,1141`, `combat.cpp:579,740,2327`, `needs.cpp:293`, `main.cpp:3292`, `los.cpp:34`, `stain.cpp:73`, `audio_system.cpp`) | **new `world/types.h::cell_of(float)` / `cell_of(vec3)`.** `diffusion.cpp:101-103` *claims* combat.cpp truncates uniformly — it does not (it does both). |
| **flat-index ↔ cell unpack** | **5** | `destruct.cpp:29-31` (`&127`,`>>7`,`>>14`) · `antourage.cpp:194-197` (`%kMacroDim`) · `antourage.cpp:558-560,631-633` (`&127`) · `nav.cpp:58-60` (`/W/W`, `%W`) · `main.cpp:1259-1261` · `ai.cpp:958` (pack side) | `world/types.h::macro_unpack(size_t)` beside `macro_index` |
| **6-neighbour direction table** | **4** | `world/nav.h:77` `kNavDir` (−x+x−y+y−z+z) · `world/destruct.cpp:150` `kDir6` (**different order**: +x−x+y−y+z−z) · `world/nav.cpp:62-66` inline `nbr[6][3]` · `game/light_bake.cpp:58` `kD[6][3]` (destruct's order) | `world/nav.h::kNavDir`, one order. The order mismatch is a live footgun: `nav` relies on `reverse(d)==d^1` (`nav.h:76`); destruct's table does not have that property in the same slots. |
| **DDA / voxel raycast** | **4** | `world/los.cpp:31-104` (real Amanatides–Woo, macro cells) · `world/stain.cpp:66-91` (fixed half-voxel march, sub-voxel) · `shaders/raymarch.frag` (GPU) · `shaders/shadow_march.glsl` (GPU) | CPU: one `world/dda.h` used by both `los` and `stain`. GPU pair is a documented contract; leave. |
| **AABB↔solid overlap** | 1 | `sim/physics.cpp:24-77` `aabb_overlaps_solid` — reused by `physics.h:43`, `room_zone`, `prop_system` | already single-homed ✔ |
| **toroidal wrap** | 1 canonical + 15 hand-rolled masks | `core/wrap.h:8` `wrapi` / `types.h:50` `wrap_macro` (canonical, 190+ uses) but `& 127` open-coded at `destruct.cpp:29-30,41-43`, `stain.cpp:30-32`, `antourage.cpp:558-560,631-633`, `main.cpp:1259-1261`, `gpu_gas_pass.cpp:93`, `ai.cpp:958` | `wrap_macro` / a `kMacroMask` constant if the mask form is wanted for speed |
| **material lookup** | 1 | `world/material_props.h` (generated) + `destruct.cpp:55 mat_key` + `destruct.cpp:252 sub_material_at` | ✔ single home, but `sub_material_at` duplicates `mat_key`'s logic in unpacked coords |

**Verdict: 6 primitives are implemented 3+ times.** The two with real correctness consequences are
the **world→cell rounding split** (82 sites, two answers) and the **6-neighbour table order
mismatch** (4 tables, 2 orders, one of which carries a load-bearing `d^1` invariant).

---

## 5. UNWIRED SYSTEMS — traced from the tick

App tick loop: `src/app/main.cpp:3046` (`while (simAccum >= kSimDt …)`).

| System | Called from the tick? | Chain / evidence |
|---|---|---|
| **diffusion** | ✅ YES | `main.cpp:3175 diffusion_tick(diffusionDriver, activeWorld, activeLayer, simTick)`; producer `ai_panic_publish_step`→`ai.cpp:1250`; floor hook `main.cpp:2580,7119` |
| **physics** | ✅ YES | `main.cpp:3937 physics_step(reg, stack, kSimDt)` |
| **drag** | ✅ YES | inside `physics.cpp:225 air_drag_step` |
| **controller** | ✅ YES | `controller_step` before samosbor block (`main.cpp` ~3230) |
| **noise** | ✅ YES | `main.cpp:3052 noise_step(noiseField, …)`; 11 publish sites; consumers `investigate.cpp:34`, `main.cpp:5492`, audio |
| **samosbor** | ✅ YES (clock only) | `main.cpp:3258 samosbor_step(...)` — advances phase, logs, one-shot damage. **No world mutation.** |
| **prop_system** | ⚠️ PARTIAL | `main.cpp:3944 prop_ragdoll_step`; `main.cpp:4053,4407 anchor_validate_step`. **`check_projectile_prop_hits` and `prop_interact_step` are never called anywhere.** |
| **antourage** | ✅ YES (event-driven) | `antourage_carve_step` 7 sites (`main.cpp:4062,4414,6754,2674…`); `antourage_detach_step` `main.cpp:6769`; `antourage_alive` `main.cpp:1327` |
| **destruct** | ✅ YES (event-driven) | `carve_sphere` `main.cpp:4025,4386`. **`carve_at` and `set_sub_material`: zero callers.** |
| **room_zone** | ✅ YES | bake `main.cpp:1396 bake_room_zones`; consumed `ai.cpp` errand branch + `needs.cpp:251 room_recover` |
| **nav (AsyncBake)** | ✅ YES | `main.cpp:1779 nav::AsyncBake nav; begin_floor_nav main.cpp:1381`; consumed `wander.cpp:377,382,418`, `ai.cpp:1154` |
| **nav_cache** | ❌ **NO CHAIN EXISTS** | only reachable through `FloorStreamer::ensure_loaded` behind `nav_bake()` (`floor_stream.cpp:352`), gated off (`floor_stream.h:171,324`). `set_nav_cache_dir` never called in `src`. |
| **fluid** | ❌ **NO CHAIN EXISTS** | `fluid_step` grep in `src` → 0 hits. Only `tests/world_test.cpp:382`, `tests/suite_gravity_regimes.inl:121,174`, `tests/suite_monster.inl:438`. |
| **stain** | ✅ YES (event-driven) | `main.cpp:4234`, `combat.cpp:1956` → GPU mirror |
| **los** | ✅ YES (event-driven) | `combat.cpp:1803 los_clear` (only caller) |

**Broken contract found:** `destruct.h:41` states the carve caller owes
`diffusion_mark_cell` per dirty cell. **`diffusion_mark_cell` has ZERO callers in `src/`** —
only the comment at `destruct.h:41` and the tests reference it. So every carve leaves the
diffusion walkability bitset stale: danger keeps flowing through a wall that was just blown open
and is held out of the new hole, until the next floor entry. Same for `door.cpp`, which
`diffusion.h:295-297` says is "the live case". **Live defect, not just dead code.**

---

## 6. DEAD / DISABLED / MAGIC

### 6a. Disabled code
- `#if 0`, `if (false)`, `TODO`, `FIXME`, `HACK`: **zero occurrences** across the whole audited
  scope. Clean.
- Only "0.0 multiplier": `diffusion.cpp:188` (a legitimate clamp).
- Only unused parameter: `src/sim/controller.cpp:98 (void)dt;` — `controller_step` takes a `dt`
  it never uses. Signature lie.

### 6b. Dead exported symbols (zero `src` callers; tests-only or nothing)

| Symbol | File:line | src | tests |
|---|---|---|---|
| `carve_at` | `destruct.h:135` | 0 | **0** |
| `set_sub_material` | `destruct.h:123` | 0 | **0** |
| `check_projectile_prop_hits` | `prop_system.h:174` | 0 | **0** |
| `nav_cache_error_text` | `nav_cache.h:215` | 0 | **0** |
| `samosbor_backoff` | `samosbor.cpp` | 0 | **0** |
| `samosbor_rand01` | `samosbor.h:190` | 0 | **0** |
| `SubMask::lowest_layer` | `macro_grid.h:47` | 0 | 0 |
| `nav_cache_usage` / `nav_cache_evict` / `load_nav_cache_sections` / `nav_cache_read` / `nav_cache_write` / `nav_cache_parse_name` / `nav_cache_bytes` | `nav_cache.h:236-374` | **0** | 2-14 each |
| `samosbor_beat` / `samosbor_beat_pulse01` / `samosbor_pick_variant` / `samosbor_duration_mean_ms` / `samosbor_cooldown_mean_ms` / `samosbor_first_cooldown_ms` | `samosbor.h` | **0** | 1-5 each |
| `prop_interact_step` | `prop_system.h:207` | 0 | 3 |
| `room_body_walkable` | `room_zone.h:354` | 0 | 4 |
| `antourage_face_axis` / `antourage_face_dir` | `antourage.h:109,110` | 0 | 2-3 |
| `carve_hash` / `carve_roll` | `destruct.h:107,113` | 0 | 3-6 (deliberately public for tests) |
| `GravityField::region` / `RegionFn` | `gravity.h:131-132` | **never assigned** | 0 |
| `NoiseSource::Melee` / `Siren` / `Decoy` | `noise.h:90,94,97` | never published | — |

`NoiseSource::Door` (`noise.h:92`, commented "reserved; there are no doors yet") is in fact used
as a **generic catch-all** for a flashlight click (`main.cpp:3837`), doors, and 4 prop-hit events
(`main.cpp:4194,4217,4245,4278`). Comment is stale; the enum is being abused.

### 6c. MAGIC CONSTANTS — no visible derivation

| Constant | Site | Why it is magic |
|---|---|---|
| `12` binary-search iterations | `physics.cpp:110` | precision target not stated |
| `kStepRise = kVoxelSize + 0.01f` | `physics.cpp:130` | the `0.01` skin is unexplained |
| `kStepGainEps = 1e-4f` | `physics.cpp:131` | — |
| `kContactSkin = 0.02f` | `physics.cpp:294` | — |
| `kBlend = 0.35f` (roll spin blend) | `physics.cpp:331` | "35 %" of nothing |
| `0.85f` angular settle decay | `physics.cpp:352-354` | per-substep, not per-second — rate depends on substep count |
| `kRollV2 = 1e-4f` | `physics.cpp:310` | — |
| impact floor `4.0f` m/s | `physics.cpp:261` | prose "a jump lands at ~5 m/s" ≈ derivation, weak |
| default `half{0.4,0.4,0.4}` | `physics.cpp:199` | disagrees with `AABB` default `{0.4,0.4,0.9}` (`components.h:31`) — **two different default bodies** |
| water `0.8f`, sump `0.5f`, gas `0.6f` | `padic_gen.cpp:610,619,630` | pure invention |
| stain falloff `1.0f - 0.75f*(t/reach)` | `stain.cpp:77` | — |
| stain march `kVoxelSize * 0.5f` | `stain.cpp:68` | "half-atom cannot skip one" ✔ derived |
| `kNever = 3.0e30f` | `los.cpp:47` | — |
| guard `3*kMacroDim + 3` | `los.cpp:72` | the `+3` is unexplained |
| `kStainBlood{150,12,10}`, `kStainUrine{140,120,25}` | `stain.h:41-42` | authored colours, acceptable but undocumented |
| `mask.full()` as walkability | `nav.cpp:17`, `diffusion.cpp:97` | vs `room_zone.h:346-353` which measured that this is **wrong for bodies** (62 of 63 bodies pinned). Two definitions of "walkable" coexist. |
| `q.reserve(1u << 16)` ×3 | `nav.cpp:47,98,135` | — |
| `hint * 4`, `want = 64` | `destruct.cpp:86-87` | load-factor never stated |
| `kSamosbor*` 19 constants | `samosbor.h:89-168` | mostly derived with `static_assert` ✔ — this file is the good example |
| `kAirDragCoef = 0.19f` | `drag.h:28` | **derived and shown** (v_t = 55.5 m/s) ✔ |

Good news: `drag.h`, `tick.h`, `samosbor.h` and `types.h` all derive their constants and pin
them with `static_assert`. The offender concentration is `physics.cpp` (7 undrived tuning
numbers) and `padic_gen.cpp` (3 field-seed values).

---

## 7. AUTHORSHIP

`git log --format='%an' -- <file> | sort | uniq -c`. **No commits by `Петушков А.` touch any file
in this scope** (verified `git log --author='Петушков' -- src/sim src/world src/core src/ecs …` → empty).

| File | commits | created by |
|---|---|---|
| `sim/diffusion.h` | **3 marko1olo**, 1 Jirnyak | Jirnyak |
| `sim/diffusion.cpp` | 2 marko1olo, 2 Jirnyak | Jirnyak |
| `sim/fluid.h` | **3 marko1olo**, 2 Jirnyak | Jirnyak |
| `sim/fluid.cpp` | 2 marko1olo, 2 Jirnyak | Jirnyak |
| `sim/physics.cpp` | 8 Jirnyak, 4 marko1olo | Jirnyak |
| `sim/camera.cpp` | 1 marko1olo, 1 Jirnyak | Jirnyak |
| `world/nav_async.{h,cpp}` | **2 marko1olo**, 1 Jirnyak | **marko1olo** |
| `core/tick.h` | **1 marko1olo (only author)** | **marko1olo** |
| `ecs/components.h` | 4 Jirnyak, 3 marko1olo | Jirnyak |
| `game/nav_cache.cpp` | **2 marko1olo**, 1 Jirnyak | Jirnyak |
| `game/samosbor.{h,cpp}` | **3 marko1olo**, 1 Jirnyak | **marko1olo** |
| `game/noise.{h,cpp}` | 1 marko1olo, 1 Jirnyak | **marko1olo** |
| `game/prop_system.cpp` | **16 marko1olo**, 9 Jirnyak | **marko1olo** |
| `world/gravity.h` | 4 Jirnyak, 1 marko1olo | Jirnyak |
| `world/nav.cpp` | 6 Jirnyak, 1 marko1olo | Jirnyak |
| `world/destruct.{h,cpp}`, `stain.cpp`, `los.cpp`, `subfield.h`, `field.h`, `macro_grid.h`, `material_props.h`, `core/{math,rng,wrap,jobs}.h`, `sim/drag.h`, `sim/controller.cpp`, `game/room_zone.cpp`, `game/antourage/*` | **Jirnyak only** | Jirnyak |

**Marko-dominated files: `prop_system.cpp` (16/25), `samosbor.{h,cpp}`, `noise.{h,cpp}`,
`nav_async`, `core/tick.h`.** Correlation with findings is real:
- `prop_system.cpp` — I9, I10 (axis-letter forces), 2 dead exports.
- `noise.{h,cpp}` — I3 (z non-toroidal), 3 dead enum values, `Door` abused as generic.
- `samosbor.{h,cpp}` — 72 % comment, 8 dead exports, and the "post-samosbor re-bake" myth (§0.3).
- `core/tick.h` — clean, correct, `static_assert`-pinned. Marko's best file here.
- `nav_async` — clean and correctly reasoned.

Files with **zero** findings are all Jirnyak-only: `drag.h`, `controller.cpp`, `jobs.h`, `field.h`.

---

## 8. DOC-VS-CODE — every FALSE claim found

### `fluid.md` (48 lines)
| # | Claim | line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | "double-buffered — reads one buffer, writes another" | 21 | **FALSE** | `fluid.cpp:55` `src = f.data()` and `:157` `dst = f.data()` are the **same vector**; it is a delta-accumulator, not double buffering |
| 2 | "Where it runs — NOWHERE today … no caller outside the tests" | 37-40 | **TRUE** ✔ (rare honest doc) | `fluid_step` grep |
| 3 | "The RAYMARCH pass tints cells by this field" | 47 | TRUE | `voxel_mirror.cpp:269`, `raymarch_pass.cpp:224` |
| 4 | `fluid.h:23-26` "ONE definition, four consumers … `fluid_step` advances it, `cube_pass` tints it" | h:23 | **FALSE ×2** | `fluid_step` never runs; the tinting consumer is `voxel_mirror.cpp` and it uses the **raw literal `"fluid"`** (`:269,493,609`), not `kFluidField` — the exact rename hazard that comment claims to have eliminated |
| 5 | `fluid.h:50-55` "`moved` exists for the RENDER … the cube pass caches its instance list (28.6 ms of a 43.6 ms frame)" | h:50 | **FALSE** | `FluidStep::moved` has zero consumers; `cube_pass` exists but reads no fluid |
| 6 | "Test: `test_fluid_conserves_mass`" | 6 | TRUE | `tests/world_test.cpp:366` |
| 7 | "`minFlow` ignores sub-threshold dribbles" | 22 | TRUE | `fluid.cpp:89,100,127` |
| 8 | "A game can run several independent fluids by naming different fields" | 33 | UNVERIFIABLE / never exercised | only `"fluid"` + `"gas"` exist, `"gas"` is never stepped by this |
| 9 | "solid sub-voxels below block the flow" | 15 | TRUE-ish | `capacity_frac` `fluid.cpp:22-27`; its own comment `:17-20` admits no partial mask is ever written, so it is binary |
| 10 | "toward −gravity's opposite" | 14 | TRUE | `fluid.cpp:78 regime_down` |

### `diffusion.md` (100 lines)
| # | Claim | line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **"nothing wires `diffusion_tick` into the app loop, so `danger` is null in the shipped game, the threat term reads 0 and no body ever flees"** | 68-71 | **FALSE — the flagship lie** | `main.cpp:3175` calls `diffusion_tick`; `main.cpp:3038-3042` says verbatim "`danger` is LIVE now"; producer `ai.cpp:1250`; consumer `ai.cpp:861` |
| 2 | "(src/app/main.cpp says so at the call site)" | 71 | **FALSE citation** | the call site says the opposite |
| 3 | "Test: `tests/world_test.cpp` (`test_diffusion`)" | 11 | TRUE but stale | `world_test.cpp:393`; the real suite is `tests/suite_diffusion.inl` / `test_diffusion_all` (`game_test.cpp:5355`), unmentioned |
| 4 | "double-buffered … buffers swap at the end" | 23-25 | TRUE | `diffusion.cpp:412 f.data().swap(scratch.back)` |
| 5 | "walkability `!mask.full()`, same as nav" | 27-28 | TRUE | `diffusion.cpp:97-99` vs `nav.cpp:17-19` |
| 6 | "All three axes wrap" | 36-37 | TRUE | `diffusion.cpp:296-305` — and directly contradicts `los.cpp:97` |
| 7 | "`kDiffusionSweepTicks = 25` at 125 Hz = 5 sweeps/s" | 84-86 | TRUE | `diffusion.h:191-195` `static_assert` |
| 8 | defaults rate 0.15 / decay 0.02 / minLevel 1e-4 | 55-59 | TRUE | `diffusion.h:199-201` |
| 9 | "`FloorSpec.hostility` scales mob spawn count/tier" | 79-80 | UNVERIFIED here (out of scope) | — |
| 10 | "the future utility-AI (#12)" as unbuilt | 71,97 | **FALSE** | it is built and consuming |

### `gravity.md` (105 lines)
| # | Claim | line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | "`regime_down(r)` … Used by: ground probes, **fluid, nav**" | table | **FALSE (nav)** | `regime_down` grep in `src/world/nav*` → **0 hits**; nav is regime-blind and 6-connected symmetric |
| 2 | "`region` is a plain function pointer … Default returns `global` everywhere" | 19-20 | TRUE but **the hook is never used** | never assigned anywhere in `src` |
| 3 | "Radial gravity (planetoids), sideways gravity … all fall out of the same vector" | 62-64 | **FALSE in practice** | only `NegZ` is ever installed (`padic.h:53`, `blame_gen.cpp:663`, `gravity.h:126`) |
| 4 | "eight values (±X, ±Y, ±Z, Zero, Custom)" | 33 | TRUE | `gravity.h:24-28` |
| 5 | "`gravity_frames(field, out)` … every frame the field declares, 1 or 6" | table | TRUE | `gravity.h:154-164`; one consumer `antourage.cpp:694` |
| 6 | "Physics … `vel += accel * scale * dt`" | 24 | TRUE | `physics.cpp:204-206` |
| 7 | "'Up' derived as `normalize(-accel)`" | 25 | TRUE | `physics.cpp:205` |
| 8 | "`spawn_projectile` carried the −Z basis until 2026-08-13" | 78-82 | TRUE | `combat.cpp:1129-1145` documents the fix |
| 9 | "each `World` owns its own `GravityField`" | 60 | TRUE | `world.h:35` |
| 10 | "See antourage.md for the first module written this way" | 55 | TRUE | `antourage.cpp:112,213,694` |

### `destruct.md` (165 lines)
| # | Claim | line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **"их судьба принадлежит sandpile-правилам (`[sim/cellular.h]`)"** | ~§Отрыв | **FALSE** | `src/sim/cellular.h` **does not exist**; `destruct.h:35` says the sandpile module was deleted 2026-08-10 as dead code |
| 2 | "Diffusion / Cellular → `*_mark_cell()` на каждую dirty-ячейку" | table | **FALSE** | `diffusion_mark_cell` has **zero callers in `src/`**; the debt is real and unpaid |
| 3 | "Генератор красит `set_sub_material()`" | §Слоёные | **FALSE** | `set_sub_material` has zero callers anywhere; generators use `SubField::ensure_page` directly (`padic_gen.cpp:571,640`) |
| 4 | "«долбление» киркой — серия ударов" | §Вероятностная | **FALSE (no pickaxe)** | `carve_at`, the declared pickaxe primitive (`destruct.h:134`), has zero callers |
| 5 | `(hash & 0xFFFF) * hardness < power << 16` | §Вероятностная | **TRUE** | `destruct.cpp:248-249` verbatim |
| 6 | "page-таблица 8 МБ … 2 ГиБ страниц в худшем случае" | §Слоёные | TRUE | 2 097 152 × 4 B = 8 MiB; 2²¹ × 512 × 2 B = 2 GiB |
| 7 | "`kMaxCarveProposals` = 128" | §Кто предлагает | TRUE | `combat.h:767` |
| 8 | "Тесты: `tests/suite_destruct.inl`" | header | TRUE | file exists |
| 9 | "`voxelMirror.mark_dirty(dirtyCells)`" | table | TRUE | `main.cpp:4036,4392` |
| 10 | "`anchor_validate_step()`" / "`antourage_carve_step()`" | table | TRUE | `main.cpp:4053,4407` / `main.cpp:4062,4414` |

### `nav.md` (189 lines)
| # | Claim | line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **"no runtime consumer steers by it yet — the utility-AI that calls `route_step` is task #12 … nothing in the running game moves differently yet"** | 5-8 | **FALSE** | `wander.cpp:377,382,418` steers by `nearest_node` + `coarse_next` + `kNavDir`; `ai.cpp:1154` |
| 2 | "A nearest-node field, **`uint16 nearest[128³]` = 2 MiB**" | L2 §  | **FALSE (type)** | `nav.h:101` is `std::vector<std::uint8_t>`; uint16 would be 4 MiB — the doc contradicts its own figure |
| 3 | "`route_step` … either follow the coarse `next`-hop chain toward that anchor **or** descend the current anchor's fine flow field" | §route_step | **FALSE** | `nav.cpp:253` always returns `fine.at(tNode, …)` — the **destination** anchor's field. `nav.cpp:245-252` explicitly explains why no next-hop chain is followed. `coarse` is used **only** for the reachability guard (`:243`). |
| 4 | **"bake at boundaries (load, post-samosbor stitch)"** | §Torus rules 2 | **FALSE** | no code anywhere re-bakes on samosbor; `samosbor_step` never touches geometry |
| 5 | "`FloorStreamer::ensure_loaded` … right after `generate_floor`, builds a per-module `FloorNav`" | §streaming | **FALSE for the shipped game** | gated off — `floor_stream.cpp:348-352` says verbatim "the shipping app steers off its own `nav::AsyncBake` and never reads `nav_at`" |
| 6 | "Opt-in disk cache … call `FloorStreamer::set_nav_cache_dir(dir)`" | §streaming | **DEAD** | never called in `src`; nothing enables it |
| 7 | `nav::AsyncBake`, the actual production bake path | — | **OMITTED entirely** | `main.cpp:1779,1381`; `nav_async.h` is not mentioned once in `nav.md` |
| 8 | "Still to build: **Fast-travel elevator hookup** — the travel is not wired" | §Still to build | **FALSE** | `src/game/fast_travel.{h,cpp}` exists and is included at `main.cpp:52` |
| 9 | "each writes a disjoint slice (its own row of `edge`/`dist`)" | §Determinism | **FALSE (dist)** | `dist`/`next` are written by single-threaded Floyd–Warshall `nav.cpp:176-202`, not by the parallel BFS |
| 10 | "Tests: `test_parallel_for`, `test_nav_coarse`, `test_nav_fine`" | header | TRUE | `world_test.cpp:509,530,571` |
| 11 | "`Dist = uint16`, `kUnreachable = 0xFFFF`, `kNavDir` order −x+x−y+y−z+z, `reverse(d)==d^1`" | L1/L2 | TRUE | `nav.h:38-39,77-79`; `nav.cpp:118` |
| 12 | "64 flow fields = 128 MiB, total L2 ≈ 130 MiB" | L2 | TRUE | 64 × 2 097 152 B |

**Doc-lie tally: 5 in `nav.md`, 4 in `destruct.md`, 4 in `diffusion.md` (one flagship), 3 in
`fluid.md`, 2 in `gravity.md` = 18 FALSE claims** in five documents that total 607 lines.
Two pairs of docs actively contradict each other (`diffusion.md`+`world.md`+`AGENTS.md` say
z wraps; `los.cpp`+`noise.cpp` comments say it does not).

---

## 9. DELETION PROPOSAL — ranked

### DELETE

| # | Target | LOC | RAM freed | Per-tick CPU | Risk |
|---|---|---|---|---|---|
| D1 | **`src/game/nav_cache.{cpp,h}`** + `tests/suite_navcache.inl` + `FloorStreamer::navCacheDir_`/`set_nav_cache_dir`/`nav_cache_name` glue (`floor_stream.cpp:355-368`) | **1354** (+ ~700 test) | 0 (never allocated) | 0 (never runs) | **NONE** — gated off, tests-only |
| D2 | **`src/sim/fluid.{cpp,h}` solver** — keep only `kFluidField`, `kFluidMinFlow`, `fluid_at`, `fluid_data` (≈35 lines) moved into `world/field.h` or a 40-line `fluid_read.h` | **240** | 8 MiB scratch never allocated | 0 (never runs) | LOW — 4 read consumers keep working |
| D3 | **`Field<float> "gas"` as a resident field** — replace with a transient upload buffer built at floor entry | ~15 | **8.00 MiB × resident layers** | 0 | LOW — one reader (`main.cpp:6832`) |
| D4 | `carve_at` + `set_sub_material` (`destruct.h:117-137`, `destruct.cpp:252-279,337-357`) — **or** wire them; zero callers today | 45 | 0 | 0 | LOW (but see M4) |
| D5 | `check_projectile_prop_hits` (`prop_system.{h,cpp}`) — zero callers anywhere | ~40 | 0 | 0 | NONE |
| D6 | `GravityField::region` + `RegionFn` (`gravity.h:128-134`) and the 8 dead `Custom` branches it makes unreachable | ~30 | 0 | 8 branch tests/tick-ish | LOW |
| D7 | `SubMask::lowest_layer()` (`macro_grid.h:47-51`) — zero callers | 5 | 0 | 0 | NONE |
| D8 | `NoiseSource::Melee/Siren/Decoy` (never published) + `nav_cache_error_text` + `samosbor_backoff` + `samosbor_rand01` | ~40 | 0 | 0 | NONE |
| D9 | **~2050 lines of benchmark/essay prose** from `diffusion.h` (400), `samosbor.h` (669), `room_zone.h` (300), `noise.h` (227), `nav_cache.h` (265 — goes with D1) → move measurements to `performance.md` / the tests that print them | **~1900** | 0 | 0 | NONE — but this is where the 18 doc-lies live |

**DELETE subtotal: ~3800 LOC of the 11 716 audited (32 %), with zero behavioural risk.**

### MERGE (dedupe — the "few general systems" goal)

| # | Merge | Sites collapsed | New home |
|---|---|---|---|
| M1 | **`cell_of(float)` / `cell_of(vec3)`** — pick `std::floor` (correct for negatives) and delete 82 hand-rolled conversions | 82 | `world/types.h` |
| M2 | **One 6-neighbour table** with the `d^1` invariant | 4 → 1 | `world/nav.h::kNavDir` |
| M3 | **One CPU DDA** (`world/dda.h`) used by `los_blockers` and `stain_splat`; fix the z-wrap while merging (I1/I2/I3) | 2 → 1 | new `world/dda.h` |
| M4 | **`rand01` ×4 → `core/rng.h::rand01`**; `carve_hash`+`VisitedSet::mix`+`SamosborRng`+the two generator LCGs → `core/rng.h` primitives | 9 → 1 | `core/rng.h` |
| M5 | **`macro_unpack(size_t)`** beside `macro_index` — kills 5 open-coded `&127`/`>>7`/`>>14` sites | 5 → 1 | `world/types.h` |
| M6 | **One walkability definition.** `mask.full()` (nav, diffusion) vs `room_body_walkable` (`room_zone.cpp:80`, measured to be the correct one for bodies). Make the body-sized test the primitive; nav/diffusion keep the coarse one only where they mean "flux/geometry", not "an agent fits". | 2 defs | `world/macro_grid.h` |
| M7 | **`AABB` default half-extents.** `components.h:31` says `{0.4,0.4,0.9}`, `physics.cpp:199` falls back to `{0.4,0.4,0.4}` — one number. | 2 → 1 | `components.h` |

### FIX (live defects surfaced by the audit, not deletions)

| # | Defect | Site |
|---|---|---|
| F1 | Carve/door never patch the diffusion walkability bitset — `diffusion_mark_cell` has zero callers despite `destruct.h:41` and `diffusion.h:295-297` declaring the contract | `main.cpp:4036,4392`, `door.cpp` |
| F2 | `los_blockers` does not wrap z (I1) and treats out-of-range z as a blocker (I2) | `los.cpp:29,99` |
| F3 | `noise_distance` does not wrap z (I3) | `noise.cpp:240` |
| F4 | `padic_apply_rules` seeds fluid/gas on hardcoded z-slabs while declaring a `GravityRegime` (I4) | `padic_gen.cpp:602-632` |
| F5 | `controller_step(dt)` ignores `dt` | `controller.cpp:98` |
| F6 | `std::string` by-value default args on 8 hot diffusion entry points | `diffusion.h:324,340,349,416,472,478,490,511` |
| F7 | Angular settle `*= 0.85f` is per-substep, so damping silently depends on `maxSubsteps` | `physics.cpp:352-354` |

### KEEP — exemplary, do not touch

`src/sim/drag.h` (derived constants, isotropic by construction, 57 lines) ·
`src/core/tick.h` (`static_assert`-pinned, explains the 4.17 % bug it fixed) ·
`src/core/{wrap,math,rng,jobs}.h` (small, single-homed, no findings) ·
`src/sim/controller.cpp` (frame-generic walk basis, the model for how to write isotropic code) ·
`src/world/{field,subfield}.h` (clean type-erased registries) ·
`src/sim/diffusion.cpp` (the sweep itself — best-measured code in the tree; only the header prose goes) ·
`src/world/nav_async.h` (correct ownership/threading argument) ·
`src/game/antourage/` (only module that actually uses `gravity_frames`/`face_layer` end to end).

---

## 10. CLASSIFICATION INDEX

- **DEAD** — nav_cache (1354), `carve_at`, `set_sub_material`, `check_projectile_prop_hits`, `SubMask::lowest_layer`, `GravityField::region`, `nav_cache_error_text`, `samosbor_backoff`, `samosbor_rand01`, 3 `NoiseSource` values, `FluidScratch`
- **UNWIRED** — `fluid_step` (no caller), `FloorStreamer::nav_[]`/`nav_at` (gated), `prop_interact_step`, `room_body_walkable`, `antourage_face_axis/dir`, 6 `samosbor_*` (tests only), 7 `nav_cache_*` (tests only)
- **DEAD-FIELD** — `"gas"` (8 MiB/layer for a one-shot upload); `"fluid"` is FROZEN not dead
- **DUPLICATE** — 9 RNG/hash impls, 4 `rand01`, 82-site 2-way world→cell split, 5 index-unpack, 4 neighbour tables, 4 DDA, 2 walkability definitions, 2 AABB defaults
- **LEGACY** — `SubMask::kCentreZ`/`lowest_layer*`, `CameraTag` +Z yaw, `AABB{.4,.4,.9}`, the unreachable `GravityRegime::Custom` machinery
- **ISOTROPY-VIOLATION** — I1…I13 (§3)
- **DISABLED** — `navBake_ = false` (`floor_stream.h:324`); no `#if 0` anywhere else
- **MAGIC-CONST** — 7 in `physics.cpp`, 3 in `padic_gen.cpp`, 2 in `stain.cpp`, 2 in `los.cpp`, 2 in `destruct.cpp`, 3 in `nav.cpp`
- **SPEC-LIE** — 18 FALSE doc claims (§8) + the fabricated `AGENTS.md` citation at `los.cpp:97-98`
