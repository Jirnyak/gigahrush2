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
#include <cstdio>
#include <cstring>
#include <type_traits>
#include <vector>

#include "core/tick.h"        // kSimDt — never a bare 1/120 ([core/tick.h])
#include "game/container.h"
#include "game/embody.h"
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/macro_sim.h"
#include "game/npc_pool.h"
#include "game/save.h"
#include "game/craft.h"   // craft_init, craft_learn (SAVRPG pin)
#include "game/rpg.h"     // fresh_rpg, RpgStats (SAVRPG pin)
#include "game/combat.h"  // PlayerRanged (SAVMAG pin)
#include "sim/physics.h"
#include "world/level_stack.h"
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

    // Version 7 / SAVRPG: a non-default sheet and a mutated craft bank so a
    // dropped field cannot hide behind fresh_rpg(1) / craft_init defaults.
    st.rpg = fresh_rpg(10);
    st.rpg.xp = 12345u;
    st.rpg.psi = 77u;
    st.rpg.attrPoints = 3u;
    st.rpg.attr[0] = 20u;  // STR
    st.rpg.attr[1] = 15u;  // AGI
    st.rpg.attr[2] = 8u;   // INT
    craft_init(st.craft);
    st.craft.mat[0] = 111u;
    st.craft.mat[3] = 222u;
    st.craft.mat[7] = 333u;
    st.craft.tier = 2u;
    // Flip one non-default discoverable bit if the table has room past defaults.
    // craft_learn no-ops on already-known / non-discoverable; the mat/tier pins
    // still catch a dropped craft section even if learn is a no-op.
    for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
        if (craft_learn(st.craft, id)) break;
    }

    // Version 8 / SAVMAG: non-default chamber + kills so a dropped combat
    // section cannot hide behind zero defaults.
    st.hasRanged = 1;
    st.ranged.cooldownMs = 120u;
    st.ranged.reloadMs = 450u;
    st.ranged.magCount = 7u;
    st.ranged.weapon = 1;       // any non-zero ItemId; table drift is separate
    st.ranged.shots = 42u;
    st.ranged.hits = 11u;
    st.kills = 99u;

    // Version 9 / SAVSTAT: non-default status timers so a dropped StatusSet
    // section cannot hide behind zero defaults (F5 mid-haze must round-trip).
    st.status.remainMs[0] = 12345u;
    st.status.intensityE3[3] = 1500u;
    st.status.alt[1] = 1u;

    // Two floors' worth of crates, one of them below the hub — the negative
    // floor is the case a `std::uint16_t` floor column could not express at all.
    // v15: records carry CONTENTS, so give them some — a half-taken stack with
    // wear, an emptied opened box, and a deposit — the exact states the search
    // screen produces and the old opened-key list could not express.
    {
        ContainerRecord r1;
        r1.key = OpenedContainerKey{-3, 18, 42, 1, 0};
        r1.c.kind = 1;
        r1.c.inv.slots[0].item = 40;         // bandage, half-taken, worn
        r1.c.inv.slots[0].count = 3;
        r1.c.inv.slots[0].condition = 128;
        r1.c.inv.slots[3].item = kItemRuble; // the cash slot, partially spent
        r1.c.inv.slots[3].count = 12345;     // needs the u16 — the whole point of v14
        st.containers.push_back(r1);
        ContainerRecord r2;
        r2.key = OpenedContainerKey{-3, 114, 6, 1, 0};
        r2.c.opened = true;        // emptied: all slots zero, flag set
        st.containers.push_back(r2);
        ContainerRecord r3;
        r3.key = OpenedContainerKey{2, 66, 66, 1, 0};
        r3.c.inv.slots[1].item = 121;        // a deposit the player made
        r3.c.inv.slots[1].count = 2;
        st.containers.push_back(r3);
        CorpseRecord cr;
        cr.floor = -3;
        cr.pos = vec3{81.3f, 43.7f, 2.45f};
        cr.colour = vec3{0.2f, 0.1f, 0.1f};
        cr.half = vec3{0.4f, 0.18f, 0.6f};
        cr.mobKind = 7;
        cr.searched = 0;
        cr.inv.slots[0] = ItemSlot{40, 2, 200};
        cr.inv.slots[1] = ItemSlot{kItemRuble, 650, 255};
        st.corpses.push_back(cr);
        // v18: сорванный проп — обломок часть мира (решение владельца
        // 2026-08-21). Значения намеренно неокруглые: нулевое поле не
        // доказывает свой кодек (правило этого файла).
        DebrisRecord dr;
        dr.floor = -3;
        dr.pos = vec3{12.5f, 91.25f, 6.75f};
        dr.half = vec3{0.22f, 0.34f, 0.17f};
        dr.colour = vec3{0.61f, 0.42f, 0.13f};
        dr.massKg = 13.5f;
        dr.restitution = 0.27f;
        dr.friction = 0.63f;
        dr.sphere = 1;
        st.debris.push_back(dr);
    }

    // Version 6: a matrix that has drifted from base — a grudge the save must
    // remember. (The pool/macro blobs stay empty here so the wire pins stay
    // arithmetic; macro_world_round_trips covers them with real objects.)
    st.factions.add_mutual(0, 4, +30);

    // Version 16 / SAVBANK: distinct non-round values in every serialized
    // field, per this file's standing rule — a zero field cannot prove its
    // codec. lastInterestTick stays 0 on purpose: it does NOT travel.
    st.bank.deposit = 4321;
    st.bank.loanPrincipal = 1500;
    st.bank.loanAccrued = 37;
    st.bank.interestEarned = 210;
    st.bank.interestPaid = 96;
    st.bank.creditLimit = 2500;
    st.bank.entries = 5;
    st.bank.band = 2;
    st.bank.ledger[0] = BankEntry{111, 2222u, 1, 2};
    st.bank.ledger[4] = BankEntry{333, 4444u, 3, 2};

    // Version 10 / SAVCLOCK. Every field gets a DISTINCT non-round value, which is
    // this file's own standing rule and the one §6a.1 of Docs/specs/10 accused it of
    // breaking: a field left at zero makes the memcmp below pass whether or not the
    // codec carries it. A samosbor caught mid-Active with three cycles behind it is
    // also the exact state the old code destroyed on F9.
    st.samosbor.phaseMs = 4123u;
    st.samosbor.phaseTotalMs = 15000u;
    st.samosbor.activeMs = 9876u;
    st.samosbor.count = 3u;
    st.samosbor.phase = 2u;    // Active
    st.samosbor.variant = 5u;
    st.samosbor.sealed = true;

    // A discovery set that is neither empty nor full, spanning both signs and both
    // ends of the label range — the negative floors are the half a naive
    // floor-as-index bitset gets wrong.
    st.fastTravel.unlock(0);
    st.fastTravel.unlock(-1);
    st.fastTravel.unlock(7);
    st.fastTravel.unlock(-50);
    st.fastTravel.unlock(kMinFloor);
    st.fastTravel.unlock(kMaxFloor);
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
    static_assert(sizeof(Needs) == 9 * 4 + 1 + 3, "Needs has no implicit padding");
    static_assert(sizeof(Inventory) == 64 * 6,
                  "Inventory: 6 B cells since the v14 u16 count; the pad byte is\n"
                  "explicit ([inventory.h]), so a raw compare is still exact");
    CHECK(std::memcmp(&a.player.clock, &b.player.clock, sizeof(Needs)) == 0);
    CHECK(std::memcmp(&a.player.inv, &b.player.inv, sizeof(Inventory)) == 0);
    CHECK(a.player.hp == b.player.hp);
    CHECK(a.player.maxHp == b.player.maxHp);
    CHECK(a.player.floorNumber == b.player.floorNumber);
    CHECK(a.player.cx == b.player.cx);
    CHECK(a.player.cy == b.player.cy);
    CHECK(a.player.cz == b.player.cz);

    // Version 7 / SAVRPG: sheet + craft bank.
    CHECK(a.rpg.xp == b.rpg.xp);
    CHECK(a.rpg.psi == b.rpg.psi);
    CHECK(a.rpg.level == b.rpg.level);
    CHECK(a.rpg.attrPoints == b.rpg.attrPoints);
    CHECK(a.rpg.attr[0] == b.rpg.attr[0]);
    CHECK(a.rpg.attr[1] == b.rpg.attr[1]);
    CHECK(a.rpg.attr[2] == b.rpg.attr[2]);
    CHECK(a.craft.tier == b.craft.tier);
    for (std::size_t w = 0; w < kCraftKnownWords; ++w)
        CHECK(a.craft.known[w] == b.craft.known[w]);
    for (std::size_t i = 0; i < kCraftMaterials; ++i)
        CHECK(a.craft.mat[i] == b.craft.mat[i]);

    // Version 8 / SAVMAG: chambered firearm + kill tally.
    CHECK(a.hasRanged == b.hasRanged);
    CHECK(a.ranged.cooldownMs == b.ranged.cooldownMs);
    CHECK(a.ranged.reloadMs == b.ranged.reloadMs);
    CHECK(a.ranged.magCount == b.ranged.magCount);
    CHECK(a.ranged.weapon == b.ranged.weapon);
    CHECK(a.ranged.shots == b.ranged.shots);
    CHECK(a.ranged.hits == b.ranged.hits);
    CHECK(a.kills == b.kills);

    // Version 9 / SAVSTAT: live status effects round-trip field-by-field.
    for (std::size_t i = 0; i < kStatusCount; ++i) {
        CHECK(a.status.remainMs[i] == b.status.remainMs[i]);
        CHECK(a.status.intensityE3[i] == b.status.intensityE3[i]);
        CHECK(a.status.alt[i] == b.status.alt[i]);
    }

    // v16: the account, field by field (lastInterestTick excluded — it does
    // not travel and the reader arms it to zero).
    CHECK(a.bank.deposit == b.bank.deposit);
    CHECK(a.bank.loanPrincipal == b.bank.loanPrincipal);
    CHECK(a.bank.loanAccrued == b.bank.loanAccrued);
    CHECK(a.bank.interestEarned == b.bank.interestEarned);
    CHECK(a.bank.interestPaid == b.bank.interestPaid);
    CHECK(a.bank.creditLimit == b.bank.creditLimit);
    CHECK(a.bank.entries == b.bank.entries);
    CHECK(a.bank.band == b.bank.band);
    for (std::size_t i = 0; i < kBankLedgerSlots; ++i) {
        CHECK(a.bank.ledger[i].amount == b.bank.ledger[i].amount);
        CHECK(a.bank.ledger[i].tick == b.bank.ledger[i].tick);
        CHECK(a.bank.ledger[i].op == b.bank.ledger[i].op);
        CHECK(a.bank.ledger[i].band == b.bank.ledger[i].band);
    }

    CHECK(a.containers.size() == b.containers.size());
    const std::size_t nk = a.containers.size() < b.containers.size()
                               ? a.containers.size()
                               : b.containers.size();
    for (std::size_t i = 0; i < nk; ++i) {
        CHECK(same_container(a.containers[i].key, b.containers[i].key));
        // B3: у ItemSlot есть хвостовой паддинг-байт — memcmp по структуре
        // читал бы мусор; сравнение по полям, как и велит правило про паддинг.
        static_assert(sizeof(Container) == sizeof(Inventory) + 2);
        CHECK(a.containers[i].c.kind == b.containers[i].c.kind);
        CHECK(a.containers[i].c.opened == b.containers[i].c.opened);
        bool slotsEqual = true;
        for (int si = 0; si < kInvSlots; ++si) {
            const ItemSlot& x = a.containers[i].c.inv.slots[si];
            const ItemSlot& y = b.containers[i].c.inv.slots[si];
            if (x.item != y.item || x.count != y.count ||
                x.condition != y.condition)
                slotsEqual = false;
        }
        CHECK(slotsEqual);
    }
    CHECK(a.corpses.size() == b.corpses.size());
    // Field-by-field, NOT memcmp: CorpseRecord has 2 padding bytes after its
    // i16 floor (vec3 wants 4-alignment), and padding is exactly what a byte
    // compare is not entitled to read.
    for (std::size_t i = 0; i < a.corpses.size() && i < b.corpses.size(); ++i) {
        const CorpseRecord& x = a.corpses[i];
        const CorpseRecord& y = b.corpses[i];
        CHECK(x.floor == y.floor);
        CHECK(x.pos.x == y.pos.x && x.pos.y == y.pos.y && x.pos.z == y.pos.z);
        CHECK(x.colour.x == y.colour.x && x.colour.y == y.colour.y &&
              x.colour.z == y.colour.z);
        CHECK(x.half.x == y.half.x && x.half.y == y.half.y && x.half.z == y.half.z);
        CHECK(x.mobKind == y.mobKind && x.searched == y.searched);
        for (int j = 0; j < kInvSlots; ++j) {
            CHECK(x.inv.slots[j].item == y.inv.slots[j].item);
            CHECK(x.inv.slots[j].count == y.inv.slots[j].count);
            CHECK(x.inv.slots[j].condition == y.inv.slots[j].condition);
        }
    }

    // Version 6: the macro-world sections. The blobs travel verbatim; the matrix
    // is 36 POD bytes and must carry its runtime drift, not reset to base.
    CHECK(a.poolBlob == b.poolBlob);
    CHECK(a.macroBlob == b.macroBlob);
    CHECK(std::memcmp(a.factions.v, b.factions.v, sizeof(a.factions.v)) == 0);

    // Version 10 / SAVCLOCK. Field by field rather than a memcmp of the struct: the
    // three tail padding bytes after `sealed` are NOT written to the file, so a
    // struct-wide compare would be asserting something about host padding instead of
    // about the format.
    CHECK(a.samosbor.phaseMs == b.samosbor.phaseMs);
    CHECK(a.samosbor.phaseTotalMs == b.samosbor.phaseTotalMs);
    CHECK(a.samosbor.activeMs == b.samosbor.activeMs);
    CHECK(a.samosbor.count == b.samosbor.count);
    CHECK(a.samosbor.phase == b.samosbor.phase);
    CHECK(a.samosbor.variant == b.samosbor.variant);
    CHECK(a.samosbor.sealed == b.samosbor.sealed);
    // The unlock set is compared over the FLOOR LABELS, not over the raw bytes, so
    // the check fails if the bit-packing and `slot_of` ever disagree — a raw memcmp
    // would agree with itself no matter how wrong the mapping was.
    CHECK(a.fastTravel.unlocked_count() == b.fastTravel.unlocked_count());
    for (int f = kMinFloor; f <= kMaxFloor; ++f)
        if (a.fastTravel.unlocked(f) != b.fastTravel.unlocked(f)) {
            CHECK(a.fastTravel.unlocked(f) == b.fastTravel.unlocked(f));
            break;   // one report, not 255
        }
}

void wire_layout() {
    // The format's footprint is arithmetic, not a measurement — a save whose length
    // depends on the compiler is a save that cannot cross hosts.
    // Derived from the serializers, not measured from a run: 33 ledger + 79 book
    // (3 x 21 + 16) + 304 player (33 needs + 256 inventory + 12 + 3) + 12 rpg +
    // 89 craft + 21 combat (hasRanged+ranged+kills) + 42 status + 17 samosbor +
    // 32 fast-travel + 294 quest log, plus the fixed 36-byte faction matrix and the
    // 64-byte header.
    //
    // The three numbers this comment used to carry — "= 892", "308 quest log", and
    // the "992" downstream — were WRONG and had been since v9: the asserts below said
    // 878 and 978, and asserts are what the build checks. Corrected 2026-08-12 rather
    // than carried forward, because a comment that disagrees with the assert beside it
    // teaches the next reader to trust the wrong one.
    static_assert(kSaveHeaderWire == 64);
    static_assert(kRpgWire == 12);
    static_assert(kCraftingWire == 89);
    static_assert(kRangedWire == 16);
    static_assert(kCombatSaveWire == 21);
    static_assert(kStatusWire == 42);
    static_assert(kSamosborWire == 17);
    static_assert(kFastTravelWire == 32);
    // 927 repeats v10's total by coincidence, not compatibility: v10 had nine
    // craft axes and no hpBank, v12 has eight and hpBank. See [save.cpp].
    static_assert(kSaveFixedWire == 1284);  // v16: +289 bank ([save.h] SAVBANK)
    static_assert(kFactionWire == 36);
    // v18: 1284 fixed + 36 faction + 64 header + 4 inline corpse count +
    // 4 inline debris count = 1392 empty.
    static_assert(save_bytes_for(0) == 1392);
    static_assert(save_bytes_for(3) == 1392 + 3 * kContainerRecWire);
    static_assert(save_bytes_for(3, 1, 100, 50) ==
                  1392 + 3 * kContainerRecWire + kCorpseRecWire + 150);
    static_assert(save_bytes_for(0, 0, 0, 0, 2) == 1392 + 2 * kDebrisRecWire);

    std::vector<std::uint8_t> bytes;
    SaveState empty;
    save_write(empty, bytes);
    CHECK(bytes.size() == save_bytes_for(0));

    const SaveState st = busy_run();
    save_write(st, bytes);
    CHECK(bytes.size() == save_bytes_for(3, 1, 0, 0, 1));
    // 1042 B for a full run with three emptied crates and no macro blobs (those are
    // variable-size and pinned by macro_world_round_trips). GEOMETRY lives in the
    // per-floor files ([save.h] modular layout), never here. v8 was 965; the
    // legacy-content purge re-measured this from 1007; v9 was 993; v10 adds the
    // samosbor clock (17) and the fast-travel unlock set (32); v11 adds the crowd
    // heal bank `hpBank` (+4); v12 drops one craft axis (-4); v13 adds the
    // player's Equipped cells (+4); v14 widens the slot count to u16 (+64);
    // v15 swapped opened keys for whole-crate records (27 B a row, corpse rows
    // 81 B, plus the inline corpse-count u32 in the base); v16 adds the 289 B
    // bank block: busy_run's 3 crates and 1 body land on 1388 + 81 + 81 = 1550.
    CHECK(bytes.size() ==
          1392 + 3 * kContainerRecWire + kCorpseRecWire + kDebrisRecWire);

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
    CHECK(h.containerCount == 3u);
    CHECK(h.poolBytes == 0u);
    CHECK(h.macroBytes == 0u);
    CHECK(h.payloadBytes == kSaveFixedWire + kFactionWire +
                                3u * kContainerRecWire + 4u + kCorpseRecWire +
                                4u + kDebrisRecWire); // v18: счётчик + ряд

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
    CHECK(zback.containers.empty());
    CHECK(zback.corpses.empty());
    same_run(fresh, zback);

    // The signed floor survives, which is the point of storing it at all. `NpcPool`'s
    // own floor column is a std::uint16_t, so it reads floor -50 back as 65486 and
    // cannot recover the label — that truncation is why PlayerSnapshot and
    // OpenedContainerKey each carry their own signed number instead of borrowing it.
    static_assert(static_cast<int>(static_cast<std::uint16_t>(-50)) == 65486);
    CHECK(dst.player.floorNumber == -50);
    CHECK(dst.ledger.deepestFloor == -50);
    CHECK(dst.containers[0].key.floor == -3);
    CHECK(dst.corpses[0].floor == -3);
    // The contents rode whole: the half-taken worn stack and the u16 cash wad.
    CHECK(dst.containers[0].c.inv.slots[0].count == 3 && dst.containers[0].c.inv.slots[0].condition == 128);
    CHECK(dst.containers[0].c.inv.slots[3].item == kItemRuble &&
          dst.containers[0].c.inv.slots[3].count == 12345);
    CHECK(dst.corpses[0].inv.slots[1].count == 650);
    // v18: обломок пережил круг целиком — форма, масса и контактная пара.
    CHECK(dst.debris.size() == 1u);
    CHECK(dst.debris[0].floor == -3);
    CHECK(dst.debris[0].pos.y == 91.25f);
    CHECK(dst.debris[0].half.z == 0.17f);
    CHECK(dst.debris[0].colour.x == 0.61f);
    CHECK(dst.debris[0].massKg == 13.5f);
    CHECK(dst.debris[0].restitution == 0.27f);
    CHECK(dst.debris[0].friction == 0.63f);
    CHECK(dst.debris[0].sphere == 1);
}

// Version 6: the macro world is a flat table, so it saves flat. A small society
// with every column exercised round-trips through NpcPool::save_rows/load_rows —
// including a dead row's generation, the player flag, names, and the rebuilt floor
// buckets — and the MacroSim clock/journeys through save_state/load_state.
void macro_world_round_trips() {
    NpcPool pool;
    pool.init();
    for (std::uint32_t i = 0; i < 5; ++i) {
        const NpcId id = pool.spawn();
        CHECK(id == i);
        pool.faction(id) = static_cast<std::uint16_t>(i % kFactionCount);
        pool.hp(id) = static_cast<std::int16_t>(40 + i);
        pool.max_hp(id) = static_cast<std::int16_t>(100 + i);
        pool.set_floor(id, (i % 2) ? -8 : 0);
        pool.cx(id) = static_cast<std::uint8_t>(10 + i);
        pool.cy(id) = static_cast<std::uint8_t>(20 + i);
        pool.cz(id) = static_cast<std::uint8_t>(1 + i);
        pool.height_mm(id) = static_cast<std::uint16_t>(1600 + 10 * i);
        pool.age(id) = static_cast<std::uint8_t>(20 + i);
        pool.sex(id) = static_cast<std::uint8_t>(1 + i % 2);
        pool.level(id) = static_cast<std::uint8_t>(i);
        pool.attrs(id)[3] = static_cast<std::uint8_t>(7 + i);
        pool.needs(id).food = 10.0f * static_cast<float>(i) + 0.25f;
        pool.needs(id).seeded = 1;
        pool.inventory(id).slots[0] =
            ItemSlot{static_cast<ItemId>(1 + i), static_cast<std::uint16_t>(2)};
        pool.set_name(id, "Вася", "Пупкин");
    }
    pool.set_player(3, true);
    pool.kill(2); // a dead row whose bumped generation must travel

    std::vector<std::uint8_t> blob;
    pool.save_rows(blob);
    NpcPool back;
    back.init();
    CHECK(back.load_rows(blob.data(), blob.size()));
    CHECK(back.count() == pool.count());
    CHECK(back.alive() == pool.alive());
    for (NpcId id = 0; id < pool.count(); ++id) {
        CHECK(back.alive(id) == pool.alive(id));
        CHECK(back.is_player(id) == pool.is_player(id));
        CHECK(!back.embodied(id)); // bodies never survive a save
        CHECK(back.faction(id) == pool.faction(id));
        CHECK(back.hp(id) == pool.hp(id));
        CHECK(back.max_hp(id) == pool.max_hp(id));
        CHECK(back.floor(id) == pool.floor(id));
        CHECK(back.cx(id) == pool.cx(id));
        CHECK(back.age(id) == pool.age(id));
        CHECK(back.sex(id) == pool.sex(id));
        CHECK(back.level(id) == pool.level(id));
        CHECK(back.attrs(id)[3] == pool.attrs(id)[3]);
        CHECK(back.height_mm(id) == pool.height_mm(id));
        CHECK(back.generation(id) == pool.generation(id));
        CHECK(back.needs(id).food == pool.needs(id).food);
        CHECK(back.needs(id).seeded == pool.needs(id).seeded);
        CHECK(std::memcmp(&back.inventory(id), &pool.inventory(id),
                          sizeof(Inventory)) == 0);
        CHECK(std::memcmp(back.name(id).data(), pool.name(id).data(),
                          back.name(id).size()) == 0);
        CHECK(std::memcmp(back.surname(id).data(), pool.surname(id).data(),
                          back.surname(id).size()) == 0);
    }
    // The floor bucket index was REBUILT, not copied: rosters agree as sets.
    CHECK(back.floor_bucket(0).size() == pool.floor_bucket(0).size());
    CHECK(back.floor_bucket(-8).size() == pool.floor_bucket(-8).size());
    // A second load onto a used pool is refused (the contract is a fresh init).
    CHECK(!back.load_rows(blob.data(), blob.size()));
    // Truncation is refused before anything is written.
    NpcPool third;
    third.init();
    CHECK(!third.load_rows(blob.data(), blob.size() - 1));

    // MacroSim: step once so the clock and cursors are non-trivial, then travel.
    MacroSim ms;
    ms.init();
    const std::int16_t labels[2] = {0, -8};
    ms.set_floors(labels, 2);
    ms.step(pool, MacroParams{});
    std::vector<std::uint8_t> mblob;
    ms.save_state(mblob);
    MacroSim ms2;
    ms2.init();
    CHECK(ms2.load_state(mblob.data(), mblob.size()));
    CHECK(ms2.tick() == ms.tick());
    CHECK(ms2.day_tenths() == ms.day_tenths());
    CHECK(ms2.in_transit() == ms.in_transit());
    CHECK(!ms2.load_state(mblob.data(), mblob.size() - 1));
}

// The modular save's whole point: a floor FILE is state, stamped back verbatim, so
// it survives a restart AND un-carves. Carve, write the floor file (the departure /
// F5), carve AGAIN (the post-save hole), then stamp the file onto a freshly
// generated twin: the twin must be bit-identical to the moment the file was
// written, layered sub-materials included. Garbage files are refused whole.
void floor_file_round_trips() {
    auto genesis = [](giga::World& w) {
        // An anchored 8x8x2-cell slab (8192 sub-voxels, far over any detach limit).
        for (int x = 8; x < 16; ++x)
            for (int y = 8; y < 16; ++y)
                for (int z = 4; z < 6; ++z)
                    w.grid().fill_cell(x, y, z, giga::kMatConcrete);
        // A painted coat so the sub-material pages have something to prove.
        for (int sz = 0; sz < 8; ++sz)
            for (int sy = 0; sy < 8; ++sy)
                giga::set_sub_material(w, 10, 10, 5, 0, sy, sz,
                                       giga::kMatPlaster);
    };
    giga::World live;
    genesis(live);

    giga::CarveScratch scratch;
    giga::CarveResult res;
    const giga::CarveOp first{24.5f, 24.5f, 11.0f, 1.25f, 400, 0xAB12u, 512};
    CHECK(giga::carve_sphere(live, first, scratch, res) > 0);

    // The departure write. Keep the raw arrays for the bit-identity claim.
    std::vector<std::uint8_t> file;
    floor_file_write(live, -26, file);
    CHECK(file.size() > kFloorHeaderWire);
    const std::vector<giga::CellType> typesAtSave = live.grid().types();
    const std::vector<giga::SubMask> masksAtSave = live.grid().masks();

    // Post-save damage the file must NOT contain.
    const giga::CarveOp second{27.0f, 24.5f, 11.0f, 1.0f, 0xFFFF, 0x9999u, 512};
    CHECK(giga::carve_sphere(live, second, scratch, res) > 0);

    // Arrival: a freshly generated twin (the deterministic generator), stamped.
    giga::World twin;
    genesis(twin);
    std::int32_t floorOut = 0;
    SaveError err = SaveError::Count;
    CHECK(floor_file_read(file.data(), file.size(), twin, &floorOut, &err));
    CHECK(err == SaveError::None);
    CHECK(floorOut == -26);
    CHECK(std::memcmp(typesAtSave.data(), twin.grid().types().data(),
                      typesAtSave.size() * sizeof(giga::CellType)) == 0);
    CHECK(std::memcmp(masksAtSave.data(), twin.grid().masks().data(),
                      masksAtSave.size() * sizeof(giga::SubMask)) == 0);
    // The painted coat survived at sub-voxel resolution.
    CHECK(giga::sub_material_at(twin, 10, 10, 5, 0, 3, 3) == giga::kMatPlaster);
    CHECK(giga::sub_material_at(twin, 10, 10, 5, 1, 3, 3) == giga::kMatConcrete);
    // And the twin does NOT contain the post-save hole: it matches the save
    // moment, not the live world's later state. С инкремента 5 карв не
    // испаряет материю: вырезанный атом с опорой тут же принимает
    // rubble-обломок, и МАСКИ могут совпасть бит-в-бит — расхождение живёт в
    // МАТЕРИАЛЕ (rubble против исходного), его и сверяем.
    {
        const giga::CarvedVoxel& hole = res.destroyed.front();
        const int hx = static_cast<int>(hole.cell & 127u);
        const int hy = static_cast<int>((hole.cell >> 7) & 127u);
        const int hz = static_cast<int>((hole.cell >> 14) & 127u);
        const int hsx = hole.bit & 7, hsy = (hole.bit >> 3) & 7,
                  hsz = (hole.bit >> 6) & 7;
        CHECK(giga::sub_material_at(live, hx, hy, hz, hsx, hsy, hsz) !=
              giga::sub_material_at(twin, hx, hy, hz, hsx, hsy, hsz));
    }

    // Rejections, each by its own gate: magic, version, size, checksum, and a
    // header-short stub. A refused file must leave a pristine twin usable.
    auto refuses = [&](std::vector<std::uint8_t> bad, SaveError want) {
        giga::World v;
        genesis(v);
        SaveError e = SaveError::None;
        CHECK(!floor_file_read(bad.data(), bad.size(), v, nullptr, &e));
        CHECK(e == want);
    };
    std::vector<std::uint8_t> bad = file;
    bad[0] ^= 0xFF;
    refuses(bad, SaveError::BadMagic);
    bad = file;
    bad[4] ^= 0x01;
    refuses(bad, SaveError::BadVersion);
    bad = file;
    bad.pop_back();
    refuses(bad, SaveError::SizeMismatch);
    bad = file;
    bad[kFloorHeaderWire + 4] ^= 0xFF; // flip a payload byte under the CRC
    refuses(bad, SaveError::BadChecksum);
    refuses(std::vector<std::uint8_t>(file.begin(), file.begin() + 8),
            SaveError::TooShort);
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
    keep.containers.push_back(ContainerRecord{OpenedContainerKey{9, 1, 2, 3, 0}, {}});
    SaveError err = SaveError::None;

    auto refused = [&](std::vector<std::uint8_t>& buf, SaveError want) {
        err = SaveError::None;
        CHECK(!save_read(buf.data(), buf.size(), keep, &err));
        CHECK(err == want);
        CHECK(keep.ledger.deaths == 777u);
        CHECK(keep.player.hp == 55);
        CHECK(keep.containers.size() == 1u);
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

void floor_records_survive_a_restart() {
    // The end-to-end claim, v15 edition: a floor destroyed and regenerated from
    // the same seed comes back with the same crates — and each crate comes back
    // with the CONTENTS it was left with, not its fresh roll. A half-taken box
    // stays half-taken, a deposit is still inside, an emptied one is opened and
    // empty, and a corpse lies where it fell with its loot — no entity id
    // anywhere in the save. This is the "частичный забор/вклад переживает
    // перезаход этажа" requirement, stated as a test.
    World w;
    const int floorZ = -3;
    const FloorKind kind = FloorKind::Residential;
    const std::uint32_t seed = 0xC0FFEEu;
    generate_floor(w, floorZ, floor_spec(kind), 1337u);

    Registry reg;
    const LayerId layer = 0;
    const std::uint32_t made =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(made > 4u);

    // Mutate the floor the way a play session would: empty every third crate
    // (a full loot), and DEPOSIT into every fifth (the search screen's Give) —
    // the state the old opened-key mechanism could not express at all.
    std::vector<Entity> before;
    int i = 0;
    int emptiedByHand = 0;
    int depositedInto = 0;
    for (auto e : reg.view<Container, const Transform>()) {
        before.push_back(e);
        Container& c = reg.get<Container>(e);
        if ((i % 3) == 0) {
            for (int sl = 0; sl < kInvSlots; ++sl) {
                c.inv.slots[sl].item = kInvalidItem;
                c.inv.slots[sl].count = 0;
            }
            c.opened = true;
            ++emptiedByHand;
        } else if ((i % 5) == 0) {
            c.inv.slots[0].item = 40;            // a worn bandage stack, deposited
            c.inv.slots[0].count = 3;
            c.inv.slots[0].condition = 77;
            ++depositedInto;
        }
        ++i;
    }
    CHECK(before.size() == static_cast<std::size_t>(made));
    CHECK(emptiedByHand > 1);
    CHECK(depositedInto > 0);

    // A corpse with loot, exactly the POD finalize_deaths leaves behind.
    const vec3 corpsePos{40.9f, 41.3f, 2.1f};
    {
        Entity ce = reg.create();
        Transform tr;
        tr.pos = corpsePos;
        tr.layer = layer;
        reg.emplace<Transform>(ce, tr);
        reg.emplace<AABB>(ce, AABB{vec3{0.4f, 0.18f, 0.6f}});
        reg.emplace<Renderable>(ce, Renderable{vec3{0.2f, 0.1f, 0.1f}});
        Corpse c;
        c.mobKind = 7;
        reg.emplace<Corpse>(ce, c);
        Container cb{};
        cb.inv.slots[0] = ItemSlot{40, 2, 200};
        cb.inv.slots[1] = ItemSlot{kItemRuble, 650, 255};
        reg.emplace<Container>(ce, cb);
    }

    // Save. Only the resident floor is scannable, so `refresh_floor_records` is
    // what a real save calls; seed the lists with another floor's records first
    // to prove they are not collateral damage, and with a stale record for THIS
    // floor to prove refresh replaces rather than appends.
    SaveState st;
    st.containers.push_back(ContainerRecord{OpenedContainerKey{2, 66, 66, 1, 0}, {}});
    st.containers.push_back(ContainerRecord{
        OpenedContainerKey{static_cast<std::int16_t>(floorZ), 99, 99, 9, 0}, {}});
    CorpseRecord staleCorpse;
    staleCorpse.floor = static_cast<std::int16_t>(floorZ);
    st.corpses.push_back(staleCorpse);
    const std::size_t fromFloor =
        refresh_floor_records(reg, layer, floorZ, st.containers, st.corpses);
    // EVERY crate is recorded (not only the touched ones), plus the corpse.
    CHECK(fromFloor == static_cast<std::size_t>(made) + 1u);
    CHECK(st.containers.size() == 1u + made);
    CHECK(st.containers[0].key.floor == 2);   // the other floor survived
    CHECK(st.corpses.size() == 1u);           // the stale one was dropped
    CHECK(st.corpses[0].mobKind == 7);
    // Calling it twice must not double the lists — the bug a plain append would have.
    const std::size_t again =
        refresh_floor_records(reg, layer, floorZ, st.containers, st.corpses);
    CHECK(again == fromFloor);
    CHECK(st.containers.size() == 1u + made);

    std::vector<std::uint8_t> bytes;
    save_write(st, bytes);

    // --- restart: the floor is torn down and rebuilt from the same numbers ---
    std::vector<Entity> dead;
    for (auto e : reg.view<const Transform>())
        if (reg.get<const Transform>(e).layer == layer) dead.push_back(e);
    for (Entity e : dead) reg.destroy(e);
    for (Entity e : before) CHECK(!reg.valid(e));

    SaveState loaded;
    SaveError err = SaveError::None;
    CHECK(save_read(bytes.data(), bytes.size(), loaded, &err));
    CHECK(err == SaveError::None);
    CHECK(loaded.containers.size() == st.containers.size());
    CHECK(loaded.corpses.size() == 1u);

    const std::uint32_t remade =
        spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(remade == made);   // deterministic in (floor, kind, seed)

    const std::size_t hits = apply_container_records(
        reg, layer, floorZ, loaded.containers.data(), loaded.containers.size());
    const std::size_t bodies = spawn_corpse_records(
        reg, layer, floorZ, loaded.corpses.data(), loaded.corpses.size());
    CHECK(bodies == 1u);

    // The contract, stated exactly: every crate's component equals its record.
    // (The (floor, cell) key can collide; when it does one record stamps both
    // crates, so the comparison is record-driven, not count-driven.)
    std::size_t openNow = 0, shutNow = 0, matched = 0, deposits = 0;
    for (auto e : reg.view<const Container, const Transform>()) {
        if (reg.all_of<Corpse>(e)) continue; // трупный лут едет CorpseRecord (C)
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const Container& c = reg.get<const Container>(e);
        const OpenedContainerKey k = container_key(floorZ, t.pos);
        const ContainerRecord* rec = nullptr;
        for (std::size_t j = 0; j < loaded.containers.size() && !rec; ++j)
            if (same_container(loaded.containers[j].key, k))
                rec = &loaded.containers[j];
        CHECK(rec != nullptr);   // refresh recorded every crate, so all match
        if (!rec) continue;
        ++matched;
        CHECK(std::memcmp(&c, &rec->c, sizeof(Container)) == 0);
        if (c.opened) {
            ++openNow;
            for (int sl = 0; sl < kInvSlots; ++sl)
                CHECK(c.inv.slots[sl].item == kInvalidItem);
        } else {
            ++shutNow;
        }
        if (c.inv.slots[0].item == 40 && c.inv.slots[0].count == 3 && c.inv.slots[0].condition == 77) ++deposits;
    }
    CHECK(hits == matched);
    CHECK(openNow >= static_cast<std::size_t>(emptiedByHand));
    CHECK(shutNow > 0u);   // untouched crates still worth walking to
    CHECK(deposits >= static_cast<std::size_t>(depositedInto));  // вклад пережил

    // The corpse came back: position, slots, wear, the cash wad — and searched
    // stays false, so it is still lootable.
    {
        std::size_t corpses = 0;
        for (auto e : reg.view<const Corpse, const Transform>()) {
            const Transform& t = reg.get<const Transform>(e);
            if (t.layer != layer) continue;
            ++corpses;
            const Corpse& c = reg.get<const Corpse>(e);
            CHECK(c.mobKind == 7);
            CHECK(!c.searched);
            const Inventory& ci = reg.get<const Container>(e).inv;
            CHECK(ci.slots[0].item == 40 && ci.slots[0].count == 2 &&
                  ci.slots[0].condition == 200);
            CHECK(ci.slots[1].item == kItemRuble && ci.slots[1].count == 650);
            CHECK(t.pos.x == corpsePos.x && t.pos.y == corpsePos.y &&
                  t.pos.z == corpsePos.z);
        }
        CHECK(corpses == 1u);
    }

    // Re-applying is idempotent: the records stamp the same state again, and the
    // corpse rebuild replaces rather than duplicates — an autosave-on-entry
    // cannot re-loot, re-fill or double a body.
    CHECK(apply_container_records(reg, layer, floorZ, loaded.containers.data(),
                                  loaded.containers.size()) == hits);
    CHECK(spawn_corpse_records(reg, layer, floorZ, loaded.corpses.data(),
                               loaded.corpses.size()) == 1u);
    {
        std::size_t corpses = 0;
        for (auto e : reg.view<const Corpse>()) { (void)e; ++corpses; }
        CHECK(corpses == 1u);
    }
    // An empty set touches nothing, and a null one does not walk off a pointer.
    CHECK(apply_container_records(reg, layer, floorZ, nullptr, 0) == 0u);
    // Another floor's records never match this floor's crates.
    const ContainerRecord elsewhere[1] = {
        ContainerRecord{OpenedContainerKey{2, 66, 66, 1, 0}, {}}};
    CHECK(apply_container_records(reg, layer, floorZ, elsewhere, 1u) == 0u);
    // Nor does a layer that holds nothing.
    CHECK(apply_container_records(reg, static_cast<LayerId>(42), floorZ,
                                  loaded.containers.data(),
                                  loaded.containers.size()) == 0u);
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
        st.containers.push_back(ContainerRecord{
            OpenedContainerKey{static_cast<std::int16_t>(z), 1, 2, 3, 0}, {}});
        std::vector<std::uint8_t> bytes;
        save_write(st, bytes);
        SaveState back;
        CHECK(save_read(bytes.data(), bytes.size(), back, nullptr, nullptr));
        CHECK(back.ledger.deepestFloor == z);
        CHECK(back.player.floorNumber == z);
        CHECK(back.containers[0].key.floor == static_cast<std::int16_t>(z));
    }
}

// ---------------------------------------------------------------------------
// Placement — the half of "load restores your position" that can soft-lock
// ---------------------------------------------------------------------------

// The standard embodied player box: 0.4 m half-width, half-height from stature
// ([embody.cpp] — a 1.75 m adult gives 0.875). Used by every placement test below so the
// numbers in them are the numbers the game uses.
const vec3 kBodyHalf{0.4f, 0.4f, body_half_height(static_cast<std::uint16_t>(1750))};

// The module's ground standing storey ([floor_gen.h] floor_ground_z): air over
// the storey-0 ceiling sandwich. Wall / room-interior probe cells are FOUND in
// the built grid rather than pinned — the module's BSP walls are seed-derived,
// not a fixed lattice.
constexpr std::uint8_t kStandZ = 3;
// One above the standing cell: room air with air underneath — legitimate mid-air.
constexpr std::uint8_t kMidAirZ = 4;

// A Residential floor, the densest wall lattice in the table (stride 8).
void gen_residential(World& w, int floorZ) {
    generate_floor(w, floorZ, floor_spec(FloorKind::Residential), 1337u);
}

// A wall cell at the standing storey with a standable (air over solid) neighbour
// one ring over — found in the built grid, because the module's BSP walls are
// seed-derived, not a fixed lattice a constant could name.
inline bool find_wall_probe(const World& w, int& wx, int& wy) {
    auto freeAt = [&](int x, int y, std::uint8_t z) {
        return !aabb_overlaps_solid(
            w,
            macro_cell_centre(static_cast<std::uint8_t>(wrap_macro(x)),
                              static_cast<std::uint8_t>(wrap_macro(y)), z),
            kBodyHalf);
    };
    for (int y = 4; y < kMacroDim - 4; ++y)
        for (int x = 4; x < kMacroDim - 4; ++x) {
            if (freeAt(x, y, kStandZ)) continue;
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx)
                    if ((dx || dy) && freeAt(x + dx, y + dy, kStandZ) &&
                        w.grid().cell(wrap_macro(x + dx), wrap_macro(y + dy),
                                      kStandZ - 1) != kCellAir) {
                        wx = x;
                        wy = y;
                        return true;
                    }
        }
    return false;
}

void cell_conventions() {
    // A cell centre round-trips to its own cell. This is the whole contract between the
    // save side (which writes a cell from a Transform) and the load side (which builds a
    // Transform from a cell): break it and a restored body is one cell from where it was
    // saved, forever, silently.
    const std::uint8_t probes[] = {0, 1, 2, 40, 91, 127};
    for (std::uint8_t c : probes) {
        std::uint8_t cx = 0, cy = 0, cz = 0;
        macro_cell_of(macro_cell_centre(c, c, c), cx, cy, cz);
        CHECK(cx == c);
        CHECK(cy == c);
        CHECK(cz == c);
    }
    // ...and it is the same convention `embody` places a body by, derived here rather
    // than restated: (cell + 0.5) * cell size.
    const vec3 c = macro_cell_centre(40, 91, kStandZ);
    CHECK(c.x == (40.0f + 0.5f) * kEmbodyCellSize);
    CHECK(c.y == (91.0f + 0.5f) * kEmbodyCellSize);
    CHECK(c.z == (static_cast<float>(kStandZ) + 0.5f) * kEmbodyCellSize);

    // A crate's key uses the identical truncation, so the two cannot drift apart.
    const vec3 crate{81.0f, 43.0f, 2.45f};
    std::uint8_t kx = 0, ky = 0, kz = 0;
    macro_cell_of(crate, kx, ky, kz);
    const OpenedContainerKey k = container_key(7, crate);
    CHECK(k.cx == kx);
    CHECK(k.cy == ky);
    CHECK(k.cz == kz);
}

void arrival_cell_is_often_a_wall() {
    // WHY the placement helper exists at all, as a measurement rather than a worry.
    //
    // An elevator ride keeps x/y from the floor it left and sets z = kArrivalCoord
    // ([elevator.cpp]) — the module's ground standing storey. Two floors' BSP
    // wall plans do not align, so the arrival column is often inside a wall,
    // and this counts how often: the number that justifies find_standable_cell
    // existing at all. A wide band, not a formula — the module's wall budget is
    // its own to tune; what is pinned is "walls are common and not everything".
    World w;
    gen_residential(w, 0);
    int solidAtArrival = 0;
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x) {
            const vec3 c = macro_cell_centre(static_cast<std::uint8_t>(x),
                                             static_cast<std::uint8_t>(y), kArrivalCoord);
            if (aabb_overlaps_solid(w, c, kBodyHalf)) ++solidAtArrival;
        }
    CHECK(solidAtArrival > 500);
    CHECK(solidAtArrival < kMacroDim * kMacroDim / 2);
    // The arrival storey IS the standing storey now (floor_ground_z) — landing
    // inside the ceiling sandwich and leaning on the resolver every ride was
    // the old two-number drift.
    static_assert(kArrivalCoord == kStandZ);
}

void solid_cell_resolves_to_a_standable_neighbour() {
    World w;
    gen_residential(w, -26);

    // Probe cells are FOUND in the built grid (the module's BSP walls are
    // seed-derived, not a fixed lattice). Wanted: a wall cell at the standing
    // storey with a standable neighbour one ring over, and a clear room cell
    // whose cell above is also air (the mid-air probe).
    auto freeAt = [&](int x, int y, std::uint8_t z) {
        return !aabb_overlaps_solid(
            w,
            macro_cell_centre(static_cast<std::uint8_t>(wrap_macro(x)),
                              static_cast<std::uint8_t>(wrap_macro(y)), z),
            kBodyHalf);
    };
    auto standAt = [&](int x, int y) {
        return freeAt(x, y, kStandZ) &&
               w.grid().cell(wrap_macro(x), wrap_macro(y), kStandZ - 1) != kCellAir;
    };
    int wallX = -1, wallY = -1, roomX = -1, roomY = -1;
    if (!find_wall_probe(w, wallX, wallY)) wallX = wallY = -1;
    for (int y = 4; y < kMacroDim - 4 && roomX < 0; ++y)
        for (int x = 4; x < kMacroDim - 4 && roomX < 0; ++x)
            if (standAt(x, y) && freeAt(x, y, kMidAirZ)) {
                roomX = x;
                roomY = y;
            }
    CHECK(wallX >= 0);   // the floor really does put walls next to rooms
    CHECK(roomX >= 0);

    // A body cannot stand in a wall, which is exactly the cell an elevator
    // arrival can land on.
    const PlacedCell res =
        find_standable_cell(w, kBodyHalf, static_cast<std::uint8_t>(wallX),
                            static_cast<std::uint8_t>(wallY), kStandZ);
    CHECK(res.ok);
    CHECK(res.moved);                 // it did not pretend the wall was fine
    CHECK(res.rings >= 1);            // and it did not wander far
    CHECK(res.rings <= 2);
    CHECK(res.supported);             // with a floor under the feet
    // Verified independently against the solver's own predicate, not against the
    // helper's own opinion of itself.
    CHECK(!aabb_overlaps_solid(w, macro_cell_centre(res.cx, res.cy, res.cz), kBodyHalf));

    // A cell that is already fine is returned untouched — no drift, no teleport.
    const PlacedCell keep =
        find_standable_cell(w, kBodyHalf, static_cast<std::uint8_t>(roomX),
                            static_cast<std::uint8_t>(roomY), kStandZ);
    CHECK(keep.ok);
    CHECK(!keep.moved);
    CHECK(keep.rings == 0);
    CHECK(keep.cx == roomX && keep.cy == roomY && keep.cz == kStandZ);
    CHECK(keep.supported);

    // Mid-air is NOT a failure and must not relocate anybody: a player who saved while
    // flying was legitimately in the air, and physics will simply drop them. The cell
    // above a standing cell is air with air underneath it.
    const PlacedCell air =
        find_standable_cell(w, kBodyHalf, static_cast<std::uint8_t>(roomX),
                            static_cast<std::uint8_t>(roomY), kMidAirZ);
    CHECK(air.ok);
    CHECK(!air.moved);
    CHECK(!air.supported);            // reported, not corrected
    CHECK(air.cz == kMidAirZ);
}

void fully_solid_neighbourhood_fails_loudly() {
    // The failure the brief asks for by name: everything within reach is solid. The
    // helper must NOT hand back a plausible-looking cell, because a caller would
    // teleport a body into it and that body would never move again.
    World w;
    const int cx = 60, cy = 60, cz = 60;
    const int radius = 3;
    // Fill a block one cell larger than the search, so nothing inside the neighbourhood
    // is free. A default MacroGrid is all air, so only this block is solid.
    for (int dz = -(radius + 1); dz <= radius + 1; ++dz)
        for (int dy = -(radius + 1); dy <= radius + 1; ++dy)
            for (int dx = -(radius + 1); dx <= radius + 1; ++dx)
                w.grid().fill_cell(cx + dx, cy + dy, cz + dz, kMatConcrete);

    const PlacedCell fail = find_standable_cell(
        w, kBodyHalf, static_cast<std::uint8_t>(cx), static_cast<std::uint8_t>(cy),
        static_cast<std::uint8_t>(cz), radius);
    CHECK(!fail.ok);
    CHECK(!fail.moved);
    CHECK(fail.rings == 0);
    // The cell handed back is the one asked for, UNCHANGED — and it is solid. That is
    // the point: there is no safe answer to invent, so a caller that ignores `ok` gets
    // the wall it asked about rather than a wall dressed up as a floor.
    CHECK(fail.cx == static_cast<std::uint8_t>(cx));
    CHECK(fail.cy == static_cast<std::uint8_t>(cy));
    CHECK(fail.cz == static_cast<std::uint8_t>(cz));
    CHECK(aabb_overlaps_solid(
        w, macro_cell_centre(fail.cx, fail.cy, fail.cz), kBodyHalf));

    // A wider search DOES find somewhere, so the refusal above was the radius talking
    // and not the whole world — and where it lands is worth deriving, because it is the
    // support preference in action. The block spans +-4 cells, so the nearest free cells
    // are at ring 5; of those, the only ones with something solid under their feet sit
    // directly on the block's top face (a cell beside the block has air below it, and one
    // below the block has air below that). So the pick is straight up: same column, ring
    // 5, standing on the roof of the obstruction.
    const PlacedCell wider = find_standable_cell(
        w, kBodyHalf, static_cast<std::uint8_t>(cx), static_cast<std::uint8_t>(cy),
        static_cast<std::uint8_t>(cz), radius + 2);
    CHECK(wider.ok);
    CHECK(wider.moved);
    CHECK(wider.rings == static_cast<std::uint8_t>(radius + 2));
    CHECK(wider.supported);
    CHECK(wider.cx == static_cast<std::uint8_t>(cx));
    CHECK(wider.cy == static_cast<std::uint8_t>(cy));
    CHECK(wider.cz == static_cast<std::uint8_t>(cz + radius + 2));
    CHECK(!aabb_overlaps_solid(
        w, macro_cell_centre(wider.cx, wider.cy, wider.cz), kBodyHalf));

    // radius 0 asks "this cell or nothing" and gets nothing.
    const PlacedCell strict = find_standable_cell(
        w, kBodyHalf, static_cast<std::uint8_t>(cx), static_cast<std::uint8_t>(cy),
        static_cast<std::uint8_t>(cz), 0);
    CHECK(!strict.ok);
}

void a_body_in_solid_never_moves_again() {
    // The claim the whole helper rests on, exercised against the real solver rather than
    // asserted from `door.h`: `physics_step` resolves an overlap by backing out, and a
    // body already inside solid has nowhere to back out to.
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    gen_residential(stack.layer(layer), -26);

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    int wallX = 0, wallY = 0;
    CHECK(find_wall_probe(stack.layer(layer), wallX, wallY));
    tr.pos = macro_cell_centre(static_cast<std::uint8_t>(wallX),
                               static_cast<std::uint8_t>(wallY), kStandZ);
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{kBodyHalf});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    const vec3 before = reg.get<Transform>(e).pos;
    for (int i = 0; i < kSimHz; ++i) physics_step(reg, stack, kSimDt);   // one second
    const vec3 after = reg.get<Transform>(e).pos;
    // Not "barely moved" — did not move at all. Every axis binary-searches back to zero
    // and every velocity component is zeroed, every tick, forever.
    CHECK(std::fabs(after.x - before.x) < 1e-6f);
    CHECK(std::fabs(after.y - before.y) < 1e-6f);
    CHECK(std::fabs(after.z - before.z) < 1e-6f);
    CHECK(aabb_overlaps_solid(stack.layer(layer), after, kBodyHalf));

    // Now the fix, through the entry point an arrival would call.
    const PlacedCell moved = place_body_safely(reg, stack.layer(layer), e);
    CHECK(moved.ok);
    CHECK(moved.moved);
    CHECK(moved.supported);
    const vec3 placed = reg.get<Transform>(e).pos;
    CHECK(placed.x == macro_cell_centre(moved.cx, moved.cy, moved.cz).x);
    CHECK(placed.z == macro_cell_centre(moved.cx, moved.cy, moved.cz).z);
    CHECK(!aabb_overlaps_solid(stack.layer(layer), placed, kBodyHalf));

    // ...and a second of physics leaves it resting on the slab instead of frozen inside
    // plaster. This is the assertion that says the body is playable again.
    for (int i = 0; i < kSimHz; ++i) physics_step(reg, stack, kSimDt);
    const vec3 rest = reg.get<Transform>(e).pos;
    CHECK(!aabb_overlaps_solid(stack.layer(layer), rest, kBodyHalf));
    CHECK(reg.get<GravityAffected>(e).grounded);
    // It fell at most the 0.1 m gap between its feet and the slab, so it is still in the
    // cell it was placed in — the placement is where you wake up, not a hint.
    CHECK(std::fabs(rest.z - placed.z) < 0.2f);
}

void placement_writes_the_body_or_nothing() {
    World w;
    gen_residential(w, 0);

    // Two room interiors on the stride-8 lattice (x%8 = 4 and 6), so both are air at the
    // standing storey and neither is a lattice lobby (those cover 13..19 around
    // 16/48/80/112) or an elevator post (x, y in {14, 18} around each shaft).
    constexpr std::uint8_t kFromX = 20, kFromY = 20;
    constexpr std::uint8_t kSavedX = 30, kSavedY = 30;

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = macro_cell_centre(kFromX, kFromY, kStandZ);
    tr.layer = 0;
    reg.emplace<Transform>(e, tr);
    // Falling fast, which is the state a load can land in.
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, -30.0f}});
    reg.emplace<AABB>(e, AABB{kBodyHalf});

    // Restore to a saved cell that is fine: the body lands exactly there, and the fall
    // is cancelled — a carried-over 30 m/s would drive it through the floor on the next
    // step, from a position physics had not yet accepted.
    const vec3 want = macro_cell_centre(kSavedX, kSavedY, kStandZ);
    const PlacedCell ok = place_body_at_cell(reg, w, e, kSavedX, kSavedY, kStandZ);
    CHECK(ok.ok);
    CHECK(!ok.moved);
    CHECK(reg.get<Transform>(e).pos.x == want.x);
    CHECK(reg.get<Transform>(e).pos.y == want.y);
    CHECK(reg.get<Transform>(e).pos.z == want.z);
    CHECK(reg.get<Velocity>(e).v.z == 0.0f);

    // A refusal must leave the body exactly where it was, not half-move it.
    World solid;
    for (int dz = 0; dz < 12; ++dz)
        for (int dy = 0; dy < 12; ++dy)
            for (int dx = 0; dx < 12; ++dx)
                solid.grid().fill_cell(dx, dy, dz, kMatConcrete);
    const vec3 held = reg.get<Transform>(e).pos;
    const PlacedCell refused =
        place_body_at_cell(reg, solid, e, 5, 5, 5, /*radius=*/3);
    CHECK(!refused.ok);
    CHECK(reg.get<Transform>(e).pos.x == held.x);
    CHECK(reg.get<Transform>(e).pos.y == held.y);
    CHECK(reg.get<Transform>(e).pos.z == held.z);

    // An entity with no Transform is not a body: refused, and nothing is created.
    Entity bare = reg.create();
    CHECK(!place_body_safely(reg, w, bare).ok);
    CHECK(!reg.all_of<Transform>(bare));
    // A handle that names nothing at all does not walk off anything either.
    CHECK(!place_body_safely(reg, w, entt::null).ok);
}

void snapshot_restores_the_row_not_the_body() {
    NpcPool pool;
    pool.init();
    const NpcId id = pool.spawn();
    pool.height_mm(id) = 1750;
    pool.max_hp(id) = 100;
    pool.hp(id) = 100;
    pool.cx(id) = 11;
    pool.cy(id) = 22;
    pool.cz(id) = 1;
    pool.set_floor(id, 7);

    PlayerSnapshot snap{};
    snap.clock.food = 12.5f;
    snap.clock.hpDebt = 0.25f;
    snap.clock.seeded = 1;
    snap.inv.slots[3] = ItemSlot{static_cast<ItemId>(42), 7};
    snap.hp = 61;
    snap.maxHp = 140;
    snap.floorNumber = -26;
    snap.cx = 90;
    snap.cy = 91;
    snap.cz = 3;

    apply_player_snapshot(pool, id, snap);
    CHECK(pool.needs(id).food == 12.5f);
    CHECK(pool.needs(id).hpDebt == 0.25f);   // sub-1-HP attrition is not forgiven
    CHECK(pool.needs(id).seeded == 1);
    CHECK(pool.inventory(id).slots[3].item == static_cast<ItemId>(42));
    CHECK(pool.inventory(id).slots[3].count == 7);
    CHECK(pool.hp(id) == 61);
    CHECK(pool.max_hp(id) == 140);           // main.cpp's inline restore dropped this
    // The cell is NOT written here: placement moves the BODY, and `fold_back` re-derives
    // the row from that transform. Writing both would give two answers to one question.
    CHECK(pool.cx(id) == 11);
    CHECK(pool.cy(id) == 22);
    CHECK(pool.cz(id) == 1);
    // Nor is the floor column: it is the seeding label ([population.cpp] is its only
    // writer) and the save carries the player's floor separately for exactly that
    // reason.
    CHECK(pool.floor(id) == 7);

    // A save that carries no maximum leaves the row's own alone, rather than pinning the
    // player at 0/0 hp where every heal is a no-op.
    PlayerSnapshot blank{};
    blank.hp = 55;
    apply_player_snapshot(pool, id, blank);
    CHECK(pool.hp(id) == 55);
    CHECK(pool.max_hp(id) == 140);

    // The wire is int32 and the row is int16, so the narrowing is clamped, not wrapped:
    // 65636 must not arrive as 100.
    PlayerSnapshot forged{};
    forged.hp = 65636;
    forged.maxHp = 70000;
    apply_player_snapshot(pool, id, forged);
    CHECK(pool.hp(id) == 32767);
    CHECK(pool.max_hp(id) == 32767);

    // An invalid row is a no-op, not a write past the end of a column.
    apply_player_snapshot(pool, pool.count() + 5u, snap);
    CHECK(pool.hp(id) == 32767);
}

void travel_drives_the_existing_elevator() {
    // The load side of floor travel: N labelled floors in one call, through
    // `FloorStreamer::travel` — the same path `[` and `]` use. Mirrors
    // test_floor_travel's setup in game_test.cpp deliberately; if that one changes shape
    // this should too.
    Registry ecs;
    NpcPool pool;
    pool.init();
    FloorRegistry reg;
    LevelStack stack;

    FloorStreamer stream;
    stream.init(stack, /*keepRadius=*/0);   // two recyclable physical layers
    stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1u);
    stream.add_module(reg, /*number=*/-8, FloorKind::Residential, /*seed=*/2u);
    stream.add_module(reg, /*number=*/-26, FloorKind::Residential, /*seed=*/3u);
    const std::uint32_t pop = floor_spec(FloorKind::Residential).population;

    NpcId playerId = kInvalidNpc;
    LoadResult start = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(start.player != entt::null);
    CHECK(playerId != kInvalidNpc);
    Entity player = start.player;
    CHECK(pool.count() == pop);   // only floor 0 seeded so far

    // Already there: no hops, no state touched, and `arrived` is true — which is what
    // tells the caller it does NOT need to re-arm the floor.
    const LoadTravel here = travel_to_saved_floor(stack, reg, ecs, pool, stream, player,
                                                  0, 0);
    CHECK(here.arrived);
    CHECK(!here.moved);
    CHECK(here.hops == 0);
    CHECK(here.player == player);
    CHECK(here.floor == 0);
    CHECK(pool.count() == pop);

    // A floor this build's stack does not have. Refused whole: a load that travelled
    // halfway is harder to explain than one that says it could not go.
    const LoadTravel nowhere = travel_to_saved_floor(stack, reg, ecs, pool, stream,
                                                     player, 0, -99);
    CHECK(!nowhere.moved);
    CHECK(!nowhere.arrived);
    CHECK(nowhere.floor == 0);
    CHECK(nowhere.player == player);
    CHECK(stream.loaded(reg, 0));
    CHECK(pool.count() == pop);

    // Two labelled floors down, in one call. The sparse gap is the point: 0 -> -26 is
    // not -26 hops, and `from + dir` lands on nothing for most of this stack.
    const LoadTravel deep = travel_to_saved_floor(stack, reg, ecs, pool, stream, player,
                                                  0, -26);
    CHECK(deep.arrived);
    CHECK(deep.moved);
    CHECK(deep.hops == 2);              // via -8, the nearest label on the way
    CHECK(deep.floor == -26);
    CHECK(deep.player != entt::null);
    CHECK(deep.player != player);       // every ride rebuilds the body
    player = deep.player;
    // Same record throughout — the run is the record, not the entity.
    CHECK(ecs.get<NpcRef>(player).id == playerId);
    CHECK(pool.is_player(playerId));
    CHECK(pool.embodied(playerId));
    CHECK(ecs.get<Transform>(player).layer == deep.layer);
    CHECK(deep.layer == reg.layer_at(-26));
    // Only the destination is resident: keepRadius 0, so the two floors crossed folded
    // back into the cold pool on the way through.
    CHECK(stream.loaded(reg, -26));
    CHECK(!stream.loaded(reg, 0));
    CHECK(!stream.loaded(reg, -8));
    // Each floor seeded its crowd exactly once, including the one only passed through.
    CHECK(pool.count() == 3u * pop);

    // And back up, to prove the direction is derived and not assumed.
    const LoadTravel back = travel_to_saved_floor(stack, reg, ecs, pool, stream, player,
                                                  -26, 0);
    CHECK(back.arrived);
    CHECK(back.hops == 2);
    CHECK(back.floor == 0);
    CHECK(pool.count() == 3u * pop);    // no per-visit growth on the return trip
    CHECK(stream.loaded(reg, 0));
    player = back.player;
    CHECK(ecs.get<NpcRef>(player).id == playerId);
    CHECK(ecs.get<Transform>(player).layer == back.layer);

    // A body with no NpcRef cannot ride: `travel` would forward kInvalidNpc and
    // `ensure_loaded` would designate a SECOND player on the destination floor.
    Entity impostor = ecs.create();
    ecs.emplace<Transform>(impostor, Transform{vec3{4.0f, 4.0f, 3.0f}, back.layer});
    const LoadTravel refused = travel_to_saved_floor(stack, reg, ecs, pool, stream,
                                                     impostor, 0, -8);
    CHECK(!refused.moved);
    CHECK(!refused.arrived);
    CHECK(refused.floor == 0);
    CHECK(!stream.loaded(reg, -8));
    CHECK(pool.count() == 3u * pop);
}

// ---------------------------------------------------------------------------
// FloorModule::candidate is a generation-checked handle, not a bare id
// ---------------------------------------------------------------------------
// WRONG HOME, STATED OUTRIGHT. This test belongs in game_test.cpp beside
// `test_floor_stream` and `test_stream_migration_reembodies`, which is where the rest of
// the streaming behaviour is pinned. It sits here because suite_saveload.inl is the only
// suite the lane that wrote it owned, and a fresh suite_floorstream.inl would FAIL the
// `source_rules` gate — which rejects any tests/suite_*.inl that no tests/*.cpp includes —
// until game_test.cpp picked it up. Move it when that include lands. It is at least not a
// stranger here: `travel_drives_the_existing_elevator` above already drives FloorStreamer.
//
// THE DEFECT. `FloorModule::candidate` is the record a module designates as the player on
// a first load. It was written once when the crowd was seeded and compared as a BARE
// NpcId on every later load — a reference held across the whole session, and the sixth of
// the six bare-id stores [npc_pool.h] lists as blocking `set_recycling(true)`. Armed, the
// designate can die in a macro sweep, its slot be handed to a newborn, and
// `id == fm.candidate` then match a DIFFERENT person who reads as perfectly alive. The
// camera attaches to the wrong creature and nothing logs it.
//
// It is worse than a wrong name. A recycled row is a BLANK row (`NpcPool::reset_row`), and
// hp is NOT copied onto the entity — combat takes `&pool.hp(n->id)` straight from the
// record (combat.cpp:91) and the HUD reads `pool.hp(...)` (main.cpp:1265) — so the
// stranger the camera lands on has hp 0 and max_hp 0. The run would start dead.
//
// The death that matters here is also the one NOTHING reports: the macro sweep publishes
// no NpcDied event, so there is no `*_on_designate_died` handler that could be wired.
// Re-resolving at load time is the only thing that can see it.
//
// RECYCLING IS ARMED IN THE SHIPPING BUILD. `src/app/main.cpp` calls
// `pool.set_recycling(true)` and names this field in its own DONE list of prerequisites,
// so the ABA below is the live configuration, not a rehearsal for a flag nobody has
// flipped. That is also why case 3 (a plain death, recycling off) is kept: it is the
// behaviour the guard must still have if the flag is ever disarmed again.
//
// FIVE CASES, all five asserted, because a guard that refused everything would pass the
// interesting one on its own and a guard that accepted everything would pass case 1:
//   1. live designate   -> still gets the camera (behaviour unchanged)
//   2. recycled slot    -> the newborn does NOT; the module re-designates from its roster
//   3. plain death      -> the same re-designation with recycling OFF
//   4. migrated away    -> nobody, exactly as before (not this lane's defect to change)
//   5. only the excluded slot is left -> nobody, the one documented give-up
//
// MEASURED ON BOTH SIDES, not reasoned about, and measured by RUNNING THIS FILE rather
// than a paraphrase of it. This whole suite was compiled out of tree twice from one
// translation unit and linked against build-win's giga_game.lib / giga_core.lib read-only:
// once with the real src/game/floor_stream.cpp, once with `git show db26b69` of that same
// file — the pre-change revision VERBATIM, no hand-editing, which the identical NpcId /
// NpcHandle width makes compile unchanged against the new header. Residential pop 420,
// designate id 210, seed 1234:
//
//   handle : 793 checks / 0 failures, exit 0. Case 2 camera -> id 209, hp 100, age 24.
//            Case 3 camera -> id 209. Cases 4 and 5 camera -> none.
//   bare id: 793 checks / 12 failures, exit 1. Case 2 camera -> id 210, THE NEWBORN,
//            hp 0, age 0 — the run starts with a dead body. Case 3 camera -> none at all:
//            the designate died, the compare fell through, and the floor came up with
//            nobody in it. Case 5 camera -> the blank recycled row.
//
// Cases 1 and 4 read IDENTICALLY on both sides, which is the part that matters as much as
// the failures: the guard discriminates, it does not simply refuse. sizeof(FloorModule)
// was 48 B either way (module table 12,288 B) — the handle is the same word as the id.
//
// COUNT PIN. This function contributes 63 executed CHECKs to game_test, measured the same
// way: the suite alone prints 730 at db26b69, 779 with the four original cases, 793 with
// case 5 and the guarded reads. CMakeLists.txt pins game_test to an exact total, so that
// pin has to be re-OBSERVED from a real run — it cannot be derived while other lanes are
// also in flight.
void candidate_slot_recycled() {
    const std::uint32_t pop = floor_spec(FloorKind::Residential).population;

    // `seed_floor_from_spec` designates `first + placed/2` — the middle-ish record, so it
    // lands in an interior room rather than a corner (population.cpp). Seeded into a fresh
    // pool `first` is 0, so the designate's id is pop/2 and every assertion below can name
    // it without reaching into FloorStreamer's private module table.
    const NpcId anchor = pop / 2u;

    std::fprintf(stderr,
                 "[floorstream] sizeof(FloorModule) = %u B holding a handle candidate "
                 "(NpcId %u B, NpcHandle %u B — one word either way, so the struct did "
                 "not move); the %d-entry module table is %u B\n",
                 static_cast<unsigned>(sizeof(FloorModule)),
                 static_cast<unsigned>(sizeof(NpcId)),
                 static_cast<unsigned>(sizeof(NpcHandle)), kMaxModules,
                 static_cast<unsigned>(sizeof(FloorModule) *
                                       static_cast<std::size_t>(kMaxModules)));

    { // ---- 1. a LIVE designate still gets the camera ------------------------------
        Registry ecs;
        NpcPool pool;
        pool.init();
        FloorRegistry reg;
        LevelStack stack;
        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1234u);
        CHECK(stream.seed_all_modules(pool) == pop);
        CHECK(pool.generation(anchor) == 0);   // never died, so the handle is current

        NpcId playerId = kInvalidNpc;
        const LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
        CHECK(r.layer != kInvalidLayer);
        CHECK(r.player != entt::null);
        CHECK(playerId == anchor);             // the exact record the module designated
        CHECK(pool.is_player(anchor));
        // Guarded for the same reason as case 2's `havePlayer`: `ecs.get<NpcRef>` on
        // entt::null is undefined behaviour, so an unguarded read here would crash the
        // whole binary on the one failure it is here to report.
        CHECK(r.player != entt::null && ecs.get<NpcRef>(r.player).id == anchor);

        // WHY mint_candidate cannot simply call pool.handle() — the arithmetic, asserted
        // rather than argued. `handle()` packs `id & kNpcIdMask`, so kInvalidNpc masks down
        // to slot kNpcPoolSize-1 and pairs with that slot's generation: the product is
        // neither kInvalidHandle nor a handle naming anybody the caller meant, and it is
        // IN RANGE, so nothing downstream can bounds-check it. That is the entire reason
        // "no designate" has to stay spelled kInvalidHandle instead of pool.handle() of a
        // sentinel. floor_stream.cpp's mint_candidate lives in an anonymous namespace, so
        // this pins the premise it is built on rather than the function.
        CHECK(pool.handle(kInvalidNpc) != kInvalidHandle);
        CHECK(npc_handle_id(pool.handle(kInvalidNpc)) == kNpcPoolSize - 1u);
        CHECK(npc_handle_id(pool.handle(kInvalidNpc)) < pool.capacity()); // legal subscript
        // Below the high-water mark it reads STALE, which routes into the replacement scan
        // and would designate the floor's highest-id resident. On the pool that actually
        // produces kInvalidNpc — reserve exhausted, count_ == kNpcPoolSize — that slot is
        // in range and alive, so this same expression would read TRUE and designate a
        // stranger with no scan at all. Both answers are wrong; only kInvalidHandle is not.
        CHECK(!pool.handle_valid(pool.handle(kInvalidNpc)));
        CHECK(kNpcPoolSize - 1u >= pool.count());   // why it is stale HERE and not there
    }

    { // ---- 2. the designate's slot is RECYCLED into a newborn --------------------
        Registry ecs;
        NpcPool pool;
        pool.init();
        // Armed HERE and not in src/app/main.cpp, deliberately: a test is exactly where an
        // unshipped policy belongs, and the guard has to be proven against the policy
        // before the shipping pool turns it on.
        pool.set_recycling(true);
        CHECK(pool.recycling());
        FloorRegistry reg;
        LevelStack stack;
        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1234u);
        CHECK(stream.seed_all_modules(pool) == pop);
        CHECK(pool.floor(anchor) == 0);

        // The designate dies in the sweep. No event, no handler, no notification.
        pool.kill(anchor);
        CHECK(pool.generation(anchor) == 1);          // every handle minted from it: stale
        CHECK(pool.floor(anchor) == kNoFloorLabel);   // a corpse is in no roster

        // ...and the slot goes to a birth ON THIS FLOOR, which is what makes the ids
        // collide in the first place: `reset_row` leaves a recycled slot on kNoFloorLabel,
        // so a newborn is a resident only once something labels it — and a macro birth
        // labels it with its mother's floor.
        const NpcId newborn = pool.spawn();
        CHECK(newborn == anchor);          // the ABA happened, not hypothetically
        CHECK(pool.recycled() == 1);       // out of the free list, not off the tail
        CHECK(pool.alive(newborn));        // and the stored id reads as LIVING again
        pool.set_floor(newborn, 0);
        CHECK(pool.floor_bucket(0).size() == pop);   // -1 corpse, +1 newborn

        // The blank row a bare id would have handed the camera. hp lives in the record,
        // not on the entity, so these ARE the numbers the player would have played with.
        CHECK(pool.hp(newborn) == 0);
        CHECK(pool.max_hp(newborn) == 0);
        CHECK(pool.age(newborn) == 0);

        NpcId playerId = kInvalidNpc;
        const LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
        CHECK(r.layer != kInvalidLayer);

        // EVERY read of `playerId` below is short-circuited on `havePlayer`, and that is
        // not defensive noise. On a regression the designation fails and playerId stays
        // kInvalidNpc == 0xFFFFFFFF, which is a 4,294,967,295th subscript into a 2^20
        // column: `pool.hp(playerId)` is then an out-of-bounds read, not a failed check.
        // MEASURED: linking this suite against the pre-change floor_stream.cpp made it
        // SEGV at case 3's first unguarded read, which killed the process and swallowed
        // case 4 and every suite after it — a crash instead of seven clean FAILs. A test
        // that dies on exactly the regression it exists to catch reports less than one
        // that fails. Folding the id-validity test INTO the assertion keeps it strictly
        // stronger, never weaker: `havePlayer &&` can only turn a crash into a FAIL.
        const bool havePlayer = playerId != kInvalidNpc;

        std::fprintf(stderr,
                     "[floorstream] designate id %u died in the macro sweep and its slot "
                     "was recycled into a newborn (gen 0 -> %u); the camera went to id %u "
                     "(hp %d, age %u), not to the newborn in slot %u (hp %d, age %u)\n",
                     static_cast<unsigned>(anchor),
                     static_cast<unsigned>(pool.generation(newborn)),
                     static_cast<unsigned>(playerId),
                     havePlayer ? static_cast<int>(pool.hp(playerId)) : -1,
                     havePlayer ? static_cast<unsigned>(pool.age(playerId)) : 0u,
                     static_cast<unsigned>(newborn),
                     static_cast<int>(pool.hp(newborn)),
                     static_cast<unsigned>(pool.age(newborn)));

        // THE FINDING: the stranger who inherited the slot is not handed the camera.
        CHECK(playerId != newborn);
        CHECK(!pool.is_player(newborn));
        // ...and the player is not left unembodied either — the module re-designated from
        // its live roster. Nearest id to the disqualified slot, ties to the lower id, so
        // this is anchor-1 rather than "whatever the bucket happened to hold first".
        CHECK(r.player != entt::null);
        CHECK(playerId == anchor - 1u);
        CHECK(havePlayer && pool.is_player(playerId));
        CHECK(r.player != entt::null && ecs.get<NpcRef>(r.player).id == playerId);
        // A seeded, living resident of THIS floor, not a blank row.
        CHECK(havePlayer && pool.floor(playerId) == 0);
        CHECK(havePlayer && pool.alive(playerId));
        CHECK(havePlayer && pool.hp(playerId) == 100);
        CHECK(havePlayer && pool.age(playerId) >= 1);
        // The newborn is still embodied, as an ordinary body: re-designation moves the
        // camera, it does not evict anybody from the floor.
        CHECK(pool.embodied(newborn));
    }

    { // ---- 3. a plain death, with recycling OFF (the shipped configuration) -------
        // kill() bumps the generation whether or not the slot is ever handed out, so the
        // handle also catches a designate who simply DIED. With a bare id the compare fell
        // through and the load produced no player at all: the floor came up with nobody
        // holding the camera.
        //
        // Reachable in src/app/main.cpp only if a macro tick lands between
        // `seed_all_modules` and the first `ensure_loaded`; today those two lines are
        // adjacent, so this half is a guard on the contract rather than a fix for a
        // symptom anyone has seen.
        Registry ecs;
        NpcPool pool;
        pool.init();
        CHECK(!pool.recycling());
        FloorRegistry reg;
        LevelStack stack;
        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1234u);
        CHECK(stream.seed_all_modules(pool) == pop);

        pool.kill(anchor);
        CHECK(!pool.alive(anchor));
        CHECK(pool.free_slots() == 0);   // not queued: the slot is retired, not reused
        CHECK(pool.floor_bucket(0).size() == pop - 1u);

        NpcId playerId = kInvalidNpc;
        const LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
        CHECK(r.player != entt::null);
        CHECK(playerId == anchor - 1u);
        // Guarded: this is the exact pair of lines the pre-change build SEGV'd on, because
        // the bare-id compare left playerId == kInvalidNpc and pool.is_player() then
        // subscripted flags_ at 0xFFFFFFFF. See case 2's `havePlayer` comment.
        const bool havePlayer = playerId != kInvalidNpc;
        CHECK(havePlayer && pool.is_player(playerId));
        CHECK(havePlayer && pool.embodied(playerId));
        CHECK(!pool.embodied(anchor));   // the corpse is embodied by nobody's mistake
    }

    { // ---- 4. a LIVE designate who moved OFF this floor -> nobody, as before -----
        // Deliberately unchanged. The handle is VALID, so the designate resolves fine; it
        // simply is not in this floor's roster to embody, and the loop never meets it. The
        // load returns no player — exactly what the bare-id compare did. "The designate
        // migrated" is a different question from "the designate is gone", and answering it
        // here would be a behaviour change this lane did not measure.
        Registry ecs;
        NpcPool pool;
        pool.init();
        FloorRegistry reg;
        LevelStack stack;
        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1234u);
        CHECK(stream.seed_all_modules(pool) == pop);

        pool.set_floor(anchor, 1);   // a cold, unregistered floor: pure relabelling
        CHECK(pool.alive(anchor));
        CHECK(pool.floor_bucket(0).size() == pop - 1u);

        NpcId playerId = kInvalidNpc;
        const LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
        CHECK(r.layer != kInvalidLayer);
        CHECK(r.player == entt::null);
        CHECK(playerId == kInvalidNpc);
        // ...and the rest of the floor is embodied regardless — no player, full crowd.
        CHECK(pool.embodied(0));
        CHECK(!pool.embodied(anchor));
    }

    { // ---- 5. the ONE case the slot exclusion gives up on ------------------------
        // A floor whose only live, non-embodied resident IS the disqualified slot. The
        // scan skips that slot by construction, finds nothing, and the module designates
        // NOBODY — the same answer as a kInvalidHandle candidate. floor_stream.cpp states
        // this as an accepted trade ("a floor with one resident is not the scenario this
        // guard is for") and it was asserted nowhere, which is how a documented trade
        // quietly becomes an undocumented regression. Now it is pinned.
        //
        // It still DISCRIMINATES — it is not a test that passes either way. The bare-id
        // compare matches the newborn sitting in the recycled slot and hands it the camera
        // with hp 0 / max_hp 0, so all four assertions below fail against the old code.
        // Designating nobody is the correct answer here; handing the camera to a blank row
        // is not, and "the floor came up with no player" is a state ensure_loaded's
        // contract already allows (cases 2 and 4 return it).
        Registry ecs;
        NpcPool pool;
        pool.init();
        pool.set_recycling(true);
        FloorRegistry reg;
        LevelStack stack;
        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1234u);
        CHECK(stream.seed_all_modules(pool) == pop);

        pool.kill(anchor);
        const NpcId newborn = pool.spawn();
        CHECK(newborn == anchor);        // the ABA again, so the stale slot IS occupied
        pool.set_floor(newborn, 0);

        // Empty the roster AROUND it: every original except the recycled slot dies, so the
        // bucket collapses to exactly the one id the generation check disqualified.
        for (NpcId id = 0; id < pop; ++id)
            if (id != anchor) pool.kill(id);
        CHECK(pool.floor_bucket(0).size() == 1u);
        CHECK(pool.floor_bucket(0)[0] == newborn);   // size 1, so order is not a question

        NpcId playerId = kInvalidNpc;
        const LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
        CHECK(r.layer != kInvalidLayer);
        CHECK(r.player == entt::null);    // nobody — the documented give-up
        CHECK(playerId == kInvalidNpc);
        CHECK(!pool.is_player(newborn));  // above all: NOT the blank recycled row
        CHECK(pool.embodied(newborn));    // still embodied, just not as the player
    }
}

} // namespace saveload_test

static void test_saveload_all() {
    saveload_test::wire_layout();
    saveload_test::round_trip();
    saveload_test::macro_world_round_trips();
    saveload_test::floor_file_round_trips();
    saveload_test::weak_check_vs_strong_check();
    saveload_test::rejects_the_rest();
    saveload_test::keys_not_entity_ids();
    saveload_test::floor_records_survive_a_restart();
    saveload_test::ledger_is_pinned();
    saveload_test::cell_conventions();
    saveload_test::arrival_cell_is_often_a_wall();
    saveload_test::solid_cell_resolves_to_a_standable_neighbour();
    saveload_test::fully_solid_neighbourhood_fails_loudly();
    saveload_test::a_body_in_solid_never_moves_again();
    saveload_test::placement_writes_the_body_or_nothing();
    saveload_test::snapshot_restores_the_row_not_the_body();
    saveload_test::travel_drives_the_existing_elevator();
    saveload_test::candidate_slot_recycled();
}
