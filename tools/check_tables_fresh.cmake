# ЗАКОММИЧЕННАЯ ТАБЛИЦА ОБЯЗАНА СОВПАДАТЬ СО СВОИМ ГЕНЕРАТОРОМ.
#
# Текстовый гейт, компилятора не требует — та же форма, что у check_source_rules
# и check_wired, и гоняется на том же голом раннере (нужен только питон, не
# Vulkan).
#
# ЗАЧЕМ. Шестнадцать генераторов превращают data/*.csv в src/**/*_table.{h,cpp} и в
# shaders/material_surface.glsl. Выход КОММИТИТСЯ — это контракт, записанный в
# шапке каждого генератора дословно: «the generated header is committed so the
# build needs no Python». Контракт хороший: сборка не мутирует дерево, работает
# из read-only копии, не гоняется с glslc за один и тот же .glsl и не требует
# питона у того, кто просто хочет собрать игру. Цена контракта одна — человек
# обязан помнить про перегенерацию. Вот этого помнить и не надо.
#
# ЧТО БЫЛО. Коммит ea7c6268 (2026-08-29) дописал три глагола в data/verbs.csv и
# перегенерировал verb_table.h, но НЕ перегенерировал item_table.cpp и
# prop_table.cpp. Их векторы глаголов остались длиной 16 при kVerbCount == 19.
# Дрейф простоял 26 дней при зелёном дереве и зелёном source_rules:
#   * компилятор смолчал — агрегатная инициализация добивает хвост нулями;
#   * правило 7 check_source_rules смолчало — оно сличает ЧИСЛО СТРОК CSV с
#     kXCount в хедере, а СОДЕРЖИМОЕ не смотрит никогда.
# Ущерб в тот раз оказался нулевым только потому, что глаголы ДОПИСАНЫ в конец.
# Вставка в середину молча съехала бы на один глагол во всех 442 предметах и
# всех 15 пропах — и этого в дереве не видит ничто.
#
# ПОЧЕМУ ГЕЙТ, А НЕ ПРИВЯЗКА К СБОРКЕ. Первая редакция лечения (2026-09-24)
# привязывала генераторы к сборке через add_custom_command со спекой «скрипт →
# его CSV», написанной руками. Спека соврала в 6 строках из 16: три входа были
# ФАНТОМАМИ, вычитанными из прозы docstring'ов (data/item_mass.csv удалён
# коммитом 9d0a118d, props у gen_material_table и mobs у gen_prop_table
# упоминаются только в комментариях), и три РЕАЛЬНЫХ входа были пропущены
# (verbs.csv у gen_item_table, items.csv у gen_status_table, props.csv у
# gen_ranged_table). Фантом data/item_mass.csv ронял конфигурацию; пропуск
# verbs.csv означал, что правка ТОЙ САМОЙ CSV, из-за которой всё началось,
# снова не перегенерирует item_table.cpp.
#
# Отсюда закон этого файла: **гейту спека входов не нужна.** Он не знает, какой
# генератор что читает, и знать не обязан — он запускает ВСЕ tools/gen_*.py в
# копии дерева и сверяет результат побайтно. Списка, которому можно соврать,
# здесь нет по построению. Это и есть разница между «следить за таблицами» и
# «сделать так, чтобы следить было нечем».
#
# КАК ЧИНИТЬ КРАСНОТУ: прогнать названный генератор и закоммитить его выход.

cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    message(FATAL_ERROR "check_tables_fresh: нужен -DGIGA_ROOT=<корень репозитория>")
endif()
if(NOT DEFINED GIGA_PYTHON OR GIGA_PYTHON STREQUAL "")
    # Питон не найден при конфигурации. Это КРАСНЫЙ гейт, а не пропущенный:
    # сверять дрейф нечем, и об этом надо знать, а не потерять тест из отчёта.
    message(FATAL_ERROR
        "check_tables_fresh: питон не найден при конфигурации, сверять дрейф "
        "закоммиченных таблиц от data/*.csv НЕЧЕМ. Поставить python3 и "
        "переконфигурировать. (Питон нужен только как инструмент — сборка и "
        "запуск игры без него работают, таблицы закоммичены.)")
endif()
if(NOT DEFINED GIGA_TMP)
    message(FATAL_ERROR "check_tables_fresh: нужен -DGIGA_TMP=<рабочий каталог>")
endif()

# ---- 1. Копия дерева -------------------------------------------------------
# Копируем ровно то, что генераторы читают и пишут: сами скрипты, CSV-источники,
# src/ и shaders/. data/ целиком НЕ копируем — там 89 МБ текстур, а генераторам
# нужны только .csv.
#
# Выходы одного генератора бывают входами другого: gen_economy_table.py читает
# src/game/item_table.h и item_table.cpp. Поэтому прогон делается ДВА РАЗА —
# второй проход видит уже свежие выходы первого. Два прохода settle'ят цепочку
# зависимостей глубиной до двух, а перечислять порядок руками было бы ровно той
# спекой, от которой этот гейт и отказывается.
file(REMOVE_RECURSE "${GIGA_TMP}")
file(MAKE_DIRECTORY "${GIGA_TMP}/data")
file(COPY "${GIGA_ROOT}/tools" DESTINATION "${GIGA_TMP}")
file(COPY "${GIGA_ROOT}/src" DESTINATION "${GIGA_TMP}")
file(COPY "${GIGA_ROOT}/shaders" DESTINATION "${GIGA_TMP}")
file(GLOB _csvs "${GIGA_ROOT}/data/*.csv")
file(COPY ${_csvs} DESTINATION "${GIGA_TMP}/data")

# ---- 2. Прогон всех генераторов -------------------------------------------
file(GLOB _gens RELATIVE "${GIGA_ROOT}/tools" "${GIGA_ROOT}/tools/gen_*.py")
list(SORT _gens)
list(LENGTH _gens _gen_count)

# Сторож от слепоты — тот же приём, что у правила 8 check_source_rules: гейт,
# который ничего не нашёл, обязан упасть, а не напечатать PASS. Сегодня
# генераторов 16; порог держим заметно ниже, чтобы он не был вторым пином,
# который надо двигать на каждый новый генератор, но и не пропускал развал
# глоба.
if(_gen_count LESS 15)
    message(FATAL_ERROR
        "check_tables_fresh: найдено генераторов ${_gen_count} — глоб ослеп")
endif()

foreach(_pass RANGE 1 2)
    foreach(_gen IN LISTS _gens)
        execute_process(
            COMMAND "${GIGA_PYTHON}" "tools/${_gen}"
            WORKING_DIRECTORY "${GIGA_TMP}"
            RESULT_VARIABLE _rc
            OUTPUT_VARIABLE _out
            ERROR_VARIABLE _err)
        if(NOT _rc EQUAL 0)
            message(FATAL_ERROR
                "check_tables_fresh: tools/${_gen} упал на проходе ${_pass} "
                "(код ${_rc})\n${_out}${_err}")
        endif()
    endforeach()
endforeach()

# ---- 3. Сверка содержимого -------------------------------------------------
# Сверяем ВСЁ под src/ и shaders/, а не список выходов: генератор, который
# завтра начнёт писать новый файл, попадёт под гейт сам, без правки гейта.
set(_stale "")
set(_born "")
set(_compared 0)
foreach(_sub src shaders)
    file(GLOB_RECURSE _files RELATIVE "${GIGA_TMP}/${_sub}" "${GIGA_TMP}/${_sub}/*")
    foreach(_rel IN LISTS _files)
        set(_gen_file "${GIGA_TMP}/${_sub}/${_rel}")
        if(IS_DIRECTORY "${_gen_file}")
            continue()
        endif()
        set(_repo_file "${GIGA_ROOT}/${_sub}/${_rel}")
        if(NOT EXISTS "${_repo_file}")
            list(APPEND _born "${_sub}/${_rel}")
            continue()
        endif()
        math(EXPR _compared "${_compared} + 1")
        file(SHA256 "${_gen_file}" _h_gen)
        file(SHA256 "${_repo_file}" _h_repo)
        if(NOT _h_gen STREQUAL _h_repo)
            list(APPEND _stale "${_sub}/${_rel}")
        endif()
    endforeach()
endforeach()

# Страж слепоты: если копия дерева не состоялась или glob промахнулся, сверка
# сравнит НОЛЬ файлов и промолчит. Порог — пол, а не точное число: он обязан
# ловить обвал на порядок, а не дрейф в единицах.
# 2026-09-30: пол опущен 300 -> 285. Сессия сноса мёртвого груза удалила СЕМЬ
# файлов под src/ (body_walk.h/.cpp, walk_bits.h, goals.h/.cpp,
# nav_cache.h/.cpp), и сверяемых стало 297. Это законное падение, ровно как у
# пина счёта проверок; порог отодвинут с запасом, чтобы следующий снос не валил
# зелёное дерево из-за арифметики стража.
if(_compared LESS 285)
    message(FATAL_ERROR
        "check_tables_fresh: сверено файлов ${_compared} — сверка ослепла")
endif()

if(_born)
    string(REPLACE ";" "\n  " _born_txt "${_born}")
    message(FATAL_ERROR
        "check_tables_fresh: генератор создал файл, которого нет в репозитории "
        "— закоммитить:\n  ${_born_txt}")
endif()

if(_stale)
    list(LENGTH _stale _n)
    string(REPLACE ";" "\n  " _stale_txt "${_stale}")
    message(FATAL_ERROR
        "check_tables_fresh: ${_n} закоммиченных файлов отстали от своих "
        "генераторов:\n  ${_stale_txt}\n"
        "Лечение: прогнать соответствующий tools/gen_*.py из корня репозитория "
        "и закоммитить выход.")
endif()

file(REMOVE_RECURSE "${GIGA_TMP}")
message(STATUS
    "GIGA_TABLES_FRESH=PASS generators=${_gen_count} files_compared=${_compared}")
