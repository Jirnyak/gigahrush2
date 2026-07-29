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
//   * Columns are allocated by DEMAND, not uniformly. The ROW LAYOUT below is
//     unchanged — every field is still 1 fixed-width column, still indexed by id —
//     but *when* a column gets its memory now depends on who touches it. See
//     "Column allocation policy" further down; that comment carries the measured
//     numbers and is the justification for the whole scheme.
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
//
// This is a DESIGN TARGET, not a measurement: the demo floor stack in main.cpp seeds
// 1,930 records across all ten floors (420+260+150+40+150+40+150+40+260+420) and 420
// at startup, because only floor 0 loads. The static_assert is what stops the target
// from being a claim the code never checks — if the target is ever raised past the
// capacity the reserve plast the whole "dead are never reclaimed" policy depends on
// would be empty, and spawn() would start returning kInvalidNpc at world start.
inline constexpr std::uint32_t kNpcActiveTarget = 950000;
static_assert(kNpcActiveTarget < kNpcPoolSize,
              "the reserve plast must be non-empty: the pool never reclaims a dead "
              "slot, so every runtime spawn comes from kNpcPoolSize - "
              "kNpcActiveTarget ([npcs.md])");

// A stable NPC handle == its index into the pool. Never reused once allocated.
using NpcId = std::uint32_t;
inline constexpr NpcId kInvalidNpc = 0xFFFFFFFFu;

// Sentinel floor label meaning "not currently on any floor": a record between
// spawn() and its first set_floor(), or a killed one. Never a real floor number,
// so it indexes no bucket in the per-floor index below.
// "on no floor": a spawned-but-unplaced record, or a corpse. INT16_MIN and not the
// branch 0xFFFF, because labels are SIGNED and 0xFFFF read back as int16 is -1 --
// which is a LEGAL floor (FloorRegistry allows -127..127). A sentinel that collides
// with real data is not a sentinel.
inline constexpr std::int16_t kNoFloorLabel = -32768;

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
// 8 B x kRelSlots = 128 B/row is the single widest column in the table — 128 MiB at
// full capacity, more than a quarter of the whole row. Every footprint number in
// "Column allocation policy" below is derived from this width, so pin it.
static_assert(sizeof(Relationship) == 8, "Relationship must stay a tight 8-byte edge");
static_assert(alignof(Relationship) == 4);

// The per-body survival clock — food/water/sleep and the two pressures. Lives in
// the pool row for the same reason hp does: an elevator ride DESTROYS the
// player's body and builds a new one (`fold_back` -> `embody_as_player`,
// [embody.h]), so an ECS component would silently reset the clock on every floor
// change — turning the trip clock into a floor clock, which is the opposite of
// what it is for. Ticking is a separate question from storage and the answer is
// different: only the camera holder's row advances ([needs.h]).
//
// A zeroed reserve slot reads as `seeded == 0`, i.e. "never rolled", NOT as a
// body that is starving and dehydrated — which is what the all-zero default would
// otherwise mean. `needs_step` rolls it lazily on first use.
struct Needs {
    float food = 0.0f;        // 0..100 reserve, drains; 0 = starving
    float water = 0.0f;       // 0..100 reserve, drains; 0 = dehydrated
    float sleep = 0.0f;       // 0..100 reserve, drains; costs speed, never hp
    float pee = 0.0f;         // 0..100 pressure, fills; 100 = overflowing
    float poo = 0.0f;         // 0..100 pressure, fills; 100 = overflowing
    float pendingPee = 0.0f;  // drunk/eaten but not yet digested into `pee`
    float pendingPoo = 0.0f;  // ditto for `poo`
    float hpDebt = 0.0f;      // sub-1-HP attrition carried between ticks
    std::uint8_t seeded = 0;  // 0 = never rolled (see above)
    std::uint8_t pad_[3] = {};
};
static_assert(sizeof(Needs) == 36, "Needs must stay a tight 36-byte row");
static_assert(alignof(Needs) == 4);

// Semantics of Relationship::affinity — the per-NPC social graph ([macrosim.md]
// #10d-ii), which the macro social pass grows and the embodied utility-AI
// ([ai.md] #12) reads. Ported from the reference's demos social store: a signed
// valence clamped to [-127,127], classified hostile at or below -64 and friendly
// at or above 64. This is a SEPARATE store from the faction matrix (faction.h),
// which has its own narrower ±50 thresholds — do not conflate the two. There is
// no affinity sentinel: an empty edge is `target == kInvalidNpc`, so -128 is free.
inline constexpr std::int16_t kRelAffinityMin = -127;
inline constexpr std::int16_t kRelAffinityMax =  127;
inline constexpr std::int16_t kRelHostile     =  -64;
inline constexpr std::int16_t kRelFriendly    =   64;

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

// ---------------------------------------------------------------------------
// Column allocation policy
//
// init() used to `assign(kNpcPoolSize, ...)` all 18 SoA columns. assign WRITES every
// byte, so the table was not merely *committed*, it was fully RESIDENT — 493 B/row x
// 2^20 = 493.0 MiB touched before the first floor is even generated. (Because the
// capacity is exactly 2^20, 1 B/row == 1.0 MiB of table; every figure below is just
// the row width.)
//
// Measured row widths: inv_ 256, rel_ 128, needs_ 36, name_ 24, surname_ 24, attr_ 8,
// faction_/hp_/maxHp_/floor_/heightMm_ 2 each, flags_/cx_/cy_/cz_/age_/sex_/level_ 1
// each = 493 B. Of that, 187 B/row = 187.0 MiB belonged to columns with NO reader
// anywhere in src/: rel_ 128 (no reader at all — Relationship is written nowhere),
// name_ + surname_ 48 (set_name has no caller in src/), and attr_/age_/sex_/level_ 11
// (written by seed_floor_from_spec, read by nothing).
//
// Three policies, chosen per column by who actually touches it:
//
//   EAGER  — flags_, faction_, hp_, maxHp_, floor_, cx_/cy_/cz_, heightMm_, inv_,
//            needs_. Read on live paths (combat, loot, needs, embody, wander), so
//            they keep the old "sized once at init(), never resized" contract and a
//            reference into them is stable for the pool's whole life. 306 B/row =
//            306.0 MiB.
//   LIVE   — age_, sex_, level_, attr_. Written for every seeded record by
//            seed_floor_from_spec, so they track count_ and are grown inside
//            spawn(). 11 B/row: the demo stack's 1,930 records need 21.2 KB of rows
//            and allocate 44.0 KiB (11 B x the kNpcLazyChunk floor of 4096) instead
//            of 11.0 MiB. They still reach 11.0 MiB at the 950k target.
//   DEMAND — rel_, name_, surname_. Zero cost until something actually calls
//            relations() / set_name(); the shipping game never does, so it pays 0 B
//            for all three (176 B/row = 176.0 MiB saved outright). On first touch
//            the column materializes and then JOINS the LIVE set, so relations()
//            itself never resizes afterwards.
//
// New resident footprint after init(): 306.0 MiB (was 493.0 MiB), and the demo stack
// adds 44.0 KiB of LIVE columns rather than 11.0 MiB. resident_bytes() reports the
// live figure so this is checkable at runtime, not only on paper. 256 of the
// remaining 306 B/row is inv_, which stays EAGER because loot / containers / vendor /
// needs all read it — it is the obvious next 256.0 MiB, not this lane's.
//
// Reference-lifetime rule, unchanged in spirit but worth stating: a reference handed
// out by attrs() / relations() / level() is invalidated by a later spawn(), because
// spawn() is the ONLY place a LIVE column resizes. Nothing may hold one across a
// spawn — the existing pattern (`auto& a = pool.attrs(id);` then write, per seeded
// record) is safe because it never does.
//
// Verbatim serialization ([npcs.md] "the tables serialize verbatim") is not yet
// implemented anywhere in src/ — there is no save/load path. When one lands it must
// either materialize the DEMAND/LIVE columns to kNpcPoolSize first or write each
// column's row count into the header; dumping a short column as if it were full is
// the one way this change can bite.
// ---------------------------------------------------------------------------

// Growth floor for a lazily-sized column. 4096 rows costs 512 KB for rel_ (the
// widest) and covers ~10x the demo stack's startup crowd of 420, so a normal session
// resizes exactly once. Growth is geometric above this: a fixed-chunk resize() copies
// the whole column at every boundary, which at the 950k target would be 232 copies of
// rel_ averaging 62 MiB each (~14 GB of memcpy) because vector::resize allocates for
// the size asked for, not a geometric step past it.
inline constexpr std::uint32_t kNpcLazyChunk = 4096;

// Returned by name() / surname() while the identity columns are still unallocated, so
// a caller reads an empty string instead of indexing an empty vector. Const accessors
// cannot materialize a column, and silently returning row 0 would be worse than blank.
inline constexpr std::array<char, kNameLen> kBlankName{};

// SoA population table. One std::vector per field; the EAGER columns are sized to
// kNpcPoolSize at init() and never resized again, the LIVE/DEMAND columns grow as
// described above — dense over sparse either way ([performance.md]).
class NpcPool {
public:
    // Allocate the EAGER backing arrays (one time): 306 B/row x 2^20 = 306.0 MiB.
    // The LIVE and DEMAND columns start empty and are grown by spawn() / first touch
    // ("Column allocation policy" above), which is where the other 187.0 MiB went.
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
    // Slots ever handed out. This is a HIGH-WATER MARK and can never decrease —
    // the pool deliberately never reclaims ([npcs.md]) — so it is the wrong number
    // to show a player as a population. Use alive() for that.
    std::uint32_t count() const { return count_; }

    // Records currently alive. Maintained in spawn()/kill() rather than counted,
    // because a scan of 2^20 flag bytes per HUD frame is not free and the answer is
    // exact either way.
    std::uint32_t alive() const { return alive_; }
    std::uint32_t capacity() const { return kNpcPoolSize; }
    std::uint32_t reserve_remaining() const { return kNpcPoolSize - count_; }

    // Bytes the SoA columns currently hold, summed over vector capacities. Exists so
    // the allocation policy above is a measurement rather than a comment: 306.0 MiB
    // right after init(), and it only moves when a LIVE/DEMAND column grows.
    std::size_t resident_bytes() const;

    // Field accessors (SoA rows). Callers index by NpcId — an id from spawn(), i.e.
    // id < count(). That was already the contract (nothing bounds-checks) and the
    // LIVE columns now depend on it: they are only sized to cover count().
    std::uint8_t&  flags(NpcId id)   { return flags_[id]; }
    std::uint16_t& faction(NpcId id) { return faction_[id]; }
    std::int16_t&  hp(NpcId id)      { return hp_[id]; }
    std::int16_t&  max_hp(NpcId id)  { return maxHp_[id]; }

    // SIGNED, and that is load-bearing: the building descends, so the demo stack's
    // labels are {0,1,2,-8,-14,-26,-36,-50,14,30} and FloorRegistry's legal range is
    // kMinFloor -127 .. kMaxFloor +127. As std::uint16_t this column stored floor -50
    // as 65486 and floor -127 as 65409; nothing in src/ read it back, which is the
    // only reason it never showed. master_prompt #10 (per-floor bucket index over
    // pool.floor(id), replacing FloorStreamer's fixed [firstId, count) roster) is
    // exactly the reader that would have hit it. int16_t, not int32_t, so the column
    // stays 2 B/row — the fix costs nothing.
    // READ-ONLY on purpose. main originally exposed `std::int16_t& floor(NpcId)` to
    // fix the signedness below, and the branch added the per-floor bucket index that a
    // writable reference silently desyncs. Both halves were right: the column stays
    // SIGNED, and every write goes through set_floor() so the index cannot rot. The
    // read accessor lives just below, next to set_floor.

    std::uint8_t&  cx(NpcId id)      { return cx_[id]; }
    std::uint8_t&  cy(NpcId id)      { return cy_[id]; }
    std::uint8_t&  cz(NpcId id)      { return cz_[id]; }

    // Floor LABEL (logical, not a storage slot — floors.md). READ with floor();
    // WRITE with set_floor(), which also maintains the per-floor bucket index so a
    // migration (a change of label) is visible to whoever enumerates a floor's
    // residents. Direct assignment is intentionally not offered — it would desync
    // the index.
    // SIGNED, and that is load-bearing: the building DESCENDS, so the demo stack
    // labels are {0,1,2,-8,-14,-26,-36,-50,14,30} and FloorRegistry legal range is
    // kMinFloor -127 .. kMaxFloor +127. Returned as std::uint16_t this read floor -50
    // back as 65486 and floor -127 as 65409. Nothing in src/ read it until the
    // per-floor bucket index arrived, which is exactly the consumer that would have
    // hit it. int16_t, not int32_t, so the column stays 2 B/row -- the fix is free.
    std::int16_t floor(NpcId id) const { return floor_[id]; }
    void set_floor(NpcId id, std::int16_t label);

    // Live roster of a floor: the ids CURRENTLY labelled `label`, alive only
    // (spawn/kill/set_floor keep it tight). This is what floor streaming embodies
    // when a floor loads ([floors.md]); a floor nobody is on returns a stable
    // shared empty vector. Order is unspecified — swap-remove churns it — so
    // callers must treat it as a set, not a sequence.
    const std::vector<NpcId>& floor_bucket(std::int16_t label) const;

    // Character-sheet fields (same struct the future creation screen writes to).
    // age/sex/level/attrs are LIVE columns: sized by spawn(), so a reference from one
    // of them dies at the next spawn().
    std::uint8_t&  age(NpcId id)     { return age_[id]; }      // years, 1..100
    std::uint8_t&  sex(NpcId id)     { return sex_[id]; }      // NpcSex code
    std::uint16_t& height_mm(NpcId id) { return heightMm_[id]; } // stature, mm
    std::uint8_t&  level(NpcId id)   { return level_[id]; }
    // The 8-slot generic attribute block. Addressed by index; slot->name mapping
    // lives in a data table, not here (see kAttrSlots).
    std::array<std::uint8_t, kAttrSlots>& attrs(NpcId id) { return attr_[id]; }

    Inventory&     inventory(NpcId id) { return inv_[id]; }
    // The survival clock. Canonical here, not on the entity, so it survives the
    // body swap an elevator ride performs ([needs.h]).
    Needs&         needs(NpcId id)     { return needs_[id]; }
    // DEMAND column: the first call materializes 128 B x count() and enrols rel_ in
    // spawn()'s growth set. Out of line because that is not header-shaped, and
    // because a call is no longer free — nothing in src/ makes one today.
    std::array<Relationship, kRelSlots>& relations(NpcId id);
    // DEMAND columns, read-only side: blank until set_name() has allocated them. A
    // const accessor cannot materialize a column, so an unallocated row reads as the
    // empty string — which is what a never-named record means anyway.
    const std::array<char, kNameLen>& name(NpcId id) const {
        return id < name_.size() ? name_[id] : kBlankName;
    }
    const std::array<char, kNameLen>& surname(NpcId id) const {
        return id < surname_.size() ? surname_[id] : kBlankName;
    }

private:
    // Size the LIVE columns (and any DEMAND column already materialized) to cover
    // `rows` allocated records. Called from spawn() and nowhere else, which is what
    // makes spawn() the single reference-invalidating operation.
    void grow_live_columns(std::uint32_t rows);

    std::uint32_t count_ = 0;  // bump pointer / high-water mark

    // Parallel SoA arrays. EAGER: kNpcPoolSize long after init(). LIVE/DEMAND: see
    // "Column allocation policy" above — sized to count_, or empty until first touch.
    std::vector<std::uint8_t>  flags_;
    std::vector<std::uint16_t> faction_;
    std::vector<std::int16_t>  hp_;
    std::vector<std::int16_t>  maxHp_;
    std::vector<std::int16_t>  floor_;  // signed logical floor label ([floors.md])
    std::vector<std::uint8_t>  cx_, cy_, cz_;  // macro cell within the floor
    std::vector<std::uint8_t>  age_;    // LIVE — years, 1..100
    std::vector<std::uint8_t>  sex_;    // LIVE — NpcSex code (0 = unset)
    std::vector<std::uint16_t> heightMm_; // stature in mm; drives embodied AABB
    std::vector<std::uint8_t>  level_;  // LIVE
    // LIVE — generic sheet block, 8 B/row
    std::vector<std::array<std::uint8_t, kAttrSlots>> attr_;
    std::vector<std::array<char, kNameLen>> name_;      // DEMAND
    std::vector<std::array<char, kNameLen>> surname_;   // DEMAND
    std::vector<std::array<Relationship, kRelSlots>> rel_; // DEMAND — 128 B/row
    std::vector<Inventory> inv_;

    std::vector<Needs> needs_;   // survival clock ([needs.h]); 36 B/row
    std::uint32_t alive_ = 0;


    // Per-floor inverted index over floor_: the live roster of ids on each floor.
    // slotInBucket_[id] is id's position inside its bucket, so set_floor()/kill() splice
    // in O(1) via swap-remove instead of a linear roster scan on every cold move, which
    // is the hot spot macrosim.md calls out. DERIVED state (rebuildable from floor_ plus
    // the alive bit), so it is not part of the serialized rectangle; init() clears it and
    // spawn/set_floor/kill keep it.
    //
    // INDEXED BY (label - kMinFloor), NOT by the raw label. The branch version indexed
    // floorBuckets_[label] directly, which only worked because its labels were UNSIGNED:
    // floor -50 arrived as 65486, so the top-level index quietly resized to 65487
    // vectors-of-vectors, and a genuinely signed -50 would have been a negative
    // subscript. Normalising makes the whole legal range exactly kFloorSlots = 255
    // buckets and costs one add. [floor_registry.h]
    std::vector<std::vector<NpcId>> floorBuckets_;
    std::vector<std::uint32_t> slotInBucket_;

    // label -> bucket slot, or -1 for the sentinel / out of range.
    static int bucket_slot(std::int16_t label) {
        if (label == kNoFloorLabel) return -1;
        const int i = static_cast<int>(label) - kMinFloor;
        return (i >= 0 && i < kFloorSlots) ? i : -1;
    }

};

} // namespace giga::game
