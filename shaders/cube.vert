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
    vec4 sunDir;   // xyz = direction toward the sun
    vec4 camPos;   // xyz = camera world position
    vec4 fog;      // x = fog start, y = fog end
} pc;

layout(location = 0) out vec3 vNormal;
layout(location = 1) out vec3 vColor;
layout(location = 2) out float vViewDist;

void main() {
    vec3 world = inOrigin + inPos * inScale;
    gl_Position = pc.viewProj * vec4(world, 1.0);
    vNormal = inNormal;
    vColor = inColor;
    vViewDist = distance(world, pc.camPos.xyz);
}
