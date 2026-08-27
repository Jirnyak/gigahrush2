// Role system — five behavioural archetypes layered ABOVE faction traits.
//
// DESIGN: A role is NOT a new intent. The 13-intent table is complete. A role is
// a MULTIPLIER ROW on the scoring weights: the same score computation runs for
// every body, but a Duty body has patrolDrive ×1.5 and a Looter has scavengeDrive
// ×1.0, so they win different intents from identical environments.
//
// WHY A POOL COLUMN, NOT A PURE FUNCTION. role_for() is a deterministic hash from
// (npcId, floorKind) — the same trick as seat_offset and identity_seed. But the
// spec explicitly names one story event where a Resident turns Looter after
// samosbor, so the column exists as an OVERRIDE, initialised from role_for() and
// writable. Cost: 1 B/row in the LIVE column set.
//
// BACKWARD COMPATIBILITY. Resident's trait row is all-ones on the multiplier
// axes, so a floor of all Residents scores exactly what the pre-role build
// scored: the system is a no-op until a floor mixes in the other four rows.
//
// Ported from marko1olo e720f906+08ac5c00 (his wiring was honest: seeded in
// population.cpp, read in ai.cpp scoring). NOT ported: PatrolPlan (its only
// consumer, ai_patrol_step, never had a definition) and the panic/rally
// emission constants (the fields they write were never created).
#pragma once

#include <cstdint>

#include "core/rng.h"        // hash3, rand_below
#include "game/floor_spec.h" // FloorKind
#include "game/mob_table.h"  // RoomBit — homeRooms / workRooms are masks
#include "game/npc_pool.h"   // NpcId

namespace giga::game {

// RoleId — the five archetypes. The INDEX is load-bearing: it indexes
// kRoleTraits and kRoleWeights.
enum class RoleId : std::uint8_t {
    Resident = 0, // ~70% residential; the baseline all others diverge from
    Duty,         // 2-5%; wants HQ and patrol; the future consumer of route_step
    Medic,        // 1-3%; the only role that acts on ANOTHER body's hpBank
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
    float scavengeDrive;  // additive term: scavenging from local room recall
    float careDrive;      // additive term on IntentHeal from nearby wounded
    std::uint16_t homeRooms; // RoomBit mask; narrows IntentSleep's destination
    std::uint16_t workRooms; // RoomBit mask; narrows IntentWork's destination
};

inline constexpr std::uint16_t role_room_bit(RoomBit b) {
    return static_cast<std::uint16_t>(b);
}

// TABLE 1 — 5×7 role traits matrix.
inline constexpr RoleTraits kRoleTraits[kRoleCount] = {
    //           workDrv patrol social scaveng care  homeRooms / workRooms
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

// TABLE 2 — role weights by floor archetype. Row sums are NOT 100 on purpose:
// role_for divides by the actual total, so a row is relative weights, exactly
// the convention FloorSpec already uses for its mixes.
inline constexpr std::uint8_t kRoleWeights[kFloorKindCount][kRoleCount] = {
    //              Resident Duty Medic Looter Cultist
    /* Residential */ {  70,    5,    3,     3,     0 },
    /* Commercial  */ {  50,   10,    3,     8,     2 },
    /* Industrial  */ {  30,   15,    5,     8,     5 },
    /* Derelict    */ {  10,    2,    1,    20,    40 },
    /* Padic       */ {  20,    5,    2,    15,    20 },
    /* Blame       */ {  10,    5,    2,    25,    15 },
    /* Khrushi     */ {  65,    6,    3,     4,     1 },
};

inline constexpr std::uint32_t kRoleSalt = 0x726F6C65u; // "role"

// Deterministic role assignment. Call at floor seeding, not per-tick — the pool
// column is the runtime source of truth precisely so this can be overridden.
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

// Bounds-safe accessor — matches faction_traits() design in ai.h.
inline const RoleTraits& role_traits(RoleId r) {
    const std::size_t i = static_cast<std::size_t>(r);
    return kRoleTraits[i < kRoleCount ? i : 0u];
}

// PatrolPlan — sparse ECS component, IntentPatrol bodies only (a few % of the
// embodied window). Lazily attached by ai_patrol_step, the same rule as
// PlayerMelee: no spawn path has to remember it. sizeof == 4: POD, no
// allocation, cache-friendly.
struct PatrolPlan {
    std::uint8_t nodeFrom = 0xFF; // lattice node the current leg started at
    std::uint8_t nodeTo = 0xFF;   // lattice node this leg walks to; 0xFF = no leg
    std::uint8_t hops = 0;        // legs completed; feeds the next-node hash
    std::uint8_t pad_ = 0;
};
static_assert(sizeof(PatrolPlan) == 4,
              "PatrolPlan must stay 4 bytes — sparse hot component");

// Patrol next-node salt. Distinct from kRoleSalt so a body's patrol route and
// its role assignment cannot correlate by construction.
inline constexpr std::uint32_t kPatrolSalt = 0x70617472u; // "patr"

// Medic constants. The heal credit lands in the PATIENT's Needs::hpBank — the
// same bank the Medical room feeds ([room_zone.h] TABLE 2), so a medic in a ward
// stacks with the ward instead of inventing a second heal path. 3 HP/s is ~2× the
// ward's own rate on a 100-max body: a person beats a room.
inline constexpr float kMedicReachM        = 2.0f; // metres, one macro cell
inline constexpr float kMedicThreshold     = 0.6f; // heal below this hp fraction
inline constexpr float kMedicHealPerSec    = 3.0f; // HP bank credit /s per patient
inline constexpr float kMedicFatiguePerSec = 0.5f; // medic's sleep cost /s per patient

} // namespace giga::game
