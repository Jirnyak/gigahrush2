#version 450
// particle.vert — Billboard vertex shader for GPU compute particles.
//
// Input: vertices written by particles.comp into the VertexOutputSSBO,
// bound as a regular vertex buffer. Each particle emits 6 vertices (2 tris).
//
// Billboard expansion: the shader reads the world position and half-size from
// posSize.xyz/w, then expands corners in view space using the camera right
// and up vectors passed via push constants. This gives view-aligned billboards
// that always face the camera without a matrix inverse.
//
// UV (-1..+1) is passed through to particle.frag for the soft-circle SDF.

layout(location = 0) in vec4 inPosSize;    // xyz = world pos, w = half-size
layout(location = 1) in vec4 inColorAlpha; // rgb = color, a = alpha
layout(location = 2) in vec2 inUV;         // -1..+1 billboard corner

layout(location = 0) out vec4  vColorAlpha;
layout(location = 1) out vec2  vUV;
layout(location = 2) out float vFog;

layout(push_constant) uniform Push {
    mat4  viewProj;
    vec4  camPos;     // xyz = camera world position
    vec4  camRight;   // xyz = camera right vector (world space)
    vec4  camUp;      // xyz = camera up vector (world space)
    vec4  fog;        // x = fogStart, y = fogEnd
} pc;

void main() {
    vec3 worldCenter = inPosSize.xyz;
    float halfSize   = inPosSize.w;

    // Expand corner in view-aligned world space
    vec3 corner = worldCenter
                + inUV.x * halfSize * pc.camRight.xyz
                + inUV.y * halfSize * pc.camUp.xyz;

    gl_Position = pc.viewProj * vec4(corner, 1.0);

    vColorAlpha = inColorAlpha;
    vUV         = inUV;

    // Fog factor (linear)
    float d = length(worldCenter - pc.camPos.xyz);
    vFog = clamp((d - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
}
