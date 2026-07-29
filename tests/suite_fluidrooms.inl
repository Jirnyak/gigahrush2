// Two systems that existed, were tested, and could not be reached in the shipped game
// mode. Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace`; it carries its own includes of the systems under test so the diff
// to game_test.cpp stays two lines.
//
// 1. THE FLUID SIM WAS NEVER STEPPED. main.cpp called fluid_step only under
//    `genMode == WorldGenMode::Maze`, and the field was seeded only in
//    src/app/worldgen.cpp — maze only. The default mode is FloorStack, so an entire
//    cellular fluid simulation was compiled, unit-tested for mass conservation, and
//    unreachable in the mode the game runs. floor_gen now seeds it.
//
// 2. THE ROOM TAXONOMY HAD NO CONSUMER. `MobDef::roomMask` was written for all 69 mob
//    rows and read NOWHERE; `ItemDef::roomMask` was read only behind a `roomMask != 0`
//    guard that all three callers defeated by passing 0. That is the whole
//    `spawn_rooms` column of items.csv (446 rows) and `rooms` of mobs.csv (69 rows).
//
// The assertion this file exists for is NOT "the filter works" — a filter that refuses
// everything also "works". It is the pair: the taxonomy must visibly CONSTRAIN what a
// room holds, and must never leave a room with nothing. Both halves are measured
// against the CSVs rather than assumed, because the intersection of a room mask with a
// container kind's category filter is empty far more often than either alone: a
// PublicBox in a CORRIDOR has zero legal items at every depth, and container.h
// documents a public box as exactly a corridor fixture.

#include "game/container.h"
#include "game/floor_gen.h"
#include "game/item_table.h"
#include "game/mob_spawn.h"
#include "game/mob_table.h"
#include "sim/fluid.h"
#include "world/field.h"
#include "world/world.h"

namespace fluidrooms_detail {

struct Wet {
    double mass = 0.0;  // every amount, including frozen sub-minFlow dribbles
    int cells = 0;      // cells a consumer would call wet
    float lo = 0.0f;    // lowest and highest WET amount — how level the water is
    float hi = 0.0f;
};

inline Wet wet_census(const World& w) {
    Wet out;
    // Same const_cast FieldRegistry::find forces on every reader; see fluid_at.
    const Field<float>* f =
        const_cast<World&>(w).fields().find<float>(kFluidField);
    if (f == nullptr) return out;
    for (float v : f->data()) {
        out.mass += static_cast<double>(v);
        if (v < kFluidMinFlow) continue;
        if (out.cells == 0 || v < out.lo) out.lo = v;
        if (v > out.hi) out.hi = v;
        ++out.cells;
    }
    return out;
}

// Step until nothing moves, or give up. Returns the step count; -1 means it never
// settled, which is the failure the kerbed-basin shape exists to prevent — an open
// puddle creeps for thousands of steps and every moving step is a 28.6 ms cube-pass
// instance rebuild ([render/cube_pass.h]).
inline int settle(World& w, int limit, bool& movedFirst) {
    movedFirst = false;
    for (int i = 0; i < limit; ++i) {
        const FluidStep st = fluid_step(w);
        if (i == 0) movedFirst = st.moved > 0.0f;
        if (st.moved == 0.0f) return i;
    }
    return -1;
}

// container.cpp's candidate rule, recomputed. The duplication is deliberate: if the
// room filter silently stops being applied, this expectation still holds and the
// assertion that compares it to the real crates dies.
inline int pool_size(ContainerKind kind, int floorZ, std::uint16_t roomMask) {
    const std::int32_t cap = kLootValueCap[economy_band(floorZ)] *
                             kContainerCapPct[static_cast<std::size_t>(kind)] / 100;
    int n = 0;
    for (ItemId id = 1; id <= kItemCount; ++id) {
        if (item_weight_on_floor(id, floorZ, roomMask) == 0) continue;
        const ItemDef& d = item_def(id);
        if (d.value > cap) continue;
        const auto cat = static_cast<ItemCategory>(d.category);
        if (kind == ContainerKind::WeaponCrate && cat != ItemCategory::Weapon &&
            cat != ItemCategory::Ammo)
            continue;
        if (kind == ContainerKind::PublicBox && cat != ItemCategory::Food &&
            cat != ItemCategory::Drink && cat != ItemCategory::Medicine &&
            cat != ItemCategory::Ammo)
            continue;
        ++n;
    }
    return n;
}

// mob_spawn.cpp's roster rule, recomputed for a floor that sits exactly ON one of the
// six habitat anchors — which is why every floor number used below is an anchor.
// `anchor_for_floor` is internal to mob_spawn.cpp and re-deriving its nearest-anchor
// search here would be testing this file's copy of it.
inline int mob_roster_size(FloorBit anchor, std::uint16_t roomMask) {
    int n = 0;
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];
        if ((m.floorMask & static_cast<std::uint8_t>(anchor)) == 0) continue;
        if (m.spawnWeightX10 == 0) continue;
        if (roomMask != 0 && (m.roomMask & roomMask) == 0) continue;
        ++n;
    }
    return n;
}

inline int cell_of(float world1d) {
    return wrap_macro(static_cast<int>(world1d / kCellSize));
}

} // namespace fluidrooms_detail

static void test_fluidrooms_all() {
    using namespace fluidrooms_detail;

    // -----------------------------------------------------------------------
    // 1. A dry kind allocates nothing, and stepping it costs nothing
    // -----------------------------------------------------------------------
    // This is the reason main.cpp can call fluid_step unconditionally. A 128^3 float
    // field is 8 MiB, and the old fluid_step created one with get_or_create the first
    // time it was called on any layer — so a Residential floor would have paid the
    // allocation plus a 2,097,152-cell sweep for guaranteed zeroes.
    {
        World res;
        generate_floor(res, 0, floor_spec(FloorKind::Residential), 1337u);
        CHECK(res.fields().find<float>(kFluidField) == nullptr);
        CHECK(floor_sump_cells(FloorKind::Residential) == 0);
        CHECK(floor_sump_cells(FloorKind::Commercial) == 0);

        const FluidStep st = fluid_step(res);
        CHECK(!st.present);
        CHECK(st.wetCells == 0);
        CHECK(st.moved == 0.0f);
        // ...and it must NOT have created the field on the way past.
        CHECK(res.fields().find<float>(kFluidField) == nullptr);
    }

    // -----------------------------------------------------------------------
    // 2. Fluid appears on Industrial and Derelict, moves, and settles
    // -----------------------------------------------------------------------
    for (FloorKind fk : {FloorKind::Industrial, FloorKind::Derelict}) {
        const std::uint32_t target = floor_sump_cells(fk);
        CHECK(target > 0);

        World w;
        generate_floor(w, -26, floor_spec(fk), 4242u);
        CHECK(w.fields().find<float>(kFluidField) != nullptr);

        // Seeded UNEVEN: every basin cell carries its share and the outfall cell carries
        // double, so the solver has a real gradient to resolve. A pre-levelled seed
        // would leave it nothing to do and this whole suite would pass with the fluid
        // sim still effectively unreached.
        const Wet seeded = wet_census(w);
        CHECK(seeded.cells == static_cast<int>(target));
        CHECK(seeded.mass > 0.0);
        CHECK(seeded.hi > seeded.lo * 1.9f);   // the outfall bump is there

        bool movedFirst = false;
        const int steps = settle(w, 400, movedFirst);
        CHECK(movedFirst);   // the sim actually moved liquid
        CHECK(steps >= 0);   // ...and then STOPPED, which an open puddle never does
        // Measured on this exact transfer rule: 27 steps for a 3x3 basin, 41 for a 5x5.
        // The bound is loose because the number is a property of viscosity and basin
        // size, not a contract; what IS a contract is that it terminates — every moving
        // step costs a 28.6 ms cube-pass rebuild.
        CHECK(steps > 0 && steps < 120);

        const Wet settled = wet_census(w);
        // MASS CONSERVED. The rule is mass-conserving and a kerbed basin cannot leak,
        // so not one drop may leave the floor.
        CHECK(settled.mass > seeded.mass * 0.9999);
        CHECK(settled.mass < seeded.mass * 1.0001);
        // CONTAINED: still exactly the basin cells, nothing outside one. An equality
        // rather than a bound, because the placement was simulated over 399 seeds x 8
        // floor numbers per kind and every basin was placed every time.
        CHECK(settled.cells == static_cast<int>(target));
        // LEVEL: the water is now flat to within 1.5%, which is the observable output of
        // the solver and the thing a pre-levelled seed could have faked.
        CHECK(settled.hi < settled.lo * 1.02f);
        CHECK(settled.hi > seeded.lo);   // and it rose off the seeded share
        // VISIBLE-STRENGTH, not a film: the settled level is 8x the render's 0.05 tint
        // threshold ([render/cube_pass.cpp]) and under the 0.5 capacity a half-solid
        // basin cell has, so the pool is drawn and is not overfull.
        const double level = settled.mass / static_cast<double>(settled.cells);
        CHECK(level > static_cast<double>(kFloorSumpLevel) * 0.99);
        CHECK(level < static_cast<double>(kFloorSumpLevel) * 1.01);
        CHECK(level > 0.05);
        CHECK(level < 0.5);

        // The basin cell is DRAWN, which is the half of "fluid appears" that the field
        // alone does not give: cube_pass skips any cell with an empty sub-mask, so a
        // puddle in air tints nothing. Half-solid means non-empty and not full — drawn,
        // tinted, and still holding liquid.
        int drawnWet = 0, wrongMask = 0;
        const float* wd = fluid_data(w);   // resolved once: 2,097,152 cells follow
        CHECK(wd != nullptr);
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    if (fluid_at(wd, x, y, z) < kFluidMinFlow) continue;
                    const SubMask& m = w.grid().mask(x, y, z);
                    // empty  -> the cube pass never emits it, so the liquid is invisible
                    // full   -> capacity_frac is 0, so it could not hold liquid at all
                    if (m.empty() || m.full()) ++wrongMask;
                    CHECK(z == 1);   // and the water stayed on the ground storey
                    ++drawnWet;
                }
        CHECK(wrongMask == 0);
        CHECK(drawnWet == static_cast<int>(target));

        // One more step on a settled floor moves nothing and reports the whole pool.
        const FluidStep quiet = fluid_step(w);
        CHECK(quiet.present);
        CHECK(quiet.moved == 0.0f);
        CHECK(quiet.wetCells == target);
    }

    // -----------------------------------------------------------------------
    // 3. A recycled World slot regenerates bit-for-bit — fluid included
    // -----------------------------------------------------------------------
    // generate_floor clears the GRID and nothing else, so the field survives a floor
    // ride. Without the wipe in seed_floor_sumps the puddles on a re-entered floor
    // would be wherever the previous tenant's last fluid_step left them, i.e. a
    // function of how long the player stood there, and the floor would stop being a
    // pure function of (seed, number, kind).
    {
        World a, b;
        generate_floor(a, -26, floor_spec(FloorKind::Derelict), 4242u);
        generate_floor(b, 7, floor_spec(FloorKind::Industrial), 99u);  // dirty it...
        for (int i = 0; i < 12; ++i) fluid_step(b);                    // ...and move it
        generate_floor(b, -26, floor_spec(FloorKind::Derelict), 4242u);

        const Field<float>* fa = a.fields().find<float>(kFluidField);
        const Field<float>* fb = b.fields().find<float>(kFluidField);
        CHECK(fa != nullptr && fb != nullptr);
        if (fa != nullptr && fb != nullptr) CHECK(fa->data() == fb->data());
        CHECK(a.grid().types() == b.grid().types());

        // And a DRY kind moving into a flooded slot leaves it dry.
        World c;
        generate_floor(c, -26, floor_spec(FloorKind::Derelict), 4242u);
        for (int i = 0; i < 12; ++i) fluid_step(c);
        generate_floor(c, 3, floor_spec(FloorKind::Residential), 5u);
        const Wet after = wet_census(c);
        CHECK(after.cells == 0);
        CHECK(after.mass == 0.0);
    }

    // -----------------------------------------------------------------------
    // 4. Nothing is spawned INTO the water
    // -----------------------------------------------------------------------
    // A basin is sealed by its kerb, so a crate or a monster placed there is unreachable
    // in both directions — visible loot that cannot be opened, and a monster that counts
    // against the floor's budget forever without ever being met.
    //
    // The half-solid basin cell means the air tests in container.cpp and mob_spawn.cpp
    // already refuse it on TYPE, so this asserts the PROPERTY and not the mechanism: it
    // is what fails if a later change seeds an open pool (plain air over a solid slab,
    // which passes every other placement test there is).
    {
        World w;
        generate_floor(w, -26, floor_spec(FloorKind::Derelict), 4242u);
        bool movedFirst = false;
        settle(w, 400, movedFirst);   // spread into the basins before testing placement

        Registry reg;
        const std::uint32_t made = spawn_floor_containers(
            reg, w, -26, FloorKind::Derelict, /*layer=*/0, /*seed=*/99u, /*cap=*/64);
        CHECK(made > 8);
        for (auto e : reg.view<const Container, const Transform>()) {
            const vec3& p = reg.get<const Transform>(e).pos;
            CHECK(fluid_at(w, cell_of(p.x), cell_of(p.y), 1) < kFluidMinFlow);
        }

        Registry mobReg;
        const std::uint8_t danger =
            danger_for_hostility(floor_spec(FloorKind::Derelict).hostility);
        const std::uint32_t heads =
            spawn_floor_mobs(mobReg, w, -26, danger, theme_for_kind(FloorKind::Derelict),
                             /*layer=*/0, /*seed=*/77u, /*cap=*/256,
                             FloorKind::Derelict);
        CHECK(heads > 0);
        for (auto e : mobReg.view<const MobRef, const Transform>()) {
            const vec3& p = mobReg.get<const Transform>(e).pos;
            CHECK(fluid_at(w, cell_of(p.x), cell_of(p.y), 1) < kFluidMinFlow);
        }
    }

    // -----------------------------------------------------------------------
    // 5. The taxonomy names every room, once, and varies
    // -----------------------------------------------------------------------
    {
        CHECK(floor_room_bit_index(0) == -1);
        for (int k = 0; k < static_cast<int>(FloorKind::Count); ++k) {
            const FloorKind fk = static_cast<FloorKind>(k);
            const int perAxis = kMacroDim / floor_room_stride(fk);
            bool seen[kFloorRoomBits] = {};
            int distinct = 0;
            for (int ry = 0; ry < perAxis; ++ry)
                for (int rx = 0; rx < perAxis; ++rx) {
                    const std::uint16_t m = floor_room_mask(fk, -26, rx, ry);
                    CHECK(m != 0);                       // never "no room"
                    CHECK((m & (m - 1)) == 0);           // exactly one bit: a room IS one
                    const int bi = floor_room_bit_index(m);
                    CHECK(bi >= 0 && bi < static_cast<int>(kFloorRoomBits));
                    if (bi >= 0 && !seen[bi]) {
                        seen[bi] = true;
                        ++distinct;
                    }
                }
            // Measured: 6 / 6 / 4 / 5 distinct bits for the four kinds, i.e. every bit
            // its row authors appears on every floor tested. 4 is the floor because
            // Industrial's row only names four.
            CHECK(distinct >= 4);
        }
        // Pure in its inputs, and the floor LABEL is one of them: 200 of a Residential
        // floor's 256 rooms change identity between floor -26 and floor -25, so two
        // floors of one kind are not the same building twice.
        CHECK(floor_room_mask(FloorKind::Derelict, -26, 3, 5) ==
              floor_room_mask(FloorKind::Derelict, -26, 3, 5));
        int changed = 0;
        for (int ry = 0; ry < 16; ++ry)
            for (int rx = 0; rx < 16; ++rx)
                if (floor_room_mask(FloorKind::Residential, -26, rx, ry) !=
                    floor_room_mask(FloorKind::Residential, -25, rx, ry))
                    ++changed;
        CHECK(changed > 100);
    }

    // -----------------------------------------------------------------------
    // 6. Containers: the room FILTERS, and never empties a crate
    // -----------------------------------------------------------------------
    {
        // The fallback is REQUIRED, at data level, before any floor is generated. This
        // pair cannot flake on a hash: a public box is documented as a corridor-and-lobby
        // fixture ([container.h]) and a corridor has zero legal public-box items at every
        // depth, because none of Corridor's 11 authored item rows is food, drink or
        // medicine. A strict filter would empty the one placement the kind exists for.
        CHECK(pool_size(ContainerKind::PublicBox, 0,
                        static_cast<std::uint16_t>(RoomBit::Corridor)) == 0);
        CHECK(pool_size(ContainerKind::PublicBox, -50,
                        static_cast<std::uint16_t>(RoomBit::Corridor)) == 0);
        CHECK(pool_size(ContainerKind::WeaponCrate, -50,
                        static_cast<std::uint16_t>(RoomBit::Bathroom)) == 0);
        CHECK(pool_size(ContainerKind::PublicBox, 0, 0) > 0);
        CHECK(pool_size(ContainerKind::WeaponCrate, -50, 0) > 0);

        int constrained = 0, empties = 0, crates = 0, fellBack = 0;
        for (FloorKind fk : {FloorKind::Residential, FloorKind::Commercial,
                             FloorKind::Industrial, FloorKind::Derelict}) {
            for (int fz : {0, -8, -26, -50, 30}) {
                World w;
                generate_floor(w, fz, floor_spec(fk), 11u);
                Registry reg;
                const std::uint32_t n = spawn_floor_containers(
                    reg, w, fz, fk, /*layer=*/0, /*seed=*/5u, /*cap=*/64);
                CHECK(n >= 8);
                const int stride = floor_room_stride(fk);
                const int perAxis = kMacroDim / stride;

                for (auto e : reg.view<const Container, const Transform>()) {
                    const Container& c = reg.get<const Container>(e);
                    const vec3& p = reg.get<const Transform>(e).pos;
                    const int rx = cell_of(p.x) / stride;
                    const int ry = cell_of(p.y) / stride;
                    CHECK(rx < perAxis && ry < perAxis);
                    const std::uint16_t m = floor_room_mask(fk, fz, rx, ry);
                    const auto ck = static_cast<ContainerKind>(c.kind);
                    const bool fallback = pool_size(ck, fz, m) == 0;
                    if (fallback) ++fellBack;
                    ++crates;

                    int held = 0;
                    for (int i = 0; i < kContainerSlots; ++i) {
                        if (!item_valid(c.item[i]) || c.count[i] == 0) continue;
                        ++held;
                        const ItemDef& d = item_def(c.item[i]);
                        // A weapon crate's first slot is AMMO, chosen outside the
                        // weighted pool because all 17 ammo rows carry spawn weight 0 —
                        // and, being unspawnable, none authors a room either. So ammo is
                        // exempt from the room test by data, not by convenience.
                        if (static_cast<ItemCategory>(d.category) == ItemCategory::Ammo)
                            continue;
                        if (!fallback) {
                            CHECK((d.roomMask & m) != 0);
                            ++constrained;
                        }
                    }
                    // THE assertion. `roll_in_room` falls back to the floor's whole
                    // table when a room has nothing to offer this container kind, so a
                    // room whose taxonomy matches nothing yields an ordinary crate
                    // rather than an empty box.
                    CHECK(held > 0);
                    if (held == 0) ++empties;
                }
            }
        }
        CHECK(crates > 200);        // the sample is real
        CHECK(empties == 0);        // no room was emptied by its own taxonomy
        CHECK(constrained > 100);   // and the filter is not vacuous
        CHECK(fellBack > 0);        // the fallback path is REACHED, not just present
    }

    // -----------------------------------------------------------------------
    // 7. Mobs: the room filters the roster, and an empty roster falls back
    // -----------------------------------------------------------------------
    // Floor -50 with the Residential mix, and every part of that choice is load-bearing.
    // -50 sits exactly on the ZMinus50 anchor, so the roster is computable here without
    // copying anchor_for_floor. The Residential row authors Kitchen and Bathroom, and
    // measured over data/mobs.csv BOTH have an empty roster at that anchor — 0 of 16
    // rows. And a Residential floor has no rubble and no slab holes, so an anchor cell
    // is always found: the head count cannot fall short for a geometric reason, which
    // makes `spawned == budget` a clean test of the fallback alone.
    {
        const FloorKind fk = FloorKind::Residential;
        World w;
        generate_floor(w, -50, floor_spec(fk), 3u);
        const std::uint8_t danger = danger_for_hostility(floor_spec(fk).hostility);
        const FloorTheme theme = theme_for_kind(fk);
        const std::uint32_t cap = 512;
        const std::uint32_t budget =
            static_cast<std::uint32_t>(mob_count_for_floor(-50, danger, theme));
        const std::uint32_t want = budget < cap ? budget : cap;
        CHECK(want > 0);

        const int stride = floor_room_stride(fk);
        const int perAxis = kMacroDim / stride;

        // The fallback is reached on this floor, not merely available.
        int emptyRooms = 0;
        for (int ry = 0; ry < perAxis; ++ry)
            for (int rx = 0; rx < perAxis; ++rx)
                if (mob_roster_size(FloorBit::ZMinus50,
                                    floor_room_mask(fk, -50, rx, ry)) == 0)
                    ++emptyRooms;
        CHECK(emptyRooms > 0);
        CHECK(mob_roster_size(FloorBit::ZMinus50, 0) > 0);  // the fallback is non-empty

        Registry reg;
        const std::uint32_t n = spawn_floor_mobs(reg, w, -50, danger, theme,
                                                 /*layer=*/0, /*seed=*/77u, cap, fk);
        // NOT "n > 0". Every pack iteration places at least its anchor head and the last
        // pack is truncated to fit, so the budget is reachable exactly — and a dropped
        // pack (which is what a missing fallback does to a bathroom) shows up here as a
        // shortfall and nowhere else.
        CHECK(n == want);

        int filtered = 0;
        for (auto e : reg.view<const MobRef, const Transform>()) {
            const vec3& p = reg.get<const Transform>(e).pos;
            const std::uint16_t m = floor_room_mask(fk, -50, cell_of(p.x) / stride,
                                                    cell_of(p.y) / stride);
            if (mob_roster_size(FloorBit::ZMinus50, m) == 0) continue;  // fell back
            const std::uint8_t kindId = reg.get<const MobRef>(e).kind;
            CHECK((kMobTable[kindId].roomMask & m) != 0);
            ++filtered;
        }
        CHECK(filtered > 0);   // MobDef::roomMask finally has a reader with teeth
    }
}
