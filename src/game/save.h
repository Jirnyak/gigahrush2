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
#include "game/inventory.h"   // Inventory
#include "game/npc_pool.h"    // Needs
#include "game/quest.h"       // QuestLog, kQuestLogWire, quest_table_fingerprint
#include "game/rpg.h"         // RpgStats
#include "game/craft.h"       // CraftingState, kCraftingWire, craft_write/read
#include "game/combat.h"      // PlayerRanged (SAVMAG v8)
#include "game/status.h"      // StatusSet (SAVSTAT v9)
#include "game/samosbor.h"    // SamosborState (SAVCLOCK v10)
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
inline constexpr std::uint32_t kSaveVersion = 10u;

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
inline constexpr std::size_t kNeedsWire = 33;        // 8 floats + seeded
inline constexpr std::size_t kInventoryWire = static_cast<std::size_t>(kInvSlots) * 4;
inline constexpr std::size_t kPlayerWire = kNeedsWire + kInventoryWire + 4 + 4 + 4 + 3;
// Version 7: RpgStats wire — field-by-field LE, NOT sizeof (pad_ is written so the
// footprint stays 12 and matches the POD layout without host padding surprises).
inline constexpr std::size_t kRpgWire = 4 + 2 + 1 + 1 + 3 + 1;  // 12
static_assert(kRpgWire == 12);
// kCraftingWire (93) is defined in craft.h next to craft_write/craft_read.
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
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
inline constexpr std::size_t kSaveFixedWire =
    kLedgerWire + kBookWire + kPlayerWire + kRpgWire + kCraftingWire +
    kCombatSaveWire + kStatusWire + kSamosborWire + kFastTravelWire + kQuestLogWire;

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
//
// WAS 256 MiB, and that number was derived from the WRONG worst case. It counted
// mask runs and type runs — "a checkerboard floor: 2 M mask-state runs (5 B each)
// + 2 M mixed masks (64 B each) + full type runs, ~150 MB" — and never counted the
// term that actually dominates: the `sub_material` PAGES. A pristine padic floor
// carries 689,958 pages x 1 KiB = 706 MB, so a MEASURED, never-shot-at floor wrote
// a 772.0 MB file that this reader refused on sight (2026-08-06).
//
// The consequence was not a slow save, it was NO save: `floor_file_write` has no
// size guard, so every `floor_<N>.sav` the game produced was unreadable by its own
// reader, and every carve, every door state and every sub-material edit was lost on
// revisit while 736 MiB of disk was burned per floor per save. [problems.md] §37.
//
// 1 GiB restores the property the number is FOR — a corrupt header asking for
// gigabytes is still refused, `blobBytes` still fits a uint32 with 4x slack — while
// admitting the real measured payload with ~39% headroom.
//
// The size that forced this ceiling up has since been dealt with at its real
// cause — the ENCODING, not the model: v2 run-length-encodes sub-material pages
// and a pristine floor went 736 -> 125 MB. The cap stays at 1 GiB because it
// costs nothing and a heavily destroyed floor legitimately grows.
//
// Two tempting "fixes" were considered and REJECTED, recorded so they are not
// revived: (a) promoting common sub-voxel mixes to CellTypes — hardcodes a finite
// set of combinations into an infinite space and dies at the first chipped
// surface; (b) storing only the DELTA from a regenerated floor — makes the
// generator a permanent part of the save format, so any generator change silently
// decodes every existing save into a subtly different floor.
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
// `Container::opened` is a bool inside the ECS component ([container.h]), i.e. it is
// per-ENTITY — and an entity id is the one thing that is guaranteed NOT to be stable.
// The crates are destroyed and respawned on every floor entry
// ([main.cpp] refresh_floor_containers), and EnTT recycles handles, so an `entt::entity`
// written to disk names a different object on the next run, or nothing at all.
//
// So the key is what the GENERATOR is a function of: the floor number, plus the macro
// cell the crate stands in. `spawn_floor_containers` is deterministic in
// (floorNumber, seed) and places each crate at a wrapped macro cell, so the same crate
// reappears in the same cell every visit and the pair (floor, cell) reproduces.
//
// **The honest limitation, with the number:** the generator's own spawn index `i` would
// be a perfect key, and it is not recoverable — nothing stores it on the entity and
// `Container` has no room for it. The cell is therefore a key that can collide. Worked
// out for Residential, the densest case: stride 8 gives 16x16 = 256 rooms, each offering
// a 5x5 block of interior offsets (`ox`/`oy` in [2, 7), [container.cpp]), so 6,400
// candidate cells for `container_budget` = 256/6 = 42 draws. Expected colliding pairs
// C(42,2)/6400 = 0.135, i.e. **one collision on about 13% of Residential floors**. When
// it happens, opening one crate restores the other as opened too: a crate lost, never an
// item duplicated. The strong fix is one `std::uint16_t spawnIndex` on `Container`, set
// by `spawn_floor_containers`; that is an edit to `container.h`, which this lane does not
// own, so the cell key ships and the collision is measured rather than hidden.
//
// The floor is the signed FLOOR NUMBER, never a `LayerId` (a recycled storage slot,
// [floors.md]) and never `NpcPool::floor()`.
//
// **Corrected 2026-07-29:** the reason given here used to be that `NpcPool::floor()` is
// a `std::uint16_t` storing floor -50 as 65486. That is no longer true — the column is
// `std::int16_t` today ([npc_pool.h], widened with the demo stack's negative labels as
// the stated reason), so a negative label round-trips through it fine. The live reason
// is different and stronger: that column is written in exactly ONE place,
// `seed_floor_from_spec` ([population.cpp]), and read in NONE. Nothing updates it when
// the player travels — `ride_elevator` writes `pool.cz` and nothing else — so it names
// the floor a record was SEEDED on, not the floor its body is standing on. For the
// player those two diverge on the first elevator ride.
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
// One `floor_<N>.sav` per visited floor, in the app's save directory. Written when
// the player LEAVES a floor (a floor transition is a load screen, so disk I/O is
// sanctioned there, [jirnyak.md] §6) and on a manual save for the resident floor;
// stamped over the freshly generated geometry whenever that floor is built again —
// an elevator revisit and an F9 arrival are the same code path, and a floor whose
// file does not exist simply generates pristine. run.sav never carries geometry.
//
// Wire: u32 magic "GH2F" | u32 version | u32 blobBytes | u32 crc32(blob) | blob,
// where blob is exactly what snapshot_floor() produces (it embeds the floor number).
inline constexpr std::uint32_t kFloorMagic = 0x46324847u; // 'G','H','2','F'
// v2 (2026-08-06): sub-material PAGES are run-length encoded instead of raw.
// A page is 512 materials and almost never 512 distinct ones, so the raw form
// spent 1024 B on what usually needs a dozen. Nothing about the material model
// changed — a page may still hold any mix of atoms, it just encodes cheaply.
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
//
// `Needs` lives in the pool row rather than on the entity for a reason that matters
// here too: the elevator's `fold_back` -> `embody_as_player` DESTROYS the player's body
// and builds a new one ([embody.h]), so the clock is attached to the record, not to the
// body. On load there is no body yet at all, which is the same situation one step
// further — so the snapshot restores into `pool.needs(id)` / `pool.inventory(id)`, and
// embodiment happens afterwards and reads what is already there.
struct PlayerSnapshot {
    Needs clock{};              // the survival clock; canonical in the pool row
    Inventory inv{};            // 64 slots, 256 B
    std::int32_t hp = 0;        // also pool-row state, also unreproducible
    std::int32_t maxHp = 0;
    // The SIGNED floor the player stood on. Saved separately and explicitly because
    // there is no way to recover it from anything else: `NpcPool::floor()` is the
    // SEEDING label and is never updated by travel (see the correction above), and
    // `LayerId` is a recycled storage slot that means nothing across a restart.
    std::int32_t floorNumber = 0;
    // The macro cell within that floor, by the same truncate-and-wrap `macro_cell_of`
    // below performs. Written by the save side from the live `Transform`, consumed by
    // `place_body_at_cell` on the way back in — one convention, stated once.
    std::uint8_t cx = 0;
    std::uint8_t cy = 0;
    std::uint8_t cz = 0;
    std::uint8_t pad_ = 0;
};

// One run, complete. Assembled by the caller, because every piece of it lives somewhere
// different and this file must not go hunting for singletons — "the player is not
// special" ([AGENTS.md]) means there is no player global to hunt for.
struct SaveState {
    RunLedger ledger{};
    ContractBook book{};
    PlayerSnapshot player{};
    // Version 7: character sheet. Lives on the player entity at runtime
    // ([rpg.h]); captured into the run on F5 and stamped back on F9. Default is
    // a zeroed POD — main seeds a real sheet via fresh_rpg / embody.
    RpgStats rpg{};
    // Version 7: crafting bank + known-recipe bits + tier ([craft.h]). Run state
    // beside the ledger in main; craft_write/craft_read own the 93-byte codec.
    CraftingState craft{};
    // Version 8 / SAVMAG: chambered firearm + kill tally. hasRanged mirrors the
    // elevator's lazy-attach rule — do not invent PlayerRanged on a body that
    // never fired. kills is the cumulative melee tally (local `kills` in main).
    std::uint8_t hasRanged = 0;
    PlayerRanged ranged{};
    std::uint32_t kills = 0;
    // Version 9 / SAVSTAT: live status effects. Local `playerStatus` in main —
    // not an ECS component — so capture/restore is a direct assignment.
    StatusSet status{};
    // Version 10 / SAVCLOCK: the two run-scoped clocks. Both are locals in main and
    // both were previously re-armed from scratch on load — the samosbor automaton by
    // `samosbor_new_game` on the F9 path, the unlock set by never being written at
    // all. Defaults are the zeroed PODs, which is exactly "new run, nothing
    // discovered", so a SaveState built by hand still means something sane.
    SamosborState samosbor{};
    FastTravelState fastTravel{};
    // Every crate emptied anywhere in the building, not just on the live floor. Only the
    // resident floor's crates are live entities, so the ones from other floors exist
    // ONLY in this list — see `refresh_opened_containers`.
    std::vector<OpenedContainerKey> opened;
    // Version 2: quest log persisted across F5/F9. Written last by
    // quest_log_write; read back by quest_log_read. Exactly kQuestLogWire bytes.
    QuestLog quests{};
    // Version 6: the macro world. poolBlob is NpcPool::save_rows' verbatim table,
    // macroBlob is MacroSim::save_state, and factions is the LIVE relations
    // matrix (36 POD bytes). Restored at the earliest possible point — from the
    // MAIN MENU, before anything is embodied — so no body can hold a stale id.
    std::vector<std::uint8_t> poolBlob;
    std::vector<std::uint8_t> macroBlob;
    FactionRelations factions = kBaseFactionMatrix;
};

// ---------------------------------------------------------------------------
// The active-floor snapshot — state, not history
// ---------------------------------------------------------------------------
// Encode the World's entire grid into `out` (cleared first): floor number, cell
// types (RLE), mask occupancy as an empty/full/mixed RLE with raw 64-byte masks for
// the mixed cells only, and every "sub_material" page. A generated floor is
// overwhelmingly uniform, so a real floor encodes in single-digit MB where the raw
// arrays are 138 MB; a pathological floor degrades linearly and is bounded by
// kMaxSnapBytes. Returns the encoded size.
std::size_t snapshot_floor(const World& w, int floorNumber,
                           std::vector<std::uint8_t>& out);

// Stamp a snapshot back onto `w`, replacing types, masks and the sub-material field
// wholesale. Returns false — leaving `w` in its pre-call state for the types/masks
// it has not yet touched is NOT guaranteed on a malformed blob, so the caller should
// treat false as "regenerate and fall back to the carve log". `floorOut` (optional)
// receives the floor number the snapshot claims. Call BEFORE door_build, so the
// fresh DoorSet re-stamps its leaves over whatever door state the snapshot froze.
bool apply_floor_snapshot(World& w, const std::uint8_t* bytes, std::size_t n,
                          std::int32_t* floorOut = nullptr);

// Serialize. `out` is cleared first and ends up exactly `save_bytes_for(opened.size())`
// long. Cannot fail: there is no allocation to check and nothing to validate.
void save_write(const SaveState& st, std::vector<std::uint8_t>& out);

// Parse. Returns false and leaves `st` COMPLETELY untouched on any rejection — a
// half-applied load would be worse than no load, because it would put the game into a
// state no run has ever been in. `err` and `hdrOut` are optional; `hdrOut` is filled
// whenever the header itself parsed, even on rejection, so a caller can report
// "written by version 3, tick 120" for a save it just refused.
bool save_read(const std::uint8_t* bytes, std::size_t n, SaveState& st,
               SaveError* err = nullptr, SaveHeader* hdrOut = nullptr);

// ---------------------------------------------------------------------------
// Container state <-> registry
// ---------------------------------------------------------------------------

// Append a key for every OPENED crate resident on `layer`. Appends; does not clear.
std::size_t collect_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                     std::vector<OpenedContainerKey>& out);

// Bring `set` up to date for ONE floor: drop every key already recorded for
// `floorNumber`, then re-scan that floor from the registry. Returns the number of keys
// the floor now contributes.
//
// This is the function a save should call, and the reason is that only ONE floor is ever
// resident ([floor_stream.h] keeps a single World live). Every other floor's opened set
// exists nowhere but in `set`, so a plain append would duplicate the live floor's keys
// on every single save, and a plain clear would forget all nine other floors.
std::size_t refresh_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                      std::vector<OpenedContainerKey>& set);

// Re-open the crates on a freshly generated floor. Call it AFTER
// `spawn_floor_containers` has built the floor's crates; returns how many matched.
//
// Also empties what it opens. `loot_containers_step` only sets `opened` once a crate is
// actually empty ([container.cpp]), so an opened crate is an empty crate by
// construction, and leaving rolled contents inside a restored one would be a pile of
// items waiting for the first feature that looks inside a spent box.
//
// `openedColour` is optional and exists because the "spent crate" tint is
// `kOpenColour`, a file-static constant inside `container.cpp` — unreachable from here
// and NOT worth copying, since a copied colour drifts silently the day the original is
// retuned. Pass it from the call site, or pass nullptr and accept that a restored crate
// looks unopened until `container.h` hoists that constant into the header.
std::size_t apply_opened_containers(Registry& reg, LayerId layer, int floorNumber,
                                    const OpenedContainerKey* keys, std::size_t n,
                                    const vec3* openedColour = nullptr);

// ---------------------------------------------------------------------------
// Coming back to where you stood
// ---------------------------------------------------------------------------
// The format has carried `floorNumber` + cx/cy/cz since v1 and the game did nothing
// with either: a load restored the RUN and left the body standing where it already was,
// reporting "loaded N rub (saved on floor -26, you are on 0)". Everything below is what
// the app shell needs to close that gap, split into two halves that fail independently.
//
//   * TRAVEL — `travel_to_saved_floor` drives the EXISTING elevator path
//     (`FloorStreamer::travel`) once per labelled floor until it arrives. It is a
//     driver, not a second travel path: nothing here generates a floor, embodies a
//     crowd or touches a `LayerId`. That matters because the streamer's bookkeeping
//     (adopting the freshly-embodied player body into the destination module, then
//     `keep_only` folding the departed crowd back) is easy to get subtly wrong and
//     already correct in one place.
//   * PLACEMENT — `place_body_at_cell` puts the body in the saved cell, or in the
//     nearest cell it actually fits in, or refuses. See the soft-lock note there.
//
// **THE ORDERING CONSTRAINT, because it is not optional.** `nav::AsyncBake` hands a raw
// pointer to the live `MacroGrid` to a worker for a measured ~1.9 s + ~1.8 s and its
// contract is "do not mutate or regenerate that World until ready()" ([nav_async.h]).
// Travel regenerates floors, so the caller MUST NOT start a travelling load while a
// bake is in flight — check `nav.baking()` and retry next frame. This is not
// theoretical: `FloorStreamer::init(stack, keepRadius=0)` reserves exactly
// `2*0 + 2 = 2` recyclable layers, so hop 1 generates into the free slot (safe, the
// bake is reading the floor being left) and then frees the departed slot — which is
// the slot hop 2 allocates and regenerates, the very grid the worker is still reading.
// A single hop is safe; two are not. `AsyncBake::start()` joins, so re-arming the floor
// AFTER arrival is always safe; it is the hops in between that have no guard.
//
// Then the arrival sequence, in this order and for these reasons:
//   1. `refresh_floor_containers` — the destination floor has no crates until the app
//      spawns them, and they must exist before step 2 can re-open any.
//   2. `apply_opened_containers` — with the loaded key set.
//   3. `refresh_floor_mobs` — a streamed-in floor has no monsters either.
//   4. `door_build` — AFTER generation, BEFORE the bake, because it leaves every door
//      Open so the grid the worker reads is the all-open geometry the bake must assume
//      ([door.h]). Note `door_build` clears `DoorSet::frozen` itself, so the freeze has
//      to be re-applied after it, never before.
//   5. `doors.frozen = true`, then `begin_floor_nav`.
//   6. placement — last, and independent of all of the above: it reads solidity and
//      writes one `Transform`. Doing it before `door_build` would still be correct
//      today (door frames are recolours, not solidity changes) but would silently stop
//      being correct the day a door is built Shut.

// The arrival storey an elevator ride drops the player on: the geometry module's
// ground standing cell (air with a solid floor below — [floor_gen.h]
// floor_ground_z; floor_gen.cpp static_asserts the two stay equal). Named here
// because `main.cpp` passes it at both of its travel sites and a load is the
// third — three spellings of one number is how it drifts.
inline constexpr std::uint8_t kArrivalCoord = 3;

// Hop ceiling for the loop below. Equal to FloorRegistry's kFloorSlots (255 labels), so
// even a pathological stack cannot spin: every hop crosses at least one label and no
// label is visited twice. `save.cpp` static_asserts this against the real constant.
inline constexpr int kMaxLoadHops = 255;

// Where driving the elevator to a saved floor ended up.
//
// `moved` and `arrived` are separate on purpose, and the caller must honour the
// difference: a load that crossed three floors and then hit the end of the stack has
// `moved == true, arrived == false`, and the floor it is standing on still needs its
// crates, its monsters, its doors and its nav bake — an intermediate hop gets none of
// those. Treating "did not arrive" as "nothing happened" would leave the player on a
// live floor with no monsters and no navigation.
struct LoadTravel {
    int floor = 0;                // where the player actually ended up
    Entity player = entt::null;   // the CURRENT player entity: a ride rebuilds the body
    LayerId layer = kInvalidLayer;
    std::uint8_t hops = 0;        // labelled floors crossed
    bool moved = false;           // the floor changed, so the caller must re-arm it
    bool arrived = false;         // ...and it is the floor the save named
};

// Ride from `fromFloor` to `targetFloor`, one labelled floor per hop, through
// `FloorStreamer::travel`. No-op (arrived, zero hops) when already there.
//
// Refuses without touching anything when `targetFloor` maps to no registered module —
// a save from a build whose stack had a floor this one does not — and when `player`
// carries no `NpcRef`. That second guard is not paranoia: `travel` forwards the player's
// record id to `ensure_loaded`, and with `kInvalidNpc` that call DESIGNATES A NEW PLAYER
// on the destination floor, i.e. a second camera holder.
//
// Rides one labelled floor at a time rather than jumping, because `next_labelled_floor`
// is what makes a sparse stack legal ({0,1,2,-8,-26,-50,14,30} is a valid building) and
// the destination of a ride has to be a floor the streamer has actually loaded.
LoadTravel travel_to_saved_floor(LevelStack& stack, FloorRegistry& reg, Registry& ecs,
                                 NpcPool& pool, FloorStreamer& streamer, Entity player,
                                 int fromFloor, int targetFloor,
                                 std::uint8_t arrivalCoord = kArrivalCoord);

// ---------------------------------------------------------------------------
// Placement — a body in solid geometry never moves again
// ---------------------------------------------------------------------------
// `physics_step` resolves a swept AABB by backing out of the overlap, so a body that is
// ALREADY inside solid has nowhere to back out to: `sweep_axis` binary-searches to zero
// on all three axes and zeroes all three velocity components, every tick, forever. Fly
// mode does not help — `controller_step` writes velocity and physics still collides
// ([controller.cpp], [physics.cpp]). This is the same failure `door_set` refuses to
// cause when it will not shut a door on a body ([door.h]), and it is a soft-lock rather
// than a squeeze: nothing in the tree can free the player again.
//
// **The saved cell is not the dangerous case, and this is worth being exact about.**
// `generate_floor` is a pure function of (seed, number, kind) and clears to air first,
// so the same build rebuilds the floor bit-for-bit and a cell the player stood in comes
// back air. What is dangerous is the ARRIVAL cell of an elevator ride, which is
// `(cx, cy)` from the floor you LEFT and `z = kArrivalCoord`: the wall lattices of two floor
// kinds do not align (strides 8 / 16 / 32), so the arrival column is frequently inside
// a full-height wall. Counted from the generator's own table for the densest case,
// Residential: 128^2 - 112^2 = 3840 of 16384 columns (23.4%) sit on a wall line, and at
// cell z=2 the generator carves back only the 512 doorway columns and ~208 lattice-lobby
// columns while ADDING 64 elevator posts — so on the order of 3200 columns, about ONE
// ARRIVAL IN FIVE, is solid. Both of `main.cpp`'s travel sites can already do this
// today; the load path is simply the third caller that must not.
//
// The other live case is a save written by an EARLIER build: geometry is not
// fingerprinted (only the item and mob tables are), so retuning a `kGeom` row or a seed
// constant moves walls under a valid save. That one no purity argument covers.

// Search radius, in macro cells, when the requested cell is unusable. 8 cells = 16 m is
// one Residential room pitch ([floor_gen.cpp] stride 8), i.e. "somewhere in this room or
// the next one" rather than "somewhere on this floor". Bounded because an unbounded
// search would happily relocate the player across the building, and being wrong about
// WHERE you woke up is worse than being told the load could not place you.
inline constexpr int kPlaceRadius = 8;

// Hard ceiling on the radius a caller may ask for. (2*24+1)^3 = 117,649 candidate cells
// is already 24x the default's 4,913; past that the "nearest" cell stops being anywhere
// near you and the cost stops being free.
inline constexpr int kPlaceRadiusMax = 24;

// Where a body may actually stand, and how far that is from where it was asked to.
struct PlacedCell {
    std::uint8_t cx = 0;
    std::uint8_t cy = 0;
    std::uint8_t cz = 0;
    std::uint8_t rings = 0;   // Chebyshev distance in cells from the requested cell
    bool ok = false;          // false: no cell in the neighbourhood fits a body at all
    bool moved = false;       // the requested cell was solid; this is a substitute
    bool supported = false;   // something solid under the feet (see below)
};

// The macro cell a body at `pos` occupies: truncate, then wrap. `pos` is expected to be
// already normalized into [0, kWorldExtent) — `physics_step` does that every step — so
// the truncation never sees a negative. Shared by `container_key` and by the save side's
// `PlayerSnapshot`, which is the point: two spellings of this would put a restored body
// one cell from where it was saved.
void macro_cell_of(const vec3& pos, std::uint8_t& cx, std::uint8_t& cy,
                   std::uint8_t& cz);

// The world-space centre of a macro cell — exactly where `embody` places a body standing
// in it ([embody.cpp]), so a placed body and an embodied one are in the same place.
vec3 macro_cell_centre(std::uint8_t cx, std::uint8_t cy, std::uint8_t cz);

// The nearest cell a body of half-extents `half` fits in, starting at (cx, cy, cz).
//
// Three outcomes, and the third is the one the caller must not ignore:
//
//   1. the requested cell fits -> it is returned unchanged (`rings == 0`,
//      `moved == false`). Support is REPORTED but not required here: a player who saved
//      mid-jump or in fly mode was legitimately in mid-air, and relocating them to the
//      nearest floor would be a 16 m teleport to fix a non-problem. Physics simply drops
//      them, which is what would have happened anyway.
//   2. it does not fit -> the nearest cell that does, preferring one with a floor under
//      it, is returned with `moved == true`. Ties break on the smallest ring, then the
//      smallest vertical displacement (crossing a storey is a longer walk back than
//      stepping sideways — a Residential storey is 4 cells), then the smallest planar
//      distance. Deterministic, so two runs of the same load place you identically.
//   3. NOTHING in the neighbourhood fits -> `ok == false` and the requested cell is
//      returned UNCHANGED. That is deliberate: there is no safe cell to invent, so the
//      helper reports failure loudly instead of handing back a cell inside a wall that
//      a caller would then teleport a body into. A caller that ignores `ok` reproduces
//      the exact soft-lock this function exists to prevent, which is why the returned
//      cell is the input rather than a plausible-looking substitute.
//
// "Fits" is `aabb_overlaps_solid` at the cell centre — the SAME predicate `physics_step`
// resolves against, not a cheaper cell-type or mask-is-full test. That is what makes the
// answer exact for any stature: the seeder's tallest adult is 1.87 m in a 2 m cell
// ([population.cpp] height_for_age, 1750 +- 120 mm), which fits inside one cell with
// 6.5 cm to spare, but the clamp allows 2.2 m and a mask test would quietly get that
// body wrong. "Supported" is the same predicate on a one-voxel-thick slab directly under
// the feet, which is why a cell over a collapsed Derelict slab (12% of them are missing)
// is passed over in favour of one with a floor.
PlacedCell find_standable_cell(const World& world, const vec3& half, std::uint8_t cx,
                               std::uint8_t cy, std::uint8_t cz,
                               int radius = kPlaceRadius);

// Move `body` to (cx, cy, cz) or to the nearest cell it fits in, and stop it dead.
//
// On failure (`!ok`) the body is NOT moved at all — the caller keeps a body wherever it
// already was, which may be wrong but is at least somewhere physics has already
// accepted. Uses the body's own `AABB`, falling back to the 0.4 m cube `physics_step`
// itself assumes for an entity without one, so the test can never be more permissive
// than the solver.
//
// Zeroing `Velocity` is not tidiness: a load can land while the body is falling, and
// physics resolves the next step from the NEW position — a carried-over 30 m/s would
// drive it straight through the floor it was just placed on. Nothing else is written:
// `fold_back` re-derives the cold row's cell from this transform ([embody.cpp]) and the
// save side reads the transform too, so the pool row cannot drift from the body.
PlacedCell place_body_at_cell(Registry& reg, const World& world, Entity body,
                              std::uint8_t cx, std::uint8_t cy, std::uint8_t cz,
                              int radius = kPlaceRadius);

// Same, for a body that is already somewhere: resolve the cell it is standing in. This
// is what an elevator arrival needs — `ride_elevator` keeps x/y from the floor you left
// and sets z = arrivalCoord, which is the ~1-in-5 wall case measured above.
PlacedCell place_body_safely(Registry& reg, const World& world, Entity body,
                             int radius = kPlaceRadius);

// Write the snapshot's unreproducible state back into a pool row.
//
// The ROW, not the body, and that is the whole reason this is one call: `needs_step`
// reads the clock from the row rather than from the entity precisely so it survives the
// body swap an elevator ride performs ([needs.h]), and hp/inventory are canonical there
// too ([embody.h]). So it does not matter whether the body has been rebuilt yet — nothing
// this writes is read by `embody`, which only reads stature, and stature is not in the
// save.
//
// **What the caller must do after it: `sync_armour(reg, pool, player)`.** The restored
// inventory changes what the body is wearing, and `Armour` is a component copied off the
// equipped item — `combat.h` says in as many words "call after anything that changes the
// inventory". A load is the largest inventory change there is, and the load path did not
// do this before, so a restored run kept the vest it was wearing at the moment of the
// keypress.
//
// `maxHp` is restored only when the save carries a positive one. A v1 save written by a
// live player always does, but a default-constructed `SaveState` carries 0, and writing
// 0 into the row would make `entity_health` report 0/0 and every heal a no-op — worse
// than leaving the record's own maximum alone. Both values are clamped into the row's
// `std::int16_t`, which is narrower than the wire's `std::int32_t`.
void apply_player_snapshot(NpcPool& pool, NpcId id, const PlayerSnapshot& snap);

} // namespace giga::game
