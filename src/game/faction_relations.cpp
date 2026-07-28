#include "game/faction_relations.h"

namespace giga::game {

namespace {

constexpr std::uint8_t C = static_cast<std::uint8_t>(Faction::Citizens);
constexpr std::uint8_t L = static_cast<std::uint8_t>(Faction::Liquidators);
constexpr std::uint8_t K = static_cast<std::uint8_t>(Faction::Cultists);
constexpr std::uint8_t S = static_cast<std::uint8_t>(Faction::Scientists);
constexpr std::uint8_t W = static_cast<std::uint8_t>(Faction::Wild);
constexpr std::uint8_t P = kFactionPlayerRow;

std::int8_t clamp8(int v) {
    if (v > 127) v = 127;
    if (v < -128) v = -128;
    return static_cast<std::int8_t>(v);
}

} // namespace

// Rows/columns in Faction order, then the player.
//
//            Cit   Liq   Cul   Sci   Wild  Player
//   Cit       100   +50     0   +50   -50    +50
//   Liq       +50   100   -50   +50   -50    +25
//   Cul         0   -50   100   -20   -50      0
//   Sci       +50   +50   -20   100   -50    +25
//   Wild      -50   -50   -50   -50   100    -50
//   Player    +50   +25     0   +25   -50    100
//
// Self-relations are +100 and never consulted; they exist so the matrix is square
// and a self-comparison can never read as hostile.
const FactionRelations kBaseFactionMatrix = {{
    /* Cit    */ 100,  50,   0,  50, -50,  50,
    /* Liq    */  50, 100, -50,  50, -50,  25,
    /* Cul    */   0, -50, 100, -20, -50,   0,
    /* Sci    */  50,  50, -20, 100, -50,  25,
    /* Wild   */ -50, -50, -50, -50, 100, -50,
    /* Player */  50,  25,   0,  25, -50, 100,
}};

// Monsters vs each faction. Cultists at +50 are the one society monsters leave
// alone — fiction, not balance. Everyone else is squarely hostile.
const std::int8_t kMobVsFaction[kRelFactionCount] = {
    /* Citizens    */ -80,
    /* Liquidators */ -80,
    /* Cultists    */ +50,
    /* Scientists  */ -80,
    /* Wild        */ -60,
    /* Player      */ -100,
};

std::int8_t FactionRelations::add_mutual(std::uint8_t a, std::uint8_t b, int delta) {
    if (a >= kRelFactionCount || b >= kRelFactionCount) return 0;
    const std::int8_t nv = clamp8(at(a, b) + delta);
    at(a, b) = nv;
    at(b, a) = nv;   // symmetric by construction; there are no one-sided grudges
    return nv;
}

void FactionRelations::reset() { *this = kBaseFactionMatrix; }

void FactionRelations::reset_player_row_col() {
    for (std::uint8_t i = 0; i < kRelFactionCount; ++i) {
        at(P, i) = kBaseFactionMatrix.at(P, i);
        at(i, P) = kBaseFactionMatrix.at(i, P);
    }
}

std::uint8_t rel_row(const NpcPool& pool, NpcId id) {
    // const_cast: NpcPool's accessors are non-const by design (it is an SoA table
    // meant to be written through), but this is genuinely a read.
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(id)) return C;
    if (p.is_player(id)) return P;
    const std::uint16_t f = p.faction(id);
    return static_cast<std::uint8_t>(f % kFactionCount);
}

std::uint8_t body_row(const NpcPool& pool, NpcId id) {
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (!p.valid(id)) return C;
    // No is_player() check, deliberately: this is the body's own faction.
    return static_cast<std::uint8_t>(p.faction(id) % kFactionCount);
}

bool mob_hostile_to(const NpcPool& pool, NpcId id) {
    return kMobVsFaction[body_row(pool, id)] <= kHostileRelation;
}

} // namespace giga::game
