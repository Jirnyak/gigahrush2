#version 450
#extension GL_GOOGLE_include_directive : require
#include "volumetric_fog.glsl" // только distance_fog(); SSBO-биндинги за ifdef
// shard.vert — черепки GpuHandoff (инкр. 5): ОДИН сегмент-лента на инстанс
// из ПАРЫ верле-точек банка осколков (та же камеро-ориентированная лента,
// что wire.vert, но короткая, толстая и с материальным цветом из элемента).
// Мёртвый черепок (жизнь prev.w <= 0) клипается в 1e9.
// Push = CubePush + VerletDrawPush (банковые числа не нужны — базы осколков
// компил-тайм локстеп с gpu::kShardPointBase/kShardElemBase).

struct Pt {
    vec4 cur;
    vec4 prev;
};
layout(std430, set = 0, binding = 0) readonly buffer Points { Pt p[]; } pb;
layout(std430, set = 0, binding = 1) readonly buffer Elems { vec4 e[]; } el;

const uint kShardBase = 1048576u - 2048u;
const uint kShardElem = 131072u - 1024u;

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
layout(location = 2) out vec3 vColor;

vec3 nearest_image(vec3 p, vec3 cam, float per) {
    vec3 d = p - cam;
    return cam + d - per * floor(d / per + 0.5);
}

void main() {
    uint slot = uint(gl_InstanceIndex);
    uint corner = uint(gl_VertexIndex) % 6u;
    uint base = kShardBase + slot * 2u;
    vec4 elem = el.e[kShardElem + slot];

    float life = pb.p[base].prev.w;
    if (life <= 0.0 || elem.z < 0.5) {
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
        vFog = 1.0;
        vWorldPos = vec3(0.0);
        vColor = vec3(0.0);
        return;
    }

    // ONE wrap decision per shard — its first point.
    float per = pc.torus.x;
    vec3 p0 = pb.p[base].cur.xyz;
    vec3 p1 = pb.p[base + 1u].cur.xyz;
    vec3 shift = nearest_image(p0, pc.camPos.xyz, per) - p0;
    vec3 w0 = p0 + shift;
    vec3 w1 = p1 + shift;

    vec3 mid = (w0 + w1) * 0.5;
    vec3 viewDir = normalize(mid - pc.camPos.xyz + vec3(1e-5));
    vec3 axis = w1 - w0;
    float axisLen = max(length(axis), 1e-5);
    // Толщина черепка выведена от его длины (пропорция обломка ~0.35).
    vec3 side = normalize(cross(axis / axisLen, viewDir)) * (elem.x * 0.35);

    vec3 world = corner == 0u || corner == 3u ? w0 - side
                 : corner == 1u              ? w0 + side
                 : corner == 5u              ? w1 - side
                                             : w1 + side;

    gl_Position = pc.viewProj * vec4(world, 1.0);
    float dist = length(world - pc.camPos.xyz);
    vFog = distance_fog(dist, pc.fog.x, pc.fog.y);
    vWorldPos = world;
    // Материальный цвет пропа, упакованный спавном в elem.y (8:8:8).
    uint rgb = floatBitsToUint(elem.y);
    vColor = vec3(float(rgb & 0xFFu), float((rgb >> 8u) & 0xFFu),
                  float((rgb >> 16u) & 0xFFu)) / 255.0;
}
