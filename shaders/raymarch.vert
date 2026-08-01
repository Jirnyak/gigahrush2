#version 450
// Fullscreen triangle for the raymarch pass — no vertex buffers; three
// oversized corners cover the screen and the DDA runs per-fragment.
layout(location = 0) out vec2 vNdc;

void main() {
    vec2 p = vec2(float((gl_VertexIndex << 1) & 2), float(gl_VertexIndex & 2));
    vNdc = p * 2.0 - 1.0;
    gl_Position = vec4(vNdc, 0.0, 1.0);
}
