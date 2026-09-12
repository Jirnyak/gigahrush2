#version 450
#extension GL_GOOGLE_include_directive : require
#include "volumetric_fog.glsl" // только distance_fog(); SSBO-биндинги за ifdef
// particle.vert — camera-facing billboards pulled straight from the SoA
// VERLET POOL (stage-2 merge, 2026-09-01): the particle bank lives at a fixed
// base after the antourage span, aux (tint/phys/life-total) rides binding 4.
// 6 vertices per particle, one quad. Dead particles (life <= 0, in prev.w
// since the pool relayout) clip to 1e9, same trick as dead wire chains.
// Push = CubePush + VerletDrawPush (family layout; the bank numbers are
// unused here — the particle base is a compile-time lockstep constant).
//
// TORUS LAW ([prop.vert]): the ANCHOR wraps, never the vertices — one
// nearest_image per particle, corners offset after.

struct Pt {
    vec4 cur;
    vec4 prev;
};
layout(std430, set = 0, binding = 0) readonly buffer Points { Pt p[]; } pb;
// Aux bank: [pid*3+0] colorSize, [pid*3+1] phys, [pid*3+2] meta(lifeTotal).
layout(std430, set = 0, binding = 4) readonly buffer Aux { vec4 a[]; } ax;

// LOCKSTEP with gpu::kParticlePointBase (render/verlet_pass.h).
const uint kParticleBase = 1048576u;

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

layout(location = 0) out vec3 vColor;
layout(location = 1) out vec3 vMisc; // x fog, y emissive 0..1, z alpha
layout(location = 2) out vec2 vUv;
layout(location = 3) out vec3 vWorldPos;

vec3 nearest_image(vec3 p, vec3 cam, float per) {
    vec3 d = p - cam;
    return cam + d - per * floor(d / per + 0.5);
}

void main() {
    uint id = uint(gl_VertexIndex) / 6u;
    uint corner = uint(gl_VertexIndex) % 6u;
    uint i = kParticleBase + id;

    float life = pb.p[i].prev.w;
    if (life <= 0.0) {
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
        vColor = vec3(0.0);
        vMisc = vec3(0.0);
        vUv = vec2(0.0);
        vWorldPos = vec3(0.0);
        return;
    }

    vec4 colorSize = ax.a[id * 3u + 0u];
    vec3 centre = nearest_image(pb.p[i].cur.xyz, pc.camPos.xyz, pc.torus.x);
    float halfEdge = colorSize.w * 0.5;

    vec3 viewDir = normalize(centre - pc.camPos.xyz + vec3(1e-5));
    vec3 upRef = abs(viewDir.z) > 0.99 ? vec3(1.0, 0.0, 0.0)
                                       : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(cross(viewDir, upRef)) * halfEdge;
    vec3 up = normalize(cross(right, viewDir)) * halfEdge;

    // corners: 0 (-,-) 1 (+,-) 2 (+,+) | 3 (-,-) 4 (+,+) 5 (-,+)
    vec2 c = corner == 0u || corner == 3u ? vec2(-1.0, -1.0)
             : corner == 1u              ? vec2(1.0, -1.0)
             : corner == 5u              ? vec2(-1.0, 1.0)
                                         : vec2(1.0, 1.0);
    vec3 world = centre + right * c.x + up * c.y;

    gl_Position = pc.viewProj * vec4(world, 1.0);

    float lifeTotal = max(ax.a[id * 3u + 2u].x, 1e-3);
    // Fade over the last third of life — spawn is full-strength immediately.
    float alpha = clamp(life / (lifeTotal * 0.33), 0.0, 1.0);

    float dist = length(world - pc.camPos.xyz);
    float fogF = distance_fog(dist, pc.fog.x, pc.fog.y);

    vColor = colorSize.rgb;
    vMisc = vec3(fogF, ax.a[id * 3u + 1u].w / 255.0, alpha);
    vUv = c;
    vWorldPos = world;
}
