# Agent Instructions — gigahrush2

> **MANDATORY SESSION INTAKE & ROUTING:**
> Every agent (and spawned subagent) working on GigaHrush 2 MUST read the following canonical documents before initiating non-trivial architectural, gameplay, or code modifications:
> 1. [AGENTS.md](AGENTS.md) (Operational mandates, DOD/ECS rules, no-exceptions invariant)
> 2. [README.md](README.md) (Graf Irnyak / Klaus Schwab Architectural Manifesto & World Invariants)
> 3. [jirnyak.md](jirnyak.md) (Purge Mandate & Data-Driven Content Boundaries)
> 4. [master_prompt.md](master_prompt.md) (Owner standing directives & unlimited token policy)
> 5. [ARCHITECTURE.md](ARCHITECTURE.md) (System architecture & pipeline specification)

> **GRAF IRNYAK (KLAUS SCHWAB) ARCHITECTURAL MANIFESTO:**
> - **Feature without live gameplay proof = DECLINED.**
> - **Feature not based on any fundamental core system = DECLINED.**
> - **All Content is Data-Driven:** Item drops, mob traits, stats, loot tables belong in CSVs (`data/items.csv`, `data/mobs.csv`), never hardcoded `if`-chains.
> - **Ruthless Purge Policy ("Нещадная чистка"):** Cut and delete legacy meshing hacks, multi-colored striping, hardcoded keybindings, and random unintegrated mechanics.
> - **Retro-Pixel / VHS / CRT UI Mandate ("Интерфейс це важно"):** All HUD/ImGui and canvas overlays MUST follow the Soviet-punk service-equipment ("служебная аппаратура") CRT aesthetic from GigaHrush 1 (`taste.md`). No sterile modern flat chrome, zero rounding (`WindowRounding = 0.0f`), phosphor green on near-black CRT alpha background.
> - **v1 is Read-Only Canon:** `C:\hades\gigahrush` (v1) is a read-only aesthetic and architectural reference. All new rules, features, and code MUST be written to `C:\hades\gigahrush2`.

> **gigahrush2 is a universal voxel *core engine*, not a game.** It provides the
> substrate — a toroidal 128³ macro world, 8³ sub-voxel masks, runtime typed
> fields, vector gravity, a level stack, swept-AABB physics, cellular fluid, an
> attachable ECS camera/controller, and a real Vulkan renderer. Gameplay
> (floors, quests, NPCs, items, combat) is layered on top as **modules** and ECS
> systems. Keep the engine core game-agnostic.
>
> **Tokens are unlimited - maximize; do NOT economize.** The owner standing mandate
> ([master_prompt.md](master_prompt.md) SS1.4): pour everything into the result.
> Explore deeply, read widely, fan out **many subagents** for read-only research and
> parallel isolated work, and verify thoroughly - never cut a corner or skip a check
> to save tokens. Spend freely on getting it *right*.
>
> What is explicitly **not** capped: reading a doc the task actually touches, research
> depth, subagent fan-out, and verification.
>
> What stays banned is churn, not depth: do not re-read files already in context, do
> not restate large blocks, do not emit change-log prose, stop exploring once you can
> act, and still make the smallest *surgical* edit that solves the task - slow is fast,
> a tight diff is easier to verify, not cheaper. Handing a build, a launch or a visual
> glance to the human is division of labour - they own the runtime loop - not a saving
> measure.
## Working Method — *slow is fast*

Do migrations and large refactors **inline, in small steps, building green after
each one**. Correctness first; speed is a side effect of not backtracking.

- **Never hand a large, interconnected task to an autonomous coding subagent.**
  Subagents are for **bounded, low-risk** work: read-only research, or one
  clearly-scoped isolated file — not multi-file architecture. This bounds what a
  subagent may **write**, not how many you run: read-only fan-out is encouraged
  and uncapped (§1.4 of [master_prompt.md](master_prompt.md)) — parallel research,
  source and doc reconnaissance, adversarial review of a plan, independent second
  opinions. The lead performs the interconnected edit itself, in verified
  increments. Every assignment states role, why delegated, the files to read,
  owned scope, forbidden scope, output format, and whether edits are allowed.
- **One build owner at a time.** There is a single `build/` (macOS) or
  `build-win/` (Windows) tree, and `glslc` writes SPIR-V into it. Two agents
  building concurrently corrupt each other's artifacts and each other's `ctest`
  results. Serialize the build; parallelize only reading.
- **A subagent cannot close the verification loop.** The human owns the runtime
  and visual check. A subagent reporting "builds clean" is evidence to re-run,
  never proof — the lead re-runs the build itself before repeating the claim.
- **Keep the build green at every step.** Run the build after each edit. Prefer
  additive changes that compile *alongside* the old path until the final
  switch-over.
- **One verified increment per turn.** Land it, build, hand the visual/runtime
  check to the human, then continue. Do not chain many unverified edits.
- **When you must stop, stop GREEN**, and leave a precise written plan so the
  next agent — even a cheaper one — can continue mechanically.

## Hard Rules

- **THE NATIVE-FIRST LAW (ZERO CRUTCH SCRIPTS):** You are ABSOLUTELY FORBIDDEN from creating Python, Bash, Node, or PowerShell wrapper scripts (`_patch_*.py`, `_wire_*.py`, etc.) to edit, append, test, or generate code. You MUST edit source files natively using `replace_file_content` or `replace_in_file`. Any attempt to bypass direct file editing with a script is a CRITICAL COMPLIANCE FAILURE.
- **YOUR SCRATCH IS NOT PROJECT STATE.** Whatever an agent keeps to think with —
  patch scripts, briefings, progress notes, captured stdout/stderr of a test run,
  pid files, its own config — never enters the tree. `.gitignore` already refuses
  `.agents/`, `appDataDir/`, `.goosehints`, `/Testing/`, root `_*.txt` and
  `shaders/*.spv`; if you invent a new scratch location, add it there in the same
  commit. A commit whose whole content is scratch is not a checkpoint, it is
  litter — and it hides the one real change in the next commit that mixes both.
- **NEVER PIN A FAILING SUITE.** The `PASS_REGULAR_EXPRESSION` counts in
  [CMakeLists.txt](CMakeLists.txt) end in `0 failures`, always. Pinning
  `N checks, K failures` with `K > 0` converts a broken invariant into the
  expected state and the pin stops meaning anything. Fix the failure or delete
  the test with a reason in the commit message; do not enshrine it.
- **No exceptions. No RTTI.** The core is built `-fno-exceptions -fno-rtti`
  (EnTT with `ENTT_NOEXCEPTION`). Do not use `try`/`catch`/`throw`/
  `dynamic_cast`/`typeid`. For type identity without RTTI use the `type_tag<T>()`
  pattern in [src/world/field.h](src/world/field.h).
  **Platform caveat — the Windows build does not enforce this.** MSVC's STL is
  unsupported under `_HAS_EXCEPTIONS=0`, so Windows compiles `/EHsc`; only RTTI
  ports across (`/GR-`). On MSVC the no-exceptions rule is code discipline, not a
  compiler gate: add a `throw` and the macOS build catches it while Windows stays
  green. A green Windows build is necessary, never sufficient for the *compiler*.
  **Gated mechanically since 2026-07-28** by
  [tools/check_source_rules.cmake](tools/check_source_rules.cmake), the ctest
  `source_rules`: a text gate that needs no compiler and so rejects a `throw` on
  both hosts identically. It also covers no-RTTI, the GLM/Eigen ban, and the
  layering rule below. Run it standalone with
  `cmake -P tools/check_source_rules.cmake`. Full platform deviation list:
  [tools/win/README.md](tools/win/README.md).
- **Core stays dependency-free.** `giga_core` (`src/world`, `src/sim`, `src/ecs`)
  must not include SDL, Vulkan, or ImGui. It links only EnTT and ships its own
  math ([src/core/math.h](src/core/math.h)) — no GLM/Eigen. This is what keeps
  the simulation headless-testable and embeddable.
- **Render is a pure shell; sim never depends on it.** Rendering is a read-only
  skin over the sim: data flows **sim → render only**, the renderer mutates no
  game state, and the game must stay fully "playable" headless with L3 removed
  (see [render.md](render.md)). Never answer a gameplay question (line-of-fire,
  reachability, visibility) by reading the framebuffer/depth buffer — that lives
  in the sim. Fog, culling, and toroidal placement are render-local; deleting
  them changes pixels, never outcomes.
- **Always render around the camera.** The world wraps (torus), so every pass
  draws each cell at its **nearest toroidal image** relative to the camera, never
  at fixed absolute coordinates — the camera sits at the centre of a seamless
  shell. Distance fog fades to **black** (not blue) at the `kWorldExtent/2`
  render radius, which is exactly the minimal-image radius, so the wrap seam is
  always hidden. Keep `fog end ≤ kWorldExtent/2` and the clear colour black.
- **Strict Data-Oriented Design (DOD) & ECS Paradigm.** All gameplay features and engine subsystems must follow strict DOD/ECS principles: POD components (zero behavior/virtual functions), pure logic systems iterating over EnTT views (`reg.view<A, B>()`), dense contiguous memory buffers (SoA / flat arrays), zero per-frame hot-path allocations, and linear O(1)/O(N) tick complexity.
- **Performance first.** Favour better algorithms, contiguous (SoA) data,
  EnTT views over pointer chasing. Do not allocate per-frame in hot paths.
- **Native game; CPU is the only scarce resource.** This is a native C++/Vulkan
  desktop game. Treat disk and GPU as unlimited, RAM as ~8 GB, load time as
  unbounded — and the **sim tick as sacred: O(n) in live entities/cells**. Two
  standing consequences (see [performance.md](performance.md)): **(1) dense over
  sparse** — prefer flat, fully-populated arrays/fields to lazily-allocated
  sparse structures; a `128³` field is only 2–8 MB. **(2) bake at load, tick in
  O(n)** — precompute BFS/nav/flow/light maps once at load into flat memory; the
  tick only does O(1) lookups. Never run BFS/A* or worse-than-O(n) work in the
  hot path; when geometry mutates, freeze → re-bake → resume.
- **Data-driven by default.** Adding a cell type / field / monster / loot entry
  / floor module must be one new table entry or one registered field — never an
  `if` chain baked into the engine.
- **The content tables are GENERATED — the CSV is the source.**
  `src/game/item_table.cpp` comes from `data/items.csv` via
  `tools/gen_item_table.py`, and `src/game/mob_table.cpp` from `data/mobs.csv` via
  `tools/gen_mob_table.py`. Edit the CSV and re-run the generator. Never hand-edit
  the generated `.cpp`: GLOB picks it up and compiles it, so the edit looks like it
  worked right up until the next regeneration silently discards it. The reverse
  failure — CSV edited, generator not re-run — is invisible to the compiler, so the
  `source_rules` ctest compares each CSV's row count against the count the
  generated header declares (`kItemCount`, the `kMobKindCount` static_assert) and
  fails on drift. These files are also why `/utf-8` is load-bearing on MSVC — they
  carry Cyrillic name literals; the measured byte counts live once, in §Build.
- **The player is not special.** It is simply the entity that currently holds a
  `CameraTag` + `Controller`. Never hardcode a player singleton; systems operate
  on whatever entity owns the components.
- **`LayerId` (storage slot) ≠ floor number (logical label).** The array slot an
  entity references and the in-game floor number are different concepts; the
  floor number is a mutable label the macro-system assigns and may reshuffle at
  runtime. Do not conflate them. See [floors.md](floors.md).
- **Backend = Vulkan; SDL3 is platform-only.** Rendering targets Vulkan
  (MoltenVK on macOS). SDL3 is window + input + timing only, never the graphics
  API. New GPU code lives in `src/render/`.
- **GLOB is on.** New `.cpp` under `src/{world,sim,ecs}` (core) and
  `src/{app,input,render}` (app) are auto-picked-up via `CONFIGURE_DEPENDS`. New
  `.cpp` under `src/game` is globbed into **`giga_game`** the same way. Do not
  edit `CMakeLists.txt` for individual files.
- **Gameplay macro-systems live in `giga_game` (`src/game`), not `src/app`.** It
  links `giga_core` but **not** SDL/Vulkan/ImGui, so it stays headless-testable
  (`game_test`) and the society sim can run without a GPU. Keep it that way: no
  platform includes in `src/game`. The NPC pool, inventory, event bus, and mob
  table belong here ([npcs.md](npcs.md), [macrosim.md](macrosim.md)).
- **Macrosim is a background module — a game within the game.** The macro NPC
  society sim ([macrosim.md](macrosim.md)) must remain independently runnable and
  testable headless: it reads *up* into the action game (embodiment) but never
  depends on render, input, or the app shell. Don't wire it to the render/present
  path or the 125 Hz sim tick ([src/core/tick.h](src/core/tick.h) — `kSimHz`, the
  one place the rate lives); it has its own coarse clock.

## Toroidal + dimensional invariants

- **x/y/z wrap; W does not.** The 128³ macro grid is a torus on all three
  spatial axes — always normalize coordinates through `wrap_macro` /
  `wrapi` ([src/core/wrap.h](src/core/wrap.h)). Entity *positions* wrap too:
  physics wraps `Transform.pos` into `[0, kWorldExtent)` each step, so the torus
  is real for the agent (fall off any face, re-enter opposite). World-space
  distance math must use `wrap_delta`. The level stack (W, the 4th coordinate)
  does **not** wrap: `above`/`below` return `kInvalidLayer` at the ends.
- **One macro cell ≈ 2 m** (`kCellSize = 2.0`). Speeds/accelerations are real
  m/s over a 256 m (`kWorldExtent`) torus. Don't assume unit cells.
- **One macro cell = 8³ sub-voxels** packed into `kSubMaskWords × uint64_t`.
  Collision tests bitwise against these masks; a fully solid and a half-carved
  cell cost the same to query.
- **Gravity is a vector, not a scalar.** Read it via `world.gravity().at(pos)`;
  never assume −Z.

## File Organization

- One file = one responsibility. Do not split files to satisfy a line count.
- Split at real architectural seams (pure logic vs. Vulkan code, a shared
  utility used by 3+ consumers, a dedicated `*_types.h`).
- Files over ~800 lines should be reviewed; avoid exceeding 1000 unless it is a
  naturally encapsulated module (renderer, generator).

## C++ Style

- C++23. Prefer `std::uint8_t` / `std::int32_t` — never bare `unsigned int`.
- POD components (`struct Foo { int x, y; };`). No virtuals on hot data.
- Headers minimal — forward-declare in headers, include in `.cpp`.
- No global state. Pass `Registry&`, `World&`, `LevelStack&` explicitly.
- Use `constexpr` for tunables; group at top of file.
- Math: use the `vec2/vec3/vec4/mat4` POD helpers in `core/math.h`.

## ECS Conventions (EnTT)

- Components are POD structs in [src/ecs/components.h](src/ecs/components.h).
  Keep them small; split large blobs into separate components.
- Systems are free functions (`*_step(Registry&, …, float dt)`) operating on
  views (`reg.view<A, B>()`). See `src/sim/`.
- Spawning goes through factory functions, never ad-hoc entity construction
  scattered across call sites.
- Tag types carry no data — use `view<Tag>`.

## Build

macOS / Homebrew (primary, and the mechanical enforcer of the no-throw rule) —
see [README.md](README.md) for dependency install:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
ctest --test-dir build --output-on-failure
```

Windows / MSVC + Ninja + LunarG Vulkan SDK — entry point is
[tools/win/README.md](tools/win/README.md), which carries the prerequisites and
the full platform-deviation list:

```bat
tools\win\build.bat                 :: configure + build + ctest, Release
tools\win\build.bat Release fresh   :: wipe build-win\ first
```

Output is `build-win\gigahrush2.exe`; run modes and controls are unchanged.

**CHECK THE BUILD TYPE BEFORE BELIEVING A PERFORMANCE NUMBER.** `build/` keeps
`CMAKE_BUILD_TYPE` in its cache and a rebuild never mentions it, so a tree can sit
in `Debug` (`-g`, no `-O`) for days and every binary built out of it is **~10x
slower** — measured 2026-08-05 on floor 0: 62.2 ms/frame at `-O0` against 5.9 ms
at `-O3 -flto`, identical code. It reads exactly like a regression in whatever
landed last, and it will be blamed on the last diff. Order of operations when
frame time collapses ([performance.md](performance.md) §First question):

1. `grep CMAKE_BUILD_TYPE build/CMakeCache.txt` — and the app now prints
   `[build] optimized` / `[build] DEBUG …` at launch and paints it beside the HUD
   FPS counter, so the answer is on screen.
2. `/usr/bin/sample <pid>` on a running `--shot` — trivial header functions
   (`wrap_macro`, `MacroGrid::mask`) showing up as out-of-line calls through
   DYLD stubs means unoptimized, full stop.
3. Only then read the diff.

Measure per-frame cost by the SLOPE of two `--shot` runs at different `--frames`
(load is ~2.5 s Release / ~21 s Debug and swamps a single run). Never quote a
frame time from one run, and never quote one at all without naming the build type.

Ensure **zero warnings**. That is `-Wall -Wextra -Wno-unused-parameter` on
Clang/GCC and `/W4 /wd4100` on MSVC, applied by the single `giga_target_flags()`
function in the top-level `CMakeLists.txt`; vendored Dear ImGui lives in its own
`giga_imgui` target with default warnings so the policy never has to be relaxed
for third-party code. Treat warnings as errors in review. Shaders
(`shaders/*.vert|frag`) compile to SPIR-V at build time via `glslc`; a GLSL error
surfaces at build time. MSVC also gets `/utf-8`, and it is **load-bearing today**:
the tree does carry Cyrillic literals. Measured by byte count on this CP1251 host
(2026-07-29) — `src/game/item_table.cpp` **6,608** UTF-8 Cyrillic lead bytes,
`src/game/mob_table.cpp` **644**, `src/game/faction.h` **39**; 25 tracked files
under `src`/`tests`/`data` carry some, **~53k** lead bytes in total (`data/items.csv`
alone is 39,288 — quote the per-file figures, not the aggregate, which moves with
every content edit). The flag was originally added as codepage *insurance* and became
mandatory only when those generated tables landed, so keep it for the current
reason, not the original one; the full two-state history is in
[tools/win/README.md](tools/win/README.md) §4 and is not repeated here. Do not
re-litigate either end without measuring.

**Count bytes (`0xD0`/`0xD1` leads); never conclude "no Cyrillic" from a text
search.** That mistake is what put the false "no Cyrillic literals yet" claim in
this file. Instruments differ on this host: `rg '[\x{0400}-\x{04FF}]'` does find
them (446 / 69 / 5 matching lines in the three files above), while
`grep -P '[\x{0400}-\x{04FF}]'` refuses the pattern outright — *"-P supports only
unibyte and UTF-8 locales"*, exit 2 — printing no matches, which reads as "none
found" unless you check the exit status. `/utf-8` also earns its place on a DBCS
host, where a multi-byte comment character can swallow the following quote and
break the parse.

## 🖥️ UI / HUD Aesthetic Mandate ("Интерфейс це важно")

1. **Inheritance from GigaHrush 1 (`taste.md`)**:
   - `gigahrush2` inherits the Soviet-punk "служебная аппаратура" (service equipment), pixel-minimalist horror, and bureaucratic paper/card aesthetic from GigaHrush 1.
   - UI elements must look like rugged diagnostic equipment, forms, punch cards, and CRT monitors.
2. **ImGui Geometry & Styling (`src/render/imgui_layer.cpp`)**:
   - **Zero Rounding**: Strictly `WindowRounding = 0.0f`, `FrameRounding = 0.0f`, `ChildRounding = 0.0f`, `TabRounding = 0.0f`, `GrabRounding = 0.0f`.
   - **CRT Phosphor Palette**: Phosphor green (`#59F266`) text/accents on near-black (`#050A05`) backgrounds with low alpha (`0.88`) so the 3D world bleeds through like an old CRT screen.
   - **Amber Alerts**: Amber (`#F2C740`) for active states, warnings, and drag-drop targets.
   - **Borders**: Crisp rectangular borders (`WindowBorderSize = 2.0f`, `FrameBorderSize = 1.0f`).
3. **Strict Ban on Modern Chrome**:
   - Absolutely no soft glowing casino cards, rounded modern SaaS widgets, or decorative non-functional UI fluff.

## Workflow Checklist

1. Make the smallest change that solves the problem.
2. Build clean (no warnings) and run `ctest`.
3. New shader → confirm it compiles (glslc runs in the build).
4. Update the relevant system `.md` **only** if you added a real subsystem or
   changed a documented contract; do not document trivial edits.
5. Do not create stand-alone notes / changelogs / "summary of changes" markdown.
   Documentation lives in the per-system docs orchestrated by the README.
