// Role system — five behavioural archetypes layered ABOVE faction traits.
//
// DESIGN: A role is NOT a new intent. The 13-intent table is complete. A role is
// a MULTIPLIER ROW on the scoring weights: the same score computation runs for
// every body, but a Duty body has patrolDrive x 20 and a Looter has scavengeDrive
// x 10, so they win different intents from identical environments.
//
// WHY A POOL COLUMN, NOT A PURE FUNCTION. role_for() is a deterministic hash from
// (npcId, floorKind) -- the same trick as seat_offset and identity_seed. But the
// spec explicitly names one story event where a Resident turns Looter after samosbor,
// so the column exists as an OVERRIDE, initialised from role_for() and writable.
// Cost: 1 B/row in the LIVE column set (spec 01 section 3a.7).
//
// BACKWARD COMPATIBILITY. Resident's trait row was deliberately tuned to match the
// current Citizens kFactionTraits values. A floor of all Residents diverges from
// today's Citizens by at most +-0.2 on one drive axis -- within random jitter.
#pragma once

#include <cstdint>

#include "core/rng.h"        // hash3, rand01, rand_below
#include "game/floor_spec.h" // FloorKind
#include "game/mob_table.h"  // RoomBit -- homeRooms / workRooms are masks
#include "game/npc_pool.h"   // NpcId

namespace giga::game {

// RoleId -- the five archetypes, spec 01 section 3a.
// The INDEX is load-bearing: it indexes kRoleTraits and kRoleWeights.
enum class RoleId : std::uint8_t {
    Resident = 0, // ~70% residential; the baseline all others diverge from
    Duty,         // 2-5%; first consumer of route_step (patrol lattice nodes)
    Medic,        // 1-3%; only role that acts on another body''s hpBank
    Looter,       // 3-8%; grows with |floor|; homeRooms = 0 (sleeps anywhere)
    Cultist,      // 0% residential; up to 40% on Derelict
    kRoleCount,
};

inline constexpr std::size_t kRoleCount =
    static_cast<std::size_t>(RoleId::kRoleCount);

struct RoleTraits {
    float workDrive;      // multiplier on IntentWork score
    float patrolDrive;    // multiplier on IntentPatrol score
    float sociability;    // multiplier on IntentSocial score; Cultist > 1.0
    float scavengeDrive;  // additive term for scavenging from memory recall
    float careDrive;      // additive term for healing nearby wounded
    std::uint16_t homeRooms; // RoomBit mask; IntentSleep destination
    std::uint16_t workRooms; // RoomBit mask; IntentWork destination
};

inline constexpr std::uint16_t role_room_bit(RoomBit b) {
    return static_cast<std::uint16_t>(b);
}

// TABLE 1 -- 5x7 role traits matrix. Source: spec 01 section 3a.6.
inline constexpr RoleTraits kRoleTraits[kRoleCount] = {
    //           workDrv patrol social scaveng care  homeRooms              workRooms
    /* Resident */ { 1.00f, 1.00f, 1.00f, 0.10f, 0.05f,
                     role_room_bit(RoomBit::Living),
                     role_room_bit(RoomBit::Common) },
    /* Duty     */ { 1.00f, 1.50f, 0.60f, 0.05f, 0.20f,
                     role_room_bit(RoomBit::Living),
                     role_room_bit(RoomBit::Hq) },
    /* Medic    */ { 1.00f, 0.20f, 0.80f, 0.10f, 1.00f,
                     role_room_bit(RoomBit::Living),
                     role_room_bit(RoomBit::Medical) },
    /* Looter   */ { 0.20f, 0.10f, 0.40f, 1.00f, 0.00f,
                     0u,
                     role_room_bit(RoomBit::Storage) },
    /* Cultist  */ { 0.60f, 0.40f, 1.20f, 0.30f, 0.10f,
                     role_room_bit(RoomBit::Living),
                     static_cast<std::uint16_t>(role_room_bit(RoomBit::Smoking) |
                                                role_room_bit(RoomBit::Hq)) },
};

inline constexpr std::size_t kFloorKindCount =
    static_cast<std::size_t>(FloorKind::Count);

// TABLE 2 -- role weights by floor archetype. Source: spec 01 section 3a.7.
inline constexpr std::uint8_t kRoleWeights[kFloorKindCount][kRoleCount] = {
    //              Resident Duty Medic Looter Cultist
    /* Residential */ {  70,    5,    3,     3,     0 },
    /* Commercial  */ {  50,   10,    3,     8,     2 },
    /* Industrial  */ {  30,   15,    5,     8,     5 },
    /* Derelict    */ {  10,    2,    1,    20,    40 },
    /* Padic       */ {  20,    5,    2,    15,    20 },
};

inline constexpr std::uint32_t kRoleSalt = 0x726F6C65u; // "role"

// Deterministic role assignment. Call only at floor seeding, not per-tick.
inline RoleId role_for(NpcId id, FloorKind kind) {
    const std::size_t ki = static_cast<std::size_t>(kind);
    const std::size_t safeKi = ki < kFloorKindCount ? ki : 0u;
    const auto* weights = kRoleWeights[safeKi];

    std::uint32_t total = 0;
    for (std::size_t i = 0; i < kRoleCount; ++i) total += weights[i];
    if (total == 0) return RoleId::Resident;

    const std::uint32_t h = hash3(static_cast<std::uint32_t>(id),
                                  static_cast<std::uint32_t>(safeKi),
                                  kRoleSalt);
    std::uint32_t pos = rand_below(h, total);
    for (std::size_t i = 0; i < kRoleCount; ++i) {
        if (pos < weights[i])
            return static_cast<RoleId>(i);
        pos -= weights[i];
    }
    return RoleId::Resident;
}

// Bounds-safe accessor -- matches faction_traits() design in ai.h.
inline const RoleTraits& role_traits(RoleId r) {
    const std::size_t i = static_cast<std::size_t>(r);
    return kRoleTraits[i < kRoleCount ? i : 0u];
}

// PatrolPlan -- sparse ECS component, Duty bodies only (2-5% of crowd).
// sizeof == 4: no allocation, cache-friendly, POD.
struct PatrolPlan {
    std::uint8_t nodeFrom;
    std::uint8_t nodeTo;
    std::uint8_t hops;   // cumulative hop counter; fed into hash3 to avoid loops
    std::uint8_t pad_;
};
static_assert(sizeof(PatrolPlan) == 4,
              "PatrolPlan must be exactly 4 bytes -- sparse hot component");
static_assert(alignof(PatrolPlan) == 1);

// Medic constants -- spec 01 section 3a.3.
inline constexpr float kMedicReachM       = 2.0f;   // metres, one macro cell
inline constexpr float kMedicThreshold    = 0.6f;   // heal bodies below this hp fraction
inline constexpr float kMedicHealPerSec   = 3.0f;   // HP bank credit per second per patient
inline constexpr float kMedicFatiguePerSec = 0.5f;  // sleep cost per second per patient

// Patrol lattice-node advance salt. Different from kRoleSalt.
inline constexpr std::uint32_t kPatrolSalt = 0x70617472u; // "patr"

} // namespace giga::game