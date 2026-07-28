#include "game/npc_pool.h"

#include <cstring>

namespace giga::game {

void NpcPool::init() {
    // Size every SoA row once to the full capacity and never resize again. The
    // whole table is zero-initialised, so untouched reserve slots read as blank
    // (not alive, no name, empty inventory).
    flags_.assign(kNpcPoolSize, 0);
    faction_.assign(kNpcPoolSize, 0);
    hp_.assign(kNpcPoolSize, 0);
    maxHp_.assign(kNpcPoolSize, 0);
    floor_.assign(kNpcPoolSize, 0);
    cx_.assign(kNpcPoolSize, 0);
    cy_.assign(kNpcPoolSize, 0);
    cz_.assign(kNpcPoolSize, 0);
    age_.assign(kNpcPoolSize, 0);
    sex_.assign(kNpcPoolSize, 0);
    heightMm_.assign(kNpcPoolSize, 0);
    level_.assign(kNpcPoolSize, 0);
    attr_.assign(kNpcPoolSize, std::array<std::uint8_t, kAttrSlots>{});
    name_.assign(kNpcPoolSize, std::array<char, kNameLen>{});
    surname_.assign(kNpcPoolSize, std::array<char, kNameLen>{});
    rel_.assign(kNpcPoolSize, std::array<Relationship, kRelSlots>{});
    inv_.assign(kNpcPoolSize, Inventory{});
    // All-zero is deliberately NOT "a healthy body": it reads as seeded == 0,
    // which is what makes an untouched reserve slot mean "clock never rolled"
    // rather than "starving and dehydrated" ([needs.h]).
    needs_.assign(kNpcPoolSize, Needs{});
    count_ = 0;
    alive_ = 0;
}

NpcId NpcPool::spawn() {
    if (count_ >= kNpcPoolSize) return kInvalidNpc; // reserve exhausted
    NpcId id = count_++;
    // Slot came from the zeroed tail; just light the ALIVE bit. (Killed slots
    // below count_ are never handed back out — new NPCs always bump the tail.)
    flags_[id] = NpcAlive;
    ++alive_;
    return id;
}

void NpcPool::kill(NpcId id) {
    if (!valid(id)) return;
    // Dead but not reclaimed: clear ALIVE (and EMBODIED), keep the slot & id.
    //
    // **NpcPlayer must be cleared here too, and leaving it out was a live bug.**
    // `finalize_deaths` calls kill() and then destroys the entity — it never routes
    // through `fold_back`, which is the only other place the player bit is cleared.
    // So every player death left a permanent record still flagged as the player, and
    // `rel_row` ([faction_relations.h]) hands every one of them faction row 5. The
    // phantom count would have equalled the death counter exactly, growing for the
    // whole session, and nothing would have complained.
    flags_[id] &=
        static_cast<std::uint8_t>(~(NpcAlive | NpcEmbodied | NpcPlayer));
    if (alive_) --alive_;
}

void NpcPool::set_name(NpcId id, const char* first, const char* last) {
    if (!valid(id)) return;
    constexpr std::size_t cap = static_cast<std::size_t>(kNameLen);
    auto copy = [](std::array<char, kNameLen>& dst, const char* src) {
        std::size_t n = 0;
        if (src) {
            for (; n + 1 < cap && src[n]; ++n) dst[n] = src[n];
        }
        for (std::size_t i = n; i < cap; ++i) dst[i] = '\0';
    };
    copy(name_[id], first);
    copy(surname_[id], last);
}

} // namespace giga::game
