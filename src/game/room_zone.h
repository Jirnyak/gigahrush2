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
    {IntentEat,    room_bit(RoomBit::Kitchen)},
    {IntentDrink,  room_bit(RoomBit::Kitchen)},
    {IntentToilet, room_bit(RoomBit::Bathroom)},
    {IntentSleep,  room_bit(RoomBit::Living)},
    // --- Added 2026-08-09: closes spec 01 §2.2 (work/social/patrol "a ROW away") ---
    // IntentWork routes to any production/office/hq room. workDrive multiplier from
    // role (RoleTraits::workDrive) scales the score; the room field gives it somewhere to go.
    {IntentWork,   static_cast<std::uint16_t>(room_bit(RoomBit::Production) |
                                              room_bit(RoomBit::Office)     |
                                              room_bit(RoomBit::Hq))},
    // IntentSocial routes to common rooms and smoking rooms (Cultist gathering point).
    {IntentSocial, static_cast<std::uint16_t>(room_bit(RoomBit::Common) |
                                              room_bit(RoomBit::Smoking))},
    // IntentPatrol routes to corridor — Duty role then overrides with route_step to
    // lattice nodes. The corridor row stops the intent from silently delegating to wander.
    {IntentPatrol, room_bit(RoomBit::Corridor)},
    // IntentHeal routes to Medical. With hpBank now non-zero in kRoomRecovery,
    // this row closes the deadlock: IntentHeal wins, body walks here, hpBank fills.
    {IntentHeal,   room_bit(RoomBit::Medical)},
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
    // Fractional HP bank: Medical room heals at 1.2 HP/s. HP is integer on the crowd
    // body; this accumulates the fraction and spills it whole-HP each tick in
    // needs_step. 0 everywhere that is not Medical. (spec 01 \u00a73.3 + spec 14 \u00a79.1)
    float hpBank;      // + HP per second (fractional; whole part spills to pool.hp)
};

inline constexpr RoomRecovery kRoomRecovery[kFloorRoomBits] = {
    /* 0 Corridor   */ {},
    /* 1 Common     */ {}, // reference: +1.5 food/water, but only in the LUNCH state
    /* 2 Storage    */ {},
    /* 3 Kitchen    */ {3.5f, 4.5f, 0.0f, 0.0f, 0.0f, 2.1f, 3.5f * 0.35f, 0.0f},
    /* 4 Bathroom   */ {0.0f, 2.0f, 0.0f, 12.0f, 9.0f, 0.0f, 0.0f,        0.0f},
    /* 5 Living     */ {0.0f, 0.0f, 2.8f, 0.0f, 0.0f, 0.0f, 0.0f,          0.0f},
    /* 6 Office     */ {}, // reference: sleep, but gated on `resting` — see above
    /* 7 Medical    */ {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
                       /* hpBank */ 1.2f}, // 1.2 HP/s via fractional bank (spec 01 \u00a73.3)
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
void room_recover(Needs& n, std::uint16_t bit, float dt,
                  class AiMemory* mem = nullptr, NpcId id = kInvalidNpc,
                  int cx = 0, int cy = 0, int cz = 0, double now = 0.0);

// ---------------------------------------------------------------------------
// TABLE 3 — what FURNITURE a room kind contains.
//
// A room was a purely logical fact: `floor_room_mask` is a hash of the room's
// coordinates and nothing in the world said "kitchen". So the crowd's whole errand
// behaviour was invisible — you could watch 400 people walk somewhere and had no way
// to tell they were walking to a kitchen. Furniture is what makes the decision
// legible, and it is CONTENT rather than a debug overlay: the room is furnished in
// the shipped game, for the player, permanently.
//
// One row per (room kind, piece). `slot` is what makes the placement a PURE FUNCTION
// instead of stored state — see `room_furniture_spot`. Adding a bookshelf to the
// living room is one row here plus one row in data/props.csv, and no code at all.
// ---------------------------------------------------------------------------
struct RoomFurniture {
    std::uint16_t room;   // RoomBit
    std::uint16_t prop;   // PropId ordinal — kept as a plain integer so this header
                          // does not drag prop_table.h into ai.cpp's include set
    std::uint8_t slot;    // 0..kRoomSlots-1, the interior cell it occupies
    bool useSpot;         // may an NPC stand AT it? (a stove yes, a table no)
};

// How many distinct interior cells a room offers. The room interior is
// (stride-1)^2 = 9 cells at stride 4, and a slot is an index into it in row-major
// order — so a slot is a POSITION, not a piece of stored geometry.
inline constexpr std::uint8_t kRoomSlots = 9;

// PropId ordinals, spelled once. Kept as literals rather than an include so that
// `ai.cpp` — which only ever asks "where is the use spot" — pays nothing for the
// generated prop table. The static_asserts in room_zone.cpp pin them against the
// real enum, so a CSV reorder breaks the BUILD instead of moving the furniture.
inline constexpr std::uint16_t kPropKitchenStove = 5;
inline constexpr std::uint16_t kPropKitchenTable = 6;
inline constexpr std::uint16_t kPropToiletPan = 7;
inline constexpr std::uint16_t kPropBedCot = 8;

inline constexpr RoomFurniture kRoomFurniture[] = {
    // A kitchen: a stove to stand at, and a table that is scenery. Two pieces, so a
    // kitchen reads as a kitchen from the doorway and not as "a box in a room".
    {room_bit(RoomBit::Kitchen), kPropKitchenStove, 0, true},
    {room_bit(RoomBit::Kitchen), kPropKitchenTable, 4, false},
    // A bathroom: two pans, because a bathroom with ONE fixture makes a queue of
    // nine residents converge on one voxel.
    {room_bit(RoomBit::Bathroom), kPropToiletPan, 0, true},
    {room_bit(RoomBit::Bathroom), kPropToiletPan, 2, true},
    // A flat: two cots along the far wall.
    {room_bit(RoomBit::Living), kPropBedCot, 6, true},
    {room_bit(RoomBit::Living), kPropBedCot, 8, true},
};
inline constexpr std::size_t kRoomFurnitureCount =
    sizeof(kRoomFurniture) / sizeof(kRoomFurniture[0]);

// ---------------------------------------------------------------------------
// WHERE the rooms are.
// ---------------------------------------------------------------------------

// The room kind at a macro cell's column, or 0 on a wall line (which belongs to no
// room). Pure, O(1), and keyed exactly like every other taxonomy consumer.
std::uint16_t room_bit_at(FloorKind kind, int number, int x, int y);

// CAN A WALKING BODY OCCUPY THIS CELL — the predicate the bake floods through, and
// the reason it is public is that it is a CONTRACT, not an implementation detail:
// anything asking "why did the field not route there" must be able to ask the same
// question the field asked.
//
// It is stricter than `nav`'s "not fully solid" and deliberately so. Collision is
// exact against sub-voxels ([sim/physics.cpp]) and an NPC's collider is 0.4 m
// half-width by ~0.85 m half-height ([game/embody.cpp]) = 4 x 4 x 7 sub-voxels, so a
// cell with one carved voxel passes nav's test and stops a body dead. Measured on
// the live floor before this existed: 62 of 63 bodies on an errand were pinned
// against geometry the field called open.
//
// Stricter in the SAFE direction: every cell this accepts, nav also accepts.
bool room_body_walkable(const MacroGrid& grid, int x, int y, int z);

// The interior offset of furniture `slot`, in [1, stride-1] on each axis. A slot is
// a POSITION in the room's (stride-1)^2 interior, row-major — which is what lets the
// SEEDER and the AI agree about where the stove is without either storing anything
// or reading the other's output. Same argument `floor_doorways` makes for hashing a
// doorway's offset instead of replaying the generator's RNG: a position has no order
// to get wrong.
void room_slot_offset(std::uint8_t slot, int stride, int& ox, int& oy);

// The body's SEAT inside room (rx, ry): a deterministic interior offset in
// [1, stride-1] on each axis, from its identity seed. Two bodies in one room get
// different seats; the same body always gets the same one, so it does not shuffle
// between ticks. This is the whole micro-goal — see the file banner.
//
// `roomBit` is what makes the seat CONTEXTUAL rather than random: if the room kind
// has furniture marked `useSpot` ([room_zone.h] kRoomFurniture — a stove, a pan, a
// cot), the body is seated AT one of those, chosen by its identity so a crowd
// spreads across them. A room with no use spot falls back to a free interior cell,
// which is what keeps every un-furnished room kind working exactly as before.
void room_seat_offset(std::uint32_t idSeed, std::uint16_t roomBit, int rx, int ry,
                      int stride, int& ox, int& oy);

// Furnish every room on `layer` from `kRoomFurniture`, and return how many pieces
// landed. Spawns ordinary prop ECS entities through `spawn_prop_from_id`, so the
// renderer picks them up as the passive skin it already is ([jirnyak.md] §18) and
// nothing here touches render.
//
// Call once per floor entry, AFTER the geometry is final and BEFORE the crowd is
// steered — same slot in the load as the other per-floor seeders. Idempotent only in
// the sense every floor seeder is: call `despawn_layer_props` first when recycling a
// layer, exactly as the mob and container seeders require.
//
// A piece is REFUSED rather than floated when its cell cannot hold it: no body-sized
// clearance, or no honest floor underneath. That is the same rule the padic bulb
// seeder states ("no honest solid support — do not float a lamp") and the same one
// [problems.md] §11 was opened over.
std::uint32_t seed_room_furniture(Registry& reg, const World& world, LayerId layer,
                                  FloorKind kind, int number);

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
