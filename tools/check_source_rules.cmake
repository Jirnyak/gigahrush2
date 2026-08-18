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
# The line is truncated at the first `//`, EXCEPT a `//` immediately preceded by
# `:` — that is a URI scheme separator, not a comment.
#
# That exception closed this file's one named FALSE NEGATIVE on 2026-08-12.
# Previously `const char* u = "http://x"; throw y;` hid its `throw`, because the
# line was cut inside the string literal. It was recorded as latent (no line in the
# tree carried a banned token after a `://`) and it was doubly unreachable, since
# the scan did not read past a file's first bracket at all. Repairing the scan made
# the hole live, so it was closed in the same commit; the truncation itself stays,
# because without it every doc comment naming `throw` or `catch` would fire.
#
# Still NOT handled, and named so the next reader knows the boundary: a `//` inside
# a string literal that is not part of a URI (`"a//b"`). Closing that needs a real
# string-literal parser, and the bias of this file — false positive over false
# negative — makes it a poor trade.

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
# All three hazards are neutralised here.
#
# THE THIRD ONE COST THIS GATE ITS ENTIRE REACH, 2026-07-28 to 2026-08-12.
# CMake's list expansion does not split on a `;` that sits inside square brackets —
# `[` opens a protected span and the split stops there, permanently, because C++
# never closes it in a balanced way. Measured on this host:
#
#     string(REPLACE "\n" ";" v "a\nb\nc\nd")          -> list length 4
#     string(REPLACE "\n" ";" v "a\nb [0, size)\nc\nd") -> list length 2
#
# So every file was scanned only as far as its FIRST bracket, and in C++ that is a
# lambda, a subscript, an attribute or a `[0, n)` in a header comment — i.e. line 1
# or 2. src/core/wrap.h yielded 2 "lines" for 56. Verified by mutation on the day it
# was found: a `throw` planted at wrap.h line 1 or 2 was caught, the SAME `throw` at
# line 3, 5, 10, 20, 40, 60 or appended at EOF was not, in src/sim/physics.cpp,
# src/core/wrap.h and tests/suite_speech.inl alike. Rules 1-5 and 7 were therefore
# blind over essentially the whole tree — the no-exceptions rule that MSVC cannot
# enforce and that this file exists to enforce included.
#
# This is the failure mode the .inl hole comment below already names — "a check that
# silently sees nothing" — arriving a second time through a different door, and it is
# why files_scanned alone was never enough to trust: 245 files were opened, and
# almost none of them were read past their first bracket.
#
# The brackets are put back line by line in _giga_scan, so every rule still matches
# against the exact source text and a future rule may contain a literal bracket.
macro(_giga_read_lines _path _out)
    file(READ "${_path}" _giga_raw)
    string(REPLACE ";" "@GIGA_SEMI@" _giga_raw "${_giga_raw}")
    string(REPLACE "[" "@GIGA_LB@" _giga_raw "${_giga_raw}")
    string(REPLACE "]" "@GIGA_RB@" _giga_raw "${_giga_raw}")
    string(REPLACE "\r" "" _giga_raw "${_giga_raw}")
    # Each line is terminated with a marker BEFORE the separator, so that a blank
    # source line becomes the one-character element `@GIGA_EOL@` rather than the
    # empty string. `foreach(x IN LISTS l)` silently drops empty elements, so blank
    # lines used to vanish and every reported line number after the first blank line
    # was too low — the second, quieter half of the bracket defect above, and the
    # reason a finding could name a line that holds nothing. A trailing newline still
    # produces one empty tail element, which is dropped, so no phantom final line.
    string(REPLACE "\n" "@GIGA_EOL@;" _giga_raw "${_giga_raw}")
    set(${_out} "${_giga_raw}")
endmacro()

# Undo _giga_read_lines' neutralisation for one line, in place. Split first, restore
# second: the placeholders exist only to survive CMake's list parsing, and every rule
# below is written against real source text.
macro(_giga_restore_line _var)
    string(REPLACE "@GIGA_EOL@" "" ${_var} "${${_var}}")
    string(REPLACE "@GIGA_SEMI@" ";" ${_var} "${${_var}}")
    string(REPLACE "@GIGA_LB@" "[" ${_var} "${${_var}}")
    string(REPLACE "@GIGA_RB@" "]" ${_var} "${${_var}}")
endmacro()

# _giga_scan(<file-list-var> <regex> <message>)
macro(_giga_scan _list_var _regex _message)
    foreach(_file IN LISTS ${_list_var})
        _giga_read_lines("${_file}" _lines)
        set(_lineno 0)
        foreach(_raw IN LISTS _lines)
            math(EXPR _lineno "${_lineno} + 1")
            _giga_restore_line(_raw)

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
            #
            # `://` is NOT a comment, and until 2026-08-12 this truncated on it
            # anyway. That was the file's one named FALSE NEGATIVE (see the header):
            # `const char* u = "http://x"; throw y;` hid its `throw`, because the
            # line was cut at the `//` inside the string literal. It was recorded as
            # latent — no line in the tree had a banned token after a `://` — and it
            # was ALSO unreachable in practice, since the scan never read past a
            # file's first bracket at all. Repairing the scan made this hole live, so
            # it is closed in the same breath.
            #
            # The rule is narrow ON PURPOSE: only a `//` immediately preceded by `:`
            # is skipped over, because that is a URI scheme separator and nothing
            # else in C++ spells it. A general string-literal parser would be the
            # thorough fix and is not worth it here — the bias of this file is
            # false-positive over false-negative (a banned token inside a comment or
            # a string IS flagged, and the escape hatch is the answer), so the only
            # hole worth closing is the one that hides a token, not one that shows an
            # extra. Truncation itself must stay: without it every doc comment in the
            # tree naming `throw` or `catch` would fire.
            set(_cut -1)
            set(_scan "${_raw}")
            set(_base 0)
            while(TRUE)
                string(FIND "${_scan}" "//" _rel)
                if(_rel LESS 0)
                    break()
                endif()
                math(EXPR _abs "${_base} + ${_rel}")
                set(_isUri FALSE)
                if(_abs GREATER 0)
                    math(EXPR _prevAt "${_abs} - 1")
                    string(SUBSTRING "${_raw}" ${_prevAt} 1 _prev)
                    if(_prev STREQUAL ":")
                        set(_isUri TRUE)
                    endif()
                endif()
                if(NOT _isUri)
                    set(_cut ${_abs})
                    break()
                endif()
                math(EXPR _base "${_abs} + 2")
                string(LENGTH "${_raw}" _rawLen)
                if(_base GREATER_EQUAL _rawLen)
                    break()
                endif()
                math(EXPR _restLen "${_rawLen} - ${_base}")
                string(SUBSTRING "${_raw}" ${_base} ${_restLen} _scan)
            endwhile()
            if(_cut EQUAL 0)
                continue()
            elseif(_cut GREATER 0)
                string(SUBSTRING "${_raw}" 0 ${_cut} _raw)
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
            _giga_restore_line(_l)
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
# Materials — tools/gen_material_table.py, ONE ROW PER CellType in
# data/materials.csv driving four generated artifacts (materials.h,
# material_props.h, material_table.h, material_surface.glsl). The GLSL carries
# the declared row count (this macro is file(READ) + regex, so the language is
# irrelevant); kMatCount in the generated C++ is the same number by
# construction, so one gate covers all four outputs.
_giga_csv_vs_header("data/materials.csv" "shaders/material_surface.glsl"
    "kMaterialCsvRows[ \t]*=[ \t]*([0-9]+)" "material surface")
# Props table (jirnyak.md §21) — same drift hazard as items/mobs/weapons.
_giga_csv_vs_header("data/props.csv" "src/game/prop_table.h"
    "kPropCount[ \t]*=[ \t]*([0-9]+)" "prop")
# Interactables table — the generated InteractKind enum IS the CSV's row order
# (PropDef.interactKind stores the ordinal), so a row added without a re-run
# would leave the enum short and every later ordinal misread.
_giga_csv_vs_header("data/interactables.csv" "src/game/interact_table.h"
    "kInteractCount[ \t]*=[ \t]*([0-9]+)" "interactable")
# Particles table — the unified GPU pool's type vocabulary. Same ordinal-ABI
# law as interactables (ParticleBurst stores the row index), same drift hazard.
_giga_csv_vs_header("data/particles.csv" "src/game/particle_table.h"
    "kParticleKindCount[ \t]*=[ \t]*([0-9]+)" "particle")
# Monster traits — hand-maintained header mirroring the ported TS bait/resist
# table, so it drifts the moment a row is added to the CSV alone.
_giga_csv_vs_header("data/monster_traits.csv" "src/game/monster_traits.h"
    "kMonsterTraitRows[ \t]*=[ \t]*([0-9]+)" "monster traits")

# ---- Rule 8: incomplete toroidal triple (AGENTS.md: x/y/z wrap) -------------
# The world wraps on all three axes, and the failure mode this rule exists for
# is PARTIAL wrapping: a distance computed with wrap_delta_f on two axes and a
# bare subtraction on the third. Every such window is a seam bug — the entity
# 2 m across the seam reads as ~254 m away on the unwrapped axis.
# markoaudit/systems/05-torus.md §1.2 lists the live instances and their
# symptoms (interaction/loot/possession blind at the y seam, hearing and 3D
# audio deaf through the z seam, grenade and ricochet leaving the world).
#
# Mechanics: every src/ line mentioning wrap_delta opens a window of 4 lines
# above to 7 below (the shape of one distance computation). The window's
# wrapped axes are the first arguments of its wrap_delta_f calls; its raw axes
# are same-axis bare subtractions (`a.y - b.y`). Wrapping SOME axes while
# subtracting ANOTHER bare is the finding. A window that wraps nothing is NOT:
# purely local math is allowed to be flat; the crime is mixing. Ported
# 2026-08-18 from the audit's python scan, whose 11 hits were each verified by
# hand with 0 false positives (05-torus.md §7.3-B).
#
# THE BASELINE BELOW IS A RATCHET, NOT AN ALLOWLIST. The known violations are
# recorded as file|wrapped|raw signatures with a count. Anything new fails at
# its line. Fixing one fails too — with a message telling you to shrink the
# baseline in the same commit — so the number can only go down. Do not add
# rows; wrap the missing axis instead (three wrap_delta_f calls today,
# wrap_delta3 once src/core/wrap.h grows the vector form the audit proposes).
file(GLOB_RECURSE GIGA_TRIPLE_FILES
    "${GIGA_ROOT}/src/*.cpp" "${GIGA_ROOT}/src/*.h" "${GIGA_ROOT}/src/*.inl")

# 2026-08-18: los.cpp / noise.cpp / spatial_audio.cpp rows deleted — their z
# axes wrap now (owner's verdict; the "z does not wrap" comments cited AGENTS.md
# for the opposite of what it says). The ratchet held: 11 -> 8.
set(GIGA_TRIPLE_BASELINE
    "src/app/main.cpp|wrapped=x,z|raw=y|6"
    "src/game/loot.cpp|wrapped=x,z|raw=y|1"
    "src/game/prop_system.cpp|wrapped=x,z|raw=y|1")

set(GIGA_TRIPLE_HITS "")   # "<sig>@@@<relpath>:<line>" — sig plus the exact spot
set(GIGA_TRIPLE_SIGS "")   # "<relpath>|wrapped=..|raw=.." — one entry per finding
set(GIGA_TRIPLE_WINDOWS 0)

foreach(_file IN LISTS GIGA_TRIPLE_FILES)
    _giga_read_lines("${_file}" _lines)
    # Candidate lines first, so the windowing below touches only the ~150
    # wrap_delta sites instead of every line of every file.
    set(_cands "")
    set(_ix 0)
    foreach(_ln IN LISTS _lines)
        string(FIND "${_ln}" "wrap_delta" _wd)
        if(_wd GREATER_EQUAL 0)
            string(FIND "${_ln}" "giga-check: allow" _ex)
            if(_ex LESS 0)
                list(APPEND _cands ${_ix})
            endif()
        endif()
        math(EXPR _ix "${_ix} + 1")
    endforeach()
    if(_cands STREQUAL "")
        continue()
    endif()
    list(LENGTH _lines _n)
    file(RELATIVE_PATH _rel "${GIGA_ROOT}" "${_file}")
    set(_skip -1)
    foreach(_i IN LISTS _cands)
        # After a finding the scan jumps past its window (the python original
        # did the same), so one mixed computation is one finding, not four
        # overlapping ones.
        if(_i LESS _skip)
            continue()
        endif()
        math(EXPR _lo "${_i} - 4")
        if(_lo LESS 0)
            set(_lo 0)
        endif()
        math(EXPR _hi "${_i} + 8")
        if(_hi GREATER _n)
            set(_hi ${_n})
        endif()
        math(EXPR _wlen "${_hi} - ${_lo}")
        list(SUBLIST _lines ${_lo} ${_wlen} _wl)
        list(JOIN _wl "\n" _win)
        _giga_restore_line(_win)
        # `;` must not survive into the regex input: MATCHALL returns its
        # matches AS A LIST, so a match containing a semicolon (`a.y - b.y;` —
        # i.e. almost every statement-final subtraction) is split at it and the
        # per-match recapture below sees a fragment with no boundary character
        # and silently extracts nothing. Found by mutation on landing day: the
        # scan saw 1 of the 11 known violations, and the 10 it missed were
        # exactly the statement-final ones. `#` keeps the boundary property
        # ([^A-Za-z0-9_]) and appears in no pattern here.
        string(REPLACE ";" "#" _win "${_win}")
        math(EXPR GIGA_TRIPLE_WINDOWS "${GIGA_TRIPLE_WINDOWS} + 1")

        # Axes this window wraps: first argument of each wrap_delta_f call.
        string(REGEX MATCHALL "wrap_delta_f[ \t\r\n]*\\([ \t\r\n]*[^,]*\\.([xyz])" _wm "${_win}")
        set(_wrapped "")
        foreach(_m IN LISTS _wm)
            string(REGEX MATCH "[xyz]$" _ax "${_m}")
            list(APPEND _wrapped "${_ax}")
        endforeach()
        if(_wrapped STREQUAL "")
            continue()
        endif()
        list(REMOVE_DUPLICATES _wrapped)

        # Axes this window subtracts bare: `<expr>.a - <expr>.a`, same axis on
        # both sides. The trailing non-identifier class is the manual word
        # boundary CMake regex lacks — without it `a.z - b.zoom` would read as
        # a bare z. The window is padded with one space so a subtraction on the
        # last line still has its boundary character.
        set(_raws "")
        string(REGEX MATCHALL "[A-Za-z0-9_.]*\\.([xyz])[ \t]*-[ \t]*[A-Za-z_][A-Za-z0-9_.]*\\.([xyz])[^A-Za-z0-9_]" _rm "${_win} ")
        foreach(_m IN LISTS _rm)
            string(REGEX MATCH "\\.([xyz])[ \t]*-[ \t]*[A-Za-z_][A-Za-z0-9_.]*\\.([xyz])[^A-Za-z0-9_]$" _mm "${_m}")
            if(CMAKE_MATCH_1 STREQUAL CMAKE_MATCH_2)
                list(APPEND _raws "${CMAKE_MATCH_1}")
            endif()
        endforeach()
        if(_raws STREQUAL "")
            continue()
        endif()
        list(REMOVE_DUPLICATES _raws)

        set(_missing "")
        foreach(_ax IN LISTS _raws)
            list(FIND _wrapped "${_ax}" _inw)
            if(_inw LESS 0)
                list(APPEND _missing "${_ax}")
            endif()
        endforeach()
        if(_missing STREQUAL "")
            continue()
        endif()
        list(SORT _wrapped)
        list(SORT _missing)
        list(JOIN _wrapped "," _ws)
        list(JOIN _missing "," _ms)
        math(EXPR _lineno "${_i} + 1")
        set(_sig "${_rel}|wrapped=${_ws}|raw=${_ms}")
        list(APPEND GIGA_TRIPLE_HITS "${_sig}@@@${_rel}:${_lineno}")
        list(APPEND GIGA_TRIPLE_SIGS "${_sig}")
        set(_skip ${_hi})
    endforeach()
endforeach()

# Blindness guard, same reasoning as files_scanned: the tree carries ~150+
# wrap_delta call sites, so a window count below 50 means the glob or the
# window logic broke and the rule is asserting nothing.
if(GIGA_TRIPLE_WINDOWS LESS 50)
    message(FATAL_ERROR
        "check_source_rules rule 8: only ${GIGA_TRIPLE_WINDOWS} wrap_delta "
        "windows scanned, the tree has ~150+. The scan went blind — fix the "
        "scan, do not delete it. A check that silently sees nothing is worse "
        "than no check.")
endif()

set(_uniq "${GIGA_TRIPLE_SIGS}")
if(NOT _uniq STREQUAL "")
    list(REMOVE_DUPLICATES _uniq)
endif()

set(_bsigs "")
set(_bcounts "")
foreach(_b IN LISTS GIGA_TRIPLE_BASELINE)
    string(REGEX MATCH "^(.*)\\|([0-9]+)$" _dummy "${_b}")
    list(APPEND _bsigs "${CMAKE_MATCH_1}")
    list(APPEND _bcounts "${CMAKE_MATCH_2}")
endforeach()

foreach(_sig IN LISTS _uniq)
    set(_cnt 0)
    foreach(_s IN LISTS GIGA_TRIPLE_SIGS)
        if(_s STREQUAL _sig)
            math(EXPR _cnt "${_cnt} + 1")
        endif()
    endforeach()
    list(FIND _bsigs "${_sig}" _bi)
    set(_bcnt 0)
    if(_bi GREATER_EQUAL 0)
        list(GET _bcounts ${_bi} _bcnt)
    endif()
    if(_cnt GREATER _bcnt)
        # Name every site of this signature: the developer's new line is among
        # them, and the baseline count in the message says how many are old.
        foreach(_h IN LISTS GIGA_TRIPLE_HITS)
            string(FIND "${_h}" "${_sig}@@@" _pos)
            if(_pos EQUAL 0)
                string(REPLACE "${_sig}@@@" "" _at "${_h}")
                list(APPEND GIGA_FAILURES
                    "${_at}: incomplete toroidal triple — this window wraps [${_sig}] but subtracts another axis bare. ${_cnt} such windows in this file, baseline allows ${_bcnt}. Wrap the missing axis with wrap_delta_f (AGENTS.md: x/y/z wrap, symptoms in markoaudit/systems/05-torus.md §1.2). Never widen GIGA_TRIPLE_BASELINE.")
            endif()
        endforeach()
    elseif(_cnt LESS _bcnt)
        list(APPEND GIGA_FAILURES
            "tools/check_source_rules.cmake:1: torus-triple ratchet — signature [${_sig}] now has ${_cnt} windows, baseline says ${_bcnt}. You fixed one: shrink that row of GIGA_TRIPLE_BASELINE in the SAME commit so the ratchet keeps holding at the new, lower number.")
    endif()
endforeach()

foreach(_bsig IN LISTS _bsigs)
    list(FIND _uniq "${_bsig}" _fi)
    if(_fi LESS 0)
        list(APPEND GIGA_FAILURES
            "tools/check_source_rules.cmake:1: torus-triple ratchet — baseline row [${_bsig}] matches nothing in the tree any more. All its windows are fixed: delete the row in the SAME commit, so the baseline never outlives the defects it records.")
    endif()
endforeach()

message("GIGA_TORUS_TRIPLE windows_scanned=${GIGA_TRIPLE_WINDOWS}")

# ---- Rule 9: grid-size literals are banned in shaders ----------------------
# CMakeLists.txt parses kMacroDim/kSubDim/kCellSize out of src/world/types.h
# (and the light-grid shape out of src/render/gpu_light_grid.h) at configure
# time and passes them to every glslc call as GIGA_* -D macros. That block is
# the ONLY legal source of the world's shape in GLSL. Before it existed the
# numbers were retyped per shader and drifted: prop.frag divided by a
# hand-computed 76.8 where the C++ side passes 64, and shadow_march.glsl
# carried a "lockstep" copy nothing enforced. The macroisation itself was
# proven behaviour-preserving on landing day: all 25 .spv byte-identical
# before/after.
#
# Banned spellings: 128 (any fraction), 127 (the wrap mask 128-1), float 256.x
# (the world extent). Bare integer 256 stays legal — light_grid.comp's
# sTile[256] is a workgroup tile, not the world. 0.25/2.0/64 are NOT banned:
# they are common as colours, phases and workgroup sizes, and a rule that
# cries wolf gets an allow-comment pasted on reflex, which is worse than no
# rule. `#define GIGA_` is banned so an in-file define cannot shadow the -D.
file(GLOB GIGA_SHADER_FILES
    "${GIGA_ROOT}/shaders/*.vert" "${GIGA_ROOT}/shaders/*.frag"
    "${GIGA_ROOT}/shaders/*.comp" "${GIGA_ROOT}/shaders/*.glsl")
list(LENGTH GIGA_SHADER_FILES _giga_shader_count)
if(_giga_shader_count LESS 10)
    message(FATAL_ERROR
        "check_source_rules rule 9: only ${_giga_shader_count} shader files "
        "globbed — the tree has 25+. The glob went blind; fix it, do not "
        "delete the rule.")
endif()
# A regex passed INTO _giga_scan is macro-substituted and therefore parsed
# twice, so a `\\.` written here reaches the engine as a bare `.` (any char) —
# measured on landing day: the 256 rule matched `sTile[256]` and `256u`.
# Bracket classes `[.]` survive both parses; never use backslash escapes in
# these arguments.
_giga_scan(GIGA_SHADER_FILES "[^A-Za-z0-9_.]128([.][0-9]*)?[^A-Za-z0-9_]"
    "grid literal 128 is banned in shaders — use GIGA_MACRO_DIM (passed via -D from CMakeLists, parsed out of src/world/types.h). Retyped copies of the grid are how prop.frag ended up dividing by 76.8 against the C++ side's 64.")
_giga_scan(GIGA_SHADER_FILES "[^A-Za-z0-9_.]127[^A-Za-z0-9_.]"
    "wrap-mask literal 127 is banned in shaders — spell it (GIGA_MACRO_DIM - 1) so the mask cannot outlive a grid resize.")
_giga_scan(GIGA_SHADER_FILES "[^A-Za-z0-9_.]256[.][0-9]*[^A-Za-z0-9_]"
    "world-extent literal 256.x is banned in shaders — derive it: float(GIGA_MACRO_DIM) * GIGA_CELL_SIZE.")
# GIGA_-prefixed FEATURE switches (GIGA_ALBEDO_ARRAY, GIGA_SHADOW_SET,
# GIGA_VOLUMETRIC_GRID_BINDINGS) are an existing in-shader convention and stay
# legal; only the five grid macros owned by CMakeLists may not be shadowed.
_giga_scan(GIGA_SHADER_FILES "#[ \t]*define[ \t]+GIGA_(MACRO_DIM|SUB_DIM|CELL_SIZE|LIGHT_GRID_DIM|LIGHT_GRID_CELL)"
    "defining this grid macro inside a shader is banned — it would silently shadow the -D value CMakeLists parsed out of the C++ headers. The build system is the only writer of the five GIGA_ grid macros.")

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
# still being written carries a comment LINE STARTING with
# `// giga-check: unwired-suite` plus a reason. Keeping the exemption next to
# the code means it is deleted by the same edit that wires the suite up,
# instead of rotting in a list nobody re-reads — which is the failure mode of
# every allowlist that only ever grows. Line-start is REQUIRED: a plain
# substring match let ordinary prose mentioning the token ("the exemption is
# GONE, do not re-add it") silently disable the gate for that file.
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

    # An exemption is a directive LINE: `// giga-check: unwired-suite <reason>`. Match it
    # only when the directive is the leading content of a `//` comment (optionally after
    # whitespace), never mid-prose. A plain string(FIND) over the whole body could not tell
    # a live directive from a comment that merely QUOTES the string, so a WIRED header
    # saying "the exemption is gone" would silently exempt the suite and skip its
    # wired/`reached` audit (the suite_economy.inl false positive, fixed in 742b638).
    set(_suite_exempt FALSE)
    string(REGEX MATCHALL "(^|\n)[ \t]*//[ \t]*giga-check: unwired-suite[ \t]" _suite_exempt_hits "${_suite_body}")
    if(_suite_exempt_hits)
        set(_suite_exempt TRUE)
    endif()
    if(_suite_exempt)
        message("unwired-suite-exempt=${_suite_rel}")
        continue()
    endif()

    string(FIND "${GIGA_TU_TEXT}" "#include \"${_suite_name}\"" _suite_included)
    if(_suite_included EQUAL -1)
        list(APPEND GIGA_FAILURES
            "${_suite_rel}:1: compiled by NOBODY — no tests/*.cpp contains #include \"${_suite_name}\", so every assertion in it is dead text. Add the include to the right test translation unit AND call its test_*_all() from that file's main. If it is still being written, put a line starting `// giga-check: unwired-suite <reason>` in it and delete that line when you wire it up.")
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

# One line, not two, and that is the whole point. Both tokens are load-bearing for
# the ctest pin in CMakeLists.txt: the verdict proves a rule was actually asserted,
# the count proves the glob still saw the tree. CTest's PASS_REGULAR_EXPRESSION is a
# single regex over the whole output and a list of them ORs rather than ANDs, so the
# only way to demand BOTH is to emit them adjacent. Keep them on one line, in this
# order, and keep the `=` spellings — Docs/specs/05 §2.1 and problems.md quote them.
message("GIGA_SOURCE_RULES=PASS files_scanned=${GIGA_FILES_SCANNED}")
