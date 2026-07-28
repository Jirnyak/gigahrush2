// Save / load — the format, and the two ways it is allowed to fail.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga::game`. Everything except the single entry point
// `test_saveload_all()` lives in `namespace saveload_test`.
//
// Two load-bearing tests, and they are testing opposite things:
//
//   * `round_trip()` proves the format is lossless. It fills EVERY field with a
//     distinct value first, because a round-trip over zeroes passes even when the
//     serializer drops half the struct.
//   * `weak_check_vs_strong_check()` proves the format refuses a save it would
//     otherwise misread. That is the whole reason this file exists: `ItemId` is a row
//     index into an alphabetically-sorted CSV, so a reordered table turns a valid save
//     into a valid save that means something else. It re-derives the fingerprint
//     independently, then shows a REORDER at constant row count — the case
//     `kItemCount` cannot see — is rejected.
//
// A note on "byte-for-byte", because the phrase is easy to get wrong here. The
// assertions compare the SERIALIZED BYTES, not the structs. `Contract` carries two bytes
// of implicit padding between `subject` and `target` and `RunLedger` seven at its tail,
// and the standard says nothing about what aggregate initialization puts in them — so a
// `memcmp` of two of those structs is a test that could fail for a reason that is not a
// bug. The wire has no padding at all (every field is written individually), so a
// byte-for-byte comparison there is exact and means what it says. `Needs` and
// `Inventory` have no implicit padding — 8x4+1+3 and 64x4 — so those two ARE compared
// with memcmp.
#include <cstddef>
#include <cstring>
#include <type_traits>
#include <vector>

#include "game/container.h"
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/save.h"
#include "world/world.h"

namespace saveload_test {

// Patch a little-endian field inside a serialized save, to forge the drift each
// rejection is supposed to catch. Deliberately writes the same byte order `save.cpp`
// does, by hand — a shared helper would hide an endianness bug from both sides.
void poke_u16(std::vector<std::uint8_t>& buf, std::size_t at, std::uint16_t v) {
    buf[at + 0] = static_cast<std::uint8_t>(v & 0xFFu);
    buf[at + 1] = static_cast<std::uint8_t>((v >> 8) & 0xFFu);
}

void poke_u32(std::vector<std::uint8_t>& buf, std::size_t at, std::uint32_t v) {
    for (int i = 0; i < 4; ++i)
        buf[at + static_cast<std::size_t>(i)] =
            static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu);
}

// CRC-32 again, written independently. Two jobs: it lets a test re-checksum a payload it
// edited on purpose, and — pinned below against the standard's own check value — it
// proves the production checksum really is CRC-32 rather than "a hash that agrees with
// itself", which is all a same-implementation comparison could ever show.
std::uint32_t crc32_over(const std::uint8_t* p, std::size_t n) {
    std::uint32_t c = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < n; ++i) {
        c ^= static_cast<std::uint32_t>(p[i]);
        for (int k = 0; k < 8; ++k)
            c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

// Header field offsets, restated here rather than read from `sizeof`. The point of a
// wire format is that these numbers are fixed; if the header is reordered, this list is
// where the test says so.
constexpr std::size_t kOffMagic = 0;
constexpr std::size_t kOffVersion = 4;
constexpr std::size_t kOffTickHz = 8;
constexpr std::size_t kOffItemCount = 12;
constexpr std::size_t kOffMobCount = 16;
constexpr std::size_t kOffItemFp = 20;
constexpr std::size_t kOffMobFp = 24;
constexpr std::size_t kOffOpenedCount = 28;
constexpr std::size_t kOffLedgerBytes = 32;
constexpr std::size_t kOffPayloadBytes = 40;
constexpr std::size_t kOffPayloadCrc = 44;

// A run with every field set to a different number, so a dropped or duplicated field
// cannot survive the round-trip. Nothing here is zero except where zero is the value
// under test.
SaveState busy_run() {
    SaveState st;

    st.ledger.banked = 9'876'543'210LL;       // past int32, on purpose
    st.ledger.lostToDeath = -1;               // signed, and it is allowed to be odd
    st.ledger.bestHaul = 250'000;             // the E4 single-item cap
    st.ledger.deposits = 37u;
    st.ledger.deaths = 5u;
    st.ledger.deepestFloor = -50;             // THE reason the field is signed
    st.ledger.deepestBand = economy_band(-50);

    st.book.completed = 11u;
    st.book.failed = 3u;
    st.book.earned = 4'294'967'296LL;         // 2^32: catches a 32-bit truncation
    for (int i = 0; i < kMaxContracts; ++i) {
        Contract& c = st.book.slot[i];
        c.giver = static_cast<NpcId>(1000 + i);
        c.subject = static_cast<std::uint16_t>(400 + i);
        c.target = 7 + i;
        c.progress = 2 + i;
        c.reward = 900 * (i + 1);
        c.kind = static_cast<std::uint8_t>(i % static_cast<int>(ObjectiveKind::Count));
        c.state = static_cast<std::uint8_t>(ContractState::Active);
        c.baseline = static_cast<std::uint8_t>(20 + i);
    }

    // Eight distinct floats, none of them a round number, so a swapped pair of fields
    // shows up as a mismatch rather than as two equal values.
    Needs& n = st.player.clock;
    n.food = 63.25f;
    n.water = 41.5f;
    n.sleep = 7.125f;
    n.pee = 12.75f;
    n.poo = 33.375f;
    n.pendingPee = 9.0625f;
    n.pendingPoo = 4.5f;
    n.hpDebt = 0.5f;                          // the sub-1-HP fraction; must not reset
    n.seeded = 1;

    // A bag with something in the first slot, something in the last, and a gap.
    st.player.inv.slots[0] = ItemSlot{static_cast<ItemId>(1), 3};
    st.player.inv.slots[7] = ItemSlot{static_cast<ItemId>(kItemCount), 1};
    st.player.inv.slots[kInvSlots - 1] = ItemSlot{static_cast<ItemId>(200), 255};
    st.player.hp = 73;
    st.player.maxHp = 100;
    st.player.floorNumber = -50;
    st.player.cx = 40;
    st.player.cy = 91;
    st.player.cz = 1;

    // Two floors' worth of emptied crates, one of them below the hub — the negative
    // floor is the case a `std::uint16_t` floor column could not express at all.
    st.opened.push_back(OpenedContainerKey{-3, 18, 42, 1, 0});
    st.opened.push_back(OpenedContainerKey{-3, 114, 6, 1, 0});
    st.opened.push_back(OpenedContainerKey{2, 66, 66, 1, 0});
    return st;
}

void same_run(const SaveState& a, const SaveState& b) {
    CHECK(a.ledger.banked == b.ledger.banked);
    CHECK(a.ledger.lostToDeath == b.ledger.lostToDeath);
    CHECK(a.ledger.bestHaul == b.ledger.bestHaul);
    CHECK(a.ledger.deposits == b.ledger.deposits);
    CHECK(a.ledger.deaths == b.ledger.deaths);
    CHECK(a.ledger.deepestFloor == b.ledger.deepestFloor);
    CHECK(a.ledger.deepestBand == b.ledger.deepestBand);

    CHECK(a.book.completed == b.book.completed);
    CHECK(a.book.failed == b.book.failed);
    CHECK(a.book.earned == b.book.earned);
    for (int i = 0; i < kMaxContracts; ++i) {
        const Contract& x = a.book.slot[i];
        const Contract& y = b.book.slot[i];
        CHECK(x.giver == y.giver);
        CHECK(x.subject == y.subject);
        CHECK(x.target == y.target);
        CHECK(x.progress == y.progress);
        CHECK(x.reward == y.reward);
        CHECK(x.kind == y.kind);
        CHECK(x.state == y.state);
        CHECK(x.baseline == y.baseline);
    }

    // Padding-free structs, so a raw byte compare is exact rather than optimistic.
    static_assert(sizeof(Needs) == 8 * 4 + 1 + 3, "Needs has no implicit padding");
    static_assert(sizeof(Inventory) == 64 * 4, "Inventory has no implicit padding");
    CHECK(std::memcmp(&a.player.clock, &b.player.clock, sizeof(Needs)) == 0);
    CHECK(std::memcmp(&a.player.inv, &b.player.inv, sizeof(Inventory)) == 0);
    CHECK(a.player.hp == b.player.hp);
    CHECK(a.player.maxHp == b.player.maxHp);
    CHECK(a.player.floorNumber == b.player.floorNumber);
    CHECK(a.player.cx == b.player.cx);
    CHECK(a.player.cy == b.player.cy);
    CHECK(a.player.cz == b.player.cz);

    CHECK(a.opened.size() == b.opened.size());
    const std::size_t nk = a.opened.size() < b.opened.size() ? a.opened.size()
                                                             : b.opened.size();
    for (std::size_t i = 0; i < nk; ++i) CHECK(same_container(a.opened[i], b.opened[i]));
}

void wire_layout() {
    // The format's footprint is arithmetic, not a measurement — a save whose length
    // depends on the compiler is a save that cannot cross hosts.
    static_assert(kSaveHeaderWire == 48);
    static_assert(kSaveFixedWire == 416);
    static_assert(save_bytes_for(0) == 464);
    static_assert(save_bytes_for(3) == 464 + 15);

    std::vector<std::uint8_t> bytes;
    SaveState empty;
    save_write(empty, bytes);
    CHECK(bytes.size() == save_bytes_for(0));

    const SaveState st = busy_run();
    save_write(st, bytes);
    CHECK(bytes.size() == save_bytes_for(3));
    // 479 B for a full run with three emptied crates. Worth writing down: the reflex on
    // a save system is to assume megabytes, and the reason this one is tiny is that
    // geometry, monsters and 950k NPC rows are all reproducible from fixed seeds and so
    // are not in the file at all.
    CHECK(bytes.size() == 479);

    // The magic is readable in a hex dump: 'G' 'H' '2' 'S'.
    CHECK(bytes[0] == 'G');
    CHECK(bytes[1] == 'H');
    CHECK(bytes[2] == '2');
    CHECK(bytes[3] == 'S');

    // The checksum really is CRC-32, not merely self-consistent. `crc32_over` is pinned
    // against the standard's own check value — CRC-32 of "123456789" is 0xCBF43926 — and
    // then the header must agree with it over the payload. Either half alone would be
    // circular.
    std::uint8_t probe[9] = {};
    const char* digits = "123456789";
    for (std::size_t d = 0; d < 9; ++d)
        probe[d] = static_cast<std::uint8_t>(digits[d]);
    CHECK(crc32_over(probe, 9) == 0xCBF43926u);
    CHECK(crc32_over(nullptr, 0) == 0u);   // the empty message, by definition

    // tickHz is recorded, and it is the LIVE constant rather than a literal — the whole
    // reason core/tick.h exists is that a copy of the number drifts.
    SaveHeader h{};
    SaveState back;
    CHECK(save_read(bytes.data(), bytes.size(), back, nullptr, &h));
    CHECK(h.payloadCrc == crc32_over(bytes.data() + kSaveHeaderWire,
                                     bytes.size() - kSaveHeaderWire));
    CHECK(h.tickHz == static_cast<std::uint32_t>(kSimHz));
    CHECK(h.tickHz == 125u);
    CHECK(h.version == kSaveVersion);
    CHECK(h.itemCount == static_cast<std::uint32_t>(kItemCount));
    CHECK(h.mobKindCount == static_cast<std::uint32_t>(kMobKindCount));
    CHECK(h.openedCount == 3u);
    CHECK(h.payloadBytes == kSaveFixedWire + 3u * kOpenedKeyWire);

    // A save written by the 120 Hz build STILL LOADS, and this is deliberate rather
    // than an oversight. Nothing currently in the payload is tick-derived — the clock is
    // per-second floats, contract progress is a count, the ledger is roubles — so
    // refusing would discard a good save over a number that does not affect it. What
    // the format owes the caller is the ability to KNOW: the header reports 120, so a
    // caller that later stores a tick count or a millisecond timer can start rejecting
    // without a format change.
    std::vector<std::uint8_t> old120 = bytes;
    poke_u32(old120, kOffTickHz, 120u);
    SaveHeader oh{};
    SaveState oback;
    SaveError oerr = SaveError::Count;
    CHECK(save_read(old120.data(), old120.size(), oback, &oerr, &oh));
    CHECK(oerr == SaveError::None);
    CHECK(oh.tickHz == 120u);
    CHECK(oh.tickHz != static_cast<std::uint32_t>(kSimHz));
    same_run(st, oback);
}

void round_trip() {
    const SaveState src = busy_run();

    std::vector<std::uint8_t> a;
    save_write(src, a);

    SaveState dst;
    SaveError err = SaveError::Count;
    CHECK(save_read(a.data(), a.size(), dst, &err));
    CHECK(err == SaveError::None);
    same_run(src, dst);

    // Byte-for-byte: re-serializing what was read must reproduce the original file
    // exactly. This is the assertion that catches a field the reader consumed into the
    // wrong place — the values would still be "present", and the second write would put
    // them back in a different order.
    std::vector<std::uint8_t> b;
    save_write(dst, b);
    CHECK(a.size() == b.size());
    CHECK(std::memcmp(a.data(), b.data(), a.size()) == 0);

    // ...and a third pass, because a format that is stable once may still be
    // asymmetric in a way that cancels on the second application.
    SaveState third;
    CHECK(save_read(b.data(), b.size(), third, &err));
    CHECK(err == SaveError::None);
    same_run(src, third);

    // A run that has done nothing round-trips too. Cheap, and it is the state the game
    // is in on the very first autosave.
    const SaveState fresh;
    std::vector<std::uint8_t> z;
    save_write(fresh, z);
    SaveState zback;
    CHECK(save_read(z.data(), z.size(), zback, &err));
    CHECK(err == SaveError::None);
    CHECK(zback.opened.empty());
    same_run(fresh, zback);

    // The signed floor survives, which is the point of storing it at all. `NpcPool`'s
    // own floor column is a std::uint16_t, so it reads floor -50 back as 65486 and
    // cannot recover the label — that truncation is why PlayerSnapshot and
    // OpenedContainerKey each carry their own signed number instead of borrowing it.
    static_assert(static_cast<int>(static_cast<std::uint16_t>(-50)) == 65486);
    CHECK(dst.player.floorNumber == -50);
    CHECK(dst.ledger.deepestFloor == -50);
    CHECK(dst.opened[0].floor == -3);
}

// Independent FNV-1a over a list of names, so the expected fingerprint is derived by
// this file rather than taken on trust from the code under test.
std::uint32_t fnv_names(const char* const* names, std::size_t n) {
    std::uint32_t h = 0x811C9DC5u;
    for (std::size_t i = 0; i < n; ++i) {
        for (const char* p = names[i];; ++p) {
            h ^= static_cast<std::uint32_t>(static_cast<std::uint8_t>(*p));
            h *= 0x01000193u;
            if (*p == '\0') break;
        }
    }
    return h;
}

void weak_check_vs_strong_check() {
    // The two checks agree with an independent derivation. Without this the rest of the
    // test would only be proving that a hash equals itself.
    std::vector<const char*> names(kItemNames.begin(), kItemNames.end());
    CHECK(names.size() == kItemCount);
    CHECK(fnv_names(names.data(), names.size()) == item_table_fingerprint());

    std::vector<const char*> mobs(kMobNames.begin(), kMobNames.end());
    CHECK(fnv_names(mobs.data(), mobs.size()) == mob_table_fingerprint());

    // THE failure mode. Two adjacent rows swap places in data/items.csv — say a rename
    // moves one item past its neighbour in the alphabetical sort. The row COUNT is
    // unchanged, so `kItemCount` sees nothing at all, and every saved ItemId that
    // pointed at either row now names the other one.
    const std::uint32_t real = item_table_fingerprint();
    // Two rows that actually differ, or the "swap" below would be a no-op and the test
    // would fail for a reason that has nothing to do with the format.
    CHECK(std::strcmp(kItemNames[10], kItemNames[11]) != 0);
    const char* held = names[10];
    names[10] = names[11];
    names[11] = held;
    const std::uint32_t reordered = fnv_names(names.data(), names.size());
    CHECK(names.size() == kItemCount);   // <-- the weak check is still satisfied
    CHECK(reordered != real);            // <-- the strong check is not

    // A rename at constant count and constant order: the other case a row count misses.
    std::vector<const char*> renamed(kItemNames.begin(), kItemNames.end());
    renamed[300] = "not the item that used to be here";
    CHECK(renamed.size() == kItemCount);
    CHECK(fnv_names(renamed.data(), renamed.size()) != real);

    // Now prove the format acts on it. A save written before the reorder, loaded after,
    // must be REFUSED — not read with every item id above row 10 silently shifted.
    const SaveState src = busy_run();
    std::vector<std::uint8_t> bytes;
    save_write(src, bytes);

    SaveState untouched;
    untouched.ledger.banked = 424242;   // a sentinel: a refused load must not write here

    poke_u32(bytes, kOffItemFp, reordered);
    SaveError err = SaveError::None;
    CHECK(!save_read(bytes.data(), bytes.size(), untouched, &err));
    CHECK(err == SaveError::ItemTableChanged);
    CHECK(untouched.ledger.banked == 424242);   // and it did not

    // The mob table has the identical exposure, through `Contract::subject` — the same
    // std::uint16_t is an ItemId for a Fetch job and a MobKind for a Hunt job, so one
    // field can be invalidated by either CSV.
    save_write(src, bytes);
    poke_u32(bytes, kOffMobFp, mob_table_fingerprint() ^ 0x5A5A5A5Au);
    CHECK(!save_read(bytes.data(), bytes.size(), untouched, &err));
    CHECK(err == SaveError::MobTableChanged);

    // The weak checks still earn their place: they name WHICH table moved, which a hash
    // mismatch cannot, and they fire first.
    save_write(src, bytes);
    poke_u32(bytes, kOffItemCount, static_cast<std::uint32_t>(kItemCount) + 1u);
    CHECK(!save_read(bytes.data(), bytes.size(), untouched, &err));
    CHECK(err == SaveError::ItemCountMismatch);

    save_write(src, bytes);
    poke_u32(bytes, kOffMobCount, static_cast<std::uint32_t>(kMobKindCount) - 1u);
    CHECK(!save_read(bytes.data(), bytes.size(), untouched, &err));
    CHECK(err == SaveError::MobCountMismatch);
}

void rejects_the_rest() {
    const SaveState src = busy_run();
    std::vector<std::uint8_t> good;
    save_write(src, good);

    // A refused load must leave the destination exactly as it was. Every case below
    // re-checks the sentinel, because "returns false but half-applied" is the one
    // failure that would be worse than not loading at all.
    SaveState keep;
    keep.ledger.deaths = 777u;
    keep.player.hp = 55;
    keep.opened.push_back(OpenedContainerKey{9, 1, 2, 3, 0});
    SaveError err = SaveError::None;

    auto refused = [&](std::vector<std::uint8_t>& buf, SaveError want) {
        err = SaveError::None;
        CHECK(!save_read(buf.data(), buf.size(), keep, &err));
        CHECK(err == want);
        CHECK(keep.ledger.deaths == 777u);
        CHECK(keep.player.hp == 55);
        CHECK(keep.opened.size() == 1u);
    };

    // Nothing at all.
    CHECK(!save_read(nullptr, 0, keep, &err));
    CHECK(err == SaveError::TooShort);

    // Shorter than the header.
    std::vector<std::uint8_t> stub(good.begin(), good.begin() + 47);
    refused(stub, SaveError::TooShort);

    // Exactly the header and not one payload byte. The header parses, so this is caught
    // by the length check rather than by the reader running off the end.
    std::vector<std::uint8_t> headerOnly(
        good.begin(), good.begin() + static_cast<std::ptrdiff_t>(kSaveHeaderWire));
    refused(headerOnly, SaveError::TooShort);

    // Truncated mid-payload: the declared length is honest, the file is not.
    std::vector<std::uint8_t> cut(good.begin(), good.end() - 4);
    refused(cut, SaveError::TooShort);

    // Not our file.
    std::vector<std::uint8_t> alien = good;
    poke_u32(alien, kOffMagic, 0xDEADBEEFu);
    refused(alien, SaveError::BadMagic);

    // A future build's save. Refused rather than read as v1 — this is the hook a real
    // migration would replace, and until one exists, refusing is the honest answer.
    std::vector<std::uint8_t> future = good;
    poke_u32(future, kOffVersion, kSaveVersion + 1u);
    refused(future, SaveError::BadVersion);
    std::vector<std::uint8_t> ancient = good;
    poke_u32(ancient, kOffVersion, 0u);
    refused(ancient, SaveError::BadVersion);

    // A struct changed size in this build. Not a wire change on its own — the wire has
    // no padding — but it means a field was added or widened, and the *Bytes fields are
    // the alarm that says so before anything is misread.
    std::vector<std::uint8_t> grown = good;
    poke_u16(grown, kOffLedgerBytes, static_cast<std::uint16_t>(sizeof(RunLedger) + 8));
    refused(grown, SaveError::LayoutMismatch);

    // The header contradicts its own payload length.
    std::vector<std::uint8_t> lying = good;
    poke_u32(lying, kOffPayloadBytes, static_cast<std::uint32_t>(kSaveFixedWire));
    refused(lying, SaveError::SizeMismatch);

    // An opened-crate count no honest save could carry. Bounded BEFORE it is used to
    // size anything, so a corrupt header cannot turn into a large allocation.
    std::vector<std::uint8_t> absurd = good;
    poke_u32(absurd, kOffOpenedCount, 0xFFFFFFFFu);
    refused(absurd, SaveError::SizeMismatch);

    // One flipped payload byte. The checksum covers the payload only, which is why every
    // header case above reports its own reason instead of collapsing to "corrupt".
    std::vector<std::uint8_t> bitrot = good;
    bitrot[kSaveHeaderWire + 3] =
        static_cast<std::uint8_t>(bitrot[kSaveHeaderWire + 3] ^ 0x01u);
    refused(bitrot, SaveError::BadChecksum);

    // A CRC is an integrity check, never a signature: edit the payload AND recompute the
    // checksum and the save loads, because it is now a well-formed save that says
    // something else. Asserted so nobody reads the checksum as tamper-proofing.
    std::vector<std::uint8_t> forged = good;
    // banked's least-significant byte: it is the first field the payload writes.
    forged[kSaveHeaderWire] = static_cast<std::uint8_t>(forged[kSaveHeaderWire] ^ 0x01u);
    SaveState tampered;
    CHECK(!save_read(forged.data(), forged.size(), tampered, &err));
    CHECK(err == SaveError::BadChecksum);
    poke_u32(forged, kOffPayloadCrc,
             crc32_over(forged.data() + kSaveHeaderWire, forged.size() - kSaveHeaderWire));
    CHECK(save_read(forged.data(), forged.size(), tampered, &err));
    CHECK(err == SaveError::None);
    CHECK(tampered.ledger.banked == (src.ledger.banked ^ 0x01LL));

    // Every rejection has words for the player, and no two share a string.
    CHECK(std::strcmp(save_error_text(SaveError::None), "ok") == 0);
    for (int i = 0; i < static_cast<int>(SaveError::Count); ++i) {
        const char* a = save_error_text(static_cast<SaveError>(i));
        CHECK(a != nullptr && a[0] != '\0');
        for (int j = i + 1; j < static_cast<int>(SaveError::Count); ++j)
            CHECK(std::strcmp(a, save_error_text(static_cast<SaveError>(j))) != 0);
    }
    // An out-of-range code does not walk off the switch.
    CHECK(save_error_text(static_cast<SaveError>(200)) != nullptr);

    // And the untampered original still loads, so none of the above passed by accident
    // of a broken writer.
    SaveState ok;
    CHECK(save_read(good.data(), good.size(), ok, &err));
    CHECK(err == SaveError::None);
    same_run(src, ok);
}

void keys_not_entity_ids() {
    // Two crates in the same macro cell get the same key. This is the documented
    // limitation of keying on (floor, cell) rather than on the generator's spawn index,
    // asserted here so it is a known property rather than a surprise: opening one would
    // restore both as opened. It costs a crate, never duplicates an item.
    const vec3 a{40.0f * kCellSize + 0.9f, 20.0f * kCellSize + 0.3f, 2.45f};
    const vec3 b{40.0f * kCellSize + 1.7f, 20.0f * kCellSize + 1.1f, 2.45f};
    CHECK(same_container(container_key(-3, a), container_key(-3, b)));
    // ...and the floor is part of the identity, so the same cell on two floors is two
    // crates. Without this, emptying a stash on floor -3 would empty its twin on -4.
    CHECK(!same_container(container_key(-3, a), container_key(-4, a)));

    // The cell the key names is the cell the generator placed the crate in. z is the
    // tight axis: a crate's centre sits kContainerHalf.z (0.45 m) above the cell floor
    // inside a 2 m cell, so the truncation has 1.55 m of headroom.
    const OpenedContainerKey k = container_key(7, vec3{81.0f, 43.0f, 2.45f});
    CHECK(k.floor == 7);
    CHECK(k.cx == 40);   // 81.0 / 2.0
    CHECK(k.cy == 21);   // 43.0 / 2.0
    CHECK(k.cz == 1);    // 2.45 / 2.0 -> the ground storey the spawner uses
    static_assert(kContainerHalf.z < kCellSize,
                  "a crate taller than its cell would key into the cell above");
}

void opened_crates_survive_a_restart() {
    // The end-to-end claim: a floor destroyed and regenerated from the same seed comes
    // back with the same crates, and the ones already emptied come back emptied — with
    // no entity id anywhere in the save.
    World w;
    const int floorZ = -3;
    const FloorKind kind = FloorKind::Residential;
    const std::uint32_t seed = 0xC0FFEEu;
    generate_floor(w, floorZ, floor_spec(kind), 1337u);

    Registry reg;
    const LayerId layer = 0;
    const std::uint32_t made =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(made > 4u);   // enough crates for "some opened, some not" to mean anything

    // Empty every third crate by hand — this is what looting them would have left
    // behind — and remember the handles so the restart can prove they died.
    std::vector<Entity> before;
    int i = 0;
    int openedByHand = 0;
    for (auto e : reg.view<Container, const Transform>()) {
        before.push_back(e);
        if ((i++ % 3) != 0) continue;
        Container& c = reg.get<Container>(e);
        for (int s = 0; s < kContainerSlots; ++s) {
            c.item[s] = kInvalidItem;
            c.count[s] = 0;
        }
        c.opened = true;
        ++openedByHand;
    }
    CHECK(before.size() == static_cast<std::size_t>(made));
    CHECK(openedByHand > 1);

    // Save. Only the resident floor is scannable, so `refresh_opened_containers` is what
    // a real save calls; seed the set with another floor's keys first to prove they are
    // not collateral damage.
    SaveState st;
    st.opened.push_back(OpenedContainerKey{2, 66, 66, 1, 0});
    st.opened.push_back(
        OpenedContainerKey{static_cast<std::int16_t>(floorZ), 99, 99, 9, 0});  // stale
    const std::size_t fromFloor =
        refresh_opened_containers(reg, layer, floorZ, st.opened);
    CHECK(fromFloor == static_cast<std::size_t>(openedByHand));
    CHECK(st.opened.size() == 1u + fromFloor);
    CHECK(st.opened[0].floor == 2);          // the other floor survived the refresh
    CHECK(st.opened[0].cx == 66);
    // Calling it twice must not double the list — the bug a plain append would have.
    const std::size_t again = refresh_opened_containers(reg, layer, floorZ, st.opened);
    CHECK(again == fromFloor);
    CHECK(st.opened.size() == 1u + fromFloor);

    std::vector<std::uint8_t> bytes;
    save_write(st, bytes);

    // --- restart: the floor is torn down and rebuilt from the same three numbers ---
    std::vector<Entity> dead;
    for (auto e : reg.view<const Container, const Transform>())
        if (reg.get<const Transform>(e).layer == layer) dead.push_back(e);
    for (Entity e : dead) reg.destroy(e);
    // Every handle the save might have stored is now invalid. This is the whole reason
    // the key is (floor, cell): an entity id written to disk names nothing on reload.
    for (Entity e : before) CHECK(!reg.valid(e));

    SaveState loaded;
    SaveError err = SaveError::None;
    CHECK(save_read(bytes.data(), bytes.size(), loaded, &err));
    CHECK(err == SaveError::None);
    CHECK(loaded.opened.size() == st.opened.size());

    const std::uint32_t remade =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(remade == made);   // deterministic in (floor, kind, seed)

    const std::size_t hits = apply_opened_containers(
        reg, layer, floorZ, loaded.opened.data(), loaded.opened.size());

    // The contract, stated exactly: a crate is opened if and only if its key is in the
    // set. Written this way rather than as a count because the (floor, cell) key can
    // collide, and when it does BOTH crates are legitimately in the set — a count
    // comparison would fail for a reason that is not a bug.
    std::size_t openNow = 0;
    std::size_t shutNow = 0;
    for (auto e : reg.view<const Container, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const Container& c = reg.get<const Container>(e);
        const OpenedContainerKey k = container_key(floorZ, t.pos);
        bool listed = false;
        for (std::size_t j = 0; j < loaded.opened.size() && !listed; ++j)
            listed = same_container(loaded.opened[j], k);
        CHECK(c.opened == listed);
        if (c.opened) {
            ++openNow;
            // A restored crate is empty, not merely flagged.
            for (int s = 0; s < kContainerSlots; ++s) CHECK(c.item[s] == kInvalidItem);
        } else {
            ++shutNow;
        }
    }
    CHECK(hits == openNow);
    CHECK(openNow >= static_cast<std::size_t>(openedByHand));
    CHECK(shutNow > 0u);   // and the untouched crates are still worth walking to

    // Applying the same set twice is a no-op: already-opened crates are skipped, so an
    // autosave-on-every-floor-entry cannot re-loot or re-clear anything.
    CHECK(apply_opened_containers(reg, layer, floorZ, loaded.opened.data(),
                                  loaded.opened.size()) == 0u);
    // An empty set touches nothing, and a null one does not walk off a pointer.
    CHECK(apply_opened_containers(reg, layer, floorZ, nullptr, 0) == 0u);
    // Another floor's keys never match this floor's crates.
    const OpenedContainerKey elsewhere[1] = {OpenedContainerKey{2, 66, 66, 1, 0}};
    CHECK(apply_opened_containers(reg, layer, floorZ, elsewhere, 1u) == 0u);
    // Nor does a layer that holds nothing.
    CHECK(apply_opened_containers(reg, static_cast<LayerId>(42), floorZ,
                                  loaded.opened.data(),
                                  loaded.opened.size()) == 0u);
}

void ledger_is_pinned() {
    // The size assert lives in extraction.h, where a field would be added; restated here
    // as the arithmetic, so the 40 is a derivation rather than a magic number.
    static_assert(sizeof(RunLedger) == 8 + 8 + 4 + 4 + 4 + 4 + 1 + 7);
    static_assert(sizeof(RunLedger) == 40);
    static_assert(alignof(RunLedger) == 8);
    // Signed and exactly 32 bits wide, which is what makes the wire format unambiguous.
    // A bare `int` would satisfy both of these on every host this game builds on — the
    // point is that it now says so, so a future edit to a different width fails here
    // instead of silently changing what a saved floor number means.
    static_assert(std::is_same_v<decltype(RunLedger::deepestFloor), std::int32_t>,
                  "deepestFloor is serialized; its width is part of the save format");
    static_assert(std::is_signed_v<decltype(RunLedger::deepestFloor)>,
                  "the deepest point of a run is normally BELOW the hub");

    // The whole reason it is signed: the deepest point of a run is normally below the
    // hub, and the existing high-water logic compares |z| ([extraction.cpp]).
    RunLedger led;
    record_floor(led, -50);
    CHECK(led.deepestFloor == -50);
    record_floor(led, 20);
    CHECK(led.deepestFloor == -50);   // shallower in |z|, ignored
    record_floor(led, 60);
    CHECK(led.deepestFloor == 60);

    // ...and it survives the file with its sign intact, at both ends of the stack.
    for (int z = -127; z <= 127; z += 127) {
        SaveState st;
        st.ledger.deepestFloor = z;
        st.player.floorNumber = z;
        st.opened.push_back(OpenedContainerKey{static_cast<std::int16_t>(z), 1, 2, 3, 0});
        std::vector<std::uint8_t> bytes;
        save_write(st, bytes);
        SaveState back;
        CHECK(save_read(bytes.data(), bytes.size(), back, nullptr, nullptr));
        CHECK(back.ledger.deepestFloor == z);
        CHECK(back.player.floorNumber == z);
        CHECK(back.opened[0].floor == static_cast<std::int16_t>(z));
    }
}

} // namespace saveload_test

static void test_saveload_all() {
    saveload_test::wire_layout();
    saveload_test::round_trip();
    saveload_test::weak_check_vs_strong_check();
    saveload_test::rejects_the_rest();
    saveload_test::keys_not_entity_ids();
    saveload_test::opened_crates_survive_a_restart();
    saveload_test::ledger_is_pinned();
}
