#include "game/npc_pool.h"

#include "game/floor_registry.h"   // kMinFloor / kFloorSlots for the bucket index

#include <cstring>

namespace giga::game {

namespace {

// Grow a lazily-sized column to cover `rows` records, geometrically.
//
// Geometric and not fixed-chunk on purpose: vector::resize(n) allocates for n and
// does not over-reserve, so resizing by a constant step copies the whole column at
// every boundary. At the kNpcActiveTarget of 950k that is 232 boundaries for rel_,
// averaging ~62 MiB copied each = ~14 GB of memcpy for one world build. Doubling
// makes it amortized O(1) per row: ~8 reallocations total from the kNpcLazyChunk
// floor to 950k, ~2x the final column size copied in aggregate.
template <class T>
void grow_column(std::vector<T>& col, std::uint32_t rows) {
    if (col.size() >= rows) return;
    std::size_t next = col.empty() ? kNpcLazyChunk : col.size() * 2;
    if (next < rows) next = rows;
    if (next > kNpcPoolSize) next = kNpcPoolSize;
    // resize value-initializes the new rows, which for these element types is the
    // same state assign(kNpcPoolSize, T{}) used to produce: zeros for the byte and
    // char arrays, and target == kInvalidNpc for every Relationship (its NSDMI runs,
    // so a fresh relation row reads as "no relation" and not as "a relation with
    // NPC 0" — the distinction test_relationships asserts).
    col.resize(next);
}

// Bytes an allocator is holding for one column. Capacity, not size: capacity is what
// was actually taken from the process, and for the EAGER columns (assign() into a
// fresh vector) it equals kNpcPoolSize exactly.
template <class T>
std::size_t column_bytes(const std::vector<T>& col) {
    return col.capacity() * sizeof(T);
}

// Release a column's memory outright. clear() alone keeps the capacity, so a second
// init() on the same pool would leave a DEMAND column looking materialized (non-empty
// capacity) while reading as never-touched (empty size).
template <class T>
void drop_column(std::vector<T>& col) {
    col.clear();
    col.shrink_to_fit();
}

} // namespace

void NpcPool::init() {
    // EAGER columns: sized once to the full capacity and never resized again, so a
    // reference into one is stable for the pool's whole life. The whole block is
    // zero-initialised, so untouched reserve slots read as blank (not alive, empty
    // inventory). 306 B/row x 2^20 = 306.0 MiB.
    flags_.assign(kNpcPoolSize, 0);
    faction_.assign(kNpcPoolSize, 0);
    hp_.assign(kNpcPoolSize, 0);
    maxHp_.assign(kNpcPoolSize, 0);
    floor_.assign(kNpcPoolSize, 0);
    cx_.assign(kNpcPoolSize, 0);
    cy_.assign(kNpcPoolSize, 0);
    cz_.assign(kNpcPoolSize, 0);
    heightMm_.assign(kNpcPoolSize, 0);
    inv_.assign(kNpcPoolSize, Inventory{});
    // All-zero is deliberately NOT "a healthy body": it reads as seeded == 0,
    // which is what makes an untouched reserve slot mean "clock never rolled"
    // rather than "starving and dehydrated" ([needs.h]).
    needs_.assign(kNpcPoolSize, Needs{});

    // LIVE columns (grown by spawn()) and DEMAND columns (grown by first touch) start
    // at zero bytes. This is the 187.0 MiB that used to be written here for columns
    // nothing in src/ reads — see "Column allocation policy" in the header.
    drop_column(age_);
    drop_column(sex_);
    drop_column(level_);
    drop_column(attr_);
    drop_column(name_);
    drop_column(surname_);
    drop_column(rel_);

    count_ = 0;
    alive_ = 0;

    // The per-floor index is DERIVED state, rebuilt from empty. Fixed at kFloorSlots
    // (255) because that is the entire legal label range; slotInBucket_ is one wide
    // column indexed by id.
    floorBuckets_.assign(static_cast<std::size_t>(kFloorSlots),
                         std::vector<NpcId>{});
    slotInBucket_.assign(kNpcPoolSize, 0u);
}

void NpcPool::grow_live_columns(std::uint32_t rows) {
    grow_column(age_, rows);
    grow_column(sex_, rows);
    grow_column(level_, rows);
    grow_column(attr_, rows);
    // A DEMAND column joins the per-spawn growth set once something has materialized
    // it. That is what keeps relations() / set_name() from resizing after their first
    // call, so spawn() stays the ONLY operation that can invalidate a reference the
    // pool handed out — the same rule std::vector already has, instead of a new one
    // where an innocent-looking accessor call moves someone else's row.
    if (!name_.empty()) grow_column(name_, rows);
    if (!surname_.empty()) grow_column(surname_, rows);
    if (!rel_.empty()) grow_column(rel_, rows);
}

NpcId NpcPool::spawn() {
    if (count_ >= kNpcPoolSize) return kInvalidNpc; // reserve exhausted
    NpcId id = count_++;
    grow_live_columns(count_);
    // Slot came from the zeroed tail; just light the ALIVE bit. (Killed slots
    // below count_ are never handed back out — new NPCs always bump the tail.)
    flags_[id] = NpcAlive;
    ++alive_;
    // Not on any floor until set_floor() places it, so it sits in no bucket and the
    // invariant (floor_[id] == label <-> id in bucket[label]) holds from birth. The
    // zeroed tail would otherwise read floor 0, which is a REAL floor.
    floor_[id] = kNoFloorLabel;
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
    // ...and a corpse is on no floor: drop it from its bucket so a floor roster stays a
    // clean list of the living, which is what streaming enumerates.
    set_floor(id, kNoFloorLabel);
}

// O(1) relabel with the index kept in step. This is the operation macro_sim migration
// needs: a journey landing is a label change, and the reference implementation's linear
// roster scan on every cold move is the hot spot macrosim.md calls out.
void NpcPool::set_floor(NpcId id, std::int16_t label) {
    if (!valid(id)) return;
    const std::int16_t old = floor_[id];
    if (old == label) return;

    // Splice out of the old bucket in O(1): overwrite this id's slot with the bucket's
    // last id, repoint that id's recorded slot, then pop the tail.
    const int oldSlot = bucket_slot(old);
    if (oldSlot >= 0) {
        std::vector<NpcId>& b = floorBuckets_[static_cast<std::size_t>(oldSlot)];
        const std::uint32_t sl = slotInBucket_[id];
        if (sl < b.size()) {
            const NpcId moved = b.back();
            b[sl] = moved;
            slotInBucket_[moved] = sl;
            b.pop_back();
        }
    }

    floor_[id] = label;

    const int newSlot = bucket_slot(label);
    if (newSlot >= 0) {
        std::vector<NpcId>& b = floorBuckets_[static_cast<std::size_t>(newSlot)];
        slotInBucket_[id] = static_cast<std::uint32_t>(b.size());
        b.push_back(id);
    }
}

const std::vector<NpcId>& NpcPool::floor_bucket(std::int16_t label) const {
    static const std::vector<NpcId> kEmpty;
    const int slot = bucket_slot(label);
    if (slot < 0) return kEmpty;
    return floorBuckets_[static_cast<std::size_t>(slot)];
}

std::array<Relationship, kRelSlots>& NpcPool::relations(NpcId id) {
    // First touch materializes 128 B x count() and enrols rel_ in spawn()'s growth
    // set; afterwards this is a size comparison. Sized to count_ rather than id + 1
    // so an out-of-range id stays the out-of-range access it always was rather than
    // becoming a fresh allocation the caller did not ask for; the kNpcLazyChunk floor
    // means the first call covers 4096 rows regardless.
    grow_column(rel_, count_ ? count_ : 1u);
    return rel_[id];
}

void NpcPool::set_name(NpcId id, const char* first, const char* last) {
    if (!valid(id)) return;
    // valid(id) means id < count_, so growing to count_ always covers the row.
    grow_column(name_, count_);
    grow_column(surname_, count_);
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

std::size_t NpcPool::resident_bytes() const {
    return column_bytes(flags_) + column_bytes(faction_) + column_bytes(hp_) +
           column_bytes(maxHp_) + column_bytes(floor_) + column_bytes(cx_) +
           column_bytes(cy_) + column_bytes(cz_) + column_bytes(heightMm_) +
           column_bytes(inv_) + column_bytes(needs_) + column_bytes(age_) +
           column_bytes(sex_) + column_bytes(level_) + column_bytes(attr_) +
           column_bytes(name_) + column_bytes(surname_) + column_bytes(rel_);
}

} // namespace giga::game
