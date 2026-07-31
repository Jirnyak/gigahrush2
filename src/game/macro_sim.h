// Macro society tick — the coarse background simulation that advances the WHOLE
// NPC population, on its own clock, whether or not anything is embodied or drawn.
//
// One step() is a single **O(n) columnar full-sweep** over the NpcPool SoA rows
// ([performance.md]: O(n) tick over dense tables, never per-NPC search):
//   * aging      — a fractional-year accumulator advances every living cold record;
//   * mortality  — old-age death, a data-driven annual curve scaled to the tick;
//   * births     — reserve-drawn newborns inheriting a living parent's floor label,
//                  macro cell and faction, under a CLOSED-LOOP replacement rule.
// A **bounded** migration pass then rides the same step() but is O(budget), not
// O(n): a persistent ring cursor considers ~migrateRecordsPerTick cold records and
// may start a multi-tick JOURNEY, which lands as an O(1) `pool.floor(id) =` relabel
// once the coarse clock crosses its ETA. A second bounded SOCIAL pass then lazily
// forms per-NPC relationship edges toward co-floor peers, each seeded from the
// caller's live FactionRelations matrix ([faction_relations.h]) and each stamped with
// its target's pool GENERATION, so an edge that outlives the person it names reads as
// stale instead of resolving to whoever inherited the slot (see "A relationship edge is
// a GENERATION-CHECKED reference" below).
//
// Determinism is a hard requirement: same (initial pool, params, step count) ->
// same evolution. Every per-record decision is a STATELESS hash of (id, tick, salt),
// so there is no per-NPC RNG state, the sweep is order-independent, and it is
// trivially parallelizable later. The coarse clock is INTEGER tenth-days, not a
// float day count, for the same reason [core/tick.h] made the sim step exactly 8 ms:
// an accumulator you can round is an accumulator that drifts.
//
// Pure game-layer over NpcPool: no SDL/Vulkan, headless.
//
// ---------------------------------------------------------------------------
// THE HORIZON, STATED UP FRONT BECAUSE IT IS STRUCTURAL AND NOT A TUNING KNOB
//
// **The pool never reclaims a dead slot** ([npc_pool.h]), so a birth is a one-way
// draw on the fixed reserve plast while a death frees nothing. At the DESIGN size —
// 950,000 records seeded into 2^20, i.e. a 98,576-slot reserve — the crude old-age
// death rate this curve produces is ~3.1-4.9 %/yr, so replacement births drain the
// whole reserve in **~2.9 simulated years** (modelled at 7 days/tick: births stop at
// tick 149, and the population then decays monotonically 949,666 -> 825,347 by tick
// 399 with no possible recovery). No parameter moves that wall: births track deaths
// at equilibrium, and deaths scale with the population.
//
// Two consequences, both handled here rather than discovered later:
//   * `reserveFloor` stops the demographic pass before it eats the plast, because
//     the reserve exists for RUNTIME spawns (a possessed replacement body, scripted
//     NPCs) and not for demographic churn. `MacroStats::birthsBlocked` and
//     `reserveRemaining` make the wall visible in a HUD instead of silent decay.
//   * At the size main actually runs — main.cpp's demo stack seeds 1,930 records, so
//     the reserve is 1,046,646 slots and deaths run ~1/tick — the horizon is ~10^6
//     ticks, i.e. tens of thousands of simulated years. The wall is a design-scale
//     property, not a demo bug.
// Closing it properly needs slot RECYCLING in NpcPool (a revive path that keeps
// `alive_` in step), which is a pool change and not this module's to make.
// ---------------------------------------------------------------------------
#pragma once

#include <cstdint>
#include <vector>

#include "core/tick.h"       // kSimHz — the macro cadence is derived, never a literal
#include "game/npc_pool.h"

namespace giga::game {

// Only macro_sim.cpp needs these definitions. Kept out of this header on purpose:
// faction_relations.h pulls ecs/registry.h (entt) and world/level_stack.h, and a
// caller that only wants the demographic tick should not pay for either.
struct FactionRelations;
class FloorRegistry;

// How often the caller should call step(), in SIM ticks. 250 = exactly 2.000 s at
// the shipping rate, and it is derived from kSimHz so it cannot drift when the rate
// changes — the same discipline [faction_relations.h] kFeudEpochTicks uses.
//
// Sized against the O(n) sweep and not against taste. At the design 2^20 the sweep
// touches ~10 columns of a million rows; one step at that size is milliseconds, and
// the whole frame budget is 8 ms (kSimStepMs), so a macro step must never land
// inside a sim step at that scale. Amortized over 250 ticks it is a fraction of a
// percent of one core. At the demo stack's 1,930 records the sweep is microseconds
// and the caller may run it far more often; 2 s is the figure that stays safe when
// the population is real.
inline constexpr std::uint32_t kMacroPeriodTicks = static_cast<std::uint32_t>(kSimHz) * 2u;

// Semantics of Relationship::affinity — the per-NPC social graph this module grows.
//
// The pool's column is a bare `std::int16_t` with NO documented range ([npc_pool.h]
// calls it "signed valence, -32768..32767" and had zero writers before this file),
// so the range is a POLICY and it lives with the only writer. -127..127 is the
// reference's demos social store. This is a SEPARATE store from the faction matrix,
// whose own thresholds are +/-50 ([faction_relations.h] kHostileRelation) — do not
// conflate the two, they have different ranges and different meanings.
inline constexpr std::int16_t kSocialAffinityMin = -127;
inline constexpr std::int16_t kSocialAffinityMax =  127;

// ---------------------------------------------------------------------------
// A relationship edge is a GENERATION-CHECKED reference, and the generation lives in
// Relationship::pad.
//
// `Relationship::target` ([npc_pool.h]) is a bare NpcId held ACROSS TICKS, and the
// social pass below is its only writer in src/. A bare id is a SLOT NUMBER, so the
// moment the pool recycles (`set_recycling(true)`, still unarmed in src/app/main.cpp)
// an edge outlives the person it names and then silently points at whoever inherited
// the slot: a friendship becomes a friendship with a stranger, and a hostile edge
// becomes hostility toward a newborn who has done nothing. Identical in shape to the
// ABA `Contract::giver` and `MacroSim::Journey` already closed.
//
// THE FIX IS THE JOURNEY FIX — spare bits before a wider struct. Relationship is
// 4 (target) + 2 (affinity) + 2 (pad) = 8 B, pinned by a static_assert in
// [npc_pool.h] because rel_ is the widest column in the pool (128 B/row, 128.0 MiB at
// full capacity), so growing it is not on the table. `pad` was dead weight — NSDMI 0,
// blanked by reset_row, read nowhere — so it becomes the target's pool GENERATION as
// of the instant the edge was formed. sizeof(Relationship) is 8 before and 8 after,
// and rel_ does not gain a byte, which is what keeps the social pass affordable enough
// to stay switchable.
//
// A whole NpcHandle would also have FIT (NpcHandle is the same 32 bits as NpcId), and
// it is deliberately NOT what happens here: the field is declared `NpcId target` in a
// header this module does not own, tests/ assigns and compares it as a bare id in four
// places, and a packed handle would make every one of those comparisons quietly wrong
// the first time a generation is non-zero. A generation FIELD beside the id keeps
// `target` meaning exactly what its type says.
//
// READERS MUST VALIDATE, and `social_edge_target` is the whole reader API: it returns
// kInvalidNpc for an empty slot AND for a stale one, so "if (t == kInvalidNpc)
// continue;" — the line a caller already wrote for empty slots — makes a stale edge
// take the path an absent edge takes. Dropping a stale edge is correct; following one
// is the bug. There is no reader in src/ yet (#12's `social` intent is the first one
// due), which is exactly why the accessor lands with the writer rather than after it.
// ---------------------------------------------------------------------------

// The (generation, id) pair an edge really holds, or kInvalidHandle for an empty slot.
// Never `npc_handle(kInvalidNpc, ...)`: that masks 0xFFFFFFFF down to the legal id
// 0xFFFFF and would validate against a real record.
inline NpcHandle social_edge_handle(const Relationship& e) {
    return e.target == kInvalidNpc ? kInvalidHandle : npc_handle(e.target, e.pad);
}

// True iff the edge still names the LIVING record it was formed against. False for an
// empty slot, for a target that has died — kill() bumps the generation whether or not
// the slot is ever handed out again — and for a slot recycled into somebody else.
inline bool social_edge_live(const NpcPool& pool, const Relationship& e) {
    return pool.handle_valid(social_edge_handle(e));
}

// The id a reader may follow, or kInvalidNpc when there is nobody to follow.
inline NpcId social_edge_target(const NpcPool& pool, const Relationship& e) {
    return social_edge_live(pool, e) ? e.target : kInvalidNpc;
}

// Blank a slot. An empty edge is `target == kInvalidNpc`, NOT eight zeroed bytes —
// zeros read as a relationship with NPC 0 ([npc_pool.h] reset_row says so too).
inline void social_edge_clear(Relationship& e) { e = Relationship{}; }

// Form / overwrite an edge, stamping WHO it points at and not merely where. The
// generation is read once, at write time, and never refreshed: that is what makes the
// later comparison an ABA test rather than a liveness test.
inline void social_edge_set(Relationship& e, const NpcPool& pool, NpcId target,
                            std::int16_t affinity) {
    e.target = target;
    e.affinity = affinity;
    e.pad = pool.generation(target);
}

// Tunable knobs for the macro tick — DATA, not code branches. All rates are per
// simulated YEAR; step() scales them by daysPerTick/365, so the same params describe
// the same society regardless of tick cadence.
struct MacroParams {
    std::int32_t daysPerTick = 7;       // simulated days advanced per macro tick
    std::uint8_t maxAge = 100;          // hard ceiling; reaching it is fatal
    std::uint8_t mortalityOnset = 55;   // age where old-age death risk begins
    std::uint8_t fertileLo = 18;        // fertile-adult age window (parents)
    std::uint8_t fertileHi = 45;
    float mortalityPeak = 0.6f;         // annual death prob approaching maxAge
    std::uint32_t seed = 0x9e3779b9u;   // salts the deterministic hashes

    // ---- Births: a CLOSED LOOP on the target, not an open-loop rate. ---------
    // The branch this was ported from used `living * birthRate/yr` plus a one-sided
    // catch-up of 1% of the deficit PER TICK, and both halves are wrong:
    //   * the catch-up is a population bomb, not a nudge — modelled from main.cpp's
    //     1,930-record demo stack with targetPopulation = kNpcActiveTarget it spawns
    //     **9,481 newborns on the first tick** (a 5.9x jump) and 57,482 living by
    //     tick 5;
    //   * the open-loop rate has NO negative feedback, and the crude death rate is
    //     an EMERGENT function of the age pyramid rather than a constant. Newborns
    //     make the pyramid younger, mortality only starts at 55, so the modelled
    //     crude rate falls 4.85 -> 1.11 %/yr over 11.5 simulated years while births
    //     stay at 3 %/yr. Modelled drift at a 200,000 target: **+8.2%** and still
    //     accelerating at the end of the run.
    // Replacing it with births = deaths + gain*(target - living), clamped to a max
    // annual growth, makes the target stationary BY CONSTRUCTION: modelled drift over
    // the same 600 ticks (11.5 simulated years) is **+0.06%** (200,001 -> 200,117),
    // and the 1,930-record recovery case grows to 2,824 over 7.7 simulated years
    // instead of exploding in six ticks.

    // Steady-state living target. **0 means "hold whatever the pool starts with"** —
    // the first step() latches the living count. That is the right default because
    // kNpcActiveTarget is a DESIGN target (npc_pool.h says so in as many words) and
    // main.cpp seeds 1,930 records, so defaulting to it makes every real pool a
    // recovery case. An explicit non-zero value always wins over the latch.
    std::uint32_t targetPopulation = 0;
    float recoverGainPerYear = 0.5f;    // fraction of the deficit made up per year
    float growthRatePerYear = 0.0f;     // OPTIONAL open-loop growth on top; off
    float maxGrowthPerYear = 0.05f;     // hard ceiling on births above replacement

    // Slots the demographic pass must leave untouched in the reserve plast. The
    // reserve is what every RUNTIME spawn draws from and the pool never reclaims, so
    // demographic churn and gameplay spawns compete for one finite pot. 16,384 is
    // 1.6% of capacity and 16.6% of the design-size reserve; see the horizon note in
    // the file banner for what it buys and what it cannot fix.
    std::uint32_t reserveFloor = 16384;

    // ---- Migration (budgeted ring-scan). ------------------------------------
    // OFF unless set_floors() has registered at least TWO destination labels, so a
    // demographic-only caller pays nothing. Floor labels are SIGNED and SPARSE on
    // this side — see set_floors() for why there is no [lo,hi] band.
    std::uint32_t migrateRecordsPerTick = 64;  // ring-scan budget
    float migrateRatePerYear = 0.5f;   // annual per-capita prob a visited record goes
    float travelBaseDays = 0.5f;       // ETA days = (base + perFloor*|dz|) * jitter,
    float travelPerFloorDays = 0.25f;  //   with jitter in 0.80..1.35
    std::uint32_t maxJourneys = 8192;  // cap on concurrent in-transit records

    // ---- Social graph growth (budgeted ring-scan). --------------------------
    // OFF unless socialFormRatePerYear > 0 **and** step() is handed a matrix. Keep it
    // off unless you want the graph: the pool's rel_ column is a DEMAND column
    // ([npc_pool.h] "Column allocation policy") and the first relations() call
    // materializes 128 B/row — 128.0 MiB at full capacity, 512 KB at the demo stack's
    // 1,930 records. That column has no other writer in src/, so switching this on is
    // the single largest allocation decision in this file.
    std::uint32_t socialRecordsPerTick = 64;  // ring-scan budget
    float socialFormRatePerYear = 0.0f;       // annual per-capita formation attempts
};

// Aggregate results of the last step(), for HUD / bench / tests. Cheap running
// tallies gathered DURING the passes — no extra sweep.
struct MacroStats {
    std::uint32_t living = 0;      // ALIVE records after this tick
    std::uint32_t deaths = 0;      // died this tick (old age)
    std::uint32_t births = 0;      // born this tick (reserve draws)
    std::uint32_t birthsBlocked = 0; // births the reserve floor refused (see banner)
    std::uint32_t departures = 0;  // migration journeys STARTED this tick
    std::uint32_t arrivals = 0;    // journeys that LANDED (relabelled) this tick
    std::uint32_t inTransit = 0;   // journeys still pending after this tick
    std::uint32_t socialEdges = 0; // relationship edges FORMED this tick
    // Stale edges RECLAIMED this tick — slots whose target had died or been recycled
    // into somebody else, overwritten instead of trusted. Reported for the same reason
    // `birthsBlocked` is: a graph quietly dropping edges and a graph quietly following
    // strangers look identical from the outside unless the number is published.
    std::uint32_t socialStaleDropped = 0;
    std::uint32_t reserveRemaining = 0; // pool slots left after this tick
    std::uint32_t target = 0;      // the living target actually in force
    std::uint64_t tick = 0;        // macro ticks elapsed (after this step)
    std::uint64_t dayTenths = 0;   // simulated tenth-days elapsed (after this step)
};

class MacroSim {
public:
    // Reset EVERYTHING this module owns — clock, scratch, journeys and the registered
    // destination set. So `set_floors()` goes AFTER `init()`, never before.
    //
    // Safe to call on an EMPTY pool, because the scratch is grown on demand from
    // step() rather than sized to capacity here: sizing to capacity would allocate
    // 3.0 MiB (2 B ageDays_ + 1 B traveling_ per row x 2^20) for a pool that main.cpp
    // populates with 1,930 records, which is the exact mistake [npc_pool.h]'s column
    // allocation policy was written to stop. Grown geometrically from the same
    // kNpcLazyChunk floor of 4096 rows, the demo stack pays 12.0 KB.
    void init();

    // Register the floor labels a migrating record may be sent to.
    //
    // **There is no [floorLo, floorHi] band, and that is the single largest
    // adaptation in this file.** Floor numbers on this side are SIGNED mutable labels
    // over kMinFloor..kMaxFloor and the stack is legitimately SPARSE — main.cpp's is
    // {0,1,2,-8,-14,-26,-36,-50,14,30}, which is why `next_labelled_floor` exists at
    // all ([floor_registry.h]: "from + dir lands on nothing for almost all of it").
    // A uniform draw over a contiguous band would send 71 of every 81 travellers to a
    // floor that does not exist. So destinations are drawn from the registered SET,
    // and the "not the current floor" exclusion is done in INDEX space (O(1) via
    // floorIdx_) rather than label space.
    //
    // Migration stays off until at least two labels are registered. Out-of-range and
    // duplicate labels are dropped.
    void set_floors(const std::int16_t* labels, std::uint32_t count);

    // Every floor label the registry currently has a module for. The registry is the
    // authoritative live set, so this is the one-liner a caller wants; it re-reads
    // cleanly after a renumber.
    void set_floors_from(const FloorRegistry& reg);

    std::uint32_t floor_count() const {
        return static_cast<std::uint32_t>(floors_.size());
    }

    // Advance the whole population by one macro tick. Returns this tick's stats.
    //
    // `factions` is the caller's LIVE matrix, borrowed and never copied. This module
    // deliberately does NOT own one: [faction_relations.h] already owns the society's
    // attitudes and `relations_drain_deaths` bends them by who killed whom, so a
    // second matrix here would be a second source of truth that silently diverges.
    // Pass nullptr (or leave socialFormRatePerYear at 0) to skip the social pass.
    MacroStats step(NpcPool& pool, const MacroParams& params,
                    const FactionRelations* factions = nullptr);

    // --- wholesale state travel ([save.h] v6) -------------------------------
    // Everything step() mutates that cannot be re-derived: the coarse clock,
    // both ring cursors, the per-record age fraction, the traveling bits and
    // the in-flight journeys. floors_/floorIdx_ do NOT travel — rebuild with
    // set_floors_from() after load, exactly like at boot. stats_ is a per-tick
    // report and regenerates on the next step.
    void save_state(std::vector<std::uint8_t>& out) const;
    bool load_state(const std::uint8_t* bytes, std::size_t n);

    const MacroStats& stats() const { return stats_; }
    std::uint64_t tick() const { return tick_; }
    std::uint64_t day_tenths() const { return dayTenths_; }
    double day() const { return static_cast<double>(dayTenths_) * 0.1; }
    std::uint32_t in_transit() const {
        return static_cast<std::uint32_t>(journeys_.size());
    }

private:
    // Grow the macro-owned scratch to cover `rows` records, geometrically. Geometric
    // and not fixed-chunk for the reason npc_pool.cpp's grow_column documents:
    // resize(n) allocates for n exactly, so a constant step copies the whole column
    // at every boundary.
    void ensure_rows(std::uint32_t rows);

    // Index of `label` in floors_, or -1 when it is not a registered destination.
    int floor_index(std::int16_t label) const;

    // Days lived into the current year, [0, 365). Lives HERE and not in the pool so
    // the pool schema stays a clean demographic table.
    std::vector<std::uint16_t> ageDays_;

    // A journey is multi-tick: the ring-scan starts it, step() lands it (relabels the
    // record) once the coarse clock passes its ETA. 16 B, and the ETA is an INTEGER
    // tenth-day count so the landing test is bit-exact.
    struct Journey {
        NpcId id;                 // the travelling record
        std::int16_t toFloor;     // destination LABEL (signed — floors descend)
        std::uint16_t gen;        // pool generation of `id` when the journey STARTED.
                                  // Takes over the unused pad_, so Journey is still
                                  // exactly 16 B. A reused id is a DIFFERENT person, so
                                  // landing has to test WHO travels, not just that the
                                  // slot is alive ([npc_pool.h] handles).
        std::uint64_t etaTenths;  // coarse-clock tenth-day the journey lands
    };
    std::vector<Journey> journeys_;        // in-transit records (<= maxJourneys)
    std::vector<std::uint8_t> traveling_;  // per-id: 1 while a journey is pending
    std::uint32_t migCursor_ = 0;          // persistent ring-scan position

    // Destination labels, dense, plus a label -> index map over kMinFloor..kMaxFloor
    // (255 slots, 510 B) so excluding the current floor is O(1) on a sparse stack.
    std::vector<std::int16_t> floors_;
    std::vector<std::int16_t> floorIdx_;

    std::uint32_t socCursor_ = 0;  // persistent social ring-scan position

    // Latched living count for `targetPopulation == 0`. Latched on the first step()
    // and not in init(), because a caller builds the pool AFTER constructing this
    // (main.cpp: pool.init() -> streamer.ensure_loaded() seeds -> first macro tick),
    // so an init()-time reading would latch 0 and no birth would ever happen.
    std::uint32_t latchedTarget_ = 0;

    std::uint64_t tick_ = 0;
    std::uint64_t dayTenths_ = 0;
    MacroStats stats_;
};

} // namespace giga::game
