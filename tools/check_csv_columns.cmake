# СТОЛБЕЦ CSV БЕЗ ЧИТАТЕЛЯ — КАК ЧИСЛО, А НЕ КАК ДОГАДКА.
#
# Четвёртый текстовый гейт того же вида, что check_source_rules / check_wired /
# check_tables_fresh: компилятора не требует, живёт на голом раннере, гоняется
# ctest'ом как `csv_columns`.
#
# ---------------------------------------------------------------------------
# ЗАЧЕМ. ОПАСНО НЕ ТО, ЧТО СТОЛБЕЦ ЛЕЖИТ — ОПАСНО, ЧТО ОН ВЫГЛЯДИТ ЖИВЫМ
# ---------------------------------------------------------------------------
# `data/items.csv` несёт 44 столбца, `data/monster_traits.csv` — 18. Часть из них
# доходит до игры, часть не читается никем, и до этого дня разница была видна
# ТОЛЬКО грепом по потребителям. Цена такой невидимости названа дважды числом:
#
#   * spec 17 §2.3 писал «14 мёртвых столбцов» прозой — и к 2026-09-30 врал в
#     СЕМИ местах из четырнадцати. Четыре столбца, объявленных мёртвыми, давно
#     ожили (`durability` → полоска износа и починка, `desc_ru` → карточка
#     предмета, `craft_station`/`craft_tier` → гейт верстака и тира), а три
#     мёртвых числились живыми (`spawn_count_max`, `use_b`, `ammo_id`; про
#     последний спека прямо говорила «его читает gen_ranged_table.py», а тот
#     читает `ammo_item` из `data/weapons_ranged.csv` и в items.csv за этим
#     столбцом не ходит НИ РАЗУ). Число «14» при этом случайно осталось похожим
#     на правду — и именно поэтому прозе нельзя верить: она сходится в сумме и
#     расходится в каждом слагаемом.
#   * семь столбцов `monster_traits.csv` стали write-only 2026-09-30, когда снос
#     мёртвого груза убрал их читателей (`trait_move_mult`, `trait_damage_mult`,
#     `trait_incoming_mult`, `trait_takes_bait`, `trait_allows_wet_spawn`). Данные
#     остались авторскими и ценными, но с того дня ПИШУТСЯ И НЕ ЧИТАЮТСЯ, и
#     узнать это можно было только прочитав §83.
#
# Решение владельца 2026-09-30: **гейт, а не удаление.** Столбец CSV не код —
# цена хранения нулевая, а цена ошибочного удаления это выброшенная работа
# человека. `spec 17 §6` («пометить — да, удалить — нет») остаётся в силе и с
# этого дня получает исполнителя.
#
# ---------------------------------------------------------------------------
# ЧТО ЗДЕСЬ ОБЪЯВЛЕНО, А ЧТО ИЗМЕРЕНО — И ПОЧЕМУ ИМЕННО ТАК
# ---------------------------------------------------------------------------
# `GIGA_CSV_COLUMNS` ниже — ОБЪЯВЛЕНИЕ судьбы каждого столбца. Гейт его не
# повторяет, а ПРОВЕРЯЕТ, и в обе стороны: живой обязан иметь читателя, мёртвый
# обязан не иметь. Это ровно та форма, из-за которой заявка не может обогнать
# код: расхождение объявления с деревом роняет прогон, а не живёт абзацем.
#
# Почему не «вывести всё автоматически, без списка»: у столбца CSV и у поля
# структуры РАЗНЫЕ имена, и переименование делает генератор (`spawn_w_milli` →
# `spawnWeight`, `wet_move` → `wetMoveX100`, `flicker` → `flickerProfile`). Греп
# по имени столбца не найдёт ни одного читателя и объявит мёртвым ВСЁ — это и
# есть та ошибка, которой сессия 2026-09-30 завысила инвентарь мёртвого кода
# примерно впятеро. Соглашение об имени (snake→camel) тоже не годится:
# `flicker` → `flickerProfile` и `wet_regen_hps` → `wetRegenMilliHps` его
# ломают, а гейт, у которого население задано соглашением об имени, — это гейт с
# известным слепым пятном (`wired`, 5.6% покрытия, §82.7).
#
# Поэтому связь «столбец → символ» написана руками ОДИН раз, а всё остальное
# измеряется. Соврать этому списку нельзя: каждая его строка судится и население
# судится тоже (пункты 1–5 ниже).
#
# ВЕРДИКТЫ:
#   LIVE:<символ>       столбец доходит до игры. Символ обязан иметь хотя бы один
#                       ЧИТАТЕЛЬ в `src/` — строку не-комментарий, не-объявление,
#                       не с нулевой колонки, в НЕсгенерированном файле.
#   WRITEONLY:<поле>    генератор столбец читает и кладёт в таблицу, а из таблицы
#                       его не читает никто. Поле обязано иметь НОЛЬ читателей.
#   DEAD:<причина>      столбца нет ни в одном генераторе и ни в одном файле
#                       `src/`: авторские данные, ждущие своей системы.
#   GEN:<причина>       столбец работает ВНУТРИ генератора — ключ, сверка,
#                       провенанс. Обязан встречаться в `tools/gen_*.py`
#                       закавыченным. Самый слабый класс, и это сказано вслух:
#                       до C++ такой столбец не доходит, и гейт за ним не следит
#                       дальше питона.
#
# ГРАНИЦА ЧЕСТНОСТИ, названная здесь, чтобы PASS не читался как «всё проверено»:
# читатель ищется на ОДИН ХОП, как у `wired`. Поле, которое читает только
# мёртвая функция, для этого гейта выглядит живым — ровно так `wetMoveX100`
# выглядел живым, пока `trait_move_mult` не снесли. Лечение то же, что у
# `wired`: символ в строке LIVE выбирается ритуалом так, чтобы его читатель был
# ЖИВЫМ вызовом (поэтому для мокрой регенерации в строке стоит
# `trait_wet_regen_hps`, а не `wetRegenMilliHps`) — и снос любого звена цепочки
# роняет гейт, потому что у объявленного символа исчезает читатель.
#
# ВТОРАЯ ГРАНИЦА, найденная МУТАЦИЕЙ этого же гейта 2026-09-30 и поэтому
# записанная числом строки, а не общими словами: имя столбца или поля, стоящее в
# строке С НУЛЕВОЙ КОЛОНКИ, читателем не считается. Так устроен дискриминатор
# «определение не имеет отступа, вызов имеет» — он перенесён из
# `check_wired.cmake`, где закрывает дыру «своё определение сошло за вызов». Цена
# известна: первая мутация «подключить мёртвый столбец из C++» была написана как
# функция с нулевой колонки, и гейт СПРАВЕДЛИВО промолчал. Опасная сторона у
# этой границы одна — мёртвый столбец, оживлённый кодом без отступа, то есть
# объявлением, а объявление и есть не-чтение. Мутация с отступом ловится
# (проверено: `(void)science_value;` внутри живой функции → красный).
#
# ХРАПОВИК — ТОЧНОЕ ЧИСЛО, не пол (выбор владельца 2026-09-30). `dead=` и
# `writeonly=` пинятся в CMakeLists.txt точными числами, в отличие от
# `source_rules`/`wired`, где пол выбран сознательно. Разница обоснована:
# столбцов CSV немного и они НЕ плодятся от каждого нового `.cpp`, поэтому
# конфликта слияния на каждый файл здесь не возникает, а «подключили столбец и
# никто не заметил» точное число ловит, а пол — нет.
#
# Run standalone:  cmake -P tools/check_csv_columns.cmake
cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    get_filename_component(GIGA_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()

# ---------------------------------------------------------------------------
# НАСЕЛЕНИЕ: какие CSV под гейтом, и почему остальные — нет
# ---------------------------------------------------------------------------
# Два файла, оба названные долгом (spec 17 §4.1 и problems.md §83.5 долг 1).
# Остальные семнадцать НЕ покрыты, и это записано списком, а не умолчанием:
# новый `data/*.csv`, не попавший ни в один из двух списков, роняет гейт. То
# есть покрытие здесь — ЧИСЛО (`covered=2/19`), а не самоощущение.
#
# Почему не все девятнадцать сразу: связь «столбец → символ» пишется ритуалом
# поштучно (посмотреть глазами на каждого кандидата в читатели и дойти по
# цепочке вверх до тика, кадра, UI или консоли), и на 62 столбца этих двух
# файлов ушла сессия. Список из 200 строк, написанный на глазок, был бы ровно
# тем документом, которому можно соврать, — от него этот гейт и отказывается.
set(GIGA_CSV_COVERED
    "items.csv"
    "monster_traits.csv"
)
set(GIGA_CSV_UNCOVERED
    "craft_recipes.csv"
    "economy.csv"
    "interactables.csv"
    "materials.csv"
    "mobs.csv"
    "particles.csv"
    "prop_forms.csv"
    "props.csv"
    "quests.csv"
    "sounds.csv"
    "speech_lines.csv"
    "status.csv"
    "textures.csv"
    "verbs.csv"
    "weapons_melee.csv"
    "weapons_ranged.csv"
)

# ---------------------------------------------------------------------------
# ОБЪЯВЛЕНИЕ СУДЬБЫ КАЖДОГО СТОЛБЦА
# ---------------------------------------------------------------------------
# ФОРМА СТРОКИ: `csv:столбец:ВЕРДИКТ:символ-или-причина`, и в последнем поле НЕ
# ДОЛЖНО БЫТЬ `;`. Это не стиль, а ловушка [cmake-text-gate-traps]: CMake
# склеивает аргументы `set()` через `;`, поэтому точка с запятой ВНУТРИ кавычек
# разрывает строку на два элемента списка — и храповик начинает судить обломок
# как отдельный столбец. В `check_wired.cmake` эта ловушка найдена мутацией, а
# не чтением, поэтому валидатор формы стоит здесь с первого дня.
set(GIGA_CSV_COLUMNS
    # --- data/items.csv: 44 столбца ---------------------------------------
    "items.csv:id:GEN:ключ каталога — по нему резолвят 14 генераторов, и item_by_string из консоли"
    "items.csv:name_ru:LIVE:item_name"
    "items.csv:name_en:DEAD:локализации нет — интерфейс только на русском"
    "items.csv:category:LIVE:.category"
    "items.csv:value_rub:LIVE:.value"
    "items.csv:stack_max:LIVE:.stackMax"
    # ПОДКЛЮЧЁН 2026-09-30, был мёртвым: 161 строка из 443 несёт объявленный
    # стак, и генератор теперь роняет генерацию при расхождении со stack_max.
    # Столбец существовал ровно для этой сверки (spec 17 §5) и не выполнял её.
    "items.csv:stack_declared:GEN:сверка с stack_max в gen_item_table.py — 161 строка несёт объявление"
    "items.csv:spawn_w_milli:LIVE:.spawnWeight"
    "items.csv:spawn_count_max:DEAD:сколько штук кладётся в стопку при спавне — читателя нет, spec 17 числил его живым по ошибке"
    "items.csv:equip_slot:LIVE:.equipSlot"
    "items.csv:durability:LIVE:item_durability"
    "items.csv:resist_kinetic:LIVE:.resist"
    "items.csv:resist_buckshot:LIVE:.resist"
    "items.csv:resist_energy:LIVE:.resist"
    "items.csv:resist_fire:LIVE:.resist"
    "items.csv:resist_psi:LIVE:.resist"
    "items.csv:science_value:DEAD:исследований и крафта высоких тиров нет"
    "items.csv:contraband_score:DEAD:досмотра, режима и фракционных проверок нет — механика задумана автором и не в роадмапе"
    "items.csv:deceptive_score:DEAD:обмана, подделок и торга по подлинности нет"
    "items.csv:use_effect:LIVE:.useEffect"
    "items.csv:use_a:LIVE:.useA"
    "items.csv:use_b:DEAD:вторая величина эффекта — ни один генератор её не читает, spec 17 числил её живым парой к use_a"
    "items.csv:use_grant_id:DEAD:выдачи предметов при использовании нет"
    "items.csv:use_grant_n:DEAD:выдачи предметов при использовании нет"
    "items.csv:ammo_id:DEAD:gen_ranged_table читает ammo_item из weapons_ranged.csv и в этот столбец не ходит — обвинение spec 17 §2.2 снято 2026-09-30"
    "items.csv:craft_mechanics:LIVE:.comp"
    "items.csv:craft_electronics:LIVE:.comp"
    "items.csv:craft_consumables:LIVE:.comp"
    "items.csv:craft_bio:LIVE:.comp"
    "items.csv:craft_chemical:LIVE:.comp"
    "items.csv:craft_metal:LIVE:.comp"
    "items.csv:craft_psimatter:LIVE:.comp"
    "items.csv:craft_metamatter:LIVE:.comp"
    "items.csv:craft_station:LIVE:craft_station_ok"
    "items.csv:craft_tier:LIVE:.tier"
    "items.csv:tag_count:DEAD:тегового крафта нет — spec 03 проектирует его, не зная, что данные уже размечены"
    "items.csv:tags_hot:DEAD:тегового крафта нет"
    "items.csv:tags_all:DEAD:тегового крафта нет"
    "items.csv:desc_ru:LIVE:item_desc"
    "items.csv:mass_g:LIVE:.massG"
    "items.csv:light_radius_mm:LIVE:.lightRadiusMm"
    "items.csv:light_intensity_e3:LIVE:.lightIntensityE3"
    "items.csv:light_cone_deg:LIVE:.lightConeDeg"
    "items.csv:flicker:LIVE:.flickerProfile"
    # --- data/monster_traits.csv: 18 столбцов ------------------------------
    "monster_traits.csv:idx:GEN:сверка порядка строк с data/mobs.csv — генератор роняет генерацию при съезде"
    "monster_traits.csv:id:GEN:ключ вида — резолвится в MobKind при генерации"
    "monster_traits.csv:resist_kinetic:LIVE:sync_monster_armour"
    "monster_traits.csv:resist_buckshot:LIVE:sync_monster_armour"
    "monster_traits.csv:resist_energy:LIVE:sync_monster_armour"
    "monster_traits.csv:resist_fire:LIVE:sync_monster_armour"
    "monster_traits.csv:resist_psi:LIVE:sync_monster_armour"
    "monster_traits.csv:terrain:WRITEONLY:.terrain"
    "monster_traits.csv:wet_move:WRITEONLY:wetMoveX100"
    "monster_traits.csv:dry_move:WRITEONLY:dryMoveX100"
    "monster_traits.csv:wet_dmg:WRITEONLY:wetDmgX100"
    "monster_traits.csv:dry_dmg:WRITEONLY:dryDmgX100"
    "monster_traits.csv:wet_incoming:WRITEONLY:wetIncomingX100"
    "monster_traits.csv:wet_regen_hps:LIVE:trait_wet_regen_hps"
    "monster_traits.csv:vuln_channel:LIVE:trait_counterplay_damage"
    "monster_traits.csv:vuln_floor_pct:LIVE:trait_counterplay_damage"
    "monster_traits.csv:bait:WRITEONLY:baitMask"
    "monster_traits.csv:ref:GEN:провенанс — файл и строка референса, откуда взято число"
)

# Разбиение строк, переживающее `;` И `[ ]`. Перенесено из check_source_rules.cmake,
# где problems.md §46 записывает, почему скобки важны.
macro(_giga_read_lines _path _out)
    file(READ "${_path}" _giga_raw)
    string(REPLACE ";" "@GIGA_SEMI@" _giga_raw "${_giga_raw}")
    string(REPLACE "[" "@GIGA_LB@" _giga_raw "${_giga_raw}")
    string(REPLACE "]" "@GIGA_RB@" _giga_raw "${_giga_raw}")
    string(REPLACE "\r" "" _giga_raw "${_giga_raw}")
    string(REPLACE "\n" ";" _giga_raw "${_giga_raw}")
    set(${_out} "${_giga_raw}")
endmacro()

set(violations "")

# ---------------------------------------------------------------------------
# 1. ВАЛИДАТОР ФОРМЫ — судим ВХОД, а не выход regex'а
# ---------------------------------------------------------------------------
# Обломок, отколотый точкой с запятой, формы не имеет, и без этой проверки он
# молча уехал бы в храповик как «столбец, которого нет в CSV».
foreach(_row IN LISTS GIGA_CSV_COLUMNS)
    if(NOT _row MATCHES "^[a-z0-9_]+\\.csv:[a-z0-9_]+:(LIVE|WRITEONLY|DEAD|GEN):.")
        list(APPEND violations
            "МАЛФОРМ: [${_row}] — строка обязана читаться `csv:столбец:ВЕРДИКТ:символ-или-причина` и не содержать `;`, который CMake превращает в разделитель списка ВНУТРИ кавычек")
    endif()
endforeach()

# ---------------------------------------------------------------------------
# 2. ПОКРЫТИЕ CSV — число, а не самоощущение
# ---------------------------------------------------------------------------
file(GLOB _csv_paths "${GIGA_ROOT}/data/*.csv")
set(_csv_names "")
foreach(_p IN LISTS _csv_paths)
    get_filename_component(_n "${_p}" NAME)
    list(APPEND _csv_names "${_n}")
endforeach()
list(LENGTH _csv_names _csv_total)
if(_csv_total LESS 15)
    list(APPEND violations
        "СЛЕПОТА: найдено CSV ${_csv_total} — глоб по data/*.csv ослеп")
endif()

foreach(_n IN LISTS _csv_names)
    list(FIND GIGA_CSV_COVERED "${_n}" _i1)
    list(FIND GIGA_CSV_UNCOVERED "${_n}" _i2)
    if(_i1 LESS 0 AND _i2 LESS 0)
        list(APPEND violations
            "НОВЫЙ CSV: data/${_n} не объявлен ни в GIGA_CSV_COVERED, ни в GIGA_CSV_UNCOVERED — покрытие обязано оставаться числом, поэтому файл надо разобрать ритуалом или объявить непокрытым")
    endif()
    if(_i1 GREATER_EQUAL 0 AND _i2 GREATER_EQUAL 0)
        list(APPEND violations "ДВАЖДЫ: data/${_n} стоит в обоих списках")
    endif()
endforeach()
foreach(_n IN LISTS GIGA_CSV_COVERED GIGA_CSV_UNCOVERED)
    list(FIND _csv_names "${_n}" _i)
    if(_i LESS 0)
        list(APPEND violations
            "ФАНТОМ CSV: ${_n} объявлен в списке покрытия, а файла data/${_n} нет — строка обязана умереть вместе со своим предметом, тем же коммитом")
    endif()
endforeach()

# ---------------------------------------------------------------------------
# 3. ХРАПОВИК НАСЕЛЕНИЯ: столбец без строки и строка без столбца
# ---------------------------------------------------------------------------
# Читаем ШАПКУ каждой покрытой CSV — население гейта это её столбцы, а не имена
# функций. У имени столбца соглашения нет по построению, значит нет и слепого
# пятна, которое стоило `wired` 5.6% покрытия.
set(_all_declared "")
foreach(_csv IN LISTS GIGA_CSV_COVERED)
    set(_path "${GIGA_ROOT}/data/${_csv}")
    if(NOT EXISTS "${_path}")
        continue()   # уже названо фантомом выше
    endif()
    _giga_read_lines("${_path}" _lines)
    list(GET _lines 0 _header)
    string(REPLACE "," ";" _cols "${_header}")
    list(LENGTH _cols _ncols)
    if(_ncols LESS 2)
        list(APPEND violations "ШАПКА: data/${_csv} — в шапке ${_ncols} столбцов, чтение шапки сломалось")
    endif()
    foreach(_col IN LISTS _cols)
        string(STRIP "${_col}" _col)
        set(_found FALSE)
        foreach(_row IN LISTS GIGA_CSV_COLUMNS)
            if(_row MATCHES "^${_csv}:${_col}:")
                set(_found TRUE)
                break()
            endif()
        endforeach()
        if(NOT _found)
            list(APPEND violations
                "СТОЛБЕЦ БЕЗ ВЕРДИКТА: ${_csv}:${_col} — новый столбец обязан быть разобран ритуалом и объявлен LIVE/WRITEONLY/DEAD/GEN в tools/check_csv_columns.cmake")
        endif()
        list(APPEND _all_declared "${_csv}:${_col}")
    endforeach()
endforeach()

foreach(_row IN LISTS GIGA_CSV_COLUMNS)
    string(REGEX MATCH "^[a-z0-9_]+\\.csv:[a-z0-9_]+" _key "${_row}")
    if(_key STREQUAL "")
        continue()   # малформ, уже названо
    endif()
    list(FIND _all_declared "${_key}" _i)
    if(_i LESS 0)
        list(APPEND violations
            "ВЕРДИКТ БЕЗ СТОЛБЦА: ${_key} — такого столбца в шапке CSV больше нет. Столбец переименован или удалён — снять строку ТЕМ ЖЕ коммитом, чтобы объявление не переживало свой предмет")
    endif()
endforeach()

# ---------------------------------------------------------------------------
# 4. ЧИТАТЕЛИ: измеряем то, что объявлено
# ---------------------------------------------------------------------------
# Файл СГЕНЕРИРОВАН, если его первая строка — маркер генератора. Список
# сгенерированных файлов руками НЕ пишется: он выводится из дерева, как и у
# check_tables_fresh, которому спека входов не нужна по построению.
file(GLOB_RECURSE _src_files "${GIGA_ROOT}/src/*.h" "${GIGA_ROOT}/src/*.cpp")
set(_hand_files "")
set(_generated 0)
foreach(_f IN LISTS _src_files)
    _giga_read_lines("${_f}" _l)
    list(GET _l 0 _first)
    if(_first MATCHES "^// GENERATED by tools/gen_")
        math(EXPR _generated "${_generated} + 1")
    else()
        list(APPEND _hand_files "${_f}")
    endif()
endforeach()
list(LENGTH _hand_files _hand_count)
if(_generated LESS 10 OR _hand_count LESS 100)
    list(APPEND violations
        "СЛЕПОТА: рукописных файлов ${_hand_count}, сгенерированных ${_generated} — глоб по src/ или маркер генератора сломались")
endif()

# ЧИТАТЕЛЬ символа T — строка, которая:
#   * лежит в НЕсгенерированном файле под src/ (tests/ не считается жизнью — это
#     тот же закон, что у `wired`, и критерий §83.2 автоматом не выражается);
#   * не комментарий;
#   * начинается НЕ с нулевой колонки — определение и объявление функции в этом
#     дереве не имеют отступа, а вызов имеет всегда, потому что живёт в теле.
#     Тот же дискриминатор, что у check_wired.cmake, и работает он по той же
#     причине;
#   * не объявление поля: `тип имя;` в структуре и `extern ... имя;` — это
#     ОПИСАНИЕ столбца, а не его чтение. Именно смешение этих двух и делает
#     мёртвое поле похожим на живое при взгляде грепом.
function(_giga_count_readers _token _out_count _out_where)
    # Экранируем regex-значимые символы: у токенов-полей первый символ — точка
    # (`.massG`), и незаэкранированная точка в CMake regex значит «любой символ».
    string(REPLACE "." "\\." _tok_rx "${_token}")
    set(_count 0)
    set(_where "")
    foreach(_f IN LISTS _hand_files)
        file(READ "${_f}" _raw)
        string(FIND "${_raw}" "${_token}" _pos)
        if(_pos LESS 0)
            continue()   # дешёвый отсев: токена в файле нет вообще
        endif()
        _giga_read_lines("${_f}" _lines)
        set(_ln 0)
        foreach(_line IN LISTS _lines)
            math(EXPR _ln "${_ln} + 1")
            # Определение/объявление с нулевой колонки.
            if(_line MATCHES "^[A-Za-z_]")
                continue()
            endif()
            string(STRIP "${_line}" _s)
            if(_s MATCHES "^//" OR _s MATCHES "^\\*" OR _s MATCHES "^#")
                continue()
            endif()
            if(NOT _s MATCHES "${_tok_rx}([^A-Za-z0-9_]|$)")
                continue()
            endif()
            # Объявление поля: `тип имя;`, `тип имя[5];`, `extern ... имя;`.
            # Точка с запятой здесь пишется как `@GIGA_SEMI@`, потому что
            # _giga_read_lines обязан её обезвредить — иначе CMake разорвал бы
            # файл на элементы списка по каждому `;` в коде. Ловушка
            # [cmake-text-gate-traps] второй раз в одном гейте: первая редакция
            # этой строки искала литеральную `;`, не находила НИКОГДА, и гейт
            # объявил читателями семь объявлений полей в monster_traits.h.
            # Найдено прогоном, не чтением.
            if(NOT _token MATCHES "^\\.")
                if(_s MATCHES "^[A-Za-z_][A-Za-z0-9_:<>,*&@ \t]*[ \t*&]${_tok_rx}[ \t]*(@GIGA_LB@[0-9]*@GIGA_RB@)?[ \t]*@GIGA_SEMI@")
                    continue()
                endif()
            endif()
            math(EXPR _count "${_count} + 1")
            if(_where STREQUAL "")
                file(RELATIVE_PATH _rel "${GIGA_ROOT}" "${_f}")
                set(_where "${_rel}:${_ln}")
            endif()
        endforeach()
    endforeach()
    set(${_out_count} ${_count} PARENT_SCOPE)
    set(${_out_where} "${_where}" PARENT_SCOPE)
endfunction()

# Закавыченное имя столбца в генераторе. Кавычки обязательны: имя столбца
# встречается ещё и в прозе docstring'ов, а проза — не чтение. Ровно на этом
# ловится `ammo_id`, чей единственный след в gen_ranged_table.py — фраза
# «"ammo_id needs interned string ids"» внутри докстринга.
function(_giga_in_generators _col _out)
    file(GLOB _gens "${GIGA_ROOT}/tools/gen_*.py")
    set(_hit FALSE)
    foreach(_g IN LISTS _gens)
        file(READ "${_g}" _raw)
        string(FIND "${_raw}" "\"${_col}\"" _p1)
        string(FIND "${_raw}" "'${_col}'" _p2)
        if(_p1 GREATER_EQUAL 0 OR _p2 GREATER_EQUAL 0)
            set(_hit TRUE)
            break()
        endif()
    endforeach()
    set(${_out} ${_hit} PARENT_SCOPE)
endfunction()

set(_n_live 0)
set(_n_writeonly 0)
set(_n_dead 0)
set(_n_gen 0)
foreach(_row IN LISTS GIGA_CSV_COLUMNS)
    if(NOT _row MATCHES "^([a-z0-9_]+\\.csv):([a-z0-9_]+):(LIVE|WRITEONLY|DEAD|GEN):(.*)$")
        continue()   # малформ, уже названо
    endif()
    set(_csv "${CMAKE_MATCH_1}")
    set(_col "${CMAKE_MATCH_2}")
    set(_verdict "${CMAKE_MATCH_3}")
    set(_tail "${CMAKE_MATCH_4}")

    if(_verdict STREQUAL "LIVE")
        math(EXPR _n_live "${_n_live} + 1")
        _giga_count_readers("${_tail}" _cnt _where)
        if(_cnt EQUAL 0)
            list(APPEND violations
                "ЖИВОЙ БЕЗ ЧИТАТЕЛЯ: ${_csv}:${_col} объявлен LIVE через `${_tail}`, но ни одна строка в НЕсгенерированном файле под src/ его не читает. Читателя снесли — столбец стал write-only, и строку надо перевести в WRITEONLY тем же коммитом (либо назвать другой символ, если цепочка просто переехала)")
        endif()
    elseif(_verdict STREQUAL "WRITEONLY")
        math(EXPR _n_writeonly "${_n_writeonly} + 1")
        _giga_count_readers("${_tail}" _cnt _where)
        if(_cnt GREATER 0)
            list(APPEND violations
                "МЁРТВЫЙ ОЖИЛ: ${_csv}:${_col} объявлен WRITEONLY, а поле `${_tail}` читается в ${_where}. Это ХОРОШАЯ новость — перевести строку в LIVE и опустить пин writeonly= в CMakeLists.txt ТЕМ ЖЕ коммитом")
        endif()
    elseif(_verdict STREQUAL "DEAD")
        math(EXPR _n_dead "${_n_dead} + 1")
        _giga_in_generators("${_col}" _in_gen)
        if(_in_gen)
            list(APPEND violations
                "МЁРТВЫЙ ОЖИЛ: ${_csv}:${_col} объявлен DEAD, а генератор его читает (имя столбца стоит закавыченным в tools/gen_*.py). Столбец подключают — перевести строку в LIVE/WRITEONLY/GEN и опустить пин dead= в CMakeLists.txt ТЕМ ЖЕ коммитом")
        endif()
        _giga_count_readers("${_col}" _cnt _where)
        if(_cnt GREATER 0)
            list(APPEND violations
                "МЁРТВЫЙ ОЖИЛ: ${_csv}:${_col} объявлен DEAD, а его имя читается в ${_where}. Перевести строку и опустить пин dead= тем же коммитом")
        endif()
    else() # GEN
        math(EXPR _n_gen "${_n_gen} + 1")
        _giga_in_generators("${_col}" _in_gen)
        if(NOT _in_gen)
            list(APPEND violations
                "ГЕНЕРАТОРНЫЙ БЕЗ ГЕНЕРАТОРА: ${_csv}:${_col} объявлен GEN, но закавыченного имени столбца нет ни в одном tools/gen_*.py. Сверку или ключ убрали — столбец стал мёртвым, перевести строку в DEAD и поднять пин dead= тем же коммитом")
        endif()
    endif()
endforeach()

# ---------------------------------------------------------------------------
# 5. ВЕРДИКТ
# ---------------------------------------------------------------------------
list(LENGTH violations _nv)
list(LENGTH GIGA_CSV_COVERED _n_covered)
if(_nv GREATER 0)
    foreach(_v IN LISTS violations)
        message(WARNING "${_v}")
    endforeach()
    message(FATAL_ERROR "GIGA_CSV_COLUMNS=FAIL (${_nv} problems)")
endif()

math(EXPR _n_total "${_n_live} + ${_n_writeonly} + ${_n_dead} + ${_n_gen}")
message(STATUS
    "GIGA_CSV_COLUMNS=PASS covered=${_n_covered}/${_csv_total} columns=${_n_total} "
    "live=${_n_live} gen=${_n_gen} writeonly=${_n_writeonly} dead=${_n_dead}")
