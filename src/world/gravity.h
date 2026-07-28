// Vector gravity.
//
// Gravity is a 3D acceleration vector, not a scalar "down". The default pulls
// toward -Z, but a game can point it sideways, invert it, or make it radial by
// swapping the field out per region. The engine keeps one global vector plus an
// optional per-region override hook; physics just reads gravity_at(pos).
#pragma once
#include "core/math.h"

namespace giga {

struct GravityField {
    // Global fallback: classic downward pull along -Z.
    vec3 global{0.0f, 0.0f, -9.81f};

    // Games may install regional gravity by replacing this function pointer.
    // Default returns the global vector everywhere. Kept as a plain function
    // pointer (not std::function) to stay allocation- and exception-free.
    using RegionFn = vec3 (*)(const GravityField&, vec3 pos);
    RegionFn region = nullptr;

    vec3 at(vec3 pos) const { return region ? region(*this, pos) : global; }
};

} // namespace giga
