// Key bindings — the data-driven "key -> console line" table.
//
// The last hardcoded keys lived as an `if` chain in the app's event loop; this
// table replaces them the same way ConsoleCommand replaced key-handler `if`s
// ([console.h]): a binding is a ROW (action name, scancode, console line), the
// app's event loop does ONE lookup per keydown and feeds the row's command to
// Console::exec. Keyboard, pause-menu buttons and typed console lines therefore
// all drive the SAME command rows — rebinding, save/load of bindings and new
// actions are all data edits, never app code.
//
// Pure game layer: no SDL/ImGui. Scancodes are stored as the USB HID usage
// codes SDL scancodes are DEFINED as (SDL_SCANCODE_A == 4, ...), so the table
// can name defaults and stay headless-testable — the same no-dependency stance
// as type_tag<T> vs RTTI. Serialization is a plain text format ("bind <action>
// <scancode>"); the app owns the file I/O, exactly the save.h split.
#pragma once

#include <cstddef>
#include <cstdint>

namespace giga::game {

// The subset of USB HID usage codes the default binds need. Values per the HID
// Usage Tables spec (and therefore per SDL_scancode.h, verbatim).
namespace scan {
inline constexpr std::uint16_t kA = 4, kB = 5, kC = 6, kD = 7, kE = 8, kF = 9,
    kG = 10, kH = 11, kL = 15, kP = 19, kQ = 20, kR = 21, kS = 22, kT = 23, kV = 25,
    kW = 26, kX = 27, kEscape = 41, kTab = 43, kSpace = 44, kLeftBracket = 47,
    kRightBracket = 48, kGrave = 53, kF1 = 58, kF5 = 62, kF9 = 66,
    // Digit row (SDL_SCANCODE_1/2/3). ATTR1 spends unspent points on STR/AGI/INT.
    k1 = 30, k2 = 31, k3 = 32,
    kLCtrl = 224;
} // namespace scan

// One past the highest valid scancode (SDL_SCANCODE_COUNT). Rebinds beyond it
// are refused so a corrupt bindings file can never index the input bridge's
// keyboard-state array out of bounds.
inline constexpr std::uint16_t kScancodeCount = 512;

// Row flags. Default (0) rows fire only during live play — not while the pause
// menu is up and not while a text field owns the keyboard.
inline constexpr std::uint8_t kBindAlways = 1u << 0; // fires while paused too
inline constexpr std::uint8_t kBindTyping = 1u << 1; // fires while typing too

struct KeyBind {
    const char* action = "";  // stable id: the file key and the menu label
    const char* command = ""; // console line run on press; "" = a HELD axis key
                              // (polled by the input bridge, never dispatched)
    std::uint16_t scancode = 0;
    std::uint8_t flags = 0;
};

class KeybindTable {
public:
    static constexpr std::size_t kMaxBinds = 64;

    // Register a row. Refused (false) on a duplicate action, an empty action,
    // or a full table — first registration wins, same rule as Console::add.
    bool add(const KeyBind& b);

    const KeyBind* find(const char* action) const;

    // The first COMMAND row bound to this scancode, or nullptr. Axis rows are
    // skipped, which is what lets one key be both a held axis and a pressed
    // command (Q descends in fly AND works a door, as it always has).
    const KeyBind* find_scancode(std::uint16_t sc) const;

    // Point an existing action at a new key. Unknown action is refused.
    bool rebind(const char* action, std::uint16_t sc);

    // How many OTHER command rows share this row's scancode — a real dispatch
    // ambiguity (only the first fires), surfaced by the menu as a conflict.
    std::uint32_t conflicts(const char* action) const;

    std::size_t count() const { return count_; }
    const KeyBind& at(std::size_t i) const { return binds_[i]; }
    void clear() { count_ = 0; }

    // One "bind <action> <scancode>" line per row. Returns chars written
    // (NUL-terminated, truncated at cap).
    std::size_t serialize(char* out, std::size_t cap) const;

    // Apply "bind ..." lines to EXISTING rows; unknown actions and malformed
    // lines are skipped (a stale file must not invent actions). '#' comments.
    // Returns rows applied.
    std::uint32_t parse(const char* text);

private:
    KeyBind binds_[kMaxBinds] = {};
    std::size_t count_ = 0;
};

// Held movement keys, extracted for the input bridge — these are POLLED every
// tick (SDL_GetKeyboardState), not dispatched on a key edge, so they cross the
// seam as a POD of scancodes rather than as command rows.
struct MoveBinds {
    std::uint16_t fwd = scan::kW;
    std::uint16_t back = scan::kS;
    std::uint16_t left = scan::kA;
    std::uint16_t right = scan::kD;
    std::uint16_t up = scan::kE;        // fly ascend (jump key ascends too)
    std::uint16_t down = scan::kQ;      // fly descend
    std::uint16_t downAlt = scan::kLCtrl;
    std::uint16_t jump = scan::kSpace;
};

// Register the universal default set: every action the app dispatches plus the
// held axis rows. Returns false if any row was refused (a duplicate — pinned
// green by the test suite, like console_register_defaults).
bool keybind_register_defaults(KeybindTable& t);

// The axis rows as a MoveBinds, falling back to the defaults above for any row
// a (stale) table is missing.
MoveBinds keybind_move_binds(const KeybindTable& t);

} // namespace giga::game
