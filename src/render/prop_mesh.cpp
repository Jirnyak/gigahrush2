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
// (Procedural mesh builders removed as part of the legacy cleanup)

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
        default:
            std::fprintf(stderr, "[prop] unknown shape %d\n", static_cast<int>(shape));
            return false;
    }

    std::fprintf(stderr, "[prop] shape %d: %zu verts, %zu indices\n",
                 static_cast<int>(shape), verts.size(), indices.size());
    return upload_mesh(dev, verts, indices, out);
}

} // namespace giga::gpu
