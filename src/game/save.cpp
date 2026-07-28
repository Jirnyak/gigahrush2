#include "game/save.h"

#include <cstring>
#include <utility>

#include "core/tick.h"        // kSimHz — the one number the header must not guess
#include "core/wrap.h"
#include "ecs/components.h"   // Transform, Renderable
#include "game/container.h"   // Container, kContainerSlots
#include "game/item_table.h"  // kItemNames, kItemCount
#include "game/mob_table.h"   // kMobNames, kMobKindCount
#include "world/types.h"      // kCellSize, wrap_macro

namespace giga::game {

namespace {

// ---------------------------------------------------------------------------
// One traversal, two directions
// ---------------------------------------------------------------------------
// Every struct below is walked by a single `visit_*` template that both the writer and
// the reader instantiate. That is not a style preference: hand-written `write_ledger` /
// `read_ledger` pairs are where save formats break, because the two halves drift by one
// field and the result is a load that succeeds with every subsequent field shifted. With
// one traversal that bug is not expressible — a field the writer emits is a field the
// reader consumes, in the same order, by construction.
//
// The archives take a reference to each field, so `T` can be deduced as `const Foo` when
// writing (binding to the writer's `const&` parameters) and `Foo` when reading.

// Little-endian, byte at a time. NOT a memcpy of the struct: a struct copy would put
// this compiler's padding and this host's byte order into the file, and then a save
// written by one of the two builds would be unreadable by the other for reasons nothing
// in the format could diagnose.
class Writer {
public:
    explicit Writer(std::vector<std::uint8_t>& out) : out_(&out) {}

    void u8(const std::uint8_t& v) { out_->push_back(v); }
    void u16(const std::uint16_t& v) {
        out_->push_back(static_cast<std::uint8_t>(v & 0xFFu));
        out_->push_back(static_cast<std::uint8_t>((v >> 8) & 0xFFu));
    }
    void u32(const std::uint32_t& v) {
        for (int i = 0; i < 4; ++i)
            out_->push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
    }
    void u64(const std::uint64_t& v) {
        for (int i = 0; i < 8; ++i)
            out_->push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
    }
    // Signed -> unsigned is a modular conversion, always has been; unsigned -> signed
    // is well-defined the same way since C++20 mandated two's complement, and this tree
    // is C++23. So a negative floor number round-trips exactly.
    void i16(const std::int16_t& v) {
        const std::uint16_t u = static_cast<std::uint16_t>(v);
        u16(u);
    }
    void i32(const std::int32_t& v) {
        const std::uint32_t u = static_cast<std::uint32_t>(v);
        u32(u);
    }
    void i64(const std::int64_t& v) {
        const std::uint64_t u = static_cast<std::uint64_t>(v);
        u64(u);
    }
    // memcpy rather than a cast or a union: the only aliasing-safe way to see a float's
    // bits, and the only one that stays legal without RTTI or any language extension.
    void f32(const float& v) {
        std::uint32_t bits = 0;
        std::memcpy(&bits, &v, sizeof(bits));
        u32(bits);
    }

private:
    std::vector<std::uint8_t>* out_;
};

// Bounds-checked in one place — `u8` — so no visitor has to know how long the buffer is.
// Once `ok_` is false every later field reads as zero and the parse is discarded whole.
class Reader {
public:
    Reader(const std::uint8_t* p, std::size_t n) : p_(p), n_(n) {}

    void u8(std::uint8_t& v) {
        if (at_ >= n_) {
            ok_ = false;
            v = 0;
            return;
        }
        v = p_[at_++];
    }
    void u16(std::uint16_t& v) {
        std::uint8_t a = 0, b = 0;
        u8(a);
        u8(b);
        v = static_cast<std::uint16_t>(static_cast<std::uint32_t>(a) |
                                       (static_cast<std::uint32_t>(b) << 8));
    }
    void u32(std::uint32_t& v) {
        std::uint8_t b[4] = {};
        for (int i = 0; i < 4; ++i) u8(b[i]);
        v = static_cast<std::uint32_t>(b[0]) |
            (static_cast<std::uint32_t>(b[1]) << 8) |
            (static_cast<std::uint32_t>(b[2]) << 16) |
            (static_cast<std::uint32_t>(b[3]) << 24);
    }
    void u64(std::uint64_t& v) {
        std::uint8_t b[8] = {};
        for (int i = 0; i < 8; ++i) u8(b[i]);
        v = 0;
        for (int i = 7; i >= 0; --i)
            v = (v << 8) | static_cast<std::uint64_t>(b[i]);
    }
    void i16(std::int16_t& v) {
        std::uint16_t u = 0;
        u16(u);
        v = static_cast<std::int16_t>(u);
    }
    void i32(std::int32_t& v) {
        std::uint32_t u = 0;
        u32(u);
        v = static_cast<std::int32_t>(u);
    }
    void i64(std::int64_t& v) {
        std::uint64_t u = 0;
        u64(u);
        v = static_cast<std::int64_t>(u);
    }
    void f32(float& v) {
        std::uint32_t bits = 0;
        u32(bits);
        std::memcpy(&v, &bits, sizeof(v));
    }

    bool ok() const { return ok_; }
    std::size_t at() const { return at_; }

private:
    const std::uint8_t* p_;
    std::size_t n_;
    std::size_t at_ = 0;
    bool ok_ = true;
};

template <class Ar, class H>
void visit_header(Ar& ar, H& h) {
    ar.u32(h.magic);
    ar.u32(h.version);
    ar.u32(h.tickHz);
    ar.u32(h.itemCount);
    ar.u32(h.mobKindCount);
    ar.u32(h.itemFingerprint);
    ar.u32(h.mobFingerprint);
    ar.u32(h.openedCount);
    ar.u16(h.ledgerBytes);
    ar.u16(h.bookBytes);
    ar.u16(h.needsBytes);
    ar.u16(h.invBytes);
    ar.u32(h.payloadBytes);
    ar.u32(h.payloadCrc);
}

template <class Ar, class L>
void visit_ledger(Ar& ar, L& led) {
    ar.i64(led.banked);
    ar.i64(led.lostToDeath);
    ar.i32(led.bestHaul);
    ar.u32(led.deposits);
    ar.u32(led.deaths);
    ar.i32(led.deepestFloor);
    ar.u8(led.deepestBand);
}

// `pad_` is not written. It carries no meaning — `baseline` already claimed one of the
// two spare bytes ([contract.h]) — and a padding byte on the wire is a byte a future
// field would have to fight for.
template <class Ar, class C>
void visit_contract(Ar& ar, C& c) {
    ar.u32(c.giver);
    ar.u16(c.subject);
    ar.i32(c.target);
    ar.i32(c.progress);
    ar.i32(c.reward);
    ar.u8(c.kind);
    ar.u8(c.state);
    ar.u8(c.baseline);
}

template <class Ar, class B>
void visit_book(Ar& ar, B& b) {
    for (int i = 0; i < kMaxContracts; ++i)
        visit_contract(ar, b.slot[i]);
    ar.u32(b.completed);
    ar.u32(b.failed);
    ar.i64(b.earned);
}

// All eight floats, including the two "pending" queues and `hpDebt`. Dropping the
// pending queues would silently forgive a bladder you had already filled, and dropping
// `hpDebt` would forgive sub-1-HP attrition — the exact fraction the elevator test pins
// as surviving a body swap ([suite_needs.inl] survives_the_body_swap). A save is a
// bigger body swap, so it keeps the same fields.
template <class Ar, class N>
void visit_needs(Ar& ar, N& n) {
    ar.f32(n.food);
    ar.f32(n.water);
    ar.f32(n.sleep);
    ar.f32(n.pee);
    ar.f32(n.poo);
    ar.f32(n.pendingPee);
    ar.f32(n.pendingPoo);
    ar.f32(n.hpDebt);
    ar.u8(n.seeded);
}

template <class Ar, class I>
void visit_inventory(Ar& ar, I& inv) {
    for (int i = 0; i < kInvSlots; ++i) {
        ar.u16(inv.slots[i].item);
        ar.u16(inv.slots[i].count);
    }
}

template <class Ar, class P>
void visit_player(Ar& ar, P& p) {
    visit_needs(ar, p.clock);
    visit_inventory(ar, p.inv);
    ar.i32(p.hp);
    ar.i32(p.maxHp);
    ar.i32(p.floorNumber);
    ar.u8(p.cx);
    ar.u8(p.cy);
    ar.u8(p.cz);
}

template <class Ar, class K>
void visit_key(Ar& ar, K& k) {
    ar.i16(k.floor);
    ar.u8(k.cx);
    ar.u8(k.cy);
    ar.u8(k.cz);
}

// CRC-32 (reflected 0xEDB88320), computed bit-serially rather than from a table.
// 8 shifts per byte over a ~3.6 KB save is a few microseconds — a lookup table would be
// 1 KB of static data and a first-use question, to save nothing measurable on a
// once-per-event operation.
std::uint32_t crc32(const std::uint8_t* p, std::size_t n) {
    std::uint32_t c = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < n; ++i) {
        c ^= static_cast<std::uint32_t>(p[i]);
        for (int k = 0; k < 8; ++k)
            c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

// FNV-1a over a NUL-terminated string, terminator included. The terminator matters: it
// is what stops "ab" + "c" from hashing the same as "a" + "bc", i.e. what makes the
// fingerprint sensitive to where one row ends and the next begins.
std::uint32_t fnv1a_cstr(std::uint32_t h, const char* s) {
    if (!s) return h;
    for (const char* p = s;; ++p) {
        h ^= static_cast<std::uint32_t>(static_cast<std::uint8_t>(*p));
        h *= 0x01000193u;
        if (*p == '\0') break;
    }
    return h;
}

} // namespace

// ---------------------------------------------------------------------------
// Table fingerprints — the strong half of the version check
// ---------------------------------------------------------------------------
// Hashed over the display NAMES in table order, not over the stat rows. A name is a
// row's identity, so this moves on insert, delete, rename and reorder — the last two
// being exactly the cases the row COUNT cannot see. Deliberately blind to stats: an
// item's value or spawn weight changing is a balance patch, and refusing to load a save
// after a balance patch would be a worse bug than the one being defended against.
//
// The names are UTF-8 Cyrillic ([item_table.cpp] carries 6608 Cyrillic lead bytes), and
// the hash is over raw bytes, so it needs no locale and no text handling of any kind.
std::uint32_t item_table_fingerprint() {
    std::uint32_t h = 0x811C9DC5u;
    for (std::size_t i = 0; i < kItemCount; ++i) h = fnv1a_cstr(h, kItemNames[i]);
    return h;
}

std::uint32_t mob_table_fingerprint() {
    std::uint32_t h = 0x811C9DC5u;
    for (std::size_t i = 0; i < kMobKindCount; ++i) h = fnv1a_cstr(h, kMobNames[i]);
    return h;
}

const char* save_error_text(SaveError e) {
    switch (e) {
        case SaveError::None:              return "ok";
        case SaveError::TooShort:          return "save file is truncated";
        case SaveError::BadMagic:          return "not a gigahrush2 save";
        case SaveError::BadVersion:        return "save is from a different build";
        case SaveError::ItemCountMismatch: return "data/items.csv gained or lost rows";
        case SaveError::MobCountMismatch:  return "data/mobs.csv gained or lost rows";
        case SaveError::ItemTableChanged:  return "data/items.csv row identities moved";
        case SaveError::MobTableChanged:   return "data/mobs.csv row identities moved";
        case SaveError::LayoutMismatch:    return "a saved struct changed size";
        case SaveError::SizeMismatch:      return "save header contradicts its payload";
        case SaveError::BadChecksum:       return "save file is corrupt";
        default:                           return "unknown save error";
    }
}

// The wire footprints the header advertises must be the footprints the visitors actually
// produce. Asserted at build time because the alternative is discovering the mismatch as
// a `SizeMismatch` rejection of a save this very build just wrote.
static_assert(sizeof(SaveHeader) == kSaveHeaderWire,
              "SaveHeader happens to have no padding; if that changes, the wire size is "
              "still 48 and only this assert needs relaxing");
static_assert(kLedgerWire == 8 + 8 + 4 + 4 + 4 + 4 + 1);
static_assert(kContractWire == 4 + 2 + 4 + 4 + 4 + 1 + 1 + 1);
static_assert(kNeedsWire == 8 * 4 + 1);
static_assert(kInventoryWire == 64 * 4);
static_assert(kSaveFixedWire == 416);
static_assert(save_bytes_for(0) == 464);

// `ContractBook` is the OTHER run struct nobody had pinned. `contract.h:82` asserts
// `sizeof(Contract) == 24` and then stops — the book that holds three of them, plus two
// counters and an int64 total, had no size assert anywhere in the tree. 3x24 + 4 + 4
// (+4 alignment gap) + 8 = 88. Pinned from here because this file is the one that has to
// care; the assert belongs next to the struct, and moving it there is a one-line edit to
// `contract.h` that this lane does not own.
static_assert(sizeof(ContractBook) == 88,
              "ContractBook is serialized; grow it and bump kSaveVersion in the same "
              "edit");
static_assert(sizeof(Inventory) == 256, "the 8x8 grid is 64 x 4 B ([inventory.h])");

void save_write(const SaveState& st, std::vector<std::uint8_t>& out) {
    // Payload first: the header carries the payload's length and checksum, so it cannot
    // be written until the payload exists.
    std::vector<std::uint8_t> body;
    body.reserve(kSaveFixedWire + st.opened.size() * kOpenedKeyWire);
    Writer bw(body);
    visit_ledger(bw, st.ledger);
    visit_book(bw, st.book);
    visit_player(bw, st.player);
    for (const OpenedContainerKey& k : st.opened) visit_key(bw, k);

    SaveHeader h{};
    h.magic = kSaveMagic;
    h.version = kSaveVersion;
    h.tickHz = static_cast<std::uint32_t>(kSimHz);
    h.itemCount = static_cast<std::uint32_t>(kItemCount);
    h.mobKindCount = static_cast<std::uint32_t>(kMobKindCount);
    h.itemFingerprint = item_table_fingerprint();
    h.mobFingerprint = mob_table_fingerprint();
    h.openedCount = static_cast<std::uint32_t>(st.opened.size());
    h.ledgerBytes = static_cast<std::uint16_t>(sizeof(RunLedger));
    h.bookBytes = static_cast<std::uint16_t>(sizeof(ContractBook));
    h.needsBytes = static_cast<std::uint16_t>(sizeof(Needs));
    h.invBytes = static_cast<std::uint16_t>(sizeof(Inventory));
    h.payloadBytes = static_cast<std::uint32_t>(body.size());
    h.payloadCrc = crc32(body.data(), body.size());

    out.clear();
    out.reserve(kSaveHeaderWire + body.size());
    Writer hw(out);
    visit_header(hw, h);
    out.insert(out.end(), body.begin(), body.end());
}

bool save_read(const std::uint8_t* bytes, std::size_t n, SaveState& st, SaveError* err,
               SaveHeader* hdrOut) {
    if (err) *err = SaveError::None;
    auto fail = [err](SaveError e) {
        if (err) *err = e;
        return false;
    };

    if (!bytes || n < kSaveHeaderWire) return fail(SaveError::TooShort);

    SaveHeader h{};
    Reader hr(bytes, kSaveHeaderWire);
    visit_header(hr, h);
    if (!hr.ok()) return fail(SaveError::TooShort);
    // Handed back even when the load is about to be refused, so the caller can say WHAT
    // it refused ("written by version 3 at 120 Hz") instead of only that it did.
    if (hdrOut) *hdrOut = h;

    if (h.magic != kSaveMagic) return fail(SaveError::BadMagic);
    if (h.version != kSaveVersion) return fail(SaveError::BadVersion);

    // The weak checks first, because they name which table moved. Then the strong ones,
    // which catch the reorder/rename the counts cannot see. `tickHz` is deliberately not
    // a rejection — see the SaveHeader comment.
    if (h.itemCount != static_cast<std::uint32_t>(kItemCount))
        return fail(SaveError::ItemCountMismatch);
    if (h.mobKindCount != static_cast<std::uint32_t>(kMobKindCount))
        return fail(SaveError::MobCountMismatch);
    if (h.itemFingerprint != item_table_fingerprint())
        return fail(SaveError::ItemTableChanged);
    if (h.mobFingerprint != mob_table_fingerprint())
        return fail(SaveError::MobTableChanged);

    if (static_cast<std::size_t>(h.ledgerBytes) != sizeof(RunLedger) ||
        static_cast<std::size_t>(h.bookBytes) != sizeof(ContractBook) ||
        static_cast<std::size_t>(h.needsBytes) != sizeof(Needs) ||
        static_cast<std::size_t>(h.invBytes) != sizeof(Inventory))
        return fail(SaveError::LayoutMismatch);

    // Bound the count BEFORE it is used to size anything, so a corrupt or hostile header
    // cannot ask for a large allocation on the strength of numbers the checksum has not
    // vouched for yet.
    if (h.openedCount > kMaxOpenedKeys) return fail(SaveError::SizeMismatch);
    const std::size_t want =
        kSaveFixedWire + static_cast<std::size_t>(h.openedCount) * kOpenedKeyWire;
    if (static_cast<std::size_t>(h.payloadBytes) != want)
        return fail(SaveError::SizeMismatch);
    if (n - kSaveHeaderWire < static_cast<std::size_t>(h.payloadBytes))
        return fail(SaveError::TooShort);
    if (crc32(bytes + kSaveHeaderWire, h.payloadBytes) != h.payloadCrc)
        return fail(SaveError::BadChecksum);

    // Parse into a scratch copy and commit only on success: a half-applied load would
    // leave the game in a state no run has ever reached, which is harder to recover from
    // than simply not loading.
    SaveState tmp;
    Reader r(bytes + kSaveHeaderWire, h.payloadBytes);
    visit_ledger(r, tmp.ledger);
    visit_book(r, tmp.book);
    visit_player(r, tmp.player);
    tmp.opened.resize(static_cast<std::size_t>(h.openedCount));
    for (std::size_t i = 0; i < tmp.opened.size(); ++i) visit_key(r, tmp.opened[i]);
    if (!r.ok()) return fail(SaveError::TooShort);
    // Every declared byte consumed and no more. A surviving remainder would mean the
    // wire constants and the visitors disagree, which the static_asserts above already
    // forbid — this is the runtime backstop for the case where they are edited together
    // and both are wrong.
    if (r.at() != static_cast<std::size_t>(h.payloadBytes))
        return fail(SaveError::SizeMismatch);

    st = std::move(tmp);
    return true;
}

// ---------------------------------------------------------------------------
// Container state <-> registry
// ---------------------------------------------------------------------------

OpenedContainerKey container_key(int floorNumber, const vec3& pos) {
    OpenedContainerKey k{};
    k.floor = static_cast<std::int16_t>(floorNumber);
    // Same truncation MacroGrid and `on_extraction_pad` use, and it is exact here rather
    // than approximate: `spawn_floor_containers` centres a crate at
    // `(cell + 0.5) * kCellSize` in x/y and `cell * kCellSize + kContainerHalf.z` in z,
    // and kContainerHalf.z is 0.45 m inside a 2 m cell — so the truncation lands on the
    // spawning cell for every axis, with 0.55 m of margin on the tightest one.
    k.cx = static_cast<std::uint8_t>(
        wrap_macro(static_cast<int>(pos.x / kCellSize)));
    k.cy = static_cast<std::uint8_t>(
        wrap_macro(static_cast<int>(pos.y / kCellSize)));
    k.cz = static_cast<std::uint8_t>(
        wrap_macro(static_cast<int>(pos.z / kCellSize)));
    return k;
}

std::size_t collect_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                     std::vector<OpenedContainerKey>& out) {
    std::size_t n = 0;
    for (auto e : reg.view<const Container, const Transform>()) {
        if (!reg.get<const Container>(e).opened) continue;
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        out.push_back(container_key(floorNumber, t.pos));
        ++n;
    }
    return n;
}

std::size_t refresh_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                      std::vector<OpenedContainerKey>& set) {
    // Compact in place rather than erase-remove: the list is a few hundred 6-byte rows,
    // and one pass with no allocation is easier to be sure about than an iterator dance.
    const std::int16_t f = static_cast<std::int16_t>(floorNumber);
    std::size_t keep = 0;
    for (std::size_t i = 0; i < set.size(); ++i) {
        if (set[i].floor == f) continue;
        set[keep++] = set[i];
    }
    set.resize(keep);
    return collect_opened_containers(reg, layer, floorNumber, set);
}

std::size_t apply_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                    const OpenedContainerKey* keys, std::size_t n,
                                    const vec3* openedColour) {
    if (!keys || n == 0) return 0;
    const std::int16_t f = static_cast<std::int16_t>(floorNumber);

    std::size_t hits = 0;
    for (auto e : reg.view<Container, const Transform>()) {
        Container& c = reg.get<Container>(e);
        if (c.opened) continue;
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;

        const OpenedContainerKey k = container_key(floorNumber, t.pos);
        bool hit = false;
        for (std::size_t i = 0; i < n && !hit; ++i) {
            if (keys[i].floor != f) continue;   // other floors' keys, skipped cheaply
            hit = same_container(keys[i], k);
        }
        if (!hit) continue;

        c.opened = true;
        // Emptied as well as flagged — see the header. An opened crate is an empty crate
        // by construction in `loot_containers_step`, so restoring one that still had
        // rolled contents inside would be a discrepancy waiting for the first feature
        // that reads a spent box.
        for (int i = 0; i < kContainerSlots; ++i) {
            c.item[i] = kInvalidItem;
            c.count[i] = 0;
        }
        if (openedColour)
            if (Renderable* rr = reg.try_get<Renderable>(e)) rr->color = *openedColour;
        ++hits;
    }
    // O(crates x keys) — 64 x 640 worst case on the demo stack, once per floor entry.
    // Load time is unbounded by contract ([performance.md]) and the sim tick never runs
    // this, so a hash set would buy nothing but a container to allocate.
    return hits;
}

} // namespace giga::game
