// Vector gravity.
//
// Gravity is a 3D acceleration vector, not a scalar "down". The default pulls
// toward -Z, but a game can point it sideways, invert it, or make it radial by
// swapping the field out per region. The engine keeps one global vector plus an
// optional per-region override hook; physics just reads gravity_at(pos).
#pragma once
#include <cstdint>

#include "core/math.h"

namespace giga {

// The QUANTIZED gravity frame — the 8 numbers everything cheap keys on.
//
// The engine is isotropic: X, Y and Z are equal citizens (the torus wraps all
// three), and gravity is the ONLY thing that ever breaks that symmetry — always
// emergently, never structurally. Systems that would be O(N) or worse against
// the full vector field (nav baking, spawn placement, arrival cells, fluid's
// down axis) key on this enum instead: a floor module DECLARES its regime, the
// consumer resolves "down" once, and the arithmetic stays axis-generic.
// Physics keeps reading the full vector field (regional overrides included);
// Custom is the honest fallback when a floor's gravity is not one axis.
enum class GravityRegime : std::uint8_t {
    NegX, PosX, NegY, PosY, NegZ, PosZ,
    Zero,   // no gravity: every air cell is valid ground, agents fly
    Custom, // mixed/regional: consumers must fall back to the vector field
};

// One cell-step toward "down" for a regime. Zero/Custom step nowhere.
struct CellStep {
    int x = 0, y = 0, z = 0;
};
constexpr CellStep regime_down(GravityRegime r) {
    switch (r) {
    case GravityRegime::NegX: return {-1, 0, 0};
    case GravityRegime::PosX: return {1, 0, 0};
    case GravityRegime::NegY: return {0, -1, 0};
    case GravityRegime::PosY: return {0, 1, 0};
    case GravityRegime::NegZ: return {0, 0, -1};
    case GravityRegime::PosZ: return {0, 0, 1};
    default:                  return {0, 0, 0};
    }
}

// Classify a vector into the regime its dominant axis names; near-zero is Zero.
inline GravityRegime regime_from_vector(vec3 g) {
    const float ax = g.x < 0 ? -g.x : g.x;
    const float ay = g.y < 0 ? -g.y : g.y;
    const float az = g.z < 0 ? -g.z : g.z;
    if (ax < 1e-4f && ay < 1e-4f && az < 1e-4f) return GravityRegime::Zero;
    if (ax >= ay && ax >= az)
        return g.x < 0 ? GravityRegime::NegX : GravityRegime::PosX;
    if (ay >= az) return g.y < 0 ? GravityRegime::NegY : GravityRegime::PosY;
    return g.z < 0 ? GravityRegime::NegZ : GravityRegime::PosZ;
}

struct GravityField {
    // Global fallback: classic downward pull along -Z.
    vec3 global{0.0f, 0.0f, -9.81f};

    // The quantized regime consumers key on. RUNTIME STATE, not generation
    // config: the floor module writes it when it builds the world, and the game
    // may flip it mid-run (a samosbor variant, a console command) — gravity's
    // direction is CONTEXT, one of the 8 values, and any background re-baking
    // reads it like any other input. Keep it and `global`
    // in agreement (regime_from_vector) when changing either.
    GravityRegime regime = GravityRegime::NegZ;

    // Games may install regional gravity by replacing this function pointer.
    // Default returns the global vector everywhere. Kept as a plain function
    // pointer (not std::function) to stay allocation- and exception-free.
    using RegionFn = vec3 (*)(const GravityField&, vec3 pos);
    RegionFn region = nullptr;

    vec3 at(vec3 pos) const { return region ? region(*this, pos) : global; }
};

} // namespace giga
