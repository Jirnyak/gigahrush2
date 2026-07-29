# 3.21 is a hard floor, not a preference: MSVC gained a CXX23 mapping in CMake
# 3.21 (3.20 rejects CMAKE_CXX_STANDARD 23 outright), and $<TARGET_RUNTIME_DLLS>
# — which stages SDL3.dll beside the exe on Windows — is also 3.21.
cmake_minimum_required(VERSION 3.21)
project(gigahrush2 LANGUAGES CXX)

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
check_ipo_supported(RESULT _giga_ipo OUTPUT _giga_ipo_msg)

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
target_link_libraries(gigahrush2 PRIVATE giga_game giga_core giga_imgui
    SDL3::SDL3 Vulkan::Vulkan)
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
    add_executable(world_test tests/world_test.cpp)
    target_link_libraries(world_test PRIVATE giga_core)
    giga_target_flags(world_test OFF)
    add_test(NAME world_test COMMAND world_test)

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
    # (documented at tests/audit_test.cpp:26-28).
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
    # `audit_test: 41 checks, 2 failures` on 2026-07-29. Both failures are finding 5
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
    add_test(NAME audit_findings COMMAND audit_test)
    set_tests_properties(audit_findings PROPERTIES
        PASS_REGULAR_EXPRESSION "audit_test: 41 checks, 2 failures")

    add_executable(game_test tests/game_test.cpp)
    target_link_libraries(game_test PRIVATE giga_game)
    giga_target_flags(game_test OFF)
    add_test(NAME game_test COMMAND game_test)

    # Text gate for the AGENTS.md rules that no compiler enforces on every host.
    # The load-bearing one is no-exceptions: MSVC's STL is unsupported under
    # _HAS_EXCEPTIONS=0, so Windows compiles /EHsc and a `throw` would fail only
    # the macOS build — the defect would ship to the other host. This makes both
    # hosts reject it. Also covers no-RTTI, the GLM/Eigen ban, and the layering
    # invariant that giga_core and giga_game never include SDL/Vulkan/ImGui.
    # Rationale, known limits and the `giga-check: allow` escape hatch live in
    # tools/check_source_rules.cmake. Needs no build, so it is cheap and runs first.
    add_test(NAME source_rules
        COMMAND ${CMAKE_COMMAND} -DGIGA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
                -P ${CMAKE_CURRENT_SOURCE_DIR}/tools/check_source_rules.cmake)

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
    # macro_bench is parked with macro_sim -- see tools/branch_port_pending/README.md.
    # Restore these three lines together with src/game/macro_sim.{h,cpp}:
    #   add_executable(macro_bench tests/macro_bench.cpp)
    #   target_link_libraries(macro_bench PRIVATE giga_game)
    #   giga_target_flags(macro_bench OFF)
endif()
