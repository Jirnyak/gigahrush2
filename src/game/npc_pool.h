// Macro NPC pool — the whole living population of the world in one flat,
// data-oriented table (SoA). This is the *global* model of who exists where
// across the floor stack; individual NPCs are later *embodied* into ECS
// entities only where they matter ([npcs.md]).
//
// Design decisions (see the design form in project history):
//   * Fixed capacity = 2^20 = 1,048,576 slots. A power of two so an id can be
//     masked/indexed without a divide, and so the table is a fixed rectangle
//     that serializes verbatim with the world.
//   * The id IS the slot index — stable for the NPC's whole life. Lookup by id
//     is O(1), the arrays are dense and cache-friendly.
//   * Slots are bump-allocated. ~950k are populated at world start; the tail is
//     a RESERVE plast of blanks used for runtime spawns / replacements.
//   * The dead are never reclaimed — a killed NPC keeps its slot (its ALIVE bit
//     is cleared) and stays in the table. New NPCs always come from the reserve.
//   * Both procedural and authored ("design") NPCs share this one linear store,
//     distinguished only by a flag bit, never by living in different arrays.
//
// Mobs are deliberately NOT here: they don't exist in the macro model, they are
// spawned per-floor from the mob table and vanish ([monsters.md]).
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "game/inventory.h"

namespace giga::game {

inline constexpr std::uint32_t kNpcPoolBits = 20;
inline constexpr std::uint32_t kNpcPoolSize = 1u << kNpcPoolBits; // 1,048,576
inline constexpr std::uint32_t kNpcIdMask = kNpcPoolSize - 1;

// ~950k active at world start; the remaining ~98k slots are the reserve plast.
inline constexpr std::uint32_t kNpcActiveTarget = 950000;

// A stable NPC handle == its index into the pool. Never reused once allocated.
using NpcId = std::uint32_t;
inline constexpr NpcId kInvalidNpc = 0xFFFFFFFFu;

// Sentinel floor label meaning "not currently on any floor": a record between
// spawn() and its first set_floor(), or a killed one. Never a real floor number,
// so it indexes no bucket in the per-floor index below.
inline constexpr std::uint16_t kNoFloorLabel = 0xFFFFu;

inline constexpr int kNameLen = 24;   // inline fixed-width, no heap strings
inline constexpr int kRelSlots = 16;  // fixed relationship capacity per NPC

// Character-sheet attributes. Deliberately GENERIC: a fixed block of byte-valued
// slots addressed by index, NOT named str/agi/int columns. The game is a
// prototype — attribute *names*, perks and traits are not finalized, so we bake
// a stable-width skeleton and let a data table map slot->meaning later, instead
// of hardcoding a schema we'd have to migrate. 8 slots for now; perks/traits get
// their own extensible block when the character sheet is designed ([npcs.md]).
inline constexpr int kAttrSlots = 8;

// One relationship edge: who, and how the NPC feels about them. Fixed-size so
// the whole per-NPC relation set is a flat 16-wide scan, O(1) to walk.
struct Relationship {
    NpcId target = kInvalidNpc;
    std::int16_t affinity = 0;  // signed valence, -32768..32767
    std::uint16_t pad = 0;
};

// Per-NPC flag bits packed into one byte.
enum NpcFlag : std::uint8_t {
    NpcAlive    = 1u << 0,  // not dead (dead slots stay in the table)
    NpcEmbodied = 1u << 1,  // currently instantiated as an ECS entity
    NpcDesign   = 1u << 2,  // authored NPC (vs procedurally generated)
    NpcPlayer   = 1u << 3,  // the record the camera+controller are attached to.
                            // Just a bit on an ordinary record — there is NO
                            // player singleton; the "player" is whichever alife
                            // record is currently embodied with a CameraTag.
};

// Sex code stored in the sex column. 0 = unset so a zeroed reserve slot reads
// as "not initialized", matching the reference's compact demographic model.
enum NpcSex : std::uint8_t { SexUnset = 0, SexMale = 1, SexFemale = 2 };

// SoA population table. One std::vector per field, all sized to kNpcPoolSize at
// init() and never resized again — dense over sparse ([performance.md]).
class NpcPool {
public:
    // Allocate all backing arrays (one time). ~0.45 GB for the full table.
    void init();

    // Bump-allocate the next blank slot from the reserve. Returns kInvalidNpc if
    // the pool is exhausted. The new NPC is marked ALIVE, everything else zeroed.
    NpcId spawn();

    // Mark an NPC dead. The slot is NOT reclaimed; the id stays valid forever.
    void kill(NpcId id);

    bool valid(NpcId id) const { return id < count_; }
    bool alive(NpcId id) const { return flags_[id] & NpcAlive; }
    bool embodied(NpcId id) const { return flags_[id] & NpcEmbodied; }
    bool is_player(NpcId id) const { return flags_[id] & NpcPlayer; }

    void set_embodied(NpcId id, bool on) {
        if (on) flags_[id] |= NpcEmbodied;
        else    flags_[id] &= static_cast<std::uint8_t>(~NpcEmbodied);
    }
    void set_design(NpcId id, bool on) {
        if (on) flags_[id] |= NpcDesign;
        else    flags_[id] &= static_cast<std::uint8_t>(~NpcDesign);
    }
    void set_player(NpcId id, bool on) {
        if (on) flags_[id] |= NpcPlayer;
        else    flags_[id] &= static_cast<std::uint8_t>(~NpcPlayer);
    }

    // Copy a name/surname into the fixed-width inline field, truncating and
    // null-terminating as needed.
    void set_name(NpcId id, const char* first, const char* last);

    // High-water mark of allocated slots (active + dead, excludes untouched
    // reserve). Also the exclusive upper bound of every valid id.
    std::uint32_t count() const { return count_; }
    std::uint32_t capacity() const { return kNpcPoolSize; }
    std::uint32_t reserve_remaining() const { return kNpcPoolSize - count_; }

    // Field accessors (SoA rows). Callers index by NpcId.
    std::uint8_t&  flags(NpcId id)   { return flags_[id]; }
    std::uint16_t& faction(NpcId id) { return faction_[id]; }
    std::int16_t&  hp(NpcId id)      { return hp_[id]; }
    std::int16_t&  max_hp(NpcId id)  { return maxHp_[id]; }
    std::uint8_t&  cx(NpcId id)      { return cx_[id]; }
    std::uint8_t&  cy(NpcId id)      { return cy_[id]; }
    std::uint8_t&  cz(NpcId id)      { return cz_[id]; }

    // Floor LABEL (logical, not a storage slot — floors.md). READ with floor();
    // WRITE with set_floor(), which also maintains the per-floor bucket index so a
    // migration (a change of label) is visible to whoever enumerates a floor's
    // residents. Direct assignment is intentionally not offered — it would desync
    // the index.
    std::uint16_t floor(NpcId id) const { return floor_[id]; }
    void set_floor(NpcId id, std::uint16_t label);

    // Live roster of a floor: the ids CURRENTLY labelled `label`, alive only
    // (spawn/kill/set_floor keep it tight). This is what floor streaming embodies
    // when a floor loads ([floors.md]); a floor nobody is on returns a stable
    // shared empty vector. Order is unspecified — swap-remove churns it — so
    // callers must treat it as a set, not a sequence.
    const std::vector<NpcId>& floor_bucket(std::uint16_t label) const;

    // Character-sheet fields (same struct the future creation screen writes to).
    std::uint8_t&  age(NpcId id)     { return age_[id]; }      // years, 1..100
    std::uint8_t&  sex(NpcId id)     { return sex_[id]; }      // NpcSex code
    std::uint16_t& height_mm(NpcId id) { return heightMm_[id]; } // stature, mm
    std::uint8_t&  level(NpcId id)   { return level_[id]; }
    // The 8-slot generic attribute block. Addressed by index; slot->name mapping
    // lives in a data table, not here (see kAttrSlots).
    std::array<std::uint8_t, kAttrSlots>& attrs(NpcId id) { return attr_[id]; }

    Inventory&     inventory(NpcId id) { return inv_[id]; }
    std::array<Relationship, kRelSlots>& relations(NpcId id) { return rel_[id]; }
    const std::array<char, kNameLen>& name(NpcId id) const { return name_[id]; }
    const std::array<char, kNameLen>& surname(NpcId id) const {
        return surname_[id];
    }

private:
    std::uint32_t count_ = 0;  // bump pointer / high-water mark

    // Parallel SoA arrays, each kNpcPoolSize long after init().
    std::vector<std::uint8_t>  flags_;
    std::vector<std::uint16_t> faction_;
    std::vector<std::int16_t>  hp_;
    std::vector<std::int16_t>  maxHp_;
    std::vector<std::uint16_t> floor_;  // logical floor label ([floors.md])
    std::vector<std::uint8_t>  cx_, cy_, cz_;  // macro cell within the floor
    std::vector<std::uint8_t>  age_;    // years, 1..100
    std::vector<std::uint8_t>  sex_;    // NpcSex code (0 = unset)
    std::vector<std::uint16_t> heightMm_; // stature in mm; drives embodied AABB
    std::vector<std::uint8_t>  level_;
    std::vector<std::array<std::uint8_t, kAttrSlots>> attr_; // generic sheet block
    std::vector<std::array<char, kNameLen>> name_;
    std::vector<std::array<char, kNameLen>> surname_;
    std::vector<std::array<Relationship, kRelSlots>> rel_;
    std::vector<Inventory> inv_;

    // Per-floor inverted index over floor_: floorBuckets_[label] is the live
    // roster of ids on floor `label`; slotInBucket_[id] is id's position inside
    // its bucket, so set_floor()/kill() splice in O(1) via swap-remove — never the
    // reference's linear bucket scan on a cold move ([macrosim.md] hot spot). This
    // is DERIVED state (rebuildable from floor_ + the alive bit), so it is not part
    // of the serialized rectangle; init() clears it, spawn/set_floor/kill keep it.
    std::vector<std::vector<NpcId>> floorBuckets_;
    std::vector<std::uint32_t> slotInBucket_;
};

} // namespace giga::game
