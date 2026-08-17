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

} // namespace giga
