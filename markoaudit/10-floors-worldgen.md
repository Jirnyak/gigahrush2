# Audit 10 — Floor generation / worldgen / streaming / nav

Repo `/Users/jirnyak/Mirror/gigahrush2`, branch `torus`, HEAD `97bdf13e` (2026-08-17 17:27).
All evidence re-verified **today** by reading files and by building/running the tree.

Build/test state as measured now:
* `cmake --build build --target giga_game` → **green**.
* `./build/game_test` → **`243576 checks, 0 failures`**, exactly matching `CMakeLists.txt:1032`.
  (This is itself a finding — see §6.1.)

---

## 0. Executive verdicts

| # | Finding | Class | Severity |
|---|---|---|---|
| A | `nav_cache.{cpp,h}` (1354 LOC) + `FloorNav`/`nav_at` are reachable **only from tests** | UNWIRED / DEAD | ⬛ highest LOC win |
| B | `CMakeLists` check-count pin was measured on an **uncommitted** tree; clean HEAD is red | HALF-FINISHED | 🔴 |
| C | blame module (826 LOC + doc) is entirely untracked, with a known player-trapping defect (§57) | HALF-FINISHED | 🔴 |
| D | `floor_spec_for` + the whole V-shape spawn math have **zero src/ callers**, duplicated by `mob_table.h` | DEAD / DUPLICATE | 🟠 |
| E | `nav::route_step` has **zero callers**; 3 hand-rolled re-implementations instead | UNWIRED / DUPLICATE | 🟠 |
| F | `population.cpp` `kRoomStride = 16` vs `floor_gen.cpp` `kRoomStride = 4` — two diverged room lattices | DUPLICATE | 🟠 |
| G | `padic_module.cpp` shadows `kLatticeDim`/`kLatticeSpacing`/`kStorey` and re-derives the stair plan | DUPLICATE / LEGACY | 🟠 |
| H | `floor_gravity_regime()` / `floor_ground_coord()` hardwired to padic — a module cannot declare its frame | ISOTROPY-VIOLATION | 🟠 |
| I | nav cache key `(number, kind, seed)` does not cover generator version or snapshot restore | staleness hole | 🟡 latent |
| J | `nav.md` is ~40% false; `lattice.h`/`worldgen.md`/`floors.md` carry stale claims | SPEC-LIE | 🟡 |

---

## 1. Generator inventory

### 1.1 Every code path that can produce floor geometry

| Entry point | File:line | Which floors | Reachable at HEAD? |
|---|---|---|---|
| `generate_floor` (dispatch only) | `src/game/floor_gen.cpp:223` | all | YES — `floor_stream.cpp:313` |
| `generate_padic_floor` | `src/game/floors/padic/padic_gen.cpp:636` | kinds Residential/Commercial/Industrial/Derelict/Padic (rows 0–4 of `kGenerators`, `floor_gen.cpp:186-190`) | YES |
| `generate_blame_floor` | `src/game/floors/blame/blame_gen.cpp:681` | kind Blame only (row 5, `floor_gen.cpp:191`) | YES (floor 5, via `register_blame_floor`) — **but untracked** |
| snapshot restore (not a generator) | `floor_stream.cpp:310` `restore_(...)` hook | any visited floor | YES |
| `bake_antourage` (dressing, reads grid) | `floor_stream.cpp:335` | all | YES |

`floor_gen.cpp` contains **no geometry** — only the room-mix taxonomy tables and the three
per-kind dispatch rows, each pinned by a `static_assert` against `FloorKind::Count`
(`floor_gen.cpp:193, 201, 209`). That part of the design is clean.

### 1.2 Leftovers of the purged generic worldgen

`grep -rn 'worldgen|WorldGen|world_gen'` over the whole repo (excluding `build/`) returns
**no source symbol** — only prose. Confirmed dead-and-buried. Residual prose references:

| Where | Claim | Verdict |
|---|---|---|
| `ARCHITECTURE.md:47,162` | `L4 app/ … worldgen`, "`src/app/worldgen.cpp` … deleted" | stale table row (line 47), correct at 162 |
| `master_prompt.md:285` | `src/app  window + main loop + worldgen (main.cpp, worldgen.*)` | **FALSE** — file does not exist |
| `master_prompt.md:365` | "demo worldgen" in the built list | **FALSE** |
| `tools/perf_notes.md:155` | "The default is `WorldGenMode::FloorStack`" | **FALSE** — enum does not exist |
| `src/world/lattice.h:32-33` | "Spacing 32 divides every FloorKind's storey height (4/8/16) and room stride (8/16/32), so a node always lands on a slab + room line — see floor_gen.cpp" | **FALSE** — the only stride is 4 (`floor_gen.cpp:92`), the only storey is 3 (`padic_gen.cpp:61`); 32 % 3 ≠ 0. Pure leftover of the deleted per-kind generator. |
| `worldgen.md:20-22` | "The only registered geometric module today is **padic**" | **FALSE** — blame is registered (`floor_catalog.cpp:85`) |
| `worldgen.md:38-41` | "**No floor module seeds standing water today**" | **FALSE** — `padic_apply_rules` seeds water + gas (`padic_gen.cpp:596-633`) |
| `src/game/embody.h:41` | "2 m cells; see worldgen" | dangling reference |

### 1.3 Dead enum values in floor_spec

None. `FloorKind` has 6 live values; every one has a `kCatalog` row (`floor_spec.cpp:26-33`),
a `kRoomMix` row, a `kGenerators`/`kRuleDeclarers`/`kRuleAppliers` row, and a `kRoleWeights`
row (`role.h:87-96`). Rows 0–4 all point at the *same* generator, which is by design after
the purge but means **4 of the 5 "kinds" are pure content theming with no geometry of their own**.

---

## 2. floor_spec / floor_catalog — the data model, and the competing ones

### 2.1 What "a floor is"

Five artefacts, three of which are genuinely redundant.

| Model | File | Keyed on | Live? |
|---|---|---|---|
| `FloorDef {name, kind}` + claims + patterns | `floor_catalog.h:34-37`, `.cpp:66-88` | floor **number** | **YES** — the authority (`main.cpp:853`, `xray_map.cpp:469`) |
| `FloorSpec` (pop / factionMix / hostility / age) | `floor_spec.h:37-47`, `.cpp:26-33` | `FloorKind` | **YES** (`floor_stream.cpp:307/313/316`) |
| `floor_spec_for(int)` — the V-shape if-chain | `floor_spec.cpp:59-74` | floor number | **NO src caller** — see 2.3 |
| `kDemoFloors[10]` hand-authored table | `main.cpp:779-789` | floor number | **YES** — the app's real stack |
| per-module constants (`kPadicFloorNumber`, `kBlameFloorNumber`, `kPadicGravity`, `kPadicGroundCoord`…) | `padic.h:46,53,60`; `blame.h:49,55,62` | module | **YES** |

### 2.2 Competing-model violations

1. **`floor_spec_for` vs `build_default_floor_catalog` are the same V-shape written twice.**
   `floor_spec.cpp:63-72` (if-chain) and `floor_catalog.cpp:55-77` (pattern rows) encode
   identical predicates in identical order. `floor_catalog.cpp:42-49` admits this
   ("Same predicates, same order, same kinds") and `suite_floorcatalog.inl` pins them equal.
   They **cannot** stay equal for claimed numbers, and the test says so out loud:
   `suite_floorcatalog.inl:59` `CHECK(floor_spec_for(kBlameFloorNumber).kind == FloorKind::Commercial)`
   while `:61` `CHECK(cat.resolve(kBlameFloorNumber).kind == FloorKind::Blame)`.
   Any future caller of `floor_spec_for` gets the wrong kind for floors 4 and 5.
   → **DELETE `floor_spec_for`.**

2. **`main.cpp:779-789 kDemoFloors`** is a hand-authored per-number kind table — the exact
   thing the catalog exists to abolish. It is layered on as claims (`main.cpp:803-804`),
   so it is at least funnelled through one mechanism, but it is content living in `src/app`.

3. **`floor_room_stride(FloorKind)` ignores its parameter** (`floor_gen.cpp:96`,
   `int floor_room_stride(FloorKind /*kind*/) { return kRoomStride; }`). The comment at
   `floor_gen.cpp:88-91` says "when a second geometry module lands, this becomes that
   module's own export". A second module **has** landed (blame) and this was not done —
   blame's geometry has no 4-cell room lattice at all, yet `room_zone` and the container /
   mob spawners will index it as if it did.

### 2.3 Dead half of floor_spec

`grep -rn` over `src/` + `tools/` for the V-shape API:

| Symbol | file:line | src/ callers |
|---|---|---|
| `floor_spec_for` | `floor_spec.cpp:59` | **0** |
| `floor_depth01` | `floor_spec.cpp:76` | 0 (only internal) |
| `floor_danger` | `floor_spec.cpp:81` | 0 (only internal) |
| `floor_mob_count` | `floor_spec.cpp:97` | **0** |
| `monster_share` | `floor_spec.cpp:44` | 0 (only internal) |
| `kMobSoftCap = 384` | `floor_spec.h:76` | feeds only the above |
| `floor_mob_tier` | `floor_spec.cpp:112` | **1** — `console.cpp:189`, the debug `spawn` command |

It is **superseded**: `mob_table.h:277 mob_count_for_floor(floorZ, danger, theme)` and
`mob_table.h:286 mob_level_for_floor(floorZ, danger)` implement the same curve
(`mob_table.h:279`: "max(danger, round(1 + depth01*8 + (danger-1)*0.55))" — byte-identical
to `floor_spec.cpp:115-119`), and `mob_spawn.cpp:223-242` derives danger from
`spec.hostility` (`danger_for_hostility`) rather than from `floor_danger`.
→ ~70 LOC of `.cpp` + ~50 lines of header prose are **DEAD DUPLICATE**.

### 2.4 Every hardcoded `if (floor == N)` in src/

Full sweep (`grep -rnE "(floor|number|currentFloor|floorNumber)[A-Za-z]*\s*[=!]=\s*-?[0-9]"` over
`src/` and `tools/`):

| file:line | code | class |
|---|---|---|
| `src/game/floors/padic/padic_gen.cpp:529` | `if (number == 0) {` — stamps `kMatExtract` on the hub | **HARDCODED-FLOOR** |

**One** violation in the whole tree — genuinely good. But it is a bad one: the *padic module*
branches on floor **0**, a number padic does not claim (it claims 4, `padic.h:46`). It works
only because kind Residential also dispatches to `generate_padic_floor`. The day floor 0 is
claimed by another module (or blame's row is copied), the extraction pad silently disappears
and `blame_gen.cpp` has no equivalent. The extraction marker belongs in a per-number data row,
not in a module's geometry.

---

## 3. padic vs blame — duplication

Measured mechanically (comment/blank-stripped, whitespace-normalised):

* padic_gen.cpp: 700 raw / **506 code lines**
* blame_gen.cpp: 725 raw / **520 code lines**
* blame lines appearing verbatim somewhere in padic: **174**
* contiguous verbatim runs ≥ 4 lines: **35 lines** in 4 blocks

| blame lines | padic lines | what | LOC |
|---|---|---|---|
| 40–48 | 43–51 | include block | 9 |
| 64–69 | 81–86 | `lcg` + `rnd` LCG (1664525/1013904223) | 6 |
| 389–400 | 292–303 | `put_bits` body | 12 |
| 405–412 | 308–315 | `put_sub` body | 8 |

Beyond exact copy, these are **the same primitive re-spelled**:

| Primitive | padic | blame | LOC each |
|---|---|---|---|
| sub-voxel stamping (`put_bits`, `put_sub`) | `padic_gen.cpp:289-315` | `blame_gen.cpp:386-412` | 27 |
| RNG (`lcg`, `rnd`) | `:81-87` | `:64-70` | 7 |
| bit constants (`kAllBits`, `kGrateBars`) | `:69,74` | `:60,62` | 2 |
| clear-grid-to-air + `sm.clear()` | `:644-649` | `:415-424` (inside `stamp_sculpt`) | 6 |
| `*_declare_rules` (subfield registry + gravity assignment) | `:567-580` | `:659-664` | 6–14 |
| `*_apply_rules` fluid create-or-zero | `:588-600` | `:670-679` | 10 |
| lattice stamping: shaft clear + lobby + hub-pad recolour + 4 corner posts | `stamp_lattice` `:478-553` | `stamp_lattice_markers` `:622-655` | ~40 vs ~34 |
| closed-riser 2/8 flight math | `stamp_stair` `:364-415` | `stamp_serpentine` `:534-567` | re-derived, not copied |

**Quantified duplication that should be a shared library: ~95–110 LOC per module (≈ 200 LOC total),
concentrated in stamping + lattice + rules skeleton.**

Both `padic.h:13-18` and `blame.h:25-30` explicitly state "Modularity beats DRY on purpose".
That is a defensible owner decision for *content* (grammar, plan, materials), but the
duplicated set above is **not content** — it is engine plumbing (`SubField` page mechanics,
the mandatory fast-travel lattice from `lattice.h`/`fast_travel.h`, the World-recycling
contract). The lattice one is the dangerous case: `fast_travel.h:59-68` already documents
that a second copy of the shaft radii is how `padic_module.cpp` came to shadow `kLatticeDim`.

**Sketch of the shared library** (`src/game/floors/floorlib.h` + `.cpp`, ~150 LOC):

```
// stamping
void put_bits(MacroGrid&, SubField<CellType>&, int x,int y,int z,int wz, u64 bits, CellType);
void put_sub (MacroGrid&, SubField<CellType>&, int cx,int cy,int baseZ, int SX,int SY,int L, CellType);
inline constexpr u64 kAllBits, kGrateBars, kSubRow(int sy), kSubBox(x0,x1,y0,y1);
// rng
struct FloorRng { u32 s; u32 next(); int range(int lo,int hi); };
FloorRng floor_rng(unsigned seed, int number, u32 stageSalt);   // one chain per stage
// world lifecycle (the generate_floor contract, once)
void floor_clear_to_air(World&, SubField<CellType>&);
void floor_declare_frame(World&, GravityRegime);                 // the *_declare_rules body
void floor_reset_fluids(World&);                                 // the *_apply_rules body
// the MANDATORY lattice — one implementation, not one per folder
void stamp_fast_lattice(MacroGrid&, SubField<CellType>&, const LatticeOpts&);
```
Each module keeps its own `build_plan`, its own grammar and its own `*.h` manifest.
Deleting a folder still deletes the floor; the plumbing is not the folder's business.

Additional per-module items:

* `blame_module.cpp` is a **16-line stub** — one `cat.claim(...)`. Nothing else. Fine, but it
  means blame ships no props/loot/NPCs; `blame_gen.cpp:721` `(void)spec.population` and
  `floor_gen.cpp:171` `if (spec.kind == FloorKind::Blame) return 0;` (zero doorways) mean the
  floor has geometry and a crowd and nothing else.
* `padic_module.cpp:38-42` re-declares `kStorey=3, kLastBase=123, kCorr0=16, kLatticeSpacing=32,
  kLatticeDim=4` as **file-local constants shadowing the real ones** in `lattice.h:31,33,37`
  and `padic_gen.cpp:61-62,79`. It then re-derives the stair plan
  (`padic_module.cpp:98-101`: `((bi+bj)&1)!=0 continue; bx=kCorr0+bi*32+2; sx=bx+13; sy=by+1`)
  which is a verbatim second copy of `padic_gen.cpp:249-252`. `fast_travel.h:65-67` names this
  exact file as the precedent for the shadowing bug class — and it is **still there**.
  Authored by marko1olo (`02696918`, `c48ba4a4`, `52947b3b`, `689fe40f`).

---

## 4. nav_cache + nav

### 4.1 Is the bake used at runtime? — NO for `nav_cache`; YES for `nav`.

Two independent bake paths exist:

| Path | Owner | Consumers | Live? |
|---|---|---|---|
| `nav::AsyncBake nav;` | `main.cpp:1779`, started in `begin_floor_nav` (`:1381`, called at `:1979, :2622, :4819, :7146`) | `wander_step` (`main.cpp:3796`), `ai_patrol_step` (`main.cpp:3794`), `ai_step` errands (`ai.cpp:1112`) | **YES** |
| `FloorStreamer::nav_[m]` / `FloorNav` / `nav_cache` | `floor_stream.cpp:352-369` | `nav_at` (`floor_stream.cpp:455`) | **NO** |

* `FloorStreamer::nav_bake()` is `navBake_ \|\| !navCacheDir_.empty()` (`floor_stream.h:171`),
  `navBake_` defaults **false** (`:324`).
* `set_nav_bake` — callers: **none in `src/`**; only tests.
* `set_nav_cache_dir` — callers: **none in `src/`**; only `tests/game_test.cpp:4987`.
* `nav_at` — callers: **none in `src/`**; the header says so itself (`floor_stream.h:159`:
  "`nav_at` has no caller outside the tests").

⇒ **`src/game/nav_cache.cpp` (963) + `.h` (391) = 1354 LOC is exercised only by
`tests/suite_navcache.inl` (1316) + two tests in `game_test.cpp` (:4932, :4971).**
The `FloorNav` struct (`floor_stream.h:53-56`), `nav_[kMaxModules]` (`:316`), `nav_at`
(`:285`, `.cpp:455-459`) and the whole `if (nav_bake())` block (`.cpp:352-369`) are dead
weight in the shipping binary. Total dead surface ≈ **1400 LOC src + 1350 LOC tests**.

### 4.2 Disk cache: invalidation, versioning, staleness

* Magic `kNavCacheMagic = 0x4E324847` ("GH2N"), `nav_cache.h:102`.
* Version `kNavCacheVersion = 2u`, `nav_cache.h:116`.
* Key = `NavCacheKey {int number; FloorKind kind; uint32 seed;}` (`nav_cache.h:188-196`).
* All validation is in one function, `check_header` (`nav_cache.cpp:219-266`): magic → version
  → key (`number`, `kind`, `seed`) → shape (`nodes`, `macroDim`) → declared section lengths.
  CRC-32 on the coarse section only (`nav_cache.h:378-390` justifies skipping it on the 130 MiB half).

**Two real staleness holes, both currently latent because the path is off:**

1. **Generator version is not in the key.** `nav_cache.h:104-109` says "Bump on ANY change to
   the wire layout OR to the bake algorithm". It does **not** say "or to any floor generator" —
   and the geometry is exactly what the bake is a function of. Edit `padic_gen.cpp` (as happened
   on `dd8c7955`, `10a07c2e`, `b43739ee`, `24ef83a7`…) and every cached blob for every padic
   floor silently describes the *previous* building. Nothing anywhere hashes the generator.
   `kNavCacheVersion` has been at 2 since it was written; `padic_gen.cpp` has changed 12 times since.

2. **Snapshot restore is not in the key.** `floor_stream.cpp:310` may restore a floor's geometry
   from `floor_<N>.sav` — which carries the player's carves — *instead of* generating. The cache
   is then keyed on `(number, kind, seed)`, which describes the **pristine** floor. A revisited,
   blown-up floor would load nav for geometry that no longer exists.

Both are pre-existing designs of a path nothing calls. If the path is ever re-armed, both bite.

### 4.3 Test tmp dir pollution

`navcache_test_tmp/` exists in the repo root, **empty**, created by
`tests/game_test.cpp:4942` and `:4982` (`const std::string dir = "navcache_test_tmp";`) plus
`suite_navcache.inl:292-293` (`navcache_test_tmp/evict`, `.../evict_full`).
It **is** gitignored (`.gitignore`, the "Scratch directory for the nav-cache round-trip tests"
block) and the tests `std::remove` their own files, but there is no `remove_all`, so the
directory itself is never cleaned. `.gitignore` even documents the gap
("insurance rather than a live fix … a run that fails part-way leaves a `.bin` behind").
Minor: the tests write into the *repo root* rather than a build/temp dir.

### 4.4 Duplicate pathfinding — four implementations, one of them unused

| # | Implementation | file:line | Walkability predicate | Live? |
|---|---|---|---|---|
| 1 | `nav::route_step` — the documented composer | `nav.cpp:223-254` | n/a (query) | **NO CALLER**. `tools/check_wired.cmake:70` declares it deferred: `"route_step:целевой шаг по флоу-полю отложен к #13"` |
| 2 | `wander_step` — coarse `next`-hop + `fine.at(hop,…)` | `wander.cpp:377-384` | `!mask.full()` (via bake) | YES |
| 3 | `ai_patrol_step` — hashed node pick + `fine.at(nodeTo,…)` | `ai.cpp:1152-1178` | same | YES |
| 4 | `ai_step` errands — `RoomZones::flow[bit]` descent | `ai.cpp` via `room_zone.cpp:555-556` | **body-sized 4×4×7** (`room_zone.cpp:44-67`) | YES |

Two *different flow-field bakers* now exist over the same grid:
`nav::bake_fine` (`nav.cpp:205`, 64 fields × 2 MiB = 128 MiB, `blocked = mask.full()`,
`nav.cpp:17-19`) and `bake_room_zones` → `bake_flow` (`room_zone.cpp:293-346`, one field per
room bit, `blocked` = centred 4×4 footprint over 7 sub-layers, `room_zone.cpp:60-67`).
`room_zone.cpp:18-42` documents *why* they diverge (62 of 63 bodies stalled on nav's
1-in-512 bar) — so this is a **deliberate, correct** divergence, but it leaves nav's own
predicate knowingly wrong for bodies while `wander_step` and `ai_patrol_step` still steer by it.

Also note `#2` and `#3` between them implement *both* halves route_step's own comment
(`nav.cpp:245-252`) says it deliberately does **not** do. Three answers to one question.

### 4.5 Elevator lattice / HPA*

`src/world/lattice.h` (83 LOC) is real, correct, dependency-free, and used by both generators
(`padic_gen.cpp:486-489`, `blame_gen.cpp:623-624`), by `nav.cpp:24-28` (node cells) and by
`fast_travel.h:30-49`. `nav::kNodes == kLatticeCount == 64`. The "HPA* coarse graph" is
`bake_coarse` (`nav.cpp:169-203`: 64 parallel BFS + Floyd–Warshall). It **is** used —
`wander.cpp:381 nav::coarse_next` and `ai.cpp:1170 coarse.dist[...]`.

Elevator implementation: `src/game/elevator.cpp` (124 LOC, `ride_elevator`) +
`src/game/fast_travel.h` (~180) + `fast_travel.cpp` (17) + `floor_registry.{h,cpp}` (134+83).
All live. `elevator.cpp:71-77` is **isotropy-correct** (goes through `regime_down(floor_gravity_regime())`).

### 4.6 nav dead / disabled code

* No `#if 0`, no `if (false)`, no disabling early `return;` anywhere in `nav.cpp`,
  `nav_cache.cpp`, `floor_stream.cpp`, `floor_gen.cpp`, `room_zone.cpp`, either generator.
* `nav.h:124-136` is a *tombstone comment block* for the deleted `LazyFieldRebaker`
  (marko1olo `9a3345c5`, reverted by Jirnyak `60dbd2aa`). The code is gone; **but**
  `main.cpp:1771` and `main.cpp:2680` still carry `// §22: lazy nav field rebake under
  frame budget after carves` / `// §22: amortize nav field rebake under frame budget`
  attached to a `LevelStack stack;` declaration and a plain `SDL_GetPerformanceCounter()`
  — **lying comments over unrelated code**, LEGACY.

---

## 5. floor_stream

### 5.1 What is streamed, when, by whom

Streamed unit = one **floor module** → one `LevelStack` layer (one 128³ `World`) + its embodied crowd.

| Step | Code |
|---|---|
| register (no load) | `add_module` `floor_stream.cpp:55`; caller `main.cpp:1915`, `xray_map.cpp:455/471` |
| seed cold crowd for all modules | `seed_all_modules` `:75`; caller `main.cpp` (~:1935) |
| enter | `ensure_loaded` `:239`; callers `main.cpp` (:1979-area, :2489-area, :4819), `teleport` `:522` |
| leave | `unload` `:377`, `keep_only` `:476` (`d > keepRadius_`) |
| travel | `travel` `:488` → `teleport` `:506` → `ride_elevator` `:527` |

`init(stack, keepRadius=0)` (`main.cpp:1904`) → `slots = 2*0 + 2 = 2` layers
(`floor_stream.cpp:50`). So **eviction is exercised on every single ride**
(`keep_only` at `:537`), not a dormant cap. Live proof in the test run output:
`[aimem] RELEASE floor=0 layer=1 bodies=420 released=0`.

### 5.2 The ~700 MB claim — VERIFIED, and worse than stated

Arithmetic, every input cited:

| Input | file:line | value |
|---|---|---|
| `sm.reserve_pages(700000)` | `padic_gen.cpp:648` | 700,000 pages |
| `struct Page { T v[kSubVoxels]; }` | `subfield.h:155-156` | |
| `kSubVoxels = 8*8*8` | `types.h:24` | 512 |
| `using CellType = std::uint16_t` | `macro_grid.h:24` | 2 B |
| ⇒ page = 512 × 2 | | **1024 B** |
| ⇒ reserve | 700,000 × 1024 | **716,800,000 B = 683.6 MiB** |
| + `pageOf_` = `kMacroCells` × u32 | `subfield.h:52` / `types.h:18` | 2,097,152 × 4 = 8 MiB |
| **Total per padic floor** | | **≈ 692 MiB** |

Derivation of the constant *is* recoverable (sandwich = one paged cell per (x,y) per storey:
42 storeys × 128 × 128 = 688,128, + attic 16,384 = 704,512 ≈ 700,000) — but the code only says
`// Every sandwich cell will page` (`padic_gen.cpp:647`). **MAGIC-CONST (weak)**: write the arithmetic.

blame reserves `sm.reserve_pages(200000)` = **195 MiB** (`blame_gen.cpp:714`), comment
"Far fewer paged cells than padic's per-storey sandwich" — no number derived. **MAGIC-CONST.**

**The undocumented part:** `SubField::clear()` (`subfield.h:137-141`) does
`pages_.clear()` — which does **not** release capacity. Two recyclable layers exist
(`keepRadius=0`). Once both have held a padic floor, **~1.37 GiB of `Page` capacity is
retained for the process lifetime and never returned**, whatever floor is resident.
`floor_stream.cpp:447-449`'s comment ("its World stays allocated in the stack, ready to be
regenerated — dense over sparse") is true but does not price this.
`floors.md:181-184`'s "~700 MB RAM … an accepted cost" is therefore **half** the real figure.

### 5.3 room_zone — live, and the third baked field

`room_zone.cpp` 580 + `.h` 441 = 1021 LOC. **LIVE and load-bearing**:
`main.cpp:1396 bake_room_zones`, `main.cpp:1096` furnishing, `ai.cpp:591/605/893/…`,
`needs.cpp:251`. `tests/suite_rooms.inl` 737 LOC. Not a deletion candidate — but it is the
system that quietly makes `floor_room_stride`'s ignored parameter (§2.2) dangerous, and it
carries the isotropy violation in §7.

### 5.4 floor_stream dead/disabled

* No `#if 0` / `if(false)` / disabling returns.
* `if (nav_bake())` block `:352-369` — dead in the app (§4.1). Note the block's body is
  **unindented** (`:353-368` sit at the outer level) — a visual tell that it was bolted on.
* `FloorModule::candidate` machinery (`floor_stream.cpp:180-198`, ~40 LOC of scan + 30 lines of
  comment) is live but exercised at most **once per session** (`playerId == kInvalidNpc`).

---

## 6. Dead / disabled / magic / pinned

### 6.1 The pin problem — HALF-FINISHED, blocking

`CMakeLists.txt:1032` pins `PASS_REGULAR_EXPRESSION "game_test: 243576 checks, 0 failures"`,
bumped in HEAD `97bdf13e` (2026-08-17 **17:27**) with the note `243565 -> 243576 (+11) … light_bake`.

The blame work is **uncommitted** and predates it:

| file | mtime | state |
|---|---|---|
| `src/game/floor_spec.h` | 2026-08-17 **05:11:07** | modified, untracked change |
| `src/game/role.h` | 05:11:13 | modified |
| `src/game/floor_gen.cpp` | 05:11:38 | modified |
| `src/game/floor_catalog.cpp` | 05:11:45 | modified |
| `tests/suite_navcache.inl` | 05:17:38 | modified (`450` → `540`) |
| `tests/suite_floorcatalog.inl` | 05:17:44 | modified (+3 CHECKs) |
| `src/game/floors/blame/*` | 05:12–05:53 | **untracked** |

Adding `FloorKind::Blame` adds CHECKs in four kind-loops:
`suite_navcache.inl:609` (+90 iterations × 3 = **+270**),
`game_test.cpp:423` (**+3**), `game_test.cpp:1587` (**+1**), `suite_floorcatalog.inl:57-61` (**+3**)
= **+277**.

⇒ A clean checkout of HEAD would report **243299** and `ctest` would call `game_test` FAILED.
Three commits (`86bcef93` 06:44, `0ea3a70f` 12:24, `97bdf13e` 17:27) were all measured on a
dirty tree. **The committed pin is only satisfiable with uncommitted work present.**

### 6.2 Brittle golden numbers

| Pin | file:line | Brittleness |
|---|---|---|
| `game_test: 243576 checks` | `CMakeLists.txt:1032` | 🔴 any FloorKind / any test edit moves it; currently wrong at HEAD |
| `world_test 23391/23391` | `CMakeLists.txt:482` | same class |
| `audit_test: 146 checks` | `CMakeLists.txt:543` | same class |
| `g_tally.namesRoundTripped == 540` (×2) | `suite_navcache.inl:621, 1255` | 🔴 **the FloorKind count is baked into a literal, twice** — every new floor module is a two-line test edit |
| `g_tally.namesRefused == 20` | `suite_navcache.inl:658, 1256` | ok (enumerated list) |
| `kNavCoarseWire == 13056`, `kNavCacheCoarseOnlyWire == 13108`, `kNavCacheFineOnlyWire == 136314932`, `kNavCacheFullWire == 136327988`, `kNavCacheFineBudgetBytes == 545311952` | `nav_cache.cpp:186-196` | 🟡 correct-by-derivation asserts; they block changing `kLatticeDim` (see `main.cpp:6117-6120`, which prices exactly this) |
| `static_assert(kPadicGroundCoord == 3)` | `floor_gen.cpp:135` | ok — pins `save.h:727 kArrivalCoord` |
| `static_assert(RoomBit::Hq == 1<<10)` | `floor_gen.cpp:85` | ok |
| door count "15147" from memory | — | **not present in tests today**; `suite_doors.inl:66` is `CHECK(n == ways.size())`, i.e. self-consistent, not golden. The brittle door pin is gone. |

### 6.3 Magic constants with no visible derivation

| Constant | file:line | Comment says | Derivation visible? |
|---|---|---|---|
| `kMobSoftCap = 384` | `floor_spec.h:76` | "rescaled for a SINGLE live floor's O(n) tick" | **NO** — and it feeds only dead code (§2.3) |
| `-3.1`, `2.35`, `100.0`, `4096.0`, `0.96` | `floor_spec.cpp:45-48` | "reference `monsterShareForRouteZ`" | ported verbatim, no local derivation — dead code |
| `0.06`, `0.7 + hostility` | `floor_spec.cpp:100,104` | — | **NO** — dead code |
| `dirWeight = 4.0f` | `floor_spec.cpp:92` | "descending far deadlier" | **NO** — dead code |
| `25.0f` (depth normaliser) | `floor_spec.cpp:77` | derived at `floor_spec.h:79-80` (`|floor|/25 == |z|/50`) | YES |
| `kRoomStride = 4` | `floor_gen.cpp:92` | — | **NO** |
| `reserve_pages(700000)` | `padic_gen.cpp:648` | "every sandwich cell will page" | partial (§5.2) |
| `reserve_pages(200000)` | `blame_gen.cpp:714` | "far fewer" | **NO** |
| `kLastBase = 123`, `kStorey = 3` | `padic_gen.cpp:61-62` | "storeys at b=0,3,…,123; 126..127 attic" | YES |
| `sx = bx + 13`, block `29`, bsp min `9`/`6` | `padic_gen.cpp:249, 232, 279-281` | — | **NO** |
| blame plan: `tA 22..28, gap 9..12, tB 18..24, slit 3..4, zPlat 18..24, tC 12..16, yc1 4..36, tc1 8..12, zc2 56..80, wellW 10..13, deckZ 10+i*16+0..5` | `blame_gen.cpp:119-146` | fiction ("chasm 18..24 m") | **NO** — 22 tuning numbers, none derived from body size, reach or fall time |
| `strip_y`: `+7 + rnd(0,15)` | `blame_gen.cpp:578-579` | derived in the comment (32 pitch, 10-wide strip, 7×7 pylon) | **YES** — the one good example |
| `kNavCacheFullEntries = 4` | `nav_cache.h:166` | derived at length (`:158-165`) | YES |
| `kNavCacheMaxCoarseStubs = 512` | `nav_cache.h:174` | derived (`:170-173`) | YES |
| `kFastShaftR = 1`, `kFastLobbyR = 3` | `fast_travel.h:75-76` | "3x3 column / 7x7 lobby" | partial (no body-width derivation, though `:82` argues 0.8 m in a 6 m column) |
| `kSaltSeat = 0x5ea70000`, `kSaltFurnitureYaw = 0xf00d1e00` | `room_zone.cpp:73,76` | purpose stated | fine (salts) |
| `kBodySubLayers = 7`, `kBodyFootprint` 2..5 | `room_zone.cpp:44-58` | derived from 0.4 m half-width / 0.85 m half-height at 0.25 m voxels | **YES** — model example |

### 6.4 Unreferenced / vestigial

| Item | file:line | Status |
|---|---|---|
| `floor_ground_z()` | `floor_gen.cpp:131`, decl `floor_gen.h:106-108` "Legacy projection" | still exported; `population.cpp:6` includes `floor_gen.h` *for it* and never calls it → **lying include comment** |
| `floor_spec_for` | `floor_spec.cpp:59` | 0 src callers |
| `floor_mob_count`, `floor_danger`, `floor_depth01`, `monster_share` | `floor_spec.cpp:44,76,81,97` | 0 src callers |
| `FloorStreamer::nav_at`, `nav_[]`, `FloorNav`, `set_nav_bake`, `set_nav_cache_dir` | `floor_stream.h:53,136,170,285,316` | 0 src callers |
| `nav::route_step` | `nav.cpp:223` | 0 callers; deferral declared `check_wired.cmake:70` |
| `FloorCatalog::first_conflict/conflicts` | `floor_catalog.h` | used only by the `main.cpp:806` error print — fine |
| `blame_module.cpp` | 16 LOC | stub, no content yet |

---

## 7. Isotropy

| # | Violation | file:line | Detail |
|---|---|---|---|
| 1 | **The frame accessors ARE padic's constants** | `floor_gen.cpp:98-100` | `GravityRegime floor_gravity_regime() { return kPadicGravity; }` and `int floor_ground_coord() { return kPadicGroundCoord; }` — no per-kind dispatch row, unlike every other module hook. `blame.h:57-62` openly admits blame's `kBlameGroundCoord = 3` is forced "Deliberately EQUAL to the padic module's ground storey … the global frame helpers still export one module's constants". **A module cannot declare its own frame today**; only `*_declare_rules` writes `world.gravity()` (`padic_gen.cpp:578-579`, `blame_gen.cpp:663-664`), and everything else reads the padic constant. Latent (both are `NegZ`/3), structural. |
| 2 | `floor_ground_z()` | `floor_gen.cpp:131` | Z-named legacy projection still exported (`floor_gen.h:106-108` labels it "Legacy") |
| 3 | `room_zone.cpp:484` | `const int z = floor_ground_coord();` then `blocked(grid, cx, cy, z)` | uses the **gravity-axis coordinate directly as the Z index**, and `rx*stride`/`ry*stride` directly as X/Y. Should go through `floor_ground_cell` / `floor_cell` (`floor_gen.h:100-104`). Same for `room_bit_at` (`room_zone.cpp:155-162`, `wx % stride` / `wy % stride`) and `bake_flow` (`:302-305`). The whole room lattice is XY-plane-by-construction. |
| 4 | `floor_room_mask(kind, number, rx, ry)` | `floor_gen.h:136` | two-coordinate room lattice — the taxonomy itself assumes a plane |
| 5 | `population.cpp:189-191` | `pool.cx = rx*stride+ox; pool.cy = ry*stride+oy; pool.cz = hash % kMacroDim` | Z is the "free" axis by name; defensible (blind seed + `place_body_safely`) but hardcodes which axis is height |
| 6 | `save.h:727 kArrivalCoord = 3` | | duplicate of `kPadicGroundCoord`, guarded by `floor_gen.cpp:135` static_assert. Acceptable. |

**Isotropy-correct** (for contrast): `floor_standable` (`floor_gen.cpp:102-108`),
`floor_cell` (`:110-125`), `elevator.cpp:71-77`, `wander.cpp:126-137`, `ai.cpp:1116-1127`
all resolve through `regime_down`/`regime_frame`. The frame machinery exists; the floor
lattice/room layer does not use it.

---

## 8. Authorship

`git log --format='%h %an %ad %s' --date=short -- <file>` per file:

| File | Created by | Dominated by | marko1olo commits | Verdict |
|---|---|---|---|---|
| `src/game/nav_cache.cpp` / `.h` | **marko1olo** (`0624228c` is Jirnyak's nav-routing commit; `56c9c6a7`/`3d35b761` are marko) | marko1olo (2 of 3) | 2/3 | 🔴 **marko-created** — and it is the single largest dead subsystem in scope. `56c9c6a7` message: "nav_cache was included by the test binary and tested by nothing — expanded and pinned" — i.e. marko *expanded* a system with no production caller and pinned it with 1316 lines of test. |
| `src/game/floors/padic/padic_module.cpp` | marko1olo (`02696918`) | **marko1olo (7 of 9)**, incl. 3 "chore: automated strategic sweep"/"Overseer auto-push sweep" | 7/9 | 🔴 **marko-created & dominated** — contains the shadowed-constant + duplicated-plan defect (§3) |
| `src/game/floor_stream.cpp` | Jirnyak (`539b08ce`) | Jirnyak (14 of 23) | 9/23 | 🟠 mixed |
| `src/game/floor_gen.cpp` / `.h` | Jirnyak (`387212eb`) | Jirnyak | 6/17, 3/6 | 🟠 mixed |
| `src/game/floor_spec.cpp` | Jirnyak | Jirnyak | 2/5 | ok |
| `src/game/floor_catalog.cpp` / `.h` | Jirnyak (`d9b9762d`) | Jirnyak | **0** | clean |
| `src/game/floors/padic/padic_gen.cpp` | Jirnyak (`f7aca13a`) | Jirnyak (10/12) | 2/12 (`b43739ee` fluids, `24ef83a7` stair material) | ok |
| `src/game/floors/blame/*` | Jirnyak (untracked) | Jirnyak | 0 | new |
| `src/world/nav.cpp` | Jirnyak (`539b08ce`, `e322e8c7`) | Jirnyak | 1/7 (`9a3345c5` "sect 22 lazy field rebaker initial scaffolding") | ok |
| `src/game/room_zone.cpp` | Jirnyak (`13fad5ae`) | Jirnyak | **0** | clean |
| `tools/xray_map.cpp` | Jirnyak (`073654e2`, today) | Jirnyak | 0 | clean |
| `src/game/population.cpp` | Jirnyak | Jirnyak | 4/10 | 🟠 mixed |
| `src/game/fast_travel.h` | Jirnyak (`7ac39115` — "out of the markololo fork") | Jirnyak | 0 | clean (salvaged) |

### "torus fixes" — which were real

marko1olo's `3f59733d` "merge: bring origin/nav-routing-diffusion onto main — 15 conflicts
resolved by hand" touched `floor_stream.cpp` and `population.cpp`. The *substantive* torus
work in this subsystem is Jirnyak's: `539b08ce` (nav lattice + coarse bake), `e322e8c7`
(L2 fine 64 flow fields), `0624228c` (routing + disk cache). marko's verifiable contributions
here that survive:

* `4811d19a` "unload() leaked every non-crowd entity on the recycled layer" — **real fix**, the
  sweep at `floor_stream.cpp:436-445` survives and is well-argued.
* `1765313d` "the negative-label corruption had one surviving cast" — **real**, the uncast
  `fm.number` at `floor_stream.cpp:260-268` is the record of it.
* `e83ae57c` "FloorModule::candidate is generation-checked" — **real**, `floor_stream.h:73-101`.
* `9a3345c5` "sect 22 lazy field rebaker" — **reverted** by Jirnyak `60dbd2aa`; tombstone at
  `nav.h:124-136`. The stale `// §22` comments at `main.cpp:1771, 2680` are its residue.
* `56c9c6a7`/`3d35b761` nav_cache expansion + bound — **real code, zero production value**
  (§4.1); the bound it adds guards a directory nothing writes.
* `52947b3b`, `689fe40f`, `ab12d578` — "automated strategic sweep" / "Overseer auto-push sweep"
  on `padic_module.cpp`: content-free churn commits.

---

## 9. Doc-vs-code spot checks

### nav.md (189 lines) — the worst offender

| # | Claim | doc:line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | "**no runtime consumer steers by it yet** — the utility-AI that calls `route_step` is task #12" | :7-9 | **FALSE** | `wander.cpp:121-123`, `ai.cpp:1104-1112`, `main.cpp:3794-3798` |
| 2 | "It is **wired into floor streaming** (each live floor bakes its nav on load)" | :6-7 | **FALSE** | `floor_stream.h:171,324` — `navBake_` defaults false; no `src/` caller of `set_nav_bake` |
| 3 | "32 divides every FloorKind's storey height (4/8/16/4) and room stride (8/16/32/8)" | :42-44 | **FALSE** | one stride = 4 (`floor_gen.cpp:92`), one storey = 3 (`padic_gen.cpp:61`) |
| 4 | "`L0 — carve (in floor_gen)` … `generate_floor` carves the 64 nodes" | :57-59 | **FALSE (misattributed)** | the carve is in the **modules**: `padic_gen.cpp:478`, `blame_gen.cpp:622`. `floor_gen.cpp` has no geometry. |
| 5 | "A **nearest-node field**, `uint16 nearest[128³]` = 2 MiB" | :86-87 | **FALSE (type)** | `nav.h:101` `std::vector<std::uint8_t> nearest;` — 1 byte/cell (the 2 MiB total is right) |
| 6 | "magic `GHNAVBK1`" | :123 | **FALSE** | `nav_cache.h:102` `kNavCacheMagic = 0x4E324847` ("GH2N"); `:111-115` says GHNAVBK1 is the *rejected v1* |
| 7 | "either follow the coarse `next`-hop chain toward that anchor … **or** descend the current anchor's fine flow field" | :103-105 | **FALSE** | `nav.cpp:253` unconditionally `return fine.at(tNode, …)`; `:245-252` explicitly says the coarse-hop variant is *not* what it does |
| 8 | "**Still to build** … The consumer (#12). Utility-AI that actually calls `route_step`" | :169-171 | **FALSE** | #12 is built (`ai.cpp`, `wander.cpp`); nothing calls `route_step` and it is a declared deferral (`check_wired.cmake:70`) |
| 9 | "**Fast-travel elevator hookup** … the travel is not wired" | :172-174 | **FALSE** | `fast_travel.h/.cpp`, `elevator.cpp:81-88 landHub`, console `ft`, save v10 |
| 10 | "Walkable ≡ `!mask.full()` … **the same rule diffusion and physics use**" | :70-72 | **FALSE** | physics is exact sub-voxel; `room_zone.cpp:18-42` documents this exact mismatch as a measured 62-of-63-bodies bug |
| ✓ | `CoarseGraph { Dist edge[64][6]; dist[64][64]; uint8 next[64][64] }` | :64-66 | TRUE | `nav_cache.cpp:186` `static_assert(kNavCoarseWire == 13056)` |
| ✓ | test names `test_nav_realfloor` / `test_nav_fine_realfloor` / `test_route_realfloor` / `test_streamed_nav` | :20-23 | TRUE | `game_test.cpp:1188, 1229, 4796, 4867` |
| ✓ | "flow `uint8[64·128³]` = 128 MiB" | :77-78 | TRUE | `nav_cache.h:141` `kNavFineWire = 134217728` |

### floors.md (323 lines) — mostly honest

| # | Claim | doc:line | Verdict | Evidence |
|---|---|---|---|---|
| 1 | "the full bake currently runs **TWICE** per load and the cache dir is never set (§26)" | ~:230 | **STALE** | fixed: `floor_stream.h:154-171` gates it off; it now runs **once** |
| 2 | "First resident: `src/game/floors/padic/`" | :164 | **STALE** | blame exists (untracked) |
| 3 | "`floor_room_stride` (4 cells today)" | :93 | TRUE | `floor_gen.cpp:92,96` |
| 4 | "A module touches exactly **two** things outside its folder" | :195-200 | TRUE | catalog claim + dispatch rows … **except** `floor_gen.cpp:171` adds a third: an `if (spec.kind == FloorKind::Blame)` branch in `floor_doorways` — a *branch*, exactly what the law forbids |
| 5 | "~700 MB RAM … per resident padic floor — an accepted cost" | :175-178 | **UNDERSTATED** | 692 MiB *reserved* and never released; ×2 slots = 1.37 GiB (§5.2) |
| 6 | "`FloorStreamer.init(stack, keepRadius = 0)` reserves `2*keepRadius + 2` slots" | :211-213 | TRUE | `floor_stream.cpp:50` |
| 7 | three-step entry table (laws / geometry-or-restore / rules) | :265-271 | TRUE | `floor_stream.cpp:307-316` |
| 8 | "`kFloorSlots = 255`, `kMaxModules = 256`" | :140 | TRUE | `floor_registry.h:43` |
| 9 | "CMake globs `src/game/*.cpp` recursively, so a new folder needs no build edit" | :202-203 | TRUE | `CMakeLists.txt:234` `GLOB_RECURSE`; blame is in `build/compile_commands.json` |
| 10 | "**Open questions:** Serialization of the number→module mapping (and the cold pool) across saves" | :302-303 | **STALE** | save is at v16 with `SAVBANK`/`SAVCLOCK`; `fast_travel.h:113-131` documents the unlock set in `run.sav` |
| 11 | Measured `RESTORED 6595.5 ms` | :286 | superseded by the RLE note at :291 (736→125 MB, 6595→1329 ms) — internally inconsistent within 6 lines |

### elevators.md (163 lines) — self-correcting, two leftovers

| # | Claim | doc:line | Verdict |
|---|---|---|---|
| 1 | "Since the generic per-kind generator was purged there is ONE room stride (4) and ONE storey height (3 cells)… the per-kind arithmetic below described that deleted generator" | ~:73-76 | **TRUE and admirable** — the doc retracts itself in place. `nav.md` and `lattice.h` never got the same edit. |
| 2 | "From floor 0 you reach −1 or +1." | ~:36 | **FALSE** — contradicts the direction rule stated two sentences above it in the same bullet (`next_labelled_floor`, `floor_stream.cpp:500`); on the shipped stack `[` from 0 lands on −8 |
| 3 | "`src/game/fast_travel.h` / `.cpp`" | :13-15 | TRUE — both exist (h ~180, cpp 17) |
| 4 | "The bake (coarse + 64 flow fields + `route_step`) already runs on every floor load" | ~:85 | **HALF-FALSE** — the bake runs (main's `AsyncBake`); `route_step` does not run at all |
| 5 | "`stamp_lattice` walks the lattice itself and lays the corridors along its lines" | ~:70 | TRUE for padic (`padic_gen.cpp:478`); blame's equivalent is `stamp_lattice_markers` (`:622`) with a different strategy (pylons/catwalks) |
| 6 | "`nav::kNodes == kLatticeCount == kLatticeDim³` … 5 per axis → 128→250 MiB and breaks `kNavCoarseWire == 13056`" | ~:118-122 | TRUE (`nav_cache.cpp:186`) |
| 7 | "`fast_hub_near`, a second question with its own answer" | ~:135-138 | TRUE (`fast_travel.h:79-95`) |
| 8 | "144 cells across 16 shafts" test | ~:141 | plausible (16 × 3×3 = 144) — not re-verified |
| 9 | "unlock set survives a SAVE since version 10 / SAVCLOCK — 32 bytes" | ~:146-148 | TRUE (`fast_travel.h:133,143`, `kBytes = (255+7)/8 = 32`) |
| 10 | "`landHub = -1` on every non-fast path keeps the mirrored coordinates" | ~:105 | TRUE (`floor_stream.h:275`, `elevator.cpp:81-88`) |

### worldgen.md (42) / world.md (54)

`worldgen.md` §"What replaced it" and §"What did NOT survive" are both stale (§1.2).
The tombstone framing itself is correct and worth keeping.

---

## 10. Deletion proposal

### DELETE (net −2,900 LOC, no behaviour change)

| Rank | What | LOC | Why safe |
|---|---|---|---|
| 1 | `src/game/nav_cache.cpp` + `.h`, `tests/suite_navcache.inl`, `game_test.cpp:4932-5020` (`test_nav_cache_roundtrip`, `test_streamed_nav_cache`) | 963 + 391 + 1316 + ~90 = **2760** | zero `src/` callers (§4.1). Two staleness holes if ever re-armed (§4.2). If the owner wants memoization later, it should be keyed on a geometry hash, not on `(number,kind,seed)`. |
| 2 | `FloorNav`, `nav_[]`, `nav_at`, `set_nav_bake`, `set_nav_cache_dir`, the `if (nav_bake())` block | `floor_stream.h:53-56,133-136,154-171,282-285,316,323-324` + `.cpp:352-369,455-459` ≈ **60** | falls out with #1 |
| 3 | `floor_spec_for`, `floor_depth01`, `floor_danger`, `floor_mob_count`, `monster_share`, `kMobSoftCap` + their header prose | `floor_spec.cpp:38-49,59-110`; `floor_spec.h:62-97` ≈ **110** | 0 callers; duplicated by `mob_table.h:277,286` (§2.3). Keep `floor_mob_tier` **or** move `console.cpp:189` to `mob_level_for_floor`. |
| 4 | `nav::route_step` + its 35 lines of header contract | `nav.cpp:223-254`, `nav.h:135-155` ≈ **55** | 0 callers, declared deferred; the three live consumers each compose their own (§4.4). Either delete, or **make it the one composer** (see MERGE #2). |
| 5 | `floor_ground_z()` | `floor_gen.cpp:131`, `.h:106-108` ≈ **5** | "Legacy projection"; the one file that includes for it doesn't call it |
| 6 | stale `// §22` comments | `main.cpp:1771, 2680` | 2 lines of lying prose over unrelated code |

### MERGE

| Rank | What | Effort | Payoff |
|---|---|---|---|
| 1 | **`src/game/floors/floorlib.{h,cpp}`** — `put_bits`/`put_sub`/`kAllBits`/`kGrateBars`/`FloorRng`/`floor_clear_to_air`/`floor_declare_frame`/`floor_reset_fluids`/`stamp_fast_lattice` (sketch in §3) | ~150 LOC new, −200 duplicated | removes the exact class (`fast_travel.h:59-68`) that produced the `padic_module.cpp` shadow bug; makes the mandatory lattice one implementation |
| 2 | Route composition → one function | small | make `wander_step` and `ai_patrol_step` call `nav::route_step` (extending it with the coarse-hop mode `wander` needs), or delete it. Three answers to one question is one too many. |
| 3 | `floor_spec_for` chain ← `FloorCatalog` | small | delete the if-chain, have anything that wants "kind of number N" go through the catalog. Removes the pinned-equal-forever test. |
| 4 | `population.cpp` `kRoomStride`/`kRoomsPerAxis` ← `floor_room_stride()` | small | closes the 16-vs-4 divergence (§F). The blind seed + `place_body_safely` hides it today; the constants still lie. |
| 5 | `padic_module.cpp:38-42` shadowed constants + `:98-101` stair plan ← `lattice.h` + a `padic_stair_cells()` export from `padic_gen.cpp` | small | the exact defect `fast_travel.h` warns about, still live |
| 6 | Frame per module: turn `floor_gravity_regime()` / `floor_ground_coord()` into per-kind dispatch rows like the other three tables | medium | §H — lets a module actually declare `-X` and makes `blame.h:57-62`'s apology unnecessary |
| 7 | Extraction pad: `padic_gen.cpp:529 if (number == 0)` → a per-number data row read by both modules | small | the only hardcoded floor number in `src/` |

### KEEP (do not touch)

* `src/world/lattice.h` (83) — clean, correct, dependency-free. **Fix the stale comment at :32-33.**
* `src/world/nav.{h,cpp}` minus `route_step` (~380) — the live bake.
* `src/world/nav_async.{h,cpp}` (117+81) — the actual production bake path.
* `src/game/floor_catalog.{h,cpp}` (104+90) — the one clean data model; 0 marko commits.
* `src/game/floor_registry.{h,cpp}` (134+83), `elevator.{h,cpp}` (59+124), `fast_travel.{h,cpp}` — live, isotropy-correct.
* `src/game/room_zone.{cpp,h}` (580+441) — live and load-bearing; **fix the isotropy at :484 and the ignored stride param**.
* `src/game/floor_stream.{cpp,h}` minus the nav block (~800) — live.
* Both generators' *content* (plan/grammar/materials). Only the plumbing merges.
* `tools/xray_map.cpp` (1174) — new today, sole author Jirnyak, the verification tool the blame module needs.

### BLOCKING (do these first, they are not cleanup)

1. **Commit or revert the blame module.** `CMakeLists.txt:1032`'s pin is unsatisfiable on a clean
   HEAD (§6.1). Three commits shipped measured against a dirty tree.
2. **`problems.md` §57 is open and player-facing:** blame's arrival lobbies at `z=3` inside the
   platform mass are sealed 5×5×2 boxes with only a 3×3 vertical shaft out — an inter-floor ride
   to floor 5 can strand the player, and `noclip` does not free them. The owner's own note
   (`problems.md`, §57 addendum) names the fix candidates and says "НЕ ПОЧИНЕНО".
   Do not commit blame as-is without either the fix or a red test.
3. Decide `route_step` (§4.4) before touching `nav_cache` — they fall together.

---

## Appendix: classification index

* **DEAD** — `floor_spec_for`, `floor_depth01`, `floor_danger`, `floor_mob_count`, `monster_share`, `kMobSoftCap`, `floor_ground_z`
* **UNWIRED** — `nav_cache.*` (whole module), `FloorNav`/`nav_at`/`set_nav_bake`/`set_nav_cache_dir`, `nav::route_step`
* **DUPLICATE** — `floor_spec_for` vs `FloorCatalog` patterns; `floor_spec.cpp` V-shape vs `mob_table.h`; `population.cpp kRoomStride=16` vs `floor_gen.cpp kRoomStride=4`; `padic_module.cpp` shadowed constants + stair plan; put_bits/put_sub/lcg/rnd/lattice across padic+blame; 4 route composers; 2 flow-field bakers
* **LEGACY** — `lattice.h:32-33` per-kind arithmetic; `master_prompt.md:285,365`; `tools/perf_notes.md:155`; `ARCHITECTURE.md:47`; `main.cpp:1771,2680` §22 comments; `embody.h:41`
* **DISABLED** — `floor_stream.cpp:352-369` behind `nav_bake()` (default off)
* **MAGIC-CONST** — `kMobSoftCap`, `kRoomStride=4`, `reserve_pages(700000/200000)`, padic `sx=bx+13`/block 29/bsp 9,6, blame's 22 plan literals
* **HARDCODED-FLOOR** — `padic_gen.cpp:529 if (number == 0)`; `floor_gen.cpp:171 if (spec.kind == FloorKind::Blame)`; `main.cpp:779-789 kDemoFloors`
* **ISOTROPY-VIOLATION** — `floor_gen.cpp:98-100`; `room_zone.cpp:484,155-162,302-305`; `floor_room_mask` 2-coordinate lattice; `population.cpp:189-191`
* **SPEC-LIE** — nav.md ×10; worldgen.md ×2; floors.md ×3; elevators.md ×2; `lattice.h:32-33`; `population.cpp:6` include comment
* **HALF-FINISHED** — the entire uncommitted blame module + the check-count pin measured against it; `problems.md` §57 open
