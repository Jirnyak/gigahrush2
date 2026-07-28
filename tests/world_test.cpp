// Engine-core unit tests. No test framework dependency: a tiny CHECK macro that
// tracks failures and reports at the end. Links only giga_core (no SDL/Vulkan),
// so it runs headless in CI.
#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>

#include "core/jobs.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "sim/camera.h"
#include "sim/fluid.h"
#include "sim/physics.h"
#include "world/field.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/nav.h"
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

static void test_wrap() {
    CHECK(wrapi(0, 128) == 0);
    CHECK(wrapi(128, 128) == 0);
    CHECK(wrapi(-1, 128) == 127);
    CHECK(wrapi(129, 128) == 1);
    CHECK(wrap_delta(0, 127, 128) == -1); // shortest path wraps backward
    CHECK(wrap_delta(127, 0, 128) == 1);
    CHECK(wrap_delta(0, 10, 128) == 10);
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

    // Simulate ~3 seconds; the entity should fall and rest on the slab top.
    for (int i = 0; i < 360; ++i) physics_step(reg, stack, 1.0f / 120.0f);

    auto& out = reg.get<Transform>(e);
    float floorTop = 5.0f * kCellSize; // top surface of z-cell 4
    // Feet should rest just above the floor: center = floorTop + half.z.
    CHECK(out.pos.z >= floorTop);
    CHECK(out.pos.z <= floorTop + 0.45f);
    CHECK(reg.get<GravityAffected>(e).grounded);
    // Did not fall through.
    CHECK(!aabb_overlaps_solid(w, out.pos, vec3{0.2f, 0.2f, 0.4f}));
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

int main() {
    test_wrap();
    test_submask();
    test_grid_toroidal();
    test_fields();
    test_level_stack();
    test_aabb_overlap();
    test_physics_lands_on_floor();
    test_fluid_conserves_mass();
    test_camera_component_is_movable();
    test_parallel_for();
    test_nav_coarse();

    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    if (g_fails) {
        std::printf("FAILED (%d)\n", g_fails);
        return 1;
    }
    std::printf("OK\n");
    return 0;
}
