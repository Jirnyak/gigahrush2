// ДЕЙСТВИЕ — ОДНА ДВЕРЬ ЗАНЯТОСТИ (CANON S22).
//
// Закон владельца 2026-11-08: любое действие над миром или над собой занимает
// ВРЕМЯ (частный случай — ноль), и система одна, агностичная: игрок = моб =
// NPC. Это НЕ «длительность есть восстановление» донора (timaert), где акт
// мгновенен, долг висит после и прерывание НЕВЫРАЗИМО, — та модель держится на
// пошаговом мире. У нас шутер в реальном времени, и поверх лягут анимации,
// поэтому единица — ОКНО: действие началось, идёт, в какой-то кадр внутри окна
// падает эффект, окно кончилось.
//
// ЧТО ЭТО СВОДИТ. Пять имён одной величины жили в трёх структурах и
// декрементировались тремя проходами: `GunHand::cooldownMs`,
// `GunHand::reloadMs`, `PlayerMelee::cooldownMs`, `MobCombat::cooldownMs`,
// `MobCombat::windupMs` (у донора их было ШЕСТЬ, и свод был смыслом их чистки;
// у нас шестым был `gh.cooldownMs` в броске — та же величина под тем же
// именем, но третий по счёту смысл). Каждое поле означало «этот носитель
// занят» и каждое требовало своего вычитания в своём месте.
//
// ЗАНЯТОСТЬ — НЕ СЧЁТЧИК, А ВОПРОС. `startTick` + длина окна, и «занято?»
// становится `tick - startTick < durTicks`. Из этого ДАРОМ выпадают три вещи:
//   1. Декрементный проход по телам УМИРАЕТ. Его было три, и каждый несёт
//      шапку о том, что он «единственный» — потому что у донора кулдауны
//      вычитались в ~60 местах и монстры стреляли вдвое быстрее авторского
//      темпа. Вопрос вместо счётчика делает второй проход невозможным: нет
//      состояния, которое можно уменьшить дважды.
//   2. ФАЗА АНИМАЦИИ БЕСПЛАТНА: `tick - startTick` относительно `durTicks` и
//      есть нормированное время клипа. Клип тянется под строку данных, а не
//      строка под клип (решение владельца: балансить без трогания ассетов).
//   3. МОНОТОННОСТЬ. Шрам донора: привал писал `stateTimer = 0` поверх
//      суточного крафта, и место производило ВЧЕТВЕРО за сутки. Здесь обнулить
//      занятость нельзя иначе как через `break_action`, а он спрашивает
//      ПРИЧИНУ у строки.
//
// КОНТАКТНЫЙ КАДР (`applyTicks`) — колонка, которой у донора нет вовсе, и она
// же оказалась лечением конкретного костыля: мобий выстрел жил ДВУМЯ
// величинами (`windupMs` телеграфа и `cooldownMs` темпа) плюс флагом
// `windupDone`, потому что «ноль» одного u16 не различал «замаха не было» и
// «замах только что кончился» — и без флага моб заводил новый телеграф вечно,
// не выстрелив ни разу. В окне это ОДНА строка с двумя колонками: окно =
// виндап + кулдаун, контакт = виндап. Флаг не нужен, различать нечего.
//
// ОБРЫВ — ОДНА ДВЕРЬ И ТОЛЬКО ПО ПРИЧИНЕ ИЗ СТРОКИ (`kActionBreakMask`).
// Обрыв ДО контактного кадра — возврат (эффекта не было), ПОСЛЕ — эффект упал
// и окно просто закрывается раньше. Причина вне маски действие НЕ рвёт.
//
// ЧЕГО ЗДЕСЬ ПОКА НЕТ, И ЭТО НАЗВАНО, А НЕ ПОДРАЗУМЕВАЕТСЯ:
//   * БИТА `occupy` (1 — руки заняты, 0 — окно идёт, руки свободны). Он
//     приезжает вместе со сносом `status.*`: длящийся эффект и есть строка с
//     `occupy = 0`, а `status.csv` остаётся спецтаблицей множителей. Сегодня
//     все шесть действий занимают свой слот, то есть колонка была бы
//     константой — и `csv_columns` справедливо назвал бы её мёртвой.
//   * КОЛОНКИ `moveMultE3` (перезарядка 1000, бинт ~500, крафт у верстака 0) —
//     по той же причине: у всех шести сегодняшних действий множитель был бы
//     1000, то есть тождеством. Приедет с первым действием, которое движение
//     действительно стесняет.
//   * ЗАНЯТОСТИ ХОЛОДНОГО NPC (`actingUntil_` u32 + `actingAction_` u8 в
//     строке пула, 5 МБ при 2^20 — решение владельца). У макропопа сегодня нет
//     ни одного действия: писателя у колонки не было бы, а колонка без писателя
//     — тот же класс, за который из строки пула вырезали блок перков.
//   * `AiBrain::stateTimer` в этот свод НЕ входит, и это решение: он держит
//     «сколько секунд агент привержен ЦЕЛИ», то есть залипание решения, а не
//     занятость носителя. Его дом — замыкание слоя 4 (одна сумма над
//     кандидатами «комната×глагол»), и свести его сюда значило бы снова
//     перепутать «что я делаю» с «чего я хочу».
//
// Pure game-layer: ни SDL, ни Vulkan. Headless-tested (suite_action).
#pragma once

#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "core/tick.h"          // ms_to_ticks — одна дверь перевода авторских мс
#include "game/action_table.h"  // ActionId, kActionBreakMask — строки actions.csv

namespace giga::game {

// СЛОТ ЗАНЯТОСТИ — чем именно носитель занят. Три, и каждый выведен из того,
// что в дереве УЖЕ независимо: две руки (закон владельца 2026-08-31 — «один
// слот не должен знать о втором»: свой ствол, магазин, затвор и темп на руку)
// и тело (рукопашный замах игрока и мобий удар шли отдельными полями от
// темпа руки, то есть параллельно ей). Четвёртого слота нет и не выдумывается:
// новый слот = новая независимая занятость, а не новое действие.
enum class ActSlot : std::uint8_t {
    HandL = 0, // левая рука (ЛКМ) — её ствол, её перезарядка, её бросок
    HandR,     // правая (ПКМ)
    Body,      // тело: замах игрока, удар и выстрел моба
    Count
};
inline constexpr std::size_t kActSlotCount =
    static_cast<std::size_t>(ActSlot::Count);

// ОДНО ОКНО. POD; `Acting` ниже — три таких.
//
// `durTicks`/`applyTicks` — u16, то есть окно не длиннее 65535 тиков. Это не
// круглое число из воздуха: 65536 тиков = ВАХТА лестницы S15 ([core/watch.h]),
// и действие длиной в вахту уже не действие, а занятие — у него другой носитель
// (занятость холодной записи, см. шапку). Длину в окно кладёт ВЫЗЫВАЮЩИЙ,
// разрешив её один раз: строка носителя × множители анкеты. Разрешение один
// раз, а не каждый тик, — тот же приём, которым `SpeedCap` берёт свой предел
// «ONCE, at the moment the effect lands».
struct ActWindow {
    std::uint64_t startTick = 0; // когда началось
    std::uint16_t durTicks = 0;  // длина окна; 0 = слот свободен
    std::uint16_t applyTicks = 0; // контактный кадр внутри окна (<= durTicks)
    ActionId action = 0;         // строка actions.csv; осмыслен при durTicks > 0
    std::uint8_t applied = 0;    // контактный кадр уже снят (одноразовость)
    std::uint8_t pad_[2] = {};
};

// ЧЕМ НОСИТЕЛЬ ЗАНЯТ. Компонент на теле — на любом: у игрока, у моба и у
// жителя он один и тот же (агностичность S22). Крепится ЛЕНИВО тем проходом,
// которому понадобился, как `PlayerMelee` до него: воплощение не обязано
// помнить о нём, а тело, которое ни разу ничего не делало, его не носит.
struct Acting {
    ActWindow slot[kActSlotCount];
};

inline ActWindow& act_slot(Acting& a, ActSlot s) {
    return a.slot[static_cast<std::size_t>(s)];
}
inline const ActWindow& act_slot(const Acting& a, ActSlot s) {
    return a.slot[static_cast<std::size_t>(s)];
}

// --- вопросы вместо счётчиков ----------------------------------------------

// Сколько тиков прошло с начала окна. Часы НЕ ИДУТ НАЗАД: тик из прошлого
// (загрузка, перебазирование) даёт ноль, а не огромное беззнаковое число.
inline std::uint64_t act_elapsed(const ActWindow& w, std::uint64_t tick) {
    return tick >= w.startTick ? tick - w.startTick : 0u;
}

// ЗАНЯТ? Весь предикат целиком — ни одного состояния, которое можно испортить.
inline bool act_busy(const ActWindow& w, std::uint64_t tick) {
    return w.durTicks != 0 && act_elapsed(w, tick) < w.durTicks;
}
inline bool acting_busy(const Acting& a, ActSlot s, std::uint64_t tick) {
    return act_busy(act_slot(a, s), tick);
}

// Чем занят (kActionCount = «ничем», то есть слот свободен).
inline ActionId acting_what(const Acting& a, ActSlot s, std::uint64_t tick) {
    const ActWindow& w = act_slot(a, s);
    return act_busy(w, tick) ? w.action : static_cast<ActionId>(kActionCount);
}

// Нормированная фаза окна 0..1000 — время клипа анимации, даром.
inline std::uint16_t acting_phase_e3(const Acting& a, ActSlot s,
                                     std::uint64_t tick) {
    const ActWindow& w = act_slot(a, s);
    if (!act_busy(w, tick)) return 1000u;
    return static_cast<std::uint16_t>(act_elapsed(w, tick) * 1000u /
                                      w.durTicks);
}

// --- одна дверь начала -----------------------------------------------------

// НАЧАТЬ ДЕЙСТВИЕ. `durTicks`/`applyTicks` уже разрешены вызывающим из строки
// носителя. Отказ (false) — когда слот ЗАНЯТ: занятость монотонна, и перебить
// её можно только `break_action` с законной причиной. Это тот самый шрам
// донора, из-за которого «ещё один писатель нуля» производил вчетверо.
//
// `applyTicks` КЛАМПИТСЯ к окну, а не принимается на веру: контактный кадр за
// пределами окна означал бы эффект, который не падает никогда, и диагностика
// такого «действия, которое не срабатывает» стоит дороже, чем кламп.
inline bool acting_begin(Acting& a, ActSlot s, ActionId id,
                         std::uint32_t durTicks, std::uint32_t applyTicks,
                         std::uint64_t tick) {
    if (id >= kActionCount) return false; // глагола без строки не бывает
    ActWindow& w = act_slot(a, s);
    if (act_busy(w, tick)) return false;
    const std::uint32_t dur = durTicks > 0xFFFFu ? 0xFFFFu : durTicks;
    const std::uint32_t app = applyTicks > dur ? dur : applyTicks;
    w.startTick = tick;
    w.durTicks = static_cast<std::uint16_t>(dur);
    w.applyTicks = static_cast<std::uint16_t>(app);
    w.action = id;
    w.applied = 0;
    w.pad_[0] = w.pad_[1] = 0;
    return true;
}

// Начать действие длиной из авторских МИЛЛИСЕКУНД строки носителя — та же
// дверь, один перевод ([core/tick.h] ms_to_ticks: вверх, и это замер).
inline bool acting_begin_ms(Acting& a, ActSlot s, ActionId id,
                            std::uint32_t durMs, std::uint32_t applyMs,
                            std::uint64_t tick) {
    return acting_begin(a, s, id, ms_to_ticks(durMs), ms_to_ticks(applyMs),
                        tick);
}

// --- контактный кадр -------------------------------------------------------

// СНЯТЬ КОНТАКТНЫЙ КАДР — ровно один раз за окно. Возвращает true на первом
// опросе, у которого кадр уже наступил; дальше false, сколько ни спрашивай.
//
// Одноразовость битом, а не сравнением `elapsed == applyTicks`: равенство
// верно РОВНО НА ОДНОМ тике, и пропустивший этот тик опрос (тело вне слоя, кадр
// без сим-подшага, система со своим кадансом) потерял бы эффект целиком. Бит
// стоит байт и закрывает весь класс.
inline bool acting_take_apply(Acting& a, ActSlot s, std::uint64_t tick) {
    ActWindow& w = act_slot(a, s);
    if (w.durTicks == 0 || w.applied != 0) return false;
    if (act_elapsed(w, tick) < w.applyTicks) return false;
    w.applied = 1;
    return true;
}

// Упал ли уже эффект этого окна (для решения «обрыв = возврат или нет»).
inline bool acting_applied(const Acting& a, ActSlot s) {
    return act_slot(a, s).applied != 0;
}

// --- одна дверь обрыва -----------------------------------------------------

// Что сделал обрыв. `broken` — сорвано ли окно вообще (причина законна строкой
// и слот был занят); `effectLanded` — успел ли упасть контактный кадр ДО
// обрыва. Второе и есть ответ на «возврат или нет», и он нужен вызывающему:
// сорванный до контакта замах не наносит урона, сорванный после — наносит.
struct BreakResult {
    bool broken = false;
    bool effectLanded = false;
};

// ОБОРВАТЬ. Причина — бит из `kBreak*`; не найденная в маске строки причина
// окно НЕ рвёт (и это не отказ, а закон: перезарядку рвёт смена ствола, а не
// всё на свете).
inline BreakResult break_action(Acting& a, ActSlot s, std::uint8_t reason,
                                std::uint64_t tick) {
    BreakResult out;
    ActWindow& w = act_slot(a, s);
    if (!act_busy(w, tick)) return out;
    if (w.action >= kActionCount) return out;
    if ((kActionBreakMask[w.action] & reason) == 0) return out;
    out.broken = true;
    out.effectLanded = w.applied != 0;
    w.durTicks = 0; // слот свободен; обнулять startTick незачем
    w.applyTicks = 0;
    w.applied = 0;
    return out;
}

// --- сейв: окно едет ОСТАТКОМ, а не абсолютным тиком ----------------------
//
// Та же причина, по которой перебазируется летопись (S21): `simTick` после
// перезапуска идёт с нуля, и `startTick` из файла назвал бы окно «начавшимся в
// будущем» — рука осталась бы занята навсегда. Значим ОСТАТОК, он и едет.
//
// Снимок — отдельный POD, а не тот же `ActWindow` с подменённым смыслом поля:
// «тик начала» и «сколько осталось» — разные величины, и одна структура под
// обеими читалась бы как ошибка в половине мест.
struct ActWindowSnap {
    std::uint16_t durTicks = 0;
    std::uint16_t remainTicks = 0; // 0 = слот был свободен
    std::uint16_t applyTicks = 0;
    ActionId action = 0;
    std::uint8_t applied = 0;
};
struct ActingSnap {
    ActWindowSnap slot[kActSlotCount];
};

// Проводная ширина снимка: 3 слота × (2 + 2 + 2 + 1 + 1).
inline constexpr std::size_t kActingWire = kActSlotCount * 8;

inline ActingSnap acting_snap(const Acting& a, std::uint64_t now) {
    ActingSnap out;
    for (std::size_t i = 0; i < kActSlotCount; ++i) {
        const ActWindow& w = a.slot[i];
        ActWindowSnap& s = out.slot[i];
        if (!act_busy(w, now)) continue; // свободный слот едет нулями
        const std::uint64_t el = act_elapsed(w, now);
        s.durTicks = w.durTicks;
        s.remainTicks = static_cast<std::uint16_t>(w.durTicks - el);
        s.applyTicks = w.applyTicks;
        s.action = w.action;
        s.applied = w.applied;
    }
    return out;
}

inline Acting acting_restore(const ActingSnap& s, std::uint64_t now) {
    Acting out;
    for (std::size_t i = 0; i < kActSlotCount; ++i) {
        const ActWindowSnap& snap = s.slot[i];
        if (snap.remainTicks == 0 || snap.durTicks == 0) continue;
        const std::uint16_t remain = snap.remainTicks > snap.durTicks
                                         ? snap.durTicks
                                         : snap.remainTicks;
        const std::uint16_t el =
            static_cast<std::uint16_t>(snap.durTicks - remain);
        ActWindow& w = out.slot[i];
        if (now >= el) {
            // Обычный случай: окно садится на часы как было — и начало, и
            // длина подлинные, поэтому фаза клипа анимации тоже подлинная.
            w.startTick = now - el;
            w.durTicks = snap.durTicks;
        } else {
            // ЧАСЫ МОЛОЖЕ ПРОШЕДШЕЙ ЧАСТИ ОКНА (загрузка на первых тиках
            // сессии — `simTick` идёт с нуля). Тик начала отрицательным не
            // бывает, и выбор здесь между двумя неточностями: растянуть окно
            // (конец уедет) или подрезать длину (конец сохранится). Берём
            // ВТОРОЕ: сколько руке ещё быть занятой — величина игровая, а
            // длина окна — только фаза анимации, то есть косметика.
            w.startTick = 0;
            const std::uint32_t endAt =
                static_cast<std::uint32_t>(now) + remain;
            w.durTicks = static_cast<std::uint16_t>(
                endAt > 0xFFFFu ? 0xFFFFu : endAt);
        }
        w.applyTicks = snap.applyTicks;
        w.action = snap.action;
        w.applied = snap.applied;
    }
    return out;
}

// Занят ли носитель хоть чем-нибудь — нужно сейву (пустой снимок не крепят) и
// худу.
inline bool acting_any(const Acting& a, std::uint64_t tick) {
    for (std::size_t i = 0; i < kActSlotCount; ++i)
        if (act_busy(a.slot[i], tick)) return true;
    return false;
}

static_assert(std::is_trivially_copyable_v<ActWindow>,
              "окно действия обязано оставаться POD: оно ездит в сейв "
              "поле-за-полем и переживает memcpy");
static_assert(std::is_trivially_copyable_v<Acting>,
              "компонент занятости обязан оставаться POD — EnTT держит его "
              "пулом и умножает на число тел");

} // namespace giga::game

// ---- ГВОЗДИ РАЗМЕРА -------------------------------------------------------
// Окно умножается на три слота и на каждое тело этажа, поэтому его раскладка —
// строка мира. 16 Б сняты ИСПОЛНЕНИЕМ пробника (8 + 2 + 2 + 1 + 1 = 14,
// выравнивание по u64 до 16 — два байта названы полем `pad_`, чтобы дыра была
// видна в раскладке, а не угадывалась по sizeof). `Acting` — ровно три окна.
//
// ЧТО ЭТО СТОИЛО И ЧТО ВЕРНУЛО: 48 Б на тело против снесённых 8 (две руки по
// cd+reload) + 2 (замах) + 4 (моб) = 14. Плюс 34 Б на тело, и они покупают
// исчезновение трёх декрементных проходов, флага `windupDone` и всей
// возможности второго писателя. На капе этажа 4096 тел это 139 КиБ.
#include "core/row_law.h"

GIGA_ROW_BYTES(giga::game::ActWindow, 16);
GIGA_ROW_BYTES(giga::game::Acting, 48);

// Снимки — не строки МИРА, а строки ПРОВОДА, и контур им поставлен по тому же
// доводу, по которому прибор [tools/check_row_law.cmake] требует его у каждой
// `^struct` файла: раскладка, которую пишут в файл байт за байтом, обязана быть
// прибита там же, где объявлена. 8 = 2+2+2+1+1 (ровно `kFactWire`-подобная
// честность: ширина провода и sizeof здесь СОВПАДАЮТ, потому что дыр нет).
GIGA_ROW_BYTES(giga::game::ActWindowSnap, 8);
GIGA_ROW_BYTES(giga::game::ActingSnap, 24);

// `BreakResult` — ОТВЕТ ПО ЗНАЧЕНИЮ, а не строка мира: он не умножается ни на
// что и никуда не едет. Контур на нём стоит без пина байтов (`GIGA_ROW`, не
// `GIGA_ROW_BYTES`), и это ровно та разница, которую прибор и позволяет
// выразить: форму судим — размер не прибиваем, потому что прибивать нечего.
GIGA_ROW(giga::game::BreakResult);
