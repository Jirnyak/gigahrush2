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

    // The per-floor index is derived state, rebuilt here from empty: buckets grow
    // on demand as labels appear, slotInBucket_ is one wide column indexed by id.
    floorBuckets_.clear();
    slotInBucket_.assign(kNpcPoolSize, 0);
    count_ = 0;
}

NpcId NpcPool::spawn() {
    if (count_ >= kNpcPoolSize) return kInvalidNpc; // reserve exhausted
    NpcId id = count_++;
    // Slot came from the zeroed tail; just light the ALIVE bit. (Killed slots
    // below count_ are never handed back out — new NPCs always bump the tail.)
    flags_[id] = NpcAlive;
    // Not on any floor until set_floor() places it — so it sits in no bucket and
    // the index invariant (floor_[id]==label <-> id in bucket[label]) holds from
    // birth. The zeroed tail reads floor 0, which is a REAL floor, so make the
    // "unfloored" state explicit rather than aliasing floor 0.
    floor_[id] = kNoFloorLabel;
    return id;
}

void NpcPool::set_floor(NpcId id, std::uint16_t label) {
    if (!valid(id)) return;
    const std::uint16_t old = floor_[id];
    if (old == label) return;

    // Splice out of the old bucket in O(1): overwrite this id's slot with the
    // bucket's last id, repoint that id's recorded slot, then pop the tail.
    if (old != kNoFloorLabel && old < floorBuckets_.size()) {
        std::vector<NpcId>& b = floorBuckets_[old];
        const std::uint32_t s = slotInBucket_[id];
        const NpcId moved = b.back();
        b[s] = moved;
        slotInBucket_[moved] = s;
        b.pop_back();
    }

    floor_[id] = label;

    // Splice into the new bucket, growing the (small) top-level index to cover
    // this label the first time it is seen.
    if (label != kNoFloorLabel) {
        if (label >= floorBuckets_.size())
            floorBuckets_.resize(static_cast<std::size_t>(label) + 1);
        std::vector<NpcId>& b = floorBuckets_[label];
        slotInBucket_[id] = static_cast<std::uint32_t>(b.size());
        b.push_back(id);
    }
}

const std::vector<NpcId>& NpcPool::floor_bucket(std::uint16_t label) const {
    static const std::vector<NpcId> kEmpty;
    if (label == kNoFloorLabel || label >= floorBuckets_.size()) return kEmpty;
    return floorBuckets_[label];
}

void NpcPool::kill(NpcId id) {
    if (!valid(id)) return;
    // Dead but not reclaimed: clear ALIVE (and EMBODIED), keep the slot & id.
    flags_[id] &= static_cast<std::uint8_t>(~(NpcAlive | NpcEmbodied));
    // A corpse is on no floor: drop it from its bucket so floor rosters stay a
    // clean list of the living (streaming enumerates them). Keeps the invariant.
    set_floor(id, kNoFloorLabel);
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
