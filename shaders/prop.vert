#version 450
// prop.vert — per-instance vertex stage for arbitrary prop meshes.
//
// Binding 0 (per-vertex):   PropVertex   — local pos + normal
// Binding 1 (per-instance): PropInstance — world origin, yaw, color,
//                            matId, emissive, flags, animPhase

layout(location = 0) in vec3  inPos;       // per-vertex, prop-local space
layout(location = 1) in vec3  inNormal;    // per-vertex, prop-local space
layout(location = 2) in vec3  inOrigin;    // per-instance world base
layout(location = 3) in float inYaw;       // per-instance Y rotation (radians)
layout(location = 4) in vec3  inColor;     // per-instance base colour
layout(location = 5) in uint  inMat;       // per-instance material id (0-30)
layout(location = 6) in uint  inEmissive;  // per-instance emissive byte (0-255)
layout(location = 7) in uint  inFlags;     // per-instance flags bitfield
layout(location = 8) in float inAnimPhase; // per-instance anim phase (R8_UNORM -> 0.0..1.0)
layout(location = 9) in vec3  inScale;     // per-instance local scale (before yaw)

// Shared push-constant block — must match cube.vert / body.vert EXACTLY.
layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = fill-light direction, w = fill strength
    vec4 camPos;   // xyz = camera world pos, w = МЁРТВАЯ ЛЕЙНА (нуль)
    vec4 fog;      // x = fog start, y = fog end, z = МЁРТВАЯ ЛЕЙНА, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent), y = AO direct share, z = tex mask, w = uTime
} pc;

layout(location = 0) out vec3  vNormal;
layout(location = 1) out vec3  vColor;
layout(location = 2) out vec3  vWorldPos;
layout(location = 3) out float vAo;
layout(location = 4) flat out uint  vMat;
layout(location = 5) flat out float vEmissive;
layout(location = 6) flat out uint  vFlags;
layout(location = 7) flat out float vAnimPhase;

// Nearest toroidal image — matches core/wrap.h wrap_delta_f() and cube.vert.
vec3 nearest_image(vec3 absPos, vec3 cam, float p) {
    vec3 d = absPos - cam;
    return cam + d - p * floor(d / p + 0.5);
}

void main() {
    // Z-axis yaw (the world is Z-up — the old Y-axis form was a Y-up legacy
    // and spun wall panels through the VERTICAL plane).
    float c = cos(inYaw);
    float s = sin(inYaw);
    mat3 rot = mat3(
         c,   s,   0.0,
        -s,   c,   0.0,
         0.0, 0.0, 1.0
    );

    vec3 localPos    = rot * (inPos * inScale);
    // Non-uniform scale bends normals by the INVERSE scale (then renormalise).
    vec3 localNormal = rot * normalize(inNormal / max(inScale, vec3(1e-4)));

    // Wrap the INSTANCE ORIGIN once and keep the mesh rigid around it. The
    // old per-vertex wrap tore any mesh longer than ~2 m near the half-period:
    // a 100 m pipe leg's far verts jumped a full period and the triangles
    // stretched into level-crossing ghost beams that came and went with the
    // camera (owner's screenshots, 2026-08-03).
    vec3 world = nearest_image(inOrigin, pc.camPos.xyz, pc.torus.x) + localPos;
    gl_Position = pc.viewProj * vec4(world, 1.0);

    vNormal    = localNormal;
    vColor     = inColor;
    vWorldPos  = world;
    vAo        = 1.0;
    vMat       = inMat;
    vEmissive  = float(inEmissive) / 255.0 * 2.0;
    vFlags     = inFlags;
    vAnimPhase = inAnimPhase * 6.283185307179586; // Map 0..1 to 0..2pi
}
