# Windows build (MSVC + Ninja + Vulkan SDK)

The project's primary platform is macOS/Clang + MoltenVK ([README.md](../../README.md)).
This directory holds the Windows equivalent. The engine sources are portable; only
the build wiring differs.

```bat
tools\win\build.bat                 :: configure + build + ctest, Release
tools\win\build.bat Debug           :: same, Debug
tools\win\build.bat Release notest  :: skip ctest
tools\win\build.bat Release fresh   :: wipe build-win\ first
```

Output: `build-win\gigahrush2.exe`. Run modes and controls are unchanged —
`gigahrush2.exe floors` (default) or `gigahrush2.exe maze`.

## Prerequisites

| Need | Install | Why |
|---|---|---|
| MSVC x64 toolset | `winget install Microsoft.VisualStudio.2022.BuildTools` **then add the workload** (see trap below) | `cl.exe`, `link.exe`, the STL |
| Windows SDK | `winget install Microsoft.WindowsSDK.10.0.26100` | `windows.h`, `kernel32.lib`, the UCRT |
| LunarG Vulkan SDK | `winget install KhronosGroup.VulkanSDK` | `vulkan-1.lib` + `glslc.exe` |
| CMake ≥ 3.20 | `winget install Kitware.CMake` | build system |
| Ninja | `winget install Ninja-build.Ninja` | generator |

SDL3, EnTT and Dear ImGui are **not** prerequisites — CMake fetches and pins them.

`build.bat` locates MSVC through `vswhere`, picks the newest `C:\VulkanSDK\*` if
`VULKAN_SDK` is unset, and falls back to the WinGet package path if `ninja` is not
yet on `PATH`. It fails loudly with the fixing command rather than half-configuring.

### Trap: winget reports success while installing no C++ workload

```bat
:: This exits 0 and installs only the bootstrapper — no cl.exe:
winget install --id Microsoft.VisualStudio.2022.BuildTools -e ^
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools"
```

Verify, never trust the exit code:

```bat
"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest ^
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

If that prints nothing, add the workload through the installer directly, or install
the Windows SDK as its own winget package. The SDK in particular does **not**
reliably arrive with `--includeRecommended`.

## Platform deviations from the macOS build

These are the only places where the Windows build is not identical. Each is a
deliberate, documented choice — see [../../AGENTS.md](../../AGENTS.md) for the rules
they interact with.

### 1. `-fno-exceptions` has no MSVC equivalent

`AGENTS.md` mandates no exceptions and no RTTI. On Clang/GCC both are enforced by
the compiler: `-fno-exceptions -fno-rtti`.

- **RTTI** ports cleanly: MSVC `/GR-` on `giga_core`, `giga_game`, and the tests.
- **Exceptions do not.** MSVC's STL is not supported under `_HAS_EXCEPTIONS=0`;
  `<vector>`, `<string>` and friends are documented as requiring exception support,
  and building them without it is a silent-UB configuration, not a lean one.

So on MSVC we compile `/EHsc` and the no-exceptions rule reverts to what it already
is in the source — **a code discipline enforced by review**. There is no
`try`/`catch`/`throw` in the tree; keep it that way. The macOS build remains the
mechanical enforcer: **if you introduce a throw, the macOS build catches it and
the Windows build does not.** Treat a green Windows build as necessary, not
sufficient.

**Gap closed mechanically, 2026-07-28.** [../check_source_rules.cmake](../check_source_rules.cmake)
is a text gate registered as the ctest `source_rules`. Seven rules, none needing a
compiler, so **both hosts now reject a `throw` identically** and the sentence above
is a statement about the compiler, no longer about the project's actual safety net:

1. `throw` / `catch` / `try` — the no-exceptions rule MSVC cannot enforce.
   `try_emplace` and `try_lock` deliberately do not match.
2. `dynamic_cast` / `typeid` — no RTTI.
3. GLM / Eigen includes — core ships its own math.
4. SDL / Vulkan / ImGui / GLFW includes under `src/{world,sim,ecs,core}`.
5. The same under `src/game`, which has to stay headless-testable.
6. A UTF-8 BOM in any `src/`, `tests/` or `shaders/` file — `/utf-8` already pins
   the source charset, so a BOM buys nothing and breaks `glslc`.
7. CSV-to-generated-header count drift: `data/items.csv` rows vs `kItemCount`, and
   `data/mobs.csv` rows vs the `kMobKindCount` static_assert. Editing a CSV without
   re-running the generator is invisible to the compiler — this is what catches it.

```bat
cmake -P tools\check_source_rules.cmake
```

Verified 2026-07-28 on this tree: 79 files scanned, PASS. Each rule was also
exercised against a seeded-violation scaffold and exits 1, including a check that
the reported line number is correct inside a file containing Cyrillic literals —
that one caught a real bug in the gate, since CMake's `file(STRINGS)` splits on
non-ASCII bytes and had read `items.csv` as 2465 rows instead of 446. The reader is
now built on `file(READ)`.

A line carrying `giga-check: allow` is exempt, with the reason on the same line;
grep that marker to audit every exemption. If `source_rules` stops appearing in the
ctest listing, the `add_test()` wiring was lost to a sync — re-add it rather than
assuming the rules are still enforced.

### 2. Warning flags

`-Wall -Wextra -Wno-unused-parameter` maps to `/W4 /wd4100`. Both are applied by
the single `giga_target_flags()` function in the top-level `CMakeLists.txt`, which
replaced five near-identical `if(NOT MSVC)` blocks.

Third-party Dear ImGui sources moved out of the `gigahrush2` target into their own
`giga_imgui` static library with **default** warnings. Our zero-warning policy now
covers only our code, and never has to be relaxed to accommodate vendored sources.

### 3. SDL3 comes from source

macOS gets SDL3 from Homebrew via `find_package(SDL3 CONFIG)`. Windows has no
system SDL3, so `CMakeLists.txt` now does `find_package(SDL3 QUIET CONFIG)` and
falls back to `FetchContent` at a pinned tag (`release-3.4.12`), built shared.
A `POST_BUILD` step copies `$<TARGET_RUNTIME_DLLS:gigahrush2>` next to the exe so
the binary runs from the build directory.

### 4. MSVC-only compile settings

`/utf-8` (source and execution charset pinned independently of the host's ANSI
codepage), `/permissive-`, `/Zc:__cplusplus`, `/MP`, plus `NOMINMAX`,
`WIN32_LEAN_AND_MEAN`, `_CRT_SECURE_NO_WARNINGS`.

`NOMINMAX` is the load-bearing one: `<SDL3/SDL.h>` can reach `<windows.h>`, whose
`min`/`max` macros collide with the `std::min`/`max`/`clamp` used in
`core/math.h`, `sim/fluid.cpp`, `render/vk_swapchain.cpp` and `input/input.cpp`.

Two flags were dropped as dead after grepping the tree: `_USE_MATH_DEFINES` (no
`M_PI`/`M_SQRT*`/`M_E` anywhere in `src/`, `tests/` or `shaders/`) and
`/Zc:preprocessor` (no `__VA_ARGS__` or `__VA_OPT__`). Neither was wrong, but an
unused conformance flag is a liability — `/Zc:preprocessor` has historically
broken Windows SDK headers — so they go back only with a use to justify them.

`/utf-8` has been through both states, and the history matters because it is a good
example of a claim that was false, then true, for different reasons:

1. **Originally claimed load-bearing — wrong, and measured wrong.** The assertion
   was that dropping it garbles in-game text with no build error. Measured on a
   CP1251 host: the emitted string bytes are byte-identical with and without the
   flag, no C4819 fires. The claim had already propagated into `AGENTS.md` and a
   Claude path-scoped rule before anyone checked it.
2. **Then genuinely load-bearing, from a different cause.** The content tables
   landed: `src/game/mob_table.cpp` carries 69 Cyrillic monster names and
   `src/game/item_table.cpp` carries 446 item names, all generated from the CSVs in
   `data/`. The source charset now has to be *pinned* rather than inferred from
   whatever codepage the host happens to have.

So keep the flag — but for the current reason, not the original one. It also still
earns its keep on a DBCS host (CP932/936/950), where a multi-byte character inside a
comment can swallow the following quote and break the parse outright.

The lesson worth keeping: the measurement was correct when taken and the conclusion
expired anyway. A "measured, therefore settled" note needs the *thing measured*
written down, not just the verdict.
