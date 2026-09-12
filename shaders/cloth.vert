#version 450
#extension GL_GOOGLE_include_directive : require
#include "volumetric_fog.glsl" // только distance_fog(); SSBO-биндинги за ifdef
// cloth.vert — pulls sheet points straight from the SoA pool (no vertex
// buffer). INSTANCED since the pool relayout (2026-08-31): one instance per
// sheet (gl_InstanceIndex), 7x3 quads x 6 = 126 vertices over an 8x4 grid.
// Push = CubePush + VerletDrawPush, see wire.vert.
//
// TORUS LAW: the ANCHOR wraps (point 0 of the sheet), never the vertices.

struct Pt {
    vec4 cur;
    vec4 prev;
};
layout(std430, set = 0, binding = 0) readonly buffer Points { Pt p[]; } pb;
layout(std430, set = 0, binding = 1) readonly buffer Elems { vec4 e[]; } el;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
    uint clothPointBase;
    uint wireElemCount;
    uint pad0;
    uint pad1;
} pc;

layout(location = 0) out float vFog;
layout(location = 1) out vec3 vWorldPos;
layout(location = 2) out vec3 vNormal;

const int W = 8;
const int H = 4;

vec3 nearest_image(vec3 p, vec3 cam, float per) {
    vec3 d = p - cam;
    return cam + d - per * floor(d / per + 0.5);
}

void main() {
    uint sheet = uint(gl_InstanceIndex);
    uint v = uint(gl_VertexIndex);
    uint quad = v / 6u;
    uint corner = v % 6u;
    uint qr = quad / uint(W - 1);
    uint qc = quad % uint(W - 1);
    uint base = pc.clothPointBase + sheet * uint(W * H);

    if (el.e[pc.wireElemCount + sheet].z < 0.5) { // dead sheet: clip
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
        vFog = 0.0;
        vWorldPos = vec3(0.0);
        vNormal = vec3(0.0, 0.0, 1.0);
        return;
    }

    // corners: 0 (r,c) 1 (r,c+1) 2 (r+1,c+1) | 3 (r,c) 4 (r+1,c+1) 5 (r+1,c)
    uint rr = qr + ((corner == 2u || corner == 4u || corner == 5u) ? 1u : 0u);
    uint cc = qc + ((corner == 1u || corner == 2u || corner == 4u) ? 1u : 0u);
    vec3 p = pb.p[base + rr * uint(W) + cc].cur.xyz;

    // ONE wrap decision per sheet — its first (pinned) point.
    vec3 anchor0 = pb.p[base].cur.xyz;
    vec3 shift = nearest_image(anchor0, pc.camPos.xyz, pc.torus.x) - anchor0;
    vec3 world = p + shift;

    // Face normal from the quad's own edges — cheap and flat-shaded.
    vec3 pa = pb.p[base + qr * uint(W) + qc].cur.xyz;
    vec3 pbv = pb.p[base + qr * uint(W) + qc + 1u].cur.xyz;
    vec3 pd = pb.p[base + (qr + 1u) * uint(W) + qc].cur.xyz;
    vNormal = normalize(cross(pbv - pa, pd - pa) + vec3(1e-6));

    gl_Position = pc.viewProj * vec4(world, 1.0);
    float dist = length(world - pc.camPos.xyz);
    vFog = distance_fog(dist, pc.fog.x, pc.fog.y);
    vWorldPos = world;
}
