#version 450
// Instanced body (box) vertex stage — the population's counterpart to cube.vert.
//
// Binding 0 (per-vertex): the same 36-vertex unit cube [0,1]^3 with face normals
// as the world pass. Binding 1 (per-instance): a body's world-space centre, its
// AABB half-extents, and an RGB tint. One draw call renders the whole crowd as N
// boxes. Reuses cube.frag for shading, so bodies are lit and fogged exactly like
// the world and blend into the toroidal black-fog seam the same way.
layout(location = 0) in vec3 inPos;      // per-vertex, cube-local [0,1]
layout(location = 1) in vec3 inNormal;   // per-vertex face normal

layout(location = 2) in vec3 inCenter;   // per-instance body centre (world)
layout(location = 3) in vec3 inHalf;     // per-instance AABB half-extents
layout(location = 4) in vec3 inColor;    // per-instance tint

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent); unused here, declared so the
                   // block matches cube.vert exactly (shared pipeline layout)
} pc;

layout(location = 0) out vec3 vNormal;
layout(location = 1) out vec3 vColor;
// Must mirror cube.vert exactly — this stage feeds cube.frag (body_pass.cpp
// loads cube.frag.spv), so the varying set is a shared contract.
layout(location = 2) out vec3 vWorldPos;
// AO is a world-geometry term and a body is not world geometry, so bodies write a
// constant 1.0 (unoccluded). This declaration is NOT optional: cube.frag reads
// location 3, and a fragment stage reading a varying no vertex stage writes is
// undefined behaviour, not a compile error. Validation is off in Release, so the
// symptom would be bodies rendering at whatever the driver leaves in the register —
// plausibly correct on this machine and black on the owner's. Silent by
// construction, which is exactly why it is spelled out here.
layout(location = 3) out float vAo;
// Material id for cube.frag's per-material surface families. Same contract as vAo
// and for the same reason: cube.frag reads location 4, so if this stage does not
// write it the value is whatever the driver left in the register — which on this
// machine might happen to be 0 and read as correct, and on the owner's Mac might
// index the family table out of range. `flat` must match cube.vert's declaration
// exactly or the interface is mismatched.
//
// 0 is the air id, which the world pass never draws, so it is free to mean "a body"
// here. Its family is `generic` — the two-octave grain and 2 m seam that bodies
// already had before the families existed — so this change leaves the crowd looking
// exactly as it did.
layout(location = 4) flat out uint vMat;

void main() {
    // Map the [0,1] cube corner onto [-half, +half] around the body centre, so
    // the box spans the AABB exactly (Transform.pos is the centre; AABB is
    // half-extents). Uniform-sign scale keeps the axis-aligned normals valid.
    vec3 world = inCenter + (inPos - 0.5) * (inHalf * 2.0);
    gl_Position = pc.viewProj * vec4(world, 1.0);
    vNormal = inNormal;
    vColor = inColor;
    vWorldPos = world;
    vAo = 1.0;
    vMat = 0u;
}
