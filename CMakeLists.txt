cmake_minimum_required(VERSION 3.20)
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
#   - SDL3, Vulkan, MoltenVK  -> system (Homebrew) via find_package
#   - EnTT, Dear ImGui        -> pinned via FetchContent
# No GLM: the engine ships its own dependency-free math in src/core/math.h.
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
endif()

# Link-time optimization for optimized configs.
include(CheckIPOSupported)
check_ipo_supported(RESULT _giga_ipo OUTPUT _giga_ipo_msg)
if(_giga_ipo)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE ON)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELWITHDEBINFO ON)
endif()

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
find_package(SDL3 REQUIRED CONFIG)
find_package(Vulkan REQUIRED)

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
file(GLOB_RECURSE GIGA_CORE_SOURCES CONFIGURE_DEPENDS
    src/world/*.cpp src/sim/*.cpp src/ecs/*.cpp)

add_library(giga_core STATIC ${GIGA_CORE_SOURCES})
target_include_directories(giga_core PUBLIC ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(giga_core PUBLIC EnTT::EnTT)
target_compile_definitions(giga_core PUBLIC ENTT_NOEXCEPTION)
if(NOT MSVC)
    target_compile_options(giga_core PRIVATE
        -Wall -Wextra -Wno-unused-parameter -fno-rtti -fno-exceptions)
endif()

# ---- Game layer library ---------------------------------------------------
# Gameplay macro-systems (NPC pool, event bus, inventory, mob table) layered on
# top of the game-agnostic core. Kept as its own lib so headless tests can link
# and exercise it without SDL/Vulkan, and so the engine core stays pure.
file(GLOB_RECURSE GIGA_GAME_SOURCES CONFIGURE_DEPENDS src/game/*.cpp)
add_library(giga_game STATIC ${GIGA_GAME_SOURCES})
target_include_directories(giga_game PUBLIC ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(giga_game PUBLIC giga_core)
if(NOT MSVC)
    target_compile_options(giga_game PRIVATE
        -Wall -Wextra -Wno-unused-parameter -fno-rtti -fno-exceptions)
endif()

# ---- Shader compilation (GLSL -> SPIR-V) ----------------------------------
set(_giga_spv_dir ${CMAKE_BINARY_DIR}/shaders)
file(MAKE_DIRECTORY ${_giga_spv_dir})
set(_giga_spv_files "")
foreach(_sh cube.vert cube.frag body.vert)
    add_custom_command(
        OUTPUT ${_giga_spv_dir}/${_sh}.spv
        COMMAND ${Vulkan_GLSLC_EXECUTABLE} -O
            ${CMAKE_SOURCE_DIR}/shaders/${_sh}
            -o ${_giga_spv_dir}/${_sh}.spv
        DEPENDS ${CMAKE_SOURCE_DIR}/shaders/${_sh}
        COMMENT "glslc ${_sh}")
    list(APPEND _giga_spv_files ${_giga_spv_dir}/${_sh}.spv)
endforeach()
add_custom_target(giga_shaders DEPENDS ${_giga_spv_files})

# ---- Rendering + app shell ------------------------------------------------
file(GLOB GIGA_RENDER_SOURCES CONFIGURE_DEPENDS src/render/*.cpp)
file(GLOB GIGA_APP_SOURCES CONFIGURE_DEPENDS src/app/*.cpp src/input/*.cpp)

add_executable(gigahrush2 ${GIGA_APP_SOURCES} ${GIGA_RENDER_SOURCES}
    ${IMGUI_SOURCES})
add_dependencies(gigahrush2 giga_shaders)
target_include_directories(gigahrush2 PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
target_compile_definitions(gigahrush2 PRIVATE
    GIGA_SHADER_DIR="${_giga_spv_dir}")
target_link_libraries(gigahrush2 PRIVATE giga_game giga_core SDL3::SDL3 Vulkan::Vulkan)
if(NOT MSVC)
    # ImGui uses exceptions/RTTI-free is fine, but the SDL3/Vulkan backends and
    # our render code do not rely on either. Keep the whole binary lean.
    target_compile_options(gigahrush2 PRIVATE
        -Wall -Wextra -Wno-unused-parameter)
endif()

# ---- Tests ----------------------------------------------------------------
if(GIGA_BUILD_TESTS)
    enable_testing()
    add_executable(world_test tests/world_test.cpp)
    target_link_libraries(world_test PRIVATE giga_core)
    if(NOT MSVC)
        target_compile_options(world_test PRIVATE -fno-rtti -fno-exceptions)
    endif()
    add_test(NAME world_test COMMAND world_test)

    add_executable(game_test tests/game_test.cpp)
    target_link_libraries(game_test PRIVATE giga_game)
    if(NOT MSVC)
        target_compile_options(game_test PRIVATE -fno-rtti -fno-exceptions)
    endif()
    add_test(NAME game_test COMMAND game_test)
endif()
