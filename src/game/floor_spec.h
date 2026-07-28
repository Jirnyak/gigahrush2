// Floor rule-set — a floor's *character* as data ([floors.md]).
//
// The vision: each floor is its own module/sub-game — somewhere dense and
// residential/safe, somewhere near-empty and dangerous. That character is NOT
// code branches; it is a small table of weights the seeder (and, later, the mob
// and loot systems) read. A FloorSpec never forks the global tables — it only
// says how much of each thing this floor gets: how many people, how they split
// across factions, how hostile it is, which ages live here.
//
// This is the population/spawn rule-set only. It is deliberately independent of
// which storage layer holds the floor and of the floor's in-game number — those
// are separate identities per [floors.md] (LayerId != ModuleId != floor number).
#pragma once

#include <cstdint>

#include "game/faction.h"

namespace giga::game {

// Coarse archetypes a floor can take. The enum is just an index into the
// catalog; the *data* is what matters (a Residential floor is "dense + safe +
// all ages", not a special code path).
enum class FloorKind : std::uint8_t {
    Residential, // dense, safe, families — many civilians, all ages
    Commercial,  // mixed crowd, moderate density and danger
    Industrial,  // sparse, working-age adults
    Derelict,    // near-empty and dangerous (high monster weight)
    Count,
};

// A floor's rule-set. POD aggregate: field order matches the catalog rows in
// floor_spec.cpp. Weights are relative/multiplier semantics, never absolutes
// that shadow a global table.
struct FloorSpec {
    FloorKind kind;
    const char* name;            // static label for HUD/debug
    std::uint32_t population;     // how many alife records to seed here
    // Relative weights of the five factions (any scale). FIVE, not four: an
    // earlier four-slot version silently folded Wild onto Citizens.
    std::uint8_t factionMix[kFactionCount];
    float hostility;             // 0..1 monster spawn-weight multiplier (used once mobs land)
    std::uint8_t minAge;         // demographic window: youngest resident...
    std::uint8_t maxAge;         // ...and oldest
};

// Read a floor's rule-set by archetype. Returns a reference into a static
// catalog (stable for the process lifetime).
const FloorSpec& floor_spec(FloorKind kind);

// Pick a rule-set for a floor NUMBER. Deterministic and reproducible so a stack
// of floors gets a varied-but-stable character without a hand-authored row per
// number: mostly populated floors, the odd dangerous one. Floor number is the
// mutable in-game label, not a storage slot ([floors.md]); this is a stopgap
// until the real per-module registry assigns specs explicitly.
const FloorSpec& floor_spec_for(std::uint16_t floor);

} // namespace giga::game
