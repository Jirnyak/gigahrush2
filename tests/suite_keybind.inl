// Key bindings — the data-driven "key -> console line" table ([keybind.h]).
//
// The contract: bindings are ROWS (duplicate action refused, first wins — the
// Console::add rule); dispatch is find_scancode over COMMAND rows only, so one
// key can be a held axis and a pressed command at once; every default command
// resolves against the default console registry (a typo'd row is a red test,
// not a dead key); serialize/parse round-trips through the text format the app
// writes to gigahrush2.keys.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/console.h"
#include "game/keybind.h"

static void test_keybind_registry_rules() {
    KeybindTable t;
    CHECK(t.add({"probe", "help", 10, 0}));
    // Duplicate action: refused, first registration wins.
    CHECK(!t.add({"probe", "quit", 11, 0}));
    CHECK(t.count() == 1);
    CHECK(!t.add({"", "help", 12, 0})); // no action name
    CHECK(t.find("probe") != nullptr);
    CHECK(t.find("absent") == nullptr);
    CHECK(t.find("probe")->scancode == 10);

    // The default set registers clean and stays clean when a colliding row is
    // added later — this line goes red instead.
    KeybindTable defaults;
    CHECK(keybind_register_defaults(defaults));
    CHECK(defaults.find("fly") != nullptr);
    CHECK(defaults.find("menu") != nullptr);
    CHECK(defaults.find("jump") != nullptr);
    CHECK(defaults.find("interact") != nullptr);
    // ЧИСТКА 2026-08-28 (вердикт владельца): дев-строки и разовые действия
    // с предметами сняты с клавиатуры и живут консольными командами.
    // Пин обратной полярности: они обязаны ОТСУТСТВОВАТЬ, иначе тихо
    // вернутся вместе с чужой правкой.
    CHECK(defaults.find("attr_str") == nullptr);
    CHECK(defaults.find("attr_agi") == nullptr);
    CHECK(defaults.find("attr_int") == nullptr);
    CHECK(defaults.find("floor_up") == nullptr);
    CHECK(defaults.find("floor_down") == nullptr);
    CHECK(defaults.find("elevator") == nullptr);
    CHECK(defaults.find("heal") == nullptr);
    CHECK(defaults.find("eat") == nullptr);
    CHECK(defaults.find("drink") == nullptr);
    CHECK(defaults.find("possess") == nullptr);
    CHECK(defaults.find("grenade") == nullptr);
    CHECK(defaults.find("craft") == nullptr);
    CHECK(defaults.find("scrap") == nullptr);
    // ...и интеракция не делит клавишу ни с чем.
    CHECK(defaults.find("fly_ascend") != nullptr); // ось полёта жива
    CHECK(defaults.conflicts("interact") == 0);
}

static void test_keybind_defaults_resolve_in_console() {
    // Every default binding's command must be a registered console row: the
    // first word of each non-axis command resolves via Console::find. This is
    // the cross-table weld — rename a console command and forget the binding,
    // and THIS goes red rather than a key silently dying.
    Console con;
    CHECK(console_register_defaults(con));
    KeybindTable t;
    CHECK(keybind_register_defaults(t));
    for (std::size_t i = 0; i < t.count(); ++i) {
        const KeyBind& b = t.at(i);
        if (!b.command[0]) continue; // held axis row, never dispatched
        char name[64];
        std::size_t n = 0;
        for (const char* p = b.command;
             *p && *p != ' ' && n + 1 < sizeof name; ++p)
            name[n++] = *p;
        name[n] = '\0';
        CHECK(con.find(name) != nullptr);
    }
}

static void test_keybind_scancode_dispatch() {
    KeybindTable t;
    CHECK(keybind_register_defaults(t));
    // ЕДИНАЯ ИНТЕРАКЦИЯ (решение владельца 2026-08-28): строка "door" (Q)
    // умерла — двери слушают interact (E), как терминал/ящик. Q остаётся
    // только полётной осью (axis rows are polled, not dispatched).
    // ЧИСТКА 2026-08-28: интеракция на F; Q/E остаются ОСЯМИ полёта —
    // осевые строки поллятся, а не диспатчатся, поэтому find_scancode их
    // не возвращает.
    CHECK(t.find_scancode(scan::kQ) == nullptr);
    CHECK(t.find_scancode(scan::kE) == nullptr);
    const KeyBind* fKey = t.find_scancode(scan::kF);
    CHECK(fKey != nullptr);
    CHECK(std::strcmp(fKey->action, "interact") == 0);
    // W is only an axis row — no command to dispatch.
    CHECK(t.find_scancode(scan::kW) == nullptr);
    // A key nothing is bound to.
    CHECK(t.find_scancode(200) == nullptr);
    // The dual use above is by design, not a conflict; two COMMAND rows on one
    // key would be.
    CHECK(t.conflicts("interact") == 0);
    // Реальная неоднозначность: две КОМАНДНЫЕ строки на одной клавише
    // (inventory поверх interact на E — heal-строки больше нет, чистка
    // 2026-08-28).
    CHECK(t.rebind("inventory", scan::kF));
    CHECK(t.conflicts("interact") == 1);
    CHECK(t.conflicts("inventory") == 1);
}

static void test_keybind_rebind_bounds() {
    KeybindTable t;
    CHECK(keybind_register_defaults(t));
    CHECK(t.rebind("fly", scan::kV));
    CHECK(t.find("fly")->scancode == scan::kV);
    CHECK(!t.rebind("absent", scan::kV));
    // Out-of-range scancodes are refused — a corrupt file must never index the
    // keyboard-state array out of bounds ([keybind.h] kScancodeCount).
    CHECK(!t.rebind("fly", kScancodeCount));
    CHECK(!t.rebind("fly", 0xFFFFu));
    CHECK(t.find("fly")->scancode == scan::kV); // untouched by the refusals
}

static void test_keybind_serialize_roundtrip() {
    KeybindTable a;
    CHECK(keybind_register_defaults(a));
    CHECK(a.rebind("fly", scan::kV));
    CHECK(a.rebind("jump", scan::kLCtrl));

    char text[4096];
    const std::size_t n = a.serialize(text, sizeof text);
    CHECK(n > 0);
    CHECK(text[n] == '\0');

    // A fresh default table + the serialized text = the mutated table.
    KeybindTable b;
    CHECK(keybind_register_defaults(b));
    const std::uint32_t applied = b.parse(text);
    CHECK(applied == static_cast<std::uint32_t>(b.count()));
    CHECK(b.find("fly")->scancode == scan::kV);
    CHECK(b.find("jump")->scancode == scan::kLCtrl);

    // Unknown actions, comments and garbage are skipped, never invented.
    KeybindTable c;
    CHECK(keybind_register_defaults(c));
    const std::size_t before = c.count();
    CHECK(c.parse("# comment\nbind no_such_action 30\nnot a bind line\n"
                  "bind fly 999999\nbind fly 5\n") == 1);
    CHECK(c.count() == before);
    CHECK(c.find("no_such_action") == nullptr);
    CHECK(c.find("fly")->scancode == 5);
}

static void test_keybind_move_binds() {
    KeybindTable t;
    CHECK(keybind_register_defaults(t));
    MoveBinds m = keybind_move_binds(t);
    CHECK(m.fwd == scan::kW);
    CHECK(m.back == scan::kS);
    CHECK(m.left == scan::kA);
    CHECK(m.right == scan::kD);
    CHECK(m.up == scan::kE);
    CHECK(m.down == scan::kQ);
    CHECK(m.downAlt == scan::kLCtrl);
    CHECK(m.jump == scan::kSpace);
    // A rebound axis row flows through; a missing row falls back to defaults.
    CHECK(t.rebind("move_fwd", scan::kT));
    CHECK(keybind_move_binds(t).fwd == scan::kT);
    KeybindTable empty;
    CHECK(keybind_move_binds(empty).fwd == scan::kW);
}

static void test_keybind_all() {
    test_keybind_registry_rules();
    test_keybind_defaults_resolve_in_console();
    test_keybind_scancode_dispatch();
    test_keybind_rebind_bounds();
    test_keybind_serialize_roundtrip();
    test_keybind_move_binds();
}
