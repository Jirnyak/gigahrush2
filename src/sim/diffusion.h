// Diffusion fields — scent / blood / danger that spreads and fades.
//
// A scalar float field (default "danger") over the macro grid, advanced by a
// deterministic double-buffered diffusion step: each cell relaxes toward its
// OPEN neighbours (the discrete heat equation) and a fraction evaporates every
// step, so a source of "danger" — spilled blood, a gunshot's noise — spreads
// outward through the walkable void and fades with time. Periodic on the torus
// (all three axes wrap) and blocked by fully-solid cells (no flux through walls,
// the same walkability nav uses), so danger pools in rooms and leaks through
// doorways rather than bleeding through structure.
//
// This is the flee/scent GRADIENT the utility-AI (#12) steers by — deliberately
// NOT pathfinding (that is the baked nav, world/nav.h) and NOT the authored
// per-floor danger RATING (floor_spec). It runs on the coarse macro tick, not the
// 120 Hz render tick. Reads/writes two buffers, so the result is independent of
// iteration order: reproducible across runs and platforms (master_prompt #11).
#pragma once

#include <string>

#include "core/math.h"   // giga::vec3
#include "world/field.h" // giga::Field
#include "world/world.h" // giga::World, MacroGrid

namespace giga {

struct DiffusionParams {
    std::string field = "danger"; // name of the float field to diffuse
    // Diffusion coefficient per step. Explicit 6-neighbour diffusion is stable
    // only while rate * 6 <= 1, so keep rate <= ~1/6 (0.166); the default leaves
    // headroom against the checkerboard mode. Larger = spreads faster per step.
    float rate = 0.15f;
    float decay = 0.02f;    // fraction that evaporates per step (the scent fades)
    float minLevel = 1e-4f; // clamp residues below this to 0 (keeps the field tidy)
};

// Advance the named diffusion field by one deterministic step over `world`,
// creating it (zero-filled) on first use. Fully-solid cells are held at 0 and
// exchange nothing (no-flux walls); every other cell diffuses toroidally.
void diffusion_step(World& world, const DiffusionParams& params = {});

// The spatial gradient of a diffusion field at a cell: a wrapped central
// difference over OPEN neighbours, falling back to a one-sided difference when a
// side is walled (that side carries no flux) and to 0 when both sides are walls.
// Danger increases along +gradient, so an agent flees along -gradient. Cheap and
// allocation-free — safe to call per agent on the tick.
vec3 diffusion_gradient(const Field<float>& f, const MacroGrid& g, int x, int y,
                        int z);

} // namespace giga
