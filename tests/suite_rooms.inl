// Room zones — the suite for leg (b)+(c) of [problems.md] §27.
//
// THE PROPERTY THIS SUITE MEASURES is not "the bake wrote 2 MiB". It is the one the
// complaint names ([AGENTS.md] "Measure the thing the owner is looking at"): CAN A
// HUNGRY BODY GET TO A KITCHEN FROM WHERE IT IS STANDING. So the load-bearing block
// walks the flow field to termination from thousands of real cells on a real carved
// floor and prints the fraction that arrive. A field that stores bytes and routes
// nobody passes every other kind of test and fails this one.
//
//   Block 1 — the taxonomy read. Wall lines belong to no room; interior cells agree
//             with `floor_room_mask` cell for cell.
//   Block 2 — the bake is CONDITIONAL ON CONTENT. A Residential floor bakes
//             Kitchen/Bathroom/Living because its mix rolls them; an Industrial
//             floor bakes NOTHING, because its mix has none — and that is the
//             degradation path, not a failure.
//   Block 3 — DESCENT ARRIVES. Walk the flow from every 4th walkable cell of a
//             storey; every walk must terminate at a cell whose room bit is the one
//             asked for, inside a bounded step budget. Printed as a count.
//   Block 4 — the SEAT (the micro-goal). Interior, stable per identity, spread
//             across identities.
//   Block 6 — THE ERRAND, end to end through the driver, and this is the block
//             that answers §27's actual complaint. Starve 64 bodies, run `ai_step`
//             with the zones, integrate the Velocity it writes, and count how many
//             END UP STANDING IN A KITCHEN. `own_ai` and the arrival count are both
//             printed. Run the SAME loop with `rooms = nullptr` and every body must
//             stay wander-owned — which is what proves the win came from this leg
//             and not from something else moving.
//   Block 5 — RECOVERY, and the LOOP it closes. A kitchen second is +3.5 food and a
//             queued bowel; a bathroom second is -12 pee; a corridor second is
//             nothing. Then the loop itself: feed a body in a kitchen long enough
//             and the digestion it queued eventually makes IntentToilet outscore
//             IntentEat — kitchen -> bathroom emerges from two data rows.

void rooms_taxonomy_is_read_the_same_way() {
    const FloorKind kind = FloorKind::Residential;
    const int number = 0;
    const int stride = floor_room_stride(kind);
    CHECK(stride == 4);

    // A wall line belongs to no room, on either axis and on both.
    CHECK(room_bit_at(kind, number, 0, 5) == 0);
    CHECK(room_bit_at(kind, number, 5, 0) == 0);
    CHECK(room_bit_at(kind, number, 8, 12) == 0);

    // Interior cells agree with the generator's own taxonomy, cell for cell, and
    // every cell of one room reports the SAME bit (a room is not a gradient).
    int interior = 0;
    int agree = 0;
    for (int y = 0; y < 64; ++y) {
        for (int x = 0; x < 64; ++x) {
            if (x % stride == 0 || y % stride == 0) continue;
            ++interior;
            if (room_bit_at(kind, number, x, y) ==
                floor_room_mask(kind, number, x / stride, y / stride))
                ++agree;
        }
    }
    CHECK(interior == 48 * 48);
    CHECK(agree == interior);

    // Toroidal: the taxonomy wraps with the world, so cell 128 is cell 0.
    CHECK(room_bit_at(kind, number, 129, 129) == room_bit_at(kind, number, 1, 1));

    // The affordance table is the ONLY place an intent learns it has a destination.
    CHECK(intent_room_mask(IntentEat) == room_bit(RoomBit::Kitchen));
    CHECK(intent_room_mask(IntentDrink) == room_bit(RoomBit::Kitchen));
    CHECK(intent_room_mask(IntentToilet) == room_bit(RoomBit::Bathroom));
    CHECK(intent_room_mask(IntentSleep) == room_bit(RoomBit::Living));
    CHECK(intent_room_mask(IntentSocial) == room_bit(RoomBit::Common));
    CHECK(intent_room_mask(IntentWork) == room_bit(RoomBit::Production));
    // Intents with no row delegate, exactly as before rooms existed. Patrol and
    // Heal are here ON PURPOSE and must stay here until they have the thing that
    // makes a destination honest — a route for patrol, a heal bank for heal
    // ([room_zone.h] names both refusals beside the rows that were added).
    CHECK(intent_room_mask(IntentPatrol) == 0);
    CHECK(intent_room_mask(IntentHeal) == 0);
    CHECK(intent_room_mask(IntentWander) == 0);
    CHECK(intent_room_mask(IntentFlee) == 0);
    CHECK(kRoomFieldMask == (room_bit(RoomBit::Kitchen) |
                             room_bit(RoomBit::Bathroom) |
                             room_bit(RoomBit::Living) |
                             room_bit(RoomBit::Common) |
                             room_bit(RoomBit::Production)));

    // EVERY FloorKind must now bake at least one field. This is the assertion that
    // states the actual defect: the mask alone was never the problem, the mask
    // INTERSECTED WITH EACH FLOOR'S MIX was, and six of ten demo floors came out
    // empty. A future edit that narrows the mask back, or a mix that drops Common
    // and Production, fails here rather than silently turning the errand branch off
    // for a whole floor kind.
    // The mix is derived the way the bake derives it — by asking the lattice, not by
    // reading a table the test would then be pinning against itself.
    for (FloorKind fk : {FloorKind::Residential, FloorKind::Commercial,
                         FloorKind::Industrial, FloorKind::Derelict,
                         FloorKind::Padic}) {
        const int stride = floor_room_stride(fk);
        const int perAxis = kMacroDim / stride;
        std::uint16_t mix = 0;
        for (int ry = 0; ry < perAxis; ++ry)
            for (int rx = 0; rx < perAxis; ++rx)
                mix = static_cast<std::uint16_t>(mix | floor_room_mask(fk, 0, rx, ry));
        CHECK(mix != 0);
        CHECK((mix & kRoomFieldMask) != 0);
    }
}

void rooms_bake_follows_the_floor_mix() {
    World res;
    generate_floor(res, 0, floor_spec(FloorKind::Residential), 1337u);
    RoomZones zr;
    bake_room_zones(res.grid(), FloorKind::Residential, 0, zr);

    // The Residential mix rolls Living/Kitchen/Bathroom ([floor_gen.cpp]), so all
    // three fields exist and each is exactly one dense byte per macro cell.
    CHECK(zr.ready());
    CHECK((zr.baked & room_bit(RoomBit::Kitchen)) != 0);
    CHECK((zr.baked & room_bit(RoomBit::Bathroom)) != 0);
    CHECK((zr.baked & room_bit(RoomBit::Living)) != 0);
    const int ki = floor_room_bit_index(room_bit(RoomBit::Kitchen));
    CHECK(zr.flow[ki].size() == kMacroCells);
    CHECK(zr.nearRoom[ki].size() == 32u * 32u);
    // Bits no intent names are never baked, whatever the floor contains.
    CHECK(zr.flow[floor_room_bit_index(room_bit(RoomBit::Storage))].empty());
    std::printf("[rooms] residential floor 0: baked mask 0x%04X, %zu bytes\n",
                static_cast<unsigned>(zr.baked), zr.resident_bytes());

    // A COPY-PASTEABLE HANDLE FOR THE MANUAL CHECK, and it earns its place: nothing
    // in the world marks a kitchen, so "stand in one and watch the bar climb" is
    // otherwise a hunt. `main.cpp` applies `--pos X Y Z` to the PLAYER at floor-0
    // setup whether or not `--shot` is given, so these three numbers put a human
    // inside the room the AI is walking to. Printed for the two rooms that restore
    // the bars a player can actually see move.
    const RoomBit kShowRooms[] = {RoomBit::Kitchen, RoomBit::Bathroom,
                                  RoomBit::Living};
    const int showGround = floor_ground_z();
    for (RoomBit want : kShowRooms) {
        for (int y = 1; y < kMacroDim; ++y) {
            if (y % 4 == 0) continue;
            bool found = false;
            for (int x = 1; x < kMacroDim && !found; ++x) {
                if (x % 4 == 0) continue;
                if (room_bit_at(FloorKind::Residential, 0, x, y) != room_bit(want))
                    continue;
                if (!room_body_walkable(res.grid(), x, y, showGround)) continue;
                std::printf("[rooms] floor 0 %-8s at cell (%d,%d,%d)  ->  "
                            "--pos %.1f %.1f %.1f\n",
                            floor_room_bit_index(room_bit(want)) ==
                                    floor_room_bit_index(room_bit(RoomBit::Kitchen))
                                ? "KITCHEN"
                                : (want == RoomBit::Bathroom ? "BATHROOM" : "LIVING"),
                            x, y, showGround,
                            static_cast<double>((x + 0.5f) * kCellSize),
                            static_cast<double>((y + 0.5f) * kCellSize),
                            static_cast<double>((showGround + 0.5f) * kCellSize));
                found = true;
            }
            if (found) break;
        }
    }

    // An Industrial floor's mix is Production/Storage/Corridor/Smoking. Until
    // 2026-08-12 that meant NOTHING was baked and this block asserted exactly that —
    // `!ready()`, `baked == 0`, `resident_bytes() == 0`. Those four assertions were
    // green for as long as they existed and they were pinning the DEFECT: with
    // `kRoomFieldMask` limited to Kitchen|Bathroom|Living, six of the ten demo floors
    // baked nothing at all and `ai_step`'s errand branch was off, not degraded, on
    // every one of them. A test that spells the hole out in a comment and then
    // asserts it is the most durable way to keep it.
    //
    // `IntentWork -> Production` gives Industrial a field. What is asserted now is
    // the property that was actually wanted all along: a floor bakes the
    // intersection of its own mix with the affordance table, and that intersection
    // is NON-EMPTY for every kind.
    World ind;
    generate_floor(ind, 0, floor_spec(FloorKind::Industrial), 1337u);
    RoomZones zi;
    bake_room_zones(ind.grid(), FloorKind::Industrial, 0, zi);
    CHECK(zi.ready());
    CHECK(zi.baked == room_bit(RoomBit::Production));
    CHECK(zi.resident_bytes() != 0);
    // Still nothing reachable for an intent whose room this floor does not build —
    // and this now tests the real path rather than the empty one, because the zones
    // ARE baked and `room_route` has to reject on the mask instead of on `!ready()`.
    CHECK(room_route(zi, room_bit(RoomBit::Kitchen), 10, 10, 3).bit == 0);
    // And the Production field is genuinely routable, which is the half that says
    // the bake produced a FIELD and not just a non-zero mask. Sampled rather than
    // asserted at one cell: an arbitrary (cx, cy) may sit inside solid geometry,
    // where `kFlowNone` is the correct answer — the first version of this line
    // asserted cell (10,10) and failed for exactly that reason, which is the
    // "measure the property, not a proxy" rule biting on the test side.
    int routable = 0;
    for (int y = 0; y < kMacroDim && routable == 0; y += 4)
        for (int x = 0; x < kMacroDim && routable == 0; x += 4)
            if (room_route(zi, room_bit(RoomBit::Production), x, y, floor_ground_z())
                    .bit == room_bit(RoomBit::Production))
                ++routable;
    CHECK(routable != 0);

    // Re-baking a RECYCLED RoomZones must not inherit the previous floor's fields —
    // the stale-bake bug class [world/nav.h] documents for its own. `zr` is a
    // Residential bake (Kitchen|Bathroom|Living|Common); re-baked as Industrial it
    // must come back as EXACTLY Production, which is a stronger statement than the
    // old `== 0`: zero could be reached by clearing alone, this can only be reached
    // by clearing AND rebuilding.
    bake_room_zones(ind.grid(), FloorKind::Industrial, 0, zr);
    CHECK(zr.baked == room_bit(RoomBit::Production));
    CHECK((zr.baked & room_bit(RoomBit::Kitchen)) == 0);
    CHECK((zr.baked & room_bit(RoomBit::Common)) == 0);
}

void rooms_descent_actually_arrives() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    RoomZones z;
    bake_room_zones(w.grid(), FloorKind::Residential, 0, z);
    CHECK(z.ready());

    const std::uint16_t want = room_bit(RoomBit::Kitchen);
    const int ki = floor_room_bit_index(want);
    const int ground = floor_ground_z();

    // Walk the flow to termination from every 4th cell of the arrival storey. The
    // budget is generous but FINITE: a field with a cycle in it would spin forever,
    // and "it terminated" is half of what this block asserts.
    // SAMPLED OVER THE CELLS A BODY CAN STAND IN, not over the cells that are merely
    // "not fully solid". Sampling nav's looser population was the first version and
    // it graded the wrong thing: it counted cells no NPC could ever occupy as
    // routing failures ([room_zone.h] room_body_walkable).
    constexpr int kBudget = 512;
    int sampled = 0, arrived = 0, unreachable = 0, overBudget = 0;
    for (int y = 0; y < kMacroDim; y += 4) {
        for (int x = 0; x < kMacroDim; x += 4) {
            if (!room_body_walkable(w.grid(), x, y, ground)) continue;
            ++sampled;
            int cx = x, cy = y, cz = ground, steps = 0;
            std::uint8_t f = z.flow[ki][macro_index(cx, cy, cz)];
            if (f == nav::kFlowNone) { ++unreachable; continue; }
            while (f != nav::kFlowArrived && steps < kBudget) {
                cx = wrap_macro(cx + nav::kNavDir[f][0]);
                cy = wrap_macro(cy + nav::kNavDir[f][1]);
                cz = wrap_macro(cz + nav::kNavDir[f][2]);
                f = z.flow[ki][macro_index(cx, cy, cz)];
                ++steps;
            }
            if (f != nav::kFlowArrived) { ++overBudget; continue; }
            // ARRIVED means standing in a room of the kind asked for. This is the
            // whole point: the field is a route to a KITCHEN, not to a byte.
            CHECK(room_bit_at(FloorKind::Residential, 0, cx, cy) == want);
            ++arrived;
        }
    }
    std::printf("[rooms] kitchen descent: %d sampled, %d arrived, %d unreachable, "
                "%d over budget\n",
                sampled, arrived, unreachable, overBudget);
    CHECK(sampled > 0);
    CHECK(overBudget == 0);          // no cycles, and no route longer than 512 cells
    CHECK(arrived * 100 >= sampled * 95); // >=95% of the standable storey reaches one
    // The residual is real and is NOT a bug to chase to zero: a handful of cells sit
    // in pockets a body cannot leave (sealed rooms, and rims where the centred
    // footprint fits but no neighbour's does). What matters is that those bodies
    // report `errandLost` and delegate to wander instead of shoving — asserted in
    // the errand block, where `stalled` is zero.
    CHECK(unreachable * 20 <= sampled);

    // `room_route` composes the same answer and names the room it chose. A body
    // standing IN a kitchen is told it has arrived rather than sent to another one.
    int inKitchen = 0;
    for (int y = 1; y < kMacroDim && inKitchen == 0; ++y) {
        for (int x = 1; x < kMacroDim; ++x) {
            if (room_bit_at(FloorKind::Residential, 0, x, y) != want) continue;
            if (w.grid().mask(x, y, ground).full()) continue;
            const RoomRoute r = room_route(z, want, x, y, ground);
            CHECK(r.bit == want && r.dir == nav::kFlowArrived);
            ++inKitchen;
            break;
        }
    }
    CHECK(inKitchen == 1);

    // A mask naming a bit this floor DOES have and one it does not still routes by
    // the one it has — the mask is a set, not a single choice.
    const RoomRoute both = room_route(
        z, static_cast<std::uint16_t>(want | room_bit(RoomBit::Hq)), 5, 5, ground);
    CHECK(both.bit == want || both.bit == 0);
}

void rooms_seat_is_the_micro_goal() {
    const int stride = 4;
    const std::uint16_t kNoFurniture = room_bit(RoomBit::Storage);
    int ox = 0, oy = 0;

    // A slot is a POSITION in the interior, row-major, and both the furnisher and
    // the AI derive their answer from this one function — which is what stops them
    // from agreeing about the stove only by luck.
    room_slot_offset(0, stride, ox, oy);
    CHECK(ox == 1 && oy == 1);
    room_slot_offset(4, stride, ox, oy);
    CHECK(ox == 2 && oy == 2);
    room_slot_offset(8, stride, ox, oy);
    CHECK(ox == 3 && oy == 3);

    // --- a room kind with NO furniture: a free interior cell, as before ---------
    for (std::uint32_t id = 0; id < 256; ++id) {
        room_seat_offset(id, kNoFurniture, 3, 7, stride, ox, oy);
        CHECK(ox >= 1 && ox <= stride - 1);
        CHECK(oy >= 1 && oy <= stride - 1);
    }

    // Stable: the same body in the same room always gets the same seat, so it does
    // not shuffle between ticks. This is what lets the micro-goal be stateless.
    int ax = 0, ay = 0, bx = 0, by = 0;
    room_seat_offset(1234u, kNoFurniture, 5, 9, stride, ax, ay);
    room_seat_offset(1234u, kNoFurniture, 5, 9, stride, bx, by);
    CHECK(ax == bx && ay == by);

    // Different room, same body: a different seat is expected (you sit where you
    // are), and the whole point is that it needs no stored state to change.
    room_seat_offset(1234u, kNoFurniture, 6, 9, stride, bx, by);
    CHECK(bx >= 1 && by >= 1);

    // Spread: 256 bodies in one room must not stack on one cell. With 9 interior
    // cells a uniform hash puts ~28 on each; assert every cell is used at least
    // once, which a constant or a poorly mixed hash would fail.
    int used[16] = {};
    for (std::uint32_t id = 0; id < 256; ++id) {
        room_seat_offset(id, kNoFurniture, 2, 2, stride, ox, oy);
        ++used[(oy - 1) * (stride - 1) + (ox - 1)];
    }
    int distinct = 0;
    for (int i = 0; i < (stride - 1) * (stride - 1); ++i)
        if (used[i] > 0) ++distinct;
    CHECK(distinct == (stride - 1) * (stride - 1));

    // --- a FURNISHED room: the seat is a USE SPOT, never anywhere else ----------
    // This is the tie between the invisible decision and the visible object. A body
    // that walks to a kitchen must end up at the stove, not at a random tile that
    // happens to be in the same room — otherwise the furniture is scenery and the
    // errand is still unreadable.
    const struct { RoomBit room; std::uint16_t prop; } kUse[] = {
        {RoomBit::Kitchen, kPropKitchenStove},
        {RoomBit::Bathroom, kPropToiletPan},
        {RoomBit::Living, kPropBedCot},
    };
    for (const auto& u : kUse) {
        int hits = 0, distinctSpots = 0;
        int seen[16] = {};
        for (std::uint32_t id = 0; id < 256; ++id) {
            room_seat_offset(id, room_bit(u.room), 4, 4, stride, ox, oy);
            // Every seat must coincide with a `useSpot` row of THIS room kind.
            bool onFurniture = false;
            for (const RoomFurniture& f : kRoomFurniture) {
                if (f.room != room_bit(u.room) || !f.useSpot) continue;
                int fx = 0, fy = 0;
                room_slot_offset(f.slot, stride, fx, fy);
                if (fx == ox && fy == oy) onFurniture = true;
            }
            if (onFurniture) ++hits;
            ++seen[(oy - 1) * (stride - 1) + (ox - 1)];
        }
        for (int i = 0; i < 16; ++i)
            if (seen[i] > 0) ++distinctSpots;
        CHECK(hits == 256);
        // And a crowd SPREADS across them: a bathroom with two pans must not queue
        // nine residents onto one. Kitchens have a single use spot by design, so the
        // bar is "as many spots as the table declares", not "more than one".
        int declared = 0;
        for (const RoomFurniture& f : kRoomFurniture)
            if (f.room == room_bit(u.room) && f.useSpot) ++declared;
        CHECK(distinctSpots == declared);
    }
}

// Walk `n` starving bodies for `ticks` and report what the AI did with them. With
// `zones == nullptr` this is the pre-rooms pass, which is exactly why both arms run
// through ONE function: the only difference between them is the argument.
struct ErrandRun {
    std::uint32_t owned = 0;    // peak bodies the AI steered on any one tick
    std::uint32_t eating = 0;   // peak bodies committed to IntentEat
    std::uint32_t stalled = 0;  // peak errand bodies physics refused to move
    int inKitchen = 0;          // bodies standing in a kitchen at the end
    int bodies = 0;             // bodies that got a legal spawn
    float travelled = 0.0f;     // metres walked, summed
};
ErrandRun rooms_run_errand(LevelStack& stack, LayerId layer,
                           const RoomZones* zones, int ticks) {
    const World& w = stack.layer(layer);
    ErrandRun out;
    NpcPool pool;
    pool.init();
    Registry reg;

    constexpr std::uint32_t kBodies = 64;
    seed_floor_population(pool, /*floor=*/0, kBodies, /*seed=*/9u);
    const int ground = floor_ground_z();

    // Place every body on a walkable cell that is NOT already a kitchen, so
    // "ended in a kitchen" can only mean it walked there.
    std::vector<Entity> bodies;
    std::vector<vec3> start;
    int placed = 0;
    for (int y = 1; y < kMacroDim && placed < static_cast<int>(kBodies); ++y) {
        if (y % 4 == 0) continue;
        for (int x = 1; x < kMacroDim && placed < static_cast<int>(kBodies); ++x) {
            if (x % 4 == 0) continue;
            if (w.grid().mask(x, y, ground).full()) continue;
            if (room_bit_at(FloorKind::Residential, 0, x, y) ==
                room_bit(RoomBit::Kitchen))
                continue;
            const NpcId id = static_cast<NpcId>(placed);
            Entity e = embody(reg, pool, id, layer);
            if (e == entt::null) continue;
            Transform& tr = reg.get<Transform>(e);
            tr.pos = vec3{(static_cast<float>(x) + 0.5f) * kCellSize,
                          (static_cast<float>(y) + 0.5f) * kCellSize,
                          (static_cast<float>(ground) + 0.5f) * kCellSize};
            tr.layer = layer;
            // Refuse a spawn the collider cannot occupy. A body whose AABB starts
            // INSIDE geometry is refused motion on every axis by `sweep_axis`
            // forever, so seeding one would measure a physics failure and blame the
            // AI for it. The field's own clearance test is centred and this is the
            // real collider, so the two can disagree at a cell's rim.
            if (aabb_overlaps_solid(w, tr.pos, reg.get<AABB>(e).half)) {
                reg.destroy(e);
                continue;
            }
            // STARVING, and seeded — so the scorer reads this row instead of
            // substituting the constant identity roll ([ai.cpp] needs_for).
            Needs& n = pool.needs(id);
            n = needs_roll(giga::hash_u32(id + 1u));
            n.food = 2.0f;
            bodies.push_back(e);
            start.push_back(tr.pos);
            ++placed;
        }
    }
    ai_init(reg, layer);

    // THE REAL INTEGRATOR, not a hand-rolled one. An earlier revision of this block
    // advanced `pos += v * dt` with no collision and reported 64 of 64 bodies
    // arriving — while the live game had 62 of 63 errand bodies PINNED against
    // geometry, because a field that routes cell-to-cell through cells physics
    // refuses to enter passes a collision-free integrator perfectly. A harness that
    // cannot reproduce the shipping failure is a harness that certifies it
    // ([AGENTS.md] "a metric that passes while the screenshot fails is a BUG IN THE
    // METRIC").
    AiConfig cfg;
    cfg.enabled = true;
    for (int t = 0; t < ticks; ++t) {
        const AiTick a =
            ai_step(reg, pool, nullptr, w.grid(), layer,
                    static_cast<double>(t) * static_cast<double>(kSimDt), kSimDt,
                    cfg, nullptr, nullptr, nullptr, zones);
        if (a.aiOwned > out.owned) out.owned = a.aiOwned;
        if (a.byIntent[IntentEat] > out.eating) out.eating = a.byIntent[IntentEat];
        if (a.errandStalled > out.stalled) out.stalled = a.errandStalled;
        physics_step(reg, stack, kSimDt);
    }

    out.bodies = static_cast<int>(bodies.size());
    for (std::size_t i = 0; i < bodies.size(); ++i) {
        const Transform& tr = reg.get<Transform>(bodies[i]);
        const int cx = wrap_macro(static_cast<int>(tr.pos.x / kCellSize));
        const int cy = wrap_macro(static_cast<int>(tr.pos.y / kCellSize));
        if (room_bit_at(FloorKind::Residential, 0, cx, cy) ==
            room_bit(RoomBit::Kitchen))
            ++out.inKitchen;
        const float dx = wrap_delta_f(start[i].x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(start[i].y, tr.pos.y, kWorldExtent);
        out.travelled += std::sqrt(dx * dx + dy * dy);
    }
    return out;
}

void rooms_a_hungry_body_walks_to_a_kitchen() {
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    generate_floor(stack.layer(layer), 0, floor_spec(FloorKind::Residential), 1337u);
    RoomZones z;
    bake_room_zones(stack.layer(layer).grid(), FloorKind::Residential, 0, z);

    // 40 seconds. A kitchen is ~10 cells away at the Residential mix's 16/100
    // weight, i.e. ~20 m, and the errand pace is 1.35 m/s — so this is ~2.5x the
    // budget a straight walk needs, and a body that has not arrived by then is not
    // walking toward one.
    const int ticks = static_cast<int>(40.0f / kSimDt);
    const ErrandRun with = rooms_run_errand(stack, layer, &z, ticks);
    const ErrandRun without = rooms_run_errand(stack, layer, nullptr, ticks);

    std::printf("[rooms] errand WITH zones:    own_ai=%u eat=%u stalled=%u "
                "in-kitchen=%d/%d walked=%.0f m\n",
                with.owned, with.eating, with.stalled, with.inKitchen, with.bodies,
                static_cast<double>(with.travelled));
    std::printf("[rooms] errand WITHOUT zones: own_ai=%u eat=%u stalled=%u "
                "in-kitchen=%d/%d walked=%.0f m\n",
                without.owned, without.eating, without.stalled, without.inKitchen,
                without.bodies, static_cast<double>(without.travelled));

    // Both arms AGREE about what the bodies want — the scorer is untouched by this
    // leg. That is what makes the comparison fair: the only thing that changed is
    // whether wanting it can steer.
    CHECK(with.bodies == 64 && without.bodies == 64);
    CHECK(with.eating == 64u);
    CHECK(without.eating == 64u);

    // WITHOUT the zones: the pre-rooms behaviour, verbatim. Not one body is
    // AI-owned, and with no steerer in this harness (wander_step is not wired here)
    // nothing walks anywhere. This is `own_ai=0` of [problems.md] §27, headless.
    CHECK(without.owned == 0u);
    CHECK(without.inKitchen == 0);

    // WITH the zones: every body takes the token, and the great majority is standing
    // in a kitchen 40 s later — THROUGH THE REAL COLLIDER, which is the claim that
    // matters and the one a collision-free integrator could not make.
    CHECK(with.owned == 64u);
    CHECK(with.travelled > 0.0f);
    CHECK(with.inKitchen * 4 >= 64 * 3); // >= 75% arrived
    // AND NOBODY SHOVED. The stall probe counts errand bodies physics refused to
    // move; a non-zero reading here is the signature of the two defects this block
    // caught and would catch again — a field that routes through cells a collider
    // cannot enter, and axis steering that lets a body clip the jamb of the doorway
    // it was routed through. Both were live, both are measured at zero now.
    CHECK(with.stalled == 0u);

    // SETTLED, not milling: once a body reaches its seat the AI keeps the token and
    // writes a zero. Run on longer and the arrivals must not drift back out — which
    // is the failure mode of handing the body back to wander on arrival.
    const ErrandRun longer = rooms_run_errand(stack, layer, &z, ticks * 3);
    std::printf("[rooms] errand at 120 s:      in-kitchen=%d/%d stalled=%u\n",
                longer.inKitchen, longer.bodies, longer.stalled);
    CHECK(longer.inKitchen >= with.inKitchen);
    CHECK(longer.inKitchen == longer.bodies); // every last one, and none drifts out
    CHECK(longer.stalled == 0u);
}

void rooms_furniture_makes_the_errand_visible() {
    LevelStack stack;
    const LayerId layer = stack.push_layer();
    World& w = stack.layer(layer);
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);

    Registry reg;
    const std::uint32_t placed =
        seed_room_furniture(reg, w, layer, FloorKind::Residential, 0);

    // Count what actually landed, per kind, and where. A furnisher that places a
    // stove inside a wall or hanging in the air passes "placed > 0" and fails the
    // only thing that matters, so this walks the entities it made.
    const int ground = floor_ground_coord();
    int stoves = 0, pans = 0, cots = 0, wrongRoom = 0, unreachable = 0;
    int floating = 0, anchorAir = 0;
    for (auto e : reg.view<const Transform, const PropMesh, const SubVoxelAnchor>()) {
        const SubVoxelAnchor& a = reg.get<const SubVoxelAnchor>(e);
        const std::uint16_t bit = room_bit_at(FloorKind::Residential, 0, a.cx, a.cy);
        // Every piece must be INSIDE a room of the kind its table row names.
        bool ok = false;
        for (const RoomFurniture& f : kRoomFurniture)
            if (f.room == bit) ok = true;
        if (!ok) ++wrongRoom;
        // REACHABLE: a body must be able to stand in the cell the piece occupies.
        // Tested at the STANDING storey, not at the anchor's cell — the anchor
        // points at the SOLID underneath by design, so testing it would ask
        // "is the floor walkable" and always answer no.
        if (!room_body_walkable(w.grid(), a.cx, a.cy, ground)) ++unreachable;
        // ANCHORED IN MATTER: `spawn_prop` already refuses otherwise, so this is a
        // second opinion on the rule rather than a duplicate of it — it is what
        // would catch the anchor and the height being derived separately again.
        if (!w.grid().solid(a.cx, a.cy, a.cz, a.subX, a.subY, a.subZ)) ++anchorAir;
        // AND NOT FLOATING: the piece's underside must sit ON that surface, within
        // one sub-voxel. This is the measurement [problems.md] §11 says to make —
        // the distance from the piece to the surface it names as its support.
        const vec3& p = reg.get<const Transform>(e).pos;
        const float half = reg.get<const PropMesh>(e).scale.z * 0.5f;
        const float surface =
            static_cast<float>(a.cz) * kCellSize +
            static_cast<float>(a.subZ + 1) * kVoxelSize;
        if (std::fabs((p.z - half) - surface) > kVoxelSize) ++floating;
        if (bit == room_bit(RoomBit::Kitchen)) ++stoves;
        if (bit == room_bit(RoomBit::Bathroom)) ++pans;
        if (bit == room_bit(RoomBit::Living)) ++cots;
    }
    std::printf("[rooms] furnished floor 0: %u pieces — kitchen %d, bathroom %d, "
                "living %d | wrong-room %d, unreachable %d, anchor-in-air %d, "
                "floating %d\n",
                placed, stoves, pans, cots, wrongRoom, unreachable, anchorAir,
                floating);

    CHECK(placed > 0);
    CHECK(stoves > 0 && pans > 0 && cots > 0);
    CHECK(wrongRoom == 0);
    CHECK(unreachable == 0);
    CHECK(anchorAir == 0);
    CHECK(floating == 0);

    // An Industrial floor rolls none of the three kinds, so it furnishes NOTHING
    // and costs nothing — the same data-driven degradation the fields have.
    World ind;
    generate_floor(ind, 0, floor_spec(FloorKind::Industrial), 1337u);
    Registry reg2;
    CHECK(seed_room_furniture(reg2, ind, 0, FloorKind::Industrial, 0) == 0u);
}

void rooms_recovery_closes_the_loop() {
    // A corridor is not a room that does anything. Table row, not a branch.
    CHECK(!room_restores(room_bit(RoomBit::Corridor)));
    CHECK(!room_restores(0));
    CHECK(room_restores(room_bit(RoomBit::Kitchen)));
    CHECK(room_restores(room_bit(RoomBit::Bathroom)));
    CHECK(room_restores(room_bit(RoomBit::Living)));
    // Deliberate zero rows, stated in [room_zone.h] rather than quietly copied.
    CHECK(!room_restores(room_bit(RoomBit::Office)));
    CHECK(!room_restores(room_bit(RoomBit::Medical)));

    // ONE SECOND IN A KITCHEN, the reference's numbers (needs.ts:257-263).
    Needs n{};
    n.food = 50.0f;
    n.water = 50.0f;
    room_recover(n, room_bit(RoomBit::Kitchen), 1.0f);
    CHECK(std::fabs(n.food - 53.5f) < 1e-4f);
    CHECK(std::fabs(n.water - 54.5f) < 1e-4f);
    // The kitchen CHARGES for itself: eating queues digestion, which is what makes
    // the toilet trip a consequence of the meal instead of a second clock.
    CHECK(std::fabs(n.pendingPee - 2.1f) < 1e-4f);
    CHECK(std::fabs(n.pendingPoo - 1.225f) < 1e-4f);

    // ONE SECOND IN A BATHROOM (needs.ts:265-269).
    Needs b{};
    b.pee = 80.0f;
    b.poo = 80.0f;
    b.water = 10.0f;
    room_recover(b, room_bit(RoomBit::Bathroom), 1.0f);
    CHECK(std::fabs(b.pee - 68.0f) < 1e-4f);
    CHECK(std::fabs(b.poo - 71.0f) < 1e-4f);
    CHECK(std::fabs(b.water - 12.0f) < 1e-4f);

    // A corridor second changes nothing at all, and neither does dt <= 0.
    Needs c{};
    c.food = 42.0f;
    room_recover(c, room_bit(RoomBit::Corridor), 1.0f);
    room_recover(c, room_bit(RoomBit::Kitchen), 0.0f);
    CHECK(c.food == 42.0f && c.pendingPoo == 0.0f);

    // Clamped into the same [0, kNeedMax] band every other needs writer uses: a
    // long sit in a kitchen cannot push food past full or pee below empty.
    Needs f{};
    f.food = 99.0f;
    room_recover(f, room_bit(RoomBit::Kitchen), 10.0f);
    CHECK(f.food == kNeedMax);
    Needs e{};
    e.pee = 1.0f;
    room_recover(e, room_bit(RoomBit::Bathroom), 10.0f);
    CHECK(e.pee == 0.0f);

    // THE LOOP. A body that eats its fill in a kitchen leaves it needing a toilet:
    // sit at the kitchen rate until food is full, then let `needs_advance` meter the
    // queued digestion out. The scorer must then rank toilet above eat — kitchen ->
    // bathroom, produced by two data rows and no state machine.
    Needs loop = needs_roll(7u);
    loop.food = 20.0f;
    loop.water = 20.0f;
    for (int i = 0; i < 40 * 8; ++i) { // 40 s of kitchen at the 8 Hz test period
        room_recover(loop, room_bit(RoomBit::Kitchen), 0.125f);
        needs_advance(loop, 0.125f);
    }
    CHECK(loop.food > 90.0f && loop.water > 90.0f);
    CHECK(loop.pendingPee > 0.0f || loop.pee > 0.0f);
    for (int i = 0; i < 900 * 8; ++i) needs_advance(loop, 0.125f); // walk it off
    Perception p;
    p.idSeed = identity_seed(7u);
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    float scores[kIntentCount];
    score_intents(p, loop, scores);
    std::printf("[rooms] after a meal: pee %.1f poo %.1f -> toilet %.1f vs eat %.1f\n",
                static_cast<double>(loop.pee), static_cast<double>(loop.poo),
                static_cast<double>(scores[IntentToilet]),
                static_cast<double>(scores[IntentEat]));
    CHECK(scores[IntentToilet] > scores[IntentEat]);
}
