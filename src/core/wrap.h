// Toroidal wraparound helpers. The macro world wraps on all three axes so
// there are no edges; every coordinate is normalized back into [0, size).
#pragma once
#include <cmath>

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

} // namespace giga
