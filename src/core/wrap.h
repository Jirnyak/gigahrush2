// Toroidal wraparound helpers. The macro world wraps on all three axes so
// there are no edges; every coordinate is normalized back into [0, size).
#pragma once
#include <cmath>

#include "core/math.h" // vec3 — the vector forms below are why this include exists

namespace giga {

inline constexpr int wrapi(int v, int size) {
    int m = v % size;
    return m < 0 ? m + size : m;
}

inline float wrapf(float v, float size) {
    float m = std::fmod(v, size);
    return m < 0 ? m + size : m;
}

// Shortest signed delta from a to b on a wrapped axis of the given size.
inline int wrap_delta(int a, int b, int size) {
    int d = b - a;
    if (d > size / 2) d -= size;
    else if (d < -size / 2) d += size;
    return d;
}

// Shortest signed delta from a to b on a wrapped axis of period `period`, in
// continuous coordinates. Branchless, and correct for deltas larger than one
// period (unlike the int form above, which assumes both operands are already
// normalized).
//
// floor(x + 0.5), not round(x): at an exact half-period tie the two images are
// equidistant and either is valid, but GLSL leaves round()'s tie direction
// implementation-defined. floor(x + 0.5) breaks the tie the same way on every
// driver, so the render is reproducible. (The tie is unobservable anyway — fog
// reaches full black at exactly period/2 — but "unobservable" is a weaker
// guarantee than "identical".)
inline float wrap_delta_f(float a, float b, float period) {
    float d = b - a;
    return d - period * std::floor(d / period + 0.5f);
}

// Position of `absPos` at its image nearest `ref` on a wrapped axis. This is the
// **minimal-image rule** the renderer draws by: the world tiles space with this
// period, so geometry is placed at the tile copy closest to the camera rather
// than at its absolute coordinate, which is what keeps the wrap seam out of view
// (see render.md).
//
// The identical expression is implemented in shaders/cube.vert as
// nearest_image(). It is duplicated there because GLSL cannot include this
// header; the pair is a contract, and test_nearest_image in world_test.cpp pins
// this side of it against the branch-based definition.
inline float nearest_image(float absPos, float ref, float period) {
    return ref + wrap_delta_f(ref, absPos, period);
}

// ---- Vector forms — the level the game actually works at --------------------
//
// The audit measured why the torus kept leaking: wrap.h offered only scalars,
// so "toroidal distance between two entities" was three hand-written lines at
// every call site — written 31 times in full, 8 times with an axis forgotten,
// and every forgotten axis was a seam bug (possession, looting, interaction,
// hearing all went blind two metres across a seam;
// markoaudit/systems/05-torus.md §1.2, §7.2). The vector forms make the right
// spelling SHORTER than the wrong one, which is the only fix that holds.
// Rule 8 of tools/check_source_rules.cmake catches new hand-written triples.
//
// No default period: kWorldExtent lives in world/types.h and core must not
// reach up a layer. Callers pass it explicitly.

// Shortest displacement from a to b with every axis wrapped.
inline vec3 wrap_delta3(const vec3& a, const vec3& b, float period) {
    return vec3{wrap_delta_f(a.x, b.x, period), wrap_delta_f(a.y, b.y, period),
                wrap_delta_f(a.z, b.z, period)};
}

// Squared toroidal distance — the form radius comparisons want (no sqrt).
inline float wrap_dist2(const vec3& a, const vec3& b, float period) {
    const vec3 d = wrap_delta3(a, b, period);
    return d.x * d.x + d.y * d.y + d.z * d.z;
}

inline float wrap_dist(const vec3& a, const vec3& b, float period) {
    return std::sqrt(wrap_dist2(a, b, period));
}

// Normalize a position back onto the torus, all three axes.
inline vec3 wrap_pos(const vec3& p, float period) {
    return vec3{wrapf(p.x, period), wrapf(p.y, period), wrapf(p.z, period)};
}

} // namespace giga
