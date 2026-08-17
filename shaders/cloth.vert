#version 450
#extension GL_GOOGLE_include_directive : require
#include "volumetric_fog.glsl" // только distance_fog(); SSBO-биндинги за ifdef
// cloth.vert — pulls sheet points straight from the sim SSBO (no vertex
// buffer): 7x3 quads x 6 vertices = 126 per sheet over an 8x4 point grid.
// Push block layout = CubePush, shared with the whole pass family.
//
// TORUS LAW: the ANCHOR wraps (point 0 of the sheet), never the vertices.

struct Sheet {
    vec4 meta;
    vec4 cur[32];
    vec4 prev[32];
};
layout(std430, set = 0, binding = 0) readonly buffer Sheets { Sheet s[]; } sb;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
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
    uint vertsPerSheet = uint((W - 1) * (H - 1) * 6);
    uint sheet = uint(gl_VertexIndex) / vertsPerSheet;
    uint v = uint(gl_VertexIndex) % vertsPerSheet;
    uint quad = v / 6u;
    uint corner = v % 6u;
    uint qr = quad / uint(W - 1);
    uint qc = quad % uint(W - 1);

    if (sb.s[sheet].meta.y < 0.5) { // dead sheet: clip
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
        vFog = 0.0;
        vWorldPos = vec3(0.0);
        vNormal = vec3(0.0, 0.0, 1.0);
        return;
    }

    // corners: 0 (r,c) 1 (r,c+1) 2 (r+1,c+1) | 3 (r,c) 4 (r+1,c+1) 5 (r+1,c)
    uint rr = qr + ((corner == 2u || corner == 4u || corner == 5u) ? 1u : 0u);
    uint cc = qc + ((corner == 1u || corner == 2u || corner == 4u) ? 1u : 0u);
    vec3 p = sb.s[sheet].cur[rr * uint(W) + cc].xyz;

    // ONE wrap decision per sheet — its first (pinned) point.
    vec3 anchor0 = sb.s[sheet].cur[0].xyz;
    vec3 shift = nearest_image(anchor0, pc.camPos.xyz, pc.torus.x) - anchor0;
    vec3 world = p + shift;

    // Face normal from the quad's own edges — cheap and flat-shaded.
    vec3 pa = sb.s[sheet].cur[qr * uint(W) + qc].xyz;
    vec3 pb = sb.s[sheet].cur[qr * uint(W) + qc + 1u].xyz;
    vec3 pd = sb.s[sheet].cur[(qr + 1u) * uint(W) + qc].xyz;
    vNormal = normalize(cross(pb - pa, pd - pa) + vec3(1e-6));

    gl_Position = pc.viewProj * vec4(world, 1.0);
    float dist = length(world - pc.camPos.xyz);
    vFog = distance_fog(dist, pc.fog.x, pc.fog.y);
    vWorldPos = world;
}
