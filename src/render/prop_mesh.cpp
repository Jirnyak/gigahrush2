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

// Computer terminal: pedestal + angled screen
void build_terminal(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // Pedestal base
    const float pw=0.4f, ph=0.9f, pd=0.3f;
    push_quad(v, idx, {0,0,0},{pw,0,0},{pw,ph,0},{0,ph,0}, {0,0,-1});
    push_quad(v, idx, {0,0,pd},{0,ph,pd},{pw,ph,pd},{pw,0,pd}, {0,0,1});
    push_quad(v, idx, {0,0,0},{0,ph,0},{0,ph,pd},{0,0,pd}, {-1,0,0});
    push_quad(v, idx, {pw,0,pd},{pw,ph,pd},{pw,ph,0},{pw,0,0}, {1,0,0});
    push_quad(v, idx, {0,ph,0},{pw,ph,0},{pw,ph,pd},{0,ph,pd}, {0,1,0});
    push_quad(v, idx, {0,0,pd},{pw,0,pd},{pw,0,0},{0,0,0}, {0,-1,0});
    // Screen panel (angled 15° backward)
    const float sh=0.35f, st=0.03f;
    float tilt = -0.26f; // ~15deg backward tilt
    push_quad(v, idx,
              {-0.05f, ph, 0.0f},
              {pw+0.05f, ph, 0.0f},
              {pw+0.05f, ph + sh - tilt*sh, st},
              {-0.05f, ph + sh - tilt*sh, st},
              {0, 0.97f, -0.26f});
}

// Conical floodlamp on vertical stem
void build_flood_lamp(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float rBase=0.08f, rCone=0.25f, stemH=1.6f, coneH=0.3f;
    const int segs = 12;
    // Stem
    push_cylinder_sides(v, idx, rBase, 0.0f, stemH, segs);
    // Cone (frustum: narrow at top, wide at bottom of cone)
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        float c0=std::cos(a0), s0=std::sin(a0), c1=std::cos(a1), s1=std::sin(a1);
        // Slope normal: points outward+upward for opening cone
        vec3 n = {(c0+c1)*0.5f*0.7f, 0.7f, (s0+s1)*0.5f*0.7f};
        uint32_t base = static_cast<uint32_t>(v.size());
        v.push_back({{rBase*c0, stemH+coneH, rBase*s0}, n});
        v.push_back({{rBase*c1, stemH+coneH, rBase*s1}, n});
        v.push_back({{rCone*c1, stemH,       rCone*s1}, n});
        v.push_back({{rCone*c0, stemH,       rCone*s0}, n});
        idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
        idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
    }
    // Reflector disk (interior face of cone)
    push_cap(v, idx, rCone, stemH, segs, /*faceUp=*/false);
}

void build_electrical_shield(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float w = 0.70f, h = 1.10f, d = 0.12f;
    vec3 fn = {0.0f, 0.0f, 1.0f}, bn = {0.0f, 0.0f, -1.0f};
    vec3 ln = {-1.0f, 0.0f, 0.0f}, rn = {1.0f, 0.0f, 0.0f};
    push_quad(v, idx, {-w*0.5f, 0, d}, {w*0.5f, 0, d}, {w*0.5f, h, d}, {-w*0.5f, h, d}, fn);
    push_quad(v, idx, {w*0.5f, 0, 0}, {-w*0.5f, 0, 0}, {-w*0.5f, h, 0}, {w*0.5f, h, 0}, bn);
    push_quad(v, idx, {-w*0.5f, 0, 0}, {-w*0.5f, 0, d}, {-w*0.5f, h, d}, {-w*0.5f, h, 0}, ln);
    push_quad(v, idx, {w*0.5f, 0, d}, {w*0.5f, 0, 0}, {w*0.5f, h, 0}, {w*0.5f, h, d}, rn);
    push_cap(v, idx, 0.05f, d + 0.005f, 8, true);
    push_cap(v, idx, 0.05f, d + 0.005f, 8, true);
}

void build_bare_bulb(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float cordL = 0.40f, cordR = 0.006f;
    const float bulbR = 0.04f;
    push_cylinder_sides(v, idx, cordR, 0.0f, cordL, 6);
    push_cylinder_sides(v, idx, 0.022f, cordL, cordL + 0.06f, 8);
    push_cap(v, idx, bulbR, cordL + 0.08f, 10, true);
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
        case PropShape::Terminal:         build_terminal(verts, indices);          break;
        case PropShape::ElectricalShield: build_electrical_shield(verts, indices); break;
        case PropShape::BareBulb:         build_bare_bulb(verts, indices);         break;
        case PropShape::FloodLamp:        build_flood_lamp(verts, indices);        break;
        default:
            std::fprintf(stderr, "[prop] unknown shape %d\n", static_cast<int>(shape));
            return false;
    }

    std::fprintf(stderr, "[prop] shape %d: %zu verts, %zu indices\n",
                 static_cast<int>(shape), verts.size(), indices.size());
    return upload_mesh(dev, verts, indices, out);
}

} // namespace giga::gpu
