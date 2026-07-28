// Per-floor generator — builds a floor MODULE's 128^3 World as a pure function
// of (seed, floor number, FloorSpec).
//
// floors.md / macrosim.md: a floor is a self-contained module whose geometry is
// fully determined by its number and the world seed. That determinism is what
// lets a streamed-out floor be torn down and regenerated bit-for-bit on return
// (increment #9), so nothing about a floor's layout has to be persisted.
//
// The floor's *character* (its FloorKind, carried in the FloorSpec) selects a
// geometry PROFILE — room pitch, storey height, doorway size, and decay (broken
// walls, collapsed slabs, rubble). Different kinds therefore build measurably
// different interiors from the same seed: dense residential warrens, open
// commercial halls, sparse industrial plates on pillars, broken derelict mazes.
// The profile is a data table (one row per kind), never a code branch.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include "game/floor_spec.h"

namespace giga {
class World;
}

namespace giga::game {

// Build `world`'s grid into the floor labelled `number`, themed by `spec`.
//
// The world is cleared to air first, so the result depends only on
// (number, spec.kind, seed) and NOT on any prior contents of `world` — call it
// again with the same arguments (even on a recycled World slot) and you get an
// identical grid. `number` is the in-game floor label (signed, floors.md); it is
// mixed into the RNG so two floors of the same kind still differ.
void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed);

} // namespace giga::game
