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

// Swizzle a local (axis, u, v) triple into xyz with the cylinder axis on
// `axis` (0=x, 1=y, 2=z). One generator, three oriented meshes.
vec3 ax(int axis, float a, float u, float v) {
    switch (axis) {
        case 0:  return {a, u, v};
        case 1:  return {u, a, v};
        default: return {u, v, a};
    }
}

// Unit FLAT-SHADED 8-gon cylinder along `axis`: length 1 (a in +-0.5), radius
// 0.5. Every facet carries its own face normal — hard edges by construction.
void push_cylinder(std::vector<PropVertex>& v, std::vector<uint32_t>& idx,
                   int axis, int segs = 8) {
    const float r = 0.5f;
    // The (a, u, v) -> xyz swizzle for axis 1 is an ODD permutation — it
    // mirrors orientation, so its winding must flip or the whole Y cylinder
    // renders inside-out (measured on axes 0/2 first: sides low->high order
    // back-face-culled away and only the elbow boxes drew).
    const bool flip = axis == 1;
    for (int i = 0; i < segs; ++i) {
        const float a0 = (2.0f * kPi * i) / segs;
        const float a1 = (2.0f * kPi * (i + 1)) / segs;
        const float am = 0.5f * (a0 + a1);
        const vec3 n = ax(axis, 0.0f, std::cos(am), std::sin(am));
        const vec3 q0 = ax(axis, -0.5f, r * std::cos(a0), r * std::sin(a0));
        const vec3 q1 = ax(axis, -0.5f, r * std::cos(a1), r * std::sin(a1));
        const vec3 q2 = ax(axis, 0.5f, r * std::cos(a1), r * std::sin(a1));
        const vec3 q3 = ax(axis, 0.5f, r * std::cos(a0), r * std::sin(a0));
        if (flip) push_quad(v, idx, q0, q3, q2, q1, n);
        else      push_quad(v, idx, q0, q1, q2, q3, n);
        // End caps as facet triangles, flat axial normals.
        for (int e = 0; e < 2; ++e) {
            const float aa = e == 0 ? -0.5f : 0.5f;
            const vec3 cn = ax(axis, e == 0 ? -1.0f : 1.0f, 0.0f, 0.0f);
            const uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({ax(axis, aa, 0.0f, 0.0f), cn});
            v.push_back({ax(axis, aa, r * std::cos(a0), r * std::sin(a0)), cn});
            v.push_back({ax(axis, aa, r * std::cos(a1), r * std::sin(a1)), cn});
            if ((e == 0) != flip) {
                idx.push_back(base); idx.push_back(base + 2); idx.push_back(base + 1);
            } else {
                idx.push_back(base); idx.push_back(base + 1); idx.push_back(base + 2);
            }
        }
    }
}

// Unit box, +-0.5 on every axis, one flat normal per face.
void push_box(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float h = 0.5f;
    push_quad(v, idx, {h,-h,-h}, {h,h,-h}, {h,h,h}, {h,-h,h}, {1,0,0});
    push_quad(v, idx, {-h,-h,-h}, {-h,-h,h}, {-h,h,h}, {-h,h,-h}, {-1,0,0});
    push_quad(v, idx, {-h,h,-h}, {-h,h,h}, {h,h,h}, {h,h,-h}, {0,1,0});
    push_quad(v, idx, {-h,-h,-h}, {h,-h,-h}, {h,-h,h}, {-h,-h,h}, {0,-1,0});
    push_quad(v, idx, {-h,-h,h}, {h,-h,h}, {h,h,h}, {-h,h,h}, {0,0,1});
    push_quad(v, idx, {-h,-h,-h}, {-h,h,-h}, {h,h,-h}, {h,-h,-h}, {0,0,-1});
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
        case PropShape::Box:       push_box(verts, indices); break;
        case PropShape::CylinderX: push_cylinder(verts, indices, 0); break;
        case PropShape::CylinderY: push_cylinder(verts, indices, 1); break;
        case PropShape::CylinderZ: push_cylinder(verts, indices, 2); break;
        default:
            std::fprintf(stderr, "[prop] unknown shape %d\n", static_cast<int>(shape));
            return false;
    }

    std::fprintf(stderr, "[prop] shape %d: %zu verts, %zu indices\n",
                 static_cast<int>(shape), verts.size(), indices.size());
    return upload_mesh(dev, verts, indices, out);
}

} // namespace giga::gpu
