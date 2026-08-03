#version 450
// particle.vert — camera-facing billboards pulled straight from the particle
// pool SSBO (no vertex buffer): 6 vertices per particle, one quad. Dead
// particles (life <= 0) clip to 1e9, same trick as dead wire chains.
// Push block layout = CubePush, shared with the whole pass family.
//
// TORUS LAW ([prop.vert]): the ANCHOR wraps, never the vertices — one
// nearest_image per particle, corners offset after.

struct Particle {
    vec4 posLife;
    vec4 velTotal;
    vec4 colorSize;
    vec4 phys;
};
layout(std430, set = 0, binding = 0) readonly buffer Pool { Particle p[]; } pb;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;
    vec4 torus;
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

    float life = pb.p[id].posLife.w;
    if (life <= 0.0) {
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
        vColor = vec3(0.0);
        vMisc = vec3(0.0);
        vUv = vec2(0.0);
        vWorldPos = vec3(0.0);
        return;
    }

    vec3 centre =
        nearest_image(pb.p[id].posLife.xyz, pc.camPos.xyz, pc.torus.x);
    float halfEdge = pb.p[id].colorSize.w * 0.5;

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

    float lifeTotal = max(pb.p[id].velTotal.w, 1e-3);
    // Fade over the last third of life — spawn is full-strength immediately.
    float alpha = clamp(life / (lifeTotal * 0.33), 0.0, 1.0);

    float dist = length(world - pc.camPos.xyz);
    float fogF = clamp((dist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3),
                       0.0, 1.0);

    vColor = pb.p[id].colorSize.rgb;
    vMisc = vec3(fogF, pb.p[id].phys.w / 255.0, alpha);
    vUv = c;
    vWorldPos = world;
}
