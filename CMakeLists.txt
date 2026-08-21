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
    # ---- Architecture baseline — the ONE place per-ISA flags live ------------
    # Two shipping platforms, two ISAs: Windows/Linux are x86-64 and get AVX2+FMA
    # (the fork's Windows perf work, kept); macOS is arm64 where NEON is the
    # compiler default and no flag exists or is needed. Any future per-ISA flag
    # goes HERE, not next to its feature — that is how this stays one decision
    # instead of an accretion of scattered gates.
    # STEAM MINSPEC CALL, deliberately open: /arch:AVX2 makes the binary refuse
    # pre-2013 x86 CPUs (a few % of the Steam survey). Revisit before shipping;
    # the compromise then is a lower baseline or runtime dispatch, decided on a
    # sim_bench measurement, not here.
    if(MSVC)
        target_compile_options(${tgt} PRIVATE /arch:AVX2)
    elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
        target_compile_options(${tgt} PRIVATE -mavx2 -mfma)
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
# Аудио: DSP-слой платформы не знает (тестируется game_test'ом), SDL-мост
# audio_system.cpp живёт в исполняемом файле — SDL не протекает в тесты.
file(GLOB GIGA_AUDIO_DSP CONFIGURE_DEPENDS
    src/audio/audio_mixer.cpp src/audio/spatial_audio.cpp
    src/audio/synth_ambient.cpp src/audio/synth_geiger.cpp
    src/audio/synth_siren.cpp src/audio/synth_ui.cpp)
add_library(giga_audio STATIC ${GIGA_AUDIO_DSP})
target_include_directories(giga_audio PUBLIC ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(giga_audio PUBLIC giga_core)
giga_target_flags(giga_audio OFF)

add_library(giga_game STATIC ${GIGA_GAME_SOURCES})
target_include_directories(giga_game PUBLIC ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(giga_game PUBLIC giga_core giga_audio)
giga_target_flags(giga_game OFF)

# ---- Shader compilation (GLSL -> SPIR-V) ----------------------------------
# Grid constants are PARSED OUT OF THE C++ HEADERS at configure time and handed
# to every glslc call as -D macros, so GLSL and C++ cannot disagree about the
# world's shape. Before 2026-08-18 the numbers were retyped as literals in the
# shaders and drifted exactly the way retyped numbers do: prop.frag divided by
# a hand-computed 76.8 where the C++ side passes 64 (markoaudit-systems.md
# §1.8), and shadow_march.glsl carried its own "lockstep" copy that nothing
# enforced. Rule 9 of tools/check_source_rules.cmake bans the literals from
# shaders/, so this block is the ONLY source. Parsing failures are FATAL on
# purpose: a silent default here would be a fifth copy of the number.
file(READ ${CMAKE_SOURCE_DIR}/src/world/types.h _giga_types_h)
if(NOT _giga_types_h MATCHES "kMacroDim = ([0-9]+)")
    message(FATAL_ERROR "cannot parse kMacroDim out of src/world/types.h — the "
        "declaration moved. Fix the regex here; do not hardcode the value.")
endif()
set(_giga_macro_dim ${CMAKE_MATCH_1})
if(NOT _giga_types_h MATCHES "kSubDim = ([0-9]+)")
    message(FATAL_ERROR "cannot parse kSubDim out of src/world/types.h.")
endif()
set(_giga_sub_dim ${CMAKE_MATCH_1})
if(NOT _giga_types_h MATCHES "kCellSize = ([0-9.]+)f")
    message(FATAL_ERROR "cannot parse kCellSize out of src/world/types.h.")
endif()
set(_giga_cell_size ${CMAKE_MATCH_1})
file(READ ${CMAKE_SOURCE_DIR}/src/render/gpu_light_grid.h _giga_lgrid_h)
if(NOT _giga_lgrid_h MATCHES "kGridDimX = ([0-9]+)")
    message(FATAL_ERROR "cannot parse kGridDimX out of src/render/gpu_light_grid.h.")
endif()
set(_giga_lgrid_dim ${CMAKE_MATCH_1})
if(NOT _giga_lgrid_h MATCHES "kGridDimY = ${_giga_lgrid_dim}" OR
   NOT _giga_lgrid_h MATCHES "kGridDimZ = ${_giga_lgrid_dim}")
    message(FATAL_ERROR "light grid is no longer cubic (gpu_light_grid.h "
        "kGridDimX/Y/Z differ) — volumetric_fog.glsl assumes one dimension; "
        "teach it three before changing this.")
endif()
if(NOT _giga_lgrid_h MATCHES "kGridCellMeters = ([0-9.]+)f")
    message(FATAL_ERROR "cannot parse kGridCellMeters out of src/render/gpu_light_grid.h.")
endif()
set(_giga_lgrid_cell ${CMAKE_MATCH_1})
# Байты клетки светосетки — КОРНЕВАЯ константа раскладки LightGridCell
# (решение владельца: 256 Б = счётчик + 63 id, light-visibility-bake.md).
# Шейдеры выводят число слотов сами: GIGA_LIGHT_CELL_BYTES / 4 - 1.
if(NOT _giga_lgrid_h MATCHES "kGridCellBytes = ([0-9]+)")
    message(FATAL_ERROR "cannot parse kGridCellBytes out of src/render/gpu_light_grid.h.")
endif()
set(_giga_lgrid_cell_bytes ${CMAKE_MATCH_1})
# База кластерного региона таблицы (light-cluster.md): шейдер отличает кластер
# от лампы по слоту — кластеры без теневого марша (решение владельца).
if(NOT _giga_lgrid_h MATCHES "kClusterSlotBase = kRootLights - kClusterSlots")
    message(FATAL_ERROR "cannot find kClusterSlotBase derivation in gpu_light_grid.h.")
endif()
if(NOT _giga_lgrid_h MATCHES "kRootLights = ([0-9]+)")
    message(FATAL_ERROR "cannot parse kRootLights out of src/render/gpu_light_grid.h.")
endif()
set(_giga_root_lights ${CMAKE_MATCH_1})
if(NOT _giga_lgrid_h MATCHES "kClusterSlots = ([0-9]+)")
    message(FATAL_ERROR "cannot parse kClusterSlots out of src/render/gpu_light_grid.h.")
endif()
math(EXPR _giga_cluster_base "${_giga_root_lights} - ${CMAKE_MATCH_1}")
set(_giga_shader_defs
    -DGIGA_MACRO_DIM=${_giga_macro_dim}
    -DGIGA_SUB_DIM=${_giga_sub_dim}
    -DGIGA_CELL_SIZE=${_giga_cell_size}
    -DGIGA_LIGHT_GRID_DIM=${_giga_lgrid_dim}
    -DGIGA_LIGHT_GRID_CELL=${_giga_lgrid_cell}
    -DGIGA_LIGHT_CELL_BYTES=${_giga_lgrid_cell_bytes}
    -DGIGA_LIGHT_CLUSTER_BASE=${_giga_cluster_base})
# Editing types.h or gpu_light_grid.h must re-run configure, or the -D values
# above go stale while the build stays green.
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    ${CMAKE_SOURCE_DIR}/src/world/types.h
    ${CMAKE_SOURCE_DIR}/src/render/gpu_light_grid.h)
set(_giga_spv_dir ${CMAKE_BINARY_DIR}/shaders)
file(MAKE_DIRECTORY ${_giga_spv_dir})
set(_giga_spv_files "")
# Non-stage GLSL that a shader #includes. glslc resolves these relative to the
# including file, but CMake cannot see through a #include, so they must be listed as
# explicit DEPENDS: edit an include without this and ninja reports "no work to do",
# leaves the stale .spv in place, and the change looks like it did nothing. Kept an
# explicit list rather than a GLOB — a stray .glsl should not silently start forcing
# every shader to recompile.
set(_giga_glsl_includes ${CMAKE_SOURCE_DIR}/shaders/material_surface.glsl ${CMAKE_SOURCE_DIR}/shaders/volumetric_fog.glsl ${CMAKE_SOURCE_DIR}/shaders/flicker.glsl ${CMAKE_SOURCE_DIR}/shaders/shadow_march.glsl)
foreach(_sh cube.frag body.vert prop.vert prop.frag raymarch.vert raymarch.frag wire.vert wire.frag particle.vert particle.frag cloth.vert cloth.frag post_pass.vert post_pass.frag)
    add_custom_command(
        OUTPUT ${_giga_spv_dir}/${_sh}.spv
        COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O ${_giga_shader_defs}
            ${CMAKE_SOURCE_DIR}/shaders/${_sh}
            -o ${_giga_spv_dir}/${_sh}.spv
        DEPENDS ${CMAKE_SOURCE_DIR}/shaders/${_sh} ${_giga_glsl_includes}
        COMMENT "glslc ${_sh}")
    list(APPEND _giga_spv_files ${_giga_spv_dir}/${_sh}.spv)
endforeach()

# GPU compute volumetric light grid shader.
add_custom_command(
    OUTPUT ${_giga_spv_dir}/light_grid.comp.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O --target-env=vulkan1.0 ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/light_grid.comp
        -o ${_giga_spv_dir}/light_grid.comp.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/light_grid.comp
    COMMENT "glslc light_grid.comp -> light_grid.comp.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/light_grid.comp.spv)

# GPU 4-channel gas/atmosphere sim over the 128^3 macro grid ([gpu_gas_pass.h]).
add_custom_command(
    OUTPUT ${_giga_spv_dir}/gas_sim.comp.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O --target-env=vulkan1.0 ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/gas_sim.comp
        -o ${_giga_spv_dir}/gas_sim.comp.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/gas_sim.comp
    COMMENT "glslc gas_sim.comp -> gas_sim.comp.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/gas_sim.comp.spv)

# GPU verlet for antourage: wires AND cloth, one shader (chain = lattice, H=1).
add_custom_command(
    OUTPUT ${_giga_spv_dir}/verlet_sim.comp.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O --target-env=vulkan1.0 ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/verlet_sim.comp
        -o ${_giga_spv_dir}/verlet_sim.comp.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/verlet_sim.comp
    COMMENT "glslc verlet_sim.comp -> verlet_sim.comp.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/verlet_sim.comp.spv)

# GPU sim for the unified particle pool (blood/dust/sparks/drips).
add_custom_command(
    OUTPUT ${_giga_spv_dir}/particle_sim.comp.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O --target-env=vulkan1.0 ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/particle_sim.comp
        -o ${_giga_spv_dir}/particle_sim.comp.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/particle_sim.comp
    COMMENT "glslc particle_sim.comp -> particle_sim.comp.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/particle_sim.comp.spv)

# GPU compute prop frustum culling shader.
add_custom_command(
    OUTPUT ${_giga_spv_dir}/cull.comp.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O --target-env=vulkan1.0 ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/cull.comp
        -o ${_giga_spv_dir}/cull.comp.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/cull.comp
    COMMENT "glslc cull.comp -> cull.comp.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/cull.comp.spv)

# prop_tex.frag УДАЛЁН 2026-08-17: компилировался каждый билд, но НИ ОДИН
# пасс его не загружал (grep prop_tex по src/ пуст) — сирота marko-эпохи и
# последний носитель выпиленного аналитического налобника. Текстурные пропсы,
# когда понадобятся, — вариант prop.frag через -D, как cube_tex ниже.

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
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O -DGIGA_ALBEDO_ARRAY ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/cube.frag
        -o ${_giga_spv_dir}/cube_tex.frag.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/cube.frag ${_giga_glsl_includes}
    COMMENT "glslc cube.frag -DGIGA_ALBEDO_ARRAY -> cube_tex.frag.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/cube_tex.frag.spv)

# raymarch.frag compiled a SECOND time, same scheme and same reason as
# cube_tex.frag.spv above: the textured module statically uses the sampler
# arrays, the procedural fallback must not declare them.
add_custom_command(
    OUTPUT ${_giga_spv_dir}/raymarch_tex.frag.spv
    COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O -DGIGA_ALBEDO_ARRAY ${_giga_shader_defs}
        ${CMAKE_SOURCE_DIR}/shaders/raymarch.frag
        -o ${_giga_spv_dir}/raymarch_tex.frag.spv
    DEPENDS ${CMAKE_SOURCE_DIR}/shaders/raymarch.frag ${_giga_glsl_includes}
    COMMENT "glslc raymarch.frag -DGIGA_ALBEDO_ARRAY -> raymarch_tex.frag.spv")
list(APPEND _giga_spv_files ${_giga_spv_dir}/raymarch_tex.frag.spv)

add_custom_target(giga_shaders DEPENDS ${_giga_spv_files})

# ---- Rendering + app shell ------------------------------------------------
# GLOB_RECURSE, matching giga_core/giga_game. A plain file(GLOB) silently drops
# any .cpp added in a subdirectory, and the symptom is a link error far from the
# cause.
file(GLOB_RECURSE GIGA_RENDER_SOURCES CONFIGURE_DEPENDS src/render/*.cpp)
file(GLOB_RECURSE GIGA_APP_SOURCES CONFIGURE_DEPENDS
    src/app/*.cpp src/input/*.cpp src/audio/audio_system.cpp)

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
    add_executable(world_test tests/world_test.cpp src/render/prop_pass.cpp src/render/prop_mesh.cpp src/render/vk_buffer.cpp src/render/vk_common.cpp)
    target_link_libraries(world_test PRIVATE giga_core Vulkan::Vulkan)



    giga_target_flags(world_test OFF)
    add_test(NAME world_test COMMAND world_test)
    # 38712 -> 39331 (+619) on 2026-07-31: suite_destruct.inl landed — SubField
    # paging/collapse, carve_roll statistics (a 4096-iteration loop dominates
    # the delta), carve_at/carve_sphere geometry, layering, seam and detach.
    # 39659 -> 39331 (-328) on 2026-08-01: suite_submesh.inl DELETED with the
    # cube mesher — the raymarcher reads masks directly, there is no greedy
    # meshing left to pin.
    # 39331 -> 39337 (+6) on 2026-08-01: test_step_up_one_atom — the manifest's
    # smooth one-atom step through the real physics_step.
    # 39337 -> 39348 (+11) on 2026-08-01: stain system — StainField round-trip,
    # splat/decay/clear coverage.
    # [2026-08-02] Dropped from 33919 to 23416 due to the removal of the legacy gpu::PropPlacer system and its tests.
    # [2026-08-02] Dropped from 23416 to 23271 due to the removal of procedural props from props.csv
    # [2026-08-03] 23291 -> 23290 (-1): LazyFieldBaker deleted (orphaned duplicate of
    # LazyFieldRebaker whose output nothing read), its single CHECK went with it.
    # 23290 -> 23274 (-16) on 2026-08-06: LazyFieldRebaker DELETED, and its
    # test_lazy_field_rebaker (16 CHECKs) with it. Not a coverage loss to mourn —
    # the suite asserted that a system worked, and the system was a data race:
    # its `std::async` worker BFS-ed the live MacroGrid while the main thread
    # carved it, `clear()` deliberately did not join, and `mark_dirty_cells`
    # queued ONE lattice node when a carve invalidates all 64 flow fields, so it
    # repaired 1/64 of what it broke. The honest debt is the one [destruct.h]
    # already documents: nav stays stale until the next full bake. The four
    # nav.h helpers that existed only to feed it went too, along with
    # AsyncBake's mutable_coarse()/mutable_fine(). [problems.md] §14, and this
    # is what problems.md §2 asked for since 2026-08-04.
    # 23274 -> 23361 (+87) on 2026-08-06: test_mat4_lookAt. mat4_lookAt did
    # `normalize(cross(f, up))` with no degenerate guard, so whenever the view
    # direction was parallel or anti-parallel to `up` the cross vanished,
    # normalize() substituted no axis (math.h:29-32 returns {0,0,0}), and the
    # entire rotation basis went to zeros — a singular view matrix. Reachable
    # today via `--pitch 1.5708`, which writes pitch past the ±1.5533 rad clamp
    # that keeps mouselook off the singularity. The suite pins orthonormality of
    # the three rotation rows across the regression cases, ordinary directions,
    # both near-degenerate clamp boundaries, all four non-Z gravity regimes, and
    # non-unit `up` — the last of which is what fixes WHICH quantity the guard
    # may measure: |cross(f, up)|, never dot(f, up), because `up` is a public
    # parameter under no obligation to be unit-length.
    # 23391 -> 23399 (+8) on 2026-08-18: кап -> каллер в PropPass. Пер-шейповый
    # kMaxPropInstances=4096 (молчаливая резка по порядку вставки ДО GpuCullPass)
    # умер; кап один, корневой — kRootPropInstances=2^17 ИТОГО, формы диапазонами
    # одного буфера, переполнение печатается. Новый тест
    # test_prop_root_cap_total_not_per_shape пинит именно ОБЩНОСТЬ капа: полный
    # буфер в форме 0 отбирает места у формы 1, а overflowDropped_ считает отказ.
    set_tests_properties(world_test PROPERTIES
        # 23393 + 8 (test_prop_root_cap_total_not_per_shape, ветка PropPass
        # несла 23399 от базы без z-шовного блока los) = 23401 на слитой линии.
        # 23401 + 4 (векторные тор-формы wrap_delta3/wrap_dist2/wrap_pos) = 23405.
        # 23405 + 17 (suite_surface: примитив запроса поверхностей S10) = 23422.
        # 23422 + 6 (test_rigid_ball_settles_and_sleeps: рагдолл-ядро — качение
        # из трения, оседание на радиусе, сон, пробуждение записью Velocity,
        # единичный кватернион; [markoaudit/plans/ragdoll.md]) = 23428.
        # 23428 + 5 (test_rigid_box_lies_flat: форма из контактных сфер — бокс
        # 14 сфер кувыркается, ложится ПЛАШМЯ на полувысоту, не на
        # ограничивающий радиус, и засыпает) = 23433.
        # 23433 + 4 (test_rigid_chain_hangs_and_cuts: линк-сущности — цепь на
        # мировом якоре висит связно, разруб = destroy линка, падает на пол и
        # остаётся цепью; звенья ВЕРЁВОЧНЫЕ — жёсткие стояли бы колонной) =
        # 23437.
        # 23437 + 7 (test_rigid_ball_ball_wakes_and_stacks: шар-шар через
        # биннинг — касание будит спящего, пара не проникает, стопка/пара
        # засыпает через touchedTick от пары) = 23444.
        PASS_REGULAR_EXPRESSION "23444/23444 checks passed"
    ) # The deliberately-red audit findings get their own target and their own exit code.
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
    # 148 -> 146 on 2026-08-17: инкремент B убрал вендорную половину
    # ammo_has_a_source (путь закупки умер вместе с падовым магазином).
    # 150 -> 148 on 2026-08-17: travel_keeps_opened_crates переписан в
    # travel_keeps_crate_records (сейв v15 — записи вместо ключей): чеки на
    # «пустой после apply» ушли вместе с семантикой, добавились чеки вклада.
    # OBSERVED, not derived: `build-win\audit_test.exe` printed
    # `audit_test: 150 checks, 0 failures` on 2026-07-30 — was 140/0 before
    # travel_arrival_not_in_wall (9 new CHECKs) closed the elevator soft-lock where
    # keyboard/--shot kept x/y and planted z=kArrivalZ inside a solid column.
    # Earlier: 140 after descend_same_target_once (12 CHECKs); 41/2 on 2026-07-29
    # was finding 5 (descend_not_free) — the test was the defect, not the game.
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
        PASS_REGULAR_EXPRESSION "audit_test: 926 checks, 0 failures")

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
    # 219235 -> 219364 (+129) on 2026-07-31: save v6 — the macro world travels.
    # macro_world_round_trips exercises NpcPool::save_rows/load_rows column by
    # column (dead row's generation, player flag, names, rebuilt buckets) and the
    # MacroSim clock/journeys; wire pins moved to the 64-byte header + the fixed
    # 36-byte faction matrix.
    # 219364 -> 219370 (+6) on 2026-07-31: the padic generator rewrite (dormitory
    # tower — 3-cell storeys, two-slab sandwich, BSP apartments, real stair
    # shafts) changed the geometry that geometry-dependent loops iterate over.
    # 219370 -> 219387 (+17) on 2026-07-31: RPG1 — RpgStats survives elevator
    # body-swap (up + down ride pins in test_elevator; mutation xp=777 etc.).
    # 219409 -> 219425 (+16) on 2026-07-31: ATTR1 keybind/console spend +
    # AGIMV move mult live; suite_console +attr bits, suite_keybind +4; measured 219546 (SAVRPG +120 saveload CHECKs).
    # 219626 -> 221529 (+1903) on 2026-08-01: Section 18 physics/console/keybind
    # expansion — suite_physics + suite_console completion/spawn_ball coverage +
    # suite_props_game wall-device floor band; console "sp" now matches 3 cmds.
    # 221529 -> 221678 (+149) on 2026-08-01: death inventory spill into Corpse
    # then same-cell Containers (jirnyak §19) + suite_rpg death-spill CHECKs.
    # 221694 -> 230925 (+9231) on 2026-08-01: Section 18 ceiling LightBulb ECS seed
    # (seed_ceiling_lights + collect for lighting; suite_props_game ceiling tests;
    # main collect_scene_lights no longer reads propPass.get_prop_positions).
    # 230925 -> 230985 (+60) on 2026-08-01: Section 18 PropPass passive skin —
    # PropMesh + collect_static_prop_mesh_instances; Terminal/Shield/BareBulb/FloodLamp
    # GPU instances from ECS (merge_ecs_prop_meshes after propPlacer.populate);
    # suite_props_game shape collect CHECKs.
    # 230985 -> 231009 (+24) on 2026-08-01: Section 18 Corpse/Loot Interactable —
    # finalize_deaths tags Kind::Corpse; drop_mob_loot tags Kind::Loot; empty
    # searched corpses deactivate; main HUD/E use find_nearest; doors.dirtyCells
    # feed lazyBaker; suite_props_game corpse/loot kind-filter CHECKs.

    # 231072 -> 231083 (+11) on 2026-08-02: s20 sim-owned terminals; kill ghost GPU Terminal/ControlPanel + get_terminal_positions; suite_props_game CHECK.
    # 231083 -> 236278 (+5195) on 2026-08-02: Z-up seeder geometry + GpuHandoff spawn_debris_pieces + DynamicBodyTag/padic fixes (suite_props green).
    # 236278 -> 236272 (-6) on 2026-08-02: 60dbd2a dropped 6 corpse-ragdoll CHECKs in suite_hunt
    # (finalize_deaths strips Velocity again; corpses stay static). Props.csv pipeline
    # (52947b3) added no new CHECKs. Verified green: game_test 236272/0.
    # 236272 -> 236272 (0) on 2026-08-02: PropPlacer legacy tests removed (actually 6 dropped but net delta is 0 somehow).
    # 218985 -> 219307 (+322) on 2026-08-03: unified particle pool game half —
    # suite_particles.inl (generated table row sanity, ParticleBurstQueue ring
    # incl. its 255-push overflow loop, apply_damage-is-the-blood-writer).
    # 219307 -> 223717 (+4410) on 2026-08-03: ClothSheet third primitive —
    # bake_cloths curtains (152 sheets on floor 0, per-sheet anchor/pin/rest
    # loops dominate the delta) + determinism now covers cloths.
    # 223717 -> 222457 (-1260) on 2026-08-03: pipe bake stops emitting orphan
    # elbow Boxes (joint now pending until the following leg proves real) and
    # splits seam-crossing legs (3290 -> 2975 instances; 315 fewer x 4
    # per-instance checks).
    # 222457 -> 222514 (+57) on 2026-08-04: §24 fast travel salvaged out of the
    # markololo fork (FastTravelState + hub gate + console fasttravel/ft +
    # §23 hermetic doors / flee-to-shelter). His own pin admitted 16 failures;
    # on this tree the same suites are green.
    # 222514 -> 222522 (+8) on 2026-08-04: antourage_carve_step — destruction
    # now severs the baked dressing (suite_antourage: innocent dirty list kills
    # nobody, a carved anchor kills exactly once with debris, an already-dead
    # piece stays silent on the next op).
    # 222522 -> 222544 (+22) on 2026-08-04: partial dressing death
    # (wire_live_pins / cloth_live_pins — a cut end lets go, the piece dies only
    # when nothing is pinned any more) + GpuHandoff finally pushes a debris
    # burst (suite_props_game asserts the burst AND the no-queue no-op).
    # 222544 -> 222670 (+126) on 2026-08-04: antourage speaks the DECLARED gravity
    # frame (problems.md §8 closed) — test_gravity_frames pins the frame contract
    # (one frame per axis regime, six faces for Zero, Custom reads the vector) and
    # test_antourage_isotropy bakes all EIGHT regimes on one geometry: non-empty,
    # no anchor in air, no voxel written, bit-for-bit determinism, and sag only
    # where there is pull. +-Z is unchanged (2975/802/152) — the generalisation is
    # identity-preserving, and the one behaviour change it forced (a turn must be
    # legal at the corner cell, not just after it) moved NegY by two instances.
    # 222670 -> 223868 (+1198) on 2026-08-05: door coverage salvaged out of the
    # marko1olo fork (bd27413) — keycard predicate, door_query_near reach, the
    # shut/toggle pair. His assertions were written against his own tree and
    # failed 5 ways here; on inspection OUR code was right every time (cells are
    # 2 m, so his metre-less probe missed; door_shut_all counts what it CHANGED,
    # not what is shut), so the tests were corrected, not the engine. The one
    # real gap they exposed is filed as problems.md §10 (keycard tier ignored)
    # and pinned AS-IS so closing it is loud.
    # 223868 -> 223876 (+8) on 2026-08-05: the wire that would not fall (owner,
    # live play) — aliveness for chains/sheets is now SUB-VOXEL aware. A cell is
    # 2 m and a carve cuts 0.25 m, so "the anchor cell is air" only became true at
    # a ~1.5 m blast; measured here, 0.35/0.6/1.0 m leave the cell nominally solid
    # while the attachment column is gone. Each piece records the FACE it hangs
    # off and the probe asks what the bake asked. The new test pins the
    # discriminating case: 0.6 m hole, cell still solid, pin released.
    # 223876 -> 223840 (-36) on 2026-08-05: pipes anchor like the chains do —
    # by the SUB-VOXEL column they hug, not by a 2 m cell (owner: "асимметрия это
    # плохо"). The bake now seats every leg on the real face and splits a run at
    # any cell whose column is empty, so 9 legs that hung in the air are gone
    # (2975 -> 2966 on floor 0) and the rest sit against the matter they touch.
    # 223840 -> 223852 (+12) on 2026-08-05: death is a STATE, not an event —
    # FallClock keeps a severed chain/sheet simulated and drawn for 8 s so it
    # drops and lands (the antourage verlet_sim collides against the VoxelMirror,
    # the same SSBO particle_sim uses) before it stops being drawn. The test
    # pins the three states, including the one the first draft got wrong: a
    # spent clock must STAY spent, or the piece restarts its fall every frame.
    # 223852 -> 223862 (+10) on 2026-08-05: a severed PIPE falls too. The chains
    # got their fall from the verlet they already were; a rigid leg becomes a
    # DetachedPiece integrated in the game layer against aabb_overlaps_solid —
    # the SOLVER's predicate, not a third copy of collision — and drawn through
    # the instance list it already lived in. Verified headless: 4.86 m of fall,
    # then rest on real geometry, then the same 8 s clock empties the array.
    # 223862 -> 236793 (+12931) on 2026-08-05: pipes finally HUG and BRANCH.
    # Legs are split where the hugged surface steps (531 of 2767 cylinders were
    # floating 1-2 m under nothing) and the bundle twin now sits BESIDE its main
    # on the same face instead of hanging under it; then the walker got a second
    # phase that starts every branch ON an existing trunk and welds a junction at
    # the root — joints went 184 -> 2343 against 3855 legs. Most of the delta is
    # the per-instance CHECK loops over an instance list that grew 2957 -> 6198.
    # 236793 -> 231000 on 2026-08-05: the pipe walker is GONE and the pipes are
    # a NETWORK — multi-source BFS over every cell that can hug a face, then a
    # trace of 260 outlets back to 5 plant rooms. The union is a tree: connected
    # by construction, branching where outlets diverge, budgeted in CELLS (3000)
    # rather than in walker starts. One segment per cell, clamped to its own
    # column, with the clamp DRAWN (the owner asked to see the anchors). Pinned:
    # 0 of 3097 segments float, 1653 joints/brackets.
    # 231000 -> 229369 on 2026-08-05: the network's node is (cell, FACE), not a
    # cell. Linking neighbouring CELLS let the tree hop from a ceiling-hugging
    # cell to a wall-hugging one two metres away, and the two correctly-seated
    # segments did not touch — the gaps and mid-air stubs on the owner's
    # screenshots. A move is now either ALONG one surface or AROUND a corner in
    # one cell (an elbow, with a fitting drawn over the bend). Pinned by direct
    # measurement: 3208 segments, 0 floating, 0 orphans, 1134 fittings.
    # 229369 -> 228322 on 2026-08-05: the floor stopped being a mounting surface
    # (1252 of 3208 segments lay across the walkway — the rule is stated in the
    # FRAME: whatever gravity calls "the side you walk on" is not a surface), and
    # a BEND now costs three straight metres instead of nothing. Free bends let
    # the path zig-zag between surfaces inside one cell: in zero-g, where every
    # frame has five surfaces, that was two fittings per cell and almost no
    # straight run (9140 instances against NegZ's 3954; now 5441 against 4080).
    # 228322 -> 232042 on 2026-08-05: corners are CONTEXTUAL, the way timaert's
    # roads do it (shaders/macro.frag roadOverlay): a cell draws the union of
    # half-links from its own centre toward every neighbour that is also pipe,
    # so elbows, tees and crosses emerge from the neighbourhood in all six
    # directions instead of being special cases. Straight pass-throughs still
    # collapse to one cylinder. The seating check now measures the gap to the
    # piece's OWN anchor column instead of ray-marching from its centre, which
    # lied about half-links reaching under a neighbour's higher ceiling.
    # 232042 -> 233848 on 2026-08-05: the owner's acceptance criteria are the
    # test now — connected COMPONENTS (1..3, measured by union-find over the
    # emitted pieces: it was 5, one per plant, so the plant count is 3), zero
    # floating, zero orphans, and no eighth of the tower holding more than half
    # the network ([problems.md] §11, the recurring "everything on the ground
    # floor" class). Plus the step fitting: a door lintel leaves the neighbour's
    # seat at another height, and the two half-links met at two heights — the
    # break in the screenshots.
    # 233848 -> 233598 on 2026-08-05: a shot at a pipe finally DROPS it. The
    # instance death path was still cell-level while aliveness had moved to the
    # sub-voxel column, so a carve that emptied a pipe's clamp left the cell
    # non-air: carve_step reported nothing, the renderer just stopped drawing —
    # the piece vanished with no debris and no falling body. Plus branches are
    # capped from the JOIN end (uncapped, three outlets swallowed the whole cell
    # budget): 467 branch points against 259, pinned as a ratio.
    # 233598 -> 235191 on 2026-08-06: suite_rooms.inl, leg (b)+(c) of
    # [problems.md] §27 — the room affordance/recovery tables and their baked
    # 128^3 fields. +1593, and 1024 of them are one CHECK per sampled cell in the
    # descent block, which is the point: it walks the flow field to termination
    # from every 4th walkable cell of the arrival storey and asserts each walk ENDS
    # IN A KITCHEN. Measured on this tree: 1024 sampled, 1024 arrived, 0
    # unreachable, 0 over budget.
    # 235191 -> 235200 on 2026-08-06: +9, the errand block — leg (a) of §27 proved
    # headless with the pre-rooms arm run beside it. WITH zones own_ai=64, eat=64,
    # 64/64 standing in a kitchen after 40 s, 667 m walked; WITHOUT zones own_ai=0,
    # eat=64, 0/64, 0 m. Both arms agree on what the bodies WANT, which is what
    # makes the difference attributable to ownership and nothing else.
    # 235200 -> 235213 on 2026-08-06: +13 NET, and the net hides a REPLACEMENT.
    # `only_the_player_starves` (66 CHECKs, 63 of them a per-resident triple) is gone;
    # `the_whole_floor_lives_on_one_clock` (79) is in its place. The old test was GREEN
    # and asserted that the survival clock skipped the crowd — correct while nothing
    # could walk an NPC to a kitchen, and [needs.h] named that exact condition for
    # widening it. §27 legs (a)-(c) satisfy it, so the assertions are retired by their
    # own stated condition, not pinned past a failure. What replaced them are the two
    # numbers that make the widening safe rather than lethal, both measured:
    #   25 min WITHOUT rooms:        64 of 64 at zero HP
    #   25 min OBEYING THE SCORER:   0 of 64 lost HP (min 100)
    # 235213 -> 235067 on 2026-08-06: -146, and a DROP is the honest direction here.
    # The errand block stopped hand-rolling `pos += v*dt` and started calling the real
    # `physics_step`, and the descent block stopped sampling nav's looser "not fully
    # solid" population and started sampling the cells a COLLIDER can occupy
    # (room_body_walkable). The old harness reported 64/64 arrivals while the live
    # game had 62 of 63 errand bodies pinned against geometry — it certified the
    # failure. Fewer, truer CHECKs; the two defects it then exposed are fixed and
    # pinned at zero (`with.stalled == 0`):
    #   kitchen descent: 884 sampled, 874 arrived, 10 unreachable, 0 over budget
    #   errand WITH zones: own_ai=64 stalled=0 in-kitchen=60/64 at 40 s, 64/64 at 120 s
    # 235067 -> 235083 on 2026-08-06: +16, room FURNITURE — a kitchen is now a stove
    # and a table you can see, so "he walked to the kitchen" is an observation and
    # not a claim. The block walks the entities the seeder made rather than trusting
    # a count, and the four numbers after the pieces are the ones that matter:
    #   786 pieces — kitchen 186, bathroom 177, living 423
    #   wrong-room 0, unreachable 0, anchor-in-air 0, floating 0
    # 235083 -> 235093 on 2026-08-06: +10, ITEM WEIGHT. All 442 items gained a mass
    # in grams — the same unit props and mobs now use — resolved by rule from
    # data/item_mass.csv, and a reader (`inventory_mass_g`) landed with it so the
    # column is not a §35 orphan. The block asserts the SHAPE of the result rather
    # than 442 numbers: only the 20 psi techniques are weightless, the range is
    # really spanned, and stack COUNT multiplies.
    #   [items] mass: 20 weightless, lightest 6 g, heaviest 26000 g (АТО-41)
    # 235093 -> 235098 on 2026-08-06: +5, CARRY CAPACITY moved off a flat constant
    # onto the body: 64 kg + 4 kg per point of Strength ([rpg.h] carry_capacity_g).
    # The extra CHECKs pin the two endpoints and the EVENNESS the owner asked for —
    # both constants are powers of two in kilogrammes, so a capacity can never come
    # out odd, and a stray constant that broke that would otherwise be silent.
    # 235098 -> 235119 on 2026-08-06: +21, ENCUMBRANCE. The pure curve is pinned on
    # the properties that make it not-arbitrary — CONTINUOUS across the threshold
    # (a gram over costs <0.1 %, so there is no step to feel), a genuinely free
    # band under capacity, floored so an absurd load slows and never freezes, and
    # the threshold moving with Strength. The driver half proves the claim the whole
    # design rests on: the load reaches the `Mass` component, so fall damage and
    # knockback see it through laws that did not change.
    #   [items] mass: bare 71.9 kg -> carrying 2 x АТО-41 = 123.9 kg
    # 235119 -> 235195 (+76) on 2026-08-10: suite_gravity_regimes.inl — the
    # isotropy law pinned over all 8 GravityRegimes (regime_down/regime_frame
    # shape, fluid Zero-symmetry, fall direction per regime). Count measured by
    # a real run, per AGENTS.md: pin only on 0 failures.
    # 235195 -> 235585 (+390) on 2026-08-12: suite_packs.inl asks a REAL spawn what
    # components it produced — every one of the 194 heads carries Mass, and its kg
    # equals mob_def(kind).massG / 1000. Added because the ABSENCE of this pin was
    # twice mistaken for the absence of the feature: Docs/specs/13 §7.1 and the
    # roadmap's "three one-line defects" both filed `mass_g` as dead for mobs and
    # proposed a line that has stood in mob_spawn.cpp since 2026-08-03. Nothing
    # contradicted them because every test mob in the tree is hand-rolled with a bare
    # emplace<MobRef> and so has no Mass — the suites exercised the knockback
    # FALLBACK, never the live path. Printed by the run:
    #   [packs] mass: massless=0 kg_min=12.0 kg_max=900.0
    # 235585 -> 235601 (+16) on 2026-08-12: suite_rooms.inl. Two affordance rows
    # (IntentSocial->Common, IntentWork->Production) widened kRoomFieldMask, and FOUR
    # of these checks are REPLACEMENTS for assertions that pinned the defect: the
    # Industrial block asserted `!ready() && baked == 0 && resident_bytes() == 0`,
    # spelled out in a comment as correct, when what it recorded was that six of the
    # ten demo floors baked no room field at all and ai_step's errand branch was OFF
    # there. The new block asserts the property that was wanted: every FloorKind's
    # mix intersects the affordance table non-emptily. Measured on a live run:
    #   floor 0  Residential 0x0038 ->     0x003A   6297600 -> 8396800 bytes
    #   floor -8 Derelict    0x0010 ->     0x0112   2099200 -> 6297600 bytes
    #   floor -14 Industrial 0x0000 ->     0x0100         0 -> 2099200 bytes
    # 235601 -> 235641 (+40) on 2026-08-12: save version 10 / SAVCLOCK. busy_run now
    # fills SamosborState and FastTravelState with distinct non-zero values and
    # same_run compares them — the samosbor field by field (the struct's three tail
    # padding bytes are not written, so a struct memcmp would be asserting about host
    # padding), the unlock set over FLOOR LABELS rather than raw bytes (a raw compare
    # agrees with itself however wrong the bit-packing is). Proven to bite by
    # mutation: dropping the reader's restore of `count` and of the unlock bytes
    # failed lines 308/315/318 plus the byte-for-byte re-serialize at 438.
    # 235641 -> 235648 (+7) on 2026-08-12: suite_doors.inl gained a level-11 chipping
    # case. Every mob in every door case was level 1, and mob_hp_at_level is the
    # IDENTITY at level 1, so the suite was structurally blind to whether door damage
    # consulted the level at all — and it did not, while mob_attack_step scaled the
    # same number. Proven to bite: restoring the unscaled dps fails 3 of the 7.
    # 235648 -> 235809 (+161) on 2026-08-12: tests/suite_budgets.inl, the FIRST
    # budget suite in the project. performance.md calls the CPU tick the only scarce
    # resource and RAM the one budget that bounds the dense model, and until now not
    # one ctest asserted a byte or a millisecond — 235k checks of behaviour, zero of
    # cost. Every budget PRINTS measured and limit whether it passes or fails, and
    # every limit is a ceiling with headroom, never the current value (a budget
    # pinned at today's number turns every improvement red). Printed by the run:
    #   [budget] nav_total_bytes         136314880.0 B   limit 167772160.0  ok
    #   [budget] room_zones_bytes          8396800.0 B   limit  16777216.0  ok
    #   [budget] pool_eager_bytes_per_row      306.0 B   limit       512.0  ok
    #   [budget] pool_bytes_per_live_row        13.0 B   limit       256.0  ok
    # The 306 B/row independently reproduces the figure npc_pool.h documents.
    # Proven to bite by mutation: a limit of 1.0 prints OVER and fails.
    # 235809 -> 235826 (+17) on 2026-08-12: quests pay XP, and the difficulty they pay
    # on is COMPOSED from context that already exists — depth, kind, subject, count,
    # deadline — rather than authored in a column. Owner's clarification of
    # ARCHITECTURE.md §Манифест the same day: the number of SYSTEMS is bounded, the
    # number of INPUTS is not. Printed by the run, and the spread is the point:
    #   [quest] cheapest  3x fetch, floors 0..2      2.0 ->  40 xp
    #   [quest] dearest   8x hunt,  floors 0..2     12.3 -> 246 xp
    #   [quest] contract  5x Polzun at |z|=50       15.9 -> 318 xp
    #   [quest] scale: one Tvar kill at level 5 = 94 xp; level 2 costs 100
    # The first version of the rarity term was a CONSTANT wearing a formula (linear
    # against a 50,000 max when the median weight is 800), which doubled every payout
    # and passed every single-input check; the spread assertion is what catches that.
    # 235826 -> 235891 (+65) on 2026-08-12: the elevator shaft menu. `fast_hub_near`
    # (the shaft column) beside `on_fast_hub` (the exact landing cell), and the shaft
    # radii moved out of padic_gen.cpp locals into fast_travel.h so the GENERATOR and
    # the gameplay test read one constant. The assertion that earns that:
    #   [shaft] 144 cells across 16 shafts, all air: yes
    # asks the generated grid whether every cell the menu accepts is standable.
    # Proven to bite by mutation — leaving the generator's local 1 while the shared
    # constant says 2 prints "all air: NO" and fails.
    # 235893 -> 235992 (+99) on 2026-08-13: GRENADES — the thing `Projectile::team`
    # was deleted for on 2026-08-12. The manifesto's own example ("осколки бьют и
    # владельца") could not be checked before, because a bullet flies AWAY from the
    # shooter; the +99 is six blocks of `test_grenade` plus the table row's knock-on
    # in test_ranged_table and suite_vendorammo. The assertions that earn it:
    #   [grenade] own blast: thrower took 54 at 2.0 m of 5.0 m
    #   [grenade] falloff over 5.0 m: 81 45 9 0 at 0.5/2.5/4.5/6.0 m
    #   [grenade] grazing bounce: v=(10.08, 0.00, -2.24) — the face reflected, not
    #             the biggest component
    #   [grenade] blast carve r=1.75 m power=392 removed 1002 sub-voxels across 12 cells
    # All five guards RUN as mutations, not asserted as intentions, and the counts are
    # what the mutated binaries actually printed:
    #   restore `if (c.e == h.source) continue;` in the detonation sweep   -> 4 red
    #   drop the distance falloff (f = 1.0)                                -> 4 red
    #   reflect the biggest velocity component instead of the crossed face -> 1 red
    #   let a grenade end on contact like a bullet                         -> 2 red
    #   throw with `entt::null` as the source (no attribution, §40)        -> 4 red
    # The third of those is the one worth reading twice: the first version of the
    # bounce test survived it GREEN, because all three of its cases threw fast along
    # the same axis as the wall, so face and axis-letter agree. The grazing case —
    # fast along +x, a ceiling 0.06 m overhead — is what makes it bite, and it exists
    # only because the mutation was run before the claim was written.
    # 235992 -> 236038 (+46) on 2026-08-13: the LAST owner test deleted.
    # `projectile_step` still read `p.source != victim` — §33 removed `Projectile::team`
    # and left one exclusion standing, wearing a geometry argument. The argument was
    # dead code that looked load-bearing, and the run prints how thin it was:
    #   [selfshot] tallest legal body clears its own muzzle by 0.004 m (radius 0.75);
    #             at 2.5 m stature it would be inside by 0.125 m
    #   [selfshot] camera holder hit by his OWN bullet for 40 — the last owner test is gone
    # 4 mm, across `body_eye_height` (h*0.43), `height_for_age`'s 2200 mm clamp and
    # kMuzzleForward — three constants in three files that no comment connected.
    # `muzzle_point` replaces the coincidence with a solved ray/sphere exit, so the
    # muzzle is outside the shooter's hit sphere at EVERY stature. Both halves mutated
    # and the counts are what the mutated binaries printed:
    #   restore `&& p.source != victim`                  -> 1 red (the lock)
    #   revert `muzzle_point` to `from + dir*kMuzzle`    -> 8 red (statures 2.3..3.0 m)
    # 236038 -> 236044 (+6) on 2026-08-13: a wall stops a fragment. The blast swept on
    # DISTANCE alone and killed through load-bearing concrete; `los_clear`
    # ([world/los.h], the first LOS primitive in the tree — mob_behaviour.h has a
    # dropped sight test waiting for it) is now asked between the blast and each body.
    # The polarity lives INSIDE the block: the same two bodies at the same 4 m are
    # detonated on twice, once with the wall and once without, and the wall is the only
    # thing that moves.
    #   [grenade] wall shielded 1 of 2 bodies at 4.0 m: 18 vs 0
    #             (same pair without the wall: 18 vs 18)
    # Mutation (drop the los_clear line) -> 1 red. The FIRST version of that test used
    # a one-cell wall and failed — correctly: `plant` sits the grenade exactly on a
    # cell boundary, one tick of gravity drops it into the cell below, and the ray to a
    # body then passes UNDER a one-cell wall. The code was right and the test was
    # wrong; a wall in this game is a column of cells.
    # 236044 -> 236058 (+14) on 2026-08-13: the LOB is solved in the layer's frame.
    # A ballistic launch is one vector equation, v0 = delta/T - 0.5*a*T, and what
    # stood in spawn_projectile was that solution written out in a basis where `a` is
    # along -Z: sqrt(dx^2+dy^2) for the horizontal distance, dz for the vertical, and
    # the whole +0.5*g*T compensation on Z. projectile_step has integrated along the
    # real gravity vector since 2026-08-12, so the shot FLEW honestly and was AIMED in
    # the wrong frame — discipline applied unevenly inside one file.
    #   [lob] connected under all 6 directional gravity regimes
    # Mutation (hardcode up = +Z again) -> 5 red, one per non-NegZ regime, and NegZ
    # green because that is the frame the mutation assumes. That signature is the
    # evidence; a count of 6 or 1 would mean the test was measuring something else.
    # The FIRST version of it fired at 30000 mmps and the mutation left it GREEN: over
    # 12 m that is T = 0.17 s and a 0.09 m drop against a 0.75 m hit sphere, so the arc
    # was smaller than the target and the frame could not matter. 7000 mmps gives
    # T = 0.75 s and a 1.69 m drop. Latent, not live: kPadicGravity is NegZ and padic
    # is the only geometric module, so no shipping floor exercises it.
    # 236058 -> 236061 (+3) on 2026-08-13: Medical feeds the heal bank (hpBank),
    # IntentHeal graduated out of the refusal list. The +3 pin that a Medical
    # second lands in the BANK and only the bank, and that the rate is
    # percent-of-max (a 200-max body banks 2x — time-to-full is the same in-game
    # hour for everyone) (suite_rooms).
    # 236061 -> 240226 (+4165) on 2026-08-13: roles ([role.h]). The bulk is two
    # property loops — role_for determinism (64) and "a zero weight is a
    # prohibition": 4096 Residential draws with no Cultist — plus distribution,
    # delta-response and role-blindness checks (suite_utilai), and the field-mask
    # pins moving to affordance+role rooms (suite_rooms).
    # 240226 -> 240230 (+4) on 2026-08-13: AI/feud steering goes frame-generic.
    # The +4 pin the side-regime property (suite_faction2 §4b): under PosX the
    # feud steers in the (y, z) plane and the gravity-axis sentinel survives.
    # Mutation (revert to the .x/.y literal writes) -> red on the sentinel.
    # 240230 -> 240234 (+4) on 2026-08-14: seat claims (§27). The +4 pin the
    # attempt-rotation: a contested bathroom pan has a real second pan, two pans
    # wrap at attempt 2, unfurnished rooms rotate free cells, bounds hold
    # (suite_rooms). Attempt 0 is pinned as the old function by every prior call.
    # 240234 -> 240248 (+14) on 2026-08-14: patrol execution (ai_patrol_step).
    # The +14 pin: empty bake is a no-op not UB, the step attaches a plan /
    # claims the body / steers along the flow in the walking plane only, the
    # PosX gravity-axis sentinel survives (mutation: unconditional axis writes
    # -> 2 red), and an Ai-owned body is never re-steered (suite_utilai).
    # 240248 -> 240244 (-4) on 2026-08-14: craft axes 9 -> 8 ([craft.h] "The
    # eight axes"). A FALLING count, accounted for exactly: four per-axis CHECK
    # loops (suite_craft premise sums, its save round-trip and sanitize-clamp,
    # suite_saveload's SAVRPG bank compare) each run one fewer iteration. No
    # suite stopped running.
    # 240244 -> 240245 (+1) on 2026-08-16: §10 keycard pin flipped (suite_doors
    # test_inventory_keycard). The old 3-CHECK block pinned "one Key satisfies
    # every tier"; the new 4-CHECK block pins the tier comparison both ways
    # (grant 1/Red, deny Blue/Master). Net +1. Mutation RUN, not assumed: revert
    # door.cpp to the category-only `return true` -> exactly 2 red (the two
    # deny CHECKs), 240245 checks, 2 failures.
    # 240245 -> 240265 (+20) on 2026-08-16: экипировка-как-решение ([equip.h]).
    # The +20 pin the equip primitives block (suite_craft): the no-auto-equip
    # pins (a bag full of weapons + an empty decision = bare hands on the strict
    # read), decision recording per slot kind, rot-to-bare-hands, refusals.
    # Mutation RUN, not assumed: disable the strict branch in equipped_melee
    # (`if (false && eq)`) -> exactly 2 red, both on the no-auto-equip pins.
    # 240265 -> 240288 (+23) on 2026-08-16: wear mechanics ([equip.h]). The +23
    # pin: the durability column IS the lifetime (eternal refuses, one-use
    # ruins in one, frac/roll rows land within 2x of their column), ruin is
    # sticky, the two effect formulas' endpoints (60% damage / 20% resist
    # floors, mint identity), and a ruined vest blocking less than a mint one
    # through apply_damage + sync_armour (suite_craft, suite_needs). Mutations
    # RUN on the committed tree, both measured: wear_equipped -> early return
    # false = exactly 3 red (one-use, frac-row, roll-row lifetimes);
    # wear_resist_scale -> identity = exactly 3 red (both worn-vest deltas in
    # suite_needs + the 20%-floor endpoint pin).
    # 240288 -> 240298 (+10) on 2026-08-16: inventory_give — THE transfer
    # primitive (§39). The +10 pin: top-up-before-fresh with clamp, wear splits
    # stacks (law 1), a freed slot's stale wear byte cannot infect a fresh give
    # (law 2), a full grid returns the remainder undeleted. Mutations RUN, see
    # the commit for measured reds.
    # 240298 -> 240299 (+1) on 2026-08-16: the `inventory` keybind row (I ->
    # inventory grid, [inventory.md]). The +1 is the cross-table weld in
    # suite_keybind (every bind's command resolves via Console::find) running
    # over one more row — the weld checking the new bind is exactly what it
    # exists for.
    # 240299 -> 240300 (+1) on 2026-08-16: ad5f6d0d's suite_doors fix rides the
    # adapted pick — the silent `if (built == 0) return;` early-out (a test
    # that could pass by testing nothing) becomes CHECK(built > 0). One of the
    # fork's verified-good Problem 36 pieces.
    # 240300 -> 240327 (+27) on 2026-08-16: repair (suite_craft). The +27 pin:
    # exact per-axis half-price (funded exactly -> bank EMPTY after), one short
    # axis = whole refusal with bank and condition untouched, station refusal
    # before money, mint free success, eternal row NotRepairable. Mutation RUN
    # on the committed tree, measured: pricing /510 -> /255 (full price) =
    # exactly 3 red (the exactly-funded repair refuses whole: ok, condition
    # and empty-bank checks).
    # 240327 -> 240357 (+30) on 2026-08-16: the fork's gravity-regime scenario
    # block (suite_gravity_regimes) revived on our signatures — its earlier
    # segfault was the incomplete hand-built FineNav fixtures, fixed in the
    # wander wave; the one edit here is apply_damage's arity (his tree had a
    # trailing fluid param). Knockback under a gravity field, per-regime.
    # 240553 -> 240561 (+8) on 2026-08-17: test_ricochet — касание вскользь
    # отражается (нормаль/тангенс/урон/отжим/выживание, 7), в лоб гаснет (1).
    # 240357 -> 240553 (+196) on 2026-08-17: suite_audio — DSP-примитивы,
    # гейгер-пуассон, сирена С-40, эмбиент-гармоники, equal-power панорама,
    # окклюзия. Сьюта форка ПРОРЕЖЕНА: его 295k пер-сэмпловых NaN-ассертов
    # схлопнуты в аккумуляторы (один CHECK на цикл) — ратчет счётчика чеков
    # не должен обесцениваться буфером на 48k сэмплов. Mutation RUN: см. коммит.
    # 240584 -> 242646 (+2062) on 2026-08-17: рубль в items.csv (v14) — циклы
    # по каталогу шире на строку (все id-петли платят по чеку), PublicBox-тест
    # получил кассовые CHECK'и, и пины провода сейва/пула переехали на 5-байтовый
    # слот (u16 count). Ноль падений — закон пина неизменен.
    # 242646 -> 242828 (+182) on 2026-08-17: сейв v15 — opened-ключи заменены
    # записями (полный Container + трупы): раунд-трип сравнивает контент
    # пофилдово, e2e-перезаход проверяет вклад/частичный забор/труп.
    # 242828 -> 242761 (-67) on 2026-08-17: инкремент B — окно Vendor и его
    # тесты (test_vendor, suite_vendorammo) выпилены вместе с системой;
    # взамен suite_barter (законы сделки) + suite_conversation (меню NPC) +
    # test_barter_terms (спред) + бартер-шов в test_full_loop.
    # 242761 -> 242966 (+205) on 2026-08-17: карманы толпы (seed_pocket) —
    # тест рынка в suite_barter (вес-кап налички, безоружность, детерминизм).
    # 242966 -> 243026 (+60) on 2026-08-17: кости — первая игра-строка меню
    # разговора (suite_dice: ставка/жадный пакет/физрасчёт/сдача/детерминизм).
    # 243026 -> 243045 (+19) on 2026-08-17: банкир (инкремент C) — касса
    # teller banked<->монеты (клампы по счёту и сумке) + гейт «БАНК» на Duty.
    # 243045 -> 243565 (+520) on 2026-08-17: сейв v16 (SAVBANK) — счёт едет
    # целиком минус lastInterestTick; раунд-трип пофилдово + 24 строки кольца.
    # 243565 -> 243576 (+11) on 2026-08-17: light_bake — светоматериалы в
    # эмиттеры: пустой мир, полоса-кластер (центроид/радиус/цвет/интенсивность),
    # раздельные пятна, кластер через шов тора ([ddalight.md]).
    # 243627 -> 233695 (-9932) on 2026-08-18: потолочные лампы. Шаг раскладки
    # теперь ВЫВОДИТСЯ из радиуса лампочки в props.csv (одна на 8 клеток = 16 м,
    # делитель 128 — тайлится по тору без шва), вместо монетки 25% на КАЖДУЮ
    # потолочную клетку. Минус — почти весь: циклы по лампам в suite_props_game
    # и suite_light гоняли по 9112 штук на blame и по 25% полосы в фикстурах;
    # плюс три новых теста (пол под лампой, бутерброд-анкер). Число ламп: padic
    # 84 -> 11331, blame 9112 -> 3459 (лист 1538 штук на z=127 убран).
    # 233695 -> 235711 (+2016) там же: лампы лестниц padic спрашивают реальную
    # нижнюю грань потолка-бутерброда (sz=6), а не подслой 0 — 336 -> 1008 штук,
    # и циклы suite_props_game по ним стали длиннее.
    # 235711 -> 235756 (+45) on 2026-08-19: слияние лампового пина с
    # suite_walkbits (async-rebake фаза B, ветка verlet-walkbits-clean несла
    # 243672 от до-лампового дерева): бит-идентичность nav через WalkBits
    # против grid-пути (6), то же для room zones (27), патч==полный ребилд с
    # явной дивергенцией законов nav/тела на одной выбитой вокселе (12).
    # 235775 -> 235782 (+7) on 2026-08-19: suite_shotsub — репро асимметрии
    # карва (падик-сэндвич: removed вниз/вверх, обе пули гибнут — 4) плюс
    # «прострелил дыру насквозь» (аудит §1.1: жива, вышла с той стороны,
    # ничего не сколола — 3).
    # 235782 -> 235780 (-2) on 2026-08-19: смерть doors.frozen (асинк-ребейк
    # фаза C, [game/rebake.h]) — suite_doors терял ровно два чека «frozen
    # отказывает мутаторам»: гейта больше нет, воркер читает снапшот битсетов,
    # а не грид.
    # 235780 -> 235796 (+16) on 2026-08-19: suite_rebake — SLA-гейт допекания
    # (фаза D, план §7): Fresh-семантика (3) + свап (2), выбор стены (1),
    # stale-чтения до свапа живы (4), свап <= потолка 8192 тиков (2), после
    # свапа поле ведёт в проём (3), rooms-секция свапнулась (1).
    # 235796 -> 235825 (+29) on 2026-08-20: suite_watch — календарь S15
    # (такт 2^13 / вахта 2^16 / цикл 2^19 / эпоха 2^22, всё сдвигами):
    # такт ВЫВЕДЕН из прежнего игрового часа 7500 тиков как ближайшая 2^n (4),
    # каждый уровень ровно 8 предыдущих и лестница степенями двойки ещё и в
    # миллисекундах, потому что тик = 8 мс (8), сдвиг == деление на 18 пробах
    # включая границы уровней и потолок u64 — один CHECK на весь свип, чтобы
    # не раздувать пин (1), граница выводится СРАВНЕНИЕМ и случается ровно
    # раз на период: 64 такта / 8 вахт / 4 фазы / 1 цикл за цикл, стоящее
    # время границы не даёт (8), четыре фазы освещения тайлят цикл по две
    # вахты и заворачиваются вместе с ним (8).
    # 235825 -> 235845 (+20) on 2026-08-20: suite_lightvis — запечённая
    # видимость лампа->клетка (план light-visibility-bake, черри-пик 1736a311
    # с ветки от 235796; слагаемые независимы от suite_watch, сумма сходится):
    # закон «твёрд = только mask.full() и не эмиттер» (5), вывод rDirty из
    # R_max (3), пин бит-идентичности бейка при 1 и 2 потоках + оракул «не
    # потерять свет» на реальном этаже с обратной полярностью — нарочно
    # сломанный флуд обязан терять (7), мгновенность карва: дренаж метит тем
    # же вызовом, фолбэк видит лампу, ребейк вписывает (5).
    # 235845 -> 235848 (+3) on 2026-08-20: свет стал субвоксельным (S2, замер
    # «сквозь стены»): закон твёрдости теперь на живых лучах light_ray_passes
    # и вырос на кейс «замурованная лампа светит» (5 -> 6, +1); обратная
    # полярность оракула переехала со случайного этажа на построенную сцену
    # «стена со щелью» — детерминированный красный на мутации «партиал =
    # монолит» (3 новых чека), взамен вероятностного lostBad > 0 (-1).
    # 236578 -> 236579 (+1) on 2026-08-21: spawn_ball на рагдолл-ядре
    # ([markoaudit/plans/ragdoll.md] инкремент 1) — GravityAffected-чек стал
    # RigidBody-чеком (0), новый чек SelfIntegrating (+1): без тега physics_step
    # двигал бы тело вторым разом — та же двойная скорость, что была у снарядов.
    # 236579 -> 236582 (+3) on 2026-08-21: линк с мировым якорем идёт через
    # ЕДИНУЮ якорную систему (ragdoll.md §8, решение владельца): линк-сущность
    # несёт SubVoxelAnchor, anchor_validate_step рвёт подвес по смерти опоры
    # (обе полярности + пробуждение спящей стороны).
        PASS_REGULAR_EXPRESSION "game_test: 236582 checks, 0 failures")

    # Opaque-box E2E scenario suite (форк ce066615, переавторено под наши
    # сигнатуры). Счётчик НЕ пинится намеренно: сценарные тесты добавляются
    # пачками, их дрейф ловит game_test-пин; здесь пин — ноль падений.
    add_executable(e2e_test tests/e2e_test.cpp)
    target_link_libraries(e2e_test PRIVATE giga_game)
    giga_target_flags(e2e_test OFF)
    add_test(NAME e2e_test COMMAND e2e_test)
    set_tests_properties(e2e_test PROPERTIES
        PASS_REGULAR_EXPRESSION "e2e_test: [0-9]+ checks, 0 failures")



    # Text gate for the AGENTS.md rules that no compiler enforces on every host.
    # The load-bearing one is no-exceptions: MSVC's STL is unsupported under
    # _HAS_EXCEPTIONS=0, so Windows compiles /EHsc and a `throw` would fail only
    # the macOS build — the defect would ship to the other host. This makes both
    # hosts reject it. Also covers no-RTTI, the GLM/Eigen ban, and the layering
    # invariant that giga_core and giga_game never include SDL/Vulkan/ImGui.
    # Rationale, known limits and the `giga-check: allow` escape hatch live in
    # tools/check_source_rules.cmake. Needs no build, so it is cheap and runs first.
    #
    # Pinned to its last printed line instead of its exit code — the count as a FLOOR,
    # not an exact count, and that difference is deliberate rather than lazy.
    # `files_scanned=N` is the final statement of the script and is reached only after
    # the zero-violations verdict, so matching it proves the run completed AND found
    # nothing: any violation raises FATAL_ERROR and the line is never printed. The
    # three-digit class then puts a floor of 100 under the scanned set, which upgrades
    # the script's own `EQUAL 0` guard — a broken glob that silently scans four files is
    # green today and red here. OBSERVED 2026-07-29: `files_scanned=167`.
    #
    # The count ALONE was the whole pin until 2026-08-12, and Docs/specs/05 §2.1 was
    # right to call that a gate you cannot fail: it asserted that the script ran, never
    # that it found nothing. Swap the FATAL_ERROR for a WARNING and every rule in the
    # file goes dark while ctest stays green, because a three-digit count still prints.
    # So the verdict token is now pinned beside the count. It is one regex and not two
    # because CTest ORs a list of PASS_REGULAR_EXPRESSIONs — two entries would mean
    # "either", i.e. strictly weaker than what is here; hence the script emits both
    # tokens on one line so a single regex can demand both.
    #
    # This does NOT make the pin sufficient on its own, and the honest limit belongs
    # here rather than in a commit message: the pin still cannot tell a rule that found
    # nothing from a rule that inspects nothing (§2.2's `://` truncation is exactly
    # that, and stays a known false negative). Reverse-polarity mutation is what proves
    # the gate bites, and it is run by hand.
    #
    # Running it is not a formality — it is what exposed, on 2026-08-12, that the whole
    # script had been reading only the first line or two of every file since it was
    # written. A `throw` planted at the TOP of src/sim/physics.cpp was caught; the same
    # `throw` at line 3, 20, 40, or appended at EOF was not, in three different files.
    # Cause and repair are documented at length in tools/check_source_rules.cmake
    # (CMake stops splitting a list at the first `[`). AFTER the repair, measured the
    # same day: wrap.h:40 and physics.cpp:302 both reported, at the exact line, and the
    # clean tree gives GIGA_SOURCE_RULES=PASS files_scanned=245 in ~12 s.
    #
    # So: re-run the mutation whenever this script is edited, and plant it in the
    # MIDDLE of a file, never at the top. A gate that has never failed is
    # indistinguishable from a gate that does not work, and this one was the latter for
    # its entire life while printing a three-digit file count every run.
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
        PASS_REGULAR_EXPRESSION "GIGA_SOURCE_RULES=PASS files_scanned=[0-9][0-9][0-9]")

    # A system that exists and nothing calls. Text gate, no compiler, same shape as
    # source_rules above — and lifted, with two holes closed, from the one commit of
    # marko1olo's 39 that survived review (2026-08-13; the other 38 are recorded in
    # problems.md §51-53 and the branch is kept at tag marko1olo-main-2026-08-13).
    #
    # `entry_points=` is pinned as a RANGE and not an exact count, for the reason
    # source_rules gives above: src/ is GLOB_RECURSE, so an exact number would be a
    # merge conflict on every new `*_step` and would train the reflex of retyping it.
    # What the pin has to catch is the gate going blind — a scan that finds ZERO entry
    # points would still print PASS, and two digits is what forbids that.
    add_test(NAME wired
        COMMAND ${CMAKE_COMMAND} -DGIGA_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
                -P ${CMAKE_CURRENT_SOURCE_DIR}/tools/check_wired.cmake)
    set_tests_properties(wired PROPERTIES
        PASS_REGULAR_EXPRESSION "GIGA_WIRED=PASS entry_points=[0-9][0-9]")

    # Honest crowd benchmark: real floor + 16k wandering agents + real physics.
    # An executable, not a ctest (it measures, it doesn't pass/fail). Runs at the
    # global Release -O3 so the numbers reflect an optimized build. Threads come
    # in transitively via giga_core now; kept explicit here to document the need.
    # X-Ray blueprint: оффлайн-карты этажа (структура/зоны/популяция/нав/
    # опасность/пропсы) в PNG — диагностика генератора и алайфа без запуска
    # игры. Порт форка 16004b86, адаптирован к тору 128^3.
    add_executable(xray_map tools/xray_map.cpp)
    target_link_libraries(xray_map PRIVATE giga_game Threads::Threads)
    giga_target_flags(xray_map OFF)

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
