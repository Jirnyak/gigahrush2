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

} // namespace giga
