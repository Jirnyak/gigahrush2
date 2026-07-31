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

bool keybind_register_defaults(KeybindTable& t) {
    bool ok = true;
    // Overlay toggles — live even while paused; menu/console also while typing,
    // so the toggle key can always close what it opened.
    ok &= t.add({"menu", "menu", scan::kEscape, static_cast<std::uint8_t>(kBindAlways | kBindTyping)});
    ok &= t.add({"console", "console", scan::kGrave, static_cast<std::uint8_t>(kBindAlways | kBindTyping)});
    ok &= t.add({"hud", "hud", scan::kF1, kBindAlways});
    ok &= t.add({"mouselook", "mouselook", scan::kTab, 0});
    // Movement mode + floor travel.
    ok &= t.add({"fly", "fly", scan::kF, 0});
    ok &= t.add({"floor_up", "ride up", scan::kRightBracket, 0});
    ok &= t.add({"floor_down", "ride down", scan::kLeftBracket, 0});
    // Survival + interaction one-shots.
    ok &= t.add({"heal", "heal", scan::kH, 0});
    ok &= t.add({"eat", "eat", scan::kG, 0});
    ok &= t.add({"drink", "drink", scan::kT, 0});
    ok &= t.add({"door", "door", scan::kQ, 0});
    ok &= t.add({"possess", "possess", scan::kP, 0});
    ok &= t.add({"interact", "interact", scan::kE, 0});
    // Economy + crafting.
    ok &= t.add({"sell", "sell", scan::kB, 0});
    ok &= t.add({"vendor", "vendor", scan::kV, 0});
    ok &= t.add({"resupply", "resupply", scan::kR, 0});
    ok &= t.add({"craft", "craft", scan::kC, 0});
    ok &= t.add({"scrap", "scrap", scan::kX, 0});
    // ATTR1: spend one unspent attribute point (console `attr str|agi|int`).
    ok &= t.add({"attr_str", "attr str", scan::k1, 0});
    ok &= t.add({"attr_agi", "attr agi", scan::k2, 0});
    ok &= t.add({"attr_int", "attr int", scan::k3, 0});
    // Run persistence.
    ok &= t.add({"save", "save", scan::kF5, 0});
    ok &= t.add({"load", "load", scan::kF9, 0});
    // Held axis rows (command "" — polled by the input bridge, rebindable and
    // saved like everything else, never dispatched to the console).
    ok &= t.add({"move_fwd", "", scan::kW, 0});
    ok &= t.add({"move_back", "", scan::kS, 0});
    ok &= t.add({"move_left", "", scan::kA, 0});
    ok &= t.add({"move_right", "", scan::kD, 0});
    ok &= t.add({"fly_ascend", "", scan::kE, 0});
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
