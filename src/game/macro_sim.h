// Macro society tick — the coarse background simulation that advances the WHOLE
// NPC population, on its own clock, whether or not anything is embodied or drawn.
#pragma once

#include <cstdint>
#include <vector>

#include "core/tick.h"       // kSimHz — the macro cadence is derived, never a literal
#include "game/npc_pool.h"

namespace giga::game {

struct FactionRelations;
class FloorRegistry;

inline constexpr std::uint32_t kMacroPeriodTicks = static_cast<std::uint32_t>(kSimHz) * 2u;

inline constexpr std::int16_t kSocialAffinityMin = -127;
inline constexpr std::int16_t kSocialAffinityMax =  127;

inline NpcHandle social_edge_handle(const Relationship& e) {
    return e.target == kInvalidNpc ? kInvalidHandle : npc_handle(e.target, e.pad);
}

inline bool social_edge_live(const NpcPool& pool, const Relationship& e) {
    return pool.handle_valid(social_edge_handle(e));
}

inline NpcId social_edge_target(const NpcPool& pool, const Relationship& e) {
    return social_edge_live(pool, e) ? e.target : kInvalidNpc;
}

inline void social_edge_clear(Relationship& e) { e = Relationship{}; }

inline void social_edge_set(Relationship& e, const NpcPool& pool, NpcId target,
                            std::int16_t affinity) {
    e.target = target;
    e.affinity = affinity;
    e.pad = pool.generation(target);
}

struct MacroParams {
    std::int32_t daysPerTick = 7;       // simulated days advanced per macro tick
    std::uint8_t maxAge = 100;          // hard ceiling; reaching it is fatal
    std::uint8_t mortalityOnset = 55;   // age where old-age death risk begins
    std::uint8_t fertileLo = 18;        // fertile-adult age window (parents)
    std::uint8_t fertileHi = 45;
    float mortalityPeak = 0.6f;         // annual death prob approaching maxAge
    std::uint32_t seed = 0x9e3779b9u;   // salts the deterministic hashes

    std::uint32_t targetPopulation = 0;
    float recoverGainPerYear = 0.5f;    // fraction of the deficit made up per year
    float growthRatePerYear = 0.0f;     // OPTIONAL open-loop growth on top; off
    float maxGrowthPerYear = 0.05f;     // hard ceiling on births above replacement
    std::uint32_t reserveFloor = 16384;

    std::uint32_t migrateRecordsPerTick = 64;  // ring-scan budget
    float migrateRatePerYear = 0.5f;   // annual per-capita prob a visited record goes
    float travelBaseDays = 0.5f;       // ETA days = (base + perFloor*|dz|) * jitter,
    float travelPerFloorDays = 0.25f;  //   with jitter in 0.80..1.35
    std::uint32_t maxJourneys = 8192;  // cap on concurrent in-transit records

    std::uint32_t socialRecordsPerTick = 64;  // ring-scan budget
    float socialFormRatePerYear = 0.0f;       // annual per-capita formation attempts
    float rumourDiffusionRatePerYear = 0.5f;  // annual rate of rumor sharing during social routines
};

struct MacroStats {
    std::uint32_t living = 0;      // ALIVE records after this tick
    std::uint32_t deaths = 0;      // died this tick (old age)
    std::uint32_t births = 0;      // born this tick (reserve draws)
    std::uint32_t birthsBlocked = 0; // births the reserve floor refused (see banner)
    std::uint32_t departures = 0;  // migration journeys STARTED this tick
    std::uint32_t arrivals = 0;    // journeys that LANDED (relabelled) this tick
    std::uint32_t inTransit = 0;   // journeys still pending after this tick
    std::uint32_t socialEdges = 0; // relationship edges FORMED this tick
    std::uint32_t socialStaleDropped = 0;
    std::uint32_t rumoursDiffused = 0; // social rumour shares during this tick
    std::uint32_t territoryShifts = 0; // floor dominance shifts during this tick
    std::uint32_t reserveRemaining = 0; // pool slots left after this tick
    std::uint32_t target = 0;      // the living target actually in force
    std::uint64_t tick = 0;        // macro ticks elapsed (after this step)
    std::uint64_t dayTenths = 0;   // simulated tenth-days elapsed (after this step)
};

class MacroSim {
public:
    void init();
    void set_floors(const std::int16_t* labels, std::uint32_t count);
    void set_floors_from(const FloorRegistry& reg);

    std::uint32_t floor_count() const {
        return static_cast<std::uint32_t>(floors_.size());
    }

    MacroStats step(NpcPool& pool, const MacroParams& params,
                    const FactionRelations* factions = nullptr);

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
    void ensure_rows(std::uint32_t rows);
    int floor_index(std::int16_t label) const;

    std::vector<std::uint16_t> ageDays_;

    struct Journey {
        NpcId id;
        std::int16_t toFloor;
        std::uint16_t gen;
        std::uint64_t etaTenths;
    };
    std::vector<Journey> journeys_;
    std::vector<std::uint8_t> traveling_;
    std::uint32_t migCursor_ = 0;

    std::vector<std::int16_t> floors_;
    std::vector<std::int16_t> floorIdx_;

    std::uint32_t socCursor_ = 0;
    std::uint32_t latchedTarget_ = 0;

    std::uint64_t tick_ = 0;
    std::uint64_t dayTenths_ = 0;
    MacroStats stats_;
};

} // namespace giga::game
