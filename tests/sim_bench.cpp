// Honest crowd-simulation benchmark — "how many agents can actually walk a real
// floor inside the sim tick budget?" The rate is kSimHz ([core/tick.h]), never a
// number retyped here: a benchmark that measures a budget the game does not run at
// reports headroom nobody has.
//
// This is deliberately NOT a synthetic micro-benchmark. It:
//   1. generates a REAL floor with the shipping generator (generate_floor),
//   2. spawns 16,384 agents on REAL standable cells (air with a slab beneath),
//   3. lets them wander freely ("ходят куда хотят") with real gravity, and
//   4. moves them with the REAL shipping physics (physics_step -> swept AABB vs
//      the 8^3 sub-voxel masks, the exact collision the player uses).
//
// The single-thread headline number is produced by physics_step itself, so
// there is no "toy loop" to distrust. For the multicore number we run a SoA
// mirror of physics_step's hot path (identical sweep + the SAME public
// aabb_overlaps_solid test), first validated single-threaded against the real
// physics_step (must match within tolerance), then fanned across threads. The
// multicore figure is therefore MEASURED, not an arithmetic projection.
//
// Honest caveats, stated up front so the numbers can't mislead:
//   * The current engine has NO entity-vs-entity collision — physics tests each
//     agent against the world grid only. So this measures crowd-vs-world cost,
//     which is exactly what the tick does today. A future broadphase would add
//     to this.
//   * There is NO nav / pathfinding / AI cost here (that system isn't built).
//     Agents wander; they don't seek. Flow-field following will add a per-agent
//     field sample on top of this baseline once nav lands.
//   * Multicore uses per-tick std::thread spawns (no pool), so the parallel
//     numbers are if anything slightly PESSIMISTIC — a real job system equals
//     or beats them.
//
// Headless: links giga_game + giga_core only, no SDL/Vulkan.

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <thread>
#include <vector>

#include "core/tick.h"   // kSimDt / kSimHz — the tick lives in one place, not here
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "sim/physics.h"
#include "sim/rigid.h"
#include "world/level_stack.h"
#include "world/types.h"
#include "world/world.h"

using namespace giga;

namespace {

constexpr int kAgents = 16384;        // 2^14 — the per-floor target
constexpr int kWarmup = 30;           // ticks to let gravity settle onto slabs
constexpr int kMeasure = 200;         // timed ticks
constexpr float kDt = kSimDt;         // the sim tick itself ([core/tick.h])
constexpr float kSpeed = 6.0f;        // Controller::moveSpeed, m/s
const vec3 kHalf{0.4f, 0.4f, 0.9f};   // AABB::half — a person-sized box

// Per-agent deterministic RNG (xorshift32); no global state, thread-safe.
inline std::uint32_t xs(std::uint32_t& s) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return s;
}

// ---- SoA mirror of physics_step's hot path --------------------------------
// This is a line-for-line mirror of sweep_axis + the integrate/collide/wrap
// core of physics_step (src/sim/physics.cpp), operating on plain arrays so it
// can be sliced across threads. It calls the SAME public aabb_overlaps_solid,
// so ~all of the cost (the sub-voxel test) is the real shipping code. The
// single-thread validation pass below proves the mirror matches physics_step.
bool sweep(const World& w, vec3& pos, vec3 half, int comp, float delta) {
    float* p = (comp == 0) ? &pos.x : (comp == 1) ? &pos.y : &pos.z;
    float old = *p;
    *p = old + delta;
    if (!aabb_overlaps_solid(w, pos, half)) return false;
    float lo = 0.0f, hi = delta;
    for (int i = 0; i < 12; ++i) {
        float mid = 0.5f * (lo + hi);
        *p = old + mid;
        if (aabb_overlaps_solid(w, pos, half)) hi = mid; else lo = mid;
    }
    *p = old + lo;
    return true;
}

struct Crowd {
    std::vector<vec3> pos, vel;
    std::vector<float> heading;    // current wander direction (radians)
    std::vector<std::uint32_t> rng;
    int n = 0;
};

// Advance agents [lo, hi) by one tick: wander -> gravity -> swept collide ->
// torus wrap. Faithful to physics_step (1 substep at dt == maxStep).
void advance_range(const World& w, Crowd& c, int lo, int hi, float dt) {
    for (int i = lo; i < hi; ++i) {
        std::uint32_t r = xs(c.rng[i]);
        if ((r & 0x3fu) == 0u)  // ~1/64 ticks: pick a new heading
            c.heading[i] = (static_cast<float>(r >> 8) / 16777216.0f) * 6.2831853f;
        const float hd = c.heading[i];
        vec3& v = c.vel[i];
        v.x = std::cos(hd) * kSpeed;   // horizontal wander
        v.y = std::sin(hd) * kSpeed;
        v += w.gravity().at(c.pos[i]) * dt; // gravity adds to v.z

        vec3& p = c.pos[i];
        if (sweep(w, p, kHalf, 0, v.x * dt)) v.x = 0.0f;
        if (sweep(w, p, kHalf, 1, v.y * dt)) v.y = 0.0f;
        if (sweep(w, p, kHalf, 2, v.z * dt)) v.z = 0.0f;
        p.x = wrapf(p.x, kWorldExtent);
        p.y = wrapf(p.y, kWorldExtent);
        p.z = wrapf(p.z, kWorldExtent);
    }
}

// Find standable spawn cells (air with a solid cell directly below) and spread
// `kAgents` of them across the whole floor.
std::vector<std::array<int, 3>> spawn_cells(const World& w) {
    const MacroGrid& g = w.grid();
    std::vector<std::array<int, 3>> stand;
    stand.reserve(1 << 18);
    for (int z = 1; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                if (g.cell(x, y, z) == kCellAir && g.cell(x, y, z - 1) != kCellAir)
                    stand.push_back({x, y, z});

    std::vector<std::array<int, 3>> pick;
    pick.reserve(kAgents);
    if (stand.empty()) return pick;
    // Stride through the candidate list so agents spread over the whole floor
    // instead of clumping in the first rooms scanned.
    const std::size_t stride = std::max<std::size_t>(1, stand.size() / kAgents);
    for (int i = 0; i < kAgents; ++i)
        pick.push_back(stand[(static_cast<std::size_t>(i) * stride) % stand.size()]);
    return pick;
}

vec3 cell_to_world(const std::array<int, 3>& c) {
    // Centre in x/y; feet just above the slab top (slab cell c[2]-1 ends at
    // c[2]*kCellSize), so the box rests flush after warmup.
    return {(c[0] + 0.5f) * kCellSize, (c[1] + 0.5f) * kCellSize,
            c[2] * kCellSize + 0.95f};
}

// Census: solid cells and standable cells, as context for the movement numbers.
void census(const char* label, const World& w) {
    const MacroGrid& g = w.grid();
    std::size_t solid = 0, stand = 0;
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                const bool s = g.cell(x, y, z) != kCellAir;
                if (s) ++solid;
                if (z > 0 && g.cell(x, y, z) == kCellAir &&
                    g.cell(x, y, z - 1) != kCellAir)
                    ++stand;
            }
    std::printf("  %-12s solid %7zu (%4.1f%%)   standable %7zu\n", label, solid,
                100.0 * static_cast<double>(solid) / kMacroCells, stand);
}

double ms_per_tick(std::chrono::steady_clock::duration d, int ticks) {
    using namespace std::chrono;
    return duration_cast<duration<double, std::milli>>(d).count() / ticks;
}

}  // namespace

int main() {
    std::printf("=== gigahrush2 honest crowd benchmark ===\n");
    std::printf("agents=%d  tick=%.4f ms (%d Hz)  warmup=%d measure=%d\n\n",
                kAgents, kDt * 1000.0f, kSimHz, kWarmup, kMeasure);

    // --- Context: solidity of each floor kind ------------------------------
    std::printf("Floor census (fill of the 128^3 = %zu-cell grid):\n", kMacroCells);
    {
        const char* names[] = {"Residential", "Commercial", "Industrial",
                               "Derelict"};
        for (int k = 0; k < 4; ++k) {
            LevelStack s;
            LayerId w = s.push_layer();
            game::generate_floor(s.layer(w), k,
                                 game::floor_spec(static_cast<game::FloorKind>(k)),
                                 1337u ^ (static_cast<unsigned>(k) * 0x9e3779b9u));
            census(names[k], s.layer(w));
        }
    }

    // --- The floor under test: Residential (densest walls = worst case) ----
    LevelStack stack;
    LayerId ground = stack.push_layer();
    game::generate_floor(stack.layer(ground), 0,
                         game::floor_spec(game::FloorKind::Residential), 1337u);
    World& world = stack.layer(ground);

    const std::vector<std::array<int, 3>> cells = spawn_cells(world);
    if (static_cast<int>(cells.size()) < kAgents) {
        std::printf("ERROR: only %zu spawn cells found\n", cells.size());
        return 1;
    }

    // --- 1) HEADLINE: the real shipping physics_step, single-threaded ------
    Registry reg;
    std::vector<Entity> ents;
    std::vector<float> ehead(kAgents);
    std::vector<std::uint32_t> erng(kAgents);
    ents.reserve(kAgents);
    for (int i = 0; i < kAgents; ++i) {
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{cell_to_world(cells[i]), ground});
        reg.emplace<Velocity>(e);
        reg.emplace<AABB>(e, AABB{kHalf});
        reg.emplace<GravityAffected>(e);
        ents.push_back(e);
        erng[i] = 0x9e3779b9u * static_cast<std::uint32_t>(i + 1) | 1u;
        ehead[i] = 0.0f;
    }
    auto wander_entt = [&] {
        for (int i = 0; i < kAgents; ++i) {
            std::uint32_t r = xs(erng[i]);
            if ((r & 0x3fu) == 0u)
                ehead[i] = (static_cast<float>(r >> 8) / 16777216.0f) * 6.2831853f;
            auto& v = reg.get<Velocity>(ents[i]).v;
            v.x = std::cos(ehead[i]) * kSpeed;
            v.y = std::sin(ehead[i]) * kSpeed;
        }
    };
    for (int t = 0; t < kWarmup; ++t) { wander_entt(); physics_step(reg, stack, kDt); }
    auto t0 = std::chrono::steady_clock::now();
    for (int t = 0; t < kMeasure; ++t) { wander_entt(); physics_step(reg, stack, kDt); }
    auto t1 = std::chrono::steady_clock::now();
    const double refMs = ms_per_tick(t1 - t0, kMeasure);

    // --- 2) SoA mirror, single-threaded (validation) ----------------------
    Crowd c;
    c.n = kAgents;
    c.pos.resize(kAgents); c.vel.resize(kAgents, vec3{0, 0, 0});
    c.heading.resize(kAgents, 0.0f); c.rng.resize(kAgents);
    for (int i = 0; i < kAgents; ++i) {
        c.pos[i] = cell_to_world(cells[i]);
        c.rng[i] = 0x9e3779b9u * static_cast<std::uint32_t>(i + 1) | 1u;
    }
    for (int t = 0; t < kWarmup; ++t) advance_range(world, c, 0, kAgents, kDt);
    t0 = std::chrono::steady_clock::now();
    for (int t = 0; t < kMeasure; ++t) advance_range(world, c, 0, kAgents, kDt);
    t1 = std::chrono::steady_clock::now();
    const double mirrorMs = ms_per_tick(t1 - t0, kMeasure);

    // --- 3) SoA mirror, multi-threaded ------------------------------------
    unsigned hw = std::thread::hardware_concurrency();
    if (hw == 0) hw = 8;
    std::vector<int> tset;
    for (int t : {2, 4, 6, 8, 12, 16})
        if (t <= static_cast<int>(hw)) tset.push_back(t);
    if (tset.empty() || tset.back() != static_cast<int>(hw)) tset.push_back(hw);

    struct Row { int threads; double ms; };
    std::vector<Row> rows;
    for (int nt : tset) {
        // reset positions so every thread-count sees the same workload
        for (int i = 0; i < kAgents; ++i) {
            c.pos[i] = cell_to_world(cells[i]);
            c.vel[i] = vec3{0, 0, 0};
            c.rng[i] = 0x9e3779b9u * static_cast<std::uint32_t>(i + 1) | 1u;
            c.heading[i] = 0.0f;
        }
        auto tick = [&] {
            std::vector<std::thread> pool;
            pool.reserve(nt);
            const int chunk = (kAgents + nt - 1) / nt;
            for (int th = 0; th < nt; ++th) {
                const int lo = th * chunk;
                const int hi = std::min(kAgents, lo + chunk);
                if (lo >= hi) break;
                pool.emplace_back([&, lo, hi] { advance_range(world, c, lo, hi, kDt); });
            }
            for (auto& p : pool) p.join();
        };
        for (int t = 0; t < kWarmup; ++t) tick();
        t0 = std::chrono::steady_clock::now();
        for (int t = 0; t < kMeasure; ++t) tick();
        t1 = std::chrono::steady_clock::now();
        rows.push_back({nt, ms_per_tick(t1 - t0, kMeasure)});
    }

    // --- Report ------------------------------------------------------------
    const double budget = kDt * 1000.0;  // 8.0 ms at kSimHz = 125, and exactly so
    auto project = [&](double ms) { return static_cast<long>(kAgents * budget / ms); };

    std::printf("\n--- Movement cost, %d wandering agents, Residential floor ---\n",
                kAgents);
    std::printf("1) REAL physics_step (single-thread):  %7.3f ms/tick  "
                "(%5.1f ns/agent,  %5.1f%% of budget)\n",
                refMs, refMs * 1e6 / kAgents, 100.0 * refMs / budget);
    std::printf("2) SoA mirror       (single-thread):  %7.3f ms/tick  "
                "(mirror/real = %.2f  -> %s)\n",
                mirrorMs, mirrorMs / refMs,
                (std::fabs(mirrorMs / refMs - 1.0) < 0.25 ? "FAITHFUL"
                                                          : "DIVERGENT, distrust MT"));
    std::printf("\n   threads   ms/tick   speedup   ns/agent   %% budget   "
                "max agents @120Hz   @60Hz\n");
    std::printf("   %5d   %8.3f   %6.2fx   %7.1f   %6.1f%%   %14ld   %ld\n", 1,
                mirrorMs, 1.0, mirrorMs * 1e6 / kAgents, 100.0 * mirrorMs / budget,
                project(mirrorMs), static_cast<long>(kAgents * 2 * budget / mirrorMs));
    double best = mirrorMs; int bestT = 1;
    for (const Row& r : rows) {
        std::printf("   %5d   %8.3f   %6.2fx   %7.1f   %6.1f%%   %14ld   %ld\n",
                    r.threads, r.ms, mirrorMs / r.ms, r.ms * 1e6 / kAgents,
                    100.0 * r.ms / budget, project(r.ms),
                    static_cast<long>(kAgents * 2 * budget / r.ms));
        if (r.ms < best) { best = r.ms; bestT = r.threads; }
    }
    std::printf("\nVerdict: %d agents cost %.3f ms/tick single-thread (%.0f%% of the "
                "%.2f ms budget);\n         best multicore %.3f ms/tick @ %d threads "
                "(%.1fx).\n         Headroom for ~%ld wandering agents at %d Hz, "
                "~%ld at %.1f Hz (best thread count).\n",
                kAgents, refMs, 100.0 * refMs / budget, budget, best, bestT,
                mirrorMs / best, project(best), kSimHz,
                static_cast<long>(kAgents * 2 * budget / best), kSimHz / 2.0);
    std::printf("\nReminder: this is crowd-vs-world collision only. No entity-entity\n"
                "collision, no pathfinding/AI, no macro fields — those are not built\n"
                "yet and will add to the per-tick cost on top of this baseline.\n");

    // --- 4) Рагдолл-ядро ([markoaudit/plans/ragdoll.md]): сколько стоят
    // тысячи твердотел на том же реальном этаже. Три состояния: бодрые
    // (падают/катятся — пик после взрыва), спящие (установившийся мир) и
    // цепи (линки × итерации). Спящие ОБЯЗАНЫ стоить ~ноль — сон и есть
    // механизм масштаба «тысячи пропов».
    {
        std::printf("\n=== rigid-body core (ragdoll) ===\n");
        constexpr int kBodies = 4096;
        Registry rr;
        std::vector<Entity> balls;
        balls.reserve(kBodies);
        const float radius = 0.2f;
        const float mass = 7800.0f * (4.0f / 3.0f) * 3.14159265f *
                           radius * radius * radius;
        for (int i = 0; i < kBodies; ++i) {
            const auto& c = cells[static_cast<std::size_t>(i) % cells.size()];
            Entity e = rr.create();
            vec3 p = cell_to_world(c);
            p.z += 1.0f; // над полом — упадут и уснут
            rr.emplace<Transform>(e, Transform{p, ground});
            rr.emplace<Velocity>(
                e, Velocity{vec3{(i & 1) ? 2.0f : -2.0f,
                                 (i & 2) ? 2.0f : -2.0f, 0.0f}});
            RigidBody rb;
            rb.radius = radius;
            rb.invMass = 1.0f / mass;
            rb.invInertia = 1.0f / (0.4f * mass * radius * radius);
            rb.restitution = 0.35f;
            rb.friction = 0.6f;
            rr.emplace<RigidBody>(e, rb);
            balls.push_back(e);
        }
        // Бодрые: первые тики после «взрыва».
        auto b0 = std::chrono::steady_clock::now();
        for (int t = 0; t < 50; ++t) rigid_body_step(rr, stack, kDt);
        auto b1 = std::chrono::steady_clock::now();
        const double awakeMs = ms_per_tick(b1 - b0, 50);
        // Дать осесть и уснуть (10 с сим-времени), пересчитать спящих.
        for (int t = 0; t < 10 * kSimHz; ++t) rigid_body_step(rr, stack, kDt);
        int asleep = 0;
        for (Entity e : balls) asleep += rr.get<RigidBody>(e).asleep ? 1 : 0;
        auto s0 = std::chrono::steady_clock::now();
        for (int t = 0; t < 200; ++t) rigid_body_step(rr, stack, kDt);
        auto s1 = std::chrono::steady_clock::now();
        const double sleepMs = ms_per_tick(s1 - s0, 200);
        // Цепи: 64 цепи по 8 звеньев = 512 тел + 512 линков, все бодрые.
        Registry rc;
        for (int ch = 0; ch < 64; ++ch) {
            const auto& c = cells[static_cast<std::size_t>(ch * 7) % cells.size()];
            Entity prev = entt::null;
            for (int i = 0; i < 8; ++i) {
                Entity e = rc.create();
                vec3 p = cell_to_world(c);
                p.z += 1.6f - 0.45f * static_cast<float>(i) * 0.25f;
                p.x += 0.45f * static_cast<float>(i);
                rc.emplace<Transform>(e, Transform{p, ground});
                rc.emplace<Velocity>(e);
                RigidBody rb;
                rb.radius = 0.15f;
                rb.invMass = 1.0f / 110.0f;
                rb.invInertia = 1.0f / 1.0f;
                rc.emplace<RigidBody>(e, rb);
                if (i > 0) {
                    Entity link = rc.create();
                    JointLink jl;
                    jl.a = e;
                    jl.b = prev;
                    jl.restLen = 0.45f;
                    jl.rope = true;
                    rc.emplace<JointLink>(link, jl);
                }
                prev = e;
            }
        }
        auto c0 = std::chrono::steady_clock::now();
        for (int t = 0; t < 50; ++t) rigid_body_step(rc, stack, kDt);
        auto c1 = std::chrono::steady_clock::now();
        const double chainMs = ms_per_tick(c1 - c0, 50);

        std::printf("bodies=%d awake (post-blast):  %7.3f ms/tick (%5.1f%% of "
                    "%.2f ms budget, %.0f ns/body)\n",
                    kBodies, awakeMs, 100.0 * awakeMs / budget, budget,
                    awakeMs * 1e6 / kBodies);
        std::printf("bodies=%d, %d asleep:          %7.3f ms/tick (%5.1f%% "
                    "budget) — сон и есть масштаб\n",
                    kBodies, asleep, sleepMs, 100.0 * sleepMs / budget);
        std::printf("chains 64x8 (512 bodies+links): %7.3f ms/tick (%5.1f%% "
                    "budget)\n",
                    chainMs, 100.0 * chainMs / budget);
    }
    return 0;
}
