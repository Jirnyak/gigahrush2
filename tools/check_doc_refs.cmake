# Судья адресов в SKELETON.md — карте кода.
#
# ЗАЧЕМ ОН СУЩЕСТВУЕТ
# -------------------
# SKELETON.md описывает код КАК ЕСТЬ, и правило файла — «утверждение без адреса
# не строка этого файла». Без прибора это правило держится памятью агента, то
# есть не держится: номер строки гниёт МОЛЧА — код правится, строки съезжают,
# сборка зелёная, а документ уже врёт. Точно так же молча гниёт `symbol@path`:
# символ переименовали, адрес остался.
#
# Этот прибор — текстовый, компилятор ему не нужен, поэтому он судит одинаково
# на macOS и на MSVC (см. AGENTS.md §Build про то, что виндовая нога сейчас не
# проверяет ничего).
#
# ЗАПУСК
# ------
#   cmake -P tools/check_doc_refs.cmake
#   cmake -DGIGA_ROOT=/path/to/repo -P tools/check_doc_refs.cmake
#
# Зарегистрирован как ctest `doc_refs`. Пропал из списка ctest — значит потеряна
# обвязка add_test() в CMakeLists.txt; её надо вернуть, а не считать, что адреса
# всё ещё под судом.
#
# ДВЕ ЗАКОННЫЕ ФОРМЫ АДРЕСА, И ТРЕТЬЕЙ НЕТ
# ----------------------------------------
# Решение владельца 2026-10-01. У тимаэрта форм три, и третья — `` `имя`
# (`путь:N`) `` — живёт там только белым списком как технический долг: её номер
# машина править не может, потому что цитаты рядом нет. Гигахрущ начинает без
# этого долга, поэтому форм ровно две:
#
#   1. `symbol@path` — «вещь живёт вот здесь». Номера НЕТ вовсе, гнить нечему.
#      Пример: `wrap_macro@src/core/wrap.h`
#      Прибор требует, чтобы `symbol` встречался в файле `path`.
#
#   2. `path:N «дословная цитата строки N»` — когда нужна точка ВНУТРИ функции
#      или конкретный литерал. Единственная форма с номером, и её номер правит
#      МАШИНА: `cmake --build build --target docs_sync` находит цитату и
#      переписывает число. Совпасть не с той строкой цитата не может.
#      Пример: `src/world/types.h:17 «inline constexpr int kMacroDim = 128;»`
#
#   Голый `path` без номера и без `@` — законная ссылка на файл: она ни на что
#   построчно не претендует, и судить в ней нечего.
#
#   Голый `path:N` БЕЗ цитаты — ОТКАЗ. Это и есть та самая третья форма, и
#   запрещена она не из вкуса: у номера без отпечатка нет ничего, что не
#   двигалось бы от правки соседей, и машина его починить не может.
#
# УТВЕРЖДЕНИЕ ОБ ОТСУТСТВИИ АДРЕСУЕТСЯ СВОИМ СВИДЕТЕЛЕМ
# -----------------------------------------------------
# У «второго входа НЕТ», «аллокаций в тике ноль», «virtual во всём src/ ноль»
# адреса в коде не существует — отсутствие негде показать. Такая строка
# указывает на ТЕСТ, который её держит, той же формой 1
# (`test_po2_caps@tests/suite_core_laws.inl`), и новой нотации для этого не
# заводится. Следствие принято сознательно: закон без свидетеля становится
# ВИДЕН — ему нечего поставить в ссылку, и тогда он либо получает свидетеля,
# либо идёт в реестр расхождений названной дырой.
#
# НА ЧЁМ ОН КРАСНЕЕТ — ТОЛЬКО ОБЪЕКТИВНЫЕ ОТКАЗЫ
# ----------------------------------------------
#   · файла нет;
#   · форма 1: символа в файле нет;
#   · форма 2: файл короче N;
#   · форма 2: строка N не содержит цитату, И цитата в файле не нашлась вовсе;
#   · форма 2: строка N не содержит цитату, цитата нашлась — «номер съехал,
#     позови docs_sync» (прибор НЕ правит сам: правка документа — это коммит,
#     и его делает человек);
#   · форма 2: цитата встречается в файле больше одного раза — docs_sync не
#     сможет выбрать строку, значит отпечаток не отпечаток;
#   · голый `path:N` без цитаты — запрещённая третья форма.
#
# Чего он НЕ судит, и это сознательно: ЧИСЛА. `docs_sync` правит номера строк,
# этот прибор проверяет адреса, а «232 static_assert, 504 вектора» не охраняет
# никто — у тимаэрта ровно так разошлись четыре числа в одной шапке за один
# день при двух зелёных гейтах. Поэтому у числа в SKELETON.md обязана стоять
# МЕРА — команда, которой оно снято, — и мера своего свидетеля не получает:
# тест, сверяющий счёт, охранял бы случай, а не закон.
#
# ДВЕ ДВЕРИ К ОДНОМУ ЯДРУ РАЗБОРА
# ------------------------------
# Файл один, режимов два, и второй копии парсера не бывает — иначе судья и
# правщик разъехались бы на второй же правке, и красный вердикт стал бы
# требовать того, чего правящая дверь не умеет.
#
#   cmake -P tools/check_doc_refs.cmake                     — СУДИТ (ctest doc_refs)
#   cmake -DGIGA_DOC_SYNC=ON -P tools/check_doc_refs.cmake  — ПРАВИТ (target docs_sync)
#
# Правит она РОВНО ОДНО: съехавший номер строки у формы 2, когда отпечаток
# нашёлся в файле ровно один раз. Всё остальное называет вслух и оставляет
# человеку. Молчание здесь читалось бы как «всё в порядке» — а это ровно тот
# род зелёного, против которого весь этот файл и написан.
#
# Почему правка — ОТДЕЛЬНЫЙ таргет, а не часть сборки: сборка, молча правящая
# файлы дерева, отбирает смысл у `git status --short`, который стоит первым
# шагом каждой сессии (AGENTS.md §YOUR SCRATCH IS NOT PROJECT STATE).
cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED GIGA_ROOT)
    get_filename_component(GIGA_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
endif()
if(NOT DEFINED GIGA_DOC_SYNC)
    set(GIGA_DOC_SYNC OFF)
endif()

# ЧИНИМ ПО МЕСТУ, А НЕ ЧЕРЕЗ СПИСОК НАКОПЛЕННОГО.
# Здесь стояли три параллельных списка (документ / старый токен / новый), и они
# РАССЫПАЛИСЬ на той же ловушке, что и всё прочее в этом файле: токен несёт
# точку с запятой (`kMaxBodies = 1u << 15;`), `list(APPEND)` расщепил его на два
# элемента, и `list(GET)` сорвался с «list index 2 out of range». Поймано
# первым же прогоном правящей двери 2026-10-01.
#
# Лечение — не экранирование, а отказ от хранилища: правка применяется к ТЕЛУ
# документа в тот момент, когда найдена, а тело пишется один раз после обхода.
set(GIGA_FIX_TOTAL 0)
set(GIGA_FIX_HUMAN 0)

# Документы под судом. Список ПОЛОЖИТЕЛЬНЫЙ и живёт здесь один раз: новый
# документ с адресами добавляется сюда в тот же день, а не после аудита.
set(GIGA_DOCS SKELETON.md)

# Расширения, которые прибор согласен считать адресуемым файлом. Нужны, чтобы
# прозаическое `foo.bar` не читалось как путь и не давало ложный отказ.
set(GIGA_ADDR_EXTS h cpp inl comp vert frag glsl cmake py csv md txt bat)

set(GIGA_DOC_FAILURES "")
set(GIGA_ADDR_FORM1 0)
set(GIGA_ADDR_FORM2 0)
set(GIGA_ADDR_PLAIN 0)

# _giga_is_addressable_path(<out> <token>) — похоже ли на путь в дереве.
#
# Расширения мало: у пути обязано быть ИМЯ перед точкой. Без этого требования
# прозаическое «сгенерированного `.cpp`» читалось как путь и давало ложный
# отказ «файла в дереве нет» — поймано первым же прогоном прибора на живой
# карте 2026-10-01. Класс известен: у соседнего проекта незакрытый список
# расширений превращал «.0» из `0.25…4.0` и «.g» из «e.g» в пути.
macro(_giga_is_addressable_path _out _tok)
    set(${_out} FALSE)
    foreach(_ext IN LISTS GIGA_ADDR_EXTS)
        if("${_tok}" MATCHES "[A-Za-z0-9_+-]\\.${_ext}$")
            set(${_out} TRUE)
            break()
        endif()
    endforeach()
endmacro()

# ---- БАЙТОВОЕ ЧТЕНИЕ: ЕДИНСТВЕННОЕ, КОТОРОЕ ЗДЕСЬ НЕ ВРЁТ ------------------
#
# Сюда вели ТРИ последовательных дефекта прибора, и все три нашлись замером, а
# не чтением кода. Записаны, чтобы следующий агент не прошёл тот же путь:
#
# 1. `file(STRINGS)` извлекает только последовательности печатаемого ASCII, всё
#    прочее считая разделителем: SKELETON.md в 833 строки дал 6397 элементов, и
#    отказы рапортовались на «SKELETON.md:2571», которой в файле нет. Шапки в
#    `src/` тоже по-русски, значит обман работал и на исходниках.
# 2. `string(REGEX MATCHALL "`[^`]+`")` рассыпает спан на кавычках-ёлочках —
#    многобайтные `«»` в отрицательном символьном классе движок CMake не
#    держит. Прогон печатал `form2=0` при 127 найденных адресах формы 1, то
#    есть ЗЕЛЕНЕЛ, не проверив ни одного отпечатка.
# 3. `file(READ)` + разбивка в СПИСОК тоже врёт: `list(LENGTH)` дал 2 элемента
#    на 93-строчный `src/core/wrap.h`. Экранирование точки с запятой спасти это
#    не смогло — списочная семантика CMake тут неисправима.
#
# Вывод: списков нет вовсе. Строки обходятся FIND/SUBSTRING по байтам, и номер
# строки отпечатка берётся СЧЁТОМ ПЕРЕВОДОВ СТРОКИ до его байтового смещения.
# Проверено на четырёх живых отпечатках: 11, 71, 88, 17 — в точности те, что
# стоят в карте.
#
# Цена известна и принята: обход O(n²) по копиям хвоста. На документе в 60 КБ
# это десятки миллисекунд, и правильность здесь дороже.

# _giga_count_lines(<out> <body>) — сколько строк в теле.
function(_giga_count_lines _out _body)
    string(REGEX MATCHALL "\n" _nl "${_body}")
    list(LENGTH _nl _n)
    math(EXPR _n "${_n} + 1")
    set(${_out} ${_n} PARENT_SCOPE)
endfunction()

# _giga_fp_locate(<line-out> <count-out> <body> <needle>)
# Номер строки ПЕРВОГО вхождения (1-базный, 0 = не найдено) и ЧИСЛО вхождений.
# Оба нужны: номер правит docs_sync, а счёт решает, имеет ли он право править —
# отпечаток, встречающийся дважды, отпечатком не является.
function(_giga_fp_locate _outLine _outCount _body _needle)
    string(LENGTH "${_body}" _blen)
    set(_count 0)
    set(_firstAt -1)
    set(_base 0)
    set(_scan "${_body}")
    while(TRUE)
        string(FIND "${_scan}" "${_needle}" _rel)
        if(_rel LESS 0)
            break()
        endif()
        math(EXPR _abs "${_base} + ${_rel}")
        if(_firstAt LESS 0)
            set(_firstAt ${_abs})
        endif()
        math(EXPR _count "${_count} + 1")
        math(EXPR _base "${_abs} + 1")
        math(EXPR _left "${_blen} - ${_base}")
        if(_left LESS_EQUAL 0)
            break()
        endif()
        string(SUBSTRING "${_body}" ${_base} ${_left} _scan)
    endwhile()
    set(_line 0)
    if(_firstAt GREATER_EQUAL 0)
        if(_firstAt GREATER 0)
            string(SUBSTRING "${_body}" 0 ${_firstAt} _head)
            string(REGEX MATCHALL "\n" _nl "${_head}")
            list(LENGTH _nl _nlCount)
            math(EXPR _line "${_nlCount} + 1")
        else()
            set(_line 1)
        endif()
    endif()
    set(${_outLine} ${_line} PARENT_SCOPE)
    set(${_outCount} ${_count} PARENT_SCOPE)
endfunction()

foreach(_doc IN LISTS GIGA_DOCS)
    set(_docPath "${GIGA_ROOT}/${_doc}")
    if(NOT EXISTS "${_docPath}")
        list(APPEND GIGA_DOC_FAILURES
            "${_doc}:1: документа нет под ${GIGA_ROOT}. Прибор, который молча ничего не нашёл, хуже отсутствующего прибора — поэтому это отказ, а не тишина.")
        continue()
    endif()

    file(READ "${_docPath}" _docBody)
    string(LENGTH "${_docBody}" _docLen)
    set(_docFixed "${_docBody}")
    set(_fixedHere 0)
    set(_docOff 0)
    set(_lineno 0)
    while(_docOff LESS _docLen)
        math(EXPR _docRem "${_docLen} - ${_docOff}")
        string(SUBSTRING "${_docBody}" ${_docOff} ${_docRem} _docTail)
        string(FIND "${_docTail}" "\n" _docNl)
        if(_docNl LESS 0)
            set(_line "${_docTail}")
            set(_docOff ${_docLen})
        else()
            string(SUBSTRING "${_docTail}" 0 ${_docNl} _line)
            math(EXPR _docOff "${_docOff} + ${_docNl} + 1")
        endif()
        math(EXPR _lineno "${_lineno} + 1")

        # Адреса живут ТОЛЬКО внутри обратных кавычек. Это и разметка, и граница
        # разбора: проза, называющая файл без кавычек, ни на что не претендует и
        # не судится. Строка таблицы может нести несколько адресов.
        #
        # СКАН БАЙТОВЫЙ, А НЕ `REGEX MATCHALL`, И ЭТО КУПЛЕНО ЗАМЕРОМ.
        # Первый прогон прибора на живой карте дал `form2=0` при 127 найденных
        # адресах формы 1 — то есть формы с отпечатком не распознавались ВООБСЕ,
        # и прибор зеленел, не проверив ни одной. Пробник назвал корень:
        # `string(REGEX MATCHALL "`[^`]+`" ...)` рассыпает спан на кавычках-
        # ёлочках — `«»` многобайтны, и движок регулярных выражений CMake в
        # отрицательном символьном классе их не держит. Строка таблицы
        # возвращалась двумя кусками, `…kMacroDim = 128` и `»`, и ни один не был
        # адресом.
        #
        # Диагноз «LENGTH считает символы, а SUBSTRING байты» был МОЙ и был
        # НЕВЕРЕН: пробник показал, что LENGTH, FIND и SUBSTRING все байтовые и
        # согласованы (`ab«cd»ef` → LENGTH 10, FIND « = 2, SUBSTRING(4,2) = cd).
        # Ломался ровно REGEX. Поэтому спаны ищутся FIND'ом, а отпечаток
        # вырезается SUBSTRING'ом — обе двери байтовые, и расходиться им негде.
        set(_pos 0)
        string(LENGTH "${_line}" _lineLen)
        while(_pos LESS _lineLen)
            math(EXPR _rest "${_lineLen} - ${_pos}")
            string(SUBSTRING "${_line}" ${_pos} ${_rest} _tail)
            string(FIND "${_tail}" "`" _tickA)
            if(_tickA LESS 0)
                break()
            endif()
            math(EXPR _afterA "${_tickA} + 1")
            math(EXPR _rest2 "${_rest} - ${_afterA}")
            if(_rest2 LESS_EQUAL 0)
                break()
            endif()
            string(SUBSTRING "${_tail}" ${_afterA} ${_rest2} _tail2)
            string(FIND "${_tail2}" "`" _tickB)
            if(_tickB LESS 0)
                break()
            endif()
            string(SUBSTRING "${_tail2}" 0 ${_tickB} _tok)
            math(EXPR _pos "${_pos} + ${_afterA} + ${_tickB} + 1")
            if(_tok STREQUAL "")
                continue()
            endif()

            # ---- Форма 1: symbol@path ----------------------------------------
            if(_tok MATCHES "^([A-Za-z_][A-Za-z0-9_:~]*)@([A-Za-z0-9_./+-]+)$")
                set(_sym "${CMAKE_MATCH_1}")
                set(_rel "${CMAKE_MATCH_2}")
                _giga_is_addressable_path(_ok "${_rel}")
                if(NOT _ok)
                    continue()
                endif()
                math(EXPR GIGA_ADDR_FORM1 "${GIGA_ADDR_FORM1} + 1")
                if(NOT EXISTS "${GIGA_ROOT}/${_rel}")
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — файла ${_rel} в дереве нет.")
                    continue()
                endif()
                file(READ "${GIGA_ROOT}/${_rel}" _body)
                string(FIND "${_body}" "${_sym}" _at)
                if(_at EQUAL -1)
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — символа ${_sym} в ${_rel} НЕТ. Либо его переименовали, либо он переехал, либо строка написана по намерению. Исправь адрес или впиши РАСХОЖДЕНИЕ.")
                endif()
                continue()
            endif()

            # ---- Форма 2: path:N «отпечаток» ---------------------------------
            # Регэксп трогает ТОЛЬКО ascii-голову токена — путь и номер — и
            # НЕ захватывает хвост: в хвосте живут кавычки-ёлочки и тело строки
            # кода, то есть ровно то, на чём движок CMake и ломается. Якорь `$`
            # здесь тоже не ставится сознательно.
            if(_tok MATCHES "^([A-Za-z0-9_./+-]+):([0-9]+)[ \t]")
                set(_rel "${CMAKE_MATCH_1}")
                set(_num "${CMAKE_MATCH_2}")
                _giga_is_addressable_path(_ok "${_rel}")
                if(NOT _ok)
                    continue()
                endif()

                # Кавычки-ёлочки режем БАЙТАМИ. FIND и SUBSTRING оба байтовые и
                # согласованы (замерено пробником 2026-10-01), в отличие от
                # REGEX, который на этих же байтах рассыпается.
                string(FIND "${_tok}" "«" _q0)
                string(FIND "${_tok}" "»" _q1 REVERSE)
                if(_q0 LESS 0 OR _q1 LESS 0 OR _q1 LESS _q0)
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — номер строки БЕЗ отпечатка. Это запрещённая третья форма: у такого номера нет ничего, что не съезжало бы от правки соседей, и docs_sync починить его не может. Напиши `${_rel}:${_num} «дословная цитата строки»`, либо перейди на форму `symbol@${_rel}`, у которой номера нет вовсе.")
                    math(EXPR GIGA_ADDR_FORM2 "${GIGA_ADDR_FORM2} + 1")
                    continue()
                endif()
                math(EXPR _q0in "${_q0} + 2")
                math(EXPR _fpLen "${_q1} - ${_q0in}")
                if(_fpLen LESS 1)
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — отпечаток пуст. Пустая цитата не отпечаток.")
                    continue()
                endif()
                string(SUBSTRING "${_tok}" ${_q0in} ${_fpLen} _fp)
                math(EXPR GIGA_ADDR_FORM2 "${GIGA_ADDR_FORM2} + 1")

                if(NOT EXISTS "${GIGA_ROOT}/${_rel}")
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — файла ${_rel} в дереве нет.")
                    continue()
                endif()

                file(READ "${GIGA_ROOT}/${_rel}" _srcBody)
                _giga_count_lines(_srcLen "${_srcBody}")
                _giga_fp_locate(_hitLine _hitCount "${_srcBody}" "${_fp}")

                if(_hitCount EQUAL 0)
                    if(_num GREATER _srcLen)
                        list(APPEND GIGA_DOC_FAILURES
                            "${_doc}:${_lineno}: `${_tok}` — в ${_rel} всего ${_srcLen} строк, а адрес просит ${_num}; отпечатка в файле тоже нет. Строка написана по намерению или код снесён.")
                    else()
                        list(APPEND GIGA_DOC_FAILURES
                            "${_doc}:${_lineno}: `${_tok}` — отпечатка в ${_rel} НЕТ НИ В ОДНОЙ строке. Это не съехавший номер, это исчезнувший код: исправь цитату или впиши РАСХОЖДЕНИЕ.")
                    endif()
                elseif(_hitCount GREATER 1)
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — отпечаток встречается в ${_rel} ${_hitCount} раз, значит он не отпечаток: docs_sync не сможет выбрать строку. Процитируй длиннее, чтобы цитата стала единственной.")
                elseif(NOT _hitLine EQUAL ${_num})
                    # ЕДИНСТВЕННОЕ, ЧТО МАШИНА ПРАВИТ. Замена идёт ТОКЕНОМ
                    # ЦЕЛИКОМ, а не номером внутри строки: отпечаток делает
                    # токен уникальным, поэтому ни реконструировать строки
                    # документа, ни считать байтовые смещения не нужно — а
                    # значит нечему и съехать при правке.
                    string(REGEX REPLACE "^([A-Za-z0-9_./+-]+):[0-9]+" "\\1:${_hitLine}" _fixed "${_tok}")
                    if(GIGA_DOC_SYNC)
                        string(REPLACE "${_tok}" "${_fixed}" _docFixed "${_docFixed}")
                        math(EXPR _fixedHere "${_fixedHere} + 1")
                        math(EXPR GIGA_FIX_TOTAL "${GIGA_FIX_TOTAL} + 1")
                        message("  ${_doc}:${_lineno}  ${_num} -> ${_hitLine}   ${_rel}")
                    else()
                        list(APPEND GIGA_DOC_FAILURES
                            "${_doc}:${_lineno}: `${_rel}:${_num}` — номер съехал: отпечаток живёт на строке ${_hitLine}, а не ${_num}. Номер строки руками не правится — он производное, а не факт: позови `cmake --build build --target docs_sync`.")
                    endif()
                endif()
                continue()
            endif()

            # ---- Голый путь без номера: законная ссылка на файл --------------
            if(_tok MATCHES "^([A-Za-z0-9_./+-]+)$")
                _giga_is_addressable_path(_ok "${_tok}")
                if(NOT _ok)
                    continue()
                endif()
                math(EXPR GIGA_ADDR_PLAIN "${GIGA_ADDR_PLAIN} + 1")
                if(NOT EXISTS "${GIGA_ROOT}/${_tok}")
                    list(APPEND GIGA_DOC_FAILURES
                        "${_doc}:${_lineno}: `${_tok}` — файла в дереве нет.")
                endif()
                continue()
            endif()

            # Голый `path:N` без хвоста вовсе — та же запрещённая третья форма,
            # и ловится она ЗДЕСЬ, потому что до разбора формы 2 не доходит:
            # там после номера требуется пробел и отпечаток.
            if(_tok MATCHES "^([A-Za-z0-9_./+-]+):([0-9]+)$")
                set(_rel "${CMAKE_MATCH_1}")
                set(_num "${CMAKE_MATCH_2}")
                _giga_is_addressable_path(_ok "${_rel}")
                if(NOT _ok)
                    continue()
                endif()
                math(EXPR GIGA_ADDR_FORM2 "${GIGA_ADDR_FORM2} + 1")
                list(APPEND GIGA_DOC_FAILURES
                    "${_doc}:${_lineno}: `${_tok}` — номер строки БЕЗ отпечатка (запрещённая третья форма). Напиши `${_rel}:${_num} «дословная цитата строки»` или `symbol@${_rel}`.")
            endif()
        endwhile()
    endwhile()

    if(GIGA_DOC_SYNC AND _fixedHere GREATER 0)
        file(WRITE "${_docPath}" "${_docFixed}")
        message("docs_sync: ${_doc} — поправлено номеров: ${_fixedHere}")
    endif()
endforeach()

# ---- Сторож: прибор, который ничего не увидел, обязан упасть ----------------
# Это тот же класс дефекта, который check_source_rules.cmake закрывает своим
# «scanned 0 files»: проверка, молча не нашедшая ничего, читается как «всё
# хорошо». Если в SKELETON.md нет ни одного адреса, значит либо разметку
# сменили, либо регэкспы перестали ловить, — и вердикт обязан быть красным, а
# не зелёным.
math(EXPR GIGA_ADDR_TOTAL "${GIGA_ADDR_FORM1} + ${GIGA_ADDR_FORM2} + ${GIGA_ADDR_PLAIN}")
if(GIGA_ADDR_TOTAL LESS 20)
    list(APPEND GIGA_DOC_FAILURES
        "SKELETON.md:1: прибор разобрал всего ${GIGA_ADDR_TOTAL} адресов. Карта кода без адресов — это проза, а не карта; либо разметка съехала, либо разбор сломан. Порог 20 — не цель, а сторож против молчания.")
endif()

# ---- ПРАВЯЩАЯ ДВЕРЬ: ОТЧЁТ -------------------------------------------------
if(GIGA_DOC_SYNC)
    if(GIGA_FIX_TOTAL EQUAL 0)
        message("docs_sync: съехавших номеров нет — править нечего.")
    endif()
    # ЧТО МАШИНА НЕ ПРАВИТ, ОНА ОБЯЗАНА НАЗВАТЬ. Молчание тут читалось бы как
    # «больше проблем нет», а правит она ровно один род отказа из семи.
    list(LENGTH GIGA_DOC_FAILURES GIGA_FIX_HUMAN)
    if(GIGA_FIX_HUMAN GREATER 0)
        message("")
        message("РУКАМИ (машина не угадывает) — ${GIGA_FIX_HUMAN}:")
        foreach(_f IN LISTS GIGA_DOC_FAILURES)
            message("- ${_f}")
        endforeach()
    endif()
    message("GIGA_DOC_SYNC=DONE fixed=${GIGA_FIX_TOTAL} human=${GIGA_FIX_HUMAN}")
    return()
endif()

list(LENGTH GIGA_DOC_FAILURES GIGA_DOC_FAILURE_COUNT)
if(GIGA_DOC_FAILURE_COUNT GREATER 0)
    message("GIGA_DOC_REFS=FAIL")
    foreach(_f IN LISTS GIGA_DOC_FAILURES)
        message("- ${_f}")
    endforeach()
    message(FATAL_ERROR
        "${GIGA_DOC_FAILURE_COUNT} битых адресов в карте кода. Правило файла: "
        "утверждение без адреса — не строка SKELETON.md. Исправь адрес, позови "
        "docs_sync, или перепиши утверждение как РАСХОЖДЕНИЕ — но не ослабляй "
        "прибор.")
endif()

# Одна строка, и оба числа в ней несущие — ровно по тому же доводу, что у
# GIGA_SOURCE_RULES=PASS: вердикт доказывает, что суд состоялся, а счёт
# доказывает, что разбор ещё видит дерево. PASS_REGULAR_EXPRESSION у CTest —
# один регэксп на весь вывод, а список таких свойств ИЛИ-ится, а не И-ится,
# поэтому потребовать оба можно только рядом на одной строке.
message("GIGA_DOC_REFS=PASS form1=${GIGA_ADDR_FORM1} form2=${GIGA_ADDR_FORM2} plain=${GIGA_ADDR_PLAIN}")
