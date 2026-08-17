// Окно разговора — меню опций взаимодействия с NPC ([conversation.md]).
//
// Тот же строгий шов, что у inventory_ui: виджет ЧИТАЕТ (заголовок, строку
// последней реплики, готовый список опций) и ВОЗВРАЩАЕТ заявку — id выбранной
// опции либо «закрыть». Что опция значит, знает game-слой (conv_activate);
// какие опции видимы, решил он же (conv_options) ДО отрисовки. Виджет не
// зовёт game-функции сам: список пришёл снаружи, как слоты у сеток.
//
// CRT-эстетика [AGENTS.md]: фосфор на чёрном, нулевые скругления, амбер —
// маркер «!» у опции с живым контрактом.
#pragma once

#include <cstddef>

#include "game/conversation.h"  // ConvOption — the projected menu rows
#include "game/dice.h"          // DiceGame — the dice panel reads it

namespace giga {

// Заявка окна: пустой id — ничего; wantClose — Esc/«уйти» мышью.
struct ConvUiRequest {
    const char* optionId = nullptr;
    bool wantClose = false;
};

// Межкадровое состояние — только курсор.
struct ConvUiState {
    int sel = 0;
};

// `header` — кто перед тобой («ЖИТЕЛЬ / ГРАЖДАНЕ»), `line` — последняя
// реплика (nullptr = ещё молчали), `options`/`n` — готовая проекция меню.
ConvUiRequest conversation_ui_draw(ConvUiState& st, const char* header,
                                   const char* line,
                                   const game::ConvOption* options,
                                   std::size_t n);

// Партия в кости ([dice.h]) — рисуется ВМЕСТО меню, пока стол занят: один
// читатель клавиш на кадр, меню и партия не дерутся за Enter. Тот же шов:
// панель читает POD партии и возвращает нажатия, глаголы зовёт app.
struct DiceUiRequest {
    bool roll = false;       // Enter в ходе игрока
    bool hold = false;       // T — стоп, ход партнёра
    bool surrender = false;  // Esc в живой партии — сдача (платная!)
    bool close = false;      // Enter/Esc по окончании
};

DiceUiRequest dice_ui_draw(const game::DiceGame& g, const char* header);

// Касса ([economy.h] teller) — тоже вместо меню, пока стойка открыта. Панель
// читает два числа и возвращает нажатия; глаголы зовёт app.
struct BankUiRequest {
    bool depositAll = false;   // Enter — вся наличка на счёт
    bool withdraw = false;     // T — снять до 1000 монетами
    bool toDeposit = false;    // D — весь счёт на срочный вклад
    bool fromDeposit = false;  // W — весь вклад назад на счёт
    bool borrow = false;       // L — кредит до лимита ветки
    bool repay = false;        // R — погасить долг со счёта
    bool close = false;        // Esc — от стойки
};

// Стойка теперь полный стол ([economy.h]): счёт/наличка + срочный вклад под
// процент и кредит под процент. Числа читает, глаголы зовёт app.
BankUiRequest bank_ui_draw(std::int64_t banked, std::int64_t cash,
                           std::int64_t deposit, std::int64_t debt,
                           std::int64_t creditFree, const char* header);

} // namespace giga
