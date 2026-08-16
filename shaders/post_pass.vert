#version 450

layout(location = 0) out vec2 vNdc;
layout(location = 1) out vec2 vUv;

void main() {
    // Generate fullscreen triangle from vertex index 0, 1, 2:
    // 0: NDC (-1, -1), UV (0, 0)
    // 1: NDC ( 3, -1), UV (2, 0)
    // 2: NDC (-1,  3), UV (0, 2)
    vec2 p = vec2(float((gl_VertexIndex << 1) & 2), float(gl_VertexIndex & 2));
    vNdc = p * 2.0 - 1.0;
    vUv = p;
    gl_Position = vec4(vNdc, 0.0, 1.0);
}
