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
    drop_column(role_);
    drop_column(attr_);
    drop_column(name_);
    drop_column(surname_);
    drop_column(rel_);

    // gen_ is LIVE and nextFree_ is DEMAND, so both start at zero bytes like the rest of
    // their class. Dropping gen_ here means a re-init()ed pool starts every slot at
    // generation 0 again — correct, because init() also resets count_, so no handle
    // minted against the old pool can pass handle_valid() by id anyway once the new pool
    // has fewer rows, and a caller holding handles across an init() has already lost.
    drop_column(gen_);
    drop_column(nextFree_);

    count_ = 0;
    alive_ = 0;
    freeHead_ = kInvalidNpc;
    freeTail_ = kInvalidNpc;
    freeCount_ = 0;
    recycled_ = 0;
    // recycle_ is deliberately NOT reset: it is a policy the owner of the pool set, not
    // state the table accumulated, and silently disarming it inside init() would make
    // `pool.set_recycling(true); pool.init();` a no-op that looks like it worked.

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
    grow_column(role_, rows);
    grow_column(attr_, rows);
    grow_column(gen_, rows);
    // A DEMAND column joins the per-spawn growth set once something has materialized
    // it. That is what keeps relations() / set_name() from resizing after their first
    // call, so spawn() stays the ONLY operation that can invalidate a reference the
    // pool handed out — the same rule std::vector already has, instead of a new one
    // where an innocent-looking accessor call moves someone else's row.
    if (!name_.empty()) grow_column(name_, rows);
    if (!surname_.empty()) grow_column(surname_, rows);
    if (!rel_.empty()) grow_column(rel_, rows);
    if (!nextFree_.empty()) grow_column(nextFree_, rows);
}

void NpcPool::set_recycling(bool on) {
    // Idempotent: a redundant arm/disarm costs nothing, so a caller may arm defensively
    // (on load, at the top of a session) without thinking about whether it already did.
    // This return is NOT what stops a double-enqueue — do not read it as the guarantee.
    // The queue's uniqueness comes from rebuild_free_list() RESETTING the list before it
    // scans, so even a repeated rebuild re-derives the same set; deleting that reset
    // because this line looks like it covers the case is the way to break it.
    if (on == recycle_) return;
    recycle_ = on;
    if (on) {
        // Arming is the MIRROR of disarming: disarming drops the queue, so arming has to
        // re-derive it or the two are asymmetric and slots leak. Every dead slot below the
        // high-water mark is reclaimable — the alive bit is the whole truth about that —
        // so re-derive rather than require the caller to arm before the first death.
        // Without this, `pool.init(); seed(); ...deaths...; set_recycling(true);` keeps
        // the wall it was armed to close, and reserve_remaining() reports slots spawn()
        // will never hand out.
        rebuild_free_list();
        return;
    }
    // Disarming forgets the queue rather than leaving it to be drained by a pool that no
    // longer recycles. That keeps `free_slots() > 0` equivalent to "recycling is on", so
    // reserve_remaining() never promises a slot spawn() will refuse to hand out.
    freeHead_ = kInvalidNpc;
    freeTail_ = kInvalidNpc;
    freeCount_ = 0;
}

void NpcPool::rebuild_free_list() {
    // Ascending id, so the order is a pure function of the alive bits and nothing else —
    // no address, no hash, no container iteration order. That is the same determinism
    // property kill order has ([npc_pool.h] "Slot recycling"), which is why a rebuilt
    // queue is safe to hand to a society whose every decision is `hash(id, tick, salt)`.
    //
    // Starts from an EMPTY queue by contract (only the OFF->ON transition calls this),
    // but clears anyway: a rebuild that appended to a stale list would duplicate slots,
    // and this is one branch, not a hot path.
    freeHead_ = kInvalidNpc;
    freeTail_ = kInvalidNpc;
    freeCount_ = 0;
    // Load-bearing, not a fast path: a pool whose init() has never run has an EMPTY
    // flags_ column, and count_ == 0 is the only thing that stops the scan below from
    // indexing it. `set_recycling(true)` before `init()` is legal (init() deliberately
    // does not reset recycle_), so this case is reachable.
    if (count_ == 0u) return;
    for (NpcId id = 0; id < count_; ++id) {
        if (flags_[id] & NpcAlive) continue;
        push_free(id);
    }
}

void NpcPool::push_free(NpcId id) {
    // First recycled death materializes the link column. Sized to count_ (never id + 1)
    // for the same reason relations() is: growth is a property of how many records exist,
    // not of which one happened to die first.
    grow_column(nextFree_, count_ ? count_ : 1u);
    nextFree_[id] = kInvalidNpc;
    if (freeTail_ == kInvalidNpc) freeHead_ = id;   // list was empty
    else                         nextFree_[freeTail_] = id;
    freeTail_ = id;
    ++freeCount_;
}

NpcId NpcPool::pop_free() {
    if (freeCount_ == 0u) return kInvalidNpc;
    const NpcId id = freeHead_;
    freeHead_ = nextFree_[id];
    if (freeHead_ == kInvalidNpc) freeTail_ = kInvalidNpc;  // list is now empty
    nextFree_[id] = kInvalidNpc;
    --freeCount_;
    return id;
}

// Blank a row so a reused slot is indistinguishable from a virgin one. Every column the
// pool owns is listed here ON PURPOSE — an omission is not a compile error, it is a
// corpse's inventory turning up inside a newborn, or a dead man's relationship edges
// deciding who a child likes. The order follows the header's column list so the two can
// be diffed by eye.
void NpcPool::reset_row(NpcId id) {
    // Floor membership FIRST, and through set_floor(), because the bucket index is the
    // one piece of state a direct write cannot fix: kill() already evicted the record, so
    // this is normally a no-op, but a record whose alive bit was cleared without going
    // through kill() can still be sitting in a roster, and reviving it into a second
    // bucket entry would corrupt the index for an unrelated id.
    if (floor_[id] != kNoFloorLabel) set_floor(id, kNoFloorLabel);
    slotInBucket_[id] = 0u;

    // EAGER columns.
    flags_[id] = 0;
    faction_[id] = 0;
    hp_[id] = 0;
    maxHp_[id] = 0;
    cx_[id] = 0;
    cy_[id] = 0;
    cz_[id] = 0;
    heightMm_[id] = 0;
    inv_[id] = Inventory{};
    // Needs{} is NOT all-zero in meaning: `seeded == 0` is "clock never rolled", which is
    // what a fresh body must read as rather than "starving and dehydrated" ([needs.h]).
    needs_[id] = Needs{};

    // LIVE columns. Sized to cover count_ and id < count_, so the bounds are structural;
    // the guards are here because a reset that silently skipped a row would be worse than
    // a crash and this is the cheapest place to be sure.
    if (id < age_.size()) age_[id] = 0;
    if (id < sex_.size()) sex_[id] = SexUnset;
    if (id < level_.size()) level_[id] = 0;
    if (id < role_.size()) role_[id] = 0;
    if (id < attr_.size()) attr_[id] = std::array<std::uint8_t, kAttrSlots>{};
    // gen_ is deliberately NOT reset — it is the whole point of the generation counter.

    // DEMAND columns: only if something materialized them.
    if (id < name_.size()) name_[id].fill('\0');
    if (id < surname_.size()) surname_[id].fill('\0');
    if (id < rel_.size()) {
        // Per-element assignment, not a memset: an empty edge is `target == kInvalidNpc`
        // (Relationship's NSDMI), and 16 zeroed edges would read as sixteen relationships
        // with NPC 0 — exactly the distinction test_relationships pins.
        for (Relationship& r : rel_[id]) r = Relationship{};
    }
}

NpcId NpcPool::spawn() {
    // Recycled slots first. This is the whole reason the free list exists: the tail is a
    // finite draw (98,576 slots at design size) and deaths refill the queue forever, so a
    // long society run holds its population here instead of decaying once the plast is
    // gone. The pop is O(1) and takes the OLDEST death, so the id sequence is a pure
    // function of the kill order and two identical runs stay bit-identical.
    if (recycle_ && freeCount_ != 0u) {
        const NpcId id = pop_free();
        ++recycled_;
        // Blank every column BEFORE the alive bit goes on, so no reader can ever observe
        // a live record still carrying the previous occupant's row.
        reset_row(id);
        flags_[id] = NpcAlive;
        ++alive_;
        floor_[id] = kNoFloorLabel;
        return id;
    }

    if (count_ >= kNpcPoolSize) return kInvalidNpc; // reserve exhausted
    NpcId id = count_++;
    grow_live_columns(count_);
    // Slot came from the zeroed tail; just light the ALIVE bit.
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
    // IDEMPOTENT, and this guard is the fix for a live bookkeeping bug: the body below
    // used to run unconditionally with `if (alive_) --alive_;` at the end, so killing an
    // already-dead id decremented the counter a SECOND time. `count()` stayed right and
    // `alive(id)` stayed right, so nothing looked wrong — `alive()` just drifted below the
    // truth, permanently and by exactly the number of double-kills. Two callers can
    // legitimately race to the same corpse (`finalize_deaths` on an entity whose record a
    // macro sweep already retired, a mob death resolved twice in one frame), and with
    // recycling armed the old code was worse than a wrong HUD number: a second kill would
    // queue the same slot twice, and the free list would then hand one id to two records.
    if (!(flags_[id] & NpcAlive)) return;
    // Dead: clear ALIVE (and EMBODIED), keep the slot & id.
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
    // Unconditional, because the guard above already proved this record was counted. The
    // old `if (alive_)` clamp looked safe and was the thing hiding the drift: it made the
    // counter saturate at 0 instead of underflowing, so the bug produced plausible small
    // numbers rather than a 4-billion one that someone would have noticed.
    --alive_;
    // ...and a corpse is on no floor: drop it from its bucket so a floor roster stays a
    // clean list of the living, which is what streaming enumerates.
    set_floor(id, kNoFloorLabel);

    // Every handle minted while this record lived is now stale, whether or not the slot
    // is ever reused. Bumped before the slot is queued so a spawn() that pops it
    // immediately cannot hand out a handle that still matches the corpse's. The counter
    // skips kInvalidGen so no live handle can ever equal kInvalidHandle.
    if (id < gen_.size()) {
        const std::uint16_t next = static_cast<std::uint16_t>(gen_[id] + 1u);
        gen_[id] = next >= kInvalidGen ? static_cast<std::uint16_t>(0) : next;
    }

    if (recycle_) push_free(id);
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
           column_bytes(sex_) + column_bytes(level_) + column_bytes(role_) +
           column_bytes(attr_) +
           column_bytes(name_) + column_bytes(surname_) + column_bytes(rel_) +
           column_bytes(gen_) + column_bytes(nextFree_);
}

// ---------------------------------------------------------------------------
// Wholesale serialization ([save.h] v6) — the flat table, written flat.
// ---------------------------------------------------------------------------
namespace {

// Local little-endian byte plumbing, same discipline as save.cpp's Writer /
// Reader (which are deliberately file-local there): no struct memcpy ever
// reaches the wire, so padding and host byte order cannot either.
void put_u8(std::vector<std::uint8_t>& o, std::uint8_t v) { o.push_back(v); }
void put_u16(std::vector<std::uint8_t>& o, std::uint16_t v) {
    o.push_back(static_cast<std::uint8_t>(v & 0xFFu));
    o.push_back(static_cast<std::uint8_t>((v >> 8) & 0xFFu));
}
void put_u32(std::vector<std::uint8_t>& o, std::uint32_t v) {
    for (int i = 0; i < 4; ++i)
        o.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
}
void put_i16(std::vector<std::uint8_t>& o, std::int16_t v) {
    put_u16(o, static_cast<std::uint16_t>(v));
}
void put_f32(std::vector<std::uint8_t>& o, float v) {
    std::uint32_t b = 0;
    std::memcpy(&b, &v, sizeof b);
    put_u32(o, b);
}

struct ByteReader {
    const std::uint8_t* p;
    std::size_t n;
    std::size_t at = 0;
    bool ok = true;
    std::uint8_t u8() {
        if (at >= n) { ok = false; return 0; }
        return p[at++];
    }
    std::uint16_t u16() {
        const std::uint32_t a = u8(), b = u8();
        return static_cast<std::uint16_t>(a | (b << 8));
    }
    std::uint32_t u32() {
        std::uint32_t v = 0;
        for (int i = 0; i < 4; ++i) v |= static_cast<std::uint32_t>(u8()) << (i * 8);
        return v;
    }
    std::int16_t i16() { return static_cast<std::int16_t>(u16()); }
    float f32() {
        const std::uint32_t b = u32();
        float v = 0;
        std::memcpy(&v, &b, sizeof v);
        return v;
    }
};

// Fixed per-row wire width: 28 B of demographic columns (flags 1 + faction 2 +
// hp/maxHp/floor 6 + cell 3 + height 2 + age/sex/level/role 4 + attrs 8 + gen 2)
// + 37 B needs (v11: +hpBank, [save.h]) + 320 B inventory (v14: u16 count makes
// the slot 5 B on the wire); names add 2 x kNameLen when present.
inline constexpr std::size_t kPoolRowWire = 28 + 37 + 320;
inline constexpr std::size_t kPoolHeadWire = 4 + 4 + 1 + 1;

} // namespace

void NpcPool::save_rows(std::vector<std::uint8_t>& out) const {
    out.clear();
    const bool names = !name_.empty();
    out.reserve(kPoolHeadWire +
                static_cast<std::size_t>(count_) *
                    (kPoolRowWire + (names ? 2 * kNameLen : 0)));
    put_u32(out, count_);
    put_u32(out, recycled_);
    put_u8(out, recycle_ ? 1 : 0);
    put_u8(out, names ? 1 : 0);
    for (NpcId id = 0; id < count_; ++id) {
        // Embodiment is a property of a BODY, and bodies never survive a save.
        put_u8(out, flags_[id] & static_cast<std::uint8_t>(~NpcEmbodied));
        put_u16(out, faction_[id]);
        put_i16(out, hp_[id]);
        put_i16(out, maxHp_[id]);
        put_i16(out, floor_[id]);
        put_u8(out, cx_[id]);
        put_u8(out, cy_[id]);
        put_u8(out, cz_[id]);
        put_u16(out, heightMm_[id]);
        put_u8(out, id < age_.size() ? age_[id] : 0);
        put_u8(out, id < sex_.size() ? sex_[id] : SexUnset);
        put_u8(out, id < level_.size() ? level_[id] : 0);
        // The role column travels: it is a writable OVERRIDE ([role.h]), and a
        // reload that re-derived it from role_for() would undo every story event.
        put_u8(out, id < role_.size() ? role_[id] : 0);
        const std::array<std::uint8_t, kAttrSlots> blank{};
        const auto& a = id < attr_.size() ? attr_[id] : blank;
        for (std::uint8_t v : a) put_u8(out, v);
        put_u16(out, id < gen_.size() ? gen_[id] : 0);
        const Needs& nd = needs_[id];
        put_f32(out, nd.food);
        put_f32(out, nd.water);
        put_f32(out, nd.sleep);
        put_f32(out, nd.pee);
        put_f32(out, nd.poo);
        put_f32(out, nd.pendingPee);
        put_f32(out, nd.pendingPoo);
        put_f32(out, nd.hpDebt);
        put_f32(out, nd.hpBank);
        put_u8(out, nd.seeded);
        const Inventory& inv = inv_[id];
        // Save v14 cell: u16 count is back beside the u8 condition — 5 B per
        // slot; the pad byte never travels ([inventory.h], [save.h]).
        for (int s = 0; s < kInvSlots; ++s) {
            put_u16(out, inv.slots[s].item);
            put_u16(out, inv.slots[s].count);
            put_u8(out, inv.slots[s].condition);
        }
        if (names) {
            for (char c : name_[id])
                put_u8(out, static_cast<std::uint8_t>(c));
            for (char c : surname_[id])
                put_u8(out, static_cast<std::uint8_t>(c));
        }
    }
}

bool NpcPool::load_rows(const std::uint8_t* bytes, std::size_t n) {
    if (!bytes || n < kPoolHeadWire) return false;
    if (count_ != 0) return false; // contract: a freshly init()ed pool
    ByteReader r{bytes, n};
    const std::uint32_t count = r.u32();
    const std::uint32_t recycled = r.u32();
    const bool recycle = r.u8() != 0;
    const bool names = r.u8() != 0;
    if (count > kNpcPoolSize) return false;
    const std::size_t want =
        kPoolHeadWire + static_cast<std::size_t>(count) *
                            (kPoolRowWire + (names ? 2 * kNameLen : 0));
    if (n != want) return false;

    count_ = count;
    grow_live_columns(count_);
    if (names) {
        grow_column(name_, count_);
        grow_column(surname_, count_);
    }
    alive_ = 0;
    recycled_ = recycled;
    for (NpcId id = 0; id < count_; ++id) {
        const std::uint8_t fl =
            r.u8() & static_cast<std::uint8_t>(~NpcEmbodied);
        flags_[id] = fl;
        faction_[id] = r.u16();
        hp_[id] = r.i16();
        maxHp_[id] = r.i16();
        const std::int16_t label = r.i16();
        cx_[id] = r.u8();
        cy_[id] = r.u8();
        cz_[id] = r.u8();
        heightMm_[id] = r.u16();
        age_[id] = r.u8();
        sex_[id] = r.u8();
        level_[id] = r.u8();
        role_[id] = r.u8();
        for (std::uint8_t& v : attr_[id]) v = r.u8();
        gen_[id] = r.u16();
        Needs& nd = needs_[id];
        nd.food = r.f32();
        nd.water = r.f32();
        nd.sleep = r.f32();
        nd.pee = r.f32();
        nd.poo = r.f32();
        nd.pendingPee = r.f32();
        nd.pendingPoo = r.f32();
        nd.hpDebt = r.f32();
        nd.hpBank = r.f32();
        nd.seeded = r.u8();
        Inventory& inv = inv_[id];
        for (int s = 0; s < kInvSlots; ++s) {
            inv.slots[s].item = r.u16();
            inv.slots[s].count = r.u16();
            inv.slots[s].condition = r.u8();
        }
        if (names) {
            for (char& c : name_[id]) c = static_cast<char>(r.u8());
            for (char& c : surname_[id]) c = static_cast<char>(r.u8());
        }
        // The bucket index is DERIVED state: alive rows join their floor's
        // roster (the exact insert set_floor performs); dead rows keep their
        // label but stay out, matching what kill() left behind.
        if (fl & NpcAlive) {
            ++alive_;
            const int slot = bucket_slot(label);
            if (slot >= 0) {
                std::vector<NpcId>& b =
                    floorBuckets_[static_cast<std::size_t>(slot)];
                slotInBucket_[id] = static_cast<std::uint32_t>(b.size());
                b.push_back(id);
            }
            floor_[id] = label;
        } else {
            floor_[id] = label;
        }
    }
    if (!r.ok || r.at != n) return false;
    // Re-arm recycling THROUGH the public path: the OFF->ON transition is what
    // rebuilds the free list from the alive bits, per its own contract.
    if (recycle) set_recycling(true);
    return true;
}

} // namespace giga::game
