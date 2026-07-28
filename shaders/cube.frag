#version 450
// Simple lit shading: one directional sun + a fixed ambient term, using the
// per-face normal so cube faces read as distinct planes.
layout(location = 0) in vec3 vNormal;
layout(location = 1) in vec3 vColor;
layout(location = 2) in float vViewDist;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;
    vec4 camPos;
    vec4 fog;   // x = fog start dist, y = fog end dist
} pc;

layout(location = 0) out vec4 outColor;

void main() {
    vec3 n = normalize(vNormal);
    float ndl = max(dot(n, normalize(pc.sunDir.xyz)), 0.0);
    float ambient = 0.35;
    float light = ambient + (1.0 - ambient) * ndl;
    vec3 lit = vColor * light;

    // Distance fog to black. Everything past fog.y is fully black, which is
    // exactly the toroidal minimal-image radius (kWorldExtent/2), so the seam
    // where the far side of the world wraps into view is never visible: it is
    // already swallowed by fog. Fades from fog.x → fog.y.
    float fog = clamp((vViewDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3),
                      0.0, 1.0);
    outColor = vec4(mix(lit, vec3(0.0), fog), 1.0);
}
