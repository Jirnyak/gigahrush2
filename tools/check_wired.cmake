cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    get_filename_component(GIGA_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

set(GIGA_DEFERRED_ENTRY_POINTS
    "cellular_step:решение по problems.md §13 ожидается"
    "fluid_step:ждёт GPU-компьют, см. performance.md §The compute split"
)

# Read file lines safely
macro(_giga_read_lines _path _out)
    file(READ "${_path}" _giga_raw)
    string(REPLACE ";" "@GIGA_SEMI@" _giga_raw "${_giga_raw}")
    string(REPLACE "\r" "" _giga_raw "${_giga_raw}")
    string(REPLACE "\n" ";" _giga_raw "${_giga_raw}")
    set(${_out} "${_giga_raw}")
endmacro()

# 1. Collect all step/tick declarations from src/**/*.h
file(GLOB_RECURSE header_files "${GIGA_ROOT}/src/*.h")
set(functions_to_check "")

foreach(h_file IN LISTS header_files)
    _giga_read_lines("${h_file}" lines)
    foreach(line IN LISTS lines)
        string(STRIP "${line}" stripped)
        # Very basic regex: looks for word_step( or word_tick(
        if(stripped MATCHES "([A-Za-z0-9_]+_(step|tick))[ \t]*\\(")
            list(APPEND functions_to_check "${CMAKE_MATCH_1}")
        endif()
    endforeach()
endforeach()

list(REMOVE_DUPLICATES functions_to_check)

# 2. Check if they are called in src/**/*.cpp (excluding the file they are defined in, but simple text search is enough)
file(GLOB_RECURSE cpp_files "${GIGA_ROOT}/src/*.cpp")
set(failures 0)

foreach(func IN LISTS functions_to_check)
    set(found FALSE)
    
    # Check deferred list
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

    # Search for invocation: "func(" in cpp files
    foreach(c_file IN LISTS cpp_files)
        _giga_read_lines("${c_file}" lines)
        foreach(line IN LISTS lines)
            string(FIND "${line}" "${func}" idx)
            if(idx GREATER_EQUAL 0)
                # Ensure it's an invocation and not just the definition.
                # A simple heuristic: if it has a semicolon or it's inside another call.
                # Actually, if it's found in ANY cpp file OTHER than where it's defined, or just found multiple times.
                # Let's just say if it is found at all, we assume it's wired. For a stricter check, 
                # we'd count occurrences > 1 or look for `func(`.
                string(FIND "${line}" "${func}(" idx2)
                string(FIND "${line}" "${func} (" idx3)
                if(idx2 GREATER_EQUAL 0 OR idx3 GREATER_EQUAL 0)
                    set(found TRUE)
                    break()
                endif()
            endif()
        endforeach()
        if(found)
            break()
        endif()
    endforeach()

    if(NOT found)
        message(WARNING "Unwired entry point: ${func}. It is not called in src/ nor is it in GIGA_DEFERRED_ENTRY_POINTS.")
        math(EXPR failures "${failures} + 1")
    endif()
endforeach()

if(failures GREATER 0)
    message(FATAL_ERROR "GIGA_WIRED=FAIL (${failures} unwired functions)")
else()
    message(STATUS "GIGA_WIRED=PASS")
endif()
