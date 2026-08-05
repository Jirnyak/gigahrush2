// Antourage — the baked-dressing seam ([game/antourage/antourage.h]): SOLID
// pipes written into the grid, GHOST wire chains beside it.
//
// Included into game_test.cpp after its CHECK macro and `using namespace`.

#include "game/antourage/antourage.h"
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
        // A leg, not a joint: two DISTINCT anchor cells, so the "already dead"
        // half of the rule can be exercised by killing them one at a time.
        const AntourageInstance* leg = nullptr;
        for (const AntourageInstance& it : bake.instances)
            if (it.ax0 != it.ax1 || it.ay0 != it.ay1 || it.az0 != it.az1) {
                leg = &it;
                break;
            }
        CHECK(leg != nullptr);
        const AntourageInstance& victim = *leg;
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

        // The SECOND carve nearby must not re-kill what is already gone: the
        // victim's other anchor goes now, and the piece — dead since the first
        // op — stays silent.
        ParticleBurstQueue again;
        w.grid().set_cell(victim.ax1, victim.ay1, victim.az1, kCellAir);
        const std::uint32_t dirty2 = static_cast<std::uint32_t>(
            macro_index(victim.ax1, victim.ay1, victim.az1));
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
