#include "game/save.h"

#include <cstdio>
#include <cstring>
#include <utility>

#include "core/tick.h"        // kSimHz — the one number the header must not guess
#include "core/wrap.h"
#include "ecs/components.h"   // Transform, Velocity, AABB, Renderable
#include "game/container.h"   // Container, kContainerSlots
#include "game/embody.h"      // NpcRef, kEmbodyCellSize
#include "game/floor_stream.h"  // FloorStreamer, FloorRegistry, RideResult
#include "game/item_table.h"  // kItemNames, kItemCount
#include "game/mob_table.h"   // kMobNames, kMobKindCount
#include "game/quest.h"       // QuestLog, quest_log_write, quest_log_read, kQuestLogWire
#include "game/craft.h"       // craft_write, craft_read, kCraftingWire
#include "game/rpg.h"         // RpgStats (visit_rpg)
#include "game/combat.h"      // PlayerRanged (visit_ranged / SAVMAG)
#include "sim/physics.h"      // aabb_overlaps_solid — the solver's own predicate
#include "world/types.h"      // kCellSize, kVoxelSize, wrap_macro
#include "world/world.h"      // World::grid, for the placement probes

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
    // A `bool` field needs its own method, not a cast at the call site. `u8` takes
    // `std::uint8_t&` on the Reader side, so a bool cannot bind there — and papering
    // over that with a temporary at each site would be the first place in this file
    // where the writer and the reader stop being the SAME visit function, which is
    // the property that keeps the two halves of the format from drifting apart.
    // Normalised to 0/1 on write and to false/true on read, so no bit pattern other
    // than those two ever reaches or leaves the file.
    void b8(const bool& v) { out_->push_back(v ? 1u : 0u); }
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
    void b8(bool& v) {
        std::uint8_t b = 0;
        u8(b);
        v = (b != 0);
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

    // Jump over `k` bytes handled out-of-band (the snapshot blob, the quest log).
    void skip(std::size_t k) {
        if (n_ - at_ < k) {
            ok_ = false;
            at_ = n_;
            return;
        }
        at_ += k;
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
    // Version 2 fields: quest table weak + strong check.
    ar.u32(h.questCount);
    ar.u32(h.questFingerprint);
    // Version 6 fields: macro-world blob lengths.
    ar.u32(h.poolBytes);
    ar.u32(h.macroBytes);
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

// All nine floats, including the two "pending" queues, `hpDebt` and `hpBank`. Dropping
// the pending queues would silently forgive a bladder you had already filled, dropping
// `hpDebt` would forgive sub-1-HP attrition — the exact fraction the elevator test pins
// as surviving a body swap ([suite_needs.inl] survives_the_body_swap) — and dropping
// `hpBank` would forgive healing already earned in a ward. A save is a bigger body
// swap, so it keeps the same fields.
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
    ar.f32(n.hpBank);
    ar.u8(n.seeded);
}

template <class Ar, class I>
void visit_inventory(Ar& ar, I& inv) {
    for (int i = 0; i < kInvSlots; ++i) {
        ar.u16(inv.slots[i].item);
        ar.u16(inv.slots[i].count);
        ar.u8(inv.slots[i].condition);
    }
}

template <class Ar, class P>
void visit_player(Ar& ar, P& p) {
    visit_needs(ar, p.clock);
    visit_inventory(ar, p.inv);
    ar.u8(p.equipped.weapon);
    ar.u8(p.equipped.armor);
    ar.u8(p.equipped.tool);
    ar.u8(p.equipped.pad_);
    ar.i32(p.hp);
    ar.i32(p.maxHp);
    ar.i32(p.floorNumber);
    ar.u8(p.cx);
    ar.u8(p.cy);
    ar.u8(p.cz);
    ar.f32(p.yaw);
    ar.f32(p.pitch);
}

// Version 7: RpgStats field-by-field. pad_ is written so the wire is exactly
// kRpgWire (12) and a future non-zero pad cannot silently drop.
template <class Ar, class R>
void visit_rpg(Ar& ar, R& r) {
    ar.u32(r.xp);
    ar.u16(r.psi);
    ar.u8(r.level);
    ar.u8(r.attrPoints);
    ar.u8(r.attr[0]);
    ar.u8(r.attr[1]);
    ar.u8(r.attr[2]);
    ar.u8(r.pad_);
}

// Version 8 / SAVMAG: PlayerRanged field-by-field. weapon is ItemId = u16.
template <class Ar, class R>
void visit_ranged(Ar& ar, R& r) {
    ar.u16(r.cooldownMs);
    ar.u16(r.reloadMs);
    ar.u16(r.magCount);
    ar.u16(r.weapon);
    ar.u32(r.shots);
    ar.u32(r.hits);
}

// Version 9 / SAVSTAT: StatusSet field-by-field. Order is remainMs then
// intensityE3 then alt for each of the six slots — NOT interleaved per-slot
// structs, so a future field can append without shifting the existing wire.
template <class Ar, class S>
void visit_status(Ar& ar, S& s) {
    for (std::size_t i = 0; i < kStatusCount; ++i) ar.u32(s.remainMs[i]);
    for (std::size_t i = 0; i < kStatusCount; ++i) ar.u16(s.intensityE3[i]);
    for (std::size_t i = 0; i < kStatusCount; ++i) ar.u8(s.alt[i]);
}

// Version 10 / SAVCLOCK: the samosbor automaton, field by field. `count` is a u16
// and rides as one — it is the per-run tally `MobDef::minSamosbor` unlocks against,
// so widening it later is a wire change and must bump the version. The three tail
// padding bytes of the struct are NOT written.
template <class Ar, class S>
void visit_samosbor(Ar& ar, S& s) {
    ar.u32(s.phaseMs);
    ar.u32(s.phaseTotalMs);
    ar.u32(s.activeMs);
    ar.u16(s.count);
    ar.u8(s.phase);
    ar.u8(s.variant);
    ar.b8(s.sealed);
}

// Version 15: BankEntry field-by-field (12 B).
template <class Ar, class E>
void visit_bank_entry(Ar& ar, E& e) {
    ar.i32(e.amount);
    ar.u32(e.tick);
    ar.u8(e.op);
    ar.u8(e.band);
    ar.u8(e.pad_[0]);
    ar.u8(e.pad_[1]);
}

// Version 15: BankAccount field-by-field (352 B).
template <class Ar, class B>
void visit_bank(Ar& ar, B& b) {
    ar.i64(b.deposit);
    ar.i64(b.loanPrincipal);
    ar.i64(b.loanAccrued);
    ar.i64(b.interestEarned);
    ar.i64(b.interestPaid);
    ar.u64(b.lastInterestTick);
    ar.i32(b.creditLimit);
    ar.u32(b.entries);
    for (std::size_t i = 0; i < kBankLedgerSlots; ++i) {
        visit_bank_entry(ar, b.ledger[i]);
    }
    ar.u8(b.band);
    for (std::size_t i = 0; i < 7; ++i) ar.u8(b.pad_[i]);
}

// Version 15: PowerGridState field-by-field (1028 B).
template <class Ar, class G>
void visit_power_grid(Ar& ar, G& g) {
    ar.u32(g.count);
    for (std::size_t i = 0; i < kMaxDestroyedShields; ++i) {
        ar.u64(g.destroyedShieldKeys[i]);
    }
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
              "still 64 and only this assert needs relaxing");
static_assert(kLedgerWire == 8 + 8 + 4 + 4 + 4 + 4 + 1);
static_assert(kContractWire == 4 + 2 + 4 + 4 + 4 + 1 + 1 + 1);
static_assert(kNeedsWire == 9 * 4 + 1);
static_assert(kInventoryWire == 64 * 5);
// kSaveFixedWire: ledger+book+player + v7 rpg(12)+craft(89) + v8 combat(21)
// + v9 status(42) + v10 samosbor(17)+fastTravel(32) + quest log + v13 inv condition(64).
static_assert(kRpgWire == 12);
static_assert(kCraftingWire == 89);
static_assert(kRangedWire == 16);
static_assert(kCombatSaveWire == 21);
static_assert(kStatusWire == 42);
static_assert(kSamosborWire == 17);
static_assert(kFastTravelWire == 32);
static_assert(kBankWire == 352);
static_assert(kPowerGridWire == 1028);
// The wire size and the runtime footprint of the unlock set must not drift apart:
// widening kFloorSlots changes the struct and would silently change the format.
static_assert(FastTravelState::wire_bytes() == kFastTravelWire);
static_assert(kSaveFixedWire == 995 + 8 + kBankWire + kPowerGridWire);  // 2383 (v15: BankAccount +352, PowerGrid +1028, Yaw/Pitch +8)
static_assert(kSaveFixedWire == 2383);
static_assert(kFactionWire == 36);
static_assert(save_bytes_for(0) == 2483);
static_assert(save_bytes_for(0, 100, 50) == 2483 + 150);

// `ContractBook` is the OTHER run struct nobody had pinned. `contract.h:82` asserts
// `sizeof(Contract) == 24` and then stops — the book that holds three of them, plus two
// counters and an int64 total, had no size assert anywhere in the tree. 3x24 + 4 + 4
// (+4 alignment gap) + 8 = 88. Pinned from here because this file is the one that has to
// care; the assert belongs next to the struct, and moving it there is a one-line edit to
// `contract.h` that this lane does not own.
static_assert(sizeof(ContractBook) == 88,
              "ContractBook is serialized; grow it and bump kSaveVersion in the same "
              "edit");
static_assert(sizeof(Inventory) == 384, "the 8x8 grid is 64 x 6 B ([inventory.h])");

void save_write(const SaveState& st, std::vector<std::uint8_t>& out) {
    // Payload first: the header carries the payload's length and checksum, so it cannot
    // be written until the payload exists.
    std::vector<std::uint8_t> body;
    // The same size the writer will actually produce, minus the header this
    // buffer does not carry — `save_bytes_for` is the one place that arithmetic
    // lives, so the reserve cannot drift from the wire format.
    body.reserve(save_bytes_for(st.opened.size(), st.poolBlob.size(),
                                st.macroBlob.size()) -
                 kSaveHeaderWire);
    Writer bw(body);
    visit_ledger(bw, st.ledger);
    visit_book(bw, st.book);
    visit_player(bw, st.player);
    // Version 7: character sheet + crafting bank (fixed-size, in kSaveFixedWire).
    visit_rpg(bw, st.rpg);
    {
        const std::size_t at = body.size();
        body.resize(at + kCraftingWire);
        craft_write(st.craft, body.data() + at);
    }
    // Version 8 / SAVMAG: firearm chamber + kill tally.
    bw.u8(st.hasRanged);
    visit_ranged(bw, st.ranged);
    bw.u32(st.kills);
    // Version 9 / SAVSTAT: live status effects.
    visit_status(bw, st.status);
    // Version 10 / SAVCLOCK: the two run-scoped clocks. Placed HERE — after the last
    // fixed block, before the variable-length opened-key list — because that is where
    // v7, v8 and v9 each went in, and appending a fixed block after a variable one
    // would make the reader's offset depend on a count.
    visit_samosbor(bw, st.samosbor);
    for (std::size_t i = 0; i < kFastTravelWire; ++i) bw.u8(st.fastTravel.raw()[i]);
    // Version 15: Bank account persistence & power grid state.
    visit_bank(bw, st.bank);
    visit_power_grid(bw, st.powerGrid);
    for (const OpenedContainerKey& k : st.opened) visit_key(bw, k);
    // Version 6: the macro world — pool table, macro-sim state, faction matrix.
    body.insert(body.end(), st.poolBlob.begin(), st.poolBlob.end());
    body.insert(body.end(), st.macroBlob.begin(), st.macroBlob.end());
    for (std::size_t i = 0; i < kFactionWire; ++i)
        bw.u8(static_cast<std::uint8_t>(st.factions.v[i]));
    // Version 2: quest log appended last. Geometry never rides in run.sav — it
    // lives in the per-floor files ([save.h] modular layout).
    quest_log_write(st.quests, body);

    SaveHeader h{};
    h.magic = kSaveMagic;
    h.version = kSaveVersion;
    h.tickHz = static_cast<std::uint32_t>(kSimHz);
    h.itemCount = static_cast<std::uint32_t>(kItemCount);
    h.mobKindCount = static_cast<std::uint32_t>(kMobKindCount);
    h.itemFingerprint = item_table_fingerprint();
    h.mobFingerprint = mob_table_fingerprint();
    h.openedCount = static_cast<std::uint32_t>(st.opened.size());
    h.poolBytes = static_cast<std::uint32_t>(st.poolBlob.size());
    h.macroBytes = static_cast<std::uint32_t>(st.macroBlob.size());
    h.ledgerBytes = static_cast<std::uint16_t>(sizeof(RunLedger));
    h.bookBytes = static_cast<std::uint16_t>(sizeof(ContractBook));
    h.needsBytes = static_cast<std::uint16_t>(sizeof(Needs));
    h.invBytes = static_cast<std::uint16_t>(sizeof(Inventory));
    h.questCount = static_cast<std::uint32_t>(kQuestCount);
    h.questFingerprint = quest_table_fingerprint();
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
    if (h.poolBytes > kMaxPoolBytes) return fail(SaveError::SizeMismatch);
    if (h.macroBytes > kMaxMacroBytes) return fail(SaveError::SizeMismatch);
    const std::size_t want =
        kSaveFixedWire + kFactionWire +
        static_cast<std::size_t>(h.openedCount) * kOpenedKeyWire +
        static_cast<std::size_t>(h.poolBytes) +
        static_cast<std::size_t>(h.macroBytes);
    if (static_cast<std::size_t>(h.payloadBytes) != want)
        return fail(SaveError::SizeMismatch);
    if (n - kSaveHeaderWire < static_cast<std::size_t>(h.payloadBytes))
        return fail(SaveError::TooShort);
    if (crc32(bytes + kSaveHeaderWire, h.payloadBytes) != h.payloadCrc)
        return fail(SaveError::BadChecksum);

    // Version 2 quest table checks (after CRC, before parsing).
    if (h.questCount != static_cast<std::uint32_t>(kQuestCount))
        return fail(SaveError::SizeMismatch);  // closest existing error for table drift
    if (h.questFingerprint != quest_table_fingerprint())
        return fail(SaveError::SizeMismatch);

    // Parse into a scratch copy and commit only on success: a half-applied load would
    // leave the game in a state no run has ever reached, which is harder to recover from
    // than simply not loading.
    SaveState tmp;
    Reader r(bytes + kSaveHeaderWire, h.payloadBytes);
    visit_ledger(r, tmp.ledger);
    visit_book(r, tmp.book);
    visit_player(r, tmp.player);
    // Version 7: character sheet + crafting bank.
    visit_rpg(r, tmp.rpg);
    {
        const std::size_t pos = r.at();
        if (static_cast<std::size_t>(h.payloadBytes) < pos + kCraftingWire)
            return fail(SaveError::TooShort);
        if (!craft_read(bytes + kSaveHeaderWire + pos, kCraftingWire, tmp.craft))
            return fail(SaveError::TooShort);
        r.skip(kCraftingWire);
    }
    // Version 8 / SAVMAG: firearm chamber + kill tally.
    r.u8(tmp.hasRanged);
    visit_ranged(r, tmp.ranged);
    r.u32(tmp.kills);
    // Version 9 / SAVSTAT: live status effects.
    visit_status(r, tmp.status);
    // Version 10 / SAVCLOCK: mirrors the writer exactly, same order, same position.
    visit_samosbor(r, tmp.samosbor);
    for (std::size_t i = 0; i < kFastTravelWire; ++i) r.u8(tmp.fastTravel.raw()[i]);
    // Version 15: Bank account persistence & power grid state.
    visit_bank(r, tmp.bank);
    visit_power_grid(r, tmp.powerGrid);
    if (tmp.powerGrid.count > kMaxDestroyedShields)
        tmp.powerGrid.count = static_cast<std::uint32_t>(kMaxDestroyedShields);
    tmp.opened.resize(static_cast<std::size_t>(h.openedCount));
    for (std::size_t i = 0; i < tmp.opened.size(); ++i) visit_key(r, tmp.opened[i]);
    // Version 6: the macro blobs, verbatim (decoded by their owners against live
    // objects, which a parse must not require), then the faction matrix.
    {
        const std::uint8_t* pool = bytes + kSaveHeaderWire + r.at();
        r.skip(static_cast<std::size_t>(h.poolBytes));
        const std::uint8_t* macro = bytes + kSaveHeaderWire + r.at();
        r.skip(static_cast<std::size_t>(h.macroBytes));
        if (!r.ok()) return fail(SaveError::TooShort);
        tmp.poolBlob.assign(pool, pool + h.poolBytes);
        tmp.macroBlob.assign(macro, macro + h.macroBytes);
        for (std::size_t i = 0; i < kFactionWire; ++i) {
            std::uint8_t b = 0;
            r.u8(b);
            tmp.factions.v[i] = static_cast<std::int8_t>(b);
        }
    }
    if (!r.ok()) return fail(SaveError::TooShort);
    // Version 2: parse quest log from the remaining bytes (exactly kQuestLogWire).
    {
        const std::size_t pos = r.at();
        if (!quest_log_read(bytes + kSaveHeaderWire + pos,
                            static_cast<std::size_t>(h.payloadBytes) - pos,
                            tmp.quests))
            return fail(SaveError::TooShort);
    }
    // Every declared byte consumed and no more. A surviving remainder would mean the
    // wire constants and the visitors disagree, which the static_asserts above already
    // forbid — this is the runtime backstop for the case where they are edited together
    // and both are wrong.
    if (r.at() + kQuestLogWire != static_cast<std::size_t>(h.payloadBytes))
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
    //
    // Through the shared helper rather than inline, so a crate's key and a restored
    // body's cell cannot end up one cell apart over a difference in how two copies of
    // this expression round.
    macro_cell_of(pos, k.cx, k.cy, k.cz);
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

// ---------------------------------------------------------------------------
// Coming back to where you stood
// ---------------------------------------------------------------------------

// The hop ceiling must cover every label the registry can hold, or a deep travelling
// load could stop short of the floor its own save named and report success.
static_assert(kMaxLoadHops >= kFloorSlots,
              "kMaxLoadHops is FloorRegistry::kFloorSlots; keep them together");
// Placement puts a body at a cell centre by kCellSize; `embody` puts one there by
// kEmbodyCellSize. They are the same 2 m today and the day they are not, a restored body
// lands off the grid its floor was generated on.
static_assert(kEmbodyCellSize == kCellSize,
              "embody and placement must agree on the size of a macro cell");

LoadTravel travel_to_saved_floor(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                                 NpcPool& pool, FloorStreamer& streamer, Entity player,
                                 int fromFloor, int targetFloor,
                                 std::uint8_t arrivalCoord) {
    LoadTravel out;
    out.floor = fromFloor;
    out.player = player;
    if (const Transform* tr = ecs.try_get<Transform>(player)) out.layer = tr->layer;

    if (targetFloor == fromFloor) {
        out.arrived = true;
        return out;
    }
    // A save from a build whose stack carried a floor this one does not. Refused before
    // anything moves: a load that travelled halfway and then stopped is harder to
    // explain to the player than one that says it could not go at all.
    if (reg.module_at(targetFloor) == kInvalidModule) return out;

    for (int hop = 0; hop < kMaxLoadHops && out.floor != targetFloor; ++hop) {
        const int dir = targetFloor > out.floor ? +1 : -1;
        // The player's DURABLE record id, re-read each hop because every ride destroys
        // the body and builds a new one. kInvalidNpc here would make `ensure_loaded`
        // designate a NEW player on the destination floor — a second camera holder — so
        // a body with no NpcRef stops the travel instead of riding it.
        NpcId pid = kInvalidNpc;
        if (const NpcRef* ref = ecs.try_get<NpcRef>(out.player)) pid = ref->id;
        if (pid == kInvalidNpc) break;

        const RideResult ride = streamer.travel(stack, reg, ecs, pool, out.player,
                                               out.floor, dir, arrivalCoord, pid);
        if (!ride.moved) break;   // end of the stack, or the next floor would not load
        out.player = ride.player;
        out.layer = ride.layer;
        out.floor = ride.floor;
        out.moved = true;
        ++out.hops;
        // `next_labelled_floor` steps to the nearest LABEL beyond the current floor and
        // the target is itself a label, so the target cannot be passed. Checked anyway:
        // the loop condition tests equality, so an overshoot would ride to the end of
        // the building before the hop ceiling stopped it.
        if ((dir > 0 && out.floor > targetFloor) ||
            (dir < 0 && out.floor < targetFloor))
            break;
    }
    out.arrived = (out.floor == targetFloor);
    return out;
}

void macro_cell_of(const vec3& pos, std::uint8_t& cx, std::uint8_t& cy,
                   std::uint8_t& cz) {
    cx = static_cast<std::uint8_t>(wrap_macro(static_cast<int>(pos.x / kCellSize)));
    cy = static_cast<std::uint8_t>(wrap_macro(static_cast<int>(pos.y / kCellSize)));
    cz = static_cast<std::uint8_t>(wrap_macro(static_cast<int>(pos.z / kCellSize)));
}

vec3 macro_cell_centre(std::uint8_t cx, std::uint8_t cy, std::uint8_t cz) {
    return vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
                (static_cast<float>(cy) + 0.5f) * kCellSize,
                (static_cast<float>(cz) + 0.5f) * kCellSize};
}

namespace {

// Half-extents `physics_step` would use for this entity. The fallback is the solver's
// own (a 0.4 m cube) and NOT `AABB`'s default member of {0.4, 0.4, 0.9}: matching the
// solver matters more than matching the struct, because a placement test more permissive
// than the solver hands back a cell the body cannot actually occupy.
vec3 half_extents_of(Registry& reg, Entity e) {
    if (const AABB* b = reg.try_get<AABB>(e)) return b->half;
    return vec3{0.4f, 0.4f, 0.4f};
}

// Does a body of `half` fit standing in this cell, and is there a floor under it?
// Coordinates are raw (possibly out of range) cell indices; both axes wrap.
void probe_cell(const World& world, const vec3& half, int cx, int cy, int cz,
                bool& fits, bool& supported) {
    const vec3 c = macro_cell_centre(static_cast<std::uint8_t>(wrap_macro(cx)),
                                     static_cast<std::uint8_t>(wrap_macro(cy)),
                                     static_cast<std::uint8_t>(wrap_macro(cz)));
    fits = !aabb_overlaps_solid(world, c, half);
    supported = false;
    if (!fits) return;
    // One sub-voxel (0.25 m) thick, the width of the body, directly under the feet: deep
    // enough to find a slab, shallow enough not to see through a Derelict floor's
    // collapsed hole to the storey below. The same predicate as above, so "supported"
    // cannot disagree with "fits" about what solid means.
    const vec3 footHalf{half.x, half.y, kVoxelSize * 0.5f};
    const vec3 foot{c.x, c.y, c.z - half.z - kVoxelSize * 0.5f};
    supported = aabb_overlaps_solid(world, foot, footHalf);
}

// The wire carries hp as std::int32_t and the pool row is std::int16_t, so the load side
// is where that narrowing happens. Clamped rather than truncated: a forged save with
// hp = 65636 would otherwise wrap to 100 and look plausible.
std::int16_t clamp_i16(std::int32_t v) {
    if (v < INT16_MIN) return static_cast<std::int16_t>(INT16_MIN);
    if (v > INT16_MAX) return static_cast<std::int16_t>(INT16_MAX);
    return static_cast<std::int16_t>(v);
}

} // namespace

PlacedCell find_standable_cell(const World& world, const vec3& half, std::uint8_t cx,
                               std::uint8_t cy, std::uint8_t cz, int radius) {
    PlacedCell out;
    out.cx = cx;
    out.cy = cy;
    out.cz = cz;

    bool fits = false, supported = false;
    probe_cell(world, half, cx, cy, cz, fits, supported);
    if (fits) {
        // The cell the caller asked for still holds a body. Support is reported and NOT
        // required: a player who saved mid-jump or in fly mode was legitimately in the
        // air, and moving them to the nearest floor would be a teleport to fix nothing.
        out.ok = true;
        out.supported = supported;
        return out;
    }
    if (radius < 1) return out;
    if (radius > kPlaceRadiusMax) radius = kPlaceRadiusMax;

    // Two buckets, filled by one scan: the best cell with a floor under it, and the best
    // cell without. The supported bucket wins whenever it has anything, because a body
    // dropped into a shaft falls and lands while a body sealed in solid never moves
    // again — so "no floor nearby" must not be reported as failure.
    struct Best {
        int ring = 0;
        int adz = 0;
        int planar = 0;
        std::uint8_t cx = 0;
        std::uint8_t cy = 0;
        std::uint8_t cz = 0;
        bool have = false;
    };
    Best best[2];
    // Strictly better under (ring, |dz|, planar distance). STRICT, so the first
    // candidate found at a given key keeps it and the scan order settles ties — which is
    // what makes two loads of the same save place the body identically.
    auto improves = [](const Best& b, int ring, int adz, int planar) {
        if (!b.have) return true;
        if (ring != b.ring) return ring < b.ring;
        if (adz != b.adz) return adz < b.adz;
        return planar < b.planar;
    };

    for (int dz = -radius; dz <= radius; ++dz) {
        const int adz = dz < 0 ? -dz : dz;
        for (int dy = -radius; dy <= radius; ++dy) {
            const int ady = dy < 0 ? -dy : dy;
            for (int dx = -radius; dx <= radius; ++dx) {
                const int adx = dx < 0 ? -dx : dx;
                int ring = adx > ady ? adx : ady;
                if (adz > ring) ring = adz;
                if (ring == 0) continue;   // the requested cell, already rejected above
                const int planar = adx * adx + ady * ady;
                const bool couldSup = improves(best[0], ring, adz, planar);
                const bool couldFree = improves(best[1], ring, adz, planar);
                // Skip the solidity test outright once neither bucket can improve. This
                // is what keeps the default 17^3 = 4,913-cell neighbourhood cheap: once
                // a ring-1 cell is found, only ring-1 cells are ever probed again.
                if (!couldSup && !couldFree) continue;
                probe_cell(world, half, cx + dx, cy + dy, cz + dz, fits, supported);
                if (!fits) continue;
                if (!(supported ? couldSup : couldFree)) continue;
                Best& b = best[supported ? 0 : 1];
                b.ring = ring;
                b.adz = adz;
                b.planar = planar;
                b.cx = static_cast<std::uint8_t>(wrap_macro(cx + dx));
                b.cy = static_cast<std::uint8_t>(wrap_macro(cy + dy));
                b.cz = static_cast<std::uint8_t>(wrap_macro(cz + dz));
                b.have = true;
            }
        }
    }

    const Best& pick = best[0].have ? best[0] : best[1];
    // Nothing in the neighbourhood holds a body. `ok` stays false and the cell stays
    // exactly as asked — see the header on why a plausible-looking substitute would be
    // the worse answer.
    if (!pick.have) return out;
    out.cx = pick.cx;
    out.cy = pick.cy;
    out.cz = pick.cz;
    out.rings = static_cast<std::uint8_t>(pick.ring);
    out.ok = true;
    out.moved = true;
    out.supported = best[0].have;
    return out;
}

PlacedCell place_body_at_cell(Registry& reg, const World& world, Entity body,
                              std::uint8_t cx, std::uint8_t cy, std::uint8_t cz,
                              int radius) {
    PlacedCell out;
    out.cx = cx;
    out.cy = cy;
    out.cz = cz;
    Transform* tr = reg.try_get<Transform>(body);
    if (!tr) return out;   // not an embodied body; there is nothing to place

    out = find_standable_cell(world, half_extents_of(reg, body), cx, cy, cz, radius);
    // SHOTLOG: headless --shot harnesses cannot see a soft-lock; emit when the
    // requested cell was solid (relocated) or nothing nearby fits (refused).
    // Quiet on the common path (ok && !moved) so interactive play stays clean.
    if (!out.ok) {
        std::fprintf(stderr,
                     "[place] REFUSE body req=(%u,%u,%u) r=%d (no standable cell)\n",
                     static_cast<unsigned>(cx), static_cast<unsigned>(cy),
                     static_cast<unsigned>(cz), radius);
        return out;   // refuse rather than plant a body inside a wall
    }
    if (out.moved) {
        std::fprintf(stderr,
                     "[place] MOVE body (%u,%u,%u)->(%u,%u,%u) rings=%u supp=%d\n",
                     static_cast<unsigned>(cx), static_cast<unsigned>(cy),
                     static_cast<unsigned>(cz), static_cast<unsigned>(out.cx),
                     static_cast<unsigned>(out.cy), static_cast<unsigned>(out.cz),
                     static_cast<unsigned>(out.rings), out.supported ? 1 : 0);
    }

    tr->pos = macro_cell_centre(out.cx, out.cy, out.cz);
    // Not tidiness: a load can land mid-fall, and physics resolves the next step from
    // the NEW position — a carried-over 30 m/s would drive the body straight through the
    // floor it was just placed on.
    if (Velocity* v = reg.try_get<Velocity>(body)) v->v = vec3{0.0f, 0.0f, 0.0f};
    return out;
}


PlacedCell place_body_safely(Registry& reg, const World& world, Entity body,
                             int radius) {
    PlacedCell out;
    const Transform* tr = reg.try_get<Transform>(body);
    if (!tr) return out;
    std::uint8_t cx = 0, cy = 0, cz = 0;
    macro_cell_of(tr->pos, cx, cy, cz);
    return place_body_at_cell(reg, world, body, cx, cy, cz, radius);
}

// ---------------------------------------------------------------------------
// The active-floor snapshot codec
// ---------------------------------------------------------------------------
// Layout (all little-endian, via the same Writer/Reader as the rest of the file):
//   i32  floor
//   u32  typeRuns;   typeRuns  x (u16 value, u32 len)   — cell types, RLE
//   u32  stateRuns;  stateRuns x (u8 state, u32 len)    — 0 empty / 1 full / 2 mixed
//   u32  mixedCount; mixedCount x 8 x u64               — raw masks, cell order
//   u32  pageCount;  pageCount x (u32 cell, 512 x u16)  — sub-material pages
// A generated floor is overwhelmingly uniform (air, full wall, full slab), so the
// two RLE streams collapse to a few thousand runs and the mixed masks are only the
// carved/stair cells — single-digit MB against the raw 138 MB.

std::size_t snapshot_floor(const World& w, int floorNumber,
                           std::vector<std::uint8_t>& out) {
    out.clear();
    Writer wr(out);
    wr.i32(static_cast<std::int32_t>(floorNumber));

    const std::vector<CellType>& types = w.grid().types();
    const std::vector<SubMask>& masks = w.grid().masks();

    // Pass 1 over types: count runs, then emit. Two passes beat buffering runs.
    auto emit_type_runs = [&](bool countOnly, std::uint32_t& runs) {
        runs = 0;
        std::size_t i = 0;
        while (i < kMacroCells) {
            const CellType v = types[i];
            std::size_t j = i + 1;
            while (j < kMacroCells && types[j] == v) ++j;
            if (!countOnly) {
                wr.u16(v);
                wr.u32(static_cast<std::uint32_t>(j - i));
            }
            ++runs;
            i = j;
        }
    };
    std::uint32_t typeRuns = 0;
    emit_type_runs(true, typeRuns);
    wr.u32(typeRuns);
    emit_type_runs(false, typeRuns);

    auto state_of = [&](std::size_t i) -> std::uint8_t {
        if (masks[i].empty()) return 0;
        return masks[i].full() ? 1 : 2;
    };
    auto emit_state_runs = [&](bool countOnly, std::uint32_t& runs,
                               std::uint32_t& mixed) {
        runs = 0;
        mixed = 0;
        std::size_t i = 0;
        while (i < kMacroCells) {
            const std::uint8_t s = state_of(i);
            std::size_t j = i + 1;
            while (j < kMacroCells && state_of(j) == s) ++j;
            if (s == 2) mixed += static_cast<std::uint32_t>(j - i);
            if (!countOnly) {
                wr.u8(s);
                wr.u32(static_cast<std::uint32_t>(j - i));
            }
            ++runs;
            i = j;
        }
    };
    std::uint32_t stateRuns = 0, mixedCount = 0;
    emit_state_runs(true, stateRuns, mixedCount);
    wr.u32(stateRuns);
    emit_state_runs(false, stateRuns, mixedCount);

    wr.u32(mixedCount);
    for (std::size_t i = 0; i < kMacroCells; ++i) {
        if (state_of(i) != 2) continue;
        for (std::size_t k2 = 0; k2 < kSubMaskWords; ++k2)
            wr.u64(masks[i].words[k2]);
    }

    const SubField<CellType>* mats =
        w.subfields().find<CellType>(kSubMaterialName);
    std::uint32_t pageCount = 0;
    if (mats)
        for (std::size_t i = 0; i < kMacroCells; ++i)
            if (mats->paged(i)) ++pageCount;
    wr.u32(pageCount);
    if (mats) {
        for (std::size_t i = 0; i < kMacroCells; ++i) {
            const CellType* pg = mats->page(i);
            if (!pg) continue;
            wr.u32(static_cast<std::uint32_t>(i));
            // RUN-LENGTH, not raw. A page is 512 sub-voxel materials and it is
            // almost never 512 DIFFERENT ones: the padic sandwich gives a cell a
            // run of base, a run of ceiling plaster and a run of floor concrete —
            // three runs, ~14 bytes, against 1024 raw. Written the same way the
            // type and mask-state arrays above already are.
            //
            // This does NOT constrain what a page may contain. Flaked plaster, a
            // blast crater, any arbitrary mix of atoms still encodes — it just
            // costs more runs. That is the point: the cell stays a LEGO of atoms
            // and only the ENCODING gets cheaper. (The alternative once floated
            // here — promoting common combinations to CellTypes — would have
            // hardcoded a finite set of mixes into the material vocabulary and
            // broken the moment a surface chipped. Rejected, correctly.)
            std::uint32_t runs = 0;
            for (int b = 0; b < kSubVoxels;) {
                int e = b + 1;
                while (e < kSubVoxels && pg[e] == pg[b]) ++e;
                ++runs;
                b = e;
            }
            wr.u16(static_cast<std::uint16_t>(runs));
            for (int b = 0; b < kSubVoxels;) {
                int e = b + 1;
                while (e < kSubVoxels && pg[e] == pg[b]) ++e;
                wr.u16(pg[b]);
                wr.u16(static_cast<std::uint16_t>(e - b));
                b = e;
            }
        }
    }
    return out.size();
}

bool apply_floor_snapshot(World& w, const std::uint8_t* bytes, std::size_t n,
                          std::int32_t* floorOut) {
    if (!bytes || n == 0) return false;
    Reader r(bytes, n);
    std::int32_t floor = 0;
    r.i32(floor);
    if (floorOut) *floorOut = floor;

    std::vector<CellType>& types = w.grid().types_mut();
    std::vector<SubMask>& masks = w.grid().masks_mut();

    std::uint32_t typeRuns = 0;
    r.u32(typeRuns);
    std::size_t at = 0;
    for (std::uint32_t k2 = 0; k2 < typeRuns && r.ok(); ++k2) {
        std::uint16_t v = 0;
        std::uint32_t len = 0;
        r.u16(v);
        r.u32(len);
        // Subtract, never add: `at + len` is uint32 arithmetic and a hostile or
        // corrupt run length wraps it past the guard straight into the write below.
        if (len > kMacroCells - at) return false;
        for (std::uint32_t j = 0; j < len; ++j) types[at + j] = v;
        at += len;
    }
    if (!r.ok() || at != kMacroCells) return false;

    std::uint32_t stateRuns = 0;
    r.u32(stateRuns);
    // Mixed cells are flagged and filled from the raw stream afterwards, in the
    // same cell order the writer walked.
    std::vector<std::uint32_t> mixedCells;
    at = 0;
    for (std::uint32_t k2 = 0; k2 < stateRuns && r.ok(); ++k2) {
        std::uint8_t s = 0;
        std::uint32_t len = 0;
        r.u8(s);
        r.u32(len);
        if (s > 2 || len > kMacroCells - at) return false; // same wrap guard
        for (std::uint32_t j = 0; j < len; ++j) {
            if (s == 0) masks[at + j].clear_all();
            else if (s == 1) masks[at + j].set_all();
            else mixedCells.push_back(static_cast<std::uint32_t>(at + j));
        }
        at += len;
    }
    if (!r.ok() || at != kMacroCells) return false;

    std::uint32_t mixedCount = 0;
    r.u32(mixedCount);
    if (mixedCount != mixedCells.size()) return false;
    for (std::uint32_t mc : mixedCells) {
        for (std::size_t k2 = 0; k2 < kSubMaskWords; ++k2)
            r.u64(masks[mc].words[k2]);
        // An all-zero or all-one "mixed" mask would desync state_of on the next
        // snapshot; refuse rather than normalise silently.
        if (masks[mc].empty() || masks[mc].full()) return false;
    }
    if (!r.ok()) return false;

    std::uint32_t pageCount = 0;
    r.u32(pageCount);
    SubField<CellType>& mats =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    mats.clear();
    for (std::uint32_t p = 0; p < pageCount && r.ok(); ++p) {
        std::uint32_t cell = 0;
        r.u32(cell);
        if (cell >= kMacroCells) return false;
        CellType* pg = mats.ensure_page(cell, types[cell]);
        std::uint16_t runs = 0;
        r.u16(runs);
        int pageOffset = 0;
        for (std::uint16_t k = 0; k < runs && r.ok(); ++k) {
            std::uint16_t v = 0, len = 0;
            r.u16(v);
            r.u16(len);
            // Subtract-never-add, the same guard the mask and type runs use: a
            // forged length cannot walk past the page.
            if (len == 0 || len > static_cast<std::uint16_t>(kSubVoxels - pageOffset))
                return false;
            for (std::uint32_t j = 0; j < len; ++j) pg[pageOffset + j] = v;
            pageOffset += len;
        }
        if (pageOffset != kSubVoxels) return false;
    }
    // Every byte consumed, none left over — same discipline as save_read.
    return r.ok() && r.at() == n;
}

void floor_file_write(const World& w, int floorNumber,
                      std::vector<std::uint8_t>& out) {
    std::vector<std::uint8_t> blob;
    snapshot_floor(w, floorNumber, blob);

    // SAY IT when the writer outgrows the reader. There is no guard here on
    // purpose — refusing to write would lose the floor silently, which is worse —
    // but the reader rejects anything over kMaxSnapBytes, and for a year the two
    // disagreed with no diagnostic at either end: floor files were written and
    // refused, and the only clue was one `refused: ... (floor regenerates
    // pristine)` line on load, long after the cause. Now the WRITE side names it
    // too, so the next size regression is a number at the moment it happens.
    // [save.h] kMaxSnapBytes, [problems.md] §37.
    if (blob.size() > static_cast<std::size_t>(kMaxSnapBytes)) {
        std::fprintf(stderr,
                     "[save] floor %d snapshot is %zu B, past the %u B read cap "
                     "— this file will be REFUSED on load\n",
                     floorNumber, blob.size(), kMaxSnapBytes);
    }

    out.clear();
    out.reserve(kFloorHeaderWire + blob.size());
    Writer wr(out);
    wr.u32(kFloorMagic);
    wr.u32(kFloorFileVersion);
    wr.u32(static_cast<std::uint32_t>(blob.size()));
    wr.u32(crc32(blob.data(), blob.size()));
    out.insert(out.end(), blob.begin(), blob.end());
}

bool floor_file_read(const std::uint8_t* bytes, std::size_t n, World& w,
                     std::int32_t* floorOut, SaveError* err) {
    if (err) *err = SaveError::None;
    auto fail = [err](SaveError e) {
        if (err) *err = e;
        return false;
    };
    if (!bytes || n < kFloorHeaderWire) return fail(SaveError::TooShort);
    Reader r(bytes, kFloorHeaderWire);
    std::uint32_t magic = 0, version = 0, blobBytes = 0, crc = 0;
    r.u32(magic);
    r.u32(version);
    r.u32(blobBytes);
    r.u32(crc);
    if (magic != kFloorMagic) return fail(SaveError::BadMagic);
    if (version != kFloorFileVersion) return fail(SaveError::BadVersion);
    if (blobBytes > kMaxSnapBytes) return fail(SaveError::SizeMismatch);
    if (n - kFloorHeaderWire != static_cast<std::size_t>(blobBytes))
        return fail(SaveError::SizeMismatch);
    if (crc32(bytes + kFloorHeaderWire, blobBytes) != crc)
        return fail(SaveError::BadChecksum);
    if (!apply_floor_snapshot(w, bytes + kFloorHeaderWire, blobBytes, floorOut))
        return fail(SaveError::SizeMismatch);
    return true;
}

void apply_player_snapshot(NpcPool& pool, NpcId id, const PlayerSnapshot& snap) {
    if (!pool.valid(id)) return;
    pool.needs(id) = snap.clock;
    pool.inventory(id) = snap.inv;
    pool.hp(id) = clamp_i16(snap.hp);
    // See the header: a zero maximum would make `entity_health` report 0/0 and every
    // heal a no-op, so a save that carries none leaves the row's own maximum alone.
    if (snap.maxHp > 0) pool.max_hp(id) = clamp_i16(snap.maxHp);
    // `floor` is deliberately not written — it is the seeding label, and nothing in the
    // tree reads it. `cx/cy/cz` are not written either: placement moves the BODY and
    // `fold_back` re-derives the row from that transform.
}

} // namespace giga::game
