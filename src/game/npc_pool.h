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
//   * The dead are never reclaimed BY DEFAULT — a killed NPC keeps its slot (its
//     ALIVE bit is cleared) and stays in the table, so every id anything ever stored
//     keeps naming the same person forever. New NPCs come from the reserve.
//   * OPT-IN SLOT RECYCLING (`set_recycling(true)`) suspends that policy for one
//     pool: kill() queues the slot and spawn() prefers the queue over bumping the
//     tail. It exists because "never reclaim" is a HARD WALL at design size, not a
//     preference — 950,000 records in a 2^20 pool leave a 98,576-slot reserve, and
//     demographic replacement births drain it in ~2.9 simulated years, after which
//     the population can only decay ([macro_sim.h] banner, which names this pool
//     change as the fix). It is OFF by default because a recycled id is a REUSED id
//     and six places in src/ store a bare NpcId across time — Relationship::target,
//     NpcRef::id, Contract::giver, FloorModule::candidate, MacroSim::Journey::id,
//     RelationEdge::id — so each has to move to the generation-checked handle below
//     before the shipping pool may flip it on. See "Slot recycling" further down.
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
#include "game/floor_registry.h"   // kMinFloor / kFloorSlots for bucket_slot()

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

// A stable NPC handle == its index into the pool. Never reused once allocated —
// unless the pool is recycling, in which case an id names one record at a time and
// NpcHandle below is what stays unique.
using NpcId = std::uint32_t;
inline constexpr NpcId kInvalidNpc = 0xFFFFFFFFu;

// ---------------------------------------------------------------------------
// Generation-tagged handles — how a reused id stays distinguishable
// ---------------------------------------------------------------------------
// An id is 20 bits (kNpcPoolBits) inside a 32-bit word, so 12 bits are already spare
// and NO save format has to move to make room: [save.h] serializes the player's ROW
// (needs / inventory / hp / floor / cell), never an id, and states in as many words
// that the pool itself is not in the format because it is reproduced by
// `seed_floor_population`. So the generation column is free of the wire.
//
// gen_ is bumped by kill(), NOT by reuse, which is the stronger of the two: a handle
// minted while a record was alive goes stale the instant that record dies, whether or
// not the slot is ever handed out again. `handle_valid` is therefore one test that
// answers "is this still the person I was holding?" for callers that never learn about
// the death — quests, relationship edges, in-flight journeys.
//
// 0xFFF is RESERVED as an impossible generation so that no live handle can collide
// with kInvalidHandle: id 0xFFFFF is a legal id (1,048,575 == kNpcPoolSize-1), and
// packed with gen 0xFFF it would be exactly 0xFFFFFFFF. The counter cycles 0..0xFFE,
// i.e. 4,095 deaths per slot before an ABA collision becomes possible again — which is
// a real limit and is stated rather than hidden: at the modelled design-scale churn
// (~4.9%/yr of 950k, spread over 2^20 slots) a single slot is reused on the order of
// once per 20 simulated years, so the counter wraps after ~80,000 simulated years.
inline constexpr std::uint32_t kNpcGenBits = 32u - kNpcPoolBits;          // 12
inline constexpr std::uint32_t kNpcGenMask = (1u << kNpcGenBits) - 1u;    // 0xFFF
inline constexpr std::uint16_t kInvalidGen = static_cast<std::uint16_t>(kNpcGenMask);

// (generation, id) packed into one word. Distinct type name, same width as NpcId, so a
// caller that stores a handle where an id used to live pays nothing.
using NpcHandle = std::uint32_t;
inline constexpr NpcHandle kInvalidHandle = 0xFFFFFFFFu;

inline constexpr NpcHandle npc_handle(NpcId id, std::uint16_t gen) {
    return (static_cast<NpcHandle>(gen & kNpcGenMask) << kNpcPoolBits) |
           (id & kNpcIdMask);
}
inline constexpr NpcId npc_handle_id(NpcHandle h) { return h & kNpcIdMask; }
inline constexpr std::uint16_t npc_handle_gen(NpcHandle h) {
    return static_cast<std::uint16_t>((h >> kNpcPoolBits) & kNpcGenMask);
}
static_assert(npc_handle(kNpcPoolSize - 1u, kInvalidGen) == kInvalidHandle,
              "kInvalidHandle must be the one packing the live counter never mints, "
              "which is what makes 0xFFF a reserved generation and not a usable one");

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
    // Fractional heal bank: HP is integer on the crowd body, so "+1.2 HP/s" cannot
    // be expressed directly. Bank accumulates the fraction; the whole part spills
    // into pool.hp() each tick in needs_step. Same shape as hpDebt on the damage side.
    // Used by: Medical room recovery (kRoomRecovery) and Medic role (careDrive path).
    float hpBank = 0.0f;
    float sanity = 0.0f;      // 0..100 reserve, drains; 0 = insane
    float radiation = 0.0f;   // 0..100 pressure, fills; 100 = lethal
    std::uint8_t seeded = 0;  // 0 = never rolled (see above)
    std::uint8_t pad_[3] = {};
};
static_assert(sizeof(Needs) == 48, "Needs must stay a tight 48-byte row (sanity/rad added)");
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
// each = 493 B when this policy was written. Slot recycling added two more: gen_ 2 B
// (LIVE) and nextFree_ 4 B (DEMAND, and only when recycling is actually on), for 499 B
// at the widest. NEITHER is EAGER, so the 306 B/row resident figure below is unchanged
// and the whole comparison still holds. Of the original 493, 187 B/row = 187.0 MiB
// belonged to columns with NO reader
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
//   LIVE   — age_, sex_, level_, attr_, gen_. The first four are written for every
//            seeded record by seed_floor_from_spec; gen_ is written by kill(). All
//            track count_ and are grown inside spawn(). 13 B/row: the demo stack's
//            1,930 records need 25.1 KB of rows and allocate 52.0 KiB (13 B x the
//            kNpcLazyChunk floor of 4096) instead of 13.0 MiB. They still reach
//            13.0 MiB at the 950k target.
//   DEMAND — rel_, name_, surname_, nextFree_. Zero cost until something actually
//            calls relations() / set_name(), or until a recycling pool takes its first
//            death; the shipping game does none of the three, so it pays 0 B for all
//            four (180 B/row = 180.0 MiB saved outright). On first touch the column
//            materializes and then JOINS the LIVE set, so relations() itself never
//            resizes afterwards.
//
// New resident footprint after init(): 306.0 MiB (was 493.0 MiB), and the demo stack
// adds 52.0 KiB of LIVE columns rather than 13.0 MiB. resident_bytes() reports the
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
// Verbatim serialization ([npcs.md] "the tables serialize verbatim") is still not
// implemented: [save.h] carries the player's ROW and states outright that the pool is
// excluded because `seed_floor_population` reproduces it. When the pool does join the
// format it must either materialize the DEMAND/LIVE columns to kNpcPoolSize first or
// write each column's row count into the header; dumping a short column as if it were
// full is the one way this change can bite. **Two additions for that day:** gen_ has to
// travel (a save that resets generations hands every stored handle a false match), and
// the free list has to travel or be rebuilt from the alive bits — a save that forgets
// which slots were queued silently reverts the pool to never-reclaim.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Slot recycling
//
// OFF by default; `set_recycling(true)` arms it for one pool. Three properties, and
// each one is a requirement rather than a nicety:
//
//   * O(1) both ways, no scanning. The free list is INTRUSIVE — a singly-linked FIFO
//     threaded through nextFree_ (one uint32 per row, DEMAND, so a non-recycling pool
//     pays nothing). kill() appends at freeTail_, spawn() pops freeHead_. No compaction
//     pass, no reallocation churn, and no free-slot search over 2^20 flag bytes.
//   * FIFO, not LIFO, and the order is EXACTLY the recorded kill order. Determinism is
//     the constraint that picks this: [suite_macrosim.inl] folds every column of two
//     independently-built pools into one FNV-1a digest and requires them equal, and a
//     free list ordered by anything except the sequence of kill() calls (an address, a
//     hash, a set iteration) would make the ids handed to newborns differ between two
//     identical runs — and since every macro decision is `hash(id, tick, salt)`, a
//     different id is a different society. FIFO over LIFO on top of that because
//     oldest-death-first maximizes the time before an id is reused, which is exactly
//     the window in which a stale reference is detectable.
//     There are exactly TWO orders, and both are pure functions of recorded state:
//     kill order for every death taken while armed, and ASCENDING ID for the one-time
//     rebuild `set_recycling(true)` performs over the alive bits (see set_recycling).
//     Neither reads an address, a hash or a container's iteration order, so two
//     identical runs stay bit-identical under either.
//   * A recycled row is a BLANK row. spawn() resets every column the pool owns before
//     handing the slot back — including the lazily-grown ones, where "reset" is not
//     memset: an empty rel_ row is 16 x `target == kInvalidNpc`, not 16 zeros, and a
//     blank needs_ row is `seeded == 0` rather than a starving body. Missing one column
//     would resurrect a corpse's inventory or its survival clock inside a newborn.
//
// What recycling does NOT fix, stated because a caller has to care: the six bare-NpcId
// stores listed at the top of this file. `handle()` + `handle_valid()` is the tool for
// them and it is not yet used by any of them.
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

    // Take the next blank slot. Returns kInvalidNpc only when there is genuinely
    // nothing left. The new NPC is marked ALIVE, everything else blank.
    //
    // Prefers a RECYCLED slot (the oldest death first) over bumping the tail whenever
    // the free list is non-empty, because the tail is finite and the free list is not:
    // at design size the reserve is 98,576 slots and demographic replacement drains it
    // in ~2.9 simulated years, after which a tail-only allocator can never grant another
    // birth ([macro_sim.h] banner). With recycling off the free list is always empty and
    // this is the same bump allocator it always was.
    NpcId spawn();

    // Mark an NPC dead. IDEMPOTENT: killing an already-dead id does nothing at all.
    // That is load-bearing, not defensive — see the .cpp for the alive_ drift it stops.
    //
    // The slot is not reclaimed unless recycling is armed; the id stays a valid index
    // either way, and its GENERATION is bumped either way, so a handle minted while the
    // record was alive reads as stale from here on.
    void kill(NpcId id);

    // Arm / disarm slot recycling for this pool. Off by default (see "Slot recycling").
    //
    // Disarming DROPS the pending free list: those slots go back to the never-reclaimed
    // policy rather than lingering as a queue nothing will drain, which keeps one
    // invariant true — `free_slots() > 0` implies recycling is on — and keeps
    // reserve_remaining() honest about what spawn() can actually hand out.
    //
    // ARMING REBUILDS the queue from the ALIVE BITS: every dead slot below the
    // high-water mark is enqueued in ascending id order. Without that, arming is
    // asymmetric with disarming and silently loses slots — a pool armed AFTER its first
    // death (or a pool whose rows came back from a load) would report a reserve it can
    // never hand out, which is the never-reclaim wall reappearing under a flag that says
    // it is closed. Ascending id is a pure function of recorded state, so it is as
    // deterministic as kill order; see "Slot recycling" for the two orders side by side.
    // This is also the "rebuilt from the alive bits" half of the save-format note in
    // "Column allocation policy": with it, a load calls set_recycling(true) and the free
    // list does NOT have to travel in the save.
    //
    // Idempotent: set_recycling(true) on an already-armed pool does nothing, so it
    // cannot double-enqueue a slot that is already queued.
    void set_recycling(bool on);
    bool recycling() const { return recycle_; }

    // Slots queued for reuse right now (dead, and spawn() will hand them back).
    std::uint32_t free_slots() const { return freeCount_; }

    // Cumulative slots handed out FROM the free list rather than from the tail. The
    // number that makes recycling checkable from outside: `count() + recycled()` is the
    // total number of records the pool has ever created, which is what
    // `count()` alone meant before recycling existed.
    std::uint32_t recycled() const { return recycled_; }

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

    // How many records this slot has held, mod 4095. 0 until its first death. Exposed
    // for tests and for anything packing its own handle; gameplay code wants
    // handle()/handle_valid() instead of comparing this by hand.
    std::uint16_t generation(NpcId id) const {
        return id < gen_.size() ? gen_[id] : static_cast<std::uint16_t>(0);
    }

    // A handle naming whoever occupies `id` right now. Store this instead of a bare
    // NpcId anywhere the reference can outlive the record: a contract giver, a
    // relationship edge, an in-flight journey, a quest target. With recycling off it is
    // still strictly better than an id, because it also detects a plain DEATH.
    NpcHandle handle(NpcId id) const { return npc_handle(id, generation(id)); }

    // True iff `h` still names the living record it was minted from. False for a handle
    // whose record died (kill() bumped the generation), for one whose slot was recycled
    // into somebody else, for kInvalidHandle, and for an id past the high-water mark.
    bool handle_valid(NpcHandle h) const {
        if (h == kInvalidHandle) return false;
        const NpcId id = npc_handle_id(h);
        if (id >= count_) return false;
        if (npc_handle_gen(h) != generation(id)) return false;
        return (flags_[id] & NpcAlive) != 0;
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

    // Slots spawn() can still hand out: the untouched tail PLUS the recycling queue.
    // That definition is what closes the birth wall, because it is the number
    // `MacroSim` gates births on (`room = reserve_remaining() - reserveFloor`) — with a
    // tail-only figure a recycling pool would still refuse every birth the moment the
    // plast ran dry, and the recycled slots would sit there unused. Identical to the old
    // `kNpcPoolSize - count_` whenever recycling is off, since the queue is then empty.
    std::uint32_t reserve_remaining() const {
        return (kNpcPoolSize - count_) + freeCount_;
    }

    // Bytes the SoA columns currently hold, summed over vector capacities. Exists so
    // the allocation policy above is a measurement rather than a comment: 306.0 MiB
    // right after init(), and it only moves when a LIVE/DEMAND column grows.
    std::size_t resident_bytes() const;

    // --- wholesale serialization ([save.h] v6) ------------------------------
    // Verbatim little-endian dump of rows [0, count()) — the "tables serialize
    // verbatim" contract [npcs.md] finally cashed in. NpcEmbodied is masked off
    // on write: bodies never survive a save, so the flag must not either.
    // rel_ does not travel — nothing in src/ writes or reads a Relationship
    // yet; the day one does, the blob gains a section and a version bump.
    void save_rows(std::vector<std::uint8_t>& out) const;

    // Restore onto a freshly init()ed pool. Rebuilds the alive count and the
    // floor bucket index from the rows. False on malformed input (re-init the
    // pool before retrying). Call set_recycling(true) afterwards if the run
    // recycles: the free list rebuilds from the alive bits, by design.
    bool load_rows(const std::uint8_t* bytes, std::size_t n);

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
    // Role assignment (RoleId stored as uint8). LIVE column: sized by spawn().
    // Initialised from role_for(id, floorKind) at floor seeding; may be overridden
    // by game events (e.g. Resident -> Looter after samosbor). See role.h.
    std::uint8_t&  role(NpcId id)    { return role_[id]; }
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

    // Blank every column the pool owns for `id`, so a recycled slot cannot resurrect a
    // corpse's inventory, clock, name, relationships or floor membership.
    void reset_row(NpcId id);

    // Append / pop the intrusive FIFO free list. Append is kill order, which is what
    // makes reuse deterministic; pop takes the oldest death.
    void push_free(NpcId id);
    NpcId pop_free();

    // Re-derive the whole queue from the alive bits: every dead slot below count_, in
    // ascending id order. Called on the OFF->ON transition of set_recycling() and
    // nowhere else today, but it does NOT rely on that: it RESETS the list before
    // scanning, so it is safe to run against a non-empty queue and cannot duplicate a
    // slot. Keep the reset if a second caller ever appears — the call-site restriction
    // is a convention, the reset is the invariant. O(count_) once, off any hot path.
    void rebuild_free_list();

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
    // LIVE -- role archetype (RoleId as uint8). 1 B/row = 1.0 MiB at capacity.
    // Initialised from role_for() at floor seeding; writable for story overrides.
    std::vector<std::uint8_t>  role_;   // LIVE -- see role.h
    // LIVE -- generic sheet block, 8 B/row
    std::vector<std::array<std::uint8_t, kAttrSlots>> attr_;
    std::vector<std::array<char, kNameLen>> name_;      // DEMAND
    std::vector<std::array<char, kNameLen>> surname_;   // DEMAND
    std::vector<std::array<Relationship, kRelSlots>> rel_; // DEMAND -- 128 B/row
    std::vector<Inventory> inv_;

    std::vector<Needs> needs_;   // survival clock ([needs.h]); 40 B/row (was 36, hpBank added)
    std::uint32_t alive_ = 0;

    // LIVE — reuse counter per slot, bumped by kill(). 2 B/row (2.0 MiB at capacity,
    // 13.0 MiB of LIVE columns at the 950k target). Unconditional rather than gated on
    // recycling, because a handle to a DEAD record is worth detecting in either mode and
    // the column is the cheapest in the table bar the flag byte.
    std::vector<std::uint16_t> gen_;

    // DEMAND — the intrusive free list's link column, materialized by the first
    // recycled kill(). A non-recycling pool never allocates it. Only entries for slots
    // that have actually been pushed are ever read (push writes the link before it is
    // reachable), so the zero-fill a resize leaves behind is never mistaken for a link
    // to record 0.
    std::vector<NpcId> nextFree_;
    NpcId freeHead_ = kInvalidNpc;
    NpcId freeTail_ = kInvalidNpc;
    std::uint32_t freeCount_ = 0;   // queued right now
    std::uint32_t recycled_ = 0;    // cumulative reuses
    bool recycle_ = false;          // off by default; see "Slot recycling"


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
