// ЕДИНАЯ СИСТЕМА ДЕЙСТВИЙ (CANON S22, [game/action.h]) — гейты её законов.
//
// Что здесь проверяется и почему именно это:
//
//   1. ЗАНЯТОСТЬ — ВОПРОС, А НЕ СЧЁТЧИК. Нет состояния, которое можно
//      уменьшить дважды, и «частный случай 0» (мгновенное действие) выражен
//      нулевой ДЛИНОЙ, а не особой веткой.
//   2. МОНОТОННОСТЬ. Шрам донора: привал писал `stateTimer = 0` поверх
//      суточного крафта, и место производило ВЧЕТВЕРО за сутки. Здесь второй
//      писатель невозможен: `acting_begin` на занятый слот ОТКАЗЫВАЕТ.
//   3. КОНТАКТНЫЙ КАДР ОДНОРАЗОВ — и снимается даже тем опросом, который
//      пропустил свой тик (тело вне слоя, кадр без подшага).
//   4. ОБРЫВ ТОЛЬКО ПО ПРИЧИНЕ ИЗ СТРОКИ, и «до контакта / после» различимо:
//      в этом вся разница между возвратом и упавшим эффектом.
//   5. СЛОТЫ НЕЗАВИСИМЫ: две руки и тело не знают друг о друге (закон
//      владельца 2026-08-31 про акимбо, перенесённый в занятость).
//   6. ПЕРЕВОД АВТОРСКИХ МИЛЛИСЕКУНД — ВВЕРХ, и это сверяется с ЭМУЛЯЦИЕЙ
//      снесённого декремента: свод пяти таймеров обязан быть бит-в-бит, иначе
//      он не свод, а балансная правка.
//   7. СНИМОК ЕДЕТ ОСТАТКОМ и перебазируется на живые часы точно.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/action.h"

namespace action_suite {

using namespace giga;
using namespace giga::game;

// ---- 1. Занятость — вопрос ------------------------------------------------
static void test_action_busy_is_a_question() {
    Acting a{};
    // Свежий носитель свободен всеми слотами.
    for (std::size_t i = 0; i < kActSlotCount; ++i)
        CHECK(!act_busy(a.slot[i], 0u));
    CHECK(!acting_any(a, 0u));

    CHECK(acting_begin(a, ActSlot::Body, kActSwing, /*dur*/ 10, /*apply*/ 0, 100u));
    CHECK(acting_busy(a, ActSlot::Body, 100u));
    CHECK(acting_busy(a, ActSlot::Body, 109u));
    CHECK(!acting_busy(a, ActSlot::Body, 110u)); // окно кончилось РОВНО тут
    CHECK(!acting_busy(a, ActSlot::Body, 1000u));
    CHECK(acting_any(a, 100u));
    CHECK(!acting_any(a, 110u));
    // Чем занят — род из строки; свободный слот отвечает «ничем».
    CHECK(acting_what(a, ActSlot::Body, 100u) == kActSwing);
    CHECK(acting_what(a, ActSlot::Body, 110u) == kActionCount);

    // ЧАСТНЫЙ СЛУЧАЙ НОЛЬ: действие законно и мгновенно — занятости нет ни на
    // один тик. Ноль здесь ЗНАЧЕНИЕ, а не отсутствие.
    Acting z{};
    CHECK(acting_begin(z, ActSlot::Body, kActMaul, 0, 0, 50u));
    CHECK(!acting_busy(z, ActSlot::Body, 50u));

    // Глагола без строки не бывает — id вне таблицы отвергается.
    CHECK(!acting_begin(z, ActSlot::HandL, static_cast<ActionId>(kActionCount),
                        10, 0, 50u));
    CHECK(!acting_busy(z, ActSlot::HandL, 50u));

    // Часы НЕ идут назад: вопрос о прошлом тике не даёт огромного беззнакового
    // «прошло» (та же ловушка, что и у перебазированной летописи).
    Acting past{};
    CHECK(acting_begin(past, ActSlot::Body, kActSwing, 10, 0, 100u));
    CHECK(acting_busy(past, ActSlot::Body, 1u));
}

// ---- 2. Монотонность ------------------------------------------------------
static void test_action_is_monotone() {
    Acting a{};
    CHECK(acting_begin(a, ActSlot::HandL, kActReload, 100, 0, 10u));
    // ВТОРОЙ ПИСАТЕЛЬ НЕВОЗМОЖЕН: пока окно идёт, начать заново нельзя — ни
    // тем же действием, ни другим. Это и есть лечение шрама донора.
    CHECK(!acting_begin(a, ActSlot::HandL, kActReload, 100, 0, 50u));
    CHECK(!acting_begin(a, ActSlot::HandL, kActShoot, 5, 0, 50u));
    // Окно не удлинилось и не укоротилось от попыток.
    CHECK(act_slot(a, ActSlot::HandL).durTicks == 100);
    CHECK(act_slot(a, ActSlot::HandL).startTick == 10u);
    CHECK(!acting_busy(a, ActSlot::HandL, 110u));
    // А после окна — законно.
    CHECK(acting_begin(a, ActSlot::HandL, kActShoot, 5, 0, 110u));
}

// ---- 3. Контактный кадр ---------------------------------------------------
static void test_action_apply_frame() {
    Acting a{};
    // Окно 20 тиков, контакт на 8-м (мобий выстрел: виндап внутри окна).
    CHECK(acting_begin(a, ActSlot::Body, kActShot, 20, 8, 1000u));
    CHECK(!acting_applied(a, ActSlot::Body));
    CHECK(!acting_take_apply(a, ActSlot::Body, 1000u)); // рано
    CHECK(!acting_take_apply(a, ActSlot::Body, 1007u)); // всё ещё рано
    CHECK(acting_take_apply(a, ActSlot::Body, 1008u));  // контакт
    CHECK(acting_applied(a, ActSlot::Body));
    // ОДНОРАЗОВО: сколько ни спрашивай.
    CHECK(!acting_take_apply(a, ActSlot::Body, 1008u));
    CHECK(!acting_take_apply(a, ActSlot::Body, 1009u));
    // Окно при этом ИДЁТ: эффект упал, темп держится до конца.
    CHECK(acting_busy(a, ActSlot::Body, 1019u));
    CHECK(!acting_busy(a, ActSlot::Body, 1020u));

    // ПРОПУЩЕННЫЙ ТИК НЕ ТЕРЯЕТ ЭФФЕКТ — вот почему одноразовость битом, а не
    // сравнением `elapsed == applyTicks`: равенство верно ровно на одном тике.
    Acting late{};
    CHECK(acting_begin(late, ActSlot::Body, kActShot, 20, 8, 0u));
    CHECK(acting_take_apply(late, ActSlot::Body, 15u)); // спросили поздно — снято
    CHECK(!acting_take_apply(late, ActSlot::Body, 16u));

    // Контакт ЗА пределом окна клампится к окну, а не теряется навсегда.
    Acting clamped{};
    CHECK(acting_begin(clamped, ActSlot::HandR, kActShoot, 5, 9999, 0u));
    CHECK(act_slot(clamped, ActSlot::HandR).applyTicks == 5);
    CHECK(acting_take_apply(clamped, ActSlot::HandR, 5u));
}

// ---- 4. Обрыв — одна дверь и только по причине из строки ------------------
static void test_action_break_is_one_door() {
    // `reload` признаёт причину «смена руки» (kBreakHand) и не признаёт «цель
    // ушла» — маска живёт в строке CSV, не в этой проверке.
    CHECK((kActionBreakMask[kActReload] & kBreakHand) != 0);
    CHECK((kActionBreakMask[kActReload] & kBreakTarget) == 0);
    CHECK((kActionBreakMask[kActShot] & kBreakTarget) != 0);
    CHECK(kActionBreakMask[kActSwing] == 0); // замах не рвётся ничем

    Acting a{};
    CHECK(acting_begin(a, ActSlot::HandL, kActReload, 100, 0, 10u));
    // ПРИЧИНА ВНЕ МАСКИ ДЕЙСТВИЕ НЕ РВЁТ — и это не отказ, а закон.
    BreakResult wrong = break_action(a, ActSlot::HandL, kBreakTarget, 20u);
    CHECK(!wrong.broken);
    CHECK(acting_busy(a, ActSlot::HandL, 20u));
    // Законная причина — рвёт, и слот свободен тем же тиком.
    BreakResult ok = break_action(a, ActSlot::HandL, kBreakHand, 20u);
    CHECK(ok.broken);
    CHECK(!ok.effectLanded);          // перезарядка контакта не имеет
    CHECK(!acting_busy(a, ActSlot::HandL, 20u));
    CHECK(acting_begin(a, ActSlot::HandL, kActShoot, 5, 0, 20u)); // можно сразу
    // Обрыв свободного слота — не падение и не ложная правда.
    CHECK(!break_action(a, ActSlot::Body, kBreakTarget, 20u).broken);

    // ДО КОНТАКТА — ВОЗВРАТ, ПОСЛЕ — ЭФФЕКТ УПАЛ. Разница ровно та, из-за
    // которой обрыв вообще сообщает что-то вызывающему.
    Acting b{};
    CHECK(acting_begin(b, ActSlot::Body, kActShot, 20, 8, 0u));
    CHECK(!break_action(b, ActSlot::Body, kBreakTarget, 4u).effectLanded);
    Acting c{};
    CHECK(acting_begin(c, ActSlot::Body, kActShot, 20, 8, 0u));
    CHECK(acting_take_apply(c, ActSlot::Body, 8u));
    const BreakResult after = break_action(c, ActSlot::Body, kBreakTarget, 9u);
    CHECK(after.broken);
    CHECK(after.effectLanded);
}

// ---- 5. Слоты независимы --------------------------------------------------
static void test_action_slots_are_independent() {
    Acting a{};
    CHECK(acting_begin(a, ActSlot::HandL, kActReload, 100, 0, 0u));
    // Правая рука и тело свободны — «один слот не должен знать о втором».
    CHECK(!acting_busy(a, ActSlot::HandR, 0u));
    CHECK(!acting_busy(a, ActSlot::Body, 0u));
    CHECK(acting_begin(a, ActSlot::HandR, kActShoot, 10, 0, 0u));
    CHECK(acting_begin(a, ActSlot::Body, kActSwing, 50, 0, 0u));
    // Три разных рода одновременно, и каждый свой.
    CHECK(acting_what(a, ActSlot::HandL, 0u) == kActReload);
    CHECK(acting_what(a, ActSlot::HandR, 0u) == kActShoot);
    CHECK(acting_what(a, ActSlot::Body, 0u) == kActSwing);
    // Обрыв одного не трогает остальных.
    CHECK(break_action(a, ActSlot::HandL, kBreakHand, 5u).broken);
    CHECK(acting_busy(a, ActSlot::HandR, 5u));
    CHECK(acting_busy(a, ActSlot::Body, 5u));
    // Фаза окна — время клипа анимации, и оно БЕСПЛАТНО (вывод, не поле).
    CHECK(acting_phase_e3(a, ActSlot::Body, 0u) == 0);
    CHECK(acting_phase_e3(a, ActSlot::Body, 25u) == 500);
    CHECK(acting_phase_e3(a, ActSlot::Body, 50u) == 1000);  // окно кончилось
    CHECK(acting_phase_e3(a, ActSlot::HandL, 5u) == 1000);  // свободен
}

// ---- 6. Перевод миллисекунд сверяется с ЭМУЛЯЦИЕЙ декремента -------------
static void test_action_ms_matches_the_dead_decrement() {
    // Прежний код вычитал ровно `kSimStepMs` за тик и считался занятым, пока
    // остаток больше нуля. Эмулируем его и требуем ТО ЖЕ число тиков — иначе
    // свод пяти таймеров поменял бы темп каждого оружия и моба.
    const std::uint32_t probes[] = {0u, 1u, 7u, 8u, 9u, 340u, 500u, 520u,
                                    1000u, 1234u, 65535u};
    for (std::uint32_t ms : probes) {
        std::uint32_t left = ms;
        std::uint32_t ticks = 0;
        while (left > 0) {
            left = left > static_cast<std::uint32_t>(kSimStepMs)
                       ? left - static_cast<std::uint32_t>(kSimStepMs)
                       : 0u;
            ++ticks;
        }
        CHECK(ms_to_ticks(ms) == ticks);
    }
    // И самое важное следствие: кулак (340 мс) занимает 43 тика, а не 42.
    CHECK(ms_to_ticks(340u) == 43u);
    CHECK(ms_to_ticks(520u) == 65u); // 0.52 с макарова делится ровно
}

// ---- 7. Снимок едет остатком ----------------------------------------------
static void test_action_snapshot_rides_the_remainder() {
    Acting a{};
    CHECK(acting_begin(a, ActSlot::HandL, kActReload, 100, 0, 1000u));
    CHECK(acting_begin(a, ActSlot::Body, kActShot, 40, 10, 1000u));
    CHECK(acting_take_apply(a, ActSlot::Body, 1010u));

    // Снимаем на тике 1030: руке осталось 70, телу 10, контакт у тела снят.
    const ActingSnap s = acting_snap(a, 1030u);
    CHECK(s.slot[0].durTicks == 100);
    CHECK(s.slot[0].remainTicks == 70);
    CHECK(s.slot[0].action == kActReload);
    CHECK(s.slot[1].remainTicks == 0);   // свободная рука едет нулями
    CHECK(s.slot[2].remainTicks == 10);
    CHECK(s.slot[2].applied == 1);

    // ВОССТАНОВЛЕНИЕ НА ДРУГИЕ ЧАСЫ — то, из-за чего остаток и едет: после
    // перезапуска `simTick` начинается с нуля, и абсолютный тик начала оставил
    // бы руку занятой навсегда.
    const Acting back = acting_restore(s, /*now*/ 7u);
    CHECK(acting_what(back, ActSlot::HandL, 7u) == kActReload);
    CHECK(acting_busy(back, ActSlot::HandL, 76u));
    CHECK(!acting_busy(back, ActSlot::HandL, 77u));   // 7 + 70 остатка
    CHECK(!acting_busy(back, ActSlot::HandR, 7u));
    CHECK(acting_busy(back, ActSlot::Body, 16u));
    CHECK(!acting_busy(back, ActSlot::Body, 17u));
    CHECK(acting_applied(back, ActSlot::Body));       // контакт не падает дважды
    CHECK(!acting_take_apply(const_cast<Acting&>(back), ActSlot::Body, 16u));

    // Пустой снимок — свободный носитель, а не занятый нулями.
    const Acting empty = acting_restore(ActingSnap{}, 500u);
    CHECK(!acting_any(empty, 500u));
    // Битый снимок (остаток больше окна) не делает занятость длиннее окна.
    ActingSnap bad{};
    bad.slot[0] = ActWindowSnap{10u, 99u, 0u, kActShoot, 0u};
    const Acting fixed = acting_restore(bad, 0u);
    CHECK(act_slot(fixed, ActSlot::HandL).durTicks == 10);
    CHECK(!acting_busy(fixed, ActSlot::HandL, 10u));
}

} // namespace action_suite

static void test_action_all() {
    action_suite::test_action_busy_is_a_question();
    action_suite::test_action_is_monotone();
    action_suite::test_action_apply_frame();
    action_suite::test_action_break_is_one_door();
    action_suite::test_action_slots_are_independent();
    action_suite::test_action_ms_matches_the_dead_decrement();
    action_suite::test_action_snapshot_rides_the_remainder();
}
