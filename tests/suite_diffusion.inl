// Diffusion field tests. Included into game_test.cpp, so it uses that file's CHECK
// macro and its `using namespace giga` / `using namespace giga::game`. It lives in
// game_test rather than world_test because the cost measurement runs on a REAL floor,
// and `generate_floor` is giga_game.
//
// The whole point of this suite is that a diffusion field's documented behaviour is
// checkable EXACTLY, not approximately, so nothing here asserts a vague "it spread a
// bit". Three exact facts do most of the work:
//
//   1. The front advances exactly ONE cell per sweep, so after n sweeps the non-zero
//      set is exactly the L1 ball of radius n: 7, 25, 63 cells for n = 1, 2, 3 (the
//      count of integer points with |dx|+|dy|+|dz| = k is 4k^2 + 2 for k >= 1). That is
//      the strongest possible statement of "this is a local stencil and not a search".
//   2. The open-neighbour Laplacian is antisymmetric per pair, so total mass is
//      multiplied by (1 - decay) and by nothing else: 0.98^n, to float precision.
//   3. A fully solid cell exchanges nothing, which is a no-flux wall. So a sealed cell
//      ONLY decays and a walled region can be entered only through its doorway.
//
// EVERY ASSERTION IS A WORK COUNT OR AN EXACT VALUE. The cost block at the bottom
// measures and PRINTS milliseconds, and asserts nothing about them: a wall-clock
// threshold is a test that fails on a loaded CI box and passes on a fast one, which
// tells you about the box and not about the code. What it does assert is that the work
// actually happened — that the bitset was built, that the sweep reported exactly as many
// open cells as the bitset holds, and that the field existed.
//
// That block prints TWO figures, and the second one is not decoration. The sweep proves
// that a 64-cell run of the field whose whole read neighbourhood is bitwise zero
// computes to zero, and writes 0 over it instead ([sim/diffusion.cpp]) — so its cost
// depends on how much danger is actually in flight. A sparse floor (the normal state,
// and the only thing this file used to time) is ~3x cheaper per open cell than a
// saturated one. Timing only the sparse case would publish a number that quietly
// assumed the floor was quiet, so the SATURATED case is measured too and pinned with
// liveCells == openCells, which is the work count that proves nothing was skipped.
// A separate block above it fires one source at every run / row / plane / seam boundary
// and checks all six faces exactly, because a wrong neighbourhood in that skip would
// not corrupt a total — it would silently stop danger crossing one boundary.
//
// The toroidal assertions deserve a note. In this engine z DOES wrap: [world.md] says
// "x/y/z wrap (torus); W does not", and Field::at / MacroGrid::mask apply wrap_macro to
// all three axes unconditionally, so diffusion could not opt out of the z wrap without
// contradicting the accessors it reads through. [floor_gen.cpp] depends on that wrap —
// every storey height divides 128 so "the top storey's ceiling is floor-0's slab". What
// is genuinely NOT toroidal is W, the layer axis, and that is asserted below:
// diffusion_step takes one World, so a sweep cannot touch another floor at all.

#include <bit>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "core/rng.h"
#include "core/tick.h"
#include "game/floor_gen.h"  // generate_floor — the cost block times REAL geometry
#include "game/floor_spec.h" // floor_spec / FloorKind
#include "sim/diffusion.h"
#include "world/lattice.h"   // lattice_coord — the cells guaranteed to be air
#include "world/materials.h" // kMatConcrete — a real wall id, not a magic 1

namespace {

// Count non-zero cells and their total, read straight out of the field rather than out
// of DiffusionStep — so the step's own bookkeeping is verified against an independent
// scan instead of being trusted.
void diffusion_scan(const Field<float>& f, std::uint32_t& nonZero, double& total) {
    nonZero = 0;
    total = 0.0;
    const std::vector<float>& d = f.data();
    for (std::size_t i = 0; i < d.size(); ++i)
        if (d[i] != 0.0f) {
            ++nonZero;
            total += static_cast<double>(d[i]);
        }
}

// Cells within L1 distance r of a point, on the 128^3 torus: 1 + sum_{k=1..r} (4k^2+2).
// Valid only while r is small enough that the ball does not wrap onto itself (r < 64).
std::uint32_t diffusion_l1_ball_cells(int r) {
    std::uint32_t n = 1;
    for (int k = 1; k <= r; ++k) n += static_cast<std::uint32_t>(4 * k * k + 2);
    return n;
}

// Open cells in a walkability bitset, straight off the words. This is the denominator
// every cost claim in [sim/diffusion.h] rests on.
std::size_t diffusion_open_count(const DiffusionScratch& sc) {
    std::size_t n = 0;
    for (const std::uint64_t w : sc.open) n += static_cast<std::size_t>(std::popcount(w));
    return n;
}

} // namespace

static void test_diffusion_all() {
    // Load-bearing for every cost and cadence claim in [sim/diffusion.h], so pinned at
    // build time rather than restated in prose. kSimStepMs == 8 is the 125 Hz fact: at
    // the old 1/120 the integer-millisecond conversion truncated to 8 anyway and every
    // authored duration ran 4.17% slow ([core/tick.h]).
    static_assert(kMacroCells == 2097152u, "128^3; the 8.00 MiB float field needs it");
    static_assert(kSimHz == 125, "the sweep cadence below is stated in 125 Hz ticks");
    static_assert(kSimStepMs == 8, "one sim step is exactly 8 ms, not 8.333");
    static_assert(kDiffusionSweepTicks == 25, "25 ticks at 125 Hz is 5 sweeps/s");
    static_assert(kDiffusionSweepsPerSec == 5, "and that is an integer, by assert");
    static_assert(kDiffusionMaxRate > 0.166f && kDiffusionMaxRate < 0.167f, "1/6");

    { // ---- the front advances exactly one cell per sweep, and mass decays by 0.98 ----
        World w; // default MacroGrid is all air, so this is the clean free-space case
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        CHECK(sc.walkable_ready());
        CHECK(!sc.geomDirty); // a refresh clears the valve
        // All air, so the bitset must be entirely set: 2,097,152 open cells.
        CHECK(diffusion_open_count(sc) == kMacroCells);

        // A non-creating step on a layer nobody has wounded must be free and must SAY
        // it is: no field, no allocation, present == false. This is the regression guard
        // for the get_or_create-in-the-step mistake [sim/fluid.cpp] documents making.
        const DiffusionStep dry = diffusion_step(w, sc);
        CHECK(!dry.present);
        CHECK(dry.total == 0.0f);
        CHECK(dry.openCells == 0u); // it did no work at all, not "cheap work"
        CHECK(w.fields().find<float>(kDangerField) == nullptr);

        CHECK(diffusion_add(w, 64, 64, 64, 1.0f) == 1.0f);
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return; // nothing below is meaningful without the field

        for (int n = 1; n <= 3; ++n) {
            const DiffusionStep st = diffusion_step(w, sc);
            CHECK(st.present);
            // The sweep's work count: every cell is open here, so it took the open
            // branch 2,097,152 times. This is the assertion that replaces a timing one.
            CHECK(st.openCells == static_cast<std::uint32_t>(kMacroCells));

            std::uint32_t nonZero = 0;
            double total = 0.0;
            diffusion_scan(*fp, nonZero, total);

            // Exact, not approximate: the open-neighbour stencil reaches exactly the
            // 6-neighbourhood per sweep, so the support is the L1 ball of radius n.
            CHECK(nonZero == diffusion_l1_ball_cells(n));
            CHECK(st.liveCells == nonZero); // the step's own count agrees with the scan

            // Mass is multiplied by keep = 1 - decay and by nothing else, because every
            // open pair exchanges equal and opposite amounts. No cell has fallen under
            // minLevel yet at n <= 3 (the smallest is rate^3*keep^3 = 0.00318, which is
            // 31x minLevel), so this is the undamaged figure.
            const double want = std::pow(0.98, static_cast<double>(n));
            CHECK(std::fabs(total - want) < 1e-5);
            CHECK(std::fabs(static_cast<double>(st.total) - want) < 1e-5);
        }
        CHECK(diffusion_l1_ball_cells(1) == 7u); // the three counts, spelled out
        CHECK(diffusion_l1_ball_cells(2) == 25u);
        CHECK(diffusion_l1_ball_cells(3) == 63u);

        // The pulse HOLLOWS OUT: by sweep 3 the peak has left the source cell, because
        // a cell with six open neighbours loses 6*rate of itself per sweep and only
        // gains back what the shell has. Hand-computed for these parameters: centre
        // 0.0391 vs face 0.0519 after three sweeps, a 33% margin — so this is a real
        // structural property of the stencil and not a float coincidence.
        CHECK(fp->at(64, 64, 64) < fp->at(65, 64, 64));
        CHECK(fp->at(65, 64, 64) == fp->at(63, 64, 64)); // and the shell stays symmetric
    }

    { // ---- x, y AND z all wrap; the corner is not special ----
        World w;
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        diffusion_add(w, 0, 0, 0, 1.0f);
        diffusion_step(w, sc);
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return;

        // One sweep from a unit source puts rate*keep = 0.15*0.98 = 0.147 in each of
        // the six faces. Three of those faces are at coordinate 127, reachable only by
        // wrapping — including z.
        const float face = 0.15f * 0.98f;
        CHECK(std::fabs(fp->at(127, 0, 0) - face) < 1e-6f); // -x wrapped
        CHECK(std::fabs(fp->at(0, 127, 0) - face) < 1e-6f); // -y wrapped
        CHECK(std::fabs(fp->at(0, 0, 127) - face) < 1e-6f); // -z wrapped, on purpose
        CHECK(std::fabs(fp->at(1, 0, 0) - face) < 1e-6f);   // +x unwrapped, for contrast
        // A face neighbour and a wrapped face neighbour are the same distance, so they
        // must hold the same level to the bit. Anything else is a seam.
        CHECK(fp->at(127, 0, 0) == fp->at(1, 0, 0));
        CHECK(fp->at(0, 0, 127) == fp->at(0, 0, 1));
        // Diagonals are L1 = 2 and have not been reached yet.
        CHECK(fp->at(127, 127, 0) == 0.0f);
    }

    { // ---- W does not wrap: a sweep cannot reach another layer ----
        // The real "storeys do not leak" property. Not an arithmetic boundary condition
        // — a World IS one layer ([world.md]), so diffusion_step's signature is the
        // isolation. Asserted anyway, because the day someone adds a "sweep the stack"
        // convenience wrapper this is the check that notices it took a shortcut.
        World a, b;
        DiffusionScratch sa, sb;
        diffusion_refresh_walkable(a.grid(), sa);
        diffusion_refresh_walkable(b.grid(), sb);

        diffusion_add(a, 64, 64, 127, 1.0f); // hard against the top of layer a
        for (int i = 0; i < 3; ++i) diffusion_step(a, sa);

        // Layer b never had a field created, let alone filled. Stronger than "all
        // zero": the 8.00 MiB was never allocated.
        CHECK(b.fields().find<float>(kDangerField) == nullptr);
        CHECK(diffusion_at(b, 64, 64, 0) == 0.0f);
        CHECK(diffusion_at(b, 64, 64, 126) == 0.0f);
        // And a's own z wrap did happen, which is what makes the above a statement
        // about W rather than an accident of the source being far from any boundary.
        CHECK(diffusion_at(a, 64, 64, 0) > 0.0f);

        const DiffusionStep sbStep = diffusion_step(b, sb);
        CHECK(!sbStep.present);
        CHECK(sbStep.openCells == 0u);
    }

    { // ---- a sealed cell only decays; solid cells are pinned to 0 ----
        World w;
        // Seal (64,64,64) behind its six faces. 2 m per cell ([world/types.h]), so this
        // is a person-sized void with 2 m of rock on every side.
        w.grid().fill_cell(63, 64, 64, kMatConcrete);
        w.grid().fill_cell(65, 64, 64, kMatConcrete);
        w.grid().fill_cell(64, 63, 64, kMatConcrete);
        w.grid().fill_cell(64, 65, 64, kMatConcrete);
        w.grid().fill_cell(64, 64, 63, kMatConcrete);
        w.grid().fill_cell(64, 64, 65, kMatConcrete);
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        // Six cells were filled, so exactly six bits are clear.
        CHECK(diffusion_open_count(sc) == kMacroCells - 6u);

        // A source dropped inside rock is refused, not stored: the sweep would pin it
        // to 0 next tick and `total` would report mass that cannot exist.
        CHECK(diffusion_add(w, 63, 64, 64, 5.0f) == 0.0f);
        CHECK(w.fields().find<float>(kDangerField) == nullptr); // and it created nothing

        CHECK(diffusion_add(w, 64, 64, 64, 1.0f) == 1.0f);
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return;

        for (int n = 1; n <= 5; ++n) {
            const DiffusionStep st = diffusion_step(w, sc);
            // acc == 0 because every neighbour is a wall, so the cell is pure decay.
            const float want = std::pow(0.98f, static_cast<float>(n));
            CHECK(std::fabs(fp->at(64, 64, 64) - want) < 1e-5f);
            CHECK(st.liveCells == 1u);
            CHECK(st.openCells == static_cast<std::uint32_t>(kMacroCells - 6u));
        }
        CHECK(fp->at(63, 64, 64) == 0.0f); // the wall itself holds nothing
        CHECK(fp->at(65, 64, 64) == 0.0f);
        CHECK(fp->at(64, 64, 65) == 0.0f);

        // Both sides of every axis are walls, so every component of the gradient is the
        // documented "0 when both sides are walls" case.
        const vec3 g = diffusion_gradient(*fp, w.grid(), 64, 64, 64);
        CHECK(g.x == 0.0f && g.y == 0.0f && g.z == 0.0f);
        const vec3 gb = diffusion_gradient(*fp, sc, 64, 64, 64);
        CHECK(gb.x == g.x && gb.y == g.y && gb.z == g.z);
    }

    { // ---- danger enters a walled region ONLY through the doorway ----
        // Two solid planes at x = 0 and x = 64 cut the torus into two slabs (one plane
        // would not — the torus wraps, so a single cut leaves one connected region). One
        // cell of the x = 64 plane is punched open, and that hole is the only way across.
        World w;
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y) {
                w.grid().fill_cell(0, y, z, kMatConcrete);
                w.grid().fill_cell(64, y, z, kMatConcrete);
            }
        w.grid().clear_cell(64, 64, 64); // the doorway
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        // Two full 128x128 planes solid, minus the one doorway cell punched back open.
        CHECK(diffusion_open_count(sc) == kMacroCells - 2u * 128u * 128u + 1u);

        diffusion_add(w, 63, 64, 64, 1.0f); // room A, right against the doorway
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return;

        auto count_beyond = [&](int fromX) {
            std::uint32_t n = 0;
            for (int z = 0; z < kMacroDim; ++z)
                for (int y = 0; y < kMacroDim; ++y)
                    for (int x = fromX; x < kMacroDim; ++x)
                        if (fp->at(x, y, z) != 0.0f) ++n;
            return n;
        };

        diffusion_step(w, sc);
        CHECK(fp->at(64, 64, 64) > 0.0f); // reached the doorway
        CHECK(count_beyond(65) == 0u);    // and nothing at all past it yet
        // The x = 0 plane is solid, so the toroidal route from x = 63 round through
        // x = 127 is closed. Without the no-flux wall this cell would already be lit.
        CHECK(fp->at(127, 64, 64) == 0.0f);

        diffusion_step(w, sc);
        // Exactly ONE cell past the doorway, and it is the one directly behind it.
        // Danger walks through the hole; it does not appear on the far side.
        CHECK(count_beyond(65) == 1u);
        CHECK(fp->at(65, 64, 64) > 0.0f);
        CHECK(fp->at(127, 64, 64) == 0.0f);

        for (int i = 0; i < 6; ++i) diffusion_step(w, sc);
        // Eight sweeps in, the far side of the x = 0 wall is still untouched: the wall
        // is a permanent no-flux boundary, not a delay.
        CHECK(fp->at(127, 64, 64) == 0.0f);
        // Room A's own far end is 62 cells from the source and the front advances
        // exactly one cell per sweep, so at 8 sweeps it must still be dark. Diffusion
        // is a local stencil, not a flood fill of the connected component.
        CHECK(fp->at(1, 64, 64) == 0.0f);
        CHECK(fp->at(65, 64, 64) > 0.0f);
    }

    { // ---- the gradient: direction, one-sided at a wall, and both overloads agree ----
        World w;
        w.grid().fill_cell(66, 64, 64, kMatConcrete); // a wall +x of cell 65
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        diffusion_add(w, 64, 64, 64, 1.0f);
        diffusion_step(w, sc);
        diffusion_step(w, sc);
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return;

        // At (63,64,64) both x sides are open, so it is a central difference, and
        // danger rises toward the source at x = 64 — the +x direction from here.
        const vec3 g = diffusion_gradient(*fp, w.grid(), 63, 64, 64);
        const float central = 0.5f * (fp->at(64, 64, 64) - fp->at(62, 64, 64));
        CHECK(std::fabs(g.x - central) < 1e-7f);
        // Positive means "danger rises toward +x", and +x from x=63 IS the source cell.
        // So the flee vector an agent uses is -g, pointing away down the slope.
        CHECK(g.x > 0.0f);
        // The configuration is mirror-symmetric in y and z about the source, so both
        // components are the difference of two equal samples.
        CHECK(std::fabs(g.y) < 1e-7f);
        CHECK(std::fabs(g.z) < 1e-7f);

        // At (65,64,64) the +x side is a wall. The wall carries no flux, so the slope is
        // one-sided over the open -x side, NOT a central difference against a wall
        // treated as zero.
        const vec3 gw = diffusion_gradient(*fp, w.grid(), 65, 64, 64);
        const float oneSided = fp->at(64, 64, 64) - fp->at(65, 64, 64);
        CHECK(std::fabs(gw.x - (-oneSided)) < 1e-7f);
        // What it must NOT be: the two-sided form with the wall read as a real 0 sample.
        const float wrongCentral = 0.5f * (0.0f - fp->at(64, 64, 64));
        CHECK(std::fabs(gw.x - wrongCentral) > 1e-4f);

        // The 256 KiB-bitset overload exists purely to avoid 6 scattered reads into the
        // 128 MiB mask array per call. It must be the SAME function numerically, or the
        // crowd path and the debug path disagree.
        for (int d = -2; d <= 2; ++d) {
            const vec3 a = diffusion_gradient(*fp, w.grid(), 64 + d, 64, 64);
            const vec3 b = diffusion_gradient(*fp, sc, 64 + d, 64, 64);
            CHECK(a.x == b.x && a.y == b.y && a.z == b.z);
        }
    }

    { // ---- determinism: same input, bit-identical output ----
        World a, b;
        DiffusionScratch sa, sb;
        diffusion_refresh_walkable(a.grid(), sa);
        diffusion_refresh_walkable(b.grid(), sb);
        // Sixteen scattered sources, so the check covers overlapping fronts rather than
        // one clean sphere. hash-seeded from core/rng.h: no state, no <random>.
        constexpr std::uint32_t kDim = static_cast<std::uint32_t>(kMacroDim);
        for (std::uint32_t k = 0; k < 16u; ++k) {
            const int x = static_cast<int>(rand_below(hash2(k, 1u), kDim));
            const int y = static_cast<int>(rand_below(hash2(k, 2u), kDim));
            const int z = static_cast<int>(rand_below(hash2(k, 3u), kDim));
            const float amt = 0.25f + rand01(hash2(k, 4u));
            diffusion_add(a, x, y, z, amt);
            diffusion_add(b, x, y, z, amt);
        }
        for (int i = 0; i < 4; ++i) {
            diffusion_step(a, sa);
            diffusion_step(b, sb);
        }
        Field<float>* fa = a.fields().find<float>(kDangerField);
        Field<float>* fb = b.fields().find<float>(kDangerField);
        CHECK(fa != nullptr && fb != nullptr);
        if (fa == nullptr || fb == nullptr) return;
        CHECK(std::memcmp(fa->data().data(), fb->data().data(),
                          kMacroCells * sizeof(float)) == 0);

        // Order independence is STRUCTURAL, not asserted here: the sweep reads only the
        // source buffer and writes only the destination, so no visitation order can
        // change the result. What is asserted is the consequence a future parallel split
        // must preserve — rebuilding the walkability bitset mid-run changes nothing,
        // because the bitset is derived data and not state.
        diffusion_refresh_walkable(a.grid(), sa);
        diffusion_step(a, sa);
        diffusion_step(b, sb);
        CHECK(std::memcmp(fa->data().data(), fb->data().data(),
                          kMacroCells * sizeof(float)) == 0);

        // And the SCRATCHLESS overload is the same function: it builds a scratch,
        // sweeps, and drops it. This is the compatibility guarantee that lets
        // world_test.cpp keep calling `diffusion_step(w)` with no scratch at all.
        diffusion_step(a);       // no scratch
        diffusion_step(b, sb);   // reused scratch
        CHECK(std::memcmp(fa->data().data(), fb->data().data(),
                          kMacroCells * sizeof(float)) == 0);
    }

    { // ---- a stale walkability bitset is the one way to get a wrong answer ----
        // Not a bug being tolerated — a contract being pinned, so
        // diffusion_refresh_walkable's "call me at every geometry boundary" is a rule
        // with a test behind it rather than a comment.
        World w;
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);      // all air
        w.grid().fill_cell(65, 64, 64, kMatConcrete);  // a wall appears, bitset NOT told
        diffusion_add(w, 64, 64, 64, 1.0f);
        diffusion_step(w, sc);
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return;
        CHECK(fp->at(65, 64, 64) > 0.0f); // danger sitting inside solid rock

        // Refreshing repairs it on the next sweep: the cell is pinned to 0.
        diffusion_refresh_walkable(w.grid(), sc);
        diffusion_step(w, sc);
        CHECK(fp->at(65, 64, 64) == 0.0f);
    }

    { // ---- the two cheap repairs for geometry that moved ON the tick ----
        // [game/door.cpp] fill_cell/clear_cells a door's column every time one opens or
        // breaks, which is a geometry mutation on the sim tick — far too often to answer
        // with a 128 MiB rebuild. So there are two valves, and both are tested because a
        // caller will reach for whichever one it can afford.
        //
        // (a) diffusion_mark_cell: O(1), for a caller that knows the cell.
        World w;
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        CHECK(diffusion_open_count(sc) == kMacroCells);
        w.grid().fill_cell(65, 64, 64, kMatConcrete);
        diffusion_mark_cell(w.grid(), sc, 65, 64, 64);
        CHECK(diffusion_open_count(sc) == kMacroCells - 1u); // one bit, no full rebuild
        diffusion_add(w, 64, 64, 64, 1.0f);
        const DiffusionStep st = diffusion_step(w, sc);
        CHECK(st.openCells == static_cast<std::uint32_t>(kMacroCells - 1u));
        CHECK(diffusion_at(w, 65, 64, 64) == 0.0f); // respected on the very next sweep
        // It goes both ways: re-open the cell and the patch lets flux back in.
        w.grid().clear_cell(65, 64, 64);
        diffusion_mark_cell(w.grid(), sc, 65, 64, 64);
        CHECK(diffusion_open_count(sc) == kMacroCells);
        diffusion_step(w, sc);
        CHECK(diffusion_at(w, 65, 64, 64) > 0.0f);
        // Wrapped coordinates, because a door column can straddle the z seam.
        w.grid().fill_cell(0, 0, 0, kMatConcrete);
        diffusion_mark_cell(w.grid(), sc, -128, 256, 0);
        CHECK(diffusion_open_count(sc) == kMacroCells - 1u);

        // (b) diffusion_mark_geometry_dirty: the blunt valve, for a caller that only
        // knows THAT geometry moved. The next sweep rebuilds, once, however many
        // mutations happened in between.
        World v;
        DiffusionScratch sv;
        diffusion_refresh_walkable(v.grid(), sv);
        diffusion_add(v, 64, 64, 64, 1.0f);
        v.grid().fill_cell(65, 64, 64, kMatConcrete);
        v.grid().fill_cell(63, 64, 64, kMatConcrete);
        CHECK(diffusion_open_count(sv) == kMacroCells); // still stale at this point
        diffusion_mark_geometry_dirty(sv);
        CHECK(sv.geomDirty);
        const DiffusionStep sd = diffusion_step(v, sv);
        CHECK(!sv.geomDirty); // the sweep consumed the flag
        CHECK(sd.openCells == static_cast<std::uint32_t>(kMacroCells - 2u));
        CHECK(diffusion_at(v, 65, 64, 64) == 0.0f);
        CHECK(diffusion_at(v, 63, 64, 64) == 0.0f);
        // Idempotent: the valve is cheap enough to set every tick.
        diffusion_mark_geometry_dirty(sv);
        diffusion_mark_geometry_dirty(sv);
        diffusion_step(v, sv);
        CHECK(!sv.geomDirty);
    }

    { // ---- world-space sources land in the same cell the rest of the engine uses ----
        // kCellSize = 2 m, and the conversion is truncate-then-wrap. A producer holding
        // a Transform must not have to rediscover that, and must not disagree with
        // [game/door.cpp] / [game/combat.cpp] about which cell a body is standing in.
        World w;
        DiffusionScratch sc;
        diffusion_refresh_walkable(w.grid(), sc);
        CHECK(diffusion_add_at(w, vec3{130.0f, 128.5f, 3.9f}, 1.0f) == 1.0f);
        CHECK(diffusion_at(w, 65, 64, 1) == 1.0f);
        CHECK(diffusion_at(w, 64, 64, 1) == 0.0f); // and not the neighbouring cell
        // kWorldExtent = 256 m is cell 128, which wraps to 0 — the same wrap Transform
        // positions get from physics every step.
        CHECK(diffusion_add_at(w, vec3{256.0f, 0.0f, 0.0f}, 2.0f) == 2.0f);
        CHECK(diffusion_at(w, 0, 0, 0) == 2.0f);
        // A source in rock is refused through this entry point too.
        w.grid().fill_cell(10, 10, 10, kMatConcrete);
        CHECK(diffusion_add_at(w, vec3{21.0f, 21.0f, 21.0f}, 5.0f) == 0.0f);
        CHECK(diffusion_at(w, 10, 10, 10) == 0.0f);
    }

    { // ---- a recycled layer must not inherit the previous floor's danger ----
        // A real bug being closed, not a hypothetical. A LevelStack slot is RECYCLED
        // ([game/floor_stream.cpp] free_slot / alloc_slot), generate_floor clears the
        // GRID but not the World's FieldRegistry, and a registry never removes a field
        // ([world/field.h]) — so floor N's danger is still sitting in floor N+2's cells
        // unless something zeroes it. With keepRadius 0 the free list holds two slots,
        // so the SECOND ride hands the same slot straight back.
        World w;
        DiffusionScratch sc;
        const int hx = lattice_coord(0), hy = lattice_coord(0), hz = lattice_coord(0);

        generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
        diffusion_on_floor_built(w, sc);
        CHECK(sc.walkable_ready());
        CHECK(diffusion_add(w, hx, hy, hz, 1.0f) == 1.0f); // shaft centre: always air
        diffusion_step(w, sc);
        CHECK(diffusion_at(w, hx, hy, hz) > 0.0f);

        // The slot is recycled into a different floor of a different kind.
        generate_floor(w, 7, floor_spec(FloorKind::Industrial), 99u);
        // Deliberately asserting the WRONG state first, so the test documents the hazard
        // rather than only the fix: the danger is still there after regeneration.
        CHECK(diffusion_at(w, hx, hy, hz) > 0.0f);

        diffusion_on_floor_built(w, sc);
        CHECK(diffusion_at(w, hx, hy, hz) == 0.0f);
        const DiffusionStep st = diffusion_step(w, sc);
        CHECK(st.present); // zeroed, NOT removed — the 8.00 MiB stays allocated
        CHECK(st.liveCells == 0u);
        CHECK(st.total == 0.0f);
        // And the bitset was rebuilt from the NEW geometry, not left on the old floor's.
        CHECK(sc.walkable_ready());
        CHECK(st.openCells == static_cast<std::uint32_t>(diffusion_open_count(sc)));
    }

    { // ---- the DRIVER: the cadence, the floor token, and the quiet gate ----
        // This is the block that stops this file from being a solver nobody calls.
        // DiffusionDriver is what the app shell's fixed-step loop holds, so what is
        // asserted here is the wiring itself: how many sweeps happened, on which ticks,
        // against which floor's walkability, and that the answer is bit-identical to
        // driving diffusion_step by hand.
        World a;
        DiffusionDriver drv;
        constexpr LayerId kLayerA = 3u;

        diffusion_driver_on_floor_built(drv, a, kLayerA);
        CHECK(drv.layer == kLayerA);
        CHECK(drv.scratch.walkable_ready()); // the bitset came with the floor
        CHECK(!drv.hot);                     // a zeroed field has nothing to spread
        CHECK(drv.sweeps == 0u);
        CHECK(drv.deposits == 0u);

        // THE GATE, stated as a work count: 200 ticks — eight cadence slots — on a floor
        // nobody has wounded, and not one sweep. Not "a cheap sweep": zero. This is the
        // difference between paying 20 ms every 200 ms forever and paying nothing.
        for (std::uint64_t t = 1u; t <= 200u; ++t) CHECK(!diffusion_tick(drv, a, kLayerA, t));
        CHECK(drv.sweeps == 0u);
        CHECK(a.fields().find<float>(kDangerField) == nullptr); // and created nothing

        // A source inside rock arms nothing, because it stored nothing.
        a.grid().fill_cell(30, 30, 30, kMatConcrete);
        diffusion_mark_cell(a.grid(), drv.scratch, 30, 30, 30);
        CHECK(diffusion_driver_add(drv, a, 30, 30, 30, kDangerUnit) == 0.0f);
        CHECK(!drv.hot);
        CHECK(drv.deposits == 0u);
        for (std::uint64_t t = 201u; t <= 250u; ++t) diffusion_tick(drv, a, kLayerA, t);
        CHECK(drv.sweeps == 0u);

        { // A deposit that TOOK arms it, and the driver then adds a cadence and nothing
          // else: the field it produces is bit-identical to the same number of hand-driven
          // diffusion_step calls. That identity is the point — the wired path and the
          // tested path are the same code, not merely similar.
            World b;
            DiffusionScratch sc;
            b.grid().fill_cell(30, 30, 30, kMatConcrete); // same geometry as `a`
            diffusion_refresh_walkable(b.grid(), sc);

            CHECK(diffusion_driver_add(drv, a, 64, 64, 64, kDangerUnit) == kDangerUnit);
            CHECK(drv.hot);
            CHECK(drv.deposits == 1u);
            CHECK(diffusion_add(b, 64, 64, 64, kDangerUnit) == kDangerUnit);

            // Ticks 251..375 contain exactly five multiples of 25 (275, 300, 325, 350,
            // 375), so exactly five sweeps must run — no more, no fewer.
            std::uint32_t swept = 0;
            for (std::uint64_t t = 251u; t <= 375u; ++t)
                if (diffusion_tick(drv, a, kLayerA, t)) ++swept;
            CHECK(swept == 5u);
            CHECK(drv.sweeps == 5u);
            for (int i = 0; i < 5; ++i) diffusion_step(b, sc);

            Field<float>* fa = a.fields().find<float>(kDangerField);
            Field<float>* fb = b.fields().find<float>(kDangerField);
            CHECK(fa != nullptr && fb != nullptr);
            if (fa == nullptr || fb == nullptr) return;
            CHECK(std::memcmp(fa->data().data(), fb->data().data(),
                              kMacroCells * sizeof(float)) == 0);
            // One cell is solid, so the sweep's work count is the whole grid minus it —
            // the driver handed diffusion_step the bitset it built, not a fresh one.
            CHECK(drv.last.present);
            CHECK(drv.last.openCells == static_cast<std::uint32_t>(kMacroCells - 1u));
            CHECK(drv.last.openCells ==
                  static_cast<std::uint32_t>(diffusion_open_count(drv.scratch)));

            // The support after five sweeps, bounded on both sides rather than pinned to
            // one number, and the bound is the interesting fact. UPPER: the stencil
            // reaches exactly one cell per sweep, so nothing outside the L1 ball of
            // radius 5 can be non-zero — 231 cells. LOWER: every cell inside radius 4 is
            // still above minLevel (the weakest is the axial one at 2.28e-4, 2.3x the
            // 1e-4 clamp), so at least 129. Radius 5 itself is PARTIALLY dead and that is
            // why this is a range: an axial cell at distance 5 is reached by exactly one
            // path and arrives at (rate*keep)^5 = 6.87e-5, UNDER the clamp, while
            // (2,2,1)-type cells at the same L1 distance have 30 shortest paths and land
            // at 2.06e-3, well over it. Pinning a single number here would be pinning
            // float arithmetic against the clamp.
            std::uint32_t nonZero = 0;
            double scanTotal = 0.0;
            diffusion_scan(*fa, nonZero, scanTotal);
            CHECK(drv.last.liveCells == nonZero); // the driver's report matches the field
            CHECK(nonZero >= diffusion_l1_ball_cells(4));
            CHECK(nonZero <= diffusion_l1_ball_cells(5));
            CHECK(diffusion_l1_ball_cells(4) == 129u);
            CHECK(diffusion_l1_ball_cells(5) == 231u);
            // Mass is still multiplied by keep and nothing else, minus whatever the
            // minLevel clamp threw away — so it can only be BELOW 0.98^5, never above.
            // 1e-5 slack, matching the tolerance the n<=3 block already uses: the field
            // is float and 2 M float adds accumulate ~1e-6 of drift, so a tighter bound
            // would be pinning the rounding mode and not the physics.
            CHECK(scanTotal <= std::pow(0.98, 5.0) + 1e-5);
            CHECK(scanTotal > 0.9 * std::pow(0.98, 5.0));
            CHECK(drv.hot); // still live, so it keeps sweeping
        }

        // THE GATE CLOSES on a field that has fully evaporated. Forced with decay = 1
        // rather than waited out: at the shipping 0.02 an unspread unit source needs 456
        // sweeps to reach residue ([sim/diffusion.h]), which is 91 s of simulated time.
        DiffusionParams flush;
        flush.decay = 1.0f;
        CHECK(diffusion_tick(drv, a, kLayerA, 400u, flush));
        CHECK(drv.last.present);      // the field still EXISTS
        CHECK(drv.last.liveCells == 0u); // and holds nothing
        CHECK(drv.last.total == 0.0f);
        CHECK(!drv.hot);              // so nothing can change until the next deposit
        const std::uint64_t quietAt = drv.sweeps;
        for (std::uint64_t t = 401u; t <= 900u; ++t) diffusion_tick(drv, a, kLayerA, t);
        CHECK(drv.sweeps == quietAt); // twenty cadence slots, zero sweeps

        // And a new deposit re-arms it. One sweep from a unit source lights the source
        // cell and its six open faces: seven live cells, exactly.
        CHECK(diffusion_driver_add_at(drv, a, vec3{128.0f, 128.0f, 128.0f}, kDangerUnit) ==
              kDangerUnit);
        CHECK(drv.hot);
        CHECK(drv.deposits == 2u);
        CHECK(diffusion_at(a, 64, 64, 64) == kDangerUnit); // 128 m / 2 m per cell = 64
        CHECK(diffusion_tick(drv, a, kLayerA, 925u));
        CHECK(drv.last.liveCells == 7u);

        { // A LAYER CHANGE rebuilds the bitset. The driver was holding walkability for
          // floor `a`; sweeping floor `c` against it would diffuse through walls that
          // exist. Made visible by giving `c` different geometry and reading the count.
            World c;
            for (int i = 0; i < 5; ++i) c.grid().fill_cell(20, 20, 20 + i, kMatConcrete);
            constexpr LayerId kLayerC = 9u;
            CHECK(diffusion_tick(drv, c, kLayerC, 950u));
            CHECK(drv.layer == kLayerC);
            CHECK(diffusion_open_count(drv.scratch) == kMacroCells - 5u);
            // `c` has never been wounded, so the sweep took the non-creating early-out:
            // no field, no work, and the gate closed again on its own report.
            CHECK(!drv.last.present);
            CHECK(drv.last.openCells == 0u);
            CHECK(!drv.hot);
            CHECK(c.fields().find<float>(kDangerField) == nullptr);
        }

        // Floor `a`'s own danger survived the excursion untouched — the driver swept
        // another World, not this one. A World IS one layer, so this is structural.
        CHECK(diffusion_at(a, 64, 64, 64) > 0.0f);

        { // ---- diffusion_arm: the design's ONE footgun, and its documented repair ----
          // [sim/diffusion.h] names this hazard instead of hiding it: deposit through the
          // bare diffusion_add and the gate never notices, so the danger sits there
          // correct and FROZEN — not lost, not spreading — until something arms it. It is
          // asserted here because nothing else in the tree calls diffusion_arm, and an
          // escape hatch with no test is a promise, not a mechanism.
            World d;
            DiffusionDriver dd;
            constexpr LayerId kLayerD = 11u;
            diffusion_driver_on_floor_built(dd, d, kLayerD);

            // Behind the driver's back, on purpose.
            CHECK(diffusion_add(d, 64, 64, 64, kDangerUnit) == kDangerUnit);
            CHECK(!dd.hot);           // the gate is still shut
            CHECK(dd.deposits == 0u); // and the deposit was never counted
            // Four cadence slots and the field does not move a cell. This is the frozen
            // state the header warns about, stated as a work count.
            for (std::uint64_t t = 25u; t <= 100u; t += 25u)
                CHECK(!diffusion_tick(dd, d, kLayerD, t));
            CHECK(dd.sweeps == 0u);
            CHECK(diffusion_at(d, 64, 64, 64) == kDangerUnit); // untouched, not decayed

            diffusion_arm(dd);
            CHECK(dd.hot);
            CHECK(diffusion_tick(dd, d, kLayerD, 125u));
            CHECK(dd.sweeps == 1u);
            CHECK(dd.last.present);
            CHECK(dd.last.liveCells == 7u); // source plus its six open faces, exactly
            CHECK(dd.hot);                  // live, so it keeps sweeping on its own now
            CHECK(dd.deposits == 0u);       // arming is not a deposit
        }
    }

    { // ---- the zero-group skip must not blind the stencil at a run boundary ----
        // The sweep PROVES a 64-cell run of the field is all zero — own run plus the
        // seven runs any of its cells can read from — and writes 0 over it instead of
        // computing it ([sim/diffusion.cpp]). That is sound only while the "is anything
        // near me" test covers every run a cell reads: its own, the two x-adjacent runs
        // in its row, and the same run index in the +-y and +-z neighbour ROWS. An
        // off-by-one there would corrupt nothing and shift no total — it would make
        // danger silently fail to CROSS one boundary, which is exactly the class of bug
        // a mass-conservation check cannot see. So: one source, six faces, at every
        // coordinate where a run, a row, a plane or the torus seam changes.
        constexpr int kSkipProbes[][3] = {
            {0, 0, 0},       // all three axes on the wrap seam; run 0, bit 0
            {63, 64, 64},    // last cell of run 0 — +x must reach into run 1
            {64, 64, 64},    // first cell of run 1 — -x must reach back into run 0
            {127, 127, 127}, // last cell of the last run, row and plane: everything wraps
            {1, 0, 127},     // interior x against a row seam and a plane seam
            {64, 127, 0},    // a run boundary against both a row and a plane seam
        };
        const float probeFace = 0.15f * 0.98f; // rate * keep into each of the six faces
        for (const auto& p : kSkipProbes) {
            World w; // all air, so every one of the six faces is open
            DiffusionScratch sc;
            diffusion_refresh_walkable(w.grid(), sc);
            CHECK(diffusion_add(w, p[0], p[1], p[2], 1.0f) == 1.0f);
            const DiffusionStep st = diffusion_step(w, sc);
            Field<float>* fp = w.fields().find<float>(kDangerField);
            CHECK(fp != nullptr);
            if (fp == nullptr) return;
            for (int ax = 0; ax < 3; ++ax)
                for (int s = -1; s <= 1; s += 2) {
                    int q[3] = {p[0], p[1], p[2]};
                    q[ax] += s;
                    CHECK(std::fabs(fp->at(q[0], q[1], q[2]) - probeFace) < 1e-6f);
                }
            // Source plus exactly six faces — no more (the skip did not leak a seventh
            // cell) and no fewer (it did not swallow one).
            CHECK(st.liveCells == 7u);
            CHECK(st.openCells == static_cast<std::uint32_t>(kMacroCells));
            // The run bitset is scratch the sweep sizes itself: one bit per 64-cell run,
            // 2,097,152 / 64 = 32,768 runs = 512 words = 4 KiB.
            CHECK(sc.hotGroups.size() == 512u);
        }
    }

    { // ---- measured cost, on a REAL floor's geometry ----
        // Synthetic all-air is the wrong thing to time: real geometry is part solid, and
        // solid cells take the cheap branch. So this uses the shipping generator.
        World w;
        generate_floor(w, -26, floor_spec(FloorKind::Residential), 4242u);
        DiffusionScratch sc;

        using clock = std::chrono::steady_clock;
        const auto b0 = clock::now();
        diffusion_refresh_walkable(w.grid(), sc);
        const auto b1 = clock::now();
        const double bakeMs = std::chrono::duration<double, std::milli>(b1 - b0).count();

        // The open fraction, read straight out of the bitset. Worth printing because
        // every cost claim rests on it: a solid cell takes the one-store branch and an
        // open cell does the 6-neighbour arithmetic, so "ms per sweep" means nothing
        // without knowing how much of the grid is open.
        const std::size_t openCells = diffusion_open_count(sc);

        // Seed wounds at LATTICE SHAFT CENTRES, not at random cells. A real floor is
        // heavily solid, and diffusion_add refuses a source inside rock — so 64 random
        // cells could all be refused, the field would never be created, and the loop
        // below would time a non-creating early-out instead of a sweep. floor_gen
        // punches a 3x3 shaft to air through every slab at every lattice column
        // ([world/nav.cpp] node_cell depends on the same guarantee), so these cannot be
        // refused.
        std::uint32_t seeded = 0;
        for (int i = 0; i < kLatticeDim; ++i)
            for (int j = 0; j < kLatticeDim; ++j)
                if (diffusion_add(w, lattice_coord(i), lattice_coord(j),
                                  lattice_coord(2), 1.0f) > 0.0f)
                    ++seeded;
        CHECK(seeded == 16u); // 4x4 shaft centres on one lattice storey, all air
        Field<float>* fp = w.fields().find<float>(kDangerField);
        CHECK(fp != nullptr);
        if (fp == nullptr) return; // the saturated block below writes through it

        constexpr int kSweeps = 10;
        DiffusionStep last;
        const auto t0 = clock::now();
        for (int i = 0; i < kSweeps; ++i) last = diffusion_step(w, sc);
        const auto t1 = clock::now();
        const double perSweepMs =
            std::chrono::duration<double, std::milli>(t1 - t0).count() / kSweeps;

        // WORK COUNTS — these are the assertions. The sweep reported exactly as many
        // open cells as the bitset holds, on ten consecutive sweeps with no rebuild in
        // between, so this ran over real geometry and not an early-out. What it does NOT
        // prove any more is that every one of those cells did the arithmetic: the sweep
        // proves zero runs are zero. The saturated block further down is where full work
        // is pinned, by liveCells == openCells.
        CHECK(last.present);
        CHECK(last.openCells == static_cast<std::uint32_t>(openCells));
        CHECK(openCells > 0u && openCells < kMacroCells); // a real floor is part solid
        CHECK(last.liveCells > 16u);   // the 16 sources have spread
        CHECK(last.total > 0.0f);
        CHECK(sc.walkable_ready());
        CHECK(sc.open.size() == (kMacroCells + 63) / 64); // 32,768 words = 256 KiB
        CHECK(sc.back.size() == kMacroCells);             // one 8.00 MiB back buffer
        CHECK(sc.hotGroups.size() == 512u);               // 32,768 run bits = 4 KiB
        CHECK(!sc.geomDirty);
        // The sparse figure above is the CHEAP case and it must be labelled as one: only
        // a few thousand of the 1.25 M open cells hold anything, so the sweep proves
        // most 64-cell runs are zero rather than computing them ([sim/diffusion.cpp]).
        // Asserted rather than assumed, because it is the premise of the two-figure
        // print below: a sparse field is one where live is a tiny fraction of open.
        CHECK(last.liveCells * 20u < static_cast<std::uint32_t>(openCells));

        // ---- and the SATURATED worst case, which is the number a budget needs ----
        // Every open cell above minLevel, so no run is skippable and the sweep does the
        // full 6-neighbour stencil on all 1.25 M of them. Measuring only the sparse case
        // would publish a figure that quietly depends on the floor being quiet.
        //
        // fill() writes walls too; the untimed sweep below pins them back to 0 and is
        // also what makes the timed run start from a settled state. keep = 0.98 and 10
        // sweeps leave every cell at >= 0.98^11 = 0.80, far above minLevel, so nothing
        // becomes skippable part-way through the measurement.
        fp->fill(1.0f);
        diffusion_step(w, sc);
        const auto s0 = clock::now();
        DiffusionStep sat;
        for (int i = 0; i < kSweeps; ++i) sat = diffusion_step(w, sc);
        const auto s1 = clock::now();
        const double satSweepMs =
            std::chrono::duration<double, std::milli>(s1 - s0).count() / kSweeps;
        // THE WORK COUNT that makes the saturated timing meaningful: every open cell is
        // live, so not one run could be skipped and the figure below is full work. This
        // is the assertion, not the milliseconds.
        CHECK(sat.liveCells == sat.openCells);
        CHECK(sat.openCells == static_cast<std::uint32_t>(openCells));
        CHECK(sat.total > 0.0f);

        // The affordability claim, printed with the numbers it rests on so it can be
        // re-derived instead of believed. kDiffusionSweepsPerSec = 5, so the tick cost
        // is 5 * perSweep milliseconds per wall-clock second, against a 1000 ms budget
        // of one core. BOTH cases are printed: a single number here would be a claim
        // about how quiet the floor happened to be.
        const double den = static_cast<double>(openCells ? openCells : 1u);
        const double perSecondMs =
            perSweepMs * static_cast<double>(kDiffusionSweepsPerSec);
        const double satPerSecondMs =
            satSweepMs * static_cast<double>(kDiffusionSweepsPerSec);
        std::printf("  diffusion: %u cells, field 8.00 MiB + scratch 8.00 MiB + walkable "
                    "256 KiB + run bits 4 KiB = 16.254 MiB/layer\n",
                    static_cast<unsigned>(kMacroCells));
        std::printf("  diffusion: %u of %u cells open (%.1f%%); bitset bake %.2f ms\n",
                    static_cast<unsigned>(openCells),
                    static_cast<unsigned>(kMacroCells), 100.0 * den /
                        static_cast<double>(kMacroCells), bakeMs);
        std::printf("  diffusion: SPARSE  (%u live) %.2f ms/sweep = %.2f ns/open cell; "
                    "at %d sweeps/s %.2f ms/s = %.2f%% of one core\n",
                    last.liveCells, perSweepMs, perSweepMs * 1e6 / den,
                    kDiffusionSweepsPerSec, perSecondMs, perSecondMs / 10.0);
        std::printf("  diffusion: SATURATED (%u live, nothing skippable) %.2f ms/sweep = "
                    "%.2f ns/open cell; at %d sweeps/s %.2f ms/s = %.2f%% of one core "
                    "(sim step budget is %d ms)\n",
                    sat.liveCells, satSweepMs, satSweepMs * 1e6 / den,
                    kDiffusionSweepsPerSec, satPerSecondMs, satPerSecondMs / 10.0,
                    kSimStepMs);
    }
}
