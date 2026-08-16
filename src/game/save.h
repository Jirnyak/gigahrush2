// Save / load — the run stops dying with the process.
//
// Everything the game accumulates today is in RAM and nowhere else: the ledger, the
// contract book, the survival clock, the inventory, and which crates you already
// emptied. Close the window and all of it is gone. That is not a missing feature in
// the same sense a HUD panel is missing — a descent-and-extraction loop whose whole
// design is "value is not yours until it is banked" ([extraction.h]) has no meaning at
// all if the bank empties itself on exit.
//
// **What is deliberately NOT in here, and why each one is free:**
//
//   * **Geometry.** `generate_floor` is a pure function of (seed, floor number,
//     spec.kind) and clears to air first ([floor_gen.cpp]). Runtime mutation is
//     covered twice over: NON-resident floors carry version 3's CARVE LOG (28 bytes
//     of deterministic op each, replayed on every rebuild), and the RESIDENT floor
//     carries version 4's SNAPSHOT — its exact grid, RLE-encoded (~5 MB measured on
//     floor 0 against 138 MB raw; disk is free at save points, [jirnyak.md] §6),
//     stamped back verbatim on load. State beats history where it matters: the
//     snapshot un-carves post-F5 holes, which no replay could. Doors still reset on
//     load (door_build re-stamps its leaves AFTER the snapshot, keeping DoorSet and
//     cells agreed).
//   * **Monsters.** They are destroyed on unload and re-rolled deterministically per
//     (floor, seed) on entry ([monsters.md]). A monster has no macro existence to
//     persist.
//   * **The NPC pool.** ~950k rows of `NpcPool` are reproduced exactly by
//     `seed_floor_population` from a fixed seed, and the streamer seeds each floor's
//     crowd exactly once ([floor_stream.h]). The one row carrying state nothing can
//     reproduce is the PLAYER's — its clock, its bag, its HP — so that is the row that
//     travels, as `PlayerSnapshot`. If NPC relationships or per-citizen clocks ever
//     start mutating at runtime, that assumption dies and the pool has to join the
//     format: rows `[0, count_)` only, ~47 KB at the measured 1930 live rows across the
//     ten demo floors, not the 0.48 GiB the capacity implies.
//   * **A run seed.** There is not one to save. Every seed in the game is a
//     compile-time literal in `main.cpp` — 1337 for the floor modules, 0xC0FFEE for
//     containers, 0xB0B5EED for mobs, 0x5A303B0D for samosbor, 0xA11FE for nav — so
//     every run builds the identical building. The day a run rolls its own seed, that
//     seed becomes the single most important field in this header, because without it
//     none of the "it regenerates" reasoning above holds.
//
// **No file I/O here, on purpose.** `giga_game` links `giga_core` and nothing
// platform-shaped ([AGENTS.md]), so this file takes and returns a byte buffer and the
// `fopen` lives in `src/app`. That also makes the whole format testable headless: the
// round-trip test never touches a disk.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/contract.h"    // ContractBook, Contract
#include "game/extraction.h"  // RunLedger
#include "game/faction_relations.h" // FactionRelations, kRelFactionCount
#include "game/equip.h"       // Equipped — the player's recorded decisions
#include "game/inventory.h"   // Inventory
#include "game/npc_pool.h"    // Needs
#include "game/quest.h"       // QuestLog, kQuestLogWire, quest_table_fingerprint
#include "game/rpg.h"         // RpgStats
#include "game/craft.h"       // CraftingState, kCraftingWire, craft_write/read
#include "game/combat.h"      // PlayerRanged (SAVMAG v8)
#include "game/status.h"      // StatusSet (SAVSTAT v9)
#include "game/samosbor.h"    // SamosborState (SAVCLOCK v10)
#include "game/economy.h"     // BankAccount, kBankLedgerSlots (SAVMAG v15)
#include "game/fast_travel.h" // FastTravelState (SAVCLOCK v10)
#include "world/destruct.h"   // CarveOp, CarveScratch, CarveResult, carve_sphere
#include "world/level_stack.h"  // LayerId, and World via world/world.h

namespace giga::game {

// Referenced only as `T&` parameters below, so a declaration is enough and this file
// does not have to pull in the whole streaming stack ([AGENTS.md] headers minimal).
// `save.cpp` includes game/floor_stream.h, which defines both.
class FloorRegistry;
class FloorStreamer;

// On-disk bytes spell "GH2S". Written little-endian byte by byte, so the four
// leading bytes of a save file are readable in a hex dump on any host.
inline constexpr std::uint32_t kSaveMagic = 0x53324847u;

// Bump this whenever the wire layout changes in ANY way — a field added, a field
// reordered, a meaning changed. `save_read` refuses a version it does not recognise
// rather than guessing, because the alternative is the failure this whole file exists
// to prevent: a load that succeeds and is wrong.
// Version 2: QuestLog added to the payload (quest_log_write / quest_log_read after the
// opened-container list). Version 1 saves are rejected; they predate quest persistence.
// Version 3 carried a carve-op log and version 4 an embedded active-floor snapshot;
// BOTH are gone in version 5, replaced by the MODULAR layout the game actually is:
// geometry lives in per-floor files (floor_file_write/read below, one `floor_<N>.sav`
// per visited floor in the save directory), written when the player LEAVES a floor
// and stamped back whenever a floor is (re)built — an elevator ride and an F9 are
// the same code path. run.sav itself carries only the run: ledger, contracts,
// player, opened crates, quests. Loading touches exactly two files — run.sav and
// the active floor's — and every other floor loads from its own file only when the
// player actually goes there.
// Version 6: THE MACRO WORLD travels too — the whole NpcPool table (verbatim flat
// columns, [npc_pool.h] save_rows), the MacroSim clock/cursors/journeys
// ([macro_sim.h] save_state) and the live FactionRelations matrix. The society you
// return to is the one you left, not a reseed. Restored from the MAIN MENU, before
// anything is embodied, so no body can hold a stale id. Earlier versions are
// rejected, per the standing rule.
// Version 7: the character sheet and the crafting bank travel too — RpgStats
// (level/xp/attrs/psi) and CraftingState (known-recipe bits + material bank +
// tier). F5/F9 no longer drop progression. craft_write/craft_read own the craft
// codec ([craft.h]); the RPG fields are written little-endian field by field.
// Version 8: chambered firearm state and the cumulative kill tally travel too —
// PlayerRanged (mag/weapon/shots/hits + transient cooldowns) and melee kills.
// Ammo already debited into the magazine must not vanish on F9; kills already
// survive death-possession and the elevator. [combat.h] SAVMAG
// Version 9: live status effects travel too — StatusSet (remainMs/intensityE3/alt
// for all six authored statuses). F5 mid-haze must not wipe the timers on F9;
// a loaded body keeps the same move/aim/melee mults it saved under. [status.h]
// SAVSTAT
// Version 10: the two RUN-SCOPED clocks that were being thrown away — SamosborState
// and FastTravelState. Both lived as locals in `main` and appeared nowhere in this
// file, and each loss was silent in its own way:
//   * the samosbor clock is the CENTRAL crisis machine, and saving in an active
//     phase at |z| = 50 then loading put the automaton back in Idle with `count` 0.
//     `count` is what `MobDef::minSamosbor` unlocks against, so the fog roster was
//     reset too. The standard save button cancelled the standard crisis.
//   * the fast-travel unlock set is DISCOVERY — every hub the player found. It was
//     re-found from scratch each session ([problems.md] §43).
// 17 + 32 bytes. Version 9 saves are rejected, per the standing rule; there is no
// migration and the honest reason is that adding one would need a per-version
// reader branch, which is exactly the "load that succeeds and is wrong" this file
// is built to prevent. [samosbor.h] [fast_travel.h] SAVCLOCK
//
// Version 11: Needs grows `hpBank` (+4 on the wire) — the crowd heal bank behind
// the IntentHeal -> Medical affordance ([room_zone.h] TABLE 2). Version 10 saves
// are rejected, same standing rule as above.
//
// Version 12: the crafting bank shrinks from nine axes to eight (-4 on the wire)
// — the ninth material was merged into electronics ([craft.h] "The eight axes").
// A v11 bank's nine counts do not map onto eight slots without inventing a rule,
// so version 11 saves are rejected, same standing rule. Note for the archaeologist:
// kSaveFixedWire lands back on 927, the same number v10 had before hpBank — a
// coincidence of two DIFFERENT formats (v10 lacked hpBank and had nine axes),
// not a compatibility.
// Version 13: the inventory cell's u16 count splits into u8 count + u8
// condition ([inventory.h] — wear state, 255 = mint). Zero bytes moved on the
// wire (a slot is 4 B either way), but a v12 reader would fuse count and
// condition into one u16, so version 12 saves are rejected, same standing
// rule. Pool rows carry the same cell and change in the same stroke
// ([npc_pool.cpp] save_rows/load_rows).
// Version 14: PlayerSnapshot adds `Equipped` items (+4 B on wire: weapon, armor, tool, pad_).
// Version 13 saves are rejected, same standing rule.
// Version 15: BankAccount (+352 B on wire: deposit, loan, ledger ring, terms), PlayerSnapshot camera angles (+8 B on wire: yaw, pitch), and PowerGridState (+1028 B on wire: count, destroyed shield cell keys).
// Version 14 saves are rejected, same standing rule.
// Version 16: Complete RpgStats persistence — all 5 attributes (Str/Agi/End/Int/Per), perkPoints, radDose, traitMask, perkMask, mutationMask (BioMutations), and cybernetic implant IDs + implantDurability wear (8 slots). (+41 B on wire).
// Version 15 saves are rejected, same standing rule.
inline constexpr std::uint32_t kSaveVersion = 16u;

// ---------------------------------------------------------------------------
// The silent failure mode this format is built around
// ---------------------------------------------------------------------------
// `ItemId` is a 1-based row index into an alphabetically-sorted `data/items.csv`, and
// `MobKind` is a row index into `data/mobs.csv` ([item_table.h], [mob_table.h]).
// Insert ONE item into the CSV and every saved id above the insertion point now names
// a different object. `Contract::subject` has the same problem twice over: it is an
// `ItemId` for a Fetch job and a `MobKind` for a Hunt job. Nothing about that shift is
// detectable from the payload — the ids are all still in range, the checksum is still
// valid, and the save loads "successfully" while handing the player the wrong gear and
// a contract to hunt the wrong monster.
//
// Two defences, and they are NOT of equal strength:
//
//   1. `itemCount` / `mobKindCount`. **A WEAK CHECK, and it is important to say so.**
//      It catches an insertion or a deletion, which is the common case, and nothing
//      else. Rename a row, or reorder rows, or delete one row and add another in the
//      same edit, and the count is unchanged — the save passes this gate and is
//      silently wrong. It is kept because it is free and because it names WHICH table
//      drifted, which a hash cannot.
//   2. `itemFingerprint` / `mobFingerprint`. **This is the strong check**, and it is
//      why this format does not merely warn about the problem in a comment. Each is an
//      FNV-1a hash over every display name in the table, in table order
//      (`item_table_fingerprint` / `mob_table_fingerprint` below). A name is a row's
//      identity, so the hash moves on insert, delete, rename AND reorder — the three
//      cases the count misses. It deliberately does NOT cover stats: retuning an
//      item's value or spawn weight changes balance, not what id 231 *means*, and
//      rejecting saves over a balance patch would be a worse bug than the one being
//      fixed.
//
// What neither defence gives you is MIGRATION. A rejected save is data the player
// loses. The real fix, when the content tables stop being append-only, is to store
// item ids as their stable CSV `id` string rather than as a row index — at which point
// a reorder becomes a lookup instead of a rejection. That is a change to
// `ItemSlot`/`Contract`, not to this file, so it is named here and not attempted.
std::uint32_t item_table_fingerprint();
std::uint32_t mob_table_fingerprint();

// Why a load was refused. Reported rather than merely returned as `false`, because
// "your save is from an older build" and "your save file is truncated" want different
// words in front of the player, and because a test that only asserts `!ok` cannot tell
// a version rejection from an accidental parse failure.
enum class SaveError : std::uint8_t {
    None = 0,
    TooShort,            // buffer ends before the format does
    BadMagic,            // not a gigahrush2 save at all
    BadVersion,          // a different kSaveVersion wrote it
    ItemCountMismatch,   // data/items.csv changed row count  (the weak check)
    MobCountMismatch,    // data/mobs.csv changed row count    (the weak check)
    ItemTableChanged,    // items.csv identities moved         (the strong check)
    MobTableChanged,     // mobs.csv identities moved          (the strong check)
    LayoutMismatch,      // a serialized struct changed size in this build
    SizeMismatch,        // declared payload length disagrees with its own contents
    BadChecksum,         // payload corrupt
    Count
};
const char* save_error_text(SaveError e);

// Fixed-size prologue. Every field is here to make one specific wrong load impossible.
//
// `tickHz` is recorded but is NOT a rejection reason, and that distinction is
// deliberate. The tick has already moved once — 120 -> 125, because
// `static_cast<uint16_t>(dt * 1000 + 0.5f)` truncated 8.833 to 8 and stretched every
// authored duration in the game by 4.17% ([core/tick.h]) — so the next move is a
// question of when. Nothing in the CURRENT payload is tick-derived, though: the
// survival clock is per-second floats, contract progress is a count, the ledger is
// roubles. So refusing the load would throw away a perfectly good save over a number
// that does not affect it. The moment a tick count, a cooldown in milliseconds, or a
// samosbor phase enters this format, this field becomes load-bearing and the caller
// must start comparing it — which it can, because it is written down.
struct SaveHeader {
    std::uint32_t magic = 0;              //  0
    std::uint32_t version = 0;            //  4
    std::uint32_t tickHz = 0;             //  8  giga::kSimHz at write time; advisory
    std::uint32_t itemCount = 0;          // 12  kItemCount        (weak)
    std::uint32_t mobKindCount = 0;       // 16  kMobKindCount     (weak)
    std::uint32_t itemFingerprint = 0;    // 20  item name hash    (strong)
    std::uint32_t mobFingerprint = 0;     // 24  mob name hash     (strong)
    std::uint32_t openedCount = 0;        // 28  OpenedContainerKey records that follow
    std::uint16_t ledgerBytes = 0;        // 32  sizeof(RunLedger) in the writing build
    std::uint16_t bookBytes = 0;          // 34  sizeof(ContractBook)
    std::uint16_t needsBytes = 0;         // 36  sizeof(Needs)
    std::uint16_t invBytes = 0;           // 38  sizeof(Inventory)
    std::uint32_t payloadBytes = 0;       // 40
    std::uint32_t payloadCrc = 0;         // 44  CRC-32 of every byte after the header
    // Version 2 additions (bytes 48-55). Placed at the end so a version-1 reader that
    // stops at byte 48 never tries to parse them. (Versions 3/4 briefly appended
    // carveCount/snapBytes here; version 5 moved geometry into per-floor files and
    // the fields left with it.)
    std::uint32_t questCount = 0;         // 48  kQuestCount       (weak)
    std::uint32_t questFingerprint = 0;   // 52  quest title hash  (strong)
    // Version 6 additions: byte lengths of the pool and macro-sim blobs that ride
    // between the opened-container list and the faction matrix.
    std::uint32_t poolBytes = 0;          // 56
    std::uint32_t macroBytes = 0;         // 60
};

// Wire sizes. These are the ON-DISK footprints, which are deliberately NOT the
// `sizeof`s: every field is written individually in little-endian order, so no padding
// byte and no host byte order ever reaches the file. That is what keeps a save written
// by the MSVC build readable by the Clang build and vice versa, and it is why the
// `*Bytes` header fields above are a drift ALARM rather than a layout description.
inline constexpr std::size_t kSaveHeaderWire = 64;   // 48 v1; +8 v2 quests; +8 v6 pool/macro
inline constexpr std::size_t kLedgerWire = 33;       // 2x8 + 4x4 + 1
inline constexpr std::size_t kContractWire = 21;     // 4 + 2 + 3x4 + 3   (pad_ dropped)
inline constexpr std::size_t kBookWire =
    static_cast<std::size_t>(kMaxContracts) * kContractWire + 4 + 4 + 8;
inline constexpr std::size_t kNeedsWire = 37;        // 9 floats + seeded (v11: +hpBank)
inline constexpr std::size_t kInventoryWire = static_cast<std::size_t>(kInvSlots) * 4; // 256
inline constexpr std::size_t kEquippedWire = 4;       // weapon, armor, tool, pad_
inline constexpr std::size_t kPlayerWire =
    kNeedsWire + kInventoryWire + kEquippedWire + 4 + 4 + 4 + 3 + 4 + 4; // 320 (+yaw, +pitch)
static_assert(kPlayerWire == 320);
// Version 16: RpgStats wire — field-by-field LE, NOT sizeof:
// xp (4) + psi (2) + level (1) + attrPoints (1) + attr[5] (5) + perkPoints (1) +
// radDose (2) + traitMask (4) + perkMask (4) + mutationMask (4) +
// implantId[8] (8) + implantDurability[8] (16) + pad_ (1) = 53 bytes.
inline constexpr std::size_t kRpgWire =
    4 + 2 + 1 + 1 + kAttrCount + 1 + 2 + 4 + 4 + 4 +
    kImplantSlotCount + kImplantSlotCount * 2 + 1;  // 53
static_assert(kRpgWire == 53);
// kCraftingWire (89) is defined in craft.h next to craft_write/craft_read.
// kQuestLogWire is defined in quest.h.
// Version 8 / SAVMAG: PlayerRanged field-by-field (NOT sizeof — host padding)
// + presence flag + cumulative melee kills. Cooldowns ride so a mid-reload F5
// does not free-fire on F9; hasRanged keeps lazy-attach honest (elevator rule).
inline constexpr std::size_t kRangedWire =
    2 + 2 + 2 + 2 + 4 + 4;  // cd, reload, mag, weapon, shots, hits = 16
static_assert(kRangedWire == 16);
inline constexpr std::size_t kCombatSaveWire =
    1 + kRangedWire + 4;  // hasRanged + ranged + kills = 21
static_assert(kCombatSaveWire == 21);
// Version 9 / SAVSTAT: StatusSet field-by-field (NOT sizeof — host padding).
// 6 x u32 remainMs + 6 x u16 intensityE3 + 6 x u8 alt = 24+12+6 = 42.
inline constexpr std::size_t kStatusWire =
    kStatusCount * 4 + kStatusCount * 2 + kStatusCount * 1;  // 42
static_assert(kStatusWire == 42);
// Version 10 / SAVCLOCK: SamosborState field-by-field (NOT sizeof — the struct has
// three tail padding bytes after `sealed`, and writing them would put uninitialised
// host padding into a file that a CRC then blesses).
inline constexpr std::size_t kSamosborWire =
    4 + 4 + 4 + 2 + 1 + 1 + 1;  // phaseMs, phaseTotalMs, activeMs, count, phase, variant, sealed
static_assert(kSamosborWire == 17);
// Version 10 / SAVCLOCK: the fast-travel unlock bitset, raw. Dense bytes with no
// multi-byte field, so the field-by-field rule has nothing to protect here — see the
// note beside FastTravelState::raw() in [fast_travel.h].
inline constexpr std::size_t kFastTravelWire = 32;
// Version 15: BankAccount field-by-field (deposit 8, loanPrincipal 8, loanAccrued 8,
// interestEarned 8, interestPaid 8, lastInterestTick 8, creditLimit 4, entries 4,
// 24 x BankEntry 12 (amount 4, tick 4, op 1, band 1, pad_ 2), band 1, pad_ 7 = 352).
inline constexpr std::size_t kBankEntryWire = 4 + 4 + 1 + 1 + 2; // 12
static_assert(kBankEntryWire == 12);
inline constexpr std::size_t kBankWire =
    8 * 6 + 4 + 4 + static_cast<std::size_t>(kBankLedgerSlots) * kBankEntryWire + 1 + 7; // 352
static_assert(kBankWire == 352);
// Version 15: PowerGridState field-by-field (count 4, destroyedShieldKeys 128 x 8 = 1028).
inline constexpr std::size_t kPowerGridWire =
    4 + static_cast<std::size_t>(kMaxDestroyedShields) * 8; // 1028
static_assert(kPowerGridWire == 1028);
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
inline constexpr std::size_t kSaveFixedWire =
    kLedgerWire + kBookWire + kPlayerWire + kRpgWire + kCraftingWire +
    kCombatSaveWire + kStatusWire + kSamosborWire + kFastTravelWire +
    kBankWire + kPowerGridWire + kQuestLogWire;

// Sanity ceiling on the opened-container list, so a corrupt header cannot ask for a
// huge allocation before the checksum has had a chance to reject it. 64 crates per
// floor ([main.cpp] refresh_floor_containers cap) x 255 floor labels is 16,320; this
// is four times that.
inline constexpr std::uint32_t kMaxOpenedKeys = 65536u;
// Ceilings for the v6 blobs, again before the CRC has vouched: the pool's honest
// worst case is 2^20 rows x ~364 B ≈ 382 MB; macro state is a fraction of that.
inline constexpr std::uint32_t kMaxPoolBytes = 512u * 1024u * 1024u;
inline constexpr std::uint32_t kMaxMacroBytes = 64u * 1024u * 1024u;
// The faction matrix rides fixed-size: 36 signed bytes ([faction_relations.h]).
inline constexpr std::size_t kFactionWire =
    kRelFactionCount * kRelFactionCount;

// Ceiling on a floor file's snapshot blob before its checksum has vouched for the
// header.
inline constexpr std::uint32_t kMaxSnapBytes = 1024u * 1024u * 1024u;

// Exact byte count `save_write` will produce for the given section sizes.
inline constexpr std::size_t save_bytes_for(std::size_t openedCount,
                                            std::size_t poolBytes = 0,
                                            std::size_t macroBytes = 0) {
    return kSaveHeaderWire + kSaveFixedWire + kFactionWire +
           openedCount * kOpenedKeyWire + poolBytes + macroBytes;
}

// ---------------------------------------------------------------------------
// An opened crate, identified by something that survives a restart
// ---------------------------------------------------------------------------
struct OpenedContainerKey {
    std::int16_t floor = 0;     // in-game floor number, [-127, 127]
    std::uint8_t cx = 0;        // macro cell, already wrapped onto [0, 128)
    std::uint8_t cy = 0;
    std::uint8_t cz = 0;
    std::uint8_t pad_ = 0;      // keeps the struct 6 B and trivially comparable
};
static_assert(sizeof(OpenedContainerKey) == 6);

inline bool same_container(const OpenedContainerKey& a, const OpenedContainerKey& b) {
    return a.floor == b.floor && a.cx == b.cx && a.cy == b.cy && a.cz == b.cz;
}

// The key a crate at `pos` on floor `floorNumber` would be saved under. Pure; exposed
// so a test can key a crate without a registry.
OpenedContainerKey container_key(int floorNumber, const vec3& pos);

// ---------------------------------------------------------------------------
// Per-floor state files — the modular half of the save
// ---------------------------------------------------------------------------
inline constexpr std::uint32_t kFloorMagic = 0x46324847u; // 'G','H','2','F'
inline constexpr std::uint32_t kFloorFileVersion = 2u;
inline constexpr std::size_t kFloorHeaderWire = 16;

// Encode the World into a complete floor file (header + CRC + snapshot blob).
void floor_file_write(const World& w, int floorNumber,
                      std::vector<std::uint8_t>& out);

// Validate a floor file and stamp it onto `w`. False on any rejection (magic,
// version, size, CRC, malformed blob) — the caller keeps the generated floor and,
// where it can, says so out loud. `floorOut` reports the floor the blob claims.
bool floor_file_read(const std::uint8_t* bytes, std::size_t n, World& w,
                     std::int32_t* floorOut = nullptr, SaveError* err = nullptr);

// ---------------------------------------------------------------------------
// What travels
// ---------------------------------------------------------------------------

// The player's row, lifted out of the pool.
struct PlayerSnapshot {
    Needs clock{};              // the survival clock; canonical in the pool row
    Inventory inv{};            // 64 slots, 256 B
    Equipped equipped{};        // equipped weapon/armor/tool slot indices
    std::int32_t hp = 0;        // also pool-row state, also unreproducible
    std::int32_t maxHp = 0;
    // The SIGNED floor the player stood on.
    std::int32_t floorNumber = 0;
    // The macro cell within that floor.
    std::uint8_t cx = 0;
    std::uint8_t cy = 0;
    std::uint8_t cz = 0;
    std::uint8_t pad_ = 0;
    float yaw = 0.0f;
    float pitch = 0.0f;
};

// One run, complete. Assembled by the caller, because every piece of it lives somewhere
// different and this file must not go hunting for singletons — "the player is not
// special" ([AGENTS.md]) means there is no player global to hunt for.
struct SaveState {
    RunLedger ledger{};
    ContractBook book{};
    PlayerSnapshot player{};
    // Version 7: character sheet.
    RpgStats rpg{};
    // Version 7: crafting bank + known-recipe bits + tier ([craft.h]).
    CraftingState craft{};
    // Version 8 / SAVMAG: chambered firearm + kill tally.
    std::uint8_t hasRanged = 0;
    PlayerRanged ranged{};
    std::uint32_t kills = 0;
    // Version 9 / SAVSTAT: live status effects.
    StatusSet status{};
    // Version 10 / SAVCLOCK: the two run-scoped clocks.
    SamosborState samosbor{};
    FastTravelState fastTravel{};
    // Version 15: Bank account persistence (deposit, loans, interest, and ledger ring).
    BankAccount bank{};
    // Version 15: Power grid outage & destroyed electrical shield state.
    PowerGridState powerGrid{};
    // Every crate emptied anywhere in the building, not just on the live floor.
    std::vector<OpenedContainerKey> opened;
    // Version 2: quest log persisted across F5/F9.
    QuestLog quests{};
    // Version 6: the macro world.
    std::vector<std::uint8_t> poolBlob;
    std::vector<std::uint8_t> macroBlob;
    FactionRelations factions = kBaseFactionMatrix;
};

// ---------------------------------------------------------------------------
// The active-floor snapshot — state, not history
// ---------------------------------------------------------------------------
std::size_t snapshot_floor(const World& w, int floorNumber,
                           std::vector<std::uint8_t>& out);

bool apply_floor_snapshot(World& w, const std::uint8_t* bytes, std::size_t n,
                          std::int32_t* floorOut = nullptr);

// Serialize. `out` is cleared first and ends up exactly `save_bytes_for(opened.size())` long.
void save_write(const SaveState& st, std::vector<std::uint8_t>& out);

// Parse.
bool save_read(const std::uint8_t* bytes, std::size_t n, SaveState& st,
               SaveError* err = nullptr, SaveHeader* hdrOut = nullptr);

// ---------------------------------------------------------------------------
// Container state <-> registry
// ---------------------------------------------------------------------------

std::size_t collect_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                     std::vector<OpenedContainerKey>& out);

std::size_t refresh_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                      std::vector<OpenedContainerKey>& set);

std::size_t apply_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                    const OpenedContainerKey* keys, std::size_t n,
                                    const vec3* openedColour = nullptr);

// ---------------------------------------------------------------------------
// Coming back to where you stood
// ---------------------------------------------------------------------------
inline constexpr std::uint8_t kArrivalCoord = 3;
inline constexpr int kMaxLoadHops = 255;

struct LoadTravel {
    int floor = 0;                // where the player actually ended up
    Entity player = entt::null;   // the CURRENT player entity: a ride rebuilds the body
    LayerId layer = kInvalidLayer;
    std::uint8_t hops = 0;        // labelled floors crossed
    bool moved = false;           // the floor changed, so the caller must re-arm it
    bool arrived = false;         // ...and it is the floor the save named
};

LoadTravel travel_to_saved_floor(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                                 NpcPool& pool, FloorStreamer& streamer, Entity player,
                                 int fromFloor, int targetFloor,
                                 std::uint8_t arrivalCoord = kArrivalCoord);

// ---------------------------------------------------------------------------
// Placement — a body in solid geometry never moves again
// ---------------------------------------------------------------------------
inline constexpr int kPlaceRadius = 8;
inline constexpr int kPlaceRadiusMax = 24;

struct PlacedCell {
    std::uint8_t cx = 0;
    std::uint8_t cy = 0;
    std::uint8_t cz = 0;
    std::uint8_t rings = 0;   // Chebyshev distance in cells from the requested cell
    bool ok = false;          // false: no cell in the neighbourhood fits a body at all
    bool moved = false;       // the requested cell was solid; this is a substitute
    bool supported = false;   // something solid under the feet
};

void macro_cell_of(const vec3& pos, std::uint8_t& cx, std::uint8_t& cy,
                   std::uint8_t& cz);

vec3 macro_cell_centre(std::uint8_t cx, std::uint8_t cy, std::uint8_t cz);

PlacedCell find_standable_cell(const World& world, const vec3& half, std::uint8_t cx,
                               std::uint8_t cy, std::uint8_t cz,
                               int radius = kPlaceRadius);

PlacedCell place_body_at_cell(Registry& reg, const World& world, Entity body,
                              std::uint8_t cx, std::uint8_t cy, std::uint8_t cz,
                              int radius = kPlaceRadius);

PlacedCell place_body_safely(Registry& reg, const World& world, Entity body,
                             int radius = kPlaceRadius);

void apply_player_snapshot(NpcPool& pool, NpcId id, const PlayerSnapshot& snap);

} // namespace giga::game
