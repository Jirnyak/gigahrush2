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
# ---------------------------------------------------------------------------
# ТРИ ДЫРЫ ЗАКРЫТЫ 2026-09-30 (problems.md §82.7 — «ложное покрытие гейтов»)
# ---------------------------------------------------------------------------
# Гейт покрывал 5.6% поверхности и в двух местах врал. Дыры — по убыванию цены:
#
#   3. **ВЫЗОВ ПОД `getenv` СЧИТАЛСЯ СВЯЗНОСТЬЮ.** Самая дорогая: именно из-за
#      неё вся конструкция `goals_pick` (380 строк, фундамент S13) числилась
#      проведённой, имея ровно один вызов внутри `if (goalsDbg && ...)`. Отладочная
#      печать под переменной окружения — НЕ жизнь системы: игрок её не запускает,
#      и «работает» такая система ровно у того, кто выставил переменную. Гейт
#      теперь находит переменные, чьё значение пришло из `getenv`, и не засчитывает
#      вызовы внутри блоков, открытых условием по такой переменной.
#
#   2. **ПОПУЛЯЦИЯ ЗАДАНА СОГЛАШЕНИЕМ ОБ ИМЕНИ.** Была `*_step`/`*_tick`, стала
#      `*_step`/`*_tick`/`*_tick_at`/`*_advance`/`*_sim`. Суффикс `_at` делал
#      `samosbor_fog_tick_at` НЕВИДИМЫМ при объявленном отложенном сиблинге
#      `samosbor_fog_tick` — то есть имя решало, смотрит гейт или нет. 42 -> 45
#      точек входа. Это по-прежнему соглашение, а не решение: 577 свободных
#      функций `src/game/*.h` + `src/world/*.h` вне зоны гейта. Честная граница
#      названа здесь, чтобы следующий читатель не принял PASS за «всё покрыто».
#
#   1. **АЛЛОУЛИСТ НЕ ИМЕЛ ХРАПОВИКА** и накопил ДВА ФАНТОМА — `cellular_step` и
#      `fluid_step`, символов которых в дереве нет вообще (живы были только
#      эпитафии в комментариях). Строка отложки, которой больше ничто не
#      соответствует, теперь роняет гейт: приём взят у правила 8
#      check_source_rules.cmake:681-687, где он работает с самого начала. Именно
#      его отсутствие и позволило отложке пережить свой предмет.
#
# Run standalone:  cmake -P tools/check_wired.cmake
cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    get_filename_component(GIGA_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

# Entry points that are KNOWINGLY not called yet. Each carries the reason and the
# document that owns the decision. Adding a row here is a statement; leaving a system
# out of it is a build failure.
# ФОРМА СТРОКИ: `символ:причина`, и в причине НЕ ДОЛЖНО БЫТЬ `;`. Это не стиль,
# а ловушка [cmake-text-gate-traps], проверенная здесь руками 2026-09-30: CMake
# склеивает аргументы `set()` через `;`, поэтому точка с запятой ВНУТРИ кавычек
# разрывает строку на два элемента списка, и храповик ниже начинает судить
# обломок «problems.md §52» как отдельную отложку. Валидатор сразу за списком
# роняет гейт на любой строке не той формы — чтобы правило держалось проверкой,
# а не этим абзацем.
set(GIGA_DEFERRED_ENTRY_POINTS
    # 2026-08-17: экран обыска ([inventory_ui.h] InvUiSide) заменил авто-лут по
    # близости — ящик теперь хранилище, забор заявками Take. Функция осталась
    # тест-бэкендом контейнерной экономики (roll/cap/stack-пути в suite);
    # кандидат на выпил при следующей ревизии контейнеров ([container.h]).
    "loot_containers_step:экран обыска заменил авто-лут — тест-бэкенд, inventory.md"
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
    # НЕ отложка, а слепое пятно гейта: diffusion_tick вживлён в тик (main.cpp),
    # и он — единственный законный вызывающий diffusion_step ([diffusion.h]
    # прямо запрещает звать шаг мимо драйвера). Оба вызова лежат в diffusion.cpp,
    # а гейт одноуровневый: «вызов из файла определения не считается». Снять эту
    # строку можно, только научив гейт транзитивной проводке — не раньше.
    "diffusion_step:зовётся ТОЛЬКО diffusion_tick'ом из своего же файла по контракту, tick вживлён — main.cpp"
    # Тот же класс, что diffusion_step, и оба появились от расширения регекса
    # 2026-09-30: функция зовётся ТОЛЬКО из своего файла, но её вызывающий —
    # живая точка тика. Гейт одноуровневый и транзитивной проводки не видит.
    "samosbor_fog_tick_at:зовётся ТОЛЬКО samosbor_fog_tick'ом из своего же файла, тот вживлён в тик — main.cpp"
    "needs_advance:зовётся ТОЛЬКО needs_roll/needs_step'ом из своего же файла, needs_step вживлён — main.cpp"
    "route_step:целевой шаг по флоу-полю отложен к #13 (таблицы контента) — problems.md §52"
    "interaction_step:взаимодействие с пропами идёт мимо, main.cpp зовёт свои ветки — problems.md §52"
    "prop_interact_step:обёртка над interaction_step, не зовёт НИКТО и не покрыта тестом — problems.md §52"
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
        if(stripped MATCHES "([A-Za-z0-9_]+_(step|tick|tick_at|advance|sim))[ \t]*\\(")
            list(APPEND functions_to_check "${CMAKE_MATCH_1}")
        endif()
    endforeach()
endforeach()

list(REMOVE_DUPLICATES functions_to_check)
list(LENGTH functions_to_check entry_count)

# --- 1b. ХРАПОВИК АЛЛОУЛИСТА: строка, которой больше ничто не соответствует --
#
# Отложка обязана умереть вместе со своим предметом. Без этой проверки она
# переживает его молча — и дерево получает документ, описывающий систему,
# которой нет: ровно так `cellular_step` и `fluid_step` простояли фантомами,
# пока §82.7 не пересчитал их руками. Приём — правила 8
# (check_source_rules.cmake:681-687), перенесён дословно по смыслу.
#
# Роняет гейт, а не предупреждает: «предупреждение, которое никто не читает» —
# это и есть то, чем была отложка без храповика.
set(stale_rows "")
set(malformed_rows "")
foreach(deferred_item IN LISTS GIGA_DEFERRED_ENTRY_POINTS)
    # Форма строки проверяется ПЕРВОЙ и отдельно: обломок, отколотый точкой с
    # запятой, формы не имеет, и без этой проверки он молча уехал бы в храповик
    # как «отложка без предмета». Пустой ответ regex'а здесь неотличим от
    # осмысленного, поэтому судим ВХОД, а не выход.
    if(NOT deferred_item MATCHES "^[A-Za-z0-9_]+:.")
        list(APPEND malformed_rows "${deferred_item}")
        continue()
    endif()
    string(REGEX MATCH "^[A-Za-z0-9_]+" _row_func "${deferred_item}")
    list(FIND functions_to_check "${_row_func}" _fi)
    if(_fi LESS 0)
        list(APPEND stale_rows "${_row_func}")
    endif()
endforeach()

# --- 1c. ВЫЗОВ ПОД `getenv` — НЕ СВЯЗНОСТЬ ------------------------------------
#
# Для каждого .cpp считаем маску строк, лежащих внутри блока, открытого условием
# по переменной окружения. Двумя проходами:
#
#   A. имена, чьё значение пришло из `getenv` — `... имя = ... getenv(...)`;
#   B. строка `if (...)`, упоминающая такое имя (или сам `getenv`), открывает
#      забор; его протяжённость — по счёту фигурных скобок от этой строки, пока
#      глубина не вернётся к исходной. `if` без скобок закрывает забор на
#      следующей же строке.
#
# Скобки в строковых литералах и комментариях счёт сбивают — и это сознательно
# безопасная сторона: лишняя длина забора обнуляет ЗАКОННЫЙ вызов и роняет гейт
# ГРОМКО, тогда как противоположная ошибка вернула бы ровно ту тихую дыру, ради
# которой правило и написано.
#
# Заполняет `_env_mask` — список из ";"-разделённых 0/1 по строкам файла.
macro(_giga_env_fence _path _out)
    _giga_read_lines("${_path}" _fence_lines)
    set(_env_names "")
    foreach(_l IN LISTS _fence_lines)
        if(_l MATCHES "([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[^=]*getenv[ \t]*\\(")
            list(APPEND _env_names "${CMAKE_MATCH_1}")
        endif()
    endforeach()
    set(${_out} "")
    set(_depth 0)
    set(_fence_at -1)      # глубина, на которой забор закрывается; -1 = нет забора
    set(_fence_bare FALSE) # `if` без `{` — забор ровно на одну следующую строку
    foreach(_l IN LISTS _fence_lines)
        string(STRIP "${_l}" _ls)
        set(_inside 0)
        if(NOT _fence_at EQUAL -1)
            set(_inside 1)
        endif()
        # Открытие забора смотрим ДО учёта скобок этой строки.
        if(_fence_at EQUAL -1 AND NOT _ls MATCHES "^//" AND _ls MATCHES "if[ \t]*\\(")
            set(_is_env FALSE)
            if(_ls MATCHES "getenv[ \t]*\\(")
                set(_is_env TRUE)
            endif()
            foreach(_n IN LISTS _env_names)
                if(_ls MATCHES "[^A-Za-z0-9_]${_n}[^A-Za-z0-9_]" OR
                   _ls MATCHES "\\(${_n}\\)")
                    set(_is_env TRUE)
                endif()
            endforeach()
            if(_is_env)
                set(_fence_at ${_depth})
                set(_inside 1)
                if(NOT _ls MATCHES "{")
                    set(_fence_bare TRUE)
                endif()
            endif()
        endif()
        list(APPEND ${_out} ${_inside})
        string(REGEX MATCHALL "{" _ob "${_l}")
        string(REGEX MATCHALL "}" _cb "${_l}")
        list(LENGTH _ob _nob)
        list(LENGTH _cb _ncb)
        math(EXPR _depth "${_depth} + ${_nob} - ${_ncb}")
        if(NOT _fence_at EQUAL -1)
            if(_fence_bare)
                if(_nob GREATER 0)
                    set(_fence_bare FALSE)   # тело всё-таки в скобках
                else()
                    set(_fence_at -1)        # одна строка — и забор кончился
                endif()
            endif()
            if(NOT _fence_at EQUAL -1 AND _depth LESS_EQUAL ${_fence_at} AND _ncb GREATER 0)
                set(_fence_at -1)
            endif()
        endif()
    endforeach()
endmacro()

# --- 2. each must be CALLED from a file other than the one defining it --------
file(GLOB_RECURSE cpp_files "${GIGA_ROOT}/src/*.cpp")
set(failures 0)

# Заборы считаются ОДИН раз на файл, а не на каждую из 45 точек входа.
set(fence_files "")
set(fence_masks "")
foreach(c_file IN LISTS cpp_files)
    _giga_env_fence("${c_file}" _mask)
    list(APPEND fence_files "${c_file}")
    string(REPLACE ";" "," _mask_flat "${_mask}")
    list(APPEND fence_masks "${_mask_flat}")
endforeach()

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
        list(FIND fence_files "${c_file}" _mi)
        list(GET fence_masks ${_mi} _mask_flat)
        string(REPLACE "," ";" _mask "${_mask_flat}")
        _giga_read_lines("${c_file}" lines)
        set(_li 0)
        foreach(line IN LISTS lines)
            list(GET _mask ${_li} _fenced)
            math(EXPR _li "${_li} + 1")
            string(STRIP "${line}" stripped)
            if(stripped MATCHES "^//")
                continue()
            endif()
            # Вызов под `getenv` не считается связностью (§82.7). Строка с
            # объявлением самой env-переменной тоже внутри забора не лежит —
            # она его и создаёт, — но вызова в ней и не бывает.
            if(_fenced EQUAL 1)
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

foreach(_row IN LISTS malformed_rows)
    message(WARNING
        "Malformed deferral row: [${_row}] — a row must read `symbol:reason` and must "
        "not contain `;`, which CMake turns into a list separator INSIDE the quotes. "
        "Fix the row; the ratchet below cannot judge a fragment.")
    math(EXPR failures "${failures} + 1")
endforeach()

foreach(_row IN LISTS stale_rows)
    message(WARNING
        "Stale deferral row: ${_row} — GIGA_DEFERRED_ENTRY_POINTS declares it not "
        "wired yet, but no header declares such an entry point any more. The system "
        "was wired or deleted; delete the row in the SAME commit, so a deferral "
        "never outlives its subject.")
    math(EXPR failures "${failures} + 1")
endforeach()

list(LENGTH stale_rows stale_count)
list(LENGTH GIGA_DEFERRED_ENTRY_POINTS deferred_count)
if(failures GREATER 0)
    message(FATAL_ERROR
        "GIGA_WIRED=FAIL (${failures} problems) entry_points=${entry_count} "
        "stale_rows=${stale_count}")
else()
    message(STATUS
        "GIGA_WIRED=PASS entry_points=${entry_count} deferred=${deferred_count} "
        "stale_rows=0")
endif()
