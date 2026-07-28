// Population seeding — builds the cold alife pool for a floor BEFORE anyone is
// embodied. This is the "not player-oriented" entry point: the world creates a
// living population first, and the player is chosen from it, not spawned into an
// empty map ([npcs.md]).
//
// This is a deliberately small first cut: it seeds a bounded set of records on
// one floor with deterministic demographics (age -> height, sex, generic
// attributes, faction) and returns which record was designated the player. The
// per-floor route-key distribution and macro tick come later; the important part
// now is the skeleton — records exist first, the player is one of them.
#pragma once

#include <cstdint>

#include "game/floor_spec.h"
#include "game/npc_pool.h"

namespace giga::game {

// Seed a floor from its rule-set ([floors.md]): `spec.population` records, each
// with a faction sampled from `spec.factionMix`, an age drawn from the spec's
// demographic window, and stature derived from that age. Records are placed
// densely across the apartment interiors on the 16-cell lattice — never inside
// the wall lattice — so a dense spec reads as a real crowd, not a wall of boxes.
// Designates one record (roughly central) as the player candidate and returns
// its id. Returns kInvalidNpc if the pool could not allocate any records.
//
// `floor` is a SIGNED label — plain `int`, matching FloorModule::number,
// FloorRegistry (kMinFloor -127 .. kMaxFloor +127) and next_labelled_floor. It was
// std::uint16_t, which made the demo stack's descending floors (-8, -14, -26, -36,
// -50) arrive as 65528..65486 and get stored that way; the player descends, so an
// unsigned floor label is wrong by construction rather than merely risky.
NpcId seed_floor_from_spec(NpcPool& pool, int floor, const FloorSpec& spec,
                           std::uint32_t seed);

// Seed `n` alife records onto `floor` with a uniform faction mix and full adult
// age range — a thin wrapper over seed_floor_from_spec for callers (the maze
// test bed) that want a plain count rather than a floor character.
NpcId seed_floor_population(NpcPool& pool, int floor, std::uint32_t n,
                            std::uint32_t seed);

// Deterministic stature (mm) for an age, matching the reference's rule: children
// scale up with age, adults settle around ~1.8 m with per-record variation.
std::uint16_t height_for_age(std::uint8_t age, std::uint32_t jitter);

} // namespace giga::game
