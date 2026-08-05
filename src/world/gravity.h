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

// The frame a regime names, spelled in AXIS NUMBERS — regime_down's twin for
// consumers whose arithmetic is per-AXIS rather than per-cell-step. A baker
// that hugs "the face on the up side" (antourage's pipes and hanging wires)
// must not spell that face `z + 1`: it asks the frame which axis is vertical,
// which two are tangent, and which way up is.
//
// `pull` is the honest half of the isotropy law: geometry (which face a thing
// hugs) is a frame question and always answerable, but SAG is a force. Under
// Zero there is no pull, and a hanging thing behaves like it — a cable between
// two anchors is straight, not catenary (owner, 2026-08-04).
struct GravityFrame {
    int axis = 2;            // 0 = X, 1 = Y, 2 = Z — the axis gravity runs on
    int upSign = 1;          // +1 when "up" is +axis (-Z pull => up is +Z)
    int tanA = 0, tanB = 1;  // the other two axes, ascending
    bool pull = true;        // does gravity actually pull along it?
};

// The frame of one axis + one up direction. tanA/tanB are the remaining two
// axes in ascending order, so a consumer's two "horizontals" are stable.
constexpr GravityFrame axis_frame(int axis, int upSign, bool pull) {
    GravityFrame f{};
    f.axis = axis;
    f.upSign = upSign;
    f.tanA = axis == 0 ? 1 : 0;
    f.tanB = axis == 2 ? 1 : 2;
    f.pull = pull;
    return f;
}

// The single frame an AXIS regime declares. Zero and Custom name no axis and
// fall back to the Z frame with pull off — callers that can dress more than one
// frame should use gravity_frames() below instead of decreeing an axis.
constexpr GravityFrame regime_frame(GravityRegime r) {
    const CellStep d = regime_down(r);
    if (d.x != 0) return axis_frame(0, d.x < 0 ? 1 : -1, true);
    if (d.y != 0) return axis_frame(1, d.y < 0 ? 1 : -1, true);
    if (d.z != 0) return axis_frame(2, d.z < 0 ? 1 : -1, true);
    return axis_frame(2, 1, false);
}

// Every frame Zero can declare: three axes x two faces.
inline constexpr int kMaxGravityFrames = 6;

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

// Every frame this field DECLARES, written into `out` (room for
// kMaxGravityFrames); returns how many. Allocation-free, so a baker can ask on
// the stack.
//
// An axis regime declares exactly ONE frame: up is -gravity, and dressing hangs
// from ceilings because that is where gravity says ceilings are. Zero declares
// none — and rather than decreeing an axis (the mistake regime-blind code makes
// silently), it gets all SIX faces, because with no pull "ceiling" and "floor"
// are the same word: a pipe lies along what a heavy floor would call the ground
// exactly as readily as under its ceiling (owner, 2026-08-04). Custom must fall
// back to the vector field, as its own doc-comment says: classify the global
// vector and take that axis; a Custom field whose global part is genuinely zero
// lands on the six-frame answer, which is the right one.
//
// A consumer that spends a BUDGET per frame (walker starts, placement tries)
// divides it by the count: the same total dressing spread over the faces the
// world actually has, never six times as much of it.
inline int gravity_frames(const GravityField& g, GravityFrame* out) {
    GravityRegime r = g.regime;
    if (r == GravityRegime::Custom) r = regime_from_vector(g.global);
    if (r != GravityRegime::Zero) {
        out[0] = regime_frame(r);
        return 1;
    }
    for (int i = 0; i < kMaxGravityFrames; ++i)
        out[i] = axis_frame(i / 2, (i & 1) ? -1 : 1, false);
    return kMaxGravityFrames;
}

} // namespace giga
