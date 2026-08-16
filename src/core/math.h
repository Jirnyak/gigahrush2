// Tiny math primitives. POD, header-only, no exceptions, no external deps.
// The engine deliberately ships its own math instead of pulling in GLM: the
// surface we need is small, and keeping it here means the core library has no
// third-party include dependencies at all.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace giga {

struct vec2 { float x, y; };
struct vec3 { float x, y, z; };
struct vec4 { float x, y, z, w; };
struct ivec3 { int x, y, z; };
struct ivec4 { int x, y, z, w; };  // push-constant mirror of GLSL ivec4

inline vec3 v3(float x, float y, float z) { return {x, y, z}; }

inline vec3 operator+(vec3 a, vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline vec3 operator-(vec3 a, vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline vec3 operator*(vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline vec3& operator+=(vec3& a, vec3 b) { a = a + b; return a; }

inline float dot(vec3 a, vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline vec3 cross(vec3 a, vec3 b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline float length(vec3 v) { return std::sqrt(dot(v, v)); }
inline vec3 normalize(vec3 v) {
    float l = length(v);
    return l > 1e-6f ? v * (1.0f / l) : vec3{0, 0, 0};
}

inline float clamp01(float v) { return std::clamp(v, 0.0f, 1.0f); }
inline float lerp(float a, float b, float t) { return a + (b - a) * t; }

// Column-major 4x4 matrix (same memory layout GLSL expects for a mat4 uniform).
struct mat4 { float m[16]; };

inline mat4 mat4_identity() {
    mat4 r{}; r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1.0f; return r;
}

inline mat4 mat4_mul(const mat4& a, const mat4& b) {
    mat4 r{};
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j)
            r.m[i * 4 + j] =
                a.m[0 * 4 + j] * b.m[i * 4 + 0] +
                a.m[1 * 4 + j] * b.m[i * 4 + 1] +
                a.m[2 * 4 + j] * b.m[i * 4 + 2] +
                a.m[3 * 4 + j] * b.m[i * 4 + 3];
    return r;
}

// Vulkan clip space: y points down and depth is [0, 1] (not GL's [-1, 1]).
// This emits a right-handed perspective that maps the near plane to z_ndc = 0
// and the far plane to z_ndc = 1, matching a depth buffer cleared to 1.0 with
// VK_COMPARE_OP_LESS. The caller flips Y (proj.m[5]) so world +Z renders up.
inline mat4 mat4_perspective(float fovyRad, float aspect, float zn, float zf) {
    mat4 r{};
    float f = 1.0f / std::tan(fovyRad * 0.5f);
    r.m[0] = f / aspect;
    r.m[5] = f;
    r.m[10] = zf / (zn - zf);          // Vulkan [0, 1] depth
    r.m[11] = -1.0f;
    r.m[14] = (zn * zf) / (zn - zf);
    return r;
}

inline mat4 mat4_lookAt(vec3 eye, vec3 center, vec3 up) {
    vec3 f = normalize(center - eye);
    // A look-at basis is undefined when f is parallel to the reference up: cross()
    // vanishes, normalize() returns {0,0,0}, and every row below collapses. Under a
    // gravity-derived up that is the COMMON case (looking along gravity), not an
    // edge one, so it is handled here rather than at each call site.
    //
    // Tested on the cross itself, not on dot(f, up), because dot is only a valid
    // angle measure when up is unit-length and this is a public primitive. Below
    // the threshold the fallback is the axis in which |f| is SMALLEST: f can be at
    // most 1/sqrt(3) aligned with it, so that cross is always well-conditioned
    // (sin >= 0.816) and no second failure is reachable.
    vec3 axis = cross(f, up);
    if (dot(axis, axis) < 1e-6f) {
        const float ax = std::fabs(f.x), ay = std::fabs(f.y), az = std::fabs(f.z);
        const vec3 alt = (ax <= ay && ax <= az) ? vec3{1, 0, 0}
                       : (ay <= az)             ? vec3{0, 1, 0}
                                                : vec3{0, 0, 1};
        axis = cross(f, alt);
    }
    vec3 s = normalize(axis);
    vec3 u = cross(s, f);
    mat4 r = mat4_identity();
    r.m[0] = s.x; r.m[4] = s.y; r.m[8] = s.z;
    r.m[1] = u.x; r.m[5] = u.y; r.m[9] = u.z;
    r.m[2] = -f.x; r.m[6] = -f.y; r.m[10] = -f.z;
    r.m[12] = -dot(s, eye);
    r.m[13] = -dot(u, eye);
    r.m[14] = dot(f, eye);
    return r;
}

} // namespace giga
