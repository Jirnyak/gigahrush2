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

#include <cstddef>
#include <cstdint>

#include "game/faction.h"
#include "game/npc_pool.h"

namespace giga::game {

// The matrix is one wider than there are factions: five societies plus the player.
inline constexpr std::size_t kRelFactionCount = kFactionCount + 1;
inline constexpr std::uint8_t kFactionPlayerRow =
    static_cast<std::uint8_t>(kFactionCount);   // index 5
static_assert(kRelFactionCount == 6, "five factions plus the player row");

// Hostile at **-50 or below**, and the boundary is inclusive.
//
// This is the single most breakable line in the file. Every Wild cell in the base
// matrix is exactly -50, so a strict `<` would leave the matrix with **zero**
// hostile pairs and the entire system would silently do nothing at all — no error,
// no warning, just a building where nobody ever fights. `test_faction_relations`
// counts the hostile pairs and asserts exactly 6 for precisely this reason.
inline constexpr std::int8_t kHostileRelation = -50;

// Signed relation, clamped to the int8 range on every mutation. Row-major
// `a * kRelFactionCount + b`, and the matrix is kept symmetric by construction —
// every mutator writes both cells, because a one-sided grudge has no meaning here
// (there is no "A hates B but B is fine with it" mechanic).
//
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

// The authored starting matrix. Readable as fiction, which is the point:
//   * Citizens / Liquidators / Scientists are a civil bloc at +50.
//   * Cultists are cold-neutral (0) to Citizens — they live *among* them, they are
//     not an outside enemy — but at -50 with Liquidators, who police the building.
//   * Wild are at -50 with everyone including the player. Every one of those cells
//     sits exactly on the hostility boundary; see kHostileRelation.
extern const FactionRelations kBaseFactionMatrix;

// Monsters' fixed disposition toward each faction. Not a matrix row, because it
// never changes. **Cultists are +50** — the one faction monsters never attack,
// which is the reference's fiction rather than a balance knob.
extern const std::int8_t kMobVsFaction[kRelFactionCount];

// Which matrix row a record occupies. This is the one mechanism that gives the
// player a row without a player singleton: it is the NpcPlayer bit, not an id or a
// pointer, that selects row 5.
std::uint8_t rel_row(const NpcPool& pool, NpcId id);

// Which faction row a record's BODY belongs to, ignoring the player bit.
//
// Distinct from `rel_row` and the difference is load-bearing. `rel_row` deliberately
// promotes the player to row 5, because the player has their own diplomatic standing
// with each society. **A monster does not care who is driving.** It cares what body is
// in front of it — so anything asking "is this prey" must ask the body, not the
// occupant, or the player row shadows the faction and the answer is always the same.
//
// That shadowing was a live bug: `mob_hostile_to` went through `rel_row`, so a player
// wearing a Cultist body resolved to row 5 (-100, hunted) instead of the Cultist row
// (+50, ignored). The "wear the right body" mechanic could never once have fired, and
// the HUD printed the body's faction while the gate read the player's — the two
// disagreed on screen and nothing else would have noticed.
std::uint8_t body_row(const NpcPool& pool, NpcId id);

// Would a monster attack this record? Convenience over kMobVsFaction, resolved
// through `body_row` and NOT `rel_row` — see above.
bool mob_hostile_to(const NpcPool& pool, NpcId id);

} // namespace giga::game
