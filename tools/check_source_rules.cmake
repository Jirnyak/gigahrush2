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
#
# ONE known FALSE NEGATIVE, which is the opposite bias and so worth naming: the
# line is truncated at the FIRST `//`, including a `//` inside a string literal.
# `const char* u = "http://x"; throw y;` therefore hides its `throw`. Checked
# 2026-07-29 — no line in src/ or tests/ has a banned token after a `://`, so this
# is latent, not live. Fixing it means not truncating on `://`, or parsing string
# literals; do not "fix" it by deleting the truncation, which would flag every
# doc comment in the tree.

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
# EXTENSIONS: .cpp, .h AND .inl. The .inl arrived late and was the biggest hole
# this gate ever had. tests/*.inl is not a marginal file type here — it is where
# the bulk of the test code lives: measured 2026-07-29, 18 files, ~530 KB, 10468
# lines, every one of them compiled into game_test via #include and NONE of them
# scanned. Every rule below was bypassed there, including the no-exceptions rule
# that MSVC cannot enforce, which is the whole reason this script exists. So the
# rule for the file sets is: match by C++ *translation content*, not by the
# habitual extension pair. A new extension (.ipp, .hpp, .tcc) belongs in every
# glob here on the day it lands, not after the next audit finds it.
#
# giga_core: the headless, dependency-free simulation substrate.
file(GLOB_RECURSE GIGA_CORE_FILES
    "${GIGA_ROOT}/src/world/*.cpp" "${GIGA_ROOT}/src/world/*.h" "${GIGA_ROOT}/src/world/*.inl"
    "${GIGA_ROOT}/src/sim/*.cpp"   "${GIGA_ROOT}/src/sim/*.h"   "${GIGA_ROOT}/src/sim/*.inl"
    "${GIGA_ROOT}/src/ecs/*.cpp"   "${GIGA_ROOT}/src/ecs/*.h"   "${GIGA_ROOT}/src/ecs/*.inl"
    "${GIGA_ROOT}/src/core/*.cpp"  "${GIGA_ROOT}/src/core/*.h"  "${GIGA_ROOT}/src/core/*.inl")

# giga_game: the game layer. Links core, must stay headless-testable.
file(GLOB_RECURSE GIGA_GAME_FILES
    "${GIGA_ROOT}/src/game/*.cpp" "${GIGA_ROOT}/src/game/*.h"
    "${GIGA_ROOT}/src/game/*.inl")

file(GLOB_RECURSE GIGA_ALL_FILES
    "${GIGA_ROOT}/src/*.cpp" "${GIGA_ROOT}/src/*.h" "${GIGA_ROOT}/src/*.inl"
    "${GIGA_ROOT}/tests/*.cpp" "${GIGA_ROOT}/tests/*.h" "${GIGA_ROOT}/tests/*.inl")

list(LENGTH GIGA_ALL_FILES GIGA_FILES_SCANNED)
if(GIGA_FILES_SCANNED EQUAL 0)
    message(FATAL_ERROR
        "check_source_rules: scanned 0 files under ${GIGA_ROOT}/src. "
        "Wrong GIGA_ROOT, or the layout moved — a check that silently sees "
        "nothing is worse than no check.")
endif()

# ---- Guard: no C++ file may sit outside the scanned set --------------------
# The .inl hole was silent for as long as it existed: nothing here objected to
# 18 files of unscanned C++, because the gate only ever knew about the two
# extensions somebody typed in 2026-07-28. Fixing the instance (.inl above) does
# not fix the class, so this fails the check the moment a C++ file with any other
# conventional extension appears under src/ or tests/ and is therefore invisible
# to a rule that ought to see it.
#
# THREE file sets need guarding, not one. GIGA_ALL_FILES drives rules 1-3 and 6;
# GIGA_CORE_FILES and GIGA_GAME_FILES drive the layering rules 4 and 5. Guarding
# only GIGA_ALL_FILES rebuilds the same hole one level down: add `.ipp` to
# GIGA_ALL_FILES alone and the guard goes quiet while the layering rules stay
# blind to every `.ipp` under src/world and src/game. So each of the three sets
# is cross-checked separately, and the finding names the set that is blind.
#
# The extension list is POSITIVE and lives here ONCE — only C++-shaped
# extensions — so adding docs, CSVs or scripts under tests/ cannot trip it, and
# there is no second copy of the list to forget. Copy-pasted extension lists are
# what produced the .inl hole; one list plus a loop is the fix for the class.
#
# Do NOT add upper-case spellings (.H, .CPP). Measured 2026-07-29 on this
# Windows host: cmsys::Glob is case-INSENSITIVE here, so `*.h` already matches
# `UPPER.H`, and adding `*.H` would match the same file twice — doubling
# files_scanned and scanning every line twice. Whether the macOS host globs
# case-sensitively was NOT measured; if it does, a `Foo.H` there is invisible to
# both the scan and this guard. No such file exists in the tree today.
#
# Measured 2026-07-29, src/ and tests/ contain exactly three extensions —
# .cpp, .h, .inl — and all three are globbed above, so this guard is silent
# today by construction. When it does fire, the fix is one glob pattern in the
# File sets block above, never deleting the guard.
set(GIGA_CXX_EXTS cpp cc cxx c++ h hpp hh hxx inl ipp tcc ixx cppm)

# _giga_cxx_candidates(<out-var> <dir>...)
# Every C++-shaped file under the given repo-relative dirs, recursively.
macro(_giga_cxx_candidates _out)
    set(_giga_pats "")
    foreach(_giga_dir IN ITEMS ${ARGN})
        foreach(_giga_ext IN LISTS GIGA_CXX_EXTS)
            list(APPEND _giga_pats "${GIGA_ROOT}/${_giga_dir}/*.${_giga_ext}")
        endforeach()
    endforeach()
    file(GLOB_RECURSE ${_out} ${_giga_pats})
endmacro()

# _giga_require_covered(<candidates-var> <scanned-var> <set-name> <what-it-drives>)
macro(_giga_require_covered _cands _scanned _set_name _what)
    foreach(_cand IN LISTS ${_cands})
        list(FIND ${_scanned} "${_cand}" _in_scan)
        if(_in_scan LESS 0)
            file(RELATIVE_PATH _rel "${GIGA_ROOT}" "${_cand}")
            list(APPEND GIGA_FAILURES
                "${_rel}:1: this C++ file is invisible to ${_set_name} (${_what}) — its extension is missing from that glob in the File sets block of tools/check_source_rules.cmake. That is how tests/*.inl bypassed every rule (throw, catch, try, dynamic_cast, typeid, GLM/Eigen, BOM) for its entire life. Add the extension to EVERY glob in that block plus GIGA_CXX_EXTS, then re-run.")
        endif()
    endforeach()
endmacro()

_giga_cxx_candidates(GIGA_TU_CANDIDATES src tests)
_giga_require_covered(GIGA_TU_CANDIDATES GIGA_ALL_FILES "GIGA_ALL_FILES"
    "the no-exceptions, no-RTTI, GLM/Eigen and BOM rules")

_giga_cxx_candidates(GIGA_CORE_CANDIDATES src/world src/sim src/ecs src/core)
_giga_require_covered(GIGA_CORE_CANDIDATES GIGA_CORE_FILES "GIGA_CORE_FILES"
    "the giga_core no-platform-header rule")

_giga_cxx_candidates(GIGA_GAME_CANDIDATES src/game)
_giga_require_covered(GIGA_GAME_CANDIDATES GIGA_GAME_FILES "GIGA_GAME_FILES"
    "the giga_game headless rule")

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
    "${GIGA_ROOT}/src/*.cpp" "${GIGA_ROOT}/src/*.h" "${GIGA_ROOT}/src/*.inl"
    "${GIGA_ROOT}/tests/*.cpp" "${GIGA_ROOT}/tests/*.h" "${GIGA_ROOT}/tests/*.inl"
    "${GIGA_ROOT}/shaders/*.vert" "${GIGA_ROOT}/shaders/*.frag"
    "${GIGA_ROOT}/shaders/*.comp" "${GIGA_ROOT}/shaders/*.glsl")
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
# And the very next table did exactly what the note above warns against: ranged
# weapons shipped outside this gate. Found by an audit, not by the gate — which is the
# whole argument for the gate.
_giga_csv_vs_header("data/weapons_ranged.csv" "src/game/ranged_table.h"
    "kRangedCount[ \t]*=[ \t]*([0-9]+)" "ranged weapon")
# Fourth generated table, added in the same change as tools/gen_material_surface.py
# rather than after it — the note above has been the pattern twice and the cost was an
# audit both times. Two things are unlike the other three:
#
#   * the generated file is GLSL, not C++. This macro only does file(READ) + regex, so
#     the language is irrelevant; what matters is that the count lives in the output.
#   * the declared count is kMaterialCsvRows, the number of PHOTOGRAPHS read, and NOT
#     the material count. Those are unrelated numbers that both happen to be 16 today,
#     and only 6 of the 16 rows are consumed. Matching against the array length
#     instead would make this rule pass while blind to a re-harvest.
_giga_csv_vs_header("data/materials.csv" "shaders/material_surface.glsl"
    "kMaterialCsvRows[ \t]*=[ \t]*([0-9]+)" "material surface")
# Props table (jirnyak.md §21) — same drift hazard as items/mobs/weapons.
_giga_csv_vs_header("data/props.csv" "src/game/prop_table.h"
    "kPropCount[ \t]*=[ \t]*([0-9]+)" "prop")


# ---- Verdict ---------------------------------------------------------------
# ---- Guard: every test suite must be compiled by somebody ------------------
# A `tests/suite_*.inl` reaches a compiler only if some `tests/*.cpp` names it in
# an `#include`, and it reaches ctest only if its `test_*_all()` entry point is
# actually called. Neither is enforced by the build, and nothing else in this
# file could notice: the globs above happily SCAN an .inl that no translation
# unit parses, so a dead suite satisfies every rule here while asserting nothing.
#
# Not hypothetical, and the instance is worse than the WILL_FAIL defect that
# prompted this audit. `tests/suite_navcache.inl` is 733 lines with 104 CHECK
# sites and was born dead: commit 56c9c6a added src/game/nav_cache.cpp,
# src/game/nav_cache.h and the suite, and did NOT touch tests/game_test.cpp, so
# the `#include` was never written. That commit's subject says "pinned".
# CORRECTED 2026-07-29: an earlier version of this comment said "floor_stream.cpp
# calls nav_cache on every floor load". That is FALSE and it was the whole
# justification for the urgency. src/game/floor_stream.cpp gates the entire path
# on `if (!navCacheDir_.empty())`, the only caller of set_nav_cache_dir
# (src/game/floor_stream.h:95) anywhere in the tree is tests/game_test.cpp:3765,
# src/app/main.cpp never sets it, and floor_stream.h:200 labels the field
# `// empty = on-disk nav cache disabled`. The app uses a separate nav::AsyncBake
# path instead. Accurately: nav_cache is reachable from production code and
# enabled only by a test. The rule below is still worth having — 733 lines of
# uncompiled assertions is a defect regardless of who calls the subject — but it
# is a testing-integrity defect, not a live gameplay one. For
# scale: WILL_FAIL at least caught 1 transition in 7; this caught 0 in 104.
#
# Needs no compiler, which is the point — it is a text rule that would have
# failed the day 56c9c6a landed.
#
# ESCAPE HATCH, deliberately in-file rather than a central allowlist: a suite
# still being written carries `giga-check: unwired-suite` plus a reason on some
# line. Keeping the exemption next to the code means it is deleted by the same
# edit that wires the suite up, instead of rotting in a list nobody re-reads —
# which is the failure mode of every allowlist that only ever grows.
file(GLOB GIGA_SUITE_FILES "${GIGA_ROOT}/tests/suite_*.inl")
file(GLOB GIGA_TEST_TUS "${GIGA_ROOT}/tests/*.cpp")

set(GIGA_TU_TEXT "")
foreach(_tu IN LISTS GIGA_TEST_TUS)
    file(READ "${_tu}" _tu_body)
    string(APPEND GIGA_TU_TEXT "${_tu_body}")
endforeach()

foreach(_suite IN LISTS GIGA_SUITE_FILES)
    get_filename_component(_suite_name "${_suite}" NAME)
    file(RELATIVE_PATH _suite_rel "${GIGA_ROOT}" "${_suite}")
    file(READ "${_suite}" _suite_body)

    string(FIND "${_suite_body}" "giga-check: unwired-suite" _suite_exempt)
    if(NOT _suite_exempt EQUAL -1)
        message("unwired-suite-exempt=${_suite_rel}")
        continue()
    endif()

    string(FIND "${GIGA_TU_TEXT}" "#include \"${_suite_name}\"" _suite_included)
    if(_suite_included EQUAL -1)
        list(APPEND GIGA_FAILURES
            "${_suite_rel}:1: compiled by NOBODY — no tests/*.cpp contains #include \"${_suite_name}\", so every assertion in it is dead text. Add the include to the right test translation unit AND call its test_*_all() from that file's main. If it is still being written, put `giga-check: unwired-suite <reason>` in it and delete that line when you wire it up.")
        continue()
    endif()

    # Included, so it compiles. Now check it is actually REACHED: an entry point
    # nobody calls is the same defect one layer in, and the compiler is perfectly
    # happy to build a static function that is never invoked.
    # Match on `void ` alone, which subsumes `static void ` - do NOT require `static`.
    # Measured 2026-07-29: 22 of the 23 entry points are `static void`, and exactly one is bare
    # `void` (tests/suite_speech.inl:612 `void test_speech_all()`). Requiring `static` made that
    # one suite's 81 CHECK sites invisible to the dispatch half of this guard, which is the same
    # class of defect the guard exists to catch - a check that silently sees nothing. Found by an
    # agent auditing the guard rather than by the guard itself, which is the argument for auditing
    # new gates instead of trusting them because they are new.
    string(REGEX MATCHALL "void test_[A-Za-z0-9_]*_all\\(\\)" _entries "${_suite_body}")
    foreach(_entry_decl IN LISTS _entries)
        string(REGEX REPLACE "^void " "" _entry "${_entry_decl}")
        string(REGEX REPLACE "\\(\\)$" "" _entry "${_entry}")
        string(FIND "${GIGA_TU_TEXT}" "${_entry}();" _entry_called)
        if(_entry_called EQUAL -1)
            list(APPEND GIGA_FAILURES
                "${_suite_rel}:1: ${_entry}() is defined but never called from any tests/*.cpp — the suite is compiled and then skipped. Dispatch it from the relevant main().")
        endif()
    endforeach()
endforeach()

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
