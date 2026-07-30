#version 450
// prop.vert — per-instance vertex stage for arbitrary prop meshes.
//
// Binding 0 (per-vertex):   PropVertex   — local pos + normal
// Binding 1 (per-instance): PropInstance — world origin, yaw, color,
//                            matId, emissive, flags, animPhase
//
// Outputs match cube.frag varyings exactly so props share the full
// PBR shading path (PBR normal mapping, height fog, headlamp scattering,
// dithering). No extra fragment permutations needed.

layout(location = 0) in vec3  inPos;       // per-vertex, prop-local space
layout(location = 1) in vec3  inNormal;    // per-vertex, prop-local space
layout(location = 2) in vec3  inOrigin;    // per-instance world base
layout(location = 3) in float inYaw;       // per-instance Y rotation (radians)
layout(location = 4) in vec3  inColor;     // per-instance base colour
layout(location = 5) in uint  inMat;       // per-instance material id (0-30)
// Note: emissive/flags/animPhase are in the instance struct bytes
// immediately after matId but not exposed as vertex attributes yet —
// they will be wired via a future UBO once the shader variant is split.

// Shared push-constant block — must match cube.vert / body.vert EXACTLY.
layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = fill-light direction, w = fill strength
    vec4 camPos;   // xyz = camera world pos, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent)
                   // y = AO direct share, z = tex mask, w = normal/roughness mask
} pc;

layout(location = 0) out vec3  vNormal;
layout(location = 1) out vec3  vColor;
layout(location = 2) out vec3  vWorldPos;
layout(location = 3) out float vAo;
layout(location = 4) flat out uint vMat;

// Nearest toroidal image — matches core/wrap.h wrap_delta_f() and cube.vert.
vec3 nearest_image(vec3 absPos, vec3 cam, float p) {
    vec3 d = absPos - cam;
    return cam + d - p * floor(d / p + 0.5);
}

void main() {
    // Y-axis rotation matrix (right-hand, CCW from +Y looking down).
    float c = cos(inYaw);
    float s = sin(inYaw);
    mat3 rot = mat3(
         c,   0.0,  s,
         0.0, 1.0,  0.0,
        -s,   0.0,  c
    );

    vec3 localPos    = rot * inPos;
    vec3 localNormal = rot * inNormal;

    // Place at the nearest toroidal image so props across the seam appear
    // in front of the player instead of at the wrap boundary.
    vec3 world = nearest_image(inOrigin + localPos, pc.camPos.xyz, pc.torus.x);
    gl_Position = pc.viewProj * vec4(world, 1.0);

    vNormal   = localNormal;
    vColor    = inColor;
    vWorldPos = world;

    // Props have no baked AO — they sit on top of the voxel world.
    // vAo=1.0 keeps the (kAoFloor + (1-kAoFloor)*vAo) term at full brightness.
    vAo = 1.0;

    // Flat material id for the const-array surface lookup in cube.frag.
    vMat = inMat;
}
