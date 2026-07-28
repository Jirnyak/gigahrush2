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
// Later increments add the budgeted-cursor migration/social passes on top of the
// same tables (master_prompt §7 #10).
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
};

// Aggregate results of the last step(), for HUD / bench / tests. Cheap running
// tallies gathered DURING the single sweep — no extra pass.
struct MacroStats {
    std::uint32_t living = 0;  // ALIVE records after this tick
    std::uint32_t deaths = 0;  // died this tick (old age)
    std::uint32_t births = 0;  // born this tick (reserve draws)
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

private:
    std::vector<std::uint16_t> ageDays_;  // days lived into the current year [0,365)
    std::uint64_t tick_ = 0;
    double day_ = 0.0;
    MacroStats stats_;
};

} // namespace giga::game
