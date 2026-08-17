// Окно настроек — ОДНА таблица вкладок на всё приложение ([menu.md]).
//
// Зовётся из двух мест — страница Settings главного меню и страница Settings
// паузы — и это ОДИН код: вход разный, окно то же. Вкладка — строка таблицы
// {id, ярлык, draw}: новая группа настроек = строка, не новая страница-копия.
//
// Шов — заявочный, как у инвентарной сетки ([inventory_ui.h]): виджет рисует
// ЖИВЫЕ объекты по указателям контекста и возвращает «что изменилось»; кто
// сохраняет файл и дёргает SDL — решает app на своей стороне кадра. Настройки
// принадлежат человеку за столом, не персонажу: персист — файл приложения
// рядом с биндами ([main.cpp] save_binds / save_ui_cfg), никогда сейв рана.
#pragma once

#include "game/keybind.h"

namespace giga {

namespace audio { struct AudioConfig; }

// Живые объекты, которые вкладки показывают и правят. nullptr законен —
// вкладка честно пишет «нет» вместо фальшивых ручек.
struct SettingsCtx {
    game::KeybindTable* binds = nullptr;
    // Индекс строки биндов, ждущей клавишу; -1 покоя. Захват клавиши делает
    // event-loop app'а — виджет только просит его, выставляя индекс.
    int* rebindCapture = nullptr;
    bool* crtEnabled = nullptr;   // трубка ([vk_renderer.h] crtEnabled)
    bool* fullscreen = nullptr;   // применяет app (SDL_SetWindowFullscreen)
    audio::AudioConfig* audio = nullptr;  // живой конфиг микшера
};

// Что поменялось за кадр — app сохраняет/применяет по флагам. Сам РЕБИНД
// флага не имеет: захват клавиши и персист делает event-loop app'а, виджет
// лишь выставляет rebindCapture.
struct SettingsRequest {
    bool bindsReset = false;  // «сбросить бинды» -> defaults + save
    bool uiChanged = false;   // тумблер худа / видео / звук -> save_ui_cfg
};

// Нарисовать СОДЕРЖИМОЕ настроек (таб-бар + вкладки) внутрь уже открытого
// окна вызывающего — меню и пауза владеют своим окном и кнопкой Back сами.
SettingsRequest settings_ui_draw(SettingsCtx& ctx);

} // namespace giga
