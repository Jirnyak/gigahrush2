#include "game/conversation.h"

#include <cstring>

#include "game/contract.h"   // ContractBook — the quest option reads givers
#include "game/dice.h"       // dice_stake_for — the game row prices itself
#include "game/role.h"       // RoleId — the Duty clerk is the teller
#include "game/embody.h"     // NpcRef — the player's bag is a pool row too

namespace giga::game {

namespace {

// ---------------------------------------------------------------------------
// The option table — [conversation.md] "опция = строка таблицы"
// ---------------------------------------------------------------------------
// Adding an interaction (a game of dice, a recipe lesson, a paid service) is
// one row here: order, label, visibility, activation. The menu is this table
// sorted and filtered; the UI never learns what an option MEANS.

using VisibleFn = bool (*)(const ConvContext&);
using LabelFn = const char* (*)(const ConvContext&);
using ActivateFn = ConvAction (*)(ConvContext&);

struct ConvOptionDef {
    const char* id;
    std::uint16_t order;
    LabelFn label;       // resolved per-context (quest marker)
    VisibleFn visible;   // nullptr = always
    ActivateFn activate;
};

// --- talk -------------------------------------------------------------------
const char* talk_label(const ConvContext&) { return "РАЗГОВОР"; }

ConvAction talk_activate(ConvContext& ctx) {
    ConvAction a;
    a.kind = ConvActionKind::Line;
    if (ctx.pool && ctx.speech && ctx.npc != kInvalidNpc) {
        // The crowd's own voice ([speech.h]): faction bucket, deterministic
        // pick, no-repeat memory. Ambient — the player walked up mid-life, not
        // mid-crisis; the situation resolver is the HUD bark path's job.
        a.line = speech_say(*ctx.speech, ctx.npc, SpeechSituation::Ambient,
                            ctx.pool->faction(ctx.npc), ctx.seed);
    }
    if (!a.line) a.line = "...";
    return a;
}

// --- quest ------------------------------------------------------------------
// Is this NPC the giver of a live contract? Handle comparison, not id: a
// recycled slot's new tenant must not inherit the old tenant's job marker.
bool npc_is_giver(const ConvContext& ctx) {
    if (!ctx.book || !ctx.pool || ctx.npc == kInvalidNpc) return false;
    const NpcHandle h = ctx.pool->handle(ctx.npc);
    for (const Contract& c : ctx.book->slot) {
        if (c.state != static_cast<std::uint8_t>(ContractState::Active)) continue;
        if (c.giver == h) return true;
    }
    return false;
}

const char* quest_label(const ConvContext& ctx) {
    return npc_is_giver(ctx) ? "ЗАДАНИЕ !" : "ЗАДАНИЕ";
}

ConvAction quest_activate(ConvContext& ctx) {
    ConvAction a;
    a.kind = ConvActionKind::Line;
    if (npc_is_giver(ctx)) {
        // The contract detail lives in the contract HUD; the conversation only
        // points there. Saying WHICH numbers would duplicate that surface.
        a.line = "Моя работа за тобой. Список — в контрактах.";
    } else {
        a.line = "Работы для тебя нет.";
    }
    return a;
}

// --- trade ------------------------------------------------------------------
const char* trade_label(const ConvContext&) { return "ТОРГ"; }

ConvAction trade_activate(ConvContext&) {
    ConvAction a;
    a.kind = ConvActionKind::Barter;
    return a;
}

// --- bank — the teller counter ([economy.h], инкремент C) --------------------
// The owner's law: banked is an ACCOUNT and moving cash in and out of it is an
// interaction with a BODY, never pad magic. Who is a banker: the Duty clerk —
// the ведомственная касса — until a dedicated role arrives with the production
// loop. Gated on the ROLE column (a story override can appoint one).
bool bank_visible(const ConvContext& ctx) {
    if (!ctx.pool || ctx.npc == kInvalidNpc) return false;
    return static_cast<RoleId>(ctx.pool->role(ctx.npc)) == RoleId::Duty;
}

const char* bank_label(const ConvContext&) { return "БАНК"; }

ConvAction bank_activate(ConvContext&) {
    ConvAction a;
    a.kind = ConvActionKind::Bank;
    return a;
}

// --- dice — the first GAME row, exactly the shape the table promised ---------
// Visible when the dice are AT THE TABLE — either party's pocket counts, one
// set is enough ([conversation.md]). The row prices itself on activation and
// refuses in words rather than greying out: a broke partner has no stake, a
// broke player cannot cover one, and both answers teach the economy.
bool dice_visible(const ConvContext& ctx) {
    return conv_party_holds(ctx, kItemDiceBone);
}

const char* dice_label(const ConvContext&) { return "КОСТИ"; }

ConvAction dice_activate(ConvContext& ctx) {
    ConvAction a;
    if (!ctx.pool || !ctx.reg) return a;
    const std::int32_t stake = dice_stake_for(*ctx.pool, ctx.npc);
    if (stake <= 0) {
        a.kind = ConvActionKind::Line;
        a.line = "Ставить ему нечего — карман пуст.";
        return a;
    }
    NpcId playerId = kInvalidNpc;
    if (const auto* nr = ctx.reg->try_get<NpcRef>(ctx.player))
        if (ctx.pool->valid(nr->id)) playerId = nr->id;
    if (playerId == kInvalidNpc) return a;
    std::int64_t myRub = 0;
    for (const ItemSlot& s : ctx.pool->inventory(playerId).slots)
        if (s.item == kItemRuble && s.count > 0) myRub += s.count;
    if (myRub < stake) {
        a.kind = ConvActionKind::Line;
        a.line = "Тебе нечем крыть его ставку.";
        return a;
    }
    a.kind = ConvActionKind::Dice;
    return a;
}

// --- leave ------------------------------------------------------------------
const char* leave_label(const ConvContext&) { return "УЙТИ"; }

ConvAction leave_activate(ConvContext&) {
    ConvAction a;
    a.kind = ConvActionKind::Close;
    return a;
}

// Orders follow the reference's spacing so future rows (games at 100..,
// authored services between) land without renumbering: talk 0, quest 10,
// trade 20, leave 9000.
constexpr ConvOptionDef kConvOptions[] = {
    {"talk", 0, talk_label, nullptr, talk_activate},
    {"quest", 10, quest_label, nullptr, quest_activate},
    {"trade", 20, trade_label, nullptr, trade_activate},
    {"bank", 30, bank_label, bank_visible, bank_activate},
    // The games band starts at 100, per the reference's spacing: dice first,
    // durak/domino/checkers land as siblings without renumbering anything.
    {"dice", 100, dice_label, dice_visible, dice_activate},
    {"leave", 9000, leave_label, nullptr, leave_activate},
};
// Authored in order, checked at compile time — conv_options copies, never sorts.
static_assert(kConvOptions[0].order <= kConvOptions[1].order &&
                  kConvOptions[1].order <= kConvOptions[2].order &&
                  kConvOptions[2].order <= kConvOptions[3].order &&
                  kConvOptions[3].order <= kConvOptions[4].order &&
                  kConvOptions[4].order <= kConvOptions[5].order,
              "keep kConvOptions sorted by order; the projection relies on it");

bool option_visible(const ConvOptionDef& def, const ConvContext& ctx) {
    return def.visible == nullptr || def.visible(ctx);
}

} // namespace

std::size_t conv_options(const ConvContext& ctx, ConvOption* out,
                         std::size_t cap) {
    // The table is authored in (order, id) order — asserted, not sorted at
    // runtime, so the projection is a filtered copy and nothing allocates.
    std::size_t n = 0;
    for (const ConvOptionDef& def : kConvOptions) {
        if (!option_visible(def, ctx)) continue;
        if (n >= cap) break;
        out[n].id = def.id;
        out[n].label = def.label(ctx);
        out[n].order = def.order;
        ++n;
    }
    return n;
}

ConvAction conv_activate(ConvContext& ctx, const char* id) {
    if (!id) return {};
    for (const ConvOptionDef& def : kConvOptions) {
        if (std::strcmp(def.id, id) != 0) continue;
        // The menu the player saw is the contract: an option that is not
        // visible right now must not act, however it was asked for.
        if (!option_visible(def, ctx)) return {};
        return def.activate(ctx);
    }
    return {};
}

bool conv_party_holds(const ConvContext& ctx, ItemId item) {
    if (!ctx.pool || ctx.npc == kInvalidNpc || !item_valid(item)) return false;
    auto holds = [item](const Inventory& inv) {
        for (const ItemSlot& s : inv.slots)
            if (s.item == item && s.count > 0) return true;
        return false;
    };
    if (holds(ctx.pool->inventory(ctx.npc))) return true;
    // The player's bag is a pool row too ([npcs.md] — the player is a record).
    if (ctx.reg && ctx.reg->valid(ctx.player)) {
        if (const auto* nr = ctx.reg->try_get<NpcRef>(ctx.player)) {
            if (ctx.pool->valid(nr->id) && holds(ctx.pool->inventory(nr->id)))
                return true;
        }
    }
    return false;
}

} // namespace giga::game
