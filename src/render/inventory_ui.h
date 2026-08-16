// Инвентарная сетка — ОДИН виджет, режимы задаёт политика ([inventory.md]).
//
// Слой строго читающий: виджет рисует живые Inventory/Equipped и ВОЗВРАЩАЕТ
// заявку — применяет её app на сим-клоке через существующие примитивы
// (equip_item, inventory_give, use-пути). Это тот же шов «клиент предлагает —
// сервер решает», что и весь ввод ([netcode.md]): меню не пишет в игру ни
// одного байта само.
//
// Клетка k — слот k, зеркало 8x8 POD без пере-сортировки. Иконки процедурные
// ([item_sprites референс GigaHrush 1]): детерминированный глиф из категории и
// hash(id) прямо в ImDrawList — ноль ассетов, CRT-фосфор из [imgui_layer.cpp].
#pragma once

#include <cstdint>

#include "game/equip.h"
#include "game/inventory.h"

namespace giga {

// Заявка виджета. None — ничего не просили в этом кадре.
struct InvUiRequest {
    enum class Kind : std::uint8_t { None, Equip, Unequip, Use, Drop };
    Kind kind = Kind::None;
    std::uint8_t slot = 0;               // индекс клетки 0..63
    game::EquipSlot eqSlot = game::EquipSlot::None;  // для Unequip
};

// Состояние виджета между кадрами — только UI-шные вещи (курсор), никаких
// игровых данных.
struct InvUiState {
    bool open = false;
    int sel = 0;  // выбранная клетка 0..63
};

// Режим = политика, не второе окно ([inventory.md]). Self-режим: всё можно.
// Контейнер/торговля добавят вторую сетку и цену — сюда же, не копией виджета.
struct InvUiPolicy {
    const char* title = "ИНВЕНТАРЬ";
    bool allowEquip = true;
    bool allowUse = true;
    bool allowDrop = true;
};

// Нарисовать открытый виджет поверх игры и собрать заявку. `carriedG` —
// текущий вес сумки в граммах (читается снаружи, у виджета нет доступа к
// таблицам массы намеренно — он показывает, что дали).
InvUiRequest inventory_ui_draw(InvUiState& st, const InvUiPolicy& policy,
                               const game::Inventory& inv,
                               const game::Equipped* eq,
                               std::uint32_t carriedG);

} // namespace giga
