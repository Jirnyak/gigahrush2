#version 450
#extension GL_GOOGLE_include_directive : require
#include "volumetric_fog.glsl" // только distance_fog(); SSBO-биндинги за ifdef
// wire.vert — pulls verlet points straight from the sim SSBO (no vertex
// buffer): 14 vertices per chain = 7 line segments over 8 points.
// Push block layout = CubePush, shared with the whole pass family.

struct WChain {
    vec4 meta;
    vec4 cur[8];
    vec4 prev[8];
};
layout(std430, set = 0, binding = 0) readonly buffer Wires { WChain c[]; } wb;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
} pc;

layout(location = 0) out float vFog;
layout(location = 1) out vec3 vWorldPos;

// Cable half-width, metres. A camera-facing RIBBON: 1 px lines were invisible
// at any distance (owner's report), so each segment expands to two triangles
// perpendicular to the view.
const float kHalfWidth = 0.022;

vec3 nearest_image(vec3 p, vec3 cam, float per) {
    vec3 d = p - cam;
    return cam + d - per * floor(d / per + 0.5);
}

void main() {
    uint seg = uint(gl_VertexIndex) / 6u;
    uint chain = seg / 7u;
    uint s = seg % 7u;
    uint corner = uint(gl_VertexIndex) % 6u;

    // Dead chain: clip cleanly (the cloth.vert pattern). Collapsing p0 == p1
    // instead sent normalize(cross(vec3(0), v)) — NaN clip coords, UB.
    if (wb.c[chain].meta.y < 0.5) {
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
        vFog = 1.0;
        vWorldPos = vec3(0.0);
        return;
    }

    vec3 p0 = wb.c[chain].cur[s].xyz;
    vec3 p1 = wb.c[chain].cur[s + 1u].xyz;

    // ONE wrap decision per chain — its first point. Per-segment wrapping let
    // neighbouring segments disagree near the seam and the cable tore.
    float per = pc.torus.x;
    vec3 anchor0 = wb.c[chain].cur[0].xyz;
    vec3 shift = nearest_image(anchor0, pc.camPos.xyz, per) - anchor0;
    vec3 w0 = p0 + shift;
    vec3 w1 = p1 + shift;

    vec3 mid = (w0 + w1) * 0.5;
    vec3 viewDir = normalize(mid - pc.camPos.xyz + vec3(1e-5));
    vec3 axis = w1 - w0;
    float axisLen = max(length(axis), 1e-5);
    vec3 side = normalize(cross(axis / axisLen, viewDir)) * kHalfWidth;

    // corners: 0 (w0-s), 1 (w0+s), 2 (w1+s) | 3 (w0-s), 4 (w1+s), 5 (w1-s)
    vec3 world = corner == 0u || corner == 3u ? w0 - side
                 : corner == 1u              ? w0 + side
                 : corner == 5u              ? w1 - side
                                             : w1 + side;

    gl_Position = pc.viewProj * vec4(world, 1.0);
    float dist = length(world - pc.camPos.xyz);
    vFog = distance_fog(dist, pc.fog.x, pc.fog.y);
    vWorldPos = world;
}
