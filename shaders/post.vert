#version 450

void main() {
    // Generate a fullscreen triangle:
    // gl_VertexIndex 0 -> uv(0,0), pos(-1,-1)
    // gl_VertexIndex 1 -> uv(2,0), pos( 3,-1)
    // gl_VertexIndex 2 -> uv(0,2), pos(-1, 3)
    vec2 uv = vec2((gl_VertexIndex << 1) & 2, gl_VertexIndex & 2);
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
