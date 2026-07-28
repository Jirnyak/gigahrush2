# Mechanical enforcement of the AGENTS.md source rules that no compiler on this
# host can enforce.
#
# WHY THIS EXISTS
# ---------------
# AGENTS.md mandates no exceptions and no RTTI. On Clang/GCC the compiler enforces
# both (-fno-exceptions -fno-rtti). On MSVC only RTTI ports across (/GR-): the STL
# is unsupported under _HAS_EXCEPTIONS=0, so the Windows build compiles /EHsc and
# the no-throw rule degrades to code discipline. Consequence, before this check
# existed: add a `throw` and the Windows build stays green while the macOS build
# fails — the defect ships to the other host. See tools/win/README.md §1.
#
# This script closes that gap. It is a text gate, not a compiler, so it also
# covers the layering invariants a compiler would only catch as a link error much
# later.
#
# RUN IT
# ------
#   cmake -P tools/check_source_rules.cmake
#   cmake -DGIGA_ROOT=/path/to/repo -P tools/check_source_rules.cmake
#
# It is registered as the ctest `source_rules`, so `ctest` and
# `tools\win\build.bat` both run it. If `source_rules` is missing from your ctest
# listing, the add_test() wiring in CMakeLists.txt was lost — re-add it rather
# than assuming the rules are still enforced.
#
# ESCAPE HATCH
# ------------
# A line containing the literal `giga-check: allow` is skipped. Use it for a
# genuine false positive (a banned word inside a string literal or a /* */ block)
# and say why on the same line. It is greppable on purpose: `rg "giga-check"`
# lists every exemption in the tree.
#
# KNOWN LIMITS (honest, not hidden)
# ---------------------------------
# `//` comments are stripped and lines opening with `*` are skipped, so ordinary
# doc comments are safe. Full /* */ state is NOT tracked, and string literals are
# not parsed. A banned token inside a block comment or a string will be flagged;
# that is a deliberate false-positive-over-false-negative choice. Use the escape
# hatch.

cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    get_filename_component(GIGA_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

set(GIGA_FAILURES "")
set(GIGA_FILES_SCANNED 0)

# Emulated word boundary: the line is padded with one space on each side, then a
# token is bracketed by a non-identifier character. This is what keeps
# `try_emplace`, `entry`, `geometry` and `TryGet` from tripping the `try` rule.
set(GIGA_TOKEN_LHS "[^A-Za-z0-9_]")
set(GIGA_TOKEN_RHS "[^A-Za-z0-9_]")

# Read a file into a real list of lines, safely.
#
# file(STRINGS) is unusable here and the reason is worth writing down: it extracts
# printable-ASCII runs, so a non-ASCII byte ends the current "string" and starts a
# new element. src/game/item_table.cpp carries 6608 UTF-8 Cyrillic lead bytes, so
# one source line arrived as several list elements and every line number after it
# drifted — measured, data/items.csv reported 2465 rows instead of 446. Separately,
# `;` is CMake's list separator, so a line containing one would split as well.
# Both are neutralised here.
macro(_giga_read_lines _path _out)
    file(READ "${_path}" _giga_raw)
    string(REPLACE ";" "@GIGA_SEMI@" _giga_raw "${_giga_raw}")
    string(REPLACE "\r" "" _giga_raw "${_giga_raw}")
    string(REPLACE "\n" ";" _giga_raw "${_giga_raw}")
    set(${_out} "${_giga_raw}")
endmacro()

# _giga_scan(<file-list-var> <regex> <message>)
macro(_giga_scan _list_var _regex _message)
    foreach(_file IN LISTS ${_list_var})
        _giga_read_lines("${_file}" _lines)
        set(_lineno 0)
        foreach(_raw IN LISTS _lines)
            math(EXPR _lineno "${_lineno} + 1")

            # Skip explicit exemptions.
            string(FIND "${_raw}" "giga-check: allow" _exempt)
            if(_exempt GREATER_EQUAL 0)
                continue()
            endif()

            # Skip continuation lines of a doc block ( * ... ).
            string(STRIP "${_raw}" _stripped)
            if(_stripped MATCHES "^\\*")
                continue()
            endif()

            # Drop a trailing // comment.
            string(FIND "${_raw}" "//" _slash)
            if(_slash EQUAL 0)
                continue()
            elseif(_slash GREATER 0)
                string(SUBSTRING "${_raw}" 0 ${_slash} _raw)
            endif()

            if(" ${_raw} " MATCHES "${_regex}")
                file(RELATIVE_PATH _rel "${GIGA_ROOT}" "${_file}")
                # A `;` inside the message would be read as a list separator and
                # split one finding across two output lines. Neutralise it here so
                # future messages cannot reintroduce the bug.
                string(REPLACE ";" "," _safe_message "${_message}")
                list(APPEND GIGA_FAILURES "${_rel}:${_lineno}: ${_safe_message}")
            endif()
        endforeach()
    endforeach()
endmacro()

# ---- File sets -------------------------------------------------------------
# giga_core: the headless, dependency-free simulation substrate.
file(GLOB_RECURSE GIGA_CORE_FILES
    "${GIGA_ROOT}/src/world/*.cpp" "${GIGA_ROOT}/src/world/*.h"
    "${GIGA_ROOT}/src/sim/*.cpp"   "${GIGA_ROOT}/src/sim/*.h"
    "${GIGA_ROOT}/src/ecs/*.cpp"   "${GIGA_ROOT}/src/ecs/*.h"
    "${GIGA_ROOT}/src/core/*.cpp"  "${GIGA_ROOT}/src/core/*.h")

# giga_game: the game layer. Links core, must stay headless-testable.
file(GLOB_RECURSE GIGA_GAME_FILES
    "${GIGA_ROOT}/src/game/*.cpp" "${GIGA_ROOT}/src/game/*.h")

file(GLOB_RECURSE GIGA_ALL_FILES
    "${GIGA_ROOT}/src/*.cpp" "${GIGA_ROOT}/src/*.h"
    "${GIGA_ROOT}/tests/*.cpp" "${GIGA_ROOT}/tests/*.h")

list(LENGTH GIGA_ALL_FILES GIGA_FILES_SCANNED)
if(GIGA_FILES_SCANNED EQUAL 0)
    message(FATAL_ERROR
        "check_source_rules: scanned 0 files under ${GIGA_ROOT}/src. "
        "Wrong GIGA_ROOT, or the layout moved — a check that silently sees "
        "nothing is worse than no check.")
endif()

# ---- Rule 1: no exceptions (the one MSVC cannot enforce) --------------------
_giga_scan(GIGA_ALL_FILES "${GIGA_TOKEN_LHS}throw${GIGA_TOKEN_RHS}"
    "`throw` is banned (AGENTS.md: No exceptions). MSVC compiles /EHsc and will NOT catch this — the macOS build would. Return a status or assert instead.")
_giga_scan(GIGA_ALL_FILES "${GIGA_TOKEN_LHS}catch${GIGA_TOKEN_RHS}"
    "`catch` is banned (AGENTS.md: No exceptions). The tree is built -fno-exceptions on Clang/GCC.")
_giga_scan(GIGA_ALL_FILES "${GIGA_TOKEN_LHS}try${GIGA_TOKEN_RHS}"
    "`try` block is banned (AGENTS.md: No exceptions). Note `try_emplace`/`try_lock` are fine and do not match this rule.")

# ---- Rule 2: no RTTI -------------------------------------------------------
_giga_scan(GIGA_ALL_FILES "${GIGA_TOKEN_LHS}dynamic_cast${GIGA_TOKEN_RHS}"
    "`dynamic_cast` is banned (AGENTS.md: No RTTI). Use the type_tag<T>() pattern in src/world/field.h.")
_giga_scan(GIGA_ALL_FILES "${GIGA_TOKEN_LHS}typeid${GIGA_TOKEN_RHS}"
    "`typeid` is banned (AGENTS.md: No RTTI). Use the type_tag<T>() pattern in src/world/field.h.")

# ---- Rule 3: core ships its own math --------------------------------------
_giga_scan(GIGA_ALL_FILES "include[ \t]*[<\"]glm/"
    "GLM is banned. giga_core ships its own math in src/core/math.h (AGENTS.md: Core stays dependency-free).")
_giga_scan(GIGA_ALL_FILES "include[ \t]*[<\"]Eigen/"
    "Eigen is banned. giga_core ships its own math in src/core/math.h (AGENTS.md: Core stays dependency-free).")

# ---- Rule 4: giga_core must not see the platform --------------------------
_giga_scan(GIGA_CORE_FILES "include[ \t]*[<\"](SDL3?/|vulkan/|imgui|GLFW/)"
    "giga_core (src/world, src/sim, src/ecs, src/core) must not include SDL, Vulkan, ImGui or GLFW — that is what keeps the sim headless-testable and embeddable (AGENTS.md: Core stays dependency-free).")

# ---- Rule 5: giga_game must stay headless --------------------------------
_giga_scan(GIGA_GAME_FILES "include[ \t]*[<\"](SDL3?/|vulkan/|imgui|GLFW/)"
    "src/game (giga_game) must not include platform headers — the society sim has to run without a GPU via game_test (AGENTS.md: Gameplay macro-systems live in giga_game).")

# ---- Rule 6: no UTF-8 BOM --------------------------------------------------
# /utf-8 became load-bearing the moment the content tables landed: measured
# 2026-07-28, src/game/item_table.cpp carries 6608 UTF-8 Cyrillic lead bytes and
# mob_table.cpp 644, across 47 files with non-ASCII content. With the source
# charset pinned by /utf-8 a BOM buys nothing, and it breaks glslc and any tool
# expecting a bare prefix. Same measurement found 82 source files with 0 invalid
# UTF-8 sequences and 0 BOMs — this rule is what keeps that true.
file(GLOB_RECURSE GIGA_BOM_FILES
    "${GIGA_ROOT}/src/*.cpp" "${GIGA_ROOT}/src/*.h"
    "${GIGA_ROOT}/tests/*.cpp" "${GIGA_ROOT}/tests/*.h"
    "${GIGA_ROOT}/shaders/*.vert" "${GIGA_ROOT}/shaders/*.frag"
    "${GIGA_ROOT}/shaders/*.comp")
foreach(_file IN LISTS GIGA_BOM_FILES)
    file(READ "${_file}" _head LIMIT 3 HEX)
    if(_head STREQUAL "efbbbf")
        file(RELATIVE_PATH _rel "${GIGA_ROOT}" "${_file}")
        list(APPEND GIGA_FAILURES
            "${_rel}:1: UTF-8 BOM. Save as UTF-8 without BOM — /utf-8 already pins the source charset, see tools/win/README.md section 4.")
    endif()
endforeach()

# ---- Rule 7: generated content tables must match their CSV -----------------
# src/game/item_table.cpp and mob_table.cpp are GENERATED from data/*.csv by
# tools/gen_*_table.py. The compiler cannot see CSV drift: edit a CSV, forget to
# re-run the generator, and the build stays green on a table that no longer
# matches the data. `mob_table.h` carries a static_assert against a literal 69,
# which guards a hand-edit of the generated file but says nothing about the CSV.
# This rule closes that: CSV data rows must equal the count the header declares.
#
# Assumes one row per line (no quoted embedded newlines). That holds today —
# items.csv is 447 lines for 446 items — and if it ever stops holding, this check
# reports a mismatch, which is the outcome you want: someone looks.
#
# _giga_csv_vs_header(<csv> <header> <count-regex> <label>)
macro(_giga_csv_vs_header _csv _header _regex _label)
    if(EXISTS "${GIGA_ROOT}/${_csv}" AND EXISTS "${GIGA_ROOT}/${_header}")
        _giga_read_lines("${GIGA_ROOT}/${_csv}" _csv_lines)
        set(_rows 0)
        foreach(_l IN LISTS _csv_lines)
            string(STRIP "${_l}" _ls)
            if(NOT _ls STREQUAL "")
                math(EXPR _rows "${_rows} + 1")
            endif()
        endforeach()
        math(EXPR _rows "${_rows} - 1")   # drop the CSV header row

        file(READ "${GIGA_ROOT}/${_header}" _hdr)
        if(_hdr MATCHES "${_regex}")
            set(_declared "${CMAKE_MATCH_1}")
            if(NOT _declared EQUAL _rows)
                list(APPEND GIGA_FAILURES
                    "${_header}:1: ${_label} count drift — ${_csv} has ${_rows} data rows but the generated header declares ${_declared}. Re-run the generator in tools/ and commit the regenerated table. Never hand-edit the generated .cpp.")
            endif()
        else()
            list(APPEND GIGA_FAILURES
                "${_header}:1: ${_label} count declaration not found — the generator's output shape changed, so this drift check is now blind. Fix the regex in tools/check_source_rules.cmake rather than deleting the rule.")
        endif()
    endif()
endmacro()

_giga_csv_vs_header("data/items.csv" "src/game/item_table.h"
    "kItemCount[ \t]*=[ \t]*([0-9]+)" "item")
_giga_csv_vs_header("data/mobs.csv" "src/game/mob_table.h"
    "kMobKindCount[ \t]*==[ \t]*([0-9]+)" "mob kind")
# Melee weapons were shipping OUTSIDE this gate — a third generated table with the
# same drift hazard as the other two and none of the protection. Add every new
# CSV-generated table here at the same time as the generator, not afterwards.
_giga_csv_vs_header("data/weapons_melee.csv" "src/game/weapon_table.h"
    "kMeleeCount[ \t]*=[ \t]*([0-9]+)" "melee weapon")

# ---- Verdict ---------------------------------------------------------------
list(LENGTH GIGA_FAILURES GIGA_FAILURE_COUNT)
if(GIGA_FAILURE_COUNT GREATER 0)
    message("GIGA_SOURCE_RULES=FAIL")
    foreach(_f IN LISTS GIGA_FAILURES)
        message("- ${_f}")
    endforeach()
    message(FATAL_ERROR
        "${GIGA_FAILURE_COUNT} source-rule violation(s). These are AGENTS.md hard "
        "rules; fix the code, do not weaken the check. For a genuine false "
        "positive add `giga-check: allow` on the line with a reason.")
endif()

message("GIGA_SOURCE_RULES=PASS")
message("files_scanned=${GIGA_FILES_SCANNED}")
