// Engine-core unit tests. No test framework dependency: a tiny CHECK macro that
// tracks failures and reports at the end. Links only giga_core (no SDL/Vulkan),
// so it runs headless in CI.
#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>

#include "core/jobs.h"
#include "core/tick.h"   // kSimDt / kSimHz — never a bare 1/120 ([core/tick.h])
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "sim/camera.h"
#include "sim/diffusion.h"
#include "sim/fluid.h"
#include "sim/physics.h"
#include "world/destruct.h"
#include "world/field.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/nav.h"
#include "world/stain.h"
#include "world/subfield.h"
#include "world/world.h"

using namespace giga;

namespace {
int g_fails = 0;
int g_checks = 0;
}

#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_checks;                                                            \
        if (!(cond)) {                                                         \
            ++g_fails;                                                         \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__,       \
                         #cond);                                               \
        }                                                                      \
    } while (0)

#define CHECK_NEAR(a, b, eps) CHECK(std::fabs((a) - (b)) <= (eps))

#include "suite_props.inl"
#include "suite_destruct.inl"
static void test_wrap() {
    CHECK(wrapi(0, 128) == 0);
    CHECK(wrapi(128, 128) == 0);
    CHECK(wrapi(-1, 128) == 127);
    CHECK(wrapi(129, 128) == 1);
    CHECK(wrap_delta(0, 127, 128) == -1); // shortest path wraps backward
    CHECK(wrap_delta(127, 0, 128) == 1);
    CHECK(wrap_delta(0, 10, 128) == 10);
}

// The minimal-image rule the renderer draws by. This is a *contract test*: the
// same expression is reimplemented in shaders/cube.vert (GLSL cannot include
// core/wrap.h), and it is what keeps the toroidal wrap seam out of view. If the
// two drift apart, geometry pops across the seam and the world stops reading as
// endless — easy to introduce, hard to notice.
static void test_nearest_image() {
    const float p = 256.0f;

    for (int ai = 0; ai < 256; ai += 7) {
        for (int ci = -600; ci <= 600; ci += 37) {
            const float a = static_cast<float>(ai);   // absolute, in [0, p)
            const float c = static_cast<float>(ci);   // reference (camera)
            const float got = nearest_image(a, c, p);

            // Reference: shift by whole periods until within [-p/2, p/2] of c.
            // This is the branch-based formulation the branchless one replaced.
            float want = a;
            while (want - c > p * 0.5f) want -= p;
            while (c - want > p * 0.5f) want += p;

            // Asserted as a property, not as equality with one arbitrary
            // tie-break. At an exact half-period tie the two images are
            // equidistant and both are correct minimal images; the branchless and
            // branch-based forms resolve it in opposite directions. That is
            // unobservable — fog is fully black at exactly p/2 — so pinning
            // equality there would be testing an accident, not the contract.
            const bool tie = std::fabs(std::fabs(got - c) - p * 0.5f) < 1e-3f;
            if (!tie) CHECK_NEAR(got, want, 1e-3f);

            CHECK(std::fabs(got - c) <= p * 0.5f + 1e-3f);
            // Congruence: (got - a) must be a whole number of periods.
            const float k = (got - a) / p;
            CHECK_NEAR(k, std::round(k), 1e-4f);
        }
    }

    // The seam cases: a cell at the origin, seen from just inside the far edge,
    // must render *ahead* of the camera rather than a whole period behind it.
    CHECK(nearest_image(0.0f, 250.0f, p) > 250.0f);
    CHECK(nearest_image(254.0f, 2.0f, p) < 2.0f);
}

static void test_submask() {
    SubMask m;
    CHECK(m.empty());
    CHECK(!m.full());
    m.set(sub_bit(1, 2, 3));
    CHECK(!m.empty());
    CHECK(m.test(sub_bit(1, 2, 3)));
    CHECK(!m.test(sub_bit(0, 0, 0)));
    m.clear(sub_bit(1, 2, 3));
    CHECK(m.empty());
    m.set_all();
    CHECK(m.full());
    CHECK(!m.empty());

    SubMask a, b;
    a.set(sub_bit(4, 4, 4));
    CHECK(!a.intersects(b));
    b.set(sub_bit(4, 4, 4));
    CHECK(a.intersects(b));
}

static void test_grid_toroidal() {
    MacroGrid g;
    g.set_cell(0, 0, 0, 7);
    // Wrap: cell(-128, ...) maps back to cell 0.
    CHECK(g.cell(kMacroDim, 0, 0) == 7);
    CHECK(g.cell(-kMacroDim, 0, 0) == 7);
    g.fill_cell(5, 6, 7, 3);
    CHECK(g.cell(5, 6, 7) == 3);
    CHECK(g.mask(5, 6, 7).full());
    g.clear_cell(5, 6, 7);
    CHECK(g.cell(5, 6, 7) == kCellAir);
    CHECK(g.mask(5, 6, 7).empty());
}

static void test_fields() {
    FieldRegistry fr;
    CHECK(!fr.exists("temperature"));
    auto& t = fr.get_or_create<float>("temperature", 20.0f);
    CHECK(fr.exists("temperature"));
    CHECK_NEAR(t.at(1, 2, 3), 20.0f, 1e-6f);
    t.at(1, 2, 3) = 55.5f;
    CHECK_NEAR(t.at(1, 2, 3), 55.5f, 1e-6f);
    // Same name returns the same field.
    auto& t2 = fr.get_or_create<float>("temperature");
    CHECK_NEAR(t2.at(1, 2, 3), 55.5f, 1e-6f);
    // Toroidal wrap on field access.
    CHECK_NEAR(t.at(1 + kMacroDim, 2, 3), 55.5f, 1e-6f);
    // Wrong-type lookup is safe (returns nullptr, no reinterpret).
    CHECK(fr.find<int>("temperature") == nullptr);
    CHECK(fr.find<float>("temperature") != nullptr);
    CHECK(fr.count() == 1);

    // A second, differently-typed field coexists.
    auto& count = fr.get_or_create<int>("population", 0);
    count.at(0, 0, 0) = 42;
    CHECK(count.at(0, 0, 0) == 42);
    CHECK(fr.count() == 2);
}

static void test_level_stack() {
    LevelStack s;
    CHECK(s.size() == 0);
    LayerId a = s.push_layer();
    LayerId b = s.push_layer();
    CHECK(s.size() == 2);
    CHECK(a == 0 && b == 1);
    CHECK(s.above(a) == b);
    CHECK(s.below(b) == a);
    CHECK(s.above(b) == kInvalidLayer); // top of stack
    CHECK(s.below(a) == kInvalidLayer); // bottom of stack
    CHECK(s.valid(a) && !s.valid(99));
}

static void test_aabb_overlap() {
    World w;
    // Fill one macro cell solid at (10,10,10). Its world span is
    // [10, 11) * kCellSize on each axis.
    w.grid().fill_cell(10, 10, 10, 1);
    float c = 10.5f * kCellSize; // center of that cell
    CHECK(aabb_overlaps_solid(w, vec3{c, c, c}, vec3{0.1f, 0.1f, 0.1f}));
    // Far away in empty space: no overlap.
    CHECK(!aabb_overlaps_solid(w, vec3{50.5f * kCellSize, 50.5f * kCellSize,
                                       50.5f * kCellSize},
                               vec3{0.1f, 0.1f, 0.1f}));
}

static void test_physics_lands_on_floor() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    // Solid floor slab at z-cell 4 across a patch.
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 10.0f * kCellSize};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{{0.2f, 0.2f, 0.4f}});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    // Simulate 3 seconds; the entity should fall and rest on the slab top. Both the
    // step and the tick count come from kSimHz, so this stays 3 real seconds if the
    // rate moves again — 360 ticks of a hardcoded 1/120 was 2.88 s at the shipping
    // 125 Hz, i.e. a shorter fall than the comment claimed.
    for (int i = 0; i < 3 * kSimHz; ++i) physics_step(reg, stack, kSimDt);

    auto& out = reg.get<Transform>(e);
    float floorTop = 5.0f * kCellSize; // top surface of z-cell 4
    // Feet should rest just above the floor: center = floorTop + half.z.
    CHECK(out.pos.z >= floorTop);
    CHECK(out.pos.z <= floorTop + 0.45f);
    CHECK(reg.get<GravityAffected>(e).grounded);
    // Did not fall through.
    CHECK(!aabb_overlaps_solid(w, out.pos, vec3{0.2f, 0.2f, 0.4f}));
}

// The manifest's smooth step: one 0.25 m sub-voxel atom is walkable without a
// jump; two atoms are a wall. Exercised through the real physics_step.
static void test_step_up_one_atom() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);
    // A one-atom ridge across the walker's path at x-cell 12: the TOP sub-voxel
    // layer of the (otherwise air) cells at z-cell 5... use the bottom layer.
    for (int y = 0; y < 20; ++y) {
        SubMask& m = w.grid().mask(12, y, 5);
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx)
                m.set(sub_bit(sx, sy, 0)); // one 0.25 m slab on the floor
        w.grid().set_cell(12, y, 5, 1);
    }
    // A two-atom ridge further along, at x-cell 15: must stay a wall.
    for (int y = 0; y < 20; ++y) {
        SubMask& m = w.grid().mask(15, y, 5);
        for (int sz = 0; sz < 2; ++sz)
            for (int sy = 0; sy < kSubDim; ++sy)
                for (int sx = 0; sx < kSubDim; ++sx)
                    m.set(sub_bit(sx, sy, sz));
        w.grid().set_cell(15, y, 5, 1);
    }

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 5.0f * kCellSize + 0.5f};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{{0.2f, 0.2f, 0.4f}});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    // Settle onto the floor first (grounded gates the step).
    for (int i = 0; i < kSimHz; ++i) physics_step(reg, stack, kSimDt);
    CHECK(reg.get<GravityAffected>(e).grounded);
    const float floorZ = reg.get<Transform>(e).pos.z;

    // Walk +x for 3 s: the one-atom ridge at cell 12 must be crossed smoothly.
    for (int i = 0; i < 3 * kSimHz; ++i) {
        reg.get<Velocity>(e).v.x = 2.0f;
        physics_step(reg, stack, kSimDt);
    }
    const vec3 stopped = reg.get<Transform>(e).pos;
    CHECK(stopped.x > 13.0f * kCellSize);          // crossed the one-atom ridge
    CHECK(stopped.x < 15.0f * kCellSize);          // held by the two-atom wall
    CHECK(stopped.z >= floorZ - 0.01f);            // never sank into the floor
    CHECK(reg.get<GravityAffected>(e).grounded);
    CHECK(!aabb_overlaps_solid(w, stopped, vec3{0.2f, 0.2f, 0.4f}));
}

// The universal stain layer ([world/stain.h]): additive per-atom RGB on solid
// sub-voxels — blood + urine mix by channel addition, air holds no paint.
static void test_stain_layer() {
    World w;
    w.grid().fill_cell(10, 10, 10, 1);

    // Air holds no paint; zero adds paint nothing.
    CHECK(stain_paint(w, 10, 10, 10, kStainBlood) == UINT32_MAX);
    CHECK(stain_paint(w, 10 * kSubDim, 10 * kSubDim, 10 * kSubDim,
                      StainRGB{}) == UINT32_MAX);

    // Paint one solid atom twice: channels ADD with saturation.
    const int g = 10 * kSubDim; // the cell's first atom, global sub coords
    const std::uint32_t ci = stain_paint(w, g, g, g, kStainBlood);
    CHECK(ci == macro_index(10, 10, 10));
    CHECK(stain_paint(w, g, g, g, kStainUrine) == ci);
    const auto* f = w.subfields().find<StainRGB>(kStainFieldName);
    CHECK(f != nullptr);
    const StainRGB s = f->at(ci, 0, StainRGB{});
    CHECK(s.r == 255); // 150 + 140 saturates
    CHECK(s.g == 132); // 12 + 120: emergent mix, no substance branch anywhere
    CHECK(s.b == 35);

    // Splatter against a wall: deterministic, paints, reports dirty cells.
    World v;
    for (int z = 8; z < 12; ++z)
        for (int y = 8; y < 12; ++y)
            v.grid().fill_cell(10, y, z, 1);
    std::vector<std::uint32_t> dirty;
    const vec3 at{9.0f * kCellSize, 10.0f * kCellSize, 10.0f * kCellSize};
    const std::int32_t a = stain_splat(v, at, vec3{1, 0, 0}, 4.0f, 16,
                                       kStainBlood, 777u, dirty);
    CHECK(a > 0);
    CHECK(!dirty.empty());
    std::vector<std::uint32_t> dirty2;
    World u;
    for (int z = 8; z < 12; ++z)
        for (int y = 8; y < 12; ++y)
            u.grid().fill_cell(10, y, z, 1);
    CHECK(stain_splat(u, at, vec3{1, 0, 0}, 4.0f, 16, kStainBlood, 777u,
                      dirty2) == a); // same seed, same bytes
}

static void test_fluid_conserves_mass() {
    World w;
    // Solid floor everywhere at z-cell 0 so fluid cannot drain off the bottom.
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x)
            w.grid().fill_cell(x, y, 0, 1);

    auto& f = w.fields().get_or_create<float>("fluid", 0.0f);
    f.at(64, 64, 5) = 10.0f;

    auto total = [&]() {
        double s = 0;
        for (float v : f.data()) s += v;
        return s;
    };
    double before = total();
    for (int i = 0; i < 50; ++i) fluid_step(w);
    double after = total();
    // Mass is conserved (no sources/sinks); allow tiny FP drift.
    CHECK_NEAR(after, before, 1e-3);
    CHECK(before > 9.9 && before < 10.1);
}

// The diffusion danger/scent field (increment D): a source spreads to its open
// neighbours, wraps across the torus seam, is blocked by walls (no flux), yields
// a flee gradient, steps deterministically, and decays toward zero without a
// source. It is stepped like fluid but is NOT mass-conserving (it evaporates).
static void test_diffusion() {
    auto total = [](const Field<float>& f) {
        double s = 0;
        for (float v : f.data()) s += v;
        return s;
    };

    // 1) One step spreads a central spike symmetrically to its 6 neighbours, and
    //    total mass drops (evaporation) but stays positive.
    {
        World w; // all air
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 100.0f;
        const double before = total(f);
        diffusion_step(w);
        CHECK(f.at(64, 64, 64) < 100.0f);
        const float nb = f.at(65, 64, 64);
        CHECK(nb > 0.0f);
        CHECK(f.at(63, 64, 64) == nb); // symmetric on every face
        CHECK(f.at(64, 65, 64) == nb);
        CHECK(f.at(64, 63, 64) == nb);
        CHECK(f.at(64, 64, 65) == nb);
        CHECK(f.at(64, 64, 63) == nb);
        const double after = total(f);
        CHECK(after < before && after > 0.0);
    }

    // 2) Periodic on the torus: a spike at x=0 leaks across the seam to x=127.
    {
        World w;
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(0, 10, 10) = 50.0f;
        diffusion_step(w);
        CHECK(f.at(127, 10, 10) > 0.0f); // wrapped -x neighbour received flux
    }

    // 3) Walls block flux (no-flux boundary): a fully-solid neighbour receives
    //    nothing and holds nothing, while the open neighbours still take their
    //    share.
    {
        World w;
        w.grid().fill_cell(65, 64, 64, 1); // wall the +x neighbour of the source
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 100.0f;
        diffusion_step(w);
        CHECK(f.at(65, 64, 64) == 0.0f); // wall holds nothing
        CHECK(f.at(63, 64, 64) > 0.0f);  // the open -x side still receives
    }

    // 4) Flee gradient: after diffusing a spike, danger falls with distance, so at
    //    a cell on the +x side the gradient points back toward the source (-x) and
    //    an agent flees along -gradient (+x, away). Symmetric axes read ~0.
    {
        World w;
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 100.0f;
        for (int s = 0; s < 8; ++s) diffusion_step(w);
        const vec3 grad = diffusion_gradient(f, w.grid(), 68, 64, 64);
        CHECK(grad.x < 0.0f);                       // danger increases toward -x
        CHECK(grad.y < 1e-6f && grad.y > -1e-6f);   // symmetric off-axis
        CHECK(grad.z < 1e-6f && grad.z > -1e-6f);
    }

    // 5) Deterministic: two identical seedings step bit-identically.
    {
        World a, b;
        auto seed = [](World& w) {
            auto& f = w.fields().get_or_create<float>("danger", 0.0f);
            f.at(64, 64, 64) = 100.0f;
            f.at(20, 30, 40) = 40.0f;
        };
        seed(a);
        seed(b);
        for (int s = 0; s < 16; ++s) { diffusion_step(a); diffusion_step(b); }
        const Field<float>* fa = a.fields().find<float>("danger");
        const Field<float>* fb = b.fields().find<float>("danger");
        CHECK(fa != nullptr && fb != nullptr);
        CHECK(fa->data().size() == fb->data().size());
        CHECK(std::memcmp(fa->data().data(), fb->data().data(),
                          fa->data().size() * sizeof(float)) == 0);
    }

    // 6) Stable + decaying: with no fresh source the total never grows and trends
    //    well below the initial mass (evaporation wins; no blow-up).
    {
        World w;
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 10.0f;
        double prev = 1e30;
        for (int s = 0; s < 50; ++s) {
            diffusion_step(w);
            const double t = total(f);
            CHECK(t <= prev + 1e-3); // monotone non-increasing (stability + decay)
            prev = t;
        }
        CHECK(prev < 10.0); // decayed below where it started
    }
}

static void test_camera_component_is_movable() {
    Registry reg;
    // No camera yet.
    CameraMatrices none = compute_camera(reg, 1.0f);
    CHECK(!none.valid);

    Entity a = reg.create();
    reg.emplace<Transform>(a, Transform{vec3{1, 2, 3}, 0});
    reg.emplace<CameraTag>(a, CameraTag{});
    CameraMatrices m = compute_camera(reg, 1.777f);
    CHECK(m.valid);
    CHECK_NEAR(m.eye.x, 1.0f, 1e-4f);
}

// The bake-time job system (src/core/jobs.h). Its whole contract is that a
// parallel run over disjoint indices equals the serial run — deterministic, not
// merely "eventually the same".
static void test_parallel_for() {
    const int n = 10000;
    std::vector<int> a(n, -1);
    parallel_for(n, [&a](int i) { a[i] = i * i; });
    for (int i = 0; i < n; ++i) CHECK(a[i] == i * i);

    // Degenerate ranges are safe: n<=0 never calls the body, n==1 calls once.
    parallel_for(0, [](int) { CHECK(false); }); // body must never run
    int calls = 0, last = -1;
    parallel_for(1, [&](int i) { ++calls; last = i; });
    CHECK(calls == 1 && last == 0);

    // A forced single worker gives the identical result to the multi-thread run.
    std::vector<int> b(n, -1);
    parallel_for(n, [&b](int i) { b[i] = i * i; }, /*threads=*/1);
    CHECK(a == b);
}

// L1 nav bake on open space (master_prompt #11). A fresh MacroGrid is all-air
// (empty masks) hence fully walkable, so this isolates the graph math from any
// floor geometry: the coarse graph must be complete, symmetric, and SEAM-FREE.
static void test_nav_coarse() {
    using namespace nav;
    MacroGrid air;
    CoarseGraph g{};
    bake_coarse(air, g);

    for (int i = 0; i < kNodes; ++i) {
        CHECK(g.dist[i][i] == 0);
        for (int j = 0; j < kNodes; ++j) {
            CHECK(g.dist[i][j] != kUnreachable);  // fully connected
            CHECK(g.dist[i][j] == g.dist[j][i]);  // symmetric geometry
        }
    }
    // Every lattice edge is one clear spacing (32) through open air.
    for (int i = 0; i < kNodes; ++i)
        for (int d = 0; d < 6; ++d) CHECK(g.edge[i][d] == kLatticeSpacing);

    // No seam: node 0's antipode on (Z/4)^3 is (2,2,2). On the torus each axis
    // hop-pair costs 2*32 = 64, so the coarse distance is 3*64 = 192 and routing
    // reaches it in EXACTLY 6 lattice hops. A spanning tree over the torus would
    // blow both up — that is the reference's documented failure this rules out.
    const int antipode = lattice_id(2, 2, 2);
    CHECK(g.dist[0][antipode] == 192);
    int cur = 0, hops = 0;
    while (cur != antipode && hops <= kNodes) {
        cur = coarse_next(g, cur, antipode);
        ++hops;
    }
    CHECK(cur == antipode);
    CHECK(hops == 6);

    // Deterministic: a second bake is bit-identical (schedule-invariant).
    CoarseGraph g2{};
    bake_coarse(air, g2);
    CHECK(std::memcmp(&g, &g2, sizeof(CoarseGraph)) == 0);
}

// L2 fine bake on open space. Following a node's flow field must descend a
// SHORTEST wrapped path: on all-air the step count equals the wrapped Manhattan
// distance to that node's cell — proving the field is both correct and, being a
// BFS parent chain, cycle-free (it always arrives). Plus determinism.
static void test_nav_fine() {
    using namespace nav;
    MacroGrid air;
    FineNav f;
    bake_fine(air, f);

    // The node cell itself is "arrived".
    CHECK(f.at(0, 16, 16, 16) == kFlowArrived);

    auto follow = [&](int node, int x, int y, int z) -> int {
        int cx = x, cy = y, cz = z;
        for (int steps = 0; steps <= 4 * kMacroDim; ++steps) {
            const std::uint8_t d = f.at(node, cx, cy, cz);
            if (d == kFlowArrived) return steps;
            if (d == kFlowNone) return -1; // no route (never, on open air)
            cx = wrap_macro(cx + kNavDir[d][0]);
            cy = wrap_macro(cy + kNavDir[d][1]);
            cz = wrap_macro(cz + kNavDir[d][2]);
        }
        return -2; // exceeded the bound without arriving
    };
    auto wrapped_manhattan = [](int a, int b) {
        int d = a - b < 0 ? b - a : a - b;
        return d < kMacroDim - d ? d : kMacroDim - d;
    };
    // Node 0's cell is (16,16,16); sample cells at varied wrapped distances.
    const int cells[][3] = {
        {16, 16, 16}, {17, 16, 16}, {48, 16, 16}, {100, 50, 80}, {0, 0, 0},
    };
    for (auto& c : cells) {
        const int expect = wrapped_manhattan(c[0], 16) +
                           wrapped_manhattan(c[1], 16) +
                           wrapped_manhattan(c[2], 16);
        CHECK(follow(0, c[0], c[1], c[2]) == expect);
    }

    // Nearest-node field (C.2): every node's own cell is its own anchor, and a
    // cell well inside a Voronoi band resolves to that band's node. Bands are
    // [i*32,(i+1)*32) with centres {16,48,80,112}, so (20,52,84) -> node (0,1,2).
    for (int id = 0; id < kNodes; ++id) {
        const LatticeNode n = lattice_unpack(id);
        CHECK(f.nearest_node(lattice_coord(n.ix), lattice_coord(n.iy),
                             lattice_coord(n.iz)) == id);
    }
    CHECK(f.nearest_node(20, 52, 84) == lattice_id(0, 1, 2));
    // Consistency: descending your own nearest anchor's field is a legal step.
    CHECK(f.at(f.nearest_node(20, 52, 84), 20, 52, 84) != kFlowNone);

    // Deterministic: a second bake is bit-identical (schedule-invariant), for
    // both the flow fields and the (single-threaded) nearest-node field.
    FineNav f2;
    bake_fine(air, f2);
    CHECK(f.flow.size() == f2.flow.size());
    CHECK(std::memcmp(f.flow.data(), f2.flow.data(), f.flow.size()) == 0);
    CHECK(f.nearest.size() == f2.nearest.size());
    CHECK(std::memcmp(f.nearest.data(), f2.nearest.data(), f.nearest.size()) == 0);
}

// route_step (master_prompt #11 C.2): the O(1) tick query that composes the
// nearest-node field + coarse reachability + a flow field into one step. On open
// air the route is a straight wrapped-Manhattan descent to the target's anchor.
static void test_route_step() {
    using namespace nav;
    MacroGrid air;
    FineNav f;
    bake_fine(air, f);
    CoarseGraph g{};
    bake_coarse(air, g);

    // Standing on the destination cell: arrived, no step.
    CHECK(route_step(g, f, ivec3{40, 40, 40}, ivec3{40, 40, 40}) == kFlowArrived);

    // Follow route_step from node 0's centre to node 63's centre. Every step
    // descends field 63 (the destination's anchor), so the walk is a shortest
    // wrapped path and arrives in exactly the wrapped-Manhattan cell count.
    const ivec3 to{112, 112, 112}; // node 63 centre (== lattice_id(3,3,3))
    int cx = 16, cy = 16, cz = 16, steps = 0; // node 0 centre
    for (; steps <= 4 * kMacroDim; ++steps) {
        const std::uint8_t d = route_step(g, f, ivec3{cx, cy, cz}, to);
        CHECK(d != kFlowNone); // open air is fully reachable
        if (d == kFlowArrived) break;
        cx = wrap_macro(cx + kNavDir[d][0]);
        cy = wrap_macro(cy + kNavDir[d][1]);
        cz = wrap_macro(cz + kNavDir[d][2]);
    }
    CHECK(cx == 112 && cy == 112 && cz == 112);
    CHECK(steps == 3 * 32); // |112-16| wraps to 32 per axis, over three axes

    // Unreachable: a fully-solid target is claimed by no anchor, so there is no
    // field to it -> kFlowNone. Symmetrically, routing FROM inside solid fails.
    MacroGrid walled;
    walled.fill_cell(0, 0, 0, 1);
    FineNav fw;
    bake_fine(walled, fw);
    CoarseGraph gw{};
    bake_coarse(walled, gw);
    CHECK(fw.nearest_node(0, 0, 0) == kFlowNone);
    CHECK(route_step(gw, fw, ivec3{16, 16, 16}, ivec3{0, 0, 0}) == kFlowNone);
    CHECK(route_step(gw, fw, ivec3{0, 0, 0}, ivec3{16, 16, 16}) == kFlowNone);

    // Coarse-unreachable branch: wall node 0's centre in on all 6 faces so its
    // air pocket is a disconnected component. Its anchor still claims its own
    // cell, but nothing reaches it, so routing to it returns kFlowNone via the
    // O(1) coarse reachability guard — a different path than "target in solid".
    MacroGrid isolated;
    for (int d = 0; d < 6; ++d)
        isolated.fill_cell(16 + kNavDir[d][0], 16 + kNavDir[d][1],
                           16 + kNavDir[d][2], 1);
    FineNav fi;
    bake_fine(isolated, fi);
    CoarseGraph gi{};
    bake_coarse(isolated, gi);
    CHECK(fi.nearest_node(16, 16, 16) == 0);  // node 0 still owns its own cell
    CHECK(gi.dist[1][0] == kUnreachable);     // but it is cut off from the rest
    CHECK(route_step(gi, fi, ivec3{48, 48, 48}, ivec3{16, 16, 16}) == kFlowNone);
}

int main() {
    test_wrap();
    test_nearest_image();
    test_submask();
    test_grid_toroidal();
    test_fields();
    test_level_stack();
    test_aabb_overlap();
    test_physics_lands_on_floor();
    test_fluid_conserves_mass();
    test_diffusion();
    test_camera_component_is_movable();
    test_parallel_for();
    test_nav_coarse();
    test_nav_fine();
    test_route_step();
    test_destruct_all();

    test_step_up_one_atom();
    test_stain_layer();
    test_props_all();
    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    if (g_fails) {
        std::printf("FAILED (%d)\n", g_fails);
        return 1;
    }
    std::printf("OK\n");
    return 0;
}
