#version 450
// Instanced unit-cube vertex stage.
//
// Binding 0 (per-vertex): the 8 corners of a unit cube via 36 indices baked as
// raw positions + face normals. Binding 1 (per-instance): the world-space
// origin, scale, and RGB colour of one voxel cluster. One draw call renders the
// whole visible world as N instances of the same cube.
layout(location = 0) in vec3 inPos;      // per-vertex, cube-local [0,1]
layout(location = 1) in vec3 inNormal;   // per-vertex face normal

layout(location = 2) in vec3 inOrigin;   // per-instance world origin
layout(location = 3) in float inScale;   // per-instance edge length
layout(location = 4) in vec3 inColor;    // per-instance base colour

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
} pc;

layout(location = 0) out vec3 vNormal;
layout(location = 1) out vec3 vColor;
// World position, not a precomputed distance: cube.frag needs the vector to the
// camera for the headlamp, and deriving the fog distance from it per-fragment is
// exact where an interpolated distance is not.
layout(location = 2) out vec3 vWorldPos;

void main() {
    vec3 world = inOrigin + inPos * inScale;
    gl_Position = pc.viewProj * vec4(world, 1.0);
    vNormal = inNormal;
    vColor = inColor;
    vWorldPos = world;
}
