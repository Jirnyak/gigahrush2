# Audit 02 — Build system & CI wiring gates (gigahrush2)

Repo: `/Users/jirnyak/Mirror/gigahrush2`, branch `torus`, HEAD `97bdf13e`, 2026-08-17.
Method: every claim below is either a `file:line` citation or a **measured mutation** run against a
sandbox copy of the tree at `/tmp/markoaudit/mut` (`cmake -DGIGA_ROOT=… -P <gate>`). No repo file was
modified; `git status` is unchanged.

Baseline in the sandbox before every mutation:
```
GIGA_WIRED=PASS entry_points=41
GIGA_SOURCE_RULES=PASS files_scanned=299
```

---

## 0. Verdict up front

| Gate | Registered | In CI | Can it fail? | Real strength |
|---|---|---|---|---|
| `check_wired.cmake` | ctest `wired`, `CMakeLists.txt:1117` | **NO** | yes (proved) | **weak** — 9 measured false-negative channels |
| `check_source_rules.cmake` | ctest `source_rules`, `CMakeLists.txt:1101` | yes (only job) | yes (proved) | **medium** — 5 measured holes, 1 self-disabling |
| `.github/workflows/source-rules.yml` | — | — | yes | honest but is the *only* real CI job |
| 4 test binaries | ctest, all pinned `0 failures` | **NO** | yes | good pins, but never run by CI |

Both text gates live inside `if(GIGA_BUILD_TESTS)` (`CMakeLists.txt:423`). **Measured:**
`cmake -B … -DGIGA_BUILD_TESTS=OFF` produces **no `CTestTestfile.cmake` at all** — one flag deletes
every gate in the project, silently, with exit 0.

---

## 1. `check_wired.cmake` forensics

179 lines; 74 of them (41%) are prose. Logic is lines 88–179.

### 1.1 What it actually does
1. Glob `src/**/*.h`, collect every identifier matching `([A-Za-z0-9_]+_(step|tick))\s*\(` (line 99).
   Skips lines starting `//` or `*` (line 96).
2. Skip anything listed in `GIGA_DEFERRED_ENTRY_POINTS` (lines 43–73, 114–122).
3. Find the *definition file* by a column-0 regex (lines 131–132).
4. Look for a "call" — **any line in any other `src/**/*.cpp` matching `${func}\s*\(`** (line 155),
   skipping only lines that start with `//` (line 152).

### 1.2 Instrumented run — what satisfies each of the 41 entries

I re-ran the gate's exact logic with tracing (`/tmp/markoaudit/wired_instr.cmake`). **Good news
first: all 32 non-deferred entries are satisfied by a genuine call site**, 31 of them in
`src/app/main.cpp` and one (`air_drag_step`) at `src/game/combat.cpp:1489`. No entry is currently
passing on a comment, a string, or its own definition. The gate's *outcome* today is honest.

Its *mechanism* is not, and every hole below is one edit away from being live.

### 1.3 Exclusions / allowlist — every entry audited

| # | Deferred symbol | Line | Stated reason | Verified by grep | Verdict |
|---|---|---|---|---|---|
| 1 | `cellular_step` | 44 | "решение по problems.md §13 ожидается" | **0 hits in `src/`, 0 in `tests/`** — the symbol does not exist | **STALE — dead allowlist row.** Never matched anything; the gate's own `entry_points=41` list does not contain it. A deferral for a deleted system. |
| 2 | `fluid_step` | 45 | waits for GPU compute | `src/sim/fluid.h:72,76` decl, `fluid.cpp:43,165` def + self-call `:167`; callers only `tests/world_test.cpp:382`, `suite_gravity_regimes.inl:121,174` | **genuinely unwired** — honest deferral |
| 3 | `loot_containers_step` | 50 | search screen replaced auto-loot; test backend | `container.h:128` decl, `container.cpp:367` def; callers only `tests/game_test.cpp:4615,4623` | **genuinely unwired** — honest deferral |
| 4 | `diffusion_step` | 67 | "called ONLY by `diffusion_tick` from its own file, by contract" | `diffusion.cpp:512` `driver.last = diffusion_step(...)` inside `diffusion_tick`; `diffusion_tick` is called from `main.cpp:3175` | **TRUE — legitimate gate blind spot.** The gate is one-level and cannot see transitive wiring. This entry is correct and is the honest one in the list. |
| 5 | `route_step` | 68 | deferred to #13 | `nav.cpp:223` def, `nav.h:154` decl; 33 hits in `tests/`, **0 callers in `src/`** | **genuinely unwired** |
| 6 | `feed_tick` | 69 | "read only by a test" | `event_bus.cpp:176` def, `event_bus.h:350` decl; callers only `tests/` | **genuinely unwired** |
| 7 | `samosbor_fog_tick` | 70 | fog population doesn't tick in game | `mob_spawn.cpp:719` def, `mob_spawn.h:253` decl; caller only `tests/suite_samosbor2.inl:360` | **genuinely unwired.** But `src/game/samosbor.h:836` claims *"`samosbor_fog_tick` ([mob_spawn.h]) is now the live caller"* — a doc that contradicts the deferral row in the same tree. |
| 8 | `interaction_step` | 71 | "main.cpp calls its own branches instead" | `prop_system.cpp:576` def, `:638` self-call; callers only `tests/` | **genuinely unwired** |
| 9 | `prop_interact_step` | 72 | "не зовёт НИКТО **и не покрыта тестом**" | `prop_system.cpp:636` def; **`tests/e2e_test.cpp:829` DOES call it** | genuinely unwired, but **the stated reason is factually wrong** — it *is* covered by a test. |

**Prior audits found "4 self-exclusions".** Today the list is 9 rows: 1 stale (`cellular_step`),
1 legitimate blind-spot (`diffusion_step`), 6 genuinely-unwired systems that are declared rather
than fixed, and 1 whose justification text is false. The mechanism is working as designed — but
"declared" is doing all the work: **the gate is green because 6 systems are written down, not
because they run.**

### 1.4 Reverse-polarity mutation results (measured)

All run in the sandbox. Control M1 proves the gate *can* fail; everything after it is a hole.

| # | Mutation | Result | Hole |
|---|---|---|---|
| **M1** | delete the real `game::samosbor_step(` call from `main.cpp` | **FAIL** (1 unwired) | — control, gate works |
| **M2** | delete the call, add a `/* … * game::samosbor_step(x) … */` doc line | **PASS** | line 152 skips only `^//`; the header scan at line 96 skips `^\*` but **the call scan does not**. A `*`-prefixed doc line counts as a call. |
| **M3** | delete the call, add `int f(){…} // TODO: game::samosbor_step(a)` | **PASS** | a trailing `//` comment is a "call" — line 155 tests the whole stripped line |
| **M4** | delete the call, add it inside `#if 0 … #endif` | **PASS** | no preprocessor awareness; dead code counts |
| **M5** | delete the call, add `const char* k = "game::samosbor_step(x)";` | **PASS** | string literals count |
| **M6** | new header decl `void zzz_step(int);` + def written `void game::zzz_step(int a){}`, **zero callers** | **PASS** | **the "cannot fail" class.** Def regex (line 131) needs `[ \t*&]` immediately before the name; `ns::name` has `::`, so `def_file` stays empty → line 146 skips nothing → **the definition line itself matches the call regex**. Self-satisfying. |
| **M7** | same, def written unqualified inside `namespace game { … }` | **FAIL** | control — the gate only works for this one definition style |
| **M8** | `struct Foo { void bar_tick(); };` + `void Foo::bar_tick(){}`, zero callers | **PASS** | **every member-function `*_step`/`*_tick` is permanently invisible**, same root cause as M6 |
| **M10** | def indented 4 spaces inside a namespace block, zero callers | **PASS** | same root cause — column-0 assumption |
| **M9** | `hp_step` declared, never called; only `player_hp_step(` called elsewhere | **PASS** | line 155 is unanchored substring — **any longer name ending in the short name satisfies it** |
| **M11** | only a forward *declaration* `void vv_step(int a);` in another `.cpp` | **PASS** | a declaration is indistinguishable from a call |

**Nine independent false-negative channels.** M6/M8/M10 are the serious ones: they are not
"the gate misses a call", they are **"the gate marks a function wired using the function's own
definition"** — precisely the defect the file's own header (lines 14–21) says was closed before
adoption. It was closed only for the single definition style `void name(` at column 0.

### 1.5 Scope hole
The regex only ever looks at `*_step` / `*_tick` (line 99). Renaming a system exempts it entirely.
Two such systems already exist in headers today: **`needs_advance`, `status_apply`**. Neither is
examined by the gate at all.

### 1.6 ctest pin
`CMakeLists.txt:1121` → `PASS_REGULAR_EXPRESSION "GIGA_WIRED=PASS entry_points=[0-9][0-9]"`.
This one is **well designed**: two required digits genuinely forbid the "glob broke, scanned zero"
failure. Verified — `entry_points=0` would not match. Credit where due.

### 1.7 A fake test that impersonates this gate
`tests/e2e_test.cpp:1710-1716`:
```cpp
static void test_t2_f14_05_static_gate_regex_compliance() {
    const char* names[] = {"bank_step", "feed_tick", "interaction_step", "prop_interact_step", "route_step"};
    for (const char* name : names)
        CHECK(std::strstr(name, "_step") != nullptr || std::strstr(name, "_tick") != nullptr);
}
```
This asserts that the string `"bank_step"` contains `"_step"`. It is a tautology over five string
literals, touches no gate, reads no file, and **cannot fail under any code change**. Its name claims
it verifies "static gate regex compliance". It contributes 5 checks to the pinned `243576` count.
**This is a top finding: a check that is green by construction, named after the thing it does not check.**

---

## 2. `check_source_rules.cmake`

569 lines, ~60% prose. 7 numbered rules + 2 structural guards.

### 2.1 AGENTS.md rule → enforcement matrix

| AGENTS.md rule | Line in AGENTS.md | Gate | Enforced? |
|---|---|---|---|
| No `throw`/`catch`/`try` | 108 | rules 1, lines 327–332 | **yes, verified** (S1 FAIL) — but see holes S2/S7 |
| No `dynamic_cast`/`typeid` | 108 | rule 2, lines 335–338 | yes (same mechanism) |
| No GLM/Eigen | 124 | rule 3, lines 341–344 | yes |
| Core must not include SDL/Vulkan/ImGui/GLFW | 124 | rule 4, line 347 | **partially — spelling-dependent, see 2.3** |
| `src/game` headless | 192 | rule 5, line 351 | **partially — same** |
| No UTF-8 BOM | 296 | rule 6, lines 361–373 | yes |
| CSV is the source; never hand-edit generated `.cpp` | 167 | rule 7, lines 388–452 | **cosmetically only — counts rows, not content** |
| Every suite compiled + dispatched | (implicit) | lines 492–549 | **yes, verified** (SG1 FAIL) |
| **NEVER PIN A FAILING SUITE** | 103 | — | not gated; manually satisfied (all 6 pins end `0 failures` / `N/N`) |
| Never bare `unsigned int` | 231 | — | **not enforced**; 1 live violation: `src/game/keybind.cpp:85` |
| Zero rounding in ImGui | 324 | — | not enforced; currently honoured (`src/render/imgui_layer.cpp:41`) |
| Files ≤ ~1000 lines | 226 | — | **not enforced**; ≥17 files over, worst `src/app/main.cpp` **7266 lines** |
| `kSimHz` lives in one place | 200 | — | not enforced; currently honoured (`src/core/tick.h:26` is the only definition) |
| Fog end ≤ `kWorldExtent/2`, clear colour black | 146 | — | not enforced |
| Zero warnings | 290 | — | **not enforced as an error** — no `-Werror` anywhere; AGENTS.md only says "treat as errors in review" |
| Scratch never enters the tree | 96 | `.gitignore` only | partial |

### 2.2 Mutation results — rules 1–6 (measured)

| # | Mutation | Result | Hole |
|---|---|---|---|
| **S1** | `throw 1;` appended at `src/sim/physics.cpp:365` | **FAIL**, correct line number | control — §46 bracket repair is real and works |
| **S2** | `*p = 1; throw 2;` — line's first char is `*` | **PASS** | **line 151 `if(_stripped MATCHES "^\\*") continue()` exempts the entire line from every rule.** Intended for doc-block continuations; it also exempts real code. **Measured: 51 lines in `src/`+`tests/` currently begin with `*` followed by non-comment content** (`src/render/gpu_timer.cpp:21,22,34`, `src/app/settings_ui.cpp:56`, `src/render/gpu_gas_pass.cpp:87`, …). Every one of them is a permanent blind spot for all 7 rules. |
| **S3** | `throw 3; // giga-check: allow` | PASS | documented escape hatch, working as designed |
| **S4** | `const char* s = "giga-check: allow"; void f(){ throw 4; }` | **PASS** | the hatch is `string(FIND)` over the raw line (line 144) — it fires from inside a **string literal**, so an exemption can be hidden in data rather than in a comment. The header (lines 27–32) sells it as "greppable on purpose"; this spelling is greppable but not obviously an exemption. |
| **S5** | `throw` in a new `src/sim/s5.hpp` | **FAIL** (extension guard fires, names both blind sets) | the anti-`.inl`-class guard genuinely works |
| **S6** | `throw` appended to `tests/suite_speech.inl` | **FAIL** | `.inl` coverage real |
| **S8** | `throw 8;` inside a `/* … */` block | **FAIL** | documented FP-over-FN bias, working as stated |

### 2.3 Layering rules 4/5 are spelling-dependent (measured)

Regex (lines 347, 351): `include[ \t]*[<"](SDL3?/|vulkan/|imgui|GLFW/)`

| Mutation in `src/game/s7.cpp` | Result |
|---|---|
| `#include <SDL3/SDL.h>` | **FAIL** (control ✓) |
| `#include <SDL.h>` | **PASS** — SDL2-style include bypasses the rule |
| `#include <volk.h>` | **PASS** |
| `#include <MoltenVK/mvk_vulkan.h>` | **PASS** — and MoltenVK is *the* Vulkan loader on this project's primary platform |
| `#include "vk_mem_alloc.h"` | **PASS** |

The rule catches the canonical spelling and nothing else. On a macOS/MoltenVK project, the
`MoltenVK/` miss is the notable one.

### 2.4 Rule 7 (CSV↔header drift) — mutations

| # | Mutation | Result | Meaning |
|---|---|---|---|
| **R7a** | add a row to `data/items.csv`, don't regenerate | **FAIL** ("444 rows vs declares 443") | control ✓ — the rule works for its stated case |
| **R7b** | hand-edit a *value* inside generated `src/game/item_table.cpp` (row count unchanged) | **PASS** | **Rule 7 compares row *counts* only.** AGENTS.md:170 "Never hand-edit the generated `.cpp`" is therefore enforced only against edits that change the number of rows. A silent stat change is invisible. |
| **R7c** | delete the whole generated `src/game/speech_table.cpp` | **PASS** (`files_scanned` 299→298; the pin `[0-9][0-9][0-9]` still matches) | |
| **R7d** | add a row to `data/quests.csv` | **PASS** | ungated table, see 2.5 |
| **R7e** | **delete `data/items.csv` entirely** | **PASS** | **`if(EXISTS "${GIGA_ROOT}/${_csv}" AND EXISTS …)` at line 389 makes the rule opt-out-by-deletion.** Remove the input and the check goes quiet with no diagnostic. This is exactly the "a check that silently sees nothing" failure mode the same file guards against at lines 250–255 for the file globs — and here it is unguarded. **Every one of the 9 rule-7 invocations has this property.** |

### 2.5 Ungated generated tables (cross-checked with the codegen audit)
Rule 7 covers 9 CSVs. **Five committed generated tables have no drift gate at all**, each with a
ready-made count constant to bind to:

| CSV | rows | Generated table | Constant available |
|---|---|---|---|
| `craft_recipes.csv` | 24 | `craft_table.cpp` | `kCraftSourceCount` — `src/game/craft.h:211` |
| `economy.csv` | 10 | `economy_table.cpp` | `kEconomyRows` — `src/game/economy.h:169` |
| `quests.csv` | 19 | `quest_table.cpp` | `kQuestCount` — `src/game/quest.h:135` |
| `speech_lines.csv` | 284 | `speech_table.cpp` | `kSpeechLineCount` — `src/game/speech.h:124` |
| `status.csv` | 6 | `status_table.cpp` | `kStatusCount` — `src/game/status.h:36` |

The rule's own comments (lines 419–426) record that this exact omission already happened twice
(melee, then ranged) and warn against it. It has now happened five more times.

### 2.6 Escape-hatch census — clean
`grep -rn "giga-check" src/ tests/ shaders/` → **zero hits**. Neither `giga-check: allow` nor
`giga-check: unwired-suite` is in use anywhere. No exemptions are rotting in the tree. This is the
gate's best result.

### 2.7 ctest pin
`CMakeLists.txt:1105` → `"GIGA_SOURCE_RULES=PASS files_scanned=[0-9][0-9][0-9]"`. Correct in kind
(a FATAL_ERROR before the PASS line makes a failure unmatched), but the three-digit window means
files_scanned may fall from 299 to 100 unnoticed. Comments at `:1062` (167) and `:1086` (245) are
3 revisions stale against today's 299.

---

## 3. CMakeLists.txt (1151 lines) — bloat audit

### 3.1 It is 72% prose
| Class | Lines | % |
|---|---:|---:|
| pure comment (`^\s*#`) | **829** | 72.0 |
| CMake code | **273** | 23.7 |
| blank | 50 | 4.3 |

The tests block alone (`:422-1151`) is **92% comment**. The single largest artefact:
**`CMakeLists.txt:583` opens `set_tests_properties(game_test PROPERTIES` and its first property
keyword does not appear until `:1032` — 447 comment lines wedged inside one function call's
argument list**, 82 of them a `N -> M` check-count changelog. This is a `git log` substitute living
inside CMake syntax.

Other misplacements: `:483` glues a 48-line block to `world_test`'s closing paren; `:1123-1129`
carries a comment describing `sim_bench` attached to `xray_map` (`:1130`).

### 3.2 Targets — no dead ones, but no `install()` either
13 targets, all built by default, none `EXCLUDE_FROM_ALL`. `giga_core`, `giga_audio`, `giga_game`,
`giga_shaders`, `giga_imgui`, `gigahrush2`, 4 test exes, `xray_map`, `sim_bench`, `macro_bench` —
every one is referenced. **No `install()` anywhere**, despite the "STEAM MINSPEC" shipping prose at
`:114-117`. `xray_map` — a diagnostic tool, not a test — is gated behind `if(GIGA_BUILD_TESTS)`
(`:423`) and disappears with the tests.

### 3.3 Options — one confirmed fake knob
| Declared | Line | Read? |
|---|---|---|
| `GIGA_ASAN` | 44 | yes (`:49,67`) |
| `GIGA_BUILD_TESTS` | 45 | yes (`:423`) |
| **`KTX_FEATURE_STATIC_LIBRARY ON`** | **170** | **`grep -r KTX_FEATURE_STATIC_LIBRARY build/_deps/ktx-src/` → 0 hits** |

**Finding O1.** `KTX_FEATURE_STATIC_LIBRARY` does not exist in KTX-Software v4.4.0. It sits in
`build/CMakeCache.txt:473` as `BOOL=ON`, reading as if libktx is statically linked. Measured
reality: `build/Release/libktx.4.4.0.dylib` (2.5 MB) is built, `-Dktx_EXPORTS` is on the compile
line, and `otool -L build/gigahrush2` resolves `@rpath/libktx.4.dylib` through
`LC_RPATH /Users/jirnyak/Mirror/gigahrush2/build/Release` — **an absolute path into this
developer's build tree**. There is no macOS equivalent of the `if(WIN32)` DLL-staging block at
`:414-420`, so the shipped binary is not relocatable.

**Finding O2.** `KTX_FEATURE_WRITE OFF` (`:171`) does not do what `:166-167` claims. `-DKTX_FEATURE_WRITE`
**is** on every exe TU, because `build/_deps/ktx-src/CMakeLists.txt:783` sets it `PUBLIC`
unconditionally. Cache says OFF; the compiler line says ON.

### 3.4 Third-party — nothing fetched-but-unused
EnTT v3.14.0, imgui v1.91.5, ktx v4.4.0, Vulkan, Threads, SDL3 (system CONFIG here; FetchContent
fallback untaken). All six link into something. Clean.

### 3.5 Source lists — clean
Every explicit path in non-comment code exists on disk (verified for all ~40). Reverse: **116
`.cpp` under `src/`, all 116 compiled**; 44 `tests/*.inl`, all 44 included. Zero orphans.
Minor: `:437` compiles 4 `src/render/*.cpp` into `world_test` which `:385` also globs into the exe
(the only 4 duplicate entries in `compile_commands.json`).

### 3.6 Platform branches — ~40 lines never compiled here
`build/CMakeCache.txt:67` = **`Release`** (no Debug-tree trap). Host arm64, Unix Makefiles.

| Branch | Line | Ever built here? |
|---|---|---|
| MSVC `/utf-8 /permissive- /MP`, NOMINMAX | 54–69 | never |
| MSVC `/W4 /EHsc /wd4100 /GR-` | 95–101 | never |
| MSVC `/arch:AVX2` | 118–119 | never |
| `elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64\|AMD64")` → `-mavx2 -mfma` | 120–121 | **never by anything** — added 2026-08-16 (`5539e45a`), absent from every entry in `compile_commands.json` |
| `if(WIN32)` DLL staging | 414–420 | never |

**There is no `if(APPLE)`, no `if(UNIX)`, no `CMAKE_SYSTEM_NAME` test anywhere** — the primary
platform gets zero handling in this file. Windows-pin prose at `:521` cites a
`build-win\audit_test.exe` run dated 2026-07-30 pinning `140/0`; the live pin is `146`. 18 days stale.
`git log --format=%an -- CMakeLists.txt` → only `Jirnyak` (96) and `marko1olo` (55); no Windows-side
author has ever touched it.

**Layering claim violated:** `:216-218` states core exists "so tests can link the simulation core
without pulling in SDL/Vulkan/ImGui". `:437-438` links `world_test` against `Vulkan::Vulkan` and 4
`src/render` TUs (arriving via `tests/suite_props.inl:11`); `nm -u build/world_test` shows dozens of
undefined `_vk*` symbols.

### 3.7 Compile flags
**Finding F1.** `add_compile_options(-O3/-O2)` at `:48` duplicates `CMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG`
(`CMakeCache.txt:85`) — measured, **all 236 entries in `compile_commands.json` carry `-O3` twice**,
including 109 third-party TUs. This directly contradicts the policy comment at `:72-75`, which
explains that LTO is deliberately *not* a directory variable because "those are inherited by every
FetchContent subproject". `add_compile_options` at `:48`/`:50` (ASAN)/`:65` (MSVC) is directory-scope
and sits above every `FetchContent_MakeAvailable` — so ASAN and the MSVC flags are pushed through
SDL3/imgui/ktx, the exact thing the comment says the design avoids.

**Warning suppressions — two, both global, both nearly worthless:**
`-Wno-unused-parameter` (`:103`) / `/wd4100` (`:97`). Recompiling all 123 first-party TUs with
`-Wunused-parameter` restored (`-fsyntax-only`) produced **4 warnings total**:
`src/app/main.cpp:201` (`noiseField`), `src/audio/audio_system.cpp:137` (`doors`),
`tools/xray_map.cpp:664,877` (`opt`). None in `giga_core` or `giga_game`. A project-wide suppression
buying silence on 4 sites, 2 of them in one offline tool.
**No other suppressions exist** — zero `set_source_files_properties`, zero `COMPILE_FLAGS`, no bare
`-w`, no `/wd` besides 4100. That part is genuinely clean. Note also: **no `-Werror` anywhere**, so
AGENTS.md:290 "Ensure zero warnings" is a review convention, not a gate.

### 3.8 Shaders (`:251-380`) — one dead artifact, one false comment
Sets cross-checked: 24 files on disk (20 stage + 4 `.glsl`); 20 compiled (14 in the `foreach` at
`:262` + 6 explicit `.comp`) plus 2 `-D` variants = 22 `.spv`. **Nothing on disk uncompiled;
nothing compiled that isn't on disk.**

Loader cross-check against `src/render/`: 21 of 22 `.spv` are loaded.

**Finding SH1 — `cube_tex.frag.spv` is dead GPU code, and the 20-line comment defending it at
`:338-357` states something verifiably false.** Lines `:353-357` claim *"`cube_pass.cpp` fails
LOUDLY at init if this .spv is missing and names this block in the error"*.
`grep -c '\.spv' src/render/cube_pass.cpp` → **0**. The file (287 lines) contains no shader path, no
`read_file`, and builds no pipeline; `CubePass::init` (`:91`) only creates texture arrays.
`src/app/main.cpp:1664` confirms CubePass survives only as the texture-array owner —
`RaymarchPass` took over the record path. `problems.md:660` already names this; the sibling
`prop_tex.frag` was deleted 2026-08-17 (`:333-336`) and `cube_tex` was left behind.

**Finding SH2 — the `.glsl` DEPENDS list does exactly what its own comment forbids.** `:255-260`
argues against globbing because "a stray `.glsl` should not silently start forcing every shader to
recompile". `:261` then builds one flat list of all 4 includes and `:268` attaches it to **all 14**
stage shaders. Measured include graph: `material_surface.glsl` → 3 consumers, `volumetric_fog.glsl`
→ 6, `flicker.glsl` → 1, `shadow_march.glsl` → 2. **8 of the 14 include nothing** yet rebuild on any
`.glsl` touch. All 4 `.glsl` are live; none orphaned.

### 3.9 Tests — 6 tests, all real, all green today
| Test | Line | Pin | Measured today |
|---|---|---|---|
| `world_test` | 443 | `"23391/23391 checks passed"` | matches |
| `audit_findings` | 541 | `"audit_test: 146 checks, 0 failures"` | matches |
| `game_test` | 582 | `"game_test: 243576 checks, 0 failures"` | matches |
| `e2e_test` | 1040 | `"e2e_test: [0-9]+ checks, 0 failures"` | 2441 / 0 |
| `source_rules` | 1101 | `files_scanned=[0-9]{3}` | 299 |
| `wired` | 1117 | `entry_points=[0-9]{2}` | 41 |

**No `WILL_FAIL`, no `DISABLED`, no `SKIP_*`** in the file or in `build/CTestTestfile.cmake`. Every
pin demands a terminal success line the binary only reaches on success, and every one pins
`0 failures` or `N/N`. **AGENTS.md:103 "NEVER PIN A FAILING SUITE" is honoured.** These pins are the
strongest part of the build system.

Real gaps (gaps, not fakes):
- **T3:** no test builds or links `gigahrush2`. `ctest` can be fully green while the executable
  fails to link. Nothing exercises `src/app`, `src/input`, `giga_imgui`, or 44 of 48 `src/render` TUs.
- **T4:** `giga_shaders` (`:379`) is a dependency of the exe only → **a broken shader cannot fail
  `ctest`.** GLSL errors surface only when a human builds the app.

---

## 4. Codegen (16 `tools/*.py`) — the headline is *good*

Full method: sandbox repo at `/tmp/markoaudit/scratch2/fake/` with a read-only symlink to `data/`;
all 14 `gen_*.py` re-run with `REPO` resolving to the sandbox; output diffed against committed.
Repo `git status` verified unchanged before and after.

**Result: 18/18 committed generated artifacts are byte-identical to what their generators emit
today. Zero drift. Zero surviving hand-edits.** Row counts corroborate (items 443, mobs 68, melee 22,
ranged 30, materials 21, props 9, interactables 6, particles 5, monster_traits 21, quests 19,
speech 284, status 6). All 18 carry a `GENERATED … do not hand-edit` banner naming script and CSV.
A git-log scan flagged 7 suspect commits across 3 files; all 7 predate their generators
(`materials.h`/`material_props.h` were hand-written until `gen_material_table.py` landed;
`material_surface.glsl` came from the now-deleted `gen_material_surface.py`, last seen `07b47a84`).

Weaknesses that remain:

| # | Finding | Evidence |
|---|---|---|
| C1 | **No build-time regeneration at all.** `CMakeLists.txt` contains zero python invocations, no `find_package(Python)`, no `add_custom_target` for tables. The only generator mention is a comment at `:163`. `.gitignore` ignores none of the generated paths. Correctness rests entirely on discipline + rule 7. | grep |
| C2 | **No `gen_*.py` has an `--out` flag.** All 14 hardcode `REPO = dirname(dirname(abspath(__file__)))`. Regeneration always writes into the tree; there is no dry-run. | e.g. `gen_item_table.py:17-19` |
| C3 | Five generated tables outside rule 7 — see §2.5 | |
| C4 | **`measure_materials.py` and `fetch_textures.py` cannot run on this host** — `import numpy`/`PIL` unavailable, and `DEFAULT_PACK` is a Windows path `C:\hades\Hecton8\…` (`measure_materials.py:46-48`). `data/textures.csv` and `data/textures/*.ktx2` are therefore **permanently frozen** = latent permanent drift if `materials.csv` grows a texture binding. Both write straight into `data/` with no `--out`. | |
| C5 | Undocumented generator ordering: `gen_economy_table.py:45-46` parses **generated** `src/game/item_table.h` and `item_table.cpp`, so `gen_item_table.py` must run first. Nothing states or enforces it. | |
| C6 | Stale prose: `src/game/craft.h:174` says `// 442` where `kItemCount = 443`; `src/game/ranged_table.h:2` says "the 29 … guns" where `kRangedCount = 30`. Values themselves correct. | |
| — | `data/sounds.csv` is header-only (0 rows), read at *runtime* by `src/audio/audio_system.cpp:213` — correctly outside rule 7. `gen_prop_table.py:44-50` has an undocumented second input (`data/interactables.csv`). | |

---

## 5. `.github/` — the CI is honest but nearly empty, and the Pages jobs are a mess

### 5.1 The one real job
`source-rules.yml` is genuine: `ubuntu-latest`, checkout, then
`cmake -DGIGA_ROOT=$GITHUB_WORKSPACE -P tools/check_source_rules.cmake`.
**No `continue-on-error`, no `|| true`, no `if: false`, no matrix exclusion.** The 32-line header
honestly explains why it does not attempt build+ctest (no Vulkan/glslc/SDL3 on a bare runner) and
records that the previous incarnation was a starter-template matrix that had never been green while
README carried a hardcoded "Build: Passing" badge. That was fixed in `c958e166` (Jirnyak, 2026-08-12).

**But:**
- **`check_wired.cmake` is never run by CI.** It is `cmake -P` over source text and needs no
  compiler — exactly the same class as `source_rules`, and exactly as runnable on a bare runner.
  It runs only in local `ctest`. One line would add it.
- **No compile step and no `ctest` anywhere.** All four test binaries (243k + 23k + 2.4k + 146
  checks) run only on a developer's machine. Nothing prevents a non-compiling push to `main`.
- **Only `push`/`pull_request` on `main`.** The current working branch is `torus`; nothing here
  gates it.

### 5.2 Three GitHub Pages workflows fighting each other
| File | Trigger | `concurrency.group` | Upload path |
|---|---|---|---|
| `pages.yml` | push main/master | `"pages"` | `'.'` |
| `static.yml` | push main | `"pages"` | `'.'` |
| `deploy-gh-pages.yml` | push main/master | `pages` | `'docs'` |

Three jobs on the same concurrency group, triggered by the same event, deploying **three different
things** to the same environment. Two of them upload the entire repository root — `git count-objects`
reports `size-pack: 805 MiB` and the working tree is **2.9 GB** (`data/textures/`). Whichever wins
the race decides what the site is. `deploy-gh-pages.yml` uploads `docs`; both `docs/` and `Docs/`
exist, so this is also case-ambiguous on a case-sensitive Linux runner.

`pages.yml`/`static.yml` also mix action versions inconsistently across files
(`checkout@v4` and `@v7`, `configure-pages@v4` and `@v5`, `deploy-pages@v4` and `@v5`,
`upload-pages-artifact@v3` and `@v5`) — dependabot bumped some copies and not others.

### 5.3 dependabot points at an ecosystem that does not exist
`.github/dependabot.yml` declares `package-ecosystem: "npm", directory: "/"`. **There is no
`package.json` anywhere in the repo.** That half of the config can never do anything. The
`github-actions` half is live (and is what produced the version skew above).

### 5.4 Not CI, but adjacent
`welcome.yml` uses `pull_request_target` with `pull-requests: write` — it only posts a comment via
`actions/first-interaction`, so no checkout of untrusted code occurs. Not exploitable as written,
but `pull_request_target` is the trigger to watch if anyone adds a checkout step.

---

## 6. Git attribution — who weakened what

```
tools/check_wired.cmake
  84dfe8de 2026-08-13 Jirnyak   test(wired): гейт на несозванные системы — спасён один коммит из 39
  ca83b764 2026-08-16 Jirnyak   feat(ai,sim): wire the danger-field loop …
  61e6d7cf 2026-08-17 Jirnyak   feat(ui,game): экран обыска …
  0ea3a70f 2026-08-17 Jirnyak   feat(game,ui): банк целиком …

tools/check_source_rules.cmake   (16 commits)
  224b7457 … 156761fb  2026-07-28  marko1olo   (created)
  f1afa158 2026-07-29 marko1olo  fix(gate): the source rules skipped every .inl — 10,468 lines bypassed
  e2e8fbd6 2026-07-29 marko1olo  test(gate): a suite nobody includes passes every rule
  db26b698 2026-07-29 marko1olo  fix(gate): my own unwired-suite guard required `static`
  52947b3b 2026-08-02 marko1olo  chore: automated strategic sweep (gigahrush2)
  f7a92279 2026-08-03 Jirnyak    fix(source_rules): unwired-suite exemption requires a line-start directive
  0cf5b418 2026-08-04 marko1olo  fix(source_rules): only treat a directive LINE as an unwired-suite exemption
  9e1335c2 2026-08-12 Jirnyak    fix(gate): source_rules читал по две строки на файл — [ ] bug
  81d51c52 2026-08-12 Jirnyak    fix(gate): `://` больше не прячет запрещённый токен

.github/workflows/source-rules.yml
  c958e166 2026-08-12 Jirnyak    ci: конвейер, который может выполниться
```

Reading of the history, which matters for how much to trust the gates:

- **`check_source_rules.cmake` was authored by `marko1olo` and shipped with three severe holes he
  then fixed himself** (`.inl` invisible for its entire life; unwired-suite guard requiring `static`;
  suites nobody includes). Two further repairs by Jirnyak on 2026-08-12 found that the gate had been
  **reading ~2 lines per file since creation** (the `[ ]` list-split defect) — i.e. from 2026-07-28
  to 2026-08-12 the gate was functionally decorative. **It is 5 days old in its working form.**
- **`check_wired.cmake` is 4 days old**, is described in its own header as "the one thing out of 39
  commits that survived review" from `marko1olo`'s branch, and its three subsequent commits are all
  Jirnyak *adding rows to `GIGA_DEFERRED_ENTRY_POINTS`* — `61e6d7cf` added `loot_containers_step`,
  `0ea3a70f` touched it during the bank work. **The only edits this gate has received since birth
  are additions to its allowlist.** No hole in it has ever been closed post-adoption.
- No one has ever weakened a gate maliciously here. The pattern is subtler and worse: **the gates are
  written with long, confident prose asserting they are now correct, and the prose has been wrong
  every single time** — three times in `check_source_rules.cmake` by measurement, and once more here
  (`check_wired.cmake:14-21` claims the definition-counts-as-call hole was closed; §1.4 M6/M8/M10
  show it was closed only for one definition style).

---

## 7. Prioritised findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| **1** | **critical** | `check_wired` marks a system wired **using its own definition** whenever the definition is written `void ns::foo_step(`, `void Class::foo_tick(`, or indented. Root cause: def-detection regex `tools/check_wired.cmake:131` requires `[ \t*&]` immediately before the name; on failure `def_file` is empty, line 146 skips nothing, and the definition matches the call regex at line 155. | mutations M6, M8, M10 → PASS with zero callers |
| **2** | **critical** | `tests/e2e_test.cpp:1710-1716` `test_t2_f14_05_static_gate_regex_compliance` is a tautology over 5 string literals (`strstr("bank_step","_step")`). It cannot fail, reads no gate, and is named after verifying one. | read |
| **3** | high | `check_wired` counts as a "call": `*`-prefixed doc lines, trailing `//` comments, `#if 0` blocks, string literals, forward declarations, and any longer identifier ending in the name. | M2, M3, M4, M5, M9, M11 |
| **4** | high | `check_source_rules` **exempts every line whose first non-whitespace char is `*`** (`:151`) from all 7 rules. 51 such real-code lines exist in `src/`+`tests/` today. | S2 → PASS |
| **5** | high | **Neither gate runs in CI.** `source-rules.yml` runs `check_source_rules` only; `check_wired` is `cmake -P` and would run on a bare runner unchanged. No compile step, no `ctest`, nothing gates the `torus` branch. | `.github/workflows/*` |
| **6** | high | `-DGIGA_BUILD_TESTS=OFF` produces **no `CTestTestfile.cmake` at all** — one flag silently deletes every gate. | measured configure |
| **7** | medium | Rule 7 is opt-out-by-deletion: `if(EXISTS …)` at `:389` makes all 9 CSV checks go silent if the CSV is removed. | R7e → PASS |
| **8** | medium | Rule 7 compares **row counts only** — a hand-edited value in a generated table passes. AGENTS.md:170 is enforced only against count-changing edits. | R7b → PASS |
| **9** | medium | Layering rules 4/5 are spelling-dependent: `<SDL.h>`, `<volk.h>`, **`<MoltenVK/…>`**, `"vk_mem_alloc.h"` all pass in `src/game`. | S7, S7b |
| **10** | medium | `cube_tex.frag.spv` compiled every build, loaded by nobody; the 20-line comment defending it (`CMakeLists.txt:353-357`) asserts a loud-failure guard in `cube_pass.cpp` that does not exist (0 `.spv` refs in that file). | grep |
| **11** | medium | `KTX_FEATURE_STATIC_LIBRARY` (`:170`) is a knob KTX v4.4.0 does not read; libktx links **shared** through an absolute `@rpath` into this developer's build tree, with no macOS staging. | `otool -L`, 0 grep hits |
| **12** | medium | 5 generated tables (craft/economy/quests/speech/status) outside rule 7, each with a ready count constant. The rule's own comments record this happening twice before. | §2.5 |
| **13** | medium | `-O3` applied twice to all 236 TUs incl. 109 third-party, via directory-scope `add_compile_options` at `:48` — contradicting the policy comment at `:72-75`; ASAN and MSVC flags leak the same way. | `compile_commands.json` |
| **14** | medium | Three Pages workflows on the same `concurrency: pages`, same trigger, deploying three different payloads; two upload the whole 2.9 GB tree; one uploads `docs` where `docs/` and `Docs/` both exist. | `.github/workflows/` |
| **15** | low | `cellular_step` deferral row (`:44`) refers to a symbol with 0 occurrences in the tree. `prop_interact_step` row (`:72`) claims "не покрыта тестом"; `tests/e2e_test.cpp:829` calls it. `src/game/samosbor.h:836` claims `samosbor_fog_tick` "is now the live caller" while the gate defers it as unwired. | grep |
| **16** | low | `check_wired` only ever examines `*_step`/`*_tick`. `needs_advance` and `status_apply` already exist and are never examined. | grep |
| **17** | low | `giga-check: allow` fires from inside a string literal (`FIND` over the raw line, `:144`), so an exemption can be hidden as data. Census: **0 exemptions in use** — the tree is clean today. | S4 |
| **18** | low | No `-Werror` anywhere; AGENTS.md:290 "zero warnings" is a review convention. Project-wide `-Wno-unused-parameter` buys silence on exactly **4** sites, 2 of them in `tools/xray_map.cpp`. | recompiled 123 TUs |
| **19** | low | `dependabot.yml` declares an `npm` ecosystem; no `package.json` exists. Action versions are skewed across the 6 workflows. | ls, grep |
| **20** | low | No test links `gigahrush2`; `giga_shaders` is a dependency of the exe only → **`ctest` cannot fail on a broken shader or a non-linking app.** | `CMakeLists.txt:379,398` |
| — | **positive** | **18/18 generated artifacts byte-identical to their generators. Zero drift, zero surviving hand-edits.** All 6 ctest pins verified green and correctly shaped (`0 failures` / `N/N`, terminal-line matching). No `WILL_FAIL`/`DISABLED` anywhere. No `continue-on-error`/`|| true` in CI. Zero `giga-check` exemptions in the tree. All 116 `src/*.cpp` compiled, all 44 `.inl` included, all 20 shaders compiled, nothing fetched-but-unused, every named path exists. Build type is **Release**. | §4, §3.9, §2.6 |
