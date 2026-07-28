// Macro society tick — the coarse background simulation that advances the WHOLE
// 2^20 NPC population ([macrosim.md]). It runs on its OWN clock, decoupled from
// the 120 Hz sim tick and the present path: the caller decides how often to call
// step(), and the society keeps evolving whether or not anything is embodied or
// drawn.
//
// One step() is a single **O(n) columnar full-sweep** over the NpcPool SoA arrays
// ([performance.md]: O(n) tick over dense tables, never per-NPC search):
//   * aging      — a fractional-year accumulator advances every living record;
//   * mortality  — old-age death, a data-driven annual curve scaled to the tick;
//   * births     — reserve-drawn newborns inherit a living parent's floor/faction
//                  to keep the population near a steady-state target.
// A bounded MIGRATION pass then rides the same step() but is O(budget), not O(n):
// a persistent ring cursor considers ~migrateRecordsPerTick cold records and may
// start a multi-tick JOURNEY to another floor, which lands as an O(1) set_floor
// relabel (the #10b per-floor bucket index) once the coarse clock crosses its ETA.
// Social/faction passes are the next increment (master_prompt §7 #10d).
//
// Determinism ([ARCHITECTURE.md] §Determinism): same (initial pool, params, step
// count) -> same evolution. All per-record randomness is a STATELESS hash of
// (id, tick, salt) (core/rng.h), so there is no per-NPC RNG state, the sweep is
// order-independent, and it is trivially parallelizable later.
//
// Pure game-layer over NpcPool: no SDL/Vulkan, headless-tested (game_test) and
// benched at the full 1M (macro_bench).
#pragma once

#include <cstdint>
#include <vector>

#include "game/npc_pool.h"

namespace giga::game {

// Tunable knobs for the macro tick — DATA, not code branches ([macrosim.md]). All
// rates are expressed per simulated YEAR; step() scales them by daysPerTick/365,
// so the same params describe the same society regardless of tick cadence.
struct MacroParams {
    int daysPerTick = 7;               // simulated days advanced per macro tick
    std::uint8_t maxAge = 100;         // hard ceiling; reaching it is fatal
    std::uint8_t mortalityOnset = 55;  // age where old-age death risk begins
    float mortalityPeak = 0.6f;        // annual death prob approaching maxAge
    std::uint8_t fertileLo = 18;       // fertile-adult age window (parents)
    std::uint8_t fertileHi = 45;
    float birthRate = 0.03f;           // annual births per living capita
    std::uint32_t targetPopulation = kNpcActiveTarget; // steady-state living target
    std::uint32_t seed = 0x9e3779b9u;  // salts the deterministic hashes

    // ---- Migration (budgeted ring-scan; master_prompt §7 #10c). --------------
    // OFF unless a real floor band is configured (floorHi > floorLo), so the
    // demographic-only bench/tests are unaffected. When on, step() also runs a
    // bounded pass that starts/lands inter-floor JOURNEYS (see the header banner).
    std::uint16_t floorLo = 0;  // inclusive low end of the contiguous floor band
    std::uint16_t floorHi = 0;  // inclusive high end; a destination is drawn in [lo,hi]
    std::uint32_t migrateRecordsPerTick = 64;  // ring-scan budget (ref RECORDS_PER_TICK)
    float migrateRatePerYear = 0.5f;  // annual per-capita prob a visited record departs
    float travelBaseDays = 0.5f;      // ETA days = (base + perFloor*|dz|) * jitter,
    float travelPerFloorDays = 0.25f; //   with jitter in 0.8..1.35 (ref ETA shape)
    std::uint32_t maxJourneys = 8192; // cap on concurrent in-transit records
};

// Aggregate results of the last step(), for HUD / bench / tests. Cheap running
// tallies gathered DURING the single sweep — no extra pass.
struct MacroStats {
    std::uint32_t living = 0;  // ALIVE records after this tick
    std::uint32_t deaths = 0;  // died this tick (old age)
    std::uint32_t births = 0;  // born this tick (reserve draws)
    std::uint32_t departures = 0;  // migration journeys STARTED this tick
    std::uint32_t arrivals = 0;    // journeys that LANDED (relabelled) this tick
    std::uint32_t inTransit = 0;   // journeys still pending after this tick
    std::uint64_t tick = 0;    // macro ticks elapsed (after this step)
    double day = 0.0;          // simulated days elapsed (after this step)
};

class MacroSim {
public:
    // Size the macro-owned scratch to the pool capacity (once, before step()).
    // The fractional-year age accumulator lives HERE, not in the pool, so the
    // pool schema stays clean and this module owns all macro-only state.
    void init(const NpcPool& pool);

    // Advance the whole population by one macro tick. Returns this tick's stats.
    MacroStats step(NpcPool& pool, const MacroParams& params);

    const MacroStats& stats() const { return stats_; }
    std::uint64_t tick() const { return tick_; }
    double day() const { return day_; }
    std::uint32_t in_transit() const {
        return static_cast<std::uint32_t>(journeys_.size());
    }

private:
    std::vector<std::uint16_t> ageDays_;  // days lived into the current year [0,365)

    // ---- Migration scratch (macro-owned, master_prompt §7 #10c). A journey is
    // multi-tick: the ring-scan starts it, and step() lands it (relabels the record
    // via set_floor) once day_ crosses its ETA. Kept HERE, not in the pool schema,
    // so the pool stays a clean demographic table — same stance as ageDays_.
    struct Journey {
        NpcId id;              // the travelling record
        std::uint16_t toFloor; // destination floor label it will be relabelled to
        double etaDay;         // simulated day the journey lands
    };
    std::vector<Journey> journeys_;        // in-transit records (<= maxJourneys)
    std::vector<std::uint8_t> traveling_;  // per-id: 1 while a journey is pending
    std::uint32_t migCursor_ = 0;          // persistent ring-scan position (ref cursor)

    std::uint64_t tick_ = 0;
    double day_ = 0.0;
    MacroStats stats_;
};

} // namespace giga::game
