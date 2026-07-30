#include "render/prop_mesh.h"

#include "render/vk_buffer.h"
#include "render/vk_device.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <numbers>
#include <vector>

namespace giga::gpu {

namespace {

constexpr float kPi = std::numbers::pi_v<float>;

// ─────────────────────── helpers ─────────────────────────────────────────────

// Append one quad (two CCW triangles from a,b,c,d viewed from outside).
void push_quad(std::vector<PropVertex>& v, std::vector<uint32_t>& idx,
               vec3 a, vec3 b, vec3 c, vec3 d, vec3 n) {
    uint32_t base = static_cast<uint32_t>(v.size());
    v.push_back({a, n});
    v.push_back({b, n});
    v.push_back({c, n});
    v.push_back({d, n});
    idx.push_back(base + 0); idx.push_back(base + 1); idx.push_back(base + 2);
    idx.push_back(base + 0); idx.push_back(base + 2); idx.push_back(base + 3);
}

// Add a triangle fan cap at height `y`, radius `r`, `segs` sides.
// faceUp=true -> +Y cap, false -> -Y cap.
void push_cap(std::vector<PropVertex>& v, std::vector<uint32_t>& idx,
              float r, float y, int segs, bool faceUp) {
    vec3 cn = {0.0f, faceUp ? 1.0f : -1.0f, 0.0f};
    uint32_t centre = static_cast<uint32_t>(v.size());
    v.push_back({{0.0f, y, 0.0f}, cn});
    for (int i = 0; i <= segs; ++i) {
        float ang = (2.0f * kPi * i) / segs;
        v.push_back({{r * std::cos(ang), y, r * std::sin(ang)}, cn});
    }
    for (int i = 0; i < segs; ++i) {
        uint32_t a = centre + 1 + i;
        uint32_t b = centre + 1 + i + 1;
        if (faceUp) { idx.push_back(centre); idx.push_back(a); idx.push_back(b); }
        else        { idx.push_back(centre); idx.push_back(b); idx.push_back(a); }
    }
}

// Cylinder sides with smooth normals.
void push_cylinder_sides(std::vector<PropVertex>& v, std::vector<uint32_t>& idx,
                         float r, float y0, float y1, int segs,
                         float angStart = 0.0f, float angEnd = 2.0f * kPi) {
    float span = angEnd - angStart;
    for (int i = 0; i < segs; ++i) {
        float a0 = angStart + span * i       / segs;
        float a1 = angStart + span * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        vec3 n0 = {c0, 0.0f, s0};
        vec3 n1 = {c1, 0.0f, s1};
        uint32_t base = static_cast<uint32_t>(v.size());
        v.push_back({{r * c0, y0, r * s0}, n0});
        v.push_back({{r * c0, y1, r * s0}, n0});
        v.push_back({{r * c1, y1, r * s1}, n1});
        v.push_back({{r * c1, y0, r * s1}, n1});
        idx.push_back(base);     idx.push_back(base + 1); idx.push_back(base + 2);
        idx.push_back(base);     idx.push_back(base + 2); idx.push_back(base + 3);
    }
}

// ─────────────────────── shape builders ───────────────────────────────────────

void build_cylinder(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // 16 sides, r=0.30, h=2.00 m
    const float r = 0.30f, h = 2.00f;
    const int segs = 16;
    push_cylinder_sides(v, idx, r, 0.0f, h, segs);
    push_cap(v, idx, r, 0.0f, segs, /*faceUp=*/false);
    push_cap(v, idx, r, h,    segs, /*faceUp=*/true);
}

void build_half_cylinder(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // Half-pipe (0..pi), r=0.40, h=2.00 m
    const float r = 0.40f, h = 2.00f;
    const int segs = 8;
    push_cylinder_sides(v, idx, r, 0.0f, h, segs, 0.0f, kPi);
    // flat back face
    vec3 bn = {0.0f, 0.0f, -1.0f};
    push_quad(v, idx,
              {-r, 0.0f, 0.0f}, {-r, h, 0.0f},
              {r, h, 0.0f}, {r, 0.0f, 0.0f}, bn);
    // bottom half-circle cap
    uint32_t bc = static_cast<uint32_t>(v.size());
    vec3 bot_n = {0.0f, -1.0f, 0.0f};
    v.push_back({{0.0f, 0.0f, 0.0f}, bot_n});
    for (int i = 0; i <= segs; ++i) {
        float a = kPi * i / segs;
        v.push_back({{r * std::cos(a), 0.0f, r * std::sin(a)}, bot_n});
    }
    for (int i = 0; i < segs; ++i) {
        idx.push_back(bc); idx.push_back(bc + 1 + i + 1); idx.push_back(bc + 1 + i);
    }
    // top cap
    uint32_t tc = static_cast<uint32_t>(v.size());
    vec3 top_n = {0.0f, 1.0f, 0.0f};
    v.push_back({{0.0f, h, 0.0f}, top_n});
    for (int i = 0; i <= segs; ++i) {
        float a = kPi * i / segs;
        v.push_back({{r * std::cos(a), h, r * std::sin(a)}, top_n});
    }
    for (int i = 0; i < segs; ++i) {
        idx.push_back(tc); idx.push_back(tc + 1 + i); idx.push_back(tc + 1 + i + 1);
    }
}

void build_arch(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // Arch: extruded half-ring, outer r=1.0 inner r=0.6, depth=0.5 m, 16 angular
    const float rOuter = 1.0f, rInner = 0.6f, depth = 0.5f;
    const int segs = 16;
    // Front face (z=0), back face (z=-depth), and connecting side quads
    for (int i = 0; i < segs; ++i) {
        float a0 = kPi * i       / segs;
        float a1 = kPi * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        // Front face
        vec3 fn = {0.0f, 0.0f, 1.0f};
        push_quad(v, idx,
                  {rInner * c0, rInner * s0, 0.0f},
                  {rOuter * c0, rOuter * s0, 0.0f},
                  {rOuter * c1, rOuter * s1, 0.0f},
                  {rInner * c1, rInner * s1, 0.0f}, fn);
        // Back face
        vec3 bn = {0.0f, 0.0f, -1.0f};
        push_quad(v, idx,
                  {rInner * c1, rInner * s1, -depth},
                  {rOuter * c1, rOuter * s1, -depth},
                  {rOuter * c0, rOuter * s0, -depth},
                  {rInner * c0, rInner * s0, -depth}, bn);
        // Outer curved face
        vec3 on = {(c0 + c1) * 0.5f, (s0 + s1) * 0.5f, 0.0f};
        push_quad(v, idx,
                  {rOuter * c0, rOuter * s0, 0.0f},
                  {rOuter * c0, rOuter * s0, -depth},
                  {rOuter * c1, rOuter * s1, -depth},
                  {rOuter * c1, rOuter * s1, 0.0f}, on);
        // Inner curved face (facing inward)
        vec3 in_n = {-(c0 + c1) * 0.5f, -(s0 + s1) * 0.5f, 0.0f};
        push_quad(v, idx,
                  {rInner * c1, rInner * s1, 0.0f},
                  {rInner * c1, rInner * s1, -depth},
                  {rInner * c0, rInner * s0, -depth},
                  {rInner * c0, rInner * s0, 0.0f}, in_n);
    }
    // Left end cap (at angle=pi)
    vec3 lcap = {-1.0f, 0.0f, 0.0f};
    push_quad(v, idx,
              {-rInner, 0.0f, 0.0f}, {-rInner, 0.0f, -depth},
              {-rOuter, 0.0f, -depth}, {-rOuter, 0.0f, 0.0f}, lcap);
    // Right end cap (at angle=0)
    vec3 rcap = {1.0f, 0.0f, 0.0f};
    push_quad(v, idx,
              {rOuter, 0.0f, 0.0f}, {rOuter, 0.0f, -depth},
              {rInner, 0.0f, -depth}, {rInner, 0.0f, 0.0f}, rcap);
}

void build_barrel(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // 12-sided barrel with slight taper: top/bottom ring r=0.28, mid ring r=0.35
    const int segs = 12;
    const float rMid = 0.35f, rEdge = 0.28f, h = 0.80f, hMid = h * 0.5f;
    // Lower half
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        vec3 n = {(c0 + c1) * 0.5f, 0.0f, (s0 + s1) * 0.5f};
        uint32_t base = static_cast<uint32_t>(v.size());
        // Bottom edge -> mid bulge
        v.push_back({{rEdge * c0, 0.0f,  rEdge * s0}, n});
        v.push_back({{rEdge * c0, 0.05f, rEdge * s0}, n});
        v.push_back({{rMid  * c0, hMid,  rMid  * s0}, n});
        v.push_back({{rEdge * c1, 0.0f,  rEdge * s1}, n});
        v.push_back({{rEdge * c1, 0.05f, rEdge * s1}, n});
        v.push_back({{rMid  * c1, hMid,  rMid  * s1}, n});
        // Two quads per side
        idx.push_back(base+0); idx.push_back(base+1); idx.push_back(base+4);
        idx.push_back(base+0); idx.push_back(base+4); idx.push_back(base+3);
        idx.push_back(base+1); idx.push_back(base+2); idx.push_back(base+5);
        idx.push_back(base+1); idx.push_back(base+5); idx.push_back(base+4);
    }
    // Upper half (mirrored)
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        vec3 n = {(c0 + c1) * 0.5f, 0.0f, (s0 + s1) * 0.5f};
        uint32_t base = static_cast<uint32_t>(v.size());
        v.push_back({{rMid  * c0, hMid,         rMid  * s0}, n});
        v.push_back({{rEdge * c0, h - 0.05f,    rEdge * s0}, n});
        v.push_back({{rEdge * c0, h,             rEdge * s0}, n});
        v.push_back({{rMid  * c1, hMid,         rMid  * s1}, n});
        v.push_back({{rEdge * c1, h - 0.05f,    rEdge * s1}, n});
        v.push_back({{rEdge * c1, h,             rEdge * s1}, n});
        idx.push_back(base+0); idx.push_back(base+1); idx.push_back(base+4);
        idx.push_back(base+0); idx.push_back(base+4); idx.push_back(base+3);
        idx.push_back(base+1); idx.push_back(base+2); idx.push_back(base+5);
        idx.push_back(base+1); idx.push_back(base+5); idx.push_back(base+4);
    }
    push_cap(v, idx, rEdge, 0.0f, segs, /*faceUp=*/false);
    push_cap(v, idx, rEdge, h,    segs, /*faceUp=*/true);
}

void build_stair_step(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // Wedge: 2.0 m wide (X), 0.40 m deep (Z), 0.25 m high (Y)
    // Top surface is sloped: front edge at y=0, back edge at y=0.25
    const float w = 2.0f, d = 0.40f, rh = 0.25f;
    // Top (sloped) face
    push_quad(v, idx,
              {0.0f, 0.0f, 0.0f}, {w, 0.0f, 0.0f},
              {w, rh, d},         {0.0f, rh, d},
              {0.0f, 1.0f, -0.53f}); // approx slope normal normalised
    // Bottom face
    push_quad(v, idx,
              {0.0f, 0.0f, d}, {w, 0.0f, d},
              {w, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f},
              {0.0f, -1.0f, 0.0f});
    // Front face (z=0)
    push_quad(v, idx,
              {w, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f},
              {0.0f, 0.0f, 0.0f}, {w, 0.0f, 0.0f},
              {0.0f, 0.0f, -1.0f});
    // Back face (z=d)
    push_quad(v, idx,
              {0.0f, rh, d}, {w, rh, d},
              {w, 0.0f, d}, {0.0f, 0.0f, d},
              {0.0f, 0.0f, 1.0f});
    // Left face (x=0)
    push_quad(v, idx,
              {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, d},
              {0.0f, rh, d}, {0.0f, 0.0f, 0.0f},
              {-1.0f, 0.0f, 0.0f});
    // Right face (x=w)
    push_quad(v, idx,
              {w, 0.0f, d}, {w, 0.0f, 0.0f},
              {w, 0.0f, 0.0f}, {w, 0.0f, d},
              {1.0f, 0.0f, 0.0f});
}

void build_pipe(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // Horizontal pipe segment: r=0.15, length=2.0 m along X axis
    const float r = 0.15f, len = 2.0f;
    const int segs = 10;
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        vec3 n0 = {0.0f, c0, s0};
        vec3 n1 = {0.0f, c1, s1};
        uint32_t base = static_cast<uint32_t>(v.size());
        v.push_back({{0.0f, r * c0, r * s0}, n0});
        v.push_back({{len,  r * c0, r * s0}, n0});
        v.push_back({{len,  r * c1, r * s1}, n1});
        v.push_back({{0.0f, r * c1, r * s1}, n1});
        idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
        idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
    }
    // End caps
    uint32_t lc = static_cast<uint32_t>(v.size());
    vec3 ln = {-1.0f, 0.0f, 0.0f};
    v.push_back({{0.0f, 0.0f, 0.0f}, ln});
    for (int i = 0; i <= segs; ++i) {
        float a = 2.0f * kPi * i / segs;
        v.push_back({{0.0f, r * std::cos(a), r * std::sin(a)}, ln});
    }
    for (int i = 0; i < segs; ++i) {
        idx.push_back(lc); idx.push_back(lc+1+i+1); idx.push_back(lc+1+i);
    }
    uint32_t rc = static_cast<uint32_t>(v.size());
    vec3 rn = {1.0f, 0.0f, 0.0f};
    v.push_back({{len, 0.0f, 0.0f}, rn});
    for (int i = 0; i <= segs; ++i) {
        float a = 2.0f * kPi * i / segs;
        v.push_back({{len, r * std::cos(a), r * std::sin(a)}, rn});
    }
    for (int i = 0; i < segs; ++i) {
        idx.push_back(rc); idx.push_back(rc+1+i); idx.push_back(rc+1+i+1);
    }
}

// ─────────────────────── upload to GPU ───────────────────────────────────────

bool upload_mesh(const VulkanDevice& dev,
                 const std::vector<PropVertex>& verts,
                 const std::vector<uint32_t>& indices,
                 PropMesh& out) {
    VulkanBuffer vb, ib;
    if (!vb.create_device_local(dev, verts.data(),
                                verts.size() * sizeof(PropVertex),
                                VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                                "prop-vertex"))
        return false;
    if (!ib.create_device_local(dev, indices.data(),
                                indices.size() * sizeof(uint32_t),
                                VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
                                "prop-index")) {
        vb.destroy(dev);
        return false;
    }
    out.vertexBuffer = vb.buffer;
    out.vertexMem    = vb.memory;
    out.indexBuffer  = ib.buffer;
    out.indexMem     = ib.memory;
    out.indexCount   = static_cast<uint32_t>(indices.size());
    return true;
}

} // namespace

// ─────────────────────── public API ──────────────────────────────────────────

void PropMesh::destroy(VkDevice dev) {
    if (vertexBuffer) { vkDestroyBuffer(dev, vertexBuffer, nullptr); vertexBuffer = VK_NULL_HANDLE; }
    if (vertexMem)    { vkFreeMemory(dev, vertexMem, nullptr);       vertexMem    = VK_NULL_HANDLE; }
    if (indexBuffer)  { vkDestroyBuffer(dev, indexBuffer, nullptr);  indexBuffer  = VK_NULL_HANDLE; }
    if (indexMem)     { vkFreeMemory(dev, indexMem, nullptr);        indexMem     = VK_NULL_HANDLE; }
    indexCount = 0;
}

bool build_prop_mesh(PropShape shape, const VulkanDevice& dev, PropMesh& out) {
    std::vector<PropVertex> verts;
    std::vector<uint32_t>   indices;
    verts.reserve(256);
    indices.reserve(512);

    switch (shape) {
        case PropShape::Cylinder:     build_cylinder(verts, indices);     break;
        case PropShape::HalfCylinder: build_half_cylinder(verts, indices); break;
        case PropShape::Arch:         build_arch(verts, indices);         break;
        case PropShape::Barrel:       build_barrel(verts, indices);       break;
        case PropShape::StairStep:    build_stair_step(verts, indices);   break;
        case PropShape::Pipe:         build_pipe(verts, indices);         break;
        default:
            std::fprintf(stderr, "[prop] unknown shape %d\n",
                         static_cast<int>(shape));
            return false;
    }

    std::fprintf(stderr, "[prop] shape %d: %zu verts, %zu indices\n",
                 static_cast<int>(shape), verts.size(), indices.size());
    return upload_mesh(dev, verts, indices, out);
}

} // namespace giga::gpu
