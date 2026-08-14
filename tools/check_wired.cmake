# A system that exists and nothing calls — the "unwired system" defect class, as a
# text gate that needs no compiler.
#
# ORIGIN, stated because the idea is not mine: this is `tools/check_wired.cmake` from
# marko1olo's branch (2026-08-13), the one thing out of 39 commits that survived
# review. The idea is right and the project has paid for it repeatedly — a `*_step`
# with a header, a definition, tests and no caller reads as implemented and is not.
# `MobDef::projType` sat write-only for months; the utility-AI scorer shipped with
# stubbed inputs; `diffusion_step` is in that state today.
#
# TWO HOLES WERE CLOSED BEFORE ADOPTING IT, and both are defects this tree already
# knows by name:
#
#   1. **The definition counted as a call.** The original searched every src/*.cpp for
#      `func(` and called the function wired if it found one — but a function's own
#      DEFINITION matches that, and so does a call it makes to itself. Measured: it
#      passed `diffusion_step`, which is declared, defined, called twice from inside
#      diffusion.cpp and called by NOTHING else — while main.cpp:2857 carries a note
#      saying exactly that. A gate that misses the one case it is named for is §46 all
#      over again ("вызов есть, эффекта нет"). A call now has to come from a file
#      OTHER than the one holding the definition.
#
#   2. **Reading stopped at the first `[`.** The original neutralised `;` but not
#      brackets, which is precisely the defect problems.md §46 fixed in
#      check_source_rules.cmake: CMake splits a list inside `[ ]`, so every line after
#      a file's first bracket vanished. The neutralisation is ported from the sibling
#      gate rather than re-invented.
#
# A deferral is DECLARED, with its reason, in GIGA_DEFERRED_ENTRY_POINTS below. That
# is the whole point of the mechanism: "not wired yet" is a written decision with an
# owner, not the absence of a check.
#
# Run standalone:  cmake -P tools/check_wired.cmake
cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    get_filename_component(GIGA_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

# Entry points that are KNOWINGLY not called yet. Each carries the reason and the
# document that owns the decision. Adding a row here is a statement; leaving a system
# out of it is a build failure.
set(GIGA_DEFERRED_ENTRY_POINTS
    "cellular_step:решение по problems.md §13 ожидается"
    "fluid_step:ждёт GPU-компьют, см. performance.md §The compute split"
    # --- found by this gate on the day it was adopted, 2026-08-13 ---------------
    #
    # Nine systems, not two. Seven of these were INVISIBLE to the version this gate
    # was lifted from, because it counted a function's own definition as a call; they
    # appeared the moment that hole was closed. Each is declared in a header, defined
    # in a .cpp, and (six of the seven) covered by a test — and NOTHING in src/ calls
    # it. That is the shape "implemented" and "running" have when they come apart.
    #
    # They are listed rather than fixed because wiring nine systems is nine separate
    # decisions, each needing a place in the tick order. problems.md §52 owns the
    # list; a row leaving this file means the system got wired or got deleted.
    "diffusion_step:не подключён к тику — src/app/main.cpp:2857, поле danger всегда null"
    "diffusion_tick:тот же долг, что diffusion_step — драйвер поля опасности; problems.md §52"
)

# Line splitting that survives `;` AND `[ ]`. Ported from check_source_rules.cmake,
# where problems.md §46 records why the brackets matter.
macro(_giga_read_lines _path _out)
    file(READ "${_path}" _giga_raw)
    string(REPLACE ";" "@GIGA_SEMI@" _giga_raw "${_giga_raw}")
    string(REPLACE "[" "@GIGA_LB@" _giga_raw "${_giga_raw}")
    string(REPLACE "]" "@GIGA_RB@" _giga_raw "${_giga_raw}")
    string(REPLACE "\r" "" _giga_raw "${_giga_raw}")
    string(REPLACE "\n" ";" _giga_raw "${_giga_raw}")
    set(${_out} "${_giga_raw}")
endmacro()

# --- 1. every `*_step` / `*_tick` declared in a header ------------------------
file(GLOB_RECURSE header_files "${GIGA_ROOT}/src/*.h")
set(functions_to_check "")

foreach(h_file IN LISTS header_files)
    _giga_read_lines("${h_file}" lines)
    foreach(line IN LISTS lines)
        string(STRIP "${line}" stripped)
        # Skip comment lines: a `// ... foo_step(` mention is prose, not a declaration.
        if(stripped MATCHES "^//" OR stripped MATCHES "^\\*")
            continue()
        endif()
        if(stripped MATCHES "([A-Za-z0-9_]+_(step|tick))[ \t]*\\(")
            list(APPEND functions_to_check "${CMAKE_MATCH_1}")
        endif()
    endforeach()
endforeach()

list(REMOVE_DUPLICATES functions_to_check)
list(LENGTH functions_to_check entry_count)

# --- 2. each must be CALLED from a file other than the one defining it --------
file(GLOB_RECURSE cpp_files "${GIGA_ROOT}/src/*.cpp")
set(failures 0)

foreach(func IN LISTS functions_to_check)
    set(is_deferred FALSE)
    foreach(deferred_item IN LISTS GIGA_DEFERRED_ENTRY_POINTS)
        if(deferred_item MATCHES "^${func}:")
            set(is_deferred TRUE)
            break()
        endif()
    endforeach()
    if(is_deferred)
        continue()
    endif()

    # A DEFINITION starts at column 0 (a return type, or `namespace::name`); a CALL is
    # always indented, because it lives inside a function body. That is the whole
    # discriminator, and it holds because this tree writes definitions unindented.
    set(def_file "")
    foreach(c_file IN LISTS cpp_files)
        _giga_read_lines("${c_file}" lines)
        foreach(line IN LISTS lines)
            if(line MATCHES "^[A-Za-z_][^ \t]*.*[ \t*&]${func}[ \t]*\\(" OR
               line MATCHES "^${func}[ \t]*\\(")
                set(def_file "${c_file}")
                break()
            endif()
        endforeach()
        if(NOT def_file STREQUAL "")
            break()
        endif()
    endforeach()

    set(found FALSE)
    foreach(c_file IN LISTS cpp_files)
        # The defining file's own calls do not count. A system that only calls itself
        # is exactly the shape `diffusion_step` has, and it is not wired.
        if(c_file STREQUAL def_file)
            continue()
        endif()
        _giga_read_lines("${c_file}" lines)
        foreach(line IN LISTS lines)
            string(STRIP "${line}" stripped)
            if(stripped MATCHES "^//")
                continue()
            endif()
            if(stripped MATCHES "${func}[ \t]*\\(")
                set(found TRUE)
                break()
            endif()
        endforeach()
        if(found)
            break()
        endif()
    endforeach()

    if(NOT found)
        message(WARNING
            "Unwired entry point: ${func} — declared in a header, but no src/*.cpp "
            "outside its own definition file calls it. Wire it, or add it to "
            "GIGA_DEFERRED_ENTRY_POINTS in this file WITH the reason and the document "
            "that owns the decision.")
        math(EXPR failures "${failures} + 1")
    endif()
endforeach()

if(failures GREATER 0)
    message(FATAL_ERROR "GIGA_WIRED=FAIL (${failures} unwired) entry_points=${entry_count}")
else()
    message(STATUS "GIGA_WIRED=PASS entry_points=${entry_count}")
endif()
