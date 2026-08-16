// Faction relations — who tolerates whom, and who shoots on sight.
//
// [faction.h] ports the five societies and their colours. This ports the part that
// makes them matter: a 6x6 signed matrix, mutable at runtime, that decides whether
// two bodies in a corridor walk past each other or fight.
//
// **The sixth row is the PLAYER, not samosbor.** Samosbor is a territory owner with
// no diplomacy — it holds ground and colour (#e64e5c, reserved, see faction.h) and
// has no matrix row at all. Monsters are likewise not a row: they get a separate
// fixed vector, because a monster's disposition never changes.
//
// The player gets a row without becoming a singleton, which is the whole trick: the
// row is selected by the `NpcPlayer` bit on an ordinary record ([npcs.md]), so
// "the player" is still just whichever record currently carries it. Possess a new
// body after death and the row follows the bit, not a pointer.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "core/math.h"           // vec3
#include "core/tick.h"           // kSimHz / kSimStepMs — never a bare 120 or 1/120
#include "ecs/registry.h"        // Registry, Entity, entt::null
#include "game/event_bus.h"      // EventBus, EventType::RelationChanged
#include "game/faction.h"
#include "game/npc_pool.h"
#include "world/gravity.h"       // GravityField — names the feud's walking plane
#include "world/level_stack.h"   // LayerId

namespace giga::game {

// The matrix is one wider than there are factions: five societies plus the player.
inline constexpr std::size_t kRelFactionCount = kFactionCount + 1;
inline constexpr std::uint8_t kFactionPlayerRow =
    static_cast<std::uint8_t>(kFactionCount);   // index 5
static_assert(kRelFactionCount == 6, "five factions plus the player row");

// Hostile at **-50 or below**, and the boundary is inclusive.
inline constexpr std::int8_t kHostileRelation = -50;

// Signed relation, clamped to the int8 range on every mutation. Row-major
// `a * kRelFactionCount + b`, and the matrix is kept symmetric by construction —
// every mutator writes both cells, because a one-sided grudge has no meaning here.
// 36 bytes, POD, trivially copyable: it serializes with the world verbatim.
struct FactionRelations {
    std::int8_t v[kRelFactionCount * kRelFactionCount];

    std::int8_t& at(std::uint8_t a, std::uint8_t b) {
        return v[static_cast<std::size_t>(a) * kRelFactionCount + b];
    }
    std::int8_t at(std::uint8_t a, std::uint8_t b) const {
        return v[static_cast<std::size_t>(a) * kRelFactionCount + b];
    }
    bool hostile(std::uint8_t a, std::uint8_t b) const {
        return at(a, b) <= kHostileRelation;
    }

    // Shift a pair by `delta`, both ways, clamped. Returns the new value.
    std::int8_t add_mutual(std::uint8_t a, std::uint8_t b, int delta);

    // Restore the authored starting matrix.
    void reset();

    // Rebirth: wipe ONLY the player's row and column back to their authored values
    // — 11 of the 36 cells — and leave the other 25 exactly as the world has bent
    // them. Faction-to-faction politics are the world's memory and must survive;
    // the reborn actor simply is not recognised as the player yet.
    void reset_player_row_col();
};
static_assert(sizeof(FactionRelations) == 36);

// Shift relations between player and a given faction by `delta`.
inline std::int8_t relations_nudge_player(FactionRelations& rel, Faction f, int delta) {
    return rel.add_mutual(kFactionPlayerRow, static_cast<std::uint8_t>(f), delta);
}

// The authored starting matrix.
extern const FactionRelations kBaseFactionMatrix;

// Monsters' fixed disposition toward each faction. Not a matrix row.
extern const std::int8_t kMobVsFaction[kRelFactionCount];

// Which matrix row a record occupies (promotes player to row 5).
std::uint8_t rel_row(const NpcPool& pool, NpcId id);

// Which faction row a record's BODY belongs to, ignoring the player bit.
std::uint8_t body_row(const NpcPool& pool, NpcId id);

// Would a monster attack this record?
bool mob_hostile_to(const NpcPool& pool, NpcId id);

// ===========================================================================
// Faction War States and Territorial Disputes
// ===========================================================================

enum class FactionWarState : std::uint8_t {
    Peace = 0,        // Peaceful baseline
    Tension,          // Latent friction, verbal hostility
    BorderSkirmish,   // Local skirmishes and corridor brawls
    OpenWar,          // Full-scale lethal warfare, kill-on-sight
    Ceasefire         // Exhaustion truce after heavy losses
};

const char* faction_war_state_name_ru(FactionWarState state);

// Territorial dispute record per floor
struct FloorWarRecord {
    std::int16_t floorZ = 0;
    Faction dominant = Faction::Citizens;
    Faction challenger = Faction::Citizens;
    FactionWarState warState[kFactionCount][kFactionCount] = {};
    std::uint32_t casualties[kFactionCount] = {};
    std::uint32_t pairwiseCasualties[kFactionCount][kFactionCount] = {};
    std::uint32_t totalCasualties = 0;
    float disputeIntensity = 0.0f; // 0.0f to 1.0f
    bool underContest = false;
    std::uint64_t lastStateChangeTick = 0;
};

// Manager for territorial disputes and war state transitions across floors
class TerritoryWarManager {
public:
    void init();

    FloorWarRecord& get_or_create(std::int16_t floorZ);
    const FloorWarRecord* find(std::int16_t floorZ) const;

    // Record casualty on a floor; triggers war state transitions when thresholds are met
    bool record_casualty(FactionRelations& rel, std::int16_t floorZ,
                         Faction victimFaction, Faction killerFaction,
                         std::uint64_t tick, FactionWarState* outNewState = nullptr);

    // Is there an active open war between two factions on this floor?
    bool is_open_war(std::int16_t floorZ, Faction a, Faction b) const;

    // Check if challenger overwhelmed defenders and flipped dominant faction
    bool evaluate_territory_shift(const NpcPool& pool, std::int16_t floorZ,
                                 Faction* outNewDominant = nullptr);

    // Advance recovery & ceasefire timers
    void step(std::uint64_t tick, std::uint32_t daysPassed);

private:
    std::array<FloorWarRecord, kFloorSlots> floors_{};
    std::array<bool, kFloorSlots> active_{};
};

TerritoryWarManager& global_territory_war_manager();

// ===========================================================================
// NPC-vs-NPC hostility
// ===========================================================================

bool bodies_hostile(const FactionRelations& rel, const NpcPool& pool, NpcId a,
                    NpcId b);

inline constexpr float kFeudRadius = 8.0f;
inline constexpr std::uint32_t kFeudPeriod = 8;
inline constexpr std::uint64_t kFeudEpochTicks =
    static_cast<std::uint64_t>(kSimHz) * 20u;
inline constexpr std::uint32_t kFeudShare = 64;
inline constexpr int kFeudMinHpPct = 50;
inline constexpr int kKillRelationDelta = -10;

bool npc_seeks_fight(std::uint32_t bodyId, std::uint64_t tick);

struct FactionFoe {
    Entity e = entt::null;
    NpcId id = kInvalidNpc;
    vec3 pos{0, 0, 0};
};

FactionFoe nearest_faction_foe(const Registry& reg, const NpcPool& pool,
                               const FactionRelations& rel, LayerId layer,
                               Entity self, NpcId selfId, const vec3& from,
                               float radius);

class AiMemory;
std::uint32_t faction_feud_step(Registry& reg, NpcPool& pool,
                                const FactionRelations& rel, LayerId layer,
                                std::uint64_t tick,
                                const GravityField* gravity = nullptr,
                                AiMemory* mem = nullptr,
                                double now = 0.0);

struct RelationTick {
    std::uint32_t kills = 0;    // NpcDied events with a resolvable PERSON as killer
    std::uint32_t changes = 0;  // pairs actually shifted
    std::uint8_t lastA = 0;     // the pair from the last change...
    std::uint8_t lastB = 0;
    std::int8_t lastValue = 0;  // ...and its new relation value
    std::uint8_t pad_ = 0;
    std::uint32_t warTransitions = 0; // War state transitions triggered
};

RelationTick relations_drain_deaths(FactionRelations& rel, const Registry& reg,
                                   const NpcPool& pool, EventBus& bus,
                                   std::uint64_t tick,
                                   std::int16_t currentFloor = 0);

} // namespace giga::game
