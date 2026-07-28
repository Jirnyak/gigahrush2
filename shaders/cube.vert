#version 450
// Instanced unit-cube vertex stage.
//
// Binding 0 (per-vertex): the 8 corners of a unit cube via 36 indices baked as
// raw positions + face normals. Binding 1 (per-instance): the world-space
// origin, scale, and RGB colour of one voxel cluster. One draw call renders the
// whole visible world as N instances of the same cube.
layout(location = 0) in vec3 inPos;      // per-vertex, cube-local [0,1]
layout(location = 1) in vec3 inNormal;   // per-vertex face normal

layout(location = 2) in vec3 inOrigin;   // per-instance ABSOLUTE grid origin
layout(location = 3) in float inScale;   // per-instance edge length
layout(location = 4) in vec3 inColor;    // per-instance base colour

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent)
} pc;

layout(location = 0) out vec3 vNormal;
layout(location = 1) out vec3 vColor;
// World position, not a precomputed distance: cube.frag needs the vector to the
// camera for the headlamp, and deriving the fog distance from it per-fragment is
// exact where an interpolated distance is not.
layout(location = 2) out vec3 vWorldPos;

// Nearest toroidal image of an absolute world position, relative to the camera.
//
// The world tiles space with period `p` on x/y/z, so a cell must be drawn not at
// its absolute grid origin but at the tile copy closest to the camera — that is
// what wraps the far side of the torus into view in front of the player instead
// of leaving the clear colour showing through a seam. Branchless: shift by
// however many whole periods brings the offset into [-p/2, p/2].
//
// This used to run on the CPU, per cell, per frame, inside the instance build.
// Doing it here is what lets CubePass cache its instance buffer at all — the
// instance data no longer depends on where the camera is.
// floor(x + 0.5) rather than round(x): GLSL leaves round()'s behaviour at an
// exact .5 tie implementation-defined, and this must match core/wrap.h
// wrap_delta_f() bit-for-bit on every driver.
vec3 nearest_image(vec3 absPos, vec3 cam, float p) {
    vec3 d = absPos - cam;
    return cam + d - p * floor(d / p + 0.5);
}

void main() {
    vec3 origin = nearest_image(inOrigin, pc.camPos.xyz, pc.torus.x);
    vec3 world = origin + inPos * inScale;
    gl_Position = pc.viewProj * vec4(world, 1.0);
    vNormal = inNormal;
    vColor = inColor;
    vWorldPos = world;
}
