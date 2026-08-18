// walk_bits — the walkability oracle, and the two claims phase C will stand on.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga` / `using namespace giga::game`. Everything except the
// entry point `test_walkbits_all()` lives in `namespace walkbits_test`.
//
// The async-rebake plan (markoaudit/plans/async-rebake.md §2, §7g) replaces the
// bake worker's raw pointer into the live MacroGrid with a 256 KiB WalkBits
// snapshot. That substitution is sound if and only if TWO things hold, and they
// are exactly what this suite pins:
//
//   1. BIT-IDENTITY: baking through the bits produces byte-for-byte the output
//      of baking through the grid — for nav (edge/dist/next, flow, nearest) AND
//      for room zones (flow, nearRoom, baked). The bits are built HERE, by
//      hand, from the predicates spelled out in this file — not by calling the
//      production builders — so a drift in either law (nav's `!full()`,
//      room_zone's body footprint) breaks this suite instead of silently
//      re-defining what a wall is. The production builders are then checked
//      AGAINST the hand-built bits, which is the same claim from the other end.
//
//   2. PATCH == REBUILD: the O(1) per-cell patch (the future dirtyCells drain)
//      leaves the bitset in exactly the state a full rebuild reaches. Proven by
//      mutating real cells in every direction the predicates can flip —
//      including the one where the two laws DIVERGE (a single carved voxel
//      opens nav's bit and leaves the body's shut), because that divergence is
//      the whole reason there are two bitsets and two patch functions.
//
// One real floor, generated once and shared: the mutation test runs LAST
// because it carves the world the identity tests measured.
#include <cstring>

#include "game/floor_gen.h"   // generate_floor — a real carved floor, not a toy
#include "game/floor_spec.h"  // FloorKind, floor_spec
#include "game/room_zone.h"   // bake_room_zones + the body-law oracle helpers
#include "world/macro_grid.h" // SubMask — the mutation test carves masks directly
#include "world/nav.h"        // bake_coarse/bake_fine + the nav-law oracle helpers
#include "world/types.h"      // kMacroDim, kMacroCells, macro_index
#include "world/walk_bits.h"  // WalkBits — the module under test
#include "world/world.h"

namespace walkbits_test {

// The two walkability laws, restated INDEPENDENTLY of the production helpers
// (nav.cpp's `cell_open`, room_zone.cpp's `blocked`). A suite that built its
// reference bits by calling the code under test could only prove the code
// agrees with itself; these two lambdas are the contract written down twice,
// which is what makes a predicate drift a red test instead of a redefinition.
inline bool ref_nav_open(const SubMask& m) { return !m.full(); }
inline bool ref_body_open(const MacroGrid& g, int x, int y, int z) {
    // The GRID form of the body law, i.e. the public contract predicate —
    // deliberately the other spelling than build_body_walk_bits' mask form, so
    // the two forms are also proven to be one law.
    return room_body_walkable(g, x, y, z);
}

void nav_bake_through_bits_is_bit_identical(const World& w) {
    // The grid path — the entry every synchronous caller still uses.
    nav::CoarseGraph g1;
    nav::bake_coarse(w.grid(), g1);
    nav::FineNav f1;
    nav::bake_fine(w.grid(), f1);

    // Hand-built oracle: one bit per cell from the law spelled above, through
    // the plain at/set API (which this also exercises bit by bit).
    WalkBits bits;
    bits.words.assign(WalkBits::kWords, 0u);
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                bits.set(macro_index(x, y, z),
                         ref_nav_open(w.grid().mask(x, y, z)));

    // The production builder must agree with the hand-built reference word for
    // word — this is the predicate-drift pin of plan §7(г).
    WalkBits built;
    nav::build_walk_bits(w.grid(), built);
    CHECK(built.words == bits.words);

    // And the oracle bakes must reproduce the grid bakes byte for byte.
    // memcmp over CoarseGraph is safe here for the reason suite_navcache.inl
    // states: nav_cache.cpp static_asserts the struct is padding-free.
    nav::CoarseGraph g2;
    nav::bake_coarse(bits, g2);
    CHECK(std::memcmp(&g1, &g2, sizeof(nav::CoarseGraph)) == 0);

    nav::FineNav f2;
    nav::bake_fine(bits, f2);
    CHECK(f1.flow == f2.flow);
    CHECK(f1.nearest == f2.nearest);
    // Not an empty-vs-empty accident: the floor really produced fields.
    CHECK(f1.flow.size() == static_cast<std::size_t>(nav::kNodes) * kMacroCells);
    CHECK(f1.nearest.size() == kMacroCells);
}

void rooms_bake_through_bits_is_bit_identical(const World& w) {
    const FloorKind kind = FloorKind::Residential;
    RoomZones z1;
    bake_room_zones(w.grid(), kind, 0, z1);
    CHECK(z1.ready()); // the comparison below must not be zero-against-zero

    // Hand-built BODY oracle from the grid-form law.
    WalkBits body;
    body.words.assign(WalkBits::kWords, 0u);
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                body.set(macro_index(x, y, z), ref_body_open(w.grid(), x, y, z));

    // The production builder (mask form) against the grid form: one law.
    WalkBits built;
    build_body_walk_bits(w.grid(), built);
    CHECK(built.words == body.words);

    RoomZones z2;
    bake_room_zones(body, kind, 0, z2);
    CHECK(z2.baked == z1.baked);
    CHECK(z2.kind == z1.kind);
    CHECK(z2.number == z1.number);
    for (std::size_t bi = 0; bi < kFloorRoomBits; ++bi) {
        CHECK(z1.flow[bi] == z2.flow[bi]);
        CHECK(z1.nearRoom[bi] == z2.nearRoom[bi]);
    }
}

// Mutate real cells in every direction the laws can flip, patch the resident
// bitsets per cell, and demand the patched state EQUALS a from-scratch rebuild.
// This is the exact obligation of the future dirtyCells drain: after phase C a
// patched bit that disagreed with a rebuild would steer a background bake by a
// world that never existed.
void patch_equals_rebuild(World& w) {
    MacroGrid& g = w.grid();

    // Resident bitsets, as phase C will hold them.
    WalkBits navBits, bodyBits;
    nav::build_walk_bits(g, navBits);
    build_body_walk_bits(g, bodyBits);

    // Find one fully-solid cell and one air cell by deterministic scan, so the
    // test does not depend on floor-gen internals staying put.
    int solidI = -1, airI = -1;
    for (std::size_t i = 0; i < kMacroCells && (solidI < 0 || airI < 0); ++i) {
        const SubMask& m = g.masks()[i];
        if (solidI < 0 && m.full()) solidI = static_cast<int>(i);
        if (airI < 0 && m.empty()) airI = static_cast<int>(i);
    }
    CHECK(solidI >= 0);
    CHECK(airI >= 0);
    const auto coord = [](int i, int& x, int& y, int& z) {
        x = i % kMacroDim;
        y = (i / kMacroDim) % kMacroDim;
        z = i / (kMacroDim * kMacroDim);
    };
    int sx, sy, sz, ax, ay, az;
    coord(solidI, sx, sy, sz);
    coord(airI, ax, ay, az);

    // Direction 1 — air -> fully solid: BOTH laws flip open -> blocked.
    g.fill_cell(ax, ay, az, 1);
    // Direction 2 — one voxel carved out of a solid cell: the DIVERGENCE. Nav
    // ("not fully solid") flips blocked -> open; the body footprint is still
    // walled, so the body bit must NOT move. This asymmetry is why there are
    // two bitsets at all.
    g.mask(sx, sy, sz).clear(sub_bit(0, 0, 0));

    const std::size_t si = static_cast<std::size_t>(solidI);
    const std::size_t ai = static_cast<std::size_t>(airI);
    nav::patch_walk_bit(navBits, ai, g.mask(ax, ay, az));
    nav::patch_walk_bit(navBits, si, g.mask(sx, sy, sz));
    patch_body_walk_bit(bodyBits, ai, g.mask(ax, ay, az));
    patch_body_walk_bit(bodyBits, si, g.mask(sx, sy, sz));

    CHECK(!navBits.at(ai));
    CHECK(!bodyBits.at(ai));
    CHECK(navBits.at(si));   // one missing voxel is "not fully solid"
    CHECK(!bodyBits.at(si)); // ...but no body fits through a 1-voxel hole

    // Direction 3 — carve the solid cell down to a body-sized channel: clear
    // the centred 4x4 footprint over sub-layers 0..6 ([room_zone.cpp]
    // kBodyFootprint x kBodySubLayers). Now the body law opens too.
    for (int lz = 0; lz < 7; ++lz)
        for (int ly = 2; ly <= 5; ++ly)
            for (int lx = 2; lx <= 5; ++lx)
                g.mask(sx, sy, sz).clear(sub_bit(lx, ly, lz));
    nav::patch_walk_bit(navBits, si, g.mask(sx, sy, sz));
    patch_body_walk_bit(bodyBits, si, g.mask(sx, sy, sz));
    CHECK(navBits.at(si));
    CHECK(bodyBits.at(si));

    // Direction 4 — back to full: blocked again for both. Round-tripping the
    // same cell is what a real battle does to a wall (carve, then samosbor
    // re-fill), and a patch that only worked one way would pass 1-3.
    g.fill_cell(sx, sy, sz, 1);
    nav::patch_walk_bit(navBits, si, g.mask(sx, sy, sz));
    patch_body_walk_bit(bodyBits, si, g.mask(sx, sy, sz));
    CHECK(!navBits.at(si));
    CHECK(!bodyBits.at(si));

    // THE claim: after all of it, patched == rebuilt, word for word.
    WalkBits navRef, bodyRef;
    nav::build_walk_bits(g, navRef);
    build_body_walk_bits(g, bodyRef);
    CHECK(navBits.words == navRef.words);
    CHECK(bodyBits.words == bodyRef.words);
}

} // namespace walkbits_test

void test_walkbits_all() {
    // One real floor for the whole suite. Residential: its mix rolls
    // Kitchen/Bathroom/Living ([floor_gen.cpp]), so the rooms comparison below
    // compares real fields, not eleven empty vectors against eleven others.
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    walkbits_test::nav_bake_through_bits_is_bit_identical(w);
    walkbits_test::rooms_bake_through_bits_is_bit_identical(w);
    // Last: it carves the floor the identity tests just measured.
    walkbits_test::patch_equals_rebuild(w);
}
