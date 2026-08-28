#include "game/keybind.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace giga::game {

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

bool KeybindTable::add(const KeyBind& b) {
    if (!b.action || !*b.action) return false;
    if (count_ >= kMaxBinds) return false;
    if (find(b.action)) return false; // first registration wins, duplicate is loud
    binds_[count_++] = b;
    return true;
}

const KeyBind* KeybindTable::find(const char* action) const {
    if (!action) return nullptr;
    for (std::size_t i = 0; i < count_; ++i)
        if (std::strcmp(binds_[i].action, action) == 0) return &binds_[i];
    return nullptr;
}

const KeyBind* KeybindTable::find_scancode(std::uint16_t sc) const {
    for (std::size_t i = 0; i < count_; ++i)
        if (binds_[i].scancode == sc && binds_[i].command[0]) return &binds_[i];
    return nullptr;
}

bool KeybindTable::rebind(const char* action, std::uint16_t sc) {
    if (!action || sc >= kScancodeCount) return false;
    for (std::size_t i = 0; i < count_; ++i) {
        if (std::strcmp(binds_[i].action, action) != 0) continue;
        binds_[i].scancode = sc;
        return true;
    }
    return false;
}

std::uint32_t KeybindTable::conflicts(const char* action) const {
    const KeyBind* self = find(action);
    if (!self || !self->command[0]) return 0; // axis rows share keys by design
    std::uint32_t n = 0;
    for (std::size_t i = 0; i < count_; ++i) {
        const KeyBind& b = binds_[i];
        if (&b == self || !b.command[0]) continue;
        if (b.scancode == self->scancode) ++n;
    }
    return n;
}

std::size_t KeybindTable::serialize(char* out, std::size_t cap) const {
    if (!out || cap == 0) return 0;
    std::size_t at = 0;
    out[0] = '\0';
    for (std::size_t i = 0; i < count_; ++i) {
        const int n = std::snprintf(out + at, cap - at, "bind %s %u\n",
                                    binds_[i].action, binds_[i].scancode);
        if (n < 0 || at + static_cast<std::size_t>(n) >= cap) break;
        at += static_cast<std::size_t>(n);
    }
    return at;
}

std::uint32_t KeybindTable::parse(const char* text) {
    if (!text) return 0;
    std::uint32_t applied = 0;
    const char* p = text;
    while (*p) {
        // One line at a time, in place — no allocation, a bad line is skipped.
        const char* eol = p;
        while (*eol && *eol != '\n') ++eol;

        char line[128];
        const std::size_t len = static_cast<std::size_t>(eol - p);
        if (len > 0 && len + 1 < sizeof line && *p != '#') {
            std::memcpy(line, p, len);
            line[len] = '\0';

            char action[64] = {};
            unsigned int sc = 0;
            if (std::sscanf(line, "bind %63s %u", action, &sc) == 2 &&
                sc <= 0xFFFFu) {
                if (rebind(action, static_cast<std::uint16_t>(sc))) ++applied;
            }
        }
        p = *eol ? eol + 1 : eol;
    }
    return applied;
}

// ---------------------------------------------------------------------------
// Defaults — the rows the hardcoded `if` chain used to be
// ---------------------------------------------------------------------------

// ЧИСТКА КЛАВИШ 2026-08-28 (вердикт владельца: «за всю историю проекта в
// интерфейсах и клавишах насрано»). СНЯТЫ С КЛАВИАТУРЫ 14 строк:
//   * дев-инструменты — attr_str/agi/int (прокачка с клавиатуры!), possess,
//     scrap, floor_up/floor_down (телепорт), elevator (L — заменён панелью
//     кабины), fly_ascend (висел на той же E, что интеракция — конфликт);
//   * действия с ПРЕДМЕТАМИ — heal/eat/drink (место в инвентаре: использовать
//     предмет), craft (верстак-интерактив), grenade (слот оружия).
// Все они остаются КОНСОЛЬНЫМИ командами: механика жива, кнопки нет.
// Закон, по которому чистили: клавиша существует для того, что делают
// НЕПРЕРЫВНО (движение, взгляд, прыжок, интеракция) либо для мета-экранов
// (меню, консоль, худ, инвентарь). Разовое действие с предметом — это
// предмет, а не клавиша.
bool keybind_register_defaults(KeybindTable& t) {
    bool ok = true;
    // Overlay toggles — live even while paused; menu/console also while typing,
    // so the toggle key can always close what it opened.
    ok &= t.add({"menu", "menu", scan::kEscape, static_cast<std::uint8_t>(kBindAlways | kBindTyping)});
    ok &= t.add({"console", "console", scan::kGrave, static_cast<std::uint8_t>(kBindAlways | kBindTyping)});
    ok &= t.add({"hud", "hud", scan::kF1, kBindAlways});
    // kBindTyping: пока сетка открыта, обычные бинды подавлены как при вводе
    // текста ([main.cpp] typing-гейт) — а этот обязан пробиться, чтобы клавиша
    // могла закрыть то, что открыла. Тот же приём, что у console.
    ok &= t.add({"inventory", "inventory", scan::kI,
                 static_cast<std::uint8_t>(kBindTyping)});
    ok &= t.add({"mouselook", "mouselook", scan::kTab, 0});
    // Movement mode + floor travel.
    // fly НЕ имеет клавиши по умолчанию (решение владельца, плейтест
    // 2026-08-18): полёт — отладочный режим, ему место в консоли (`fly`),
    // а не на F посреди боевой раскладки. Строка остаётся — ребинд в
    // настройках может вернуть клавишу тому, кому она нужна.
    ok &= t.add({"fly", "fly", 0, 0});
    // L for lift. The shaft menu offers the SAME three transitions the two rows
    // above already are, plus fast travel — it adds a place to choose, not a
    // mechanism ([fast_travel.h]). `[` and `]` keep working from anywhere.
    // Survival + interaction one-shots.
    // "door"-строка (Q) умерла 2026-08-28: единая интеракция — двери
    // слушают interact (E), как все потребители (решение владельца).
    ok &= t.add({"interact", "interact", scan::kE, 0});
    // Z and not the genre's G, because G is `eat` and has been since before there
    // was anything to throw. Rebinding a shipped key to make room for a new one is
    // churn the table exists to avoid — that is what the rebind menu is for.
    // Economy + crafting.
    // kBindTyping у оконных тумблеров: открытое окно глушит обычные бинды
    // ([main.cpp] typing-гейт), а СВОЯ клавиша обязана пробиться и закрыть
    // то, что открыла — тот же приём, что console и inventory.
    // ATTR1: spend one unspent attribute point (console `attr str|agi|int`).
    // Run persistence.
    ok &= t.add({"save", "save", scan::kF5, 0});
    ok &= t.add({"load", "load", scan::kF9, 0});
    // Held axis rows (command "" — polled by the input bridge, rebindable and
    // saved like everything else, never dispatched to the console).
    ok &= t.add({"move_fwd", "", scan::kW, 0});
    ok &= t.add({"move_back", "", scan::kS, 0});
    ok &= t.add({"move_left", "", scan::kA, 0});
    ok &= t.add({"move_right", "", scan::kD, 0});
    ok &= t.add({"fly_descend", "", scan::kQ, 0});
    ok &= t.add({"fly_descend_alt", "", scan::kLCtrl, 0});
    ok &= t.add({"jump", "", scan::kSpace, 0});
    return ok;
}

MoveBinds keybind_move_binds(const KeybindTable& t) {
    MoveBinds m; // defaults, overwritten per present row
    struct Row {
        const char* action;
        std::uint16_t MoveBinds::*slot;
    };
    static constexpr Row kRows[] = {
        {"move_fwd", &MoveBinds::fwd},       {"move_back", &MoveBinds::back},
        {"move_left", &MoveBinds::left},     {"move_right", &MoveBinds::right},
        {"fly_ascend", &MoveBinds::up},      {"fly_descend", &MoveBinds::down},
        {"fly_descend_alt", &MoveBinds::downAlt}, {"jump", &MoveBinds::jump},
    };
    for (const Row& r : kRows)
        if (const KeyBind* b = t.find(r.action)) m.*(r.slot) = b->scancode;
    return m;
}

} // namespace giga::game
