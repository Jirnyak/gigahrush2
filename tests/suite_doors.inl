// Doors ([game/door.h]) — geometry agreement, the bake premise, and the monster
// reaction measured against the mob table's own numbers.
//
// The two tests that matter most are not the obvious ones:
//
//   * `doors_leave_solidity_untouched` is the whole architectural argument in one
//     assertion. `door_build` recolours cells but must not change a single
//     sub-voxel bit, because the nav bake is 3.7 s / 128 MiB and reads only
//     solidity. If that ever regresses, every floor's flow fields are baked from
//     geometry the player is about to change and nothing else in the tree would
//     say so.
//   * `doorways_match_the_generated_grid` pins floor_doorways() against
//     generate_floor()'s actual output. They share a walk and a hash today; this is
//     what catches the day somebody re-introduces a private copy of either.
//
// A .inl and not a .cpp for the reason the other suites give: game_test.cpp owns
// the CHECK macro, so the include has to land after it. It carries its own include
// of the system under test so game_test.cpp's diff stays two lines.

#include "core/tick.h"   // giga::kSimDt - never hardcode the tick, it has moved once
#include "game/door.h"

// SubMask has no operator==, so the solidity comparison is explicit. Word-wise and
// not memcmp: the words ARE the occupancy, and a struct-padding difference would
// make memcmp report a change that physics cannot see.
static bool masks_identical(const std::vector<SubMask>& a,
                            const std::vector<SubMask>& b) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i)
        for (std::size_t w = 0; w < kSubMaskWords; ++w)
            if (a[i].words[w] != b[i].words[w]) return false;
    return true;
}

// A ground-storey door in an X-crossing wall, kept away from cell 0 on both axes.
//
// The "away from 0" part is not fussiness, it cost a red test: the first such door
// on a Residential floor sits at cx == 0, so `leaf.x - 2 cells` is -3.0 m, physics
// wraps the body to x = 253, and it was then correctly blocked at 255.6 — which no
// plain `blockedX < leaf.x` comparison can recognise. Picking an interior door keeps
// the arithmetic in one image so the assertions can stay readable; the toroidal
// versions are below where they still matter.
static std::uint32_t pick_ground_door(const DoorSet& doors, std::uint32_t skipA,
                                      std::uint32_t skipB, std::uint32_t skipC) {
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i) {
        const Door& d = doors.doors[i];
        if (i == skipA || i == skipB || i == skipC) continue;
        // The module's ground storey ([floor_gen.h] floor_ground_z), not a
        // literal 1 — that was the purged generic lattice's shape.
        if (d.cz != floor_ground_z() || d.axis != 0) continue;
        if (d.cx < 4 || d.cx > 120 || d.cy < 4 || d.cy > 120) continue;
        return i;
    }
    return kNoDoor;
}

// A doorway the generator reports must actually be an opening in the grid it
// generated, and the count must be what the geometry profile predicts.
static void test_doorways_match_the_generated_grid() {
    World w;
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    generate_floor(w, /*number=*/0, res, /*seed=*/909u);

    std::vector<Doorway> ways;
    const std::uint32_t n = floor_doorways(0, res, 909u, ways);
    CHECK(n == ways.size());

    // Geometry is the module's business — no per-kind count formula survives the
    // generic lattice's purge. The floor must still ship a real door population.
    CHECK(n > 0);

    // Every reported cell is air in the grid the same arguments generated. The
    // lattice lobbies carve through wall lines, so some openings are wider than the
    // generator made them — air either way, which is what this checks.
    std::uint32_t airOk = 0;
    for (const Doorway& d : ways) {
        bool allAir = true;
        for (int z = d.cz; z < d.cz + d.h; ++z)
            if (w.grid().cell(d.cx, d.cy, z) != kCellAir) allAir = false;
        if (allAir) ++airOk;
    }
    // >= 99%, not 100%: the module runs later passes over its own plan — the
    // elevator lattice's corner posts and stair/water kerbs can land on a
    // handful of planned openings (measured 84 of 15246). door_build is the
    // validation gate that drops exactly those; a real seed mismatch fails this
    // by a mile (the old two-seed bug kept ~5%).
    CHECK(airOk * 100u >= n * 99u);

    // Pure in (number, spec, seed), and the number is mixed in.
    std::vector<Doorway> again, other;
    floor_doorways(0, res, 909u, again);
    floor_doorways(1, res, 909u, other);
    CHECK(again.size() == ways.size());
    bool identical = true;
    for (std::size_t i = 0; i < ways.size(); ++i)
        if (again[i].cx != ways[i].cx || again[i].cy != ways[i].cy ||
            again[i].cz != ways[i].cz)
            identical = false;
    CHECK(identical);
    bool differs = false;
    for (std::size_t i = 0; i < ways.size() && i < other.size(); ++i)
        if (other[i].cx != ways[i].cx || other[i].cy != ways[i].cy)
            differs = true;
    CHECK(differs);

    // A pillar-mode kind has no wall segments to open, so it reports none.
    // (Removed because Industrial is no longer a pillar-mode floor)
}

// door_build recolours and indexes; it must not move one sub-voxel bit.
static void test_doors_leave_solidity_untouched() {
    World w;
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    generate_floor(w, /*number=*/2, res, /*seed=*/31337u);
    const std::vector<SubMask> before = w.grid().masks();
    const std::vector<CellType> typesBefore = w.grid().types();

    DoorSet doors;
    const std::uint32_t n = door_build(w, doors, 2, res, 31337u);
    CHECK(n > 0);
    CHECK(doors.shut == 0);      // built OPEN: the geometry the nav bake must see
    CHECK(doors.broken == 0);

    // The invariant the bake depends on.
    CHECK(masks_identical(w.grid().masks(), before));
    // ...and the frames DID change something, or the material work is a no-op.
    CHECK(w.grid().types() != typesBefore);

    std::uint32_t frames = 0;
    for (CellType t : w.grid().types())
        if (t == kMatDoor) ++frames;
    CHECK(frames >= n * 2u);     // at least two jambs per door

    // Every door: leaf air, both jambs painted, state Open, full HP, indexed.
    bool leafAir = true, jambsPainted = true, indexed = true, fresh = true;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i) {
        const Door& d = doors.doors[i];
        const int jx = d.axis == 0 ? 0 : 1;
        const int jy = d.axis == 0 ? 1 : 0;
        if (d.state != static_cast<std::uint8_t>(DoorState::Open)) fresh = false;
        if (d.hp != kDoorHp) fresh = false;
        for (int z = d.cz; z < d.cz + d.h; ++z) {
            if (w.grid().cell(d.cx, d.cy, z) != kCellAir) leafAir = false;
            if (w.grid().cell(d.cx - jx, d.cy - jy, z) != kMatDoor)
                jambsPainted = false;
            if (w.grid().cell(d.cx + jx, d.cy + jy, z) != kMatDoor)
                jambsPainted = false;
            if (doors.at(d.cx, d.cy, z) != i) indexed = false;
        }
    }
    CHECK(leafAir);
    CHECK(jambsPainted);
    CHECK(indexed);
    CHECK(fresh);

    // Rebuilding over a used set must not inherit the old ids or counts.
    DoorSet reused = DoorSet{};
    door_build(w, reused, 2, res, 31337u);
    reused.doors[0].state = static_cast<std::uint8_t>(DoorState::Broken);
    const std::uint32_t n2 = door_build(w, reused, 2, res, 31337u);
    CHECK(n2 == n);
    CHECK(reused.doors[0].state == static_cast<std::uint8_t>(DoorState::Open));

    // door_build is a GRID-VALIDATION gate: it may only keep doorways whose
    // opening and jambs survive in the built geometry (lattice lobbies can eat
    // a jamb), never invent one.
    World dw;
    DoorSet dd;
    const FloorSpec& der = floor_spec(FloorKind::Derelict);
    generate_floor(dw, 3, der, 31337u);
    std::vector<Doorway> derWays;
    const std::uint32_t derN = floor_doorways(3, der, 31337u, derWays);
    const std::uint32_t derDoors = door_build(dw, dd, 3, der, 31337u);
    CHECK(derDoors > 0);
    CHECK(derDoors <= derN);
}

// Shut means SOLID TO MOVEMENT, tested through the physics the game actually uses.
static void test_shut_door_blocks_a_body() {
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    World& w = stack.layer(layer);
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    generate_floor(w, 0, res, 5150u);
    DoorSet doors;
    CHECK(door_build(w, doors, 0, res, 5150u) > 0);

    // A door on the ground storey, in a wall line crossed by moving along X.
    const std::uint32_t pick = pick_ground_door(doors, kNoDoor, kNoDoor, kNoDoor);
    CHECK(pick != kNoDoor);
    const Door probe = doors.doors[pick];
    const vec3 leaf{(static_cast<float>(probe.cx) + 0.5f) * kCellSize,
                    (static_cast<float>(probe.cy) + 0.5f) * kCellSize,
                    (static_cast<float>(probe.cz) + 0.5f) * kCellSize};
    const vec3 half{0.4f, 0.4f, 0.4f};

    Registry reg;
    CHECK(!aabb_overlaps_solid(w, leaf, half));            // open: walkable
    CHECK(doors.dirtyCells.empty());                       // nothing published yet
    CHECK(door_set(w, doors, reg, layer, pick, true));
    CHECK(doors.shut == 1);
    CHECK(aabb_overlaps_solid(w, leaf, half));             // shut: solid
    // The mask-edit handoff seam ([door.h] dirtyCells): shutting published one
    // entry per leaf cell — the same contract carve keeps with its consumers.
    CHECK(doors.dirtyCells.size() == static_cast<std::size_t>(probe.h));
    CHECK(doors.dirtyCells[0] ==
          macro_index(wrap_macro(probe.cx), wrap_macro(probe.cy),
                      wrap_macro(probe.cz)));
    doors.dirtyCells.clear();                              // the app's drain
    CHECK(!door_set(w, doors, reg, layer, pick, true));    // already shut
    CHECK(doors.dirtyCells.empty());                       // a refusal publishes nothing

    // Walk a body at the shut leaf and let physics resolve it: it must not cross.
    Entity body = reg.create();
    const float startX = leaf.x - 2.0f * kCellSize;
    reg.emplace<Transform>(body, Transform{vec3{startX, leaf.y, leaf.z}, layer});
    reg.emplace<Velocity>(body, Velocity{vec3{4.0f, 0.0f, 0.0f}});
    reg.emplace<AABB>(body, AABB{half});
    for (int i = 0; i < 240; ++i) {
        reg.get<Velocity>(body).v = vec3{4.0f, 0.0f, 0.0f};
        physics_step(reg, stack, giga::kSimDt);
    }
    const float blockedX = reg.get<Transform>(body).pos.x;
    CHECK(blockedX < leaf.x - 0.5f * kCellSize);   // stopped short of the leaf

    // Open it and the same walk goes through.
    CHECK(door_set(w, doors, reg, layer, pick, false));
    CHECK(doors.shut == 0);
    CHECK(doors.dirtyCells.size() == static_cast<std::size_t>(probe.h));
    doors.dirtyCells.clear();
    CHECK(!aabb_overlaps_solid(w, leaf, half));
    for (int i = 0; i < 240; ++i) {
        reg.get<Velocity>(body).v = vec3{4.0f, 0.0f, 0.0f};
        physics_step(reg, stack, giga::kSimDt);
    }
    CHECK(reg.get<Transform>(body).pos.x > leaf.x + 0.25f * kCellSize);

    // With a body standing in the doorway the shut is REFUSED. physics backs a
    // sweep out of an overlap; a body already inside solid has nowhere to back to,
    // so this is a soft-lock guard and not politeness.
    reg.get<Transform>(body).pos = leaf;
    CHECK(!door_set(w, doors, reg, layer, pick, true));
    CHECK(doors.shut == 0);

    // Frozen (a nav bake is reading the grid on a worker) refuses every mutator.
    reg.get<Transform>(body).pos = vec3{startX, leaf.y, leaf.z};
    doors.frozen = true;
    CHECK(!door_set(w, doors, reg, layer, pick, true));
    CHECK(door_toggle_near(w, doors, reg, layer, leaf) == kNoDoor);
    doors.frozen = false;

    // Toggle by proximity: standing in the doorway is in reach; a room away is not.
    const std::uint32_t hit =
        door_toggle_near(w, doors, reg, layer,
                         vec3{leaf.x - kCellSize, leaf.y, leaf.z});
    CHECK(hit == pick);
    CHECK(doors.doors[pick].state == static_cast<std::uint8_t>(DoorState::Shut));
    CHECK(door_toggle_near(w, doors, reg, layer,
                          vec3{leaf.x + 6.0f * kCellSize, leaf.y, leaf.z}) ==
          kNoDoor);
    // ...and toggling again re-opens the same door.
    CHECK(door_toggle_near(w, doors, reg, layer,
                           vec3{leaf.x - kCellSize, leaf.y, leaf.z}) == pick);
    CHECK(doors.doors[pick].state == static_cast<std::uint8_t>(DoorState::Open));
}

// What a shut door does to a monster, and the numbers come off the mob table.
static void test_shut_door_versus_monsters() {
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    World& w = stack.layer(layer);
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    generate_floor(w, 0, res, 4242u);
    DoorSet doors;
    CHECK(door_build(w, doors, 0, res, 4242u) > 0);

    std::uint32_t pick = kNoDoor;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (doors.doors[i].cz == floor_ground_z() && doors.doors[i].axis == 0) {
            pick = i;
            break;
        }
    CHECK(pick != kNoDoor);
    const Door probe = doors.doors[pick];

    // One cell to the +X side of the leaf: room interior, cardinally adjacent.
    const vec3 beside{(static_cast<float>(probe.cx) + 1.5f) * kCellSize,
                      (static_cast<float>(probe.cy) + 0.5f) * kCellSize,
                      (static_cast<float>(probe.cz) + 0.5f) * kCellSize};

    Registry reg;
    const float dt = giga::kSimDt;

    // --- a monster with an attack BREAKS it, in the time its row predicts -----
    CHECK(door_set(w, doors, reg, layer, pick, true));
    Entity mob = reg.create();
    reg.emplace<Transform>(mob, Transform{beside, layer});
    reg.emplace<Velocity>(mob, Velocity{});
    const auto kind = MobKind::Nightmare;
    const MobDef& md = mob_def(kind);
    CHECK(md.dmg > 0 && md.attackCdMs > 0);
    reg.emplace<MobRef>(mob, MobRef{static_cast<std::uint8_t>(kind), 1,
                                    static_cast<std::int16_t>(md.hp),
                                    static_cast<std::int16_t>(md.hp)});

    const float dps =
        static_cast<float>(md.dmg) * 1000.0f / static_cast<float>(md.attackCdMs);
    const int expectTicks =
        static_cast<int>(static_cast<float>(kDoorHp) / dps / dt);
    int ticks = 0;
    std::uint8_t breaker = 0xFF;
    for (; ticks < expectTicks * 3 + 60; ++ticks) {
        const DoorTick t = door_step(reg, w, doors, layer, dt,
                                     static_cast<std::uint64_t>(ticks));
        if (t.broken) { breaker = t.lastKind; break; }
        CHECK(t.pressing == 1);
    }
    CHECK(breaker == static_cast<std::uint8_t>(kind));
    // Within 2% of the table's own dmg/cd, so this measures the rate rather than
    // just that it eventually falls over.
    CHECK(ticks > expectTicks - expectTicks / 50 - 2);
    CHECK(ticks < expectTicks + expectTicks / 50 + 2);
    CHECK(doors.broken == 1);
    CHECK(doors.shut == 0);
    CHECK(doors.doors[pick].state == static_cast<std::uint8_t>(DoorState::Broken));
    // A broken door is air forever, and refuses to be shut again.
    for (int z = probe.cz; z < probe.cz + probe.h; ++z)
        CHECK(w.grid().cell(probe.cx, probe.cy, z) == kCellAir);
    CHECK(!door_set(w, doors, reg, layer, pick, true));
    reg.destroy(mob);

    // --- a second door: the kind with dmg 0 PUSHES it open instead ------------
    // This is the branch that makes a permanent jam impossible. Paupsina has dmg 0
    // in data/mobs.csv, so no amount of chipping would ever get it through.
    std::uint32_t pick2 = kNoDoor;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (i != pick && doors.doors[i].cz == floor_ground_z() &&
            doors.doors[i].axis == 0) {
            pick2 = i;
            break;
        }
    CHECK(pick2 != kNoDoor);
    const Door probe2 = doors.doors[pick2];
    const vec3 beside2{(static_cast<float>(probe2.cx) + 1.5f) * kCellSize,
                       (static_cast<float>(probe2.cy) + 0.5f) * kCellSize,
                       (static_cast<float>(probe2.cz) + 0.5f) * kCellSize};
    CHECK(door_set(w, doors, reg, layer, pick2, true));
    CHECK(mob_def(MobKind::Paupsina).dmg == 0);
    Entity harmless = reg.create();
    reg.emplace<Transform>(harmless, Transform{beside2, layer});
    reg.emplace<Velocity>(harmless, Velocity{});
    reg.emplace<MobRef>(harmless,
                        MobRef{static_cast<std::uint8_t>(MobKind::Paupsina), 1,
                               10, 10});
    int pushTicks = 0;
    for (; pushTicks < 600; ++pushTicks) {
        const DoorTick t = door_step(reg, w, doors, layer, dt,
                                     static_cast<std::uint64_t>(pushTicks));
        if (t.opened) break;
    }
    CHECK(pushTicks < 600);
    CHECK(doors.doors[pick2].state == static_cast<std::uint8_t>(DoorState::Open));
    CHECK(doors.doors[pick2].hp == kDoorHp);     // pushed, never damaged
    CHECK(doors.broken == 1);                    // still just the one
    // ~kDoorForceMs of contact, in ticks.
    CHECK(pushTicks > static_cast<int>(kDoorForceMs) / 10 - 20);
    CHECK(pushTicks < static_cast<int>(kDoorForceMs) / 10 + 40);
    reg.destroy(harmless);

    // --- a resident pushes it open too; the camera holder does not ------------
    std::uint32_t pick3 = kNoDoor;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (i != pick && i != pick2 && doors.doors[i].cz == floor_ground_z() &&
            doors.doors[i].axis == 0) {
            pick3 = i;
            break;
        }
    CHECK(pick3 != kNoDoor);
    const Door probe3 = doors.doors[pick3];
    const vec3 beside3{(static_cast<float>(probe3.cx) + 1.5f) * kCellSize,
                       (static_cast<float>(probe3.cy) + 0.5f) * kCellSize,
                       (static_cast<float>(probe3.cz) + 0.5f) * kCellSize};
    CHECK(door_set(w, doors, reg, layer, pick3, true));

    // The player leans on it for four seconds: nothing happens. Doors are worked
    // with a keypress, so a shut door the player is standing next to stays shut.
    Entity playerish = reg.create();
    reg.emplace<Transform>(playerish, Transform{beside3, layer});
    reg.emplace<Velocity>(playerish, Velocity{});
    reg.emplace<CameraTag>(playerish, CameraTag{});
    for (int i = 0; i < 480; ++i) {
        const DoorTick t =
            door_step(reg, w, doors, layer, dt, static_cast<std::uint64_t>(i));
        CHECK(t.opened == 0 && t.broken == 0 && t.pressing == 0);
    }
    CHECK(doors.doors[pick3].state == static_cast<std::uint8_t>(DoorState::Shut));

    // A resident standing beside the same door does get through.
    Entity resident = reg.create();
    reg.emplace<Transform>(resident, Transform{beside3, layer});
    reg.emplace<Velocity>(resident, Velocity{});
    int resTicks = 0;
    for (; resTicks < 600; ++resTicks)
        if (door_step(reg, w, doors, layer, dt,
                      static_cast<std::uint64_t>(resTicks))
                .opened)
            break;
    CHECK(resTicks < 600);
    CHECK(doors.doors[pick3].state == static_cast<std::uint8_t>(DoorState::Open));

    // Pressing must be CONTINUOUS: a gap of more than one tick resets the shove.
    // Otherwise a corridor's foot traffic would pop every door it ever passed.
    std::uint32_t pick4 = kNoDoor;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (i != pick && i != pick2 && i != pick3 &&
            doors.doors[i].cz == floor_ground_z() &&
            doors.doors[i].axis == 0) {
            pick4 = i;
            break;
        }
    CHECK(pick4 != kNoDoor);
    const Door probe4 = doors.doors[pick4];
    reg.get<Transform>(resident).pos =
        vec3{(static_cast<float>(probe4.cx) + 1.5f) * kCellSize,
             (static_cast<float>(probe4.cy) + 0.5f) * kCellSize,
             (static_cast<float>(probe4.cz) + 0.5f) * kCellSize};
    CHECK(door_set(w, doors, reg, layer, pick4, true));
    for (int i = 0; i < 4000; i += 4)   // touched once every 4 ticks: never enough
        CHECK(door_step(reg, w, doors, layer, dt,
                        static_cast<std::uint64_t>(i))
                  .opened == 0);
    CHECK(doors.doors[pick4].state == static_cast<std::uint8_t>(DoorState::Shut));

    // The no-shut-doors fast path really is free: with nothing shut, door_step
    // reports nothing at all even with bodies standing in every doorway.
    CHECK(door_set(w, doors, reg, layer, pick4, false));
    CHECK(doors.shut == 0);
    const DoorTick idle = door_step(reg, w, doors, layer, dt, 9999u);
    CHECK(idle.pressing == 0 && idle.opened == 0 && idle.broken == 0);

    // --- LEVEL SCALES THE CHIPPING, and nothing saw that until 2026-08-12 ------
    // Every mob in every door case above is level 1, and `mob_hp_at_level` is the
    // IDENTITY at level 1 — so this suite was structurally blind to whether door
    // damage consulted the level at all. It did not: door.cpp read `md.dmg` straight
    // off the table while `mob_attack_step` scaled the same number on the HP curve,
    // so a level-11 monster hit a BODY for 2.2x and the DOOR beside that body for
    // 1.0x. A suite that only ever exercises the identity case cannot fail on a
    // missing multiplier, which is why this block picks a level far from 1.
    //
    // Placed last, and picking a door none of the cases above touched, so the
    // narrative order of this test is unchanged — an earlier draft inserted it after
    // the first break and silently stole the door the Paupsina case needs.
    // Four doors are already spoken for and pick_ground_door only takes three
    // skips, so the exclusion is spelled out here rather than by widening a helper
    // the rest of the file is happy with.
    std::uint32_t pickL = kNoDoor;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i)
        if (i != pick && i != pick2 && i != pick3 && i != pick4 &&
            doors.doors[i].cz == floor_ground_z() &&
            doors.doors[i].axis == 0) {
            pickL = i;
            break;
        }
    CHECK(pickL != kNoDoor);
    const Door probeL = doors.doors[pickL];
    CHECK(probeL.state != static_cast<std::uint8_t>(DoorState::Broken));
    Entity elite = reg.create();
    reg.emplace<Transform>(
        elite, Transform{vec3{(static_cast<float>(probeL.cx) + 1.5f) * kCellSize,
                              (static_cast<float>(probeL.cy) + 0.5f) * kCellSize,
                              (static_cast<float>(probeL.cz) + 0.5f) * kCellSize},
                         layer});
    reg.emplace<Velocity>(elite, Velocity{});
    constexpr std::uint8_t kElite = 11;
    reg.emplace<MobRef>(elite, MobRef{static_cast<std::uint8_t>(kind), kElite,
                                      static_cast<std::int16_t>(md.hp),
                                      static_cast<std::int16_t>(md.hp)});
    CHECK(door_set(w, doors, reg, layer, pickL, true));
    const float dpsL = static_cast<float>(mob_hp_at_level(md.dmg, kElite)) *
                       1000.0f / static_cast<float>(md.attackCdMs);
    const int expectL = static_cast<int>(static_cast<float>(kDoorHp) / dpsL / dt);
    int ticksL = 0;
    for (; ticksL < expectTicks * 3 + 60; ++ticksL)
        if (door_step(reg, w, doors, layer, dt,
                      static_cast<std::uint64_t>(ticksL))
                .broken)
            break;
    // The RATE, in the same 2% band the level-1 case above is held to.
    CHECK(ticksL > expectL - expectL / 50 - 2);
    CHECK(ticksL < expectL + expectL / 50 + 2);
    // And the property stated directly: an elite is STRICTLY faster than a level-1
    // of the same kind. mob_hp_at_level(x, 11) = 2.2x, so this is a wide margin and
    // not a coin flip on rounding.
    CHECK(ticksL < ticks);
    CHECK(static_cast<float>(ticks) / static_cast<float>(ticksL) > 2.0f);
    reg.destroy(elite);
}

// inventory_has_keycard: a keycard of the required tier (or better) grants
// access; no tier required always grants; a wrong/missing tier never does.
static void test_inventory_keycard() {
    {   // ---- no tier required: always true
        Inventory empty;
        empty.clear();
        CHECK(inventory_has_keycard(empty, 0));
        CHECK(inventory_has_keycard(empty, static_cast<std::uint8_t>(KeycardTier::None)));
    }
    {   // ---- tier 1 requested, empty inventory: denied
        Inventory empty;
        empty.clear();
        CHECK(!inventory_has_keycard(empty, 1));
        CHECK(!inventory_has_keycard(empty, static_cast<std::uint8_t>(KeycardTier::Red)));
    }
    // A card is any item whose row sits in the `Key` CATEGORY, and the tier the
    // door asks for is NOT compared against anything — one key opens every tier.
    // That is a real gap (the doors carry `keycardTier` and nothing honours it,
    // [problems.md] §10); these CHECKs pin what the code DOES so the day the gap
    // closes it fails here loudly instead of silently changing access rules.
    // The catalog is generated from data/items.csv, so resolve a real Key row by
    // CATEGORY rather than hardcoding an id that a content edit would move.
    ItemId keyId = kInvalidItem, plainId = kInvalidItem;
    for (std::size_t i = 1; i <= kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i);
        if (!item_valid(id)) continue;
        const bool isKey = item_def(id).category ==
                           static_cast<std::uint8_t>(ItemCategory::Key);
        if (isKey && keyId == kInvalidItem) keyId = id;
        if (!isKey && plainId == kInvalidItem) plainId = id;
    }
    CHECK(keyId != kInvalidItem);
    CHECK(plainId != kInvalidItem);
    {   // ---- one Key-category item satisfies every tier today
        Inventory inv;
        inv.clear();
        ItemSlot& s = inv.slots[0];
        s.item = keyId;
        s.count = 1;   // count 0 is an EMPTY slot, not a held item
        CHECK(inventory_has_keycard(inv, 1));
        CHECK(inventory_has_keycard(inv, 2));
        CHECK(inventory_has_keycard(inv, static_cast<std::uint8_t>(KeycardTier::Red)));
    }
    {   // ---- a card deep in the grid is still found; a non-key item is not one
        Inventory inv;
        inv.clear();
        inv.slots[7].item = keyId;
        inv.slots[7].count = 1;
        CHECK(inventory_has_keycard(inv, static_cast<std::uint8_t>(KeycardTier::Blue)));
        Inventory bread;
        bread.clear();
        bread.slots[0].item = plainId;
        bread.slots[0].count = 1;
        CHECK(!inventory_has_keycard(bread, 1));
    }
}

// door_query_near: nearest non-broken door within reach, or kNoDoor.
static void test_door_query_near() {
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    World& w = stack.layer(layer);
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    generate_floor(w, /*number=*/0, res, /*seed=*/909u);

    DoorSet doors;
    const std::uint32_t built = door_build(w, doors, /*number=*/0, res, layer);
    CHECK(built > 0);

    // Every built door lies on a wall segment; querying from far away yields none.
    const std::uint32_t far = door_query_near(doors, vec3{999.0f, 999.0f, 0.0f});
    CHECK(far == kNoDoor);

    // Querying from a door's own cell finds that door (nearest, zero-distance).
    bool foundSelf = false;
    for (std::uint32_t i = 0; i < doors.doors.size(); ++i) {
        const Door& d = doors.doors[i];
        if (d.state == static_cast<std::uint8_t>(DoorState::Broken)) continue;
        // CELLS ARE 2 m ([voxels.md] kCellSize): the probe must be built in
        // metres, or it lands half a world away and the query rightly misses.
        const vec3 at{(static_cast<float>(d.cx) + 0.5f) * kCellSize,
                      (static_cast<float>(d.cy) + 0.5f) * kCellSize,
                      (static_cast<float>(d.cz) +
                       static_cast<float>(d.h) * 0.5f) * kCellSize};
        const std::uint32_t hit = door_query_near(doors, at);
        if (hit != kNoDoor) { CHECK(hit == i); foundSelf = true; }
    }
    CHECK(foundSelf);

    // A door that breaks (hp -> 0) is no longer queryable.
    if (built > 1) {
        const std::uint32_t id0 = 0;
        Door& d0 = doors.doors[id0];
        d0.hp = 0;
        const Door& d0r = doors.doors[id0];
        const vec3 at{d0r.cx + 0.5f, d0r.cy + 0.5f, static_cast<float>(d0r.cz)};
        CHECK(door_query_near(doors, at) != id0);
    }
}

// door_shut_all + door_toggle_locks: shut every door, then toggle lock state.
static void test_door_shut_all_and_locks() {
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    World& w = stack.layer(layer);
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    generate_floor(w, /*number=*/0, res, /*seed=*/909u);

    DoorSet doors;
    const std::uint32_t built = door_build(w, doors, /*number=*/0, res, layer);
    CHECK(built > 0);

    Registry reg;
    // With nothing shut, toggle_locks shuts every door.
    CHECK(doors.shut == 0);
    const std::uint32_t toggled = door_toggle_locks(w, doors, reg, layer);
    CHECK(toggled > 0);
    CHECK(doors.shut > 0);

    // door_shut_all counts the doors it CHANGED, not the doors that are shut —
    // so on an already-shut floor it is a no-op that reports zero.
    const std::uint32_t shutNow = door_shut_all(w, doors, reg, layer);
    CHECK(shutNow == 0);
    CHECK(doors.shut > 0);

    // Toggling again (some shut) opens them back to the idle state.
    const std::uint32_t toggled2 = door_toggle_locks(w, doors, reg, layer);
    CHECK(toggled2 > 0);
    CHECK(doors.shut == 0);
}

static void test_doors_all() {
    test_doorways_match_the_generated_grid();
    test_doors_leave_solidity_untouched();
    test_shut_door_blocks_a_body();
    test_shut_door_versus_monsters();
    test_inventory_keycard();
    test_door_query_near();
    test_door_shut_all_and_locks();
}
