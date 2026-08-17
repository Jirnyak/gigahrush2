// Conversation — universal NPC interaction, as a table of options.
//
// The owner's law ([conversation.md], 2026-08-17): pressing E on a living NPC
// opens a MENU, not an action. Talk, quest, barter, and every future game of
// dice or checkers are OPTIONS in one extensible system — one row of
// `kConvOptions` each — never a per-feature keybind or a per-feature window.
// The idea (not the code) comes from the reference's npc_interaction_options:
// options carry an order, a visibility predicate and an activation; the menu
// is their sorted, filtered projection.
//
// The seam is the same client-proposes/server-disposes split as all input
// ([netcode.md], [inventory_ui.h]): `conv_activate` RETURNS a ConvAction and
// mutates nothing — no window, no camera, no inventory. The app executes.
//
// Pure game layer: no UI, no platform. Headless-tested in suite_conversation.
#pragma once

#include <cstddef>
#include <cstdint>

#include "ecs/registry.h"
#include "game/item_table.h"  // ItemId — the conv_party_holds affordance gate
#include "game/npc_pool.h"
#include "game/speech.h"      // SpeechMemory — the talk option's voice

namespace giga::game {

struct ContractBook;

// Everything an option's predicate or activation may read. Assembled by the
// app at menu-open; the pool row is the partner's identity (the body is only
// where they stand).
struct ConvContext {
    Registry* reg = nullptr;
    NpcPool* pool = nullptr;
    Entity player = entt::null;
    Entity npcBody = entt::null;
    NpcId npc = kInvalidNpc;
    const ContractBook* book = nullptr;  // quest option: is this NPC a giver
    SpeechMemory* speech = nullptr;      // talk option: no-repeat memory
    std::uint32_t seed = 0;              // deterministic line pick
};

// What the app should do about an activated option.
enum class ConvActionKind : std::uint8_t {
    None = 0,   // nothing (option refused itself at the last moment)
    Line,       // show `line` in the conversation panel, stay open
    Barter,     // switch to the barter-mode search screen ([barter.h])
    Dice,       // put the dice on the table ([dice.h]) — the app starts the game
    Bank,       // open the teller counter ([economy.h] teller verbs)
    Close,      // close the conversation
};

struct ConvAction {
    ConvActionKind kind = ConvActionKind::None;
    const char* line = nullptr;   // Line: static/table-owned text, never freed
};

// One menu row, resolved for display.
struct ConvOption {
    const char* id = "";      // stable slug, what conv_activate takes back
    const char* label = "";   // display text (may carry the quest marker)
    std::uint16_t order = 0;
};

// The most options a menu can show at once; the fixed table is far under it
// and a future games row still fits. A cap, not an allocation.
inline constexpr std::size_t kConvMaxOptions = 16;

// The visible menu for this context, sorted by (order, id). Returns how many
// were written into `out` (at most `cap`).
std::size_t conv_options(const ConvContext& ctx, ConvOption* out,
                         std::size_t cap);

// Activate option `id`. Unknown or currently-invisible ids return None — the
// menu the player saw is the only contract, and a stale id must not act.
ConvAction conv_activate(ConvContext& ctx, const char* id);

// Does either party hold at least one of `item`? The affordance gate the
// game options (dice, cards, dominoes, checkers) use: one set at the table is
// enough, whoever brought it — exactly the reference's rule. Exposed for the
// future rows and tested now, so the seam exists before the first game does.
bool conv_party_holds(const ConvContext& ctx, ItemId item);

} // namespace giga::game
