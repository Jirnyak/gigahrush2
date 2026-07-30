# 3.21 is a hard floor, not a preference: MSVC gained a CXX23 mapping in CMake
# 3.21 (3.20 rejects CMAKE_CXX_STANDARD 23 outright), and $<TARGET_RUNTIME_DLLS>
# — which stages SDL3.dll beside the exe on Windows — is also 3.21.
cmake_minimum_required(VERSION 3.21)

# C is enabled ONLY because libktx is a C library and its targets ask CMake for C
# compiler features; without it the generate step dies with "No known features for C
# compiler" AFTER a successful 321-second configure, which reads like a toolchain fault
# rather than a missing language. No first-party source is C — every file under src/ is
# C++23 — and giga_target_flags() only ever touches CXX targets, so this widens what CMake
# may probe and nothing about how this engine is compiled.
project(gigahrush2 LANGUAGES CXX C)

# ---------------------------------------------------------------------------
# gigahrush2 — universal voxel core engine.
#
# This is the *engine core*, not a game: a monolithic 128^3 macro world, 8^3
# sub-voxel masks per cell, runtime-registered typed scalar fields, vector
# gravity, a 4D level stack, swept-AABB physics, cellular fluid, and an
# attachable ECS camera/controller. Rendering is a minimal-but-real Vulkan
# backend (MoltenVK on macOS) that actually opens a window and draws the world
# as instanced cubes with an ImGui overlay. Gameplay content is intentionally
# left for game teams to layer on top via ECS components + systems.
#
# Dependencies:
#   - Vulkan                  -> system (Homebrew / LunarG SDK) via find_package
#   - SDL3                    -> system if present, else pinned via FetchContent
#   - EnTT, Dear ImGui        -> pinned via FetchContent
# No GLM: the engine ships its own dependency-free math in src/core/math.h.
#
# Platforms: macOS (Clang + MoltenVK) and Windows (MSVC + LunarG Vulkan SDK).
# See tools/win/ for the Windows build entry point.
# ---------------------------------------------------------------------------

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(GIGA_ASAN "Build with Address + UB sanitizers" OFF)
option(GIGA_BUILD_TESTS "Build the engine unit tests" ON)

if(NOT MSVC)
    add_compile_options($<$<CONFIG:Release>:-O3> $<$<CONFIG:RelWithDebInfo>:-O2>)
    if(GIGA_ASAN)
        add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer
            -fno-sanitize=vptr -g)
        add_link_options(-fsanitize=address,undefined)
    endif()
else()
    # /utf-8 is load-bearing now, not merely defensive: src/game/mob_table.cpp and
    # item_table.cpp are generated with Cyrillic name literals, so the source
    # charset has to be pinned rather than inferred from the host's ANSI codepage.
    # (It started as insurance — measured, the emitted bytes were byte-identical
    # with and without it — and became necessary the moment the content tables
    # landed.) On a DBCS locale a multi-byte character can also swallow the
    # following quote and break the parse outright.
    # NOMINMAX is load-bearing: <SDL3/SDL.h> can reach <windows.h>, whose
    # min/max macros collide with the std::min/max/clamp used in core/math.h,
    # sim/fluid.cpp, render/vk_swapchain.cpp and input/input.cpp.
    add_compile_options(/utf-8 /permissive- /Zc:__cplusplus /MP)
    add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
    if(GIGA_ASAN)
        add_compile_options(/fsanitize=address)
    endif()
endif()

# Link-time optimization, probed once and applied per-target below. It is
# deliberately NOT set as a directory variable: those are inherited by every
# FetchContent subproject, which would push /GL (or -flto) through all of SDL3
# and Dear ImGui — slow to build and a less-tested compile path for platform C.
include(CheckIPOSupported)
set(_giga_ipo FALSE)
if(NOT MSVC)
    check_ipo_supported(RESULT _giga_ipo OUTPUT _giga_ipo_msg)
endif()

# ---- Per-target policy -----------------------------------------------------
# One place instead of five near-identical if(MSVC) blocks. Applies our warning
# level, the RTTI decision, and LTO — so third-party targets get none of it.
#
# `rtti` controls whether the target may use RTTI. The no-exceptions rule
# (AGENTS.md) is enforced by the compiler on Clang/GCC only: MSVC's STL is not
# supportable under _HAS_EXCEPTIONS=0 (it rewrites every STL catch block to
# `else if (0)`, so vector::at terminates instead of throwing, and mixing the
# macro across TUs is an undiagnosable ODR violation). On MSVC we therefore
# compile /EHsc and the rule reverts to code discipline. Consequence worth
# remembering: the macOS build is the mechanical enforcer — introduce a throw
# and macOS catches it while Windows stays green. See tools/win/README.md.
function(giga_target_flags tgt rtti)
    if(MSVC)
        target_compile_options(${tgt} PRIVATE /W4 /EHsc
            /wd4100  # unreferenced formal parameter (== -Wno-unused-parameter)
        )
        if(NOT rtti)
            target_compile_options(${tgt} PRIVATE /GR-)
        endif()
    else()
        target_compile_options(${tgt} PRIVATE -Wall -Wextra -Wno-unused-parameter)
        if(NOT rtti)
            target_compile_options(${tgt} PRIVATE -fno-rtti -fno-exceptions)
        endif()
    endif()
    if(_giga_ipo)
        # Release only. MSVC adds /INCREMENTAL to RelWithDebInfo, which conflicts
        # with the /LTCG that IPO implies (LNK4075); LTO also defeats the point
        # of a fast-iteration debug-info build.
        set_property(TARGET ${tgt} PROPERTY INTERPROCEDURAL_OPTIMIZATION_RELEASE ON)
        if(NOT MSVC)
            set_property(TARGET ${tgt} PROPERTY
                INTERPROCEDURAL_OPTIMIZATION_RELWITHDEBINFO ON)
        endif()
    endif()
endfunction()

# ---- Third-party (pinned) -------------------------------------------------
include(FetchContent)
set(FETCHCONTENT_UPDATES_DISCONNECTED ON CACHE BOOL
    "Reuse populated FetchContent deps without network updates" FORCE)

FetchContent_Declare(EnTT
    GIT_REPOSITORY https://github.com/skypjack/entt.git
    GIT_TAG v3.14.0 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(EnTT)

FetchContent_Declare(imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG v1.91.5 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(imgui)

# libktx — reads the KTX2 texture containers in data/textures/ and transcodes them.
#
# WHY A LIBRARY AND NOT A HAND-ROLLED READER. The committed maps are UASTC 4x4 with
# supercompressionScheme 2 (Zstd), so a level is a zstd stream of UASTC blocks that has to
# be inflated AND transcoded before the GPU can see it — the payload has
# vkFormat = VK_FORMAT_UNDEFINED, so there is deliberately nothing to hand
# VkImageCreateInfo until the transcode has happened. That transcode is a real
# entropy-coded format conversion, not a memcpy, and writing it by hand would be a
# thousand lines of someone else's already-tested work. See data/textures/README.md for the
# measured container contract.
#
# The trade was made knowingly: UASTC+Zstd is 25.06 MiB in git for the six bound materials
# against 32.00 MiB for the same six as raw BC7. The raw path needs no library at all, so if
# this dependency ever becomes a problem, `tools/fetch_textures.py --format bc7` regenerates
# a library-free pack and the loader keeps only its container parsing.
#
# Everything off but the transcoder: KTX_FEATURE_WRITE and the tools would pull in a writer
# and a CLI this engine never calls, and the tests would add a target to every build.
set(KTX_FEATURE_TESTS       OFF CACHE BOOL "" FORCE)
set(KTX_FEATURE_TOOLS       OFF CACHE BOOL "" FORCE)
set(KTX_FEATURE_STATIC_LIBRARY ON CACHE BOOL "" FORCE)
set(KTX_FEATURE_WRITE       OFF CACHE BOOL "" FORCE)
set(KTX_FEATURE_DOC         OFF CACHE BOOL "" FORCE)
set(KTX_FEATURE_LOADTEST_APPS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(ktx
    GIT_REPOSITORY https://github.com/KhronosGroup/KTX-Software.git
    GIT_TAG v4.4.0 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(ktx)

# ---- System dependencies --------------------------------------------------
# Vulkan is always a system dependency: MoltenVK via Homebrew on macOS, the
# LunarG SDK on Windows (set VULKAN_SDK). glslc ships with both.
find_package(Vulkan REQUIRED)
if(NOT Vulkan_GLSLC_EXECUTABLE)
    message(FATAL_ERROR "glslc not found. macOS: brew install shaderc. "
        "Windows: install the LunarG Vulkan SDK and set VULKAN_SDK.")
endif()

# Threads is a CORE dependency: the nav bake job system (src/core/jobs.h) fans
# its 64 per-node BFS across std::thread. Found here so giga_core can link it.
find_package(Threads REQUIRED)

# SDL3: prefer a system install (Homebrew), otherwise build it from source.
# Windows has no system SDL3, so FetchContent is the normal path there.
find_package(SDL3 QUIET CONFIG)
if(NOT SDL3_FOUND)
    message(STATUS "SDL3 not found on the system — fetching from source.")
    set(SDL_SHARED ON CACHE BOOL "" FORCE)
    set(SDL_STATIC OFF CACHE BOOL "" FORCE)
    set(SDL_TEST_LIBRARY OFF CACHE BOOL "" FORCE)
    set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(SDL_INSTALL OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(SDL3
        GIT_REPOSITORY https://github.com/libsdl-org/SDL.git
        GIT_TAG release-3.4.12 GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(SDL3)
endif()

set(IMGUI_SOURCES
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_sdl3.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_vulkan.cpp)

# ---- Engine core library --------------------------------------------------
# Everything except the app entry point and rendering lives here so tests can
# link the simulation core without pulling in SDL/Vulkan/ImGui.
# src/core is header-only today (math.h, wrap.h, jobs.h) but is globbed anyway,
# so the first .cpp added there is compiled instead of silently ignored.
file(GLOB_RECURSE GIGA_CORE_SOURCES CONFIGURE_DEPENDS
    src/core/*.cpp src/world/*.cpp src/sim/*.cpp src/ecs/*.cpp)

add_library(giga_core STATIC ${GIGA_CORE_SOURCES})
target_include_directories(giga_core PUBLIC ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(giga_core PUBLIC EnTT::EnTT Threads::Threads)
target_compile_definitions(giga_core PUBLIC ENTT_NOEXCEPTION)
giga_target_flags(giga_core OFF)

# ---- Game layer library ---------------------------------------------------
# Gameplay macro-systems (NPC pool, event bus, inventory, mob table) layered on
# top of the game-agnostic core. Kept as its own lib so headless tests can link
# and exercise it without SDL/Vulkan, and so the engine core stays pure.
file(GLOB_RECURSE GIGA_GAME_SOURCES CONFIGURE_DEPENDS src/game/*.cpp)
add_library(giga_game STATIC ${GIGA_GAME_SOURCES})
target_include_directories(giga_game PUBLIC ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(giga_game PUBLIC giga_core)
giga_target_flags(giga_game OFF)

# ---- Shader compilation (GLSL -> SPIR-V) ----------------------------------
set(_giga_spv_dir ${CMAKE_BINARY_DIR}/shaders)
file(MAKE_DIRECTORY ${_giga_spv_dir})
set(_giga_spv_files "")
# Non-stage GLSL that a shader #includes. glslc resolves these relative to the
# including file, but CMake cannot see through a #include, so they must be listed as
# explicit DEPENDS: edit an include without this and ninja reports "no work to do",
# leaves the stale .spv in place, and the change looks like it did nothing. Kept an
# explicit list rather than a GLOB — a stray .glsl should not silently start forcing
# every shader to recompile.
set(_giga_glsl_includes ${CMAKE_SOURCE_DIR}/shaders/material_surface.glsl)
foreach(_sh cube.vert cube.frag body.vert)
    add_custom_command(
        OUTPUT ${_giga_spv_dir}/${_sh}.spv
        COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O
            ${CMAKE_SOURCE_DIR}/shaders/${_sh}
            -o ${_giga_spv_dir}/${_sh}.spv
        DEPENDS ${CMAKE_SOURCE_DIR}/shaders/${_sh} ${_giga_glsl_includes}
        COMMENT "glslc ${_sh}")
    list(APPEND _giga_spv_files ${_giga_spv_dir}/${_sh}.spv)
endforeach()

# cube.frag compiled a SECOND time, with -DGIGA_ALBEDO_ARRAY, into cube_tex.frag.spv.
#
# ONE SOURCE, TWO VARIANTS, and the split is deliberate. The world pass samples the six
# photographic albedo maps through a sampler2DArray; the body pass shares the same
# fragment source and must NOT, because bodies carry material id 0 and there is no
# texture for them. A single variant would force every body draw to bind a descriptor
# set it never reads — and this engine's two pipeline layouts are push-constant only
# today, which is the property the render audit measured and liked.
#
# Compiling one file twice rather than forking it into cube_tex.frag keeps the surface
# maths in ONE place. That matters here specifically: the procedural surface is
# calibrated per material to a MEASURED luminance CV from data/materials.csv, so a
# forked copy would drift from the generator that produces material_surface.glsl and
# nothing would catch it.
#
# NOT part of the foreach above, because that loop's OUTPUT is derived from its input
# name and this one deliberately differs. `cube_pass.cpp` fails LOUDLY at init if this
# .spv is missing and names this block in the error — which is how it was found: a
# missing shader is otherwise a RUNTIME failure behind a perfectly green build, the exact
# trap AGENTS.md warns about for new shaders.
add_custom_command(
    OUTPUT ${_giga_spv_dir}/cube_tex.frag.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O -DGIGA_ALBEDO_ARRAY
        ${CMAKE_SOURCE_DIR}/shaders/cube.frag
        -o ${_giga_spv_dir}/cube_tex.frag.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/cube.frag ${_giga_glsl_includes}
    COMMENT "glslc cube.frag -DGIGA_ALBEDO_ARRAY -> cube_tex.frag.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/cube_tex.frag.spv)

add_custom_target(giga_shaders DEPENDS ${_giga_spv_files})

# ---- Rendering + app shell ------------------------------------------------
# GLOB_RECURSE, matching giga_core/giga_game. A plain file(GLOB) silently drops
# any .cpp added in a subdirectory, and the symptom is a link error far from the
# cause.
file(GLOB_RECURSE GIGA_RENDER_SOURCES CONFIGURE_DEPENDS src/render/*.cpp)
file(GLOB_RECURSE GIGA_APP_SOURCES CONFIGURE_DEPENDS
    src/app/*.cpp src/input/*.cpp)

# Dear ImGui is third-party: its own target with default warnings, so our
# zero-warning policy applies to *our* code only and never has to be relaxed
# to accommodate vendored sources.
add_library(giga_imgui STATIC ${IMGUI_SOURCES})
target_include_directories(giga_imgui PUBLIC
    ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
target_link_libraries(giga_imgui PUBLIC SDL3::SDL3 Vulkan::Vulkan)

add_executable(gigahrush2 ${GIGA_APP_SOURCES} ${GIGA_RENDER_SOURCES})
add_dependencies(gigahrush2 giga_shaders)
target_include_directories(gigahrush2 PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_definitions(gigahrush2 PRIVATE
    GIGA_SHADER_DIR="${_giga_spv_dir}")
# ktx is linked to the EXE and deliberately not to giga_render or giga_game: the texture
# loader lives in src/render, which is already the only layer allowed to see Vulkan, and
# giga_core/giga_game must stay free of platform and third-party headers (AGENTS.md). Also
# note the target name is lowercase `ktx`, not a KTX:: namespaced alias — KTX-Software
# exports it unnamespaced when built as a subproject.
target_link_libraries(gigahrush2 PRIVATE giga_game giga_core giga_imgui
    SDL3::SDL3 Vulkan::Vulkan ktx)
target_include_directories(gigahrush2 PRIVATE ${ktx_SOURCE_DIR}/include)
# RTTI is permitted in the app shell (ON) — only the core/game libs forbid it.
giga_target_flags(gigahrush2 ON)

# Windows needs the runtime DLLs (SDL3.dll) beside the executable.
if(WIN32)
    add_custom_command(TARGET gigahrush2 POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_RUNTIME_DLLS:gigahrush2> $<TARGET_FILE_DIR:gigahrush2>
        COMMAND_EXPAND_LISTS
        COMMENT "Staging runtime DLLs next to gigahrush2")
endif()

# ---- Tests ----------------------------------------------------------------
if(GIGA_BUILD_TESTS)
    enable_testing()
    # The count is pinned, for the reason spelled out at game_test below: add_test()
    # reads the exit code and nothing else, main() returns 0 unless an assertion
    # failed, so deleting one line from its 15-call dispatch list removed a whole
    # engine-core test from the run and ctest stayed GREEN. Nothing else covers this
    # file — the unwired-suite guard in tools/check_source_rules.cmake only inspects
    # tests/suite_*.inl, and world_test.cpp defines all 15 of its tests inline.
    #
    # OBSERVED, not derived: under ctest on 2026-07-29 world_test printed
    # `22609/22609 checks passed` (42.69 s, Release). The printed pair is
    # (passed, total), so the literal pins the total AND demands zero failures in one
    # regex. It is an EXECUTION count, not a site count: 108 CHECK sites, most inside
    # loops — test_nearest_image's nest alone runs 37 x 33 times.
    add_executable(world_test tests/world_test.cpp)
    target_link_libraries(world_test PRIVATE giga_core)
    giga_target_flags(world_test OFF)
    add_test(NAME world_test COMMAND world_test)
    set_tests_properties(world_test PROPERTIES
        PASS_REGULAR_EXPRESSION "22609/22609 checks passed")

    # The deliberately-red audit findings get their own target and their own exit code.
    # They used to be #included into game_test, which meant game_test returned 1 while
    # any finding stood — so ctest reported one bit, "game_test failed", identically
    # whether the seven known findings were outstanding or whether somebody had also
    # broken an unrelated regression test. That demoted ~45 real gates to stderr.
    #
    # THE COUNT IS PINNED, NOT THE EXIT CODE INVERTED — and the difference is the whole
    # gate. This test used to carry WILL_FAIL TRUE, which inverts `main`'s
    # `return g_fails == 0 ? 0 : 1`. That is one bit, "some check failed", never a count,
    # and today six of the seven findings are CLOSED pins rather than live defects. So
    # under WILL_FAIL, regressing any one of those six moved the failure count 2 -> 3,
    # which is still non-zero, still inverted, and **ctest stayed GREEN**. Six tripwires
    # that read like guards were not guards. The same hole swallowed a crash: die before
    # the count line prints and the exit code is still non-zero, so that was green too
    # (spelled out in the header of tests/audit_test.cpp — named, not cited by line,
    # because the commit that closed this hole rewrote that header and moved the very
    # lines the old pointer named).
    #
    # PASS_REGULAR_EXPRESSION closes both. It matches the literal line `main` prints, so
    # the test passes only when the run reached the end AND landed on exactly the expected
    # tally — a regression moves a number and the regex misses; a crash never prints the
    # line and the regex misses. It also overrides the exit-code check, which is what lets
    # a target that legitimately exits 1 report green. WILL_FAIL is GONE rather than left
    # alongside: CMake ignores it once a pass regex is set, so leaving it would read as if
    # the inversion were still live.
    #
    # Both numbers are pinned on purpose. `failures` is the gate. `checks` catches the
    # other way a tripwire stops tripping silently — delete a test from
    # `test_audit_all()` and the failure count would not move while the coverage did.
    # The cost is that adding a CHECK is a deliberate edit here, which is the intended
    # friction for this file.
    #
    # OBSERVED, not derived: `build-win\audit_test.exe` printed
    # `audit_test: 74 checks, 0 failures` on 2026-07-30 — was 62/0 before
    # descend_same_target_once (12 new CHECKs) closed the double-pay hole where two
    # Active Descend jobs to the same |target| from different givers both completed
    # on one walk. Earlier history: 41 checks / 2 failures on 2026-07-29 were finding 5
    # (suite_audit.inl descend_not_free), which its own ledger entry documents as
    # unsatisfiable as written — the test is the defect there, not the game.
    #
    # IF YOU CLOSE A FINDING (or add a check), this test goes RED. That is the tripwire
    # firing, not a regression. Run the exe, read its count line, change the numbers
    # below to what it printed, and NAME THE DEAD DEFECT IN YOUR COMMIT MESSAGE. Do not
    # tune the number until green without reading why it moved: a count that drifted for
    # a reason nobody wrote down is how this file stops meaning anything.
    add_executable(audit_test tests/audit_test.cpp)
    target_link_libraries(audit_test PRIVATE giga_game)
    giga_target_flags(audit_test OFF)
    # RE-CONFIGURE AFTER CHANGING ANY PIN BELOW. set_tests_properties is baked into
    # build-win/CTestTestfile.cmake when cmake CONFIGURES, so editing this file and then running
    # ctest directly still matches the OLD regex - ctest never reads CMakeLists.txt. Measured
    # 2026-07-29: a corrected pin appeared to fail twice for exactly this reason, and the obvious
    # wrong conclusion was that the NEW number was also wrong. Run tools\win\build.bat (it
    # configures first) or `cmake -S . -B build-win` before trusting a ctest verdict on a pin.
    add_test(NAME audit_findings COMMAND audit_test)
    set_tests_properties(audit_findings PROPERTIES
        PASS_REGULAR_EXPRESSION "audit_test: 74 checks, 0 failures")

    # THE COUNT IS PINNED HERE TOO — the same mechanism as audit_findings above, now on
    # the target that carries 3,887 of the repo's 4,036 CHECK sites. Until this line
    # existed the pin was on the 1% and the raw defect owned the other 99%: add_test()
    # consumed the exit code alone, `main` ends `return g_fails == 0 ? 0 : 1`, and the
    # tally the binary prints was read by NOBODY. So any coverage loss that did not
    # fail an assertion was invisible — delete a call from the 81-line dispatch list in
    # main() and that test simply never runs: exit 0, ctest GREEN, no diff to review
    # anywhere near a test file.
    #
    # What this adds over the existing gates, precisely, because "nothing covered it"
    # would be too strong: tools/check_source_rules.cmake already fails a
    # tests/suite_*.inl whose `test_*_all()` entry point no tests/*.cpp calls, so 23 of
    # the 81 dispatch lines were protected there. The other 58 are defined in this .cpp
    # (test_full_loop 41 CHECK sites, test_mob_behaviour 39, test_floor_bucket_index 37,
    # test_vendor 36, ... 888 sites across the 58) and no rule anywhere looked at them.
    # Three more holes the tally closes and that guard cannot see: a suite whose entry
    # point is not spelled `static` slips its regex (tests/suite_speech.inl declares
    # `void test_speech_all()`, so its 81 sites are unguarded there); deleting a single
    # CHECK inside a test body; and shrinking a loop bound so the same CHECK runs
    # fewer times.
    #
    # OBSERVED, not derived: under ctest on 2026-07-29, Release, game_test printed
    # `game_test: 134002 checks, 0 failures` - it read 132266 earlier the same day, before the
    # craft, quest and speech suites landed. Determinism is not assumed —
    # the message of commit cb61632 quotes the identical 132266 from an independent
    # standalone run of the same tree. NOTE the magnitude: this is an EXECUTION count,
    # not the 3,887 static sites; the bulk of the CHECKs sit inside loops.
    #
    # THIS TEST GOES RED THE MOMENT YOU ADD OR REMOVE A CHECK, and on this file that is
    # often. That is the tripwire, not a regression: run the exe, read its count line,
    # put what it printed here, and say in the commit message what moved the number.
    # Do not tune it to green without knowing why it moved — a count that drifted for a
    # reason nobody wrote down is how this stops meaning anything. Deliberate friction
    # on ~4k assertions is the price of coverage that cannot shrink in silence.
    add_executable(game_test tests/game_test.cpp)
    target_link_libraries(game_test PRIVATE giga_game)
    giga_target_flags(game_test OFF)
    add_test(NAME game_test COMMAND game_test)
    set_tests_properties(game_test PROPERTIES
        PASS_REGULAR_EXPRESSION "game_test: 213865 checks, 0 failures")

    # Text gate for the AGENTS.md rules that no compiler enforces on every host.
    # The load-bearing one is no-exceptions: MSVC's STL is unsupported under
    # _HAS_EXCEPTIONS=0, so Windows compiles /EHsc and a `throw` would fail only
    # the macOS build — the defect would ship to the other host. This makes both
    # hosts reject it. Also covers no-RTTI, the GLM/Eigen ban, and the layering
    # invariant that giga_core and giga_game never include SDL/Vulkan/ImGui.
    # Rationale, known limits and the `giga-check: allow` escape hatch live in
    # tools/check_source_rules.cmake. Needs no build, so it is cheap and runs first.
    #
    # Pinned to its last printed line instead of its exit code — but as a FLOOR, not an
    # exact count, and that difference is deliberate rather than lazy.
    # `files_scanned=N` is the final statement of the script and is reached only after
    # the zero-violations verdict, so matching it proves the run completed AND found
    # nothing: any violation raises FATAL_ERROR and the line is never printed. The
    # three-digit class then puts a floor of 100 under the scanned set, which upgrades
    # the script's own `EQUAL 0` guard — a broken glob that silently scans four files is
    # green today and red here. OBSERVED 2026-07-29: `files_scanned=167`.
    #
    # An exact count would be WRONG here, unlike game_test. src/ is GLOB_RECURSE with
    # CONFIGURE_DEPENDS, so every new .cpp in the engine moves this number for reasons
    # that have nothing to do with source rules, and the only available fix would be to
    # retype the number — training precisely the reflex the audit_findings comment above
    # warns against, on a test where the drift is meaningless. The work an exact count
    # would do is already done, and done better, inside the script: the guard that
    # cross-checks every C++-shaped file under src/ and tests/ against the scanned set
    # names the file that went blind instead of just reporting that a total moved.
    add_test(NAME source_rules
        COMMAND ${CMAKE_COMMAND} -DGIGA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
                -P ${CMAKE_CURRENT_SOURCE_DIR}/tools/check_source_rules.cmake)
    set_tests_properties(source_rules PROPERTIES
        PASS_REGULAR_EXPRESSION "files_scanned=[0-9][0-9][0-9]")

    # Honest crowd benchmark: real floor + 16k wandering agents + real physics.
    # An executable, not a ctest (it measures, it doesn't pass/fail). Runs at the
    # global Release -O3 so the numbers reflect an optimized build. Threads come
    # in transitively via giga_core now; kept explicit here to document the need.
    add_executable(sim_bench tests/sim_bench.cpp)
    target_link_libraries(sim_bench PRIVATE giga_game Threads::Threads)
    giga_target_flags(sim_bench OFF)

    # Macro-society benchmark: advance the FULL 2^20 population one coarse tick at a
    # time and report ms/tick. Like sim_bench an executable, not a ctest -- it is a
    # measurement tool, and a benchmark that fails the build on a slow machine is a
    # benchmark nobody runs.
    #
    # Uses giga_target_flags() rather than the branch raw if(NOT MSVC)
    # target_compile_options: the helper is the one place that knows this project
    # cannot use -fno-exceptions on MSVC (the STL is unsupported under
    # _HAS_EXCEPTIONS=0), so hand-rolling the flags per target is how that deviation
    # gets forgotten.
    add_executable(macro_bench tests/macro_bench.cpp)
    target_link_libraries(macro_bench PRIVATE giga_game)
    giga_target_flags(macro_bench OFF)
endif()
