// Кошелёк: деньги как число и как монета, и единственный глагол перехода.
//
// БАНК СНЕСЁН (решение владельца 2026-11-08) — вместе с ним ушли восемь блоков
// этого сьюта. Что они стерегли и почему это больше не закон:
//   * «ничто не чеканит рубли из ниоткуда» — инвариант
//     `banked + deposit - долг` на 400 операциях. Половины инварианта (вклад,
//     принципал, накопленный процент) больше нет; у кассы ниже сохранение
//     проверяется напрямую — сумма монет плюс счёт не меняется.
//   * таблица банд (`kBankTerms`/`kBandNames`, `data/economy.csv`): монотонность
//     колонок, сверка `lootCap` с `kLootValueCap`, дословные колонки референса,
//     попадание каждого этажа в свою банду. Таблица снесена целиком; живой
//     остаток банд — `economy_band()` и `kLootValueCap[]` в [item_table.h],
//     и их стерегут свои тесты.
//   * ветка как чистая функция (сид, этаж), детерминизм начисления, целочисленные
//     границы процента (мёртвая зона вклада, округление кредита ВВЕРХ), кап
//     догона периодов, измеренные «время удвоения» и «цена кредита в час»,
//     неликвидность вклада. Всё это свойства снесённых глаголов.
//
// Остался ЗАКОН КАССЫ, и он принадлежит ядру: наличка в кармане — рублёвый
// ПРЕДМЕТ (в риске, как любой лут), счёт — число (в риске не бывает), а переход
// между ними есть взаимодействие с телом ([economy.h] закон владельца
// 2026-08-17). Два его свойства легко утвердить неверно, и блок ниже проверяет
// именно их: внос забирает КАЖДУЮ монету из всех стопок, а выдача клампится
// ДВАЖДЫ — счётом и физической ёмкостью сумки, причём остаток остаётся НА
// СЧЕТУ, а не исчезает. Тест, который проверял бы только «счёт вырос», прошёл
// бы на кассе, уничтожающей монеты.
//
// Всё, что печатается, измерено прогоном реального целочисленного пути: формула,
// продублированная в тест, согласуется сама с собой, а не с кодом.
//
// This is a .inl and not a .cpp for the reason suite_packs.inl states: game_test.cpp
// owns the CHECK macro, so the include has to land after it, and the suite carries its
// own includes of the systems under test to keep that diff two lines.
//
// ASCII only in every fprintf, deliberately: this host's console is CP1251 and a
// Cyrillic byte would read as corruption.
//
// WIRED: tests/game_test.cpp includes this file beside suite_craft.inl and calls
// `test_economy_all()` from its main, so every assertion below runs inside the shipped
// game_test binary. The source-rules `unwired-suite` exemption this file carried while it
// was waiting for that wire-up is GONE, deleted by the same edit — which is exactly what
// the escape hatch in tools/check_source_rules.cmake asks for. Do not re-add it.
//
// NOTE FOR THE BUILD OWNER: game_test's ctest pass regex pins an exact CHECK total
// (CMakeLists.txt, `game_test: N checks, 0 failures`). This suite contributed 65,850
// checks before the bank was demolished and contributes 18 after, so that pin has to
// move in the same commit — by the number the BINARY prints, not by this arithmetic.

#include <cstdio>

#include "game/economy.h"
#include "game/item_table.h"

static void test_economy_all() {
    { // ---- the teller: banked <-> coins, clamped by physics ----
        // [economy.h] teller verbs — the whole surface that survived the bank.
        // Deposit sweeps every coin; withdraw mints back, clamped by the account
        // AND by what the bag accepts, remainder staying banked (never on the
        // floor).
        Inventory inv{};
        RunLedger led{};
        CHECK(inventory_give(inv, kItemRuble, 65535) == 0);
        CHECK(inventory_give(inv, kItemRuble, 465) == 0);   // second stack
        CHECK(teller_deposit_cash(inv, led) == 66000);
        CHECK(led.banked == 66000);
        CHECK(inv.empty());
        // Depositing an empty bag is a zero, not an error.
        CHECK(teller_deposit_cash(inv, led) == 0);

        // Withdraw a slice; the account shrinks by exactly what LANDED.
        CHECK(teller_withdraw_cash(inv, led, 1000) == 1000);
        CHECK(led.banked == 65000);
        std::int64_t cash = 0;
        for (const ItemSlot& sl : inv.slots)
            if (sl.item == kItemRuble) cash += sl.count;
        CHECK(cash == 1000);
        // Сохранение, без снесённого банка: счёт плюс наличка — то же число,
        // что внесли. Это та половина «ничто не чеканит рубли», которая
        // переживает снос — касса есть ПЕРЕВОД, и только.
        CHECK(led.banked + cash == 66000);
        // Asking past the account clamps to it...
        CHECK(teller_withdraw_cash(inv, led, 90000) == 65000);
        CHECK(led.banked == 0);
        // ...and a FULL bag under-withdraws, coins staying banked, none minted
        // into the void.
        led.banked = 500;
        Inventory full{};
        ItemId one = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i)
            if (i != kItemRuble && item_def(i).stackMax == 1) { one = i; break; }
        CHECK(one != kInvalidItem);
        for (int i = 0; i < kInvSlots; ++i) full.slots[i] = ItemSlot{one, 1};
        CHECK(teller_withdraw_cash(full, led, 500) == 0);
        CHECK(led.banked == 500);
        // Ноль и отрицательная сумма — no-op, а не перевод со сменой знака.
        CHECK(teller_withdraw_cash(inv, led, 0) == 0);
        CHECK(teller_withdraw_cash(inv, led, -500) == 0);
        CHECK(led.banked == 500);
        std::fprintf(stderr,
                     "[economy] teller: 66,000 in two stacks banked whole; "
                     "withdraw clamps to account and to bag space\n");
    }
    // Второе выжившее поле леджера — `deepestFloor`/`deepestBand` — уже
    // покрыто `test_run_depth()` в game_test.cpp (|z| как мера, рекорд в обе
    // стороны). Второй дом тому же закону здесь не завёден нарочно: два теста
    // одного свойства расходятся молча.
}
