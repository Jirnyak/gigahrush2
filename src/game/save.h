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
//     spec.kind) and clears to air first ([floor_gen.cpp]), and there is zero runtime
//     voxel mutation in the whole tree — every `set_cell`/`fill_cell`/`clear_cell`
//     caller lives in `floor_gen.cpp` or `app/worldgen.cpp`. A floor is reproducible
//     from three numbers, so saving 2 MB of cells per floor would be saving a cache.
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
#include "game/inventory.h"   // Inventory
#include "game/npc_pool.h"    // Needs
#include "world/level_stack.h"

namespace giga::game {

// On-disk bytes spell "GH2S". Written little-endian byte by byte, so the four
// leading bytes of a save file are readable in a hex dump on any host.
inline constexpr std::uint32_t kSaveMagic = 0x53324847u;

// Bump this whenever the wire layout changes in ANY way — a field added, a field
// reordered, a meaning changed. `save_read` refuses a version it does not recognise
// rather than guessing, because the alternative is the failure this whole file exists
// to prevent: a load that succeeds and is wrong.
inline constexpr std::uint32_t kSaveVersion = 1u;

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
    std::uint32_t magic = 0;            //  0
    std::uint32_t version = 0;          //  4
    std::uint32_t tickHz = 0;           //  8  giga::kSimHz at write time; advisory
    std::uint32_t itemCount = 0;        // 12  kItemCount        (weak)
    std::uint32_t mobKindCount = 0;     // 16  kMobKindCount     (weak)
    std::uint32_t itemFingerprint = 0;  // 20  item name hash    (strong)
    std::uint32_t mobFingerprint = 0;   // 24  mob name hash     (strong)
    std::uint32_t openedCount = 0;      // 28  OpenedContainerKey records that follow
    std::uint16_t ledgerBytes = 0;      // 32  sizeof(RunLedger) in the writing build
    std::uint16_t bookBytes = 0;        // 34  sizeof(ContractBook)
    std::uint16_t needsBytes = 0;       // 36  sizeof(Needs)
    std::uint16_t invBytes = 0;         // 38  sizeof(Inventory)
    std::uint32_t payloadBytes = 0;     // 40
    std::uint32_t payloadCrc = 0;       // 44  CRC-32 of every byte after the header
};

// Wire sizes. These are the ON-DISK footprints, which are deliberately NOT the
// `sizeof`s: every field is written individually in little-endian order, so no padding
// byte and no host byte order ever reaches the file. That is what keeps a save written
// by the MSVC build readable by the Clang build and vice versa, and it is why the
// `*Bytes` header fields above are a drift ALARM rather than a layout description.
inline constexpr std::size_t kSaveHeaderWire = 48;   // 8 x u32 + 4 x u16 + 2 x u32
inline constexpr std::size_t kLedgerWire = 33;       // 2x8 + 4x4 + 1
inline constexpr std::size_t kContractWire = 21;     // 4 + 2 + 3x4 + 3   (pad_ dropped)
inline constexpr std::size_t kBookWire =
    static_cast<std::size_t>(kMaxContracts) * kContractWire + 4 + 4 + 8;
inline constexpr std::size_t kNeedsWire = 33;        // 8 floats + seeded
inline constexpr std::size_t kInventoryWire = static_cast<std::size_t>(kInvSlots) * 4;
inline constexpr std::size_t kPlayerWire = kNeedsWire + kInventoryWire + 4 + 4 + 4 + 3;
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
inline constexpr std::size_t kSaveFixedWire = kLedgerWire + kBookWire + kPlayerWire;

// Sanity ceiling on the opened-container list, so a corrupt header cannot ask for a
// huge allocation before the checksum has had a chance to reject it. 64 crates per
// floor ([main.cpp] refresh_floor_containers cap) x 255 floor labels is 16,320; this
// is four times that.
inline constexpr std::uint32_t kMaxOpenedKeys = 65536u;

// Exact byte count `save_write` will produce for `openedCount` opened crates.
inline constexpr std::size_t save_bytes_for(std::size_t openedCount) {
    return kSaveHeaderWire + kSaveFixedWire + openedCount * kOpenedKeyWire;
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
// [floors.md]) and never `NpcPool::floor()` — that column is a `std::uint16_t` and
// stores floor -50 as 65486, so it cannot round-trip a negative label at all.
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
    // there is no way to recover it from anything else in the pool: `NpcPool::floor()`
    // is unsigned, and `LayerId` is a storage slot that means nothing across a restart.
    std::int32_t floorNumber = 0;
    std::uint8_t cx = 0;        // macro cell within that floor
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
    // Every crate emptied anywhere in the building, not just on the live floor. Only the
    // resident floor's crates are live entities, so the ones from other floors exist
    // ONLY in this list — see `refresh_opened_containers`.
    std::vector<OpenedContainerKey> opened;
};

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

} // namespace giga::game
