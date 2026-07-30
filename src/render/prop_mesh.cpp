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
    vec3 slopeN = {0.0f, 0.847998f, -0.529998f};
    push_quad(v, idx,
              {0.0f, 0.0f, 0.0f}, {w, 0.0f, 0.0f},
              {w, rh, d},         {0.0f, rh, d}, slopeN);
    // Bottom face
    push_quad(v, idx,
              {0.0f, 0.0f, d}, {w, 0.0f, d},
              {w, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f},
              {0.0f, -1.0f, 0.0f});
    // Back face (z=d)
    push_quad(v, idx,
              {0.0f, 0.0f, d}, {w, 0.0f, d},
              {w, rh, d},      {0.0f, rh, d},
              {0.0f, 0.0f, 1.0f});
    // Left face (x=0 triangle)
    uint32_t lbase = static_cast<uint32_t>(v.size());
    vec3 ln = {-1.0f, 0.0f, 0.0f};
    v.push_back({{0.0f, 0.0f, 0.0f}, ln});
    v.push_back({{0.0f, 0.0f, d},    ln});
    v.push_back({{0.0f, rh, d},      ln});
    idx.push_back(lbase); idx.push_back(lbase + 1); idx.push_back(lbase + 2);
    // Right face (x=w triangle)
    uint32_t rbase = static_cast<uint32_t>(v.size());
    vec3 rn = {1.0f, 0.0f, 0.0f};
    v.push_back({{w, 0.0f, 0.0f}, rn});
    v.push_back({{w, rh, d},      rn});
    v.push_back({{w, 0.0f, d},    rn});
    idx.push_back(rbase); idx.push_back(rbase + 1); idx.push_back(rbase + 2);
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

// ─────────────────────── phase 2: mechanical ────────────────────────────────

// Quarter-torus pipe elbow (90° bend). The tube cross-section has `rSec`
// radius, swept around a bend of radius `rBend` from angle 0 to π/2.
void build_pipe_elbow(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float rSec = 0.15f, rBend = 0.30f;
    const int sweepSegs = 8, circSegs = 8;
    for (int si = 0; si < sweepSegs; ++si) {
        float sa0 = (kPi * 0.5f) * si       / sweepSegs;
        float sa1 = (kPi * 0.5f) * (si + 1) / sweepSegs;
        float csa0 = std::cos(sa0), ssa0 = std::sin(sa0);
        float csa1 = std::cos(sa1), ssa1 = std::sin(sa1);
        vec3 C0 = {rBend * csa0, rBend * ssa0, 0.0f};
        vec3 C1 = {rBend * csa1, rBend * ssa1, 0.0f};
        vec3 R0 = {csa0, ssa0, 0.0f};
        vec3 R1 = {csa1, ssa1, 0.0f};
        for (int ci = 0; ci < circSegs; ++ci) {
            float ca0 = 2.0f * kPi * ci       / circSegs;
            float ca1 = 2.0f * kPi * (ci + 1) / circSegs;
            auto pos = [&](vec3 C, vec3 R, float ca) -> vec3 {
                return {C.x + rSec * std::cos(ca) * R.x,
                        C.y + rSec * std::cos(ca) * R.y,
                        C.z + rSec * std::sin(ca)};
            };
            auto nrm = [&](vec3 R, float ca) -> vec3 {
                return {std::cos(ca) * R.x, std::cos(ca) * R.y, std::sin(ca)};
            };
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({pos(C0,R0,ca0), nrm(R0,ca0)});
            v.push_back({pos(C1,R1,ca0), nrm(R1,ca0)});
            v.push_back({pos(C1,R1,ca1), nrm(R1,ca1)});
            v.push_back({pos(C0,R0,ca1), nrm(R0,ca1)});
            idx.push_back(base);   idx.push_back(base+1); idx.push_back(base+2);
            idx.push_back(base);   idx.push_back(base+2); idx.push_back(base+3);
        }
    }
}

// T-junction: horizontal pipe (X axis, l=2m) + vertical branch (Y axis, l=1m)
void build_pipe_tee(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // Horizontal main
    build_pipe(v, idx);
    // Vertical branch (different from build_pipe which is along X — here along Y)
    const float r = 0.15f, len = 1.0f;
    const int segs = 10;
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        vec3 n0 = {c0, 0.0f, s0};
        vec3 n1 = {c1, 0.0f, s1};
        uint32_t base = static_cast<uint32_t>(v.size());
        // branch starts at horizontal mid-point (x=1.0), goes up
        v.push_back({{1.0f + r * c0, 0.0f, r * s0}, n0});
        v.push_back({{1.0f + r * c0, len,  r * s0}, n0});
        v.push_back({{1.0f + r * c1, len,  r * s1}, n1});
        v.push_back({{1.0f + r * c1, 0.0f, r * s1}, n1});
        idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
        idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
    }
    push_cap(v, idx, r, len, segs, /*faceUp=*/true);
}

// Handwheel valve: spoked wheel + central hub + stem
void build_valve(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const int spokes = 6;
    const float rRim = 0.25f, rHub = 0.05f, rSpoke = 0.02f, rStem = 0.04f;
    const float rimThick = 0.025f; // half-thickness of rim torus

    // Rim: torus approximation (rimThick tube swept around rRim circle)
    const int rimSweep = 20, rimCirc = 6;
    for (int si = 0; si < rimSweep; ++si) {
        float sa0 = 2.0f * kPi * si       / rimSweep;
        float sa1 = 2.0f * kPi * (si + 1) / rimSweep;
        vec3 C0 = {rRim * std::cos(sa0), 0.0f, rRim * std::sin(sa0)};
        vec3 C1 = {rRim * std::cos(sa1), 0.0f, rRim * std::sin(sa1)};
        vec3 R0 = {std::cos(sa0), 0.0f, std::sin(sa0)};
        vec3 R1 = {std::cos(sa1), 0.0f, std::sin(sa1)};
        for (int ci = 0; ci < rimCirc; ++ci) {
            float ca0 = 2.0f * kPi * ci       / rimCirc;
            float ca1 = 2.0f * kPi * (ci + 1) / rimCirc;
            auto pos = [&](vec3 C, vec3 R, float ca) -> vec3 {
                return {C.x + rimThick * std::cos(ca) * R.x,
                        C.y + rimThick * std::sin(ca),
                        C.z + rimThick * std::cos(ca) * R.z};
            };
            auto nrm = [&](vec3 R, float ca) -> vec3 {
                return {std::cos(ca) * R.x, std::sin(ca), std::cos(ca) * R.z};
            };
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({pos(C0,R0,ca0), nrm(R0,ca0)});
            v.push_back({pos(C1,R1,ca0), nrm(R1,ca0)});
            v.push_back({pos(C1,R1,ca1), nrm(R1,ca1)});
            v.push_back({pos(C0,R0,ca1), nrm(R0,ca1)});
            idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
            idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
        }
    }
    // Spokes: thin cylinders from hub to rim, correctly aligned in XZ plane
    for (int s = 0; s < spokes; ++s) {
        float a = 2.0f * kPi * s / spokes;
        float cx = std::cos(a), cz = std::sin(a);
        for (int ci = 0; ci < 4; ++ci) {
            float ba = kPi * 0.5f * ci;
            float ba1 = kPi * 0.5f * (ci + 1);
            vec3 n = {-std::cos(ba) * cz, std::sin(ba), std::cos(ba) * cx};
            uint32_t base = static_cast<uint32_t>(v.size());
            float r0 = rHub, r1 = rRim - rimThick;
            auto spoke_v = [&](float r, float b_ang) -> vec3 {
                return {cx * r - rSpoke * std::cos(b_ang) * cz,
                        rSpoke * std::sin(b_ang),
                        cz * r + rSpoke * std::cos(b_ang) * cx};
            };
            v.push_back({spoke_v(r0, ba),  n});
            v.push_back({spoke_v(r1, ba),  n});
            v.push_back({spoke_v(r1, ba1), n});
            v.push_back({spoke_v(r0, ba1), n});
            idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
            idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
        }
    }
    // Central hub
    push_cylinder_sides(v, idx, rHub, -rimThick, rimThick, 8);
    // Stem (downward from hub centre)
    push_cylinder_sides(v, idx, rStem, -rimThick, -0.20f, 8);
    push_cap(v, idx, rStem, -0.20f, 8, /*faceUp=*/false);
}

// Floor grate: 2×2 m grid of crossing bars 0.05×0.05, total thickness 0.06 m
void build_grate(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float size = 2.0f, barW = 0.05f, barH = 0.06f;
    const int bars = 9; // bars per axis (8 gaps = 0.25m each)
    for (int axis = 0; axis < 2; ++axis) {
        for (int i = 0; i < bars; ++i) {
            float t = (size / (bars - 1)) * i;  // position along perpendicular axis
            float hw = barW * 0.5f;
            // bar along axis=0: X-direction; axis=1: Z-direction
            vec3 a0, a1, a2, a3; // bottom quad
            vec3 b0, b1, b2, b3; // top quad
            if (axis == 0) {
                float z = t - size * 0.5f + hw;
                a0 = {0, 0, z - hw}; a1 = {size, 0, z - hw};
                a2 = {size, 0, z + hw}; a3 = {0, 0, z + hw};
                b0 = {0, barH, z - hw}; b1 = {size, barH, z - hw};
                b2 = {size, barH, z + hw}; b3 = {0, barH, z + hw};
            } else {
                float x = t - size * 0.5f + hw;
                a0 = {x - hw, 0, 0}; a1 = {x - hw, 0, size};
                a2 = {x + hw, 0, size}; a3 = {x + hw, 0, 0};
                b0 = {x - hw, barH, 0}; b1 = {x - hw, barH, size};
                b2 = {x + hw, barH, size}; b3 = {x + hw, barH, 0};
            }
            // Top face
            push_quad(v, idx, b0, b1, b2, b3, {0,1,0});
            // Bottom face
            push_quad(v, idx, a3, a2, a1, a0, {0,-1,0});
            // Side faces (simplified: just two long sides)
            if (axis == 0) {
                push_quad(v, idx, a0, b0, b3, a3, {0,0,-1});
                push_quad(v, idx, a2, b2, b1, a1, {0,0,1});
            } else {
                push_quad(v, idx, a0, b0, b3, a3, {-1,0,0});
                push_quad(v, idx, a2, b2, b1, a1, {1,0,0});
            }
        }
    }
}

// Round ventilation grate, r=0.50m, ring with cross bars
void build_round_grate(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float rOuter = 0.50f, rInner = 0.46f, thick = 0.04f;
    const int segs = 16;
    // Outer ring (flat torus)
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        // Top face of ring
        push_quad(v, idx,
                  {rInner * std::cos(a0), thick, rInner * std::sin(a0)},
                  {rOuter * std::cos(a0), thick, rOuter * std::sin(a0)},
                  {rOuter * std::cos(a1), thick, rOuter * std::sin(a1)},
                  {rInner * std::cos(a1), thick, rInner * std::sin(a1)},
                  {0,1,0});
        // Outer vertical face
        push_quad(v, idx,
                  {rOuter * std::cos(a0), 0,     rOuter * std::sin(a0)},
                  {rOuter * std::cos(a0), thick, rOuter * std::sin(a0)},
                  {rOuter * std::cos(a1), thick, rOuter * std::sin(a1)},
                  {rOuter * std::cos(a1), 0,     rOuter * std::sin(a1)},
                  {(std::cos(a0)+std::cos(a1))*0.5f, 0, (std::sin(a0)+std::sin(a1))*0.5f});
    }
    // Cross-bars (2 bars at 0° and 90°)
    for (int axis = 0; axis < 2; ++axis) {
        float bw = 0.04f;
        if (axis == 0) {
            push_quad(v, idx, {-rInner, thick, -bw}, {rInner, thick, -bw},
                      {rInner, thick, bw}, {-rInner, thick, bw}, {0,1,0});
        } else {
            push_quad(v, idx, {-bw, thick, -rInner}, {bw, thick, -rInner},
                      {bw, thick, rInner}, {-bw, thick, rInner}, {0,1,0});
        }
    }
}

// Electrical cabinet: 0.4 × 1.8 × 0.2 m box with door recess
void build_cabinet_box(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float w = 0.4f, h = 1.8f, d = 0.2f, recess = 0.02f;
    // Main box faces
    push_quad(v, idx, {0,0,0}, {w,0,0}, {w,h,0}, {0,h,0}, {0,0,-1}); // front face (recessed below)
    push_quad(v, idx, {0,0,d}, {0,h,d}, {w,h,d}, {w,0,d}, {0,0,1});  // back
    push_quad(v, idx, {0,0,0}, {0,h,0}, {0,h,d}, {0,0,d}, {-1,0,0}); // left
    push_quad(v, idx, {w,0,d}, {w,h,d}, {w,h,0}, {w,0,0}, {1,0,0});  // right
    push_quad(v, idx, {0,0,d}, {w,0,d}, {w,0,0}, {0,0,0}, {0,-1,0}); // bottom
    push_quad(v, idx, {0,h,0}, {w,h,0}, {w,h,d}, {0,h,d}, {0,1,0});  // top
    // Door recess (inset rectangle on front)
    float m = 0.03f; // margin
    push_quad(v, idx,
              {m, m, -recess}, {w-m, m, -recess},
              {w-m, h-m, -recess}, {m, h-m, -recess}, {0,0,-1});
}

// Angled control console: 1.2 × 1.0 × 0.4 m with sloped top surface
void build_control_panel(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float w = 1.2f, h = 1.0f, hFront = 0.7f, d = 0.4f;
    // Sloped top face normal facing outward towards -z
    vec3 slopeN = {0.0f, 0.8f, -0.6f};
    push_quad(v, idx, {0,hFront,0}, {w,hFront,0}, {w,h,d}, {0,h,d}, slopeN);
    // Front face (vertical)
    push_quad(v, idx, {0,0,0}, {w,0,0}, {w,hFront,0}, {0,hFront,0}, {0,0,-1});
    // Back face
    push_quad(v, idx, {0,0,d}, {0,h,d}, {w,h,d}, {w,0,d}, {0,0,1});
    // Sides
    push_quad(v, idx, {0,0,0}, {0,hFront,0}, {0,h,d}, {0,0,d}, {-1,0,0});
    push_quad(v, idx, {w,0,d}, {w,h,d}, {w,hFront,0}, {w,0,0}, {1,0,0});
    // Bottom
    push_quad(v, idx, {0,0,d}, {w,0,d}, {w,0,0}, {0,0,0}, {0,-1,0});
}

// Handrail segment: 2m long — top bar + 2 vertical posts
void build_railing(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float len = 2.0f, h = 1.0f, r = 0.03f;
    const int segs = 8;
    // Top horizontal bar (cylinder along X)
    for (int i = 0; i < segs; ++i) {
        float a0 = 2.0f * kPi * i       / segs;
        float a1 = 2.0f * kPi * (i + 1) / segs;
        float c0 = std::cos(a0), s0 = std::sin(a0);
        float c1 = std::cos(a1), s1 = std::sin(a1);
        vec3 n0 = {0.0f, c0, s0};
        vec3 n1 = {0.0f, c1, s1};
        uint32_t base = static_cast<uint32_t>(v.size());
        v.push_back({{0.0f, h + r * c0, r * s0}, n0});
        v.push_back({{len,  h + r * c0, r * s0}, n0});
        v.push_back({{len,  h + r * c1, r * s1}, n1});
        v.push_back({{0.0f, h + r * c1, r * s1}, n1});
        idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
        idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
    }
    // Two vertical posts (cylinders along Y)
    for (int p = 0; p < 2; ++p) {
        float px = (p == 0) ? 0.0f : len;
        for (int i = 0; i < segs; ++i) {
            float a0 = 2.0f * kPi * i       / segs;
            float a1 = 2.0f * kPi * (i + 1) / segs;
            float c0 = std::cos(a0), s0 = std::sin(a0);
            float c1 = std::cos(a1), s1 = std::sin(a1);
            vec3 n0 = {c0, 0.0f, s0};
            vec3 n1 = {c1, 0.0f, s1};
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({{px + r * c0, 0.0f, r * s0}, n0});
            v.push_back({{px + r * c0, h,    r * s0}, n0});
            v.push_back({{px + r * c1, h,    r * s1}, n1});
            v.push_back({{px + r * c1, 0.0f, r * s1}, n1});
            idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
            idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
        }
    }
}

// ─────────────────────── phase 3: living world ───────────────────────────────

// H-section steel support beam, 4m long along X axis
void build_support_beam(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float len = 4.0f, fw = 0.12f, wt = 0.08f, ft = 0.01f; // flange width, web thickness, flange thickness
    // Top flange
    push_quad(v, idx, {0,-ft,-fw}, {len,-ft,-fw}, {len,-ft,fw}, {0,-ft,fw}, {0,-1,0});
    push_quad(v, idx, {0,ft,-fw}, {0,ft,fw}, {len,ft,fw}, {len,ft,-fw}, {0,1,0});
    // Bottom flange
    float bh = -(wt + ft);
    push_quad(v, idx, {0,bh-ft,-fw}, {len,bh-ft,-fw}, {len,bh-ft,fw}, {0,bh-ft,fw}, {0,-1,0});
    push_quad(v, idx, {0,bh+ft,-fw}, {0,bh+ft,fw}, {len,bh+ft,fw}, {len,bh+ft,-fw}, {0,1,0});
    // Web (vertical plate connecting flanges)
    push_quad(v, idx, {0,ft,-wt*0.5f}, {len,ft,-wt*0.5f}, {len,bh,-wt*0.5f}, {0,bh,-wt*0.5f}, {0,0,-1});
    push_quad(v, idx, {0,bh,wt*0.5f}, {len,bh,wt*0.5f}, {len,ft,wt*0.5f}, {0,ft,wt*0.5f}, {0,0,1});
}

// Storage crate 0.6×0.6×0.6 with chamfered edges
void build_crate_box(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float s = 0.6f, ch = 0.04f;
    float a = ch, b = s - ch;
    // 6 main faces
    push_quad(v, idx, {a,0,a},{b,0,a},{b,0,b},{a,0,b}, {0,-1,0});
    push_quad(v, idx, {a,s,a},{a,s,b},{b,s,b},{b,s,a}, {0,1,0});
    push_quad(v, idx, {0,a,a},{0,b,a},{0,b,b},{0,a,b}, {-1,0,0});
    push_quad(v, idx, {s,a,a},{s,a,b},{s,b,b},{s,b,a}, {1,0,0});
    push_quad(v, idx, {a,a,0},{b,a,0},{b,b,0},{a,b,0}, {0,0,-1});
    push_quad(v, idx, {a,a,s},{a,b,s},{b,b,s},{b,a,s}, {0,0,1});

    // 12 chamfer edges
    // Bottom 4
    push_quad(v, idx, {a,0,a},{b,0,a},{b,a,0},{a,a,0}, {0,-0.707f,-0.707f});
    push_quad(v, idx, {a,a,s},{b,a,s},{b,0,b},{a,0,b}, {0,-0.707f,0.707f});
    push_quad(v, idx, {0,a,a},{a,0,a},{a,0,b},{0,a,b}, {-0.707f,-0.707f,0});
    push_quad(v, idx, {b,0,a},{s,a,a},{s,a,b},{b,0,b}, {0.707f,-0.707f,0});
    // Top 4
    push_quad(v, idx, {a,s,a},{b,s,a},{b,b,0},{a,b,0}, {0,0.707f,-0.707f});
    push_quad(v, idx, {a,b,s},{b,b,s},{b,s,b},{a,s,b}, {0,0.707f,0.707f});
    push_quad(v, idx, {0,b,a},{a,s,a},{a,s,b},{0,b,b}, {-0.707f,0.707f,0});
    push_quad(v, idx, {b,s,a},{s,b,a},{s,b,b},{b,s,b}, {0.707f,0.707f,0});
    // Vertical 4
    push_quad(v, idx, {0,a,a},{a,a,0},{a,b,0},{0,b,a}, {-0.707f,0,-0.707f});
    push_quad(v, idx, {s,b,a},{b,b,0},{b,a,0},{s,a,a}, {0.707f,0,-0.707f});
    push_quad(v, idx, {0,b,b},{a,b,s},{a,a,s},{0,a,b}, {-0.707f,0,0.707f});
    push_quad(v, idx, {s,a,b},{b,a,s},{b,b,s},{s,b,b}, {0.707f,0,0.707f});
}

// Long crate 2×0.6×0.6
void build_crate_long(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float lx = 2.0f, ly = 0.6f, lz = 0.6f;
    push_quad(v, idx, {0,0,0},{lx,0,0},{lx,0,lz},{0,0,lz}, {0,-1,0});
    push_quad(v, idx, {0,ly,0},{0,ly,lz},{lx,ly,lz},{lx,ly,0}, {0,1,0});
    push_quad(v, idx, {0,0,0},{0,ly,0},{0,ly,lz},{0,0,lz}, {-1,0,0});
    push_quad(v, idx, {lx,0,lz},{lx,ly,lz},{lx,ly,0},{lx,0,0}, {1,0,0});
    push_quad(v, idx, {0,0,0},{0,0,lz},{0,ly,lz},{0,ly,0}, {0,0,-1}); // left end
    push_quad(v, idx, {lx,0,0},{lx,ly,0},{lx,ly,lz},{lx,0,lz}, {0,0,1}); // right end
    // Lid seam lines (pair of thin quads across top)
    float sw = 0.01f;
    push_quad(v, idx, {lx*0.5f-sw,ly,0},{lx*0.5f+sw,ly,0},{lx*0.5f+sw,ly,lz},{lx*0.5f-sw,ly,lz}, {0,1,0});
}

// Locker unit 0.5×1.8×0.3 m
void build_locker_unit(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float w=0.5f, h=1.8f, d=0.3f, fr=0.02f; // frame recess
    // Box
    push_quad(v, idx, {0,0,0},{w,0,0},{w,h,0},{0,h,0}, {0,0,-1});
    push_quad(v, idx, {0,0,d},{0,h,d},{w,h,d},{w,0,d}, {0,0,1});
    push_quad(v, idx, {0,0,0},{0,h,0},{0,h,d},{0,0,d}, {-1,0,0});
    push_quad(v, idx, {w,0,d},{w,h,d},{w,h,0},{w,0,0}, {1,0,0});
    push_quad(v, idx, {0,0,d},{w,0,d},{w,0,0},{0,0,0}, {0,-1,0});
    push_quad(v, idx, {0,h,0},{w,h,0},{w,h,d},{0,h,d}, {0,1,0});
    // Door recess on front
    push_quad(v, idx, {fr,fr,-fr},{w-fr,fr,-fr},{w-fr,h-fr,-fr},{fr,h-fr,-fr}, {0,0,-1});
}

// Bench slab 2.0×0.45×0.40 m
void build_bench_slab(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float lx=2.0f, ly=0.45f, lz=0.40f;
    push_quad(v, idx, {0,ly,0},{lx,ly,0},{lx,ly,lz},{0,ly,lz}, {0,1,0});
    push_quad(v, idx, {0,0,0},{0,ly,0},{0,ly,lz},{0,0,lz}, {-1,0,0});
    push_quad(v, idx, {lx,0,lz},{lx,ly,lz},{lx,ly,0},{lx,0,0}, {1,0,0});
    push_quad(v, idx, {0,0,0},{lx,0,0},{lx,ly,0},{0,ly,0}, {0,0,-1});
    push_quad(v, idx, {0,0,lz},{0,ly,lz},{lx,ly,lz},{lx,0,lz}, {0,0,1});
    push_quad(v, idx, {0,0,0},{0,0,lz},{lx,0,lz},{lx,0,0}, {0,-1,0});
    // Legs (4 short cylinders)
    const float lr = 0.04f;
    float lpos[2] = {0.1f, lx - 0.1f};
    for (float lx2 : lpos) {
        for (float lz2 : {0.06f, lz - 0.06f}) {
            // Box leg approximation
            push_quad(v, idx, {lx2-lr,0,lz2-lr},{lx2+lr,0,lz2-lr},{lx2+lr,0,lz2+lr},{lx2-lr,0,lz2+lr}, {0,-1,0});
        }
    }
}

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

// Security camera dome on wall bracket
void build_security_camera(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    // L-bracket
    const float bw=0.05f, ba=0.20f, bb=0.15f;
    push_quad(v, idx, {-bw,0,-bw},{bw,0,-bw},{bw,ba,-bw},{-bw,ba,-bw}, {0,0,-1});
    push_quad(v, idx, {-bw,ba,-bw},{bw,ba,-bw},{bw,ba,bb},{-bw,ba,bb}, {0,1,0});
    // Dome
    const float dr = 0.09f;
    const int dsegs = 10, drings = 5;
    vec3 dc = {0.0f, ba + dr * 0.3f, bb * 0.5f};
    for (int ri = 0; ri < drings; ++ri) {
        float phi0 = kPi * 0.5f * ri       / drings;
        float phi1 = kPi * 0.5f * (ri + 1) / drings;
        float r0 = dr * std::cos(phi0), y0 = -dr * std::sin(phi0);
        float r1 = dr * std::cos(phi1), y1 = -dr * std::sin(phi1);
        for (int si = 0; si < dsegs; ++si) {
            float a0 = 2.0f * kPi * si       / dsegs;
            float a1 = 2.0f * kPi * (si + 1) / dsegs;
            vec3 n00 = {std::cos(a0)*std::cos(phi0), -std::sin(phi0), std::sin(a0)*std::cos(phi0)};
            vec3 n10 = {std::cos(a1)*std::cos(phi0), -std::sin(phi0), std::sin(a1)*std::cos(phi0)};
            vec3 n01 = {std::cos(a0)*std::cos(phi1), -std::sin(phi1), std::sin(a0)*std::cos(phi1)};
            vec3 n11 = {std::cos(a1)*std::cos(phi1), -std::sin(phi1), std::sin(a1)*std::cos(phi1)};
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({{dc.x+r0*std::cos(a0), dc.y+y0, dc.z+r0*std::sin(a0)}, n00});
            v.push_back({{dc.x+r0*std::cos(a1), dc.y+y0, dc.z+r0*std::sin(a1)}, n10});
            v.push_back({{dc.x+r1*std::cos(a1), dc.y+y1, dc.z+r1*std::sin(a1)}, n11});
            v.push_back({{dc.x+r1*std::cos(a0), dc.y+y1, dc.z+r1*std::sin(a0)}, n01});
            idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
            idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
        }
    }
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

// ─────────────────────── phase 4: organic / anomalous ───────────────────────

// Mushroom-encrusted organic column r≈0.35 with procedural bumps
void build_fungal_column(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float h = 2.0f;
    const int segs = 12, rings = 8;
    // Main column with continuous radius interpolation (no ring gaps)
    for (int ri = 0; ri < rings; ++ri) {
        float y0 = h * ri       / rings;
        float y1 = h * (ri + 1) / rings;
        float r0 = 0.30f + 0.06f * std::sin(y0 * 3.7f + 1.2f);
        float r1 = 0.30f + 0.06f * std::sin(y1 * 3.7f + 1.2f);
        for (int i = 0; i < segs; ++i) {
            float a0 = 2.0f * kPi * i       / segs;
            float a1 = 2.0f * kPi * (i + 1) / segs;
            float c0 = std::cos(a0), s0 = std::sin(a0);
            float c1 = std::cos(a1), s1 = std::sin(a1);
            vec3 n0 = {c0, 0.0f, s0};
            vec3 n1 = {c1, 0.0f, s1};
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({{r0 * c0, y0, r0 * s0}, n0});
            v.push_back({{r1 * c0, y1, r1 * s0}, n0});
            v.push_back({{r1 * c1, y1, r1 * s1}, n1});
            v.push_back({{r0 * c1, y0, r0 * s1}, n1});
            idx.push_back(base);     idx.push_back(base + 1); idx.push_back(base + 2);
            idx.push_back(base);     idx.push_back(base + 2); idx.push_back(base + 3);
        }
    }

    // Mushroom caps: 4 bumps at staggered heights (half-spheres)
    const float bumpY[4] = {0.3f, 0.7f, 1.2f, 1.7f};
    const float bumpA[4] = {0.4f, 1.9f, 0.9f, 2.6f}; // angles
    for (int b = 0; b < 4; ++b) {
        const float br = 0.10f + 0.04f * (b & 1);
        float cx = 0.30f * std::cos(bumpA[b]);
        float cz = 0.30f * std::sin(bumpA[b]);
        const int hsegs = 8, hrings = 4;
        for (int ri = 0; ri < hrings; ++ri) {
            float phi0 = kPi * 0.5f * ri       / hrings;
            float phi1 = kPi * 0.5f * (ri + 1) / hrings;
            float r0 = br * std::cos(phi0), y0d = br * std::sin(phi0);
            float r1 = br * std::cos(phi1), y1d = br * std::sin(phi1);
            for (int si = 0; si < hsegs; ++si) {
                float a0 = 2.0f * kPi * si       / hsegs;
                float a1 = 2.0f * kPi * (si + 1) / hsegs;
                vec3 n00 = {std::cos(a0)*std::cos(phi0), std::sin(phi0), std::sin(a0)*std::cos(phi0)};
                vec3 n10 = {std::cos(a1)*std::cos(phi0), std::sin(phi0), std::sin(a1)*std::cos(phi0)};
                vec3 n01 = {std::cos(a0)*std::cos(phi1), std::sin(phi1), std::sin(a0)*std::cos(phi1)};
                vec3 n11 = {std::cos(a1)*std::cos(phi1), std::sin(phi1), std::sin(a1)*std::cos(phi1)};
                uint32_t base = static_cast<uint32_t>(v.size());
                v.push_back({{cx+r0*std::cos(a0), bumpY[b]+y0d, cz+r0*std::sin(a0)}, n00});
                v.push_back({{cx+r0*std::cos(a1), bumpY[b]+y0d, cz+r0*std::sin(a1)}, n10});
                v.push_back({{cx+r1*std::cos(a1), bumpY[b]+y1d, cz+r1*std::sin(a1)}, n11});
                v.push_back({{cx+r1*std::cos(a0), bumpY[b]+y1d, cz+r1*std::sin(a0)}, n01});
                idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
                idx.push_back(base); idx.push_back(base+2); idx.push_back(base+3);
            }
        }
    }
    push_cap(v, idx, 0.32f, 0.0f, segs, /*faceUp=*/false);
    push_cap(v, idx, 0.32f, h,    segs, /*faceUp=*/true);
}

// Cluster of 5 tapered crystal prisms
void build_crystal_cluster(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    struct CrystalDef { float x, z, h, r, yaw; };
    const CrystalDef crystals[] = {
        { 0.0f,  0.0f, 0.8f, 0.10f, 0.0f  },
        { 0.12f, 0.05f, 0.5f, 0.07f, 0.9f  },
        {-0.10f, 0.08f, 0.6f, 0.08f, 2.1f  },
        { 0.05f,-0.12f, 0.4f, 0.06f, 1.5f  },
        {-0.06f,-0.06f, 0.7f, 0.09f, 3.0f  },
    };
    const int sides = 6;
    for (const auto& cr : crystals) {
        // Base polygon
        for (int i = 0; i < sides; ++i) {
            float a0 = 2.0f * kPi * i       / sides + cr.yaw;
            float a1 = 2.0f * kPi * (i + 1) / sides + cr.yaw;
            float c0=std::cos(a0), s0=std::sin(a0);
            float c1=std::cos(a1), s1=std::sin(a1);
            vec3 n = {(c0+c1)*0.5f, 0.2f, (s0+s1)*0.5f};
            float nlen = std::sqrt(n.x*n.x+n.y*n.y+n.z*n.z);
            n = {n.x/nlen, n.y/nlen, n.z/nlen};
            // Prism face: base edge to apex
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({{cr.x + cr.r*c0, 0.0f,   cr.z + cr.r*s0}, n});
            v.push_back({{cr.x + cr.r*c1, 0.0f,   cr.z + cr.r*s1}, n});
            v.push_back({{cr.x,           cr.h,   cr.z           }, n});
            idx.push_back(base); idx.push_back(base+1); idx.push_back(base+2);
        }
        // Base cap centered at crystal offset (cr.x, cr.z)
        uint32_t centre = static_cast<uint32_t>(v.size());
        vec3 bot_n = {0.0f, -1.0f, 0.0f};
        v.push_back({{cr.x, 0.0f, cr.z}, bot_n});
        for (int i = 0; i <= sides; ++i) {
            float a = 2.0f * kPi * i / sides + cr.yaw;
            v.push_back({{cr.x + cr.r * std::cos(a), 0.0f, cr.z + cr.r * std::sin(a)}, bot_n});
        }
        for (int i = 0; i < sides; ++i) {
            uint32_t a = centre + 1 + i;
            uint32_t b = centre + 1 + i + 1;
            idx.push_back(centre); idx.push_back(b); idx.push_back(a);
        }
    }
}

// Flat acid pool disk r=0.8 with edge bubbles
void build_acid_pool(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float r = 0.8f, thick = 0.04f;
    const int segs = 24;
    // Top surface (slightly rippled using constant sin approximation)
    uint32_t centre = static_cast<uint32_t>(v.size());
    v.push_back({{0,thick,0}, {0,1,0}});
    for (int i = 0; i <= segs; ++i) {
        float a = 2.0f * kPi * i / segs;
        float rp = r * (1.0f + 0.02f * std::sin(a * 5.0f)); // slight ripple
        float yp = thick + 0.01f * std::sin(a * 7.0f + 1.0f);
        v.push_back({{rp * std::cos(a), yp, rp * std::sin(a)}, {0,1,0}});
    }
    for (int i = 0; i < segs; ++i) {
        idx.push_back(centre); idx.push_back(centre+1+i); idx.push_back(centre+1+i+1);
    }
    // Edge rim (vertical cylinder ring)
    push_cylinder_sides(v, idx, r, 0.0f, thick, segs);
    // Bottom flat disk
    push_cap(v, idx, r, 0.0f, segs, /*faceUp=*/false);
    // Edge bubbles (small hemispheres around perimeter)
    const int bubbles = 12;
    for (int b = 0; b < bubbles; ++b) {
        float ba = 2.0f * kPi * b / bubbles;
        float br = 0.03f + 0.02f * std::sin(ba * 3.0f);
        float bcx = (r + br) * std::cos(ba);
        float bcz = (r + br) * std::sin(ba);
        const int bsegs = 5, brings = 3;
        for (int ri = 0; ri < brings; ++ri) {
            float phi0 = kPi * 0.5f * ri       / brings;
            float phi1 = kPi * 0.5f * (ri + 1) / brings;
            float rb0 = br * std::cos(phi0), yb0 = br * std::sin(phi0);
            float rb1 = br * std::cos(phi1), yb1 = br * std::sin(phi1);
            for (int si = 0; si < bsegs; ++si) {
                float a0 = 2.0f * kPi * si       / bsegs;
                float a1 = 2.0f * kPi * (si + 1) / bsegs;
                uint32_t bbase = static_cast<uint32_t>(v.size());
                vec3 n0 = {std::cos(a0)*std::cos(phi0), std::sin(phi0), std::sin(a0)*std::cos(phi0)};
                vec3 n1 = {std::cos(a1)*std::cos(phi0), std::sin(phi0), std::sin(a1)*std::cos(phi0)};
                vec3 n2 = {std::cos(a1)*std::cos(phi1), std::sin(phi1), std::sin(a1)*std::cos(phi1)};
                vec3 n3 = {std::cos(a0)*std::cos(phi1), std::sin(phi1), std::sin(a0)*std::cos(phi1)};
                v.push_back({{bcx+rb0*std::cos(a0), thick+yb0, bcz+rb0*std::sin(a0)}, n0});
                v.push_back({{bcx+rb0*std::cos(a1), thick+yb0, bcz+rb0*std::sin(a1)}, n1});
                v.push_back({{bcx+rb1*std::cos(a1), thick+yb1, bcz+rb1*std::sin(a1)}, n2});
                v.push_back({{bcx+rb1*std::cos(a0), thick+yb1, bcz+rb1*std::sin(a0)}, n3});
                idx.push_back(bbase); idx.push_back(bbase+1); idx.push_back(bbase+2);
                idx.push_back(bbase); idx.push_back(bbase+2); idx.push_back(bbase+3);
            }
        }
    }
}

void build_radiator(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const int sections = 7;
    const float secW = 0.11f, secH = 0.58f, secD = 0.14f;
    const float pipeR = 0.015f;
    for (int i = 0; i < sections; ++i) {
        float x0 = (i - sections / 2.0f) * secW, x1 = x0 + secW * 0.82f;
        vec3 fn = {0.0f, 0.0f, 1.0f}, bn = {0.0f, 0.0f, -1.0f};
        vec3 ln = {-1.0f, 0.0f, 0.0f}, rn = {1.0f, 0.0f, 0.0f};
        push_quad(v, idx, {x0, 0.05f, secD}, {x1, 0.05f, secD}, {x1, secH - 0.05f, secD}, {x0, secH - 0.05f, secD}, fn);
        push_quad(v, idx, {x1, 0.05f, 0.0f}, {x0, 0.05f, 0.0f}, {x0, secH - 0.05f, 0.0f}, {x1, secH - 0.05f, 0.0f}, bn);
        push_quad(v, idx, {x1, 0.05f, 0.0f}, {x1, 0.05f, secD}, {x1, secH - 0.05f, secD}, {x1, secH - 0.05f, 0.0f}, rn);
        push_quad(v, idx, {x0, 0.05f, secD}, {x0, 0.05f, 0.0f}, {x0, secH - 0.05f, 0.0f}, {x0, secH - 0.05f, secD}, ln);
    }
    push_cylinder_sides(v, idx, pipeR, 0.04f, 0.04f, 8);
    push_cylinder_sides(v, idx, pipeR, secH - 0.04f, secH - 0.04f, 8);
}

void build_dermatin_door(std::vector<PropVertex>& v, std::vector<uint32_t>& idx) {
    const float w = 0.90f, h = 2.00f, d = 0.06f;
    vec3 fn = {0.0f, 0.0f, 1.0f}, bn = {0.0f, 0.0f, -1.0f};
    vec3 ln = {-1.0f, 0.0f, 0.0f}, rn = {1.0f, 0.0f, 0.0f};
    push_quad(v, idx, {-w*0.5f, 0, d}, {w*0.5f, 0, d}, {w*0.5f, h, d}, {-w*0.5f, h, d}, fn);
    push_quad(v, idx, {w*0.5f, 0, 0}, {-w*0.5f, 0, 0}, {-w*0.5f, h, 0}, {w*0.5f, h, 0}, bn);
    push_quad(v, idx, {-w*0.5f, 0, 0}, {-w*0.5f, 0, d}, {-w*0.5f, h, d}, {-w*0.5f, h, 0}, ln);
    push_quad(v, idx, {w*0.5f, 0, d}, {w*0.5f, 0, 0}, {w*0.5f, h, 0}, {w*0.5f, h, d}, rn);
    for (int gy = 1; gy < 7; ++gy) {
        for (int gx = 1; gx < 4; ++gx) {
            float bx = -w * 0.5f + (w / 4.0f) * gx;
            float by = (h / 7.0f) * gy;
            uint32_t base = static_cast<uint32_t>(v.size());
            v.push_back({{bx, by, d + 0.008f}, fn});
            v.push_back({{bx - 0.015f, by - 0.015f, d}, fn});
            v.push_back({{bx + 0.015f, by - 0.015f, d}, fn});
            v.push_back({{bx, by + 0.015f, d}, fn});
            idx.push_back(base); idx.push_back(base + 1); idx.push_back(base + 2);
            idx.push_back(base); idx.push_back(base + 2); idx.push_back(base + 3);
        }
    }
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
        // ── Phase 1 ──────────────────────────────────────────────────────────────────────
        case PropShape::Cylinder:       build_cylinder(verts, indices);       break;
        case PropShape::HalfCylinder:   build_half_cylinder(verts, indices);  break;
        case PropShape::Arch:           build_arch(verts, indices);           break;
        case PropShape::Barrel:         build_barrel(verts, indices);         break;
        case PropShape::StairStep:      build_stair_step(verts, indices);     break;
        case PropShape::Pipe:           build_pipe(verts, indices);           break;
        // ── Phase 2 ──────────────────────────────────────────────────────────────────────
        case PropShape::PipeElbow:      build_pipe_elbow(verts, indices);     break;
        case PropShape::PipeTee:        build_pipe_tee(verts, indices);       break;
        case PropShape::Valve:          build_valve(verts, indices);          break;
        case PropShape::Grate:          build_grate(verts, indices);          break;
        case PropShape::RoundGrate:     build_round_grate(verts, indices);    break;
        case PropShape::CabinetBox:     build_cabinet_box(verts, indices);    break;
        case PropShape::ControlPanel:   build_control_panel(verts, indices);  break;
        case PropShape::Railing:        build_railing(verts, indices);        break;
        // ── Phase 3 ──────────────────────────────────────────────────────────────────────
        case PropShape::SupportBeam:    build_support_beam(verts, indices);   break;
        case PropShape::CrateBox:       build_crate_box(verts, indices);      break;
        case PropShape::CrateLong:      build_crate_long(verts, indices);     break;
        case PropShape::LockerUnit:     build_locker_unit(verts, indices);    break;
        case PropShape::BenchSlab:      build_bench_slab(verts, indices);     break;
        case PropShape::Terminal:       build_terminal(verts, indices);       break;
        case PropShape::SecurityCamera: build_security_camera(verts, indices);break;
        case PropShape::FloodLamp:      build_flood_lamp(verts, indices);     break;
        // ── Phase 4 ──────────────────────────────────────────────────────────────────────
        case PropShape::FungalColumn:   build_fungal_column(verts, indices);  break;
        case PropShape::CrystalCluster: build_crystal_cluster(verts, indices);break;
        case PropShape::AcidPool:       build_acid_pool(verts, indices);      break;
        // ── Phase 5: Soviet Khrushchevka ──────────────────────────────────────────────────
        case PropShape::Radiator:       build_radiator(verts, indices);       break;
        case PropShape::DermatinDoor:   build_dermatin_door(verts, indices);   break;
        case PropShape::ElectricalShield:build_electrical_shield(verts, indices);break;
        case PropShape::BareBulb:       build_bare_bulb(verts, indices);       break;
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
