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
    // Intents with no row delegate, exactly as before rooms existed.
    CHECK(intent_room_mask(IntentWork) == 0);
    CHECK(intent_room_mask(IntentWander) == 0);
    CHECK(intent_room_mask(IntentFlee) == 0);
    CHECK(kRoomFieldMask == (room_bit(RoomBit::Kitchen) |
                             room_bit(RoomBit::Bathroom) |
                             room_bit(RoomBit::Living)));
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

    // An Industrial floor's mix is Production/Storage/Corridor/Smoking — no room an
    // intent names. Nothing is baked, `room_route` answers "nothing reachable", and
    // every consumer degrades to the pre-rooms behaviour with no special case.
    World ind;
    generate_floor(ind, 0, floor_spec(FloorKind::Industrial), 1337u);
    RoomZones zi;
    bake_room_zones(ind.grid(), FloorKind::Industrial, 0, zi);
    CHECK(!zi.ready());
    CHECK(zi.baked == 0);
    CHECK(zi.resident_bytes() == 0);
    CHECK(room_route(zi, room_bit(RoomBit::Kitchen), 10, 10, 3).bit == 0);

    // Re-baking a RECYCLED RoomZones must not inherit the previous floor's fields —
    // the stale-bake bug class [world/nav.h] documents for its own.
    bake_room_zones(ind.grid(), FloorKind::Industrial, 0, zr);
    CHECK(zr.baked == 0 && zr.resident_bytes() == 0);
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
    constexpr int kBudget = 512;
    int sampled = 0, arrived = 0, unreachable = 0, overBudget = 0;
    for (int y = 0; y < kMacroDim; y += 4) {
        for (int x = 0; x < kMacroDim; x += 4) {
            if (w.grid().mask(x, y, ground).full()) continue;
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
    CHECK(arrived * 10 >= sampled * 9); // >=90% of the storey can reach a kitchen

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
    int ox = 0, oy = 0;

    // Interior, on both axes, for every identity we try.
    for (std::uint32_t id = 0; id < 256; ++id) {
        room_seat_offset(id, 3, 7, stride, ox, oy);
        CHECK(ox >= 1 && ox <= stride - 1);
        CHECK(oy >= 1 && oy <= stride - 1);
    }

    // Stable: the same body in the same room always gets the same seat, so it does
    // not shuffle between ticks. This is what lets the micro-goal be stateless.
    int ax = 0, ay = 0, bx = 0, by = 0;
    room_seat_offset(1234u, 5, 9, stride, ax, ay);
    room_seat_offset(1234u, 5, 9, stride, bx, by);
    CHECK(ax == bx && ay == by);

    // Different room, same body: a different seat is expected (you sit where you
    // are), and the whole point is that it needs no stored state to change.
    room_seat_offset(1234u, 6, 9, stride, bx, by);
    CHECK(bx >= 1 && by >= 1);

    // Spread: 256 bodies in one room must not stack on one cell. With 9 interior
    // cells a uniform hash puts ~28 on each; assert every cell is used at least
    // once, which a constant or a poorly mixed hash would fail.
    int used[16] = {};
    for (std::uint32_t id = 0; id < 256; ++id) {
        room_seat_offset(id, 2, 2, stride, ox, oy);
        ++used[(oy - 1) * (stride - 1) + (ox - 1)];
    }
    int distinct = 0;
    for (int i = 0; i < (stride - 1) * (stride - 1); ++i)
        if (used[i] > 0) ++distinct;
    CHECK(distinct == (stride - 1) * (stride - 1));
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
