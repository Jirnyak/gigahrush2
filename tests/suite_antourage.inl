// Antourage — the baked-dressing seam ([game/antourage/antourage.h]): SOLID
// pipes written into the grid, GHOST wire chains beside it.
//
// Included into game_test.cpp after its CHECK macro and `using namespace`.

#include <algorithm>
#include <chrono>
#include <functional>
#include "game/antourage/antourage.h"
#include "sim/physics.h"     // aabb_overlaps_solid — the rest test
#include "world/destruct.h"   // carve_sphere — the player's own hole-puncher
#include "world/material_props.h"

// The eight regimes, in the enum's own order.
static const GravityRegime kAllRegimes[] = {
    GravityRegime::NegX, GravityRegime::PosX, GravityRegime::NegY,
    GravityRegime::PosY, GravityRegime::NegZ, GravityRegime::PosZ,
    GravityRegime::Zero, GravityRegime::Custom,
};

// Point a world's LIVE gravity at a regime, keeping the vector in agreement
// (world/gravity.h asks that of anyone who flips either). Custom gets a
// genuinely mixed vector whose dominant axis is -X, so a consumer that shrugs at
// Custom instead of reading the vector field dresses nothing.
static void set_regime(World& w, GravityRegime r) {
    const CellStep d = regime_down(r);
    w.gravity().regime = r;
    w.gravity().global = r == GravityRegime::Custom
                             ? vec3{-9.0f, 1.2f, -2.0f}
                             : vec3{static_cast<float>(d.x) * 9.81f,
                                    static_cast<float>(d.y) * 9.81f,
                                    static_cast<float>(d.z) * 9.81f};
}

// Field-wise, not memcmp: the primitives carry padding, and a bit-for-bit claim
// must be about the DATA, never about whatever the padding happened to hold.
static bool same_bake(const AntourageBake& a, const AntourageBake& b) {
    auto same_v3 = [](vec3 p, vec3 q) {
        return p.x == q.x && p.y == q.y && p.z == q.z;
    };
    if (a.pipeCells != b.pipeCells || a.instances.size() != b.instances.size() ||
        a.wires.size() != b.wires.size() || a.cloths.size() != b.cloths.size())
        return false;
    for (std::size_t i = 0; i < a.instances.size(); ++i) {
        const AntourageInstance& x = a.instances[i];
        const AntourageInstance& y = b.instances[i];
        if (!same_v3(x.pos, y.pos) || !same_v3(x.scale, y.scale) ||
            !same_v3(x.color, y.color) || x.yaw != y.yaw || x.shape != y.shape ||
            x.matId != y.matId || x.emissive != y.emissive || x.ax0 != y.ax0 ||
            x.ay0 != y.ay0 || x.az0 != y.az0 || x.ax1 != y.ax1 ||
            x.ay1 != y.ay1 || x.az1 != y.az1)
            return false;
    }
    for (std::size_t i = 0; i < a.wires.size(); ++i) {
        const WireChain& x = a.wires[i];
        const WireChain& y = b.wires[i];
        for (int p = 0; p < kWirePoints; ++p)
            if (!same_v3(x.p[p], y.p[p])) return false;
        if (x.restLen != y.restLen || x.massKg != y.massKg ||
            x.pinMask != y.pinMask || x.matId != y.matId || x.ax0 != y.ax0 ||
            x.ay0 != y.ay0 || x.az0 != y.az0 || x.ax1 != y.ax1 ||
            x.ay1 != y.ay1 || x.az1 != y.az1)
            return false;
    }
    for (std::size_t i = 0; i < a.cloths.size(); ++i) {
        const ClothSheet& x = a.cloths[i];
        const ClothSheet& y = b.cloths[i];
        for (int p = 0; p < kClothPoints; ++p)
            if (!same_v3(x.p[p], y.p[p])) return false;
        if (x.restX != y.restX || x.restY != y.restY || x.pinMask != y.pinMask ||
            x.matId != y.matId || x.ax0 != y.ax0 || x.ay0 != y.ay0 ||
            x.az0 != y.az0 || x.ax1 != y.ax1 || x.ay1 != y.ay1 ||
            x.az1 != y.az1)
            return false;
    }
    return true;
}

// How far a chain's point 4 bows off the straight line between its pinned ends.
// The sag law is about the SHAPE, so measure the shape and not the parameter
// that produced it. (Point kWirePoints/2 is not the chord's midpoint — its
// parameter is 4/7 — so the straight reference has to be the lerp, not the
// average of the ends.)
static float wire_bow(const WireChain& c) {
    const int i = kWirePoints / 2;
    const float s = static_cast<float>(i) / static_cast<float>(kWirePoints - 1);
    const vec3 want = c.p[0] + (c.p[kWirePoints - 1] - c.p[0]) * s;
    return length(c.p[i] - want);
}

// Which face a sheet was hung from, as one of the six directions: its rows drop
// along the frame's own down axis (the drop is SHAPE, so it survives zero-g),
// and the top-to-bottom vector names that axis and sign.
static int cloth_drop_face(const ClothSheet& s) {
    const vec3 d = s.p[(kClothH - 1) * kClothW] - s.p[0];
    const float ax = std::fabs(d.x), ay = std::fabs(d.y), az = std::fabs(d.z);
    const int axis = ax >= ay && ax >= az ? 0 : (ay >= az ? 1 : 2);
    const float c = axis == 0 ? d.x : axis == 1 ? d.y : d.z;
    return axis * 2 + (c < 0.0f ? 1 : 0);
}

// The frame is DECLARED, not guessed ([world/gravity.h] GravityFrame). It lives
// in the core beside regime_down, but its contract is pinned here, in the suite
// of the consumer that would silently go bare if the declaration drifted.
static void test_gravity_frames() {
    GravityFrame f[kMaxGravityFrames];
    GravityField g{};
    // An AXIS regime declares exactly one frame: up is -gravity, the tangents
    // are the other two axes ascending, and the pull is real.
    for (int i = 0; i < 6; ++i) {
        const GravityRegime r = kAllRegimes[i];
        const CellStep d = regime_down(r);
        g.regime = r;
        CHECK(gravity_frames(g, f) == 1);
        CHECK(f[0].axis == (d.x != 0 ? 0 : d.y != 0 ? 1 : 2));
        CHECK(f[0].upSign == -(d.x + d.y + d.z));
        CHECK(f[0].tanA != f[0].axis && f[0].tanB != f[0].axis);
        CHECK(f[0].tanA < f[0].tanB);
        CHECK(f[0].pull);
    }
    // Zero declares NONE — so instead of a decreed axis it gets all six faces,
    // exactly once each, with the pull off (owner, 2026-08-04).
    g.regime = GravityRegime::Zero;
    g.global = vec3{0.0f, 0.0f, 0.0f};
    CHECK(gravity_frames(g, f) == kMaxGravityFrames);
    int faces = 0;
    for (int i = 0; i < kMaxGravityFrames; ++i) {
        CHECK(!f[i].pull);
        faces |= 1 << (f[i].axis * 2 + (f[i].upSign < 0 ? 1 : 0));
    }
    CHECK(faces == 0x3F);
    // Custom must fall back to the VECTOR field, as its own doc-comment says:
    // the dominant axis wins, and it pulls.
    g.regime = GravityRegime::Custom;
    g.global = vec3{-9.0f, 1.2f, -2.0f};
    CHECK(gravity_frames(g, f) == 1);
    CHECK(f[0].axis == 0);
    CHECK(f[0].upSign == 1);
    CHECK(f[0].pull);
    // A Custom field that is genuinely still lands on the six-face answer.
    g.global = vec3{0.0f, 0.0f, 0.0f};
    CHECK(gravity_frames(g, f) == kMaxGravityFrames);
}

// ISOTROPY, end to end (problems.md §8): the bake dresses EVERY regime. One
// geometry, eight frames — the padic tower is built in a -Z frame, and the
// world's regime is RUNTIME state the game may flip mid-run, so pointing gravity
// sideways asks the walkers to read that same geometry in a frame it was not
// built for. That is exactly the case the old silent early-out hid: anything but
// +-Z produced a BARE floor and said nothing.
static void test_antourage_isotropy() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    constexpr int kRegimes = 8;
    AntourageBake bakes[kRegimes];

    for (int i = 0; i < kRegimes; ++i) {
        const GravityRegime r = kAllRegimes[i];
        set_regime(w, r);
        AntourageBake& b = bakes[i];
        bake_antourage(w, 0, 1337u, b);

        // Dressed at all — the whole point of §8.
        CHECK(!b.instances.empty());
        CHECK(!b.wires.empty());
        CHECK(!b.cloths.empty());

        // THE LAW holds in every frame: no anchor is air, every shape is a real
        // catalog row, every scale is positive. Counted and asserted ONCE per
        // regime — three thousand pieces x eight regimes of individual CHECKs
        // would drown the suite without saying more than the count does.
        std::uint32_t airAnchors = 0, badShape = 0, badScale = 0;
        auto anchors_solid = [&](int x0, int y0, int z0, int x1, int y1, int z1) {
            if (w.grid().cell(x0, y0, z0) == kCellAir ||
                w.grid().cell(x1, y1, z1) == kCellAir)
                ++airAnchors;
        };
        for (const AntourageInstance& it : b.instances) {
            anchors_solid(it.ax0, it.ay0, it.az0, it.ax1, it.ay1, it.az1);
            if (it.shape > kShapeCylinderZ) ++badShape;
            if (it.scale.x <= 0.0f || it.scale.y <= 0.0f || it.scale.z <= 0.0f)
                ++badScale;
        }
        for (const WireChain& c : b.wires)
            anchors_solid(c.ax0, c.ay0, c.az0, c.ax1, c.ay1, c.az1);
        for (const ClothSheet& s : b.cloths)
            anchors_solid(s.ax0, s.ay0, s.az0, s.ax1, s.ay1, s.az1);
        CHECK(airAnchors == 0);
        CHECK(badShape == 0);
        CHECK(badScale == 0);

        // ...and the grid is still untouched: antourage NEVER writes voxels, in
        // any frame (the law in antourage.h).
        std::uint32_t pipeMatCells = 0;
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x)
                    if (w.grid().cell(x, y, z) == kMatPipeMetal) ++pipeMatCells;
        CHECK(pipeMatCells == 0);

        // Determinism survives the generalisation: (grid, number, seed) -> the
        // identical dressing, field for field, in every frame.
        AntourageBake again;
        bake_antourage(w, 0, 1337u, again);
        CHECK(same_bake(b, again));

        // THE PULL LAW ([world/gravity.h] GravityFrame::pull): sag is the one
        // thing here that is a FORCE. Under an axis regime every chain bows;
        // with no gravity every chain hangs dead straight.
        std::uint32_t bowed = 0;
        for (const WireChain& c : b.wires)
            if (wire_bow(c) > 0.05f) ++bowed;
        if (r == GravityRegime::Zero) CHECK(bowed == 0);
        else CHECK(bowed == b.wires.size());

        std::fprintf(stderr,
                     "[antourage] regime %d: %zu instances, %zu wires "
                     "(%u bowed), %zu cloths\n",
                     static_cast<int>(r), b.instances.size(), b.wires.size(),
                     bowed, b.cloths.size());
    }

    // Zero picked no axis: its sheets hang off ALL SIX faces, because with no
    // pull "ceiling" and "floor" are the same word. A frame-blind bake that
    // decreed one axis would light up exactly one bit here.
    int faces = 0;
    for (const ClothSheet& s : bakes[6].cloths) faces |= 1 << cloth_drop_face(s);
    std::fprintf(stderr, "[antourage] zero-g cloth faces: 0x%02X\n", faces);
    CHECK(faces == 0x3F);

    // ...and it SPREAD the floor's budget over those six faces instead of baking
    // six floors' worth of dressing: the GPU ceilings ([antourage.md]) do not
    // move because gravity went away.
    CHECK(bakes[6].instances.size() < 2 * bakes[4].instances.size());
    CHECK(bakes[6].wires.size() < 2 * bakes[4].wires.size());

    // Custom is not a synonym for "no dressing": it reads the vector field, so a
    // Custom floor dominated by -X bakes bit-for-bit the NegX floor.
    CHECK(same_bake(bakes[0], bakes[7]));
    // Sideways is really sideways: the -X floor is NOT the -Z floor's dressing.
    CHECK(!same_bake(bakes[0], bakes[4]));
}

// A PLAYER-SIZED carve at the spot a wire hangs from must drop it. Reported from
// live play (owner, 2026-08-05): the ceiling around a wire was blown away and the
// wire kept hanging in the hole. It was not the GPU path — the probe was the
// wrong SIZE. A cell is 2 m and a carve works in 0.25 m sub-voxels, so
// "the anchor cell is air" needs all 512 sub-voxels gone; a 1.5 m sphere leaves
// the cell nominally solid and the pin stayed. The probe now asks the question
// the bake asked (matter in the attachment column), so the two agree.
static void test_antourage_carve_drops_the_wire() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake bake;
    bake_antourage(w, 0, 1337u, bake);
    CHECK(!bake.wires.empty());

    // A wire whose two anchors are DIFFERENT cells, so one carve cuts one end.
    const WireChain* pick = nullptr;
    for (const WireChain& c : bake.wires)
        if (c.ax0 != c.ax1 || c.ay0 != c.ay1 || c.az0 != c.az1) { pick = &c; break; }
    CHECK(pick != nullptr);
    const WireChain wire = *pick;
    CHECK(wire_live_pins(w.grid(), wire) == wire.pinMask);

    // Blow a hole exactly where point 0 is pinned, with the console/weapon
    // radius (main.cpp consoleCtx.carveRadius = 1.5 m).
    // A BULLET-sized hole, not a demolition: 0.6 m, well under the 2 m cell.
    // Measured on this floor — at 0.35/0.6/1.0 m the anchor CELL stays non-air
    // and only at 1.5 m does it empty, so this radius is exactly the case the
    // old cell-level probe got wrong.
    CarveOp op{};
    op.x = wire.p[0].x;
    op.y = wire.p[0].y;
    op.z = wire.p[0].z;
    op.radius = 0.6f;
    op.power = 60000;   // enough to beat any material's hardness roll
    op.seed = 4242u;
    CarveScratch scratch;
    CarveResult res;
    carve_sphere(w, op, scratch, res);
    CHECK(!res.dirtyCells.empty());
    // THE DISCRIMINATOR: the cell is still nominally solid...
    CHECK(w.grid().cell(wire.ax0, wire.ay0, wire.az0) != kCellAir);

    // ...and yet the column the wire hung from is gone, so THAT end lets go.
    const std::uint8_t pins = wire_live_pins(w.grid(), wire);
    CHECK((pins & 1u) == 0u);
    // ...while the far anchor still holds it: a cut end lets go, it does not
    // delete the chain ([antourage.md] partial death).
    CHECK(antourage_alive(w.grid(), wire));
    std::fprintf(stderr,
                 "[antourage] 0.6 m carve at the pin: cell still solid, "
                 "pins %02X -> %02X\n", wire.pinMask, pins);

    // And the carve's own dirty list reports the severed end to the caller, so
    // the debris burst and the GPU re-pack happen on the same op.
    ParticleBurstQueue bursts;
    antourage_carve_step(w, bake, res.dirtyCells.data(), res.dirtyCells.size(),
                         bursts, 11u);
    // The far end still holds this chain, so IT sheds nothing yet; whatever else
    // that blast severed is free to report.
    CHECK(antourage_alive(w.grid(), wire));
}

// Death is a STATE, not an event ([antourage.h] FallClock): the last anchor
// letting go starts a countdown instead of deleting the piece, so it falls,
// lands and only then stops being drawn.
static void test_antourage_fall_clock() {
    FallClock fc;
    const float dt = 1.0f / 60.0f;
    // Held: drawn, and no clock is running at all.
    CHECK(fc.step(0, true, dt));
    CHECK(fc.left[0] < 0.0f);
    // Severed: still drawn, and the countdown starts at the full life.
    CHECK(fc.step(0, false, dt));
    CHECK(fc.left[0] > kAntourageFallSec - 1e-4f);
    // It keeps falling for the whole life, then stops — measured by stepping.
    int frames = 0;
    while (fc.step(0, false, dt) && frames < 10000) ++frames;
    CHECK(frames > 0);
    const float lived = static_cast<float>(frames + 1) * dt;
    CHECK(lived > kAntourageFallSec - 0.05f);
    CHECK(lived < kAntourageFallSec + 0.05f);
    CHECK(!fc.step(0, false, dt)); // stays dead
    // ...unless the world put it back (a reloaded floor re-bakes): held again
    // means anchored again, and the clock is forgotten.
    CHECK(fc.step(0, true, dt));
    CHECK(fc.left[0] < 0.0f);
    // Pieces are independent, and an index never touched before is alive.
    CHECK(fc.step(9, true, dt));
    CHECK(fc.left.size() == 10);
}

// A severed PIPE does not blink out either: it falls, lands on the floor and
// lies there for the same 8 s a chain does ([antourage.h] DetachedPiece).
// The collision predicate is the solver's own, so it rests exactly where a body
// would stand.
static void test_antourage_detached_pipe_falls_and_lands() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake bake;
    bake_antourage(w, 0, 1337u, bake);
    CHECK(!bake.instances.empty());

    // Drop a piece from a real pipe's place and let it go.
    const AntourageInstance& src = bake.instances.front();
    std::vector<DetachedPiece> falling;
    DetachedPiece d{};
    d.pos = src.pos;
    d.scale = src.scale;
    d.life = kAntourageFallSec;
    d.shape = src.shape;
    d.matId = src.matId;
    d.spin = 1.0f;
    falling.push_back(d);

    const float dt = 1.0f / 60.0f;
    const float startZ = falling[0].pos.z;
    float restZ = startZ;
    int frames = 0;
    // Run most of the life: it must fall, then STOP somewhere solid.
    for (; frames < 360 && !falling.empty(); ++frames) {
        antourage_detach_step(w, falling, dt);
        if (!falling.empty()) restZ = falling[0].pos.z;
    }
    CHECK(!falling.empty());          // 6 s < 8 s life: still with us
    CHECK(restZ < startZ - 0.05f);    // it really fell
    CHECK(!aabb_overlaps_solid(w, falling[0].pos, falling[0].scale * 0.5f));
    // ...and it came to REST rather than tunnelling: another second moves it
    // less than a sub-voxel.
    const vec3 before = falling[0].pos;
    for (int i = 0; i < 60; ++i) antourage_detach_step(w, falling, dt);
    CHECK(!falling.empty());
    const vec3 after = falling[0].pos;
    CHECK(length(after - before) < 0.25f);
    std::fprintf(stderr, "[antourage] pipe fell %.2f m and rested\n",
                 startZ - after.z);

    // The life is the SAME clock the chains use: run it out and the array
    // empties itself.
    for (int i = 0; i < 200 && !falling.empty(); ++i)
        antourage_detach_step(w, falling, dt);
    CHECK(falling.empty());

    // THE PLAYER'S OWN PATH, end to end (owner asked whether every anchor must
    // die for a pipe to fall — no: a segment is clamped to ONE column, so
    // blowing that column drops that segment and leaves its neighbours up).
    {
        World wp;
        generate_floor(wp, 0, floor_spec(FloorKind::Residential), 1337u);
        AntourageBake bp;
        bake_antourage(wp, 0, 1337u, bp);
        const AntourageInstance* pipe = nullptr;
        for (const AntourageInstance& it : bp.instances)
            if (it.shape != kShapeBox) { pipe = &it; break; }
        CHECK(pipe != nullptr);
        const AntourageInstance target = *pipe;
        CHECK(antourage_alive(wp.grid(), target));
        // Shoot the pipe itself with the console/weapon radius.
        CarveOp op{};
        op.x = target.pos.x; op.y = target.pos.y; op.z = target.pos.z;
        op.radius = 1.5f;
        op.power = 60000;
        op.seed = 77u;
        CarveScratch sc;
        CarveResult res2;
        carve_sphere(wp, op, sc, res2);
        CHECK(!res2.dirtyCells.empty());
        // Its clamp column is gone, so the piece is dead...
        CHECK(!antourage_alive(wp.grid(), target));
        // ...and the very same op hands it over as a falling body.
        ParticleBurstQueue q3;
        std::vector<DetachedPiece> fell3;
        const std::uint32_t dead3 = antourage_carve_step(
            wp, bp, res2.dirtyCells.data(), res2.dirtyCells.size(), q3, 3u, &fell3);
        CHECK(dead3 > 0);
        CHECK(!fell3.empty());
        std::fprintf(stderr,
                     "[antourage] one 1.5 m shot at a pipe: %u pieces cut loose\n",
                     dead3);
    }

    // And a carve hands severed legs over instead of dropping them on the floor
    // of the void: the same op that reports a death fills the falling list.
    World w2;
    generate_floor(w2, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake b2;
    bake_antourage(w2, 0, 1337u, b2);
    const AntourageInstance victim = b2.instances.front();
    w2.grid().set_cell(victim.ax0, victim.ay0, victim.az0, kCellAir);
    const std::uint32_t dirty = static_cast<std::uint32_t>(
        macro_index(victim.ax0, victim.ay0, victim.az0));
    ParticleBurstQueue bursts;
    std::vector<DetachedPiece> fell;
    const std::uint32_t dead =
        antourage_carve_step(w2, b2, &dirty, 1, bursts, 5u, &fell);
    CHECK(dead > 0);
    CHECK(fell.size() == dead);       // one body per severed rigid piece
    CHECK(fell[0].life > 0.0f);
    // Passing no list is still legal — headless callers keep their silence.
    ParticleBurstQueue q2;
    antourage_carve_step(w2, b2, &dirty, 1, q2, 5u);
}

// TWO THINGS A PIPE MUST BE, measured rather than eyeballed — both were owner
// bug reports from live play (2026-08-05: "трубы висят в воздухе", "нет сети
// труб, просто одиночные секции без ветвлений").
//
// 1. TOUCHING. Every cylinder is seated on the face it hugs, so a ray from its
//    axis toward its anchor meets matter within a radius and a bit. Before the
//    leg was split at surface steps, 531 of 2767 floated 1-2 m under nothing.
// 2. CONNECTED. The bake lays trunks and then BRANCHES OFF them, welding a
//    junction at each root, so joints are common rather than accidental: one
//    per ~1.6 legs, against one per 15 when every walk started somewhere
//    unrelated.
static void test_pipes_hug_and_branch() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake b;
    // BUDGET, the last line of the owner's spec: measured, not asserted. A wall
    // clock on a shared machine makes a flaky gate, but an unmeasured budget is
    // not a budget — so the number is printed every run and written down in
    // [antourage.md]. The bake is load-path work ([performance.md]).
    const auto t0 = std::chrono::steady_clock::now();
    bake_antourage(w, 0, 1337u, b);
    const auto t1 = std::chrono::steady_clock::now();
    std::fprintf(stderr, "[antourage] bake: %.1f ms, %zu instances\n",
                 std::chrono::duration<double, std::milli>(t1 - t0).count(),
                 b.instances.size());

    const float step = kCellSize / static_cast<float>(kSubDim);
    std::uint32_t legs = 0, joints = 0, floating = 0;
    for (const AntourageInstance& it : b.instances) {
        if (it.shape == kShapeBox) { ++joints; continue; }
        ++legs;
        // SEATED, measured against the very column the piece names as its
        // anchor: the distance from the pipe's axis to that column's face must
        // be the mounting gap, not a metre of air. Ray-marching from the
        // instance CENTRE looked right but lied both ways — a half-link reaches
        // into the neighbour's cell, where the ceiling may be higher.
        const int ax = antourage_face_axis(it.face);
        const int dr = antourage_face_dir(it.face);
        const int s = w.grid().mask(it.ax0, it.ay0, it.az0).face_layer(ax, dr, true);
        if (s < 0) { ++floating; continue; }         // nothing to clamp to at all
        const int anchorCoord = ax == 0 ? it.ax0 : ax == 1 ? it.ay0 : it.az0;
        const int edge = dr < 0 ? s : s + 1;
        const float face_m = static_cast<float>(anchorCoord) * kCellSize +
                             static_cast<float>(edge) * step;
        const float pipe_m = ax == 0 ? it.pos.x : ax == 1 ? it.pos.y : it.pos.z;
        // Toroidal difference: an anchor across the seam is still adjacent.
        const float gap = std::fabs(wrap_delta_f(pipe_m, face_m, kWorldExtent));
        if (gap > kPipeRadius + 0.2f) ++floating;
    }

    // Keyed by the CLAMP COLUMN and the face, which is the network's own node
    // identity — not by world position: a pipe sits on the real surface, which
    // for a high lintel is inside the neighbouring cell, so position keys make
    // consecutive segments look unrelated.
    // Keyed by the pipe's OWN cell and face — the network's node identity. The
    // cell is the anchor stepped back toward the pipe (the anchor is the column
    // on the far side of the face), and it matters: keying by the anchor makes
    // a bend inside one cell look like two unrelated places, because its two
    // faces have two different anchors.
    auto key_of = [](std::uint8_t ax, std::uint8_t ay, std::uint8_t az,
                     std::uint8_t face) {
        int c3[3] = {ax, ay, az};
        c3[antourage_face_axis(face)] =
            wrap_macro(c3[antourage_face_axis(face)] + antourage_face_dir(face));
        return macro_index(c3[0], c3[1], c3[2]) * 8u + face;
    };
    std::vector<std::uint64_t> runKeys, fitKeys;
    for (const AntourageInstance& it : b.instances) {
        const std::uint64_t k = key_of(it.ax0, it.ay0, it.az0, it.face);
        if (it.shape == kShapeBox) fitKeys.push_back(k);
        else runKeys.push_back(k);
    }
    std::sort(runKeys.begin(), runKeys.end());
    std::sort(fitKeys.begin(), fitKeys.end());
    auto has = [](const std::vector<std::uint64_t>& v, std::uint64_t k) {
        return std::binary_search(v.begin(), v.end(), k);
    };
    // CONNECTED COMPONENTS, the owner's own acceptance criterion: a plumbing
    // system is one graph, not a pile of islands. Union-find over the emitted
    // pieces, joined the way the network joins them — same face and adjacent
    // clamp column, or two faces of the same cell.
    std::vector<std::uint64_t> allKeys = runKeys;
    allKeys.insert(allKeys.end(), fitKeys.begin(), fitKeys.end());
    std::sort(allKeys.begin(), allKeys.end());
    allKeys.erase(std::unique(allKeys.begin(), allKeys.end()), allKeys.end());
    std::vector<std::uint32_t> parent(allKeys.size());
    for (std::size_t i = 0; i < parent.size(); ++i)
        parent[i] = static_cast<std::uint32_t>(i);
    std::function<std::uint32_t(std::uint32_t)> find =
        [&](std::uint32_t x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    auto idx_of = [&](std::uint64_t k) -> std::int64_t {
        const auto it2 = std::lower_bound(allKeys.begin(), allKeys.end(), k);
        if (it2 == allKeys.end() || *it2 != k) return -1;
        return it2 - allKeys.begin();
    };
    auto unite = [&](std::int64_t a2, std::int64_t b2) {
        if (a2 < 0 || b2 < 0) return;
        const std::uint32_t ra = find(static_cast<std::uint32_t>(a2));
        const std::uint32_t rb = find(static_cast<std::uint32_t>(b2));
        if (ra != rb) parent[ra] = rb;
    };
    for (std::size_t i = 0; i < allKeys.size(); ++i) {
        const std::uint64_t k = allKeys[i];
        const std::uint8_t face = static_cast<std::uint8_t>(k % 8u);
        const std::size_t cell = static_cast<std::size_t>(k / 8u);
        const int cx = static_cast<int>(cell % kMacroDim);
        const int cy = static_cast<int>((cell / kMacroDim) % kMacroDim);
        const int cz = static_cast<int>(cell / (kMacroDim * kMacroDim));
        for (int axis = 0; axis < 3; ++axis)
            for (int sgn = -1; sgn <= 1; sgn += 2) {
                int a3[3] = {cx, cy, cz};
                a3[axis] = wrap_macro(a3[axis] + sgn);
                unite(static_cast<std::int64_t>(i),
                      idx_of(macro_index(a3[0], a3[1], a3[2]) * 8u + face));
            }
        for (std::uint8_t of = 0; of < 6u; ++of)
            if (of != face) unite(static_cast<std::int64_t>(i), idx_of(cell * 8u + of));
    }
    // Branch points: nodes with three or more neighbours in the network. This
    // is what "ветвится" means in a number.
    std::uint32_t branchPoints = 0;
    for (std::size_t i = 0; i < allKeys.size(); ++i) {
        const std::uint64_t k = allKeys[i];
        const std::uint8_t face = static_cast<std::uint8_t>(k % 8u);
        const std::size_t cell = static_cast<std::size_t>(k / 8u);
        const int cx = static_cast<int>(cell % kMacroDim);
        const int cy = static_cast<int>((cell / kMacroDim) % kMacroDim);
        const int cz = static_cast<int>(cell / (kMacroDim * kMacroDim));
        int deg = 0;
        for (int axis = 0; axis < 3; ++axis)
            for (int sgn = -1; sgn <= 1; sgn += 2) {
                int a3[3] = {cx, cy, cz};
                a3[axis] = wrap_macro(a3[axis] + sgn);
                if (idx_of(macro_index(a3[0], a3[1], a3[2]) * 8u + face) >= 0) ++deg;
            }
        for (std::uint8_t of = 0; of < 6u; ++of)
            if (of != face && idx_of(cell * 8u + of) >= 0) ++deg;
        if (deg >= 3) ++branchPoints;
    }

    std::uint32_t comps = 0;
    for (std::size_t i = 0; i < allKeys.size(); ++i)
        if (find(static_cast<std::uint32_t>(i)) == i) ++comps;
    std::fprintf(stderr,
                 "[antourage] pipe network: %zu nodes, %u components, %u branch points\n",
                 allKeys.size(), comps, branchPoints);

    std::uint32_t orphans = 0;
    for (const AntourageInstance& it : b.instances) {
        if (it.shape == kShapeBox) continue;
        if (has(fitKeys, key_of(it.ax0, it.ay0, it.az0, it.face))) continue;
        const int axis = it.shape == kShapeCylinderX ? 0
                       : it.shape == kShapeCylinderY ? 1 : 2;
        bool linked = false;
        for (int s = -1; s <= 1 && !linked; s += 2) {
            int a[3] = {it.ax0, it.ay0, it.az0};
            a[axis] = wrap_macro(a[axis] + s);
            const std::uint64_t nk = key_of(static_cast<std::uint8_t>(a[0]),
                                            static_cast<std::uint8_t>(a[1]),
                                            static_cast<std::uint8_t>(a[2]),
                                            it.face);
            linked = has(runKeys, nk) || has(fitKeys, nk);
        }
        if (!linked) ++orphans;
    }
    // WHERE on the floor does the network actually live? A tower whose plumbing
    // all sits on one storey is the recurring "everything on the ground floor"
    // asymmetry ([problems.md] §11), and only a histogram catches it.
    std::uint32_t byStorey[8] = {0,0,0,0,0,0,0,0};
    for (const AntourageInstance& it : b.instances)
        ++byStorey[(it.az0 * 8u) / kMacroDim];
    std::fprintf(stderr, "[antourage] pieces by z-eighth: %u %u %u %u %u %u %u %u\n",
                 byStorey[0], byStorey[1], byStorey[2], byStorey[3],
                 byStorey[4], byStorey[5], byStorey[6], byStorey[7]);
    std::uint32_t byAxis[3] = {0, 0, 0}, byFace[6] = {0,0,0,0,0,0};
    for (const AntourageInstance& it : b.instances) {
        if (it.shape == kShapeBox) continue;
        ++byAxis[it.shape == kShapeCylinderX ? 0 : it.shape == kShapeCylinderY ? 1 : 2];
        ++byFace[it.face % 6u];
    }
    std::fprintf(stderr,
                 "[antourage] pipes: %u legs, %u joints, %u floating, %u orphans\n",
                 legs, joints, floating, orphans);
    std::fprintf(stderr,
                 "[antourage] run axes X %u Y %u Z %u | faces +X %u -X %u +Y %u -Y %u +Z %u -Z %u\n",
                 byAxis[0], byAxis[1], byAxis[2], byFace[0], byFace[1],
                 byFace[2], byFace[3], byFace[4], byFace[5]);
    CHECK(legs > 0);
    // THE OWNER'S ACCEPTANCE CRITERIA, verbatim (2026-08-05):
    //   "тест печатает число компонент связности (должно быть 1-3) и долю
    //    висящих в пустоте секций (должно быть 0)".
    CHECK(comps >= 1u && comps <= 3u);
    CHECK(floating == 0u);
    CHECK(orphans == 0u);
    // ...and it is a network, not a scatter: fittings are common and the graph
    // really BRANCHES — a node with three or more neighbours every few cells,
    // not one pipeline across the floor.
    CHECK(joints * 4u > legs);
    CHECK(branchPoints * 20u > static_cast<std::uint32_t>(allKeys.size()));
    // WHERE: the whole floor, not one storey. No eighth of the tower may hold
    // more than half the network — the recurring "everything on the ground
    // floor" asymmetry ([problems.md] §11) is exactly what this catches.
    std::uint32_t total = 0, worst = 0;
    for (int i = 0; i < 8; ++i) { total += byStorey[i]; if (byStorey[i] > worst) worst = byStorey[i]; }
    CHECK(worst * 2u <= total);
}

static void test_antourage_all() {
    // A real floor, dressed.
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake bake;
    bake_antourage(w, 0, 1337u, bake);

    // Both modules produced real content on the padic tower — through the
    // UNIVERSAL primitive contract ([antourage.h]): the core knows instances
    // and chains, never "pipes".
    CHECK(!bake.instances.empty());
    CHECK(!bake.wires.empty());
    std::fprintf(stderr,
                 "[antourage] %u cells walked, %zu instances; wires: %zu\n",
                 bake.pipeCells, bake.instances.size(), bake.wires.size());

    // THE LAW ([antourage.h]): the bake NEVER writes the grid — antourage is
    // mesh anchored to real world voxels, and an invisible voxel would be a
    // contradiction. Every anchor it recorded is real SOLID matter, every
    // shape ordinal is a real catalog row, every scale is positive.
    for (const AntourageInstance& it : bake.instances) {
        CHECK(w.grid().cell(it.ax0, it.ay0, it.az0) != kCellAir);
        CHECK(w.grid().cell(it.ax1, it.ay1, it.az1) != kCellAir);
        CHECK(it.shape <= kShapeCylinderZ);
        CHECK(it.scale.x > 0.0f && it.scale.y > 0.0f && it.scale.z > 0.0f);
    }
    // ...and no cell anywhere carries the pipe material: it exists for the
    // MESH's shading only.
    std::uint32_t pipeMatCells = 0;
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                if (w.grid().cell(x, y, z) == kMatPipeMetal) ++pipeMatCells;
    CHECK(pipeMatCells == 0);

    // GHOST: every wire hangs from real ceilings over clear air, and its rest
    // pose sags between its anchors, never above them.
    for (const WireChain& c : bake.wires) {
        CHECK(w.grid().cell(c.ax0, c.ay0, c.az0) != kCellAir); // anchors solid
        CHECK(w.grid().cell(c.ax1, c.ay1, c.az1) != kCellAir);
        CHECK(c.restLen > 0.0f);
        CHECK(c.massKg > 0.0f);
        // Ends may sit at DIFFERENT heights now (each anchors to its own
        // ceiling's real under-face); nothing hangs above the higher end.
        const float top = c.p[0].z > c.p[kWirePoints - 1].z
                              ? c.p[0].z
                              : c.p[kWirePoints - 1].z;
        for (int i = 0; i < kWirePoints; ++i) CHECK(c.p[i].z <= top + 1e-4f);
        CHECK(c.p[kWirePoints / 2].z < top); // the middle really sags
    }

    // CLOTH — the third primitive ([antourage.h] ClothSheet): sheets hang from
    // real ceiling anchors, the top row is pinned, every free point sits at or
    // below its own column's pin, and both rest lengths are usable.
    CHECK(!bake.cloths.empty());
    std::fprintf(stderr, "[antourage] cloths: %zu\n", bake.cloths.size());
    for (const ClothSheet& s : bake.cloths) {
        CHECK(w.grid().cell(s.ax0, s.ay0, s.az0) != kCellAir);
        CHECK(w.grid().cell(s.ax1, s.ay1, s.az1) != kCellAir);
        CHECK(s.restX > 0.0f);
        CHECK(s.restY > 0.0f);
        CHECK(s.pinMask == 0xFFu); // this module pins exactly the top row
        for (int c = 0; c < kClothW; ++c)
            for (int r = 1; r < kClothH; ++r)
                CHECK(s.p[r * kClothW + c].z <= s.p[c].z + 1e-4f);
    }

    // Deterministic: same (grid, number, seed) -> the identical dressing, so a
    // recycled World re-bakes bit-for-bit like the geometry.
    World w2;
    generate_floor(w2, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake again;
    bake_antourage(w2, 0, 1337u, again);
    CHECK(again.pipeCells == bake.pipeCells);
    CHECK(again.instances.size() == bake.instances.size());
    CHECK(again.wires.size() == bake.wires.size());
    CHECK(again.cloths.size() == bake.cloths.size());
    CHECK(w.grid().types() == w2.grid().types());

    // The dressing must not eat the doors: door_build still validates a real
    // door population against the dressed grid.
    DoorSet doors;
    CHECK(door_build(w, doors, 0, floor_spec(FloorKind::Residential), 1337u) > 0);

    // DESTRUCTION reaches the dressing ([antourage.h] antourage_carve_step —
    // the antourage twin of anchor_validate_step). Empty the first instance's
    // anchor cell by hand, hand the carve's dirty list over, and the piece must
    // report itself dead exactly ONCE, with debris to show for it.
    {
        // Every pipe segment is clamped to ONE column now ([antourage.md] — a
        // segment belongs to its own cell), so "already dead" is exercised by
        // carving the same anchor twice rather than one end at a time.
        const AntourageInstance& victim = bake.instances.front();
        CHECK(antourage_alive(w.grid(), victim));
        ParticleBurstQueue bursts;
        // A dirty list that names an untouched cell kills nobody.
        const std::uint32_t innocent = static_cast<std::uint32_t>(
            macro_index(victim.ax0, victim.ay0, wrap_macro(victim.az0 + 4)));
        CHECK(antourage_carve_step(w, bake, &innocent, 1, bursts, 7u) == 0);
        CHECK(bursts.count == 0);

        w.grid().set_cell(victim.ax0, victim.ay0, victim.az0, kCellAir);
        const std::uint32_t dirty = static_cast<std::uint32_t>(
            macro_index(victim.ax0, victim.ay0, victim.az0));
        CHECK(!antourage_alive(w.grid(), victim));
        const std::uint32_t dead =
            antourage_carve_step(w, bake, &dirty, 1, bursts, 7u);
        CHECK(dead > 0);  // at least the victim; anchor cells are shared
        // One burst per severed piece, up to the queue's bounded ring.
        CHECK(bursts.count > 0 && bursts.count <= dead);
        std::fprintf(stderr, "[antourage] carve severed %u piece(s)\n", dead);

        // The SECOND carve nearby must not re-kill what is already gone: a
        // neighbouring cell empties now, and the piece — dead since the first
        // op — stays silent.
        ParticleBurstQueue again;
        const int nx = wrap_macro(victim.ax1 + 1);
        w.grid().set_cell(nx, victim.ay1, victim.az1, kCellAir);
        const std::uint32_t dirty2 = static_cast<std::uint32_t>(
            macro_index(nx, victim.ay1, victim.az1));
        const std::uint32_t dead2 =
            antourage_carve_step(w, bake, &dirty2, 1, again, 9u);
        for (std::uint16_t i = 0; i < again.count; ++i)
            CHECK(again.items[i].pos.x != victim.pos.x ||
                  again.items[i].pos.y != victim.pos.y ||
                  again.items[i].pos.z != victim.pos.z);
        CHECK(again.count == dead2);
    }

    // A verlet chain does NOT die with one anchor: the cut end lets go and it
    // hangs from the other ([antourage.h] wire_live_pins). Death is "nothing
    // is pinned any more" — and the sheet's top row splits the same way.
    {
        World w3;
        generate_floor(w3, 0, floor_spec(FloorKind::Residential), 1337u);
        AntourageBake b3;
        bake_antourage(w3, 0, 1337u, b3);
        CHECK(!b3.wires.empty());
        const WireChain wire = b3.wires.front();
        CHECK(wire_live_pins(w3.grid(), wire) == wire.pinMask); // intact
        CHECK(antourage_alive(w3.grid(), wire));

        w3.grid().set_cell(wire.ax0, wire.ay0, wire.az0, kCellAir);
        const std::uint8_t halfPins = wire_live_pins(w3.grid(), wire);
        CHECK((halfPins & 1u) == 0u);                    // that end let go
        CHECK((halfPins >> (kWirePoints - 1)) & 1u);     // this one still holds
        CHECK(antourage_alive(w3.grid(), wire));         // still hanging
        // ...and a carve that only cuts one end sheds NO debris for the chain
        // (pipes sharing that ceiling cell may still die — check the chain's
        // own midpoint, not the total).
        ParticleBurstQueue q;
        const vec3 mid = wire.p[kWirePoints / 2];
        const std::uint32_t cut0 = static_cast<std::uint32_t>(
            macro_index(wire.ax0, wire.ay0, wire.az0));
        antourage_carve_step(w3, b3, &cut0, 1, q, 3u);
        for (std::uint16_t i = 0; i < q.count; ++i)
            CHECK(q.items[i].pos.x != mid.x || q.items[i].pos.y != mid.y ||
                  q.items[i].pos.z != mid.z);
        const std::uint16_t afterFirst = q.count;

        w3.grid().set_cell(wire.ax1, wire.ay1, wire.az1, kCellAir);
        CHECK(wire_live_pins(w3.grid(), wire) == 0u);
        CHECK(!antourage_alive(w3.grid(), wire));
        const std::uint32_t cut1 = static_cast<std::uint32_t>(
            macro_index(wire.ax1, wire.ay1, wire.az1));
        CHECK(antourage_carve_step(w3, b3, &cut1, 1, q, 4u) > 0);
        CHECK(q.count > afterFirst); // the chain finally shed its debris

        // Cloth: one corner cut leaves the other half of the top row pinned.
        // Pick a sheet the two carves above did not already touch.
        const ClothSheet* intact = nullptr;
        for (const ClothSheet& s : b3.cloths)
            if (w3.grid().cell(s.ax0, s.ay0, s.az0) != kCellAir &&
                w3.grid().cell(s.ax1, s.ay1, s.az1) != kCellAir) {
                intact = &s;
                break;
            }
        CHECK(intact != nullptr);
        const ClothSheet sheet = *intact;
        CHECK(cloth_live_pins(w3.grid(), sheet) == sheet.pinMask);
        w3.grid().set_cell(sheet.ax0, sheet.ay0, sheet.az0, kCellAir);
        const std::uint32_t halfSheet = cloth_live_pins(w3.grid(), sheet);
        CHECK((halfSheet & 0x0Fu) == 0u);   // left half of the top row let go
        CHECK((halfSheet & 0xF0u) != 0u);   // right half still holds
        CHECK(antourage_alive(w3.grid(), sheet));
        w3.grid().set_cell(sheet.ax1, sheet.ay1, sheet.az1, kCellAir);
        CHECK(cloth_live_pins(w3.grid(), sheet) == 0u);
        CHECK(!antourage_alive(w3.grid(), sheet));
    }
}
