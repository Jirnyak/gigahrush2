// Room zones — WHAT A ROOM AFFORDS and WHERE THE NEAREST ONE IS.
//
// This is leg (b)+(c) of [problems.md] §27: the utility scorer could already decide
// "I am hungry", and that decision changed nothing, because a hungry body had
// nowhere to GO and nothing to RECOVER from. Both halves are the same missing fact —
// *a room means something* — so they live in one file and one pair of tables.
//
// ===========================================================================
// TWO TABLES, NO CONTROL FLOW. The reference does this as an if-chain.
// ===========================================================================
// The reference (`src/systems/ai/npc_fsm.ts`) spends twenty call sites on
// `gotoNearestRoomType(world, e, RoomType.KITCHEN)` and a parallel if-chain in
// `needs.ts:253-280` for the recovery, so adding a room type means editing both in
// step and hoping. Here a room type is a ROW:
//
//   kRoomAffordance[]  intent -> the RoomBit mask that satisfies it
//   kRoomRecovery[]    RoomBit -> what one second inside does to a Needs row
//
// Adding "smokers restore stress in a Smoking room" is one row in each and NO new
// code: the bake derives which fields to build from the affordance table, and
// `room_recover` is a table read. That is the [jirnyak.md] §21 shape applied to
// behaviour instead of to props.
//
// ===========================================================================
// MACRO GOAL vs MICRO GOAL — the owner's own split, mapped onto what exists
// ===========================================================================
//   MACRO: *what do I want* — `AiBrain::currentIntent`, chosen by the utility
//          scorer, sticky, and interruptible: `select_intent` lets an emergency
//          survival intent preempt without the margin ([ai.h] kEmergencyScore), so
//          "I was walking to the kitchen and a monster appeared" already works and
//          needs nothing from this file.
//   MICRO: *where exactly do I stand* — a SEAT: one interior cell of the room the
//          body is currently in, hashed from its identity. `room_seat_offset`.
//
// The seat is a PURE FUNCTION of (identity, room), not stored state. That is the
// whole reason `AiBrain` stays 16 bytes: a micro-goal that can be recomputed in
// three multiplies never has to be saved, invalidated, or kept in step with the
// macro goal. Cross a room boundary and your seat is the new room's — which is
// exactly the behaviour you want, and it costs no bytes to get.
//
// ===========================================================================
// WHY A DENSE FIELD AND NOT `nav::route_step`
// ===========================================================================
// The obvious reuse is "pick a kitchen cell, call `nav::route_step`". It does not
// work at this scale, and the number says why: `route_step` routes to the nearest
// of the 64 fixed lattice ANCHORS, leaving up to a 16-cell residual for the caller
// ([world/nav.h] "the anchor residual"). On a Residential floor the room lattice is
// 32x32 = 1024 rooms at stride 4, Kitchen carries weight 16 of 100, so kitchens are
// ~10 cells apart — the residual is BIGGER than the spacing, and `route_step` would
// route a hungry body to an anchor and then shrug.
//
// So each affordance bit gets its own dense 128^3 flow field, baked by exactly the
// multi-source BFS shape `nav::bake_fine` uses, seeded from EVERY walkable cell of
// that room kind at once. 2 MiB per bit, 3 bits live => 6 MiB per floor, and the
// tick cost is one byte load. [AGENTS.md]: dense over sparse, bake at load, tick in
// O(1). Same flow-byte convention as nav (0..5 index kNavDir, kFlowArrived,
// kFlowNone) so there is ONE direction encoding in the tree, not two.
//
// THE VERTICAL-STEP FALLBACK, and it is not an edge case. The BFS is 6-connected,
// so a route may legitimately start with "go up". A walking body cannot climb a
// storey (`wander.cpp` measured 110 of 120 ground-storey residents getting a
// vertical first step and documents the same fallback): when the flow byte is
// vertical, steer by the horizontal bearing toward the target room's column
// instead. That is what `nearRoom` is for — a 1024-entry per-bit map of "the
// nearest room of this kind", brute-forced at bake time in ~1 ms, which is also
// what makes the fallback exact rather than a guess.
//
// ===========================================================================
// SCOPE HONESTY
// ===========================================================================
// * The room taxonomy is keyed on (kind, number, rx, ry) — X/Y only
//   ([game/floor_gen.h]). Every existing consumer (door.cpp, container.cpp,
//   mob_spawn.cpp) reads it that way, so this file does too rather than inventing a
//   second, frame-generic taxonomy that would disagree with all three. A room is a
//   COLUMN through every storey, which is why the nearest-room map is 2D.
// * A room's INTERIOR is (stride-1)^2; the wall lines (x or y a multiple of the
//   stride) belong to no room. `room_bit_at` returns 0 there, so a body standing in
//   the corridor outside a kitchen is not "in the kitchen".
// * Geometry may be carved after the bake. The fields go stale exactly the way
//   nav's do, and for the same reason ([world/nav.h]: no partial rebake); a stale
//   field mis-steers, it does not crash.
#pragma once

#include <cstdint>
#include <vector>

#include "game/ai.h"        // IntentId — the affordance table's key
#include "game/floor_gen.h" // kFloorRoomBits, floor_room_stride/mask/bit_index
#include "game/floor_spec.h" // FloorKind
#include "game/mob_table.h" // RoomBit — the shared room taxonomy
#include "game/npc_pool.h"  // Needs — what room_recover advances
#include "world/nav.h"      // kNavDir, kFlowArrived, kFlowNone — one convention

namespace giga {
class MacroGrid;
}

namespace giga::game {

// ---------------------------------------------------------------------------
// TABLE 1 — which rooms satisfy which intent.
//
// The bake reads this to decide which fields to build, `ai_step` reads it to decide
// whether a winning intent has anywhere to go. An intent absent from this table has
// NO destination and delegates to `wander_step` exactly as before — which is why
// adding work/social/patrol later is a row, not a code change.
//
// `rooms` is a MASK, not a single bit: "eat" could name Kitchen|Common the day a
// canteen exists, and `room_route` already picks the nearer of two.
// ---------------------------------------------------------------------------
struct RoomAffordance {
    std::uint8_t intent;    // IntentId
    std::uint16_t rooms;    // RoomBit mask
};

inline constexpr std::uint16_t room_bit(RoomBit b) {
    return static_cast<std::uint16_t>(b);
}

inline constexpr RoomAffordance kRoomAffordance[] = {
    {IntentEat, room_bit(RoomBit::Kitchen)},
    {IntentDrink, room_bit(RoomBit::Kitchen)},
    {IntentToilet, room_bit(RoomBit::Bathroom)},
    {IntentSleep, room_bit(RoomBit::Living)},
};
inline constexpr std::size_t kRoomAffordanceCount =
    sizeof(kRoomAffordance) / sizeof(kRoomAffordance[0]);

// The RoomBit mask that satisfies `intent`, or 0 when the intent has no
// destination. O(kRoomAffordanceCount) over a 4-row constexpr table — a loop the
// compiler unrolls, not a search.
inline constexpr std::uint16_t intent_room_mask(std::uint8_t intent) {
    std::uint16_t m = 0;
    for (const RoomAffordance& r : kRoomAffordance)
        if (r.intent == intent) m = static_cast<std::uint16_t>(m | r.rooms);
    return m;
}

// Every bit any intent names — exactly the fields the bake has to build.
inline constexpr std::uint16_t kRoomFieldMask = [] {
    std::uint16_t m = 0;
    for (const RoomAffordance& r : kRoomAffordance)
        m = static_cast<std::uint16_t>(m | r.rooms);
    return m;
}();

// ---------------------------------------------------------------------------
// TABLE 2 — what ONE SECOND in a room does to a Needs row.
//
// Ported from the reference `needs.ts:253-280` (`applyColdResidentCadence`), which
// is where the numbers come from; the occupation multipliers (COOK 5 instead of
// 3.5, DOCTOR 2 instead of 1) are dropped because gigahrush2 has no occupation
// layer yet ([ai.h] "workDrive is the reference default 0.5 everywhere until
// occupations land"), so every body gets the civilian rate.
//
// THE KITCHEN CHARGES FOR ITSELF, and that coupling is the point: eating queues
// `pendingPoo`/`pendingPee`, which meter into the pressure bars later
// ([needs.h] digest), which eventually wins `IntentToilet`, which sends the body to
// a Bathroom. Kitchen -> bathroom -> kitchen is a LOOP produced by two data rows and
// no state machine.
//
// TWO DELIBERATE DIVERGENCES FROM THE REFERENCE, both because a gate we do not have
// would otherwise be silently dropped:
//
//   * LIVING restores sleep UNGATED. The reference gates it on
//     `resting || hour >= 22 || hour < 6`, and `Perception::minuteOfDay` is still
//     -1 ([ai.h]) so there is no hour to read. Ungated in your own flat is the
//     honest stand-in; the day a clock lands, this row gets the gate and nothing
//     else changes.
//   * OFFICE restores NOTHING, where the reference gives it the same sleep rate as
//     LIVING under the same `resting` gate. Ungated, that would abolish sleep
//     pressure for every body on a Commercial floor — the gate is load-bearing
//     there in a way it is not in a flat, so the row stays zero until the clock
//     exists. Stated rather than quietly copied.
//
// MEDICAL is zero for a different reason: the reference heals `hp` there, and HP is
// an integer the crowd has no fractional bank for (the player's lives in
// `Needs::hpDebt`, which is a DAMAGE ledger). Adding a heal bank is the fix for the
// `IntentHeal` deadlock ([problems.md] §27, [hunt.h]:41-42) and belongs with that
// work, not smuggled in here as a column nothing reads ([problems.md] §35).
// ---------------------------------------------------------------------------
struct RoomRecovery {
    float food;        // + per second
    float water;       // + per second
    float sleep;       // + per second
    float pee;         // - per second off the pressure bar
    float poo;         // - per second
    float pendingPee;  // + per second into the digestion queue
    float pendingPoo;  // + per second
};

inline constexpr RoomRecovery kRoomRecovery[kFloorRoomBits] = {
    /* 0 Corridor   */ {},
    /* 1 Common     */ {}, // reference: +1.5 food/water, but only in the LUNCH state
    /* 2 Storage    */ {},
    /* 3 Kitchen    */ {3.5f, 4.5f, 0.0f, 0.0f, 0.0f, 2.1f, 3.5f * 0.35f},
    /* 4 Bathroom   */ {0.0f, 2.0f, 0.0f, 12.0f, 9.0f, 0.0f, 0.0f},
    /* 5 Living     */ {0.0f, 0.0f, 2.8f, 0.0f, 0.0f, 0.0f, 0.0f},
    /* 6 Office     */ {}, // reference: sleep, but gated on `resting` — see above
    /* 7 Medical    */ {}, // reference: hp — needs a crowd heal bank, see above
    /* 8 Production */ {},
    /* 9 Smoking    */ {},
    /*10 Hq         */ {},
};

// True when standing in `bit` changes anything at all — the O(1) test that keeps
// `needs_step` from paying for a table read per body per tick in a corridor.
bool room_restores(std::uint16_t bit);

// Advance `n` by one `dt` of standing in a room of kind `bit`. Pure: no registry,
// no world, no allocation, and a `bit` of 0 (a wall line, or a room kind with a
// zero row) is a no-op. Clamps into [0, kNeedMax] exactly like `needs_advance`.
void room_recover(Needs& n, std::uint16_t bit, float dt);

// ---------------------------------------------------------------------------
// WHERE the rooms are.
// ---------------------------------------------------------------------------

// The room kind at a macro cell's column, or 0 on a wall line (which belongs to no
// room). Pure, O(1), and keyed exactly like every other taxonomy consumer.
std::uint16_t room_bit_at(FloorKind kind, int number, int x, int y);

// The body's SEAT inside room (rx, ry): a deterministic interior offset in
// [1, stride-1] on each axis, from its identity seed. Two bodies in one room get
// different seats; the same body always gets the same one, so it does not shuffle
// between ticks. This is the whole micro-goal — see the file banner.
void room_seat_offset(std::uint32_t idSeed, int rx, int ry, int stride, int& ox,
                      int& oy);

// One floor's baked room fields. ~2 MiB per affordance bit PRESENT on the floor:
// a Residential floor bakes Kitchen/Bathroom/Living = 6 MiB, an Industrial floor
// bakes none and every consumer degrades to the pre-rooms behaviour automatically.
struct RoomZones {
    FloorKind kind = FloorKind::Residential;
    int number = 0;
    std::uint16_t baked = 0; // which bits have a field

    // flow[bitIndex]: kMacroCells bytes, same convention as nav::FineNav::flow.
    // Empty for a bit that was not baked.
    std::vector<std::uint8_t> flow[kFloorRoomBits];
    // nearRoom[bitIndex]: one entry per room of the (128/stride)^2 lattice, packed
    // rx | ry << 8, naming the nearest room carrying that bit. Empty when not baked.
    std::vector<std::uint16_t> nearRoom[kFloorRoomBits];

    bool ready() const { return baked != 0; }
    std::size_t resident_bytes() const;
};

// Build every field `kRoomFieldMask` names AND that the floor actually contains.
// Bake-time only (floor load), parallel across bits, deterministic: each bit owns a
// disjoint slice, so the result does not depend on scheduling. Clears `out` first,
// so re-baking a recycled RoomZones cannot inherit the previous floor's fields.
void bake_room_zones(const MacroGrid& grid, FloorKind kind, int number,
                     RoomZones& out);

// What one body should do this tick to reach a room in `mask`.
//
// `dir` is a kNavDir index 0..5, `kFlowArrived` when the body's own cell is already
// such a room, or `kFlowNone` when no room of that kind is reachable (or the zones
// are not baked). `targetX/targetY` name the nearest such room's centre column and
// are valid whenever `bit != 0` — that is the horizontal bearing the caller falls
// back to when `dir` is a vertical step, the same fallback `wander_step` uses.
struct RoomRoute {
    std::uint16_t bit = 0;            // the room kind chosen (0 = nothing reachable)
    std::uint8_t dir = nav::kFlowNone;
    int targetX = 0;
    int targetY = 0;
};
RoomRoute room_route(const RoomZones& z, std::uint16_t mask, int x, int y, int z_);

} // namespace giga::game
