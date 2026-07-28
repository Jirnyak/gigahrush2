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
//
// ---------------------------------------------------------------------------
// **The matrix was dead until 2026-07-29, and the audit trail is in this tree.**
// combat.cpp's own comment says it: "an audit found FactionRelations had zero
// readers outside its own tests, so the 36 bytes were being maintained for
// nobody." That audit wired ONE gate — `mob_hostile_to`, which reads the separate
// fixed `kMobVsFaction` vector and never touches the matrix at all. So the fix
// consumed the row that cannot change and left the five mutators, `rel_row` and
// `kBaseFactionMatrix` with no caller anywhere in `src/`.
//
// What was missing was not a reader, it was the MECHANIC: NPC-vs-NPC hostility did
// not exist. A monster hunted the crowd ([hunt.h]) and the crowd walked past its own
// enemies. The bottom half of this file is that mechanic — `bodies_hostile`,
// `nearest_faction_foe`, `faction_feud_step` — plus the one thing that makes a
// mutable matrix worth having over a constant table: `relations_drain_deaths`,
// which bends the rows in response to who killed whom, so a kill has a
// consequence that outlives the corpse.
#pragma once

#include <cstddef>
#include <cstdint>

#include "core/math.h"           // vec3
#include "core/tick.h"           // kSimHz / kSimStepMs — never a bare 120 or 1/120
#include "ecs/registry.h"        // Registry, Entity, entt::null
#include "game/event_bus.h"      // EventBus, EventType::RelationChanged
#include "game/faction.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"   // LayerId

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

// ===========================================================================
// NPC-vs-NPC hostility — the mechanic the matrix was written for
// ===========================================================================

// Do these two records fight when they meet?
//
// Resolved through `rel_row` on BOTH sides, and that is the deliberate opposite of
// `mob_hostile_to`'s choice. A monster asks what body is in front of it, so it uses
// `body_row`. A person asks who they are dealing with diplomatically, and the player
// has their own standing with each society — so wearing a Cultist body does not make
// the Liquidators forget what you did. That asymmetry is the entire reason both row
// functions exist, and this is the first caller of `rel_row` outside a test.
//
// An invalid id is NOT hostile and is not folded to Citizens either. `rel_row`
// returns row 0 for an invalid record, which would silently make every dangling id
// a citizen; a dangling id must decide nothing at all.
bool bodies_hostile(const FactionRelations& rel, const NpcPool& pool, NpcId a,
                    NpcId b);

// --- rate control ----------------------------------------------------------
//
// The shape is [hunt.h]'s and for the same reason. That file's arithmetic is
// decisive and applies here twice over: a Residential floor carries 420 residents,
// and a Residential faction mix of {7,1,1,0,1} puts ~42 of them in Wild, which is
// at -50 with every other row. If every hostile pair in the same room fought,
// hundreds of concurrent brawls would start on load — and nothing heals a crowd
// body ([needs.h] ticks only the camera holder's row), so every point of damage is
// permanent. Restraint is therefore SCARCITY OF AGGRESSORS, exactly as it is for
// predation, plus one hard rule the monsters do not get (see faction_feud_step).

// How close two bodies must be before either takes an interest, metres.
//
// 8 m = four macro cells, "the same room or one doorway away". Sized against the
// placement lattice rather than to taste: `seed_floor_from_spec` puts records on
// interior offsets {3,6,9,12} cells inside a 16-cell room, so the nearest
// room-mate is 3 cells = 6 m away. A radius under 6 m would mean a Wild resident
// standing beside a Citizen never notices them and the feature is invisible on the
// floor it is most likely to be seen on.
inline constexpr float kFeudRadius = 8.0f;

// Visits per stagger cycle, i.e. an agent is looked at once every N ticks.
//
// 8, the same as [wander.h]'s kWanderPeriod, and duplicated rather than shared for
// the reason `mix()` is duplicated in four files here: one constant, wanted
// inlined, and depending on wander.h would drag world/nav.h and macro_grid.h into
// every translation unit that only wanted the faction matrix.
inline constexpr std::uint32_t kFeudPeriod = 8;

// Sim ticks a body holds its licence to look for a fight. 20 s at the shipping
// tick, derived from kSimHz so it cannot drift when the rate changes.
//
// Deliberately the same order as [hunt.h]'s kHuntEpochTicks (19.2 s): a brawl that
// breaks off after twenty seconds reads as a fight rather than a duel to the death,
// and — unlike predation — a short window costs nothing here, because a feud can
// never take a crowd body's last hit point. The "abandoned half-kill" failure
// hunt.h warns about cannot happen.
inline constexpr std::uint64_t kFeudEpochTicks =
    static_cast<std::uint64_t>(kSimHz) * 20u;

// One body in this many is looking for a fight at any moment.
//
// THE rate knob, and it is NOT a measured figure the way hunt.h's kHuntShare is —
// hunt.h's value came from a ten-minute survivor count and this one has had no such
// run. It is derived instead: 64 puts ~6.5 of a 420-body Residential floor in a
// brawl at once, about a third of the 18 concurrent hunts hunt.h settled on, which
// keeps the feud visible without making it the loudest thing on the floor. The
// number that makes the choice SAFE is not this one — it is the non-lethal floor in
// faction_feud_step. Change that and this needs a measured survivor count first.
inline constexpr std::uint32_t kFeudShare = 64;

// The share of its own max HP below which a feud will not push a crowd body, in
// percent. Half, and the number is chosen against [hunt.h] rather than against feel.
//
// A hard floor of 1 HP was the first version and it is WRONG for a reason that only
// shows up in the interaction: nothing heals a resident, so every body a brawl
// touched would sit at 1 HP forever, and hunt.h's median monster (13 damage on a
// 1.55 s cooldown) kills a 1 HP body on its first swing instead of its eighth. The
// feud would not have killed anybody itself while quietly multiplying the measured
// predation rate the hunt licence exists to bound. At 50% a beaten resident still
// absorbs four monster swings instead of eight — a 2x acceleration on the ~6.5
// bodies in a brawl at any moment, not on the floor.
//
// This interaction has NOT been re-measured with a survivor count. If this value or
// kFeudShare moves, re-run test_hunt_all's ten-minute floor first.
inline constexpr int kFeudMinHpPct = 50;

// What one death does to the two rows involved, per kill.
//
// -10 and the arithmetic is the point: Player-vs-Citizens starts at +50, so the
// TENTH citizen you murder lands the pair on exactly -50 — which IS hostile,
// because the boundary is inclusive (kHostileRelation). Ten is a number a player
// can feel accumulating, and the exact landing on the boundary is deliberate: it
// exercises the one comparison this file says is the most breakable line in it.
inline constexpr int kKillRelationDelta = -10;

// Is this body looking for a fight right now?
//
// Pure, O(1), stateless — the same identity-hash licence as `mob_hunts_npcs`, with
// its own salts so the two cohorts are independent. The epoch is offset by the
// body's own identity so licences turn over continuously instead of the whole floor
// swapping on one tick, and so every body gets a FULL window rather than whatever
// remained of a globally aligned one.
bool npc_seeks_fight(std::uint32_t bodyId, std::uint64_t tick);

// The nearest body this one would fight, or a null entity.
struct FactionFoe {
    Entity e = entt::null;
    NpcId id = kInvalidNpc;
    vec3 pos{0, 0, 0};
};

// Nearest embodied, hostile, not-already-dying record within `radius` of `from` on
// `layer`, excluding `self`.
//
// The camera holder is deliberately NOT excluded (unlike `nearest_prey`, which
// leaves it to the caller's longer-ranged rule). A society hostile to your row
// should fight YOU, and after ten murders `relations_drain_deaths` makes that
// happen — that is the whole payoff of a mutable matrix.
//
// Read-only: takes a const Registry and touches no component that could be
// created, so it is safe to call from inside another view's iteration. Same
// structural argument `nearest_prey` makes, and `faction_feud_step` relies on it.
FactionFoe nearest_faction_foe(const Registry& reg, const NpcPool& pool,
                               const FactionRelations& rel, LayerId layer,
                               Entity self, NpcId selfId, const vec3& from,
                               float radius);

// One staggered NPC-vs-NPC pass: bodies holding a fight licence steer at their
// nearest enemy and swing at it when it is in reach.
//
// **Steering and swinging in one function, and it writes Velocity.** That is a
// layering compromise with a stated reason: the alternative is threading a
// `const FactionRelations&` through `wander_step`, which changes its signature at
// six call sites including the shared test seam. This runs AFTER `wander_step` and
// overrides its velocity for the handful of licensed bodies, which is exactly the
// override wander.cpp already performs internally when a mob aggroes. If the steer
// ever moves into wander.cpp, delete the velocity write here and keep the rest.
//
// **A feud can never kill a crowd body**, and this is the rule that makes the
// feature safe to switch on. Damage against a body that is not the camera holder is
// floored at hp-1 — the same clamp `apply_consumable` uses for questionable food,
// for the same reason: nothing in the game heals a resident, so a lethal feud is a
// one-way population drain with no counterplay. The camera holder IS killable,
// because the player has healing, resupply and possession-on-death.
//
// Placed after wander_step and before physics_step. Reach is therefore tested
// against pre-integration positions, which is a 1 cm error at a 1.35 m/s walk over
// one 8 ms step — three orders of magnitude inside the 1.9 m unarmed reach, so it
// does not earn a second function the way mob_attack_step's post-physics placement
// does.
//
// Two-phase, and it is a crash fix rather than a style choice: `apply_damage` can
// `emplace<Dead>`, EnTT creates that storage on the first one, and creating a
// storage can reallocate the pool container the live view is holding. Phase 1
// records intent, phase 2 applies it. Same discipline as mob_attack_step,
// finalize_deaths and pickup_step.
//
// Returns the number of feud hits that landed.
std::uint32_t faction_feud_step(Registry& reg, NpcPool& pool,
                                const FactionRelations& rel, LayerId layer,
                                std::uint64_t tick);

// What one drain of the death events did to the matrix. Returned rather than only
// published, so a HUD can print it without the caller having to re-scan the ring.
struct RelationTick {
    std::uint32_t kills = 0;    // NpcDied events with a resolvable PERSON as killer
    std::uint32_t changes = 0;  // pairs actually shifted
    std::uint8_t lastA = 0;     // the pair from the last change...
    std::uint8_t lastB = 0;
    std::int8_t lastValue = 0;  // ...and its new relation value
    std::uint8_t pad_ = 0;
};

// Read this cycle's `NpcDied` events and bend the matrix by who killed whom.
//
// This is what makes the matrix worth being mutable instead of a constant table:
// kill ten citizens and the Citizens row crosses the hostility boundary, at which
// point `bodies_hostile` starts returning true for every citizen in the building
// and `faction_feud_step` turns the crowd on you. A rumour, a contract kill and a
// panicked shot in a corridor all now cost something that outlives the corpse.
//
// Publishes one `RelationChanged` per shifted pair (`a` = row A, `b` = row B,
// `c` = the new value, see event_relation), which is that enum value's first and
// only producer.
//
// Only a PERSON's kill counts. `NpcDied` carries the killer as an ENTITY id, so the
// killer's faction is resolved by looking up `NpcRef` on it: a monster carries none
// and is skipped, which is correct — a monster eating a citizen is not diplomacy.
//
// Call it AFTER `finalize_deaths` and before `EventBus::clear()`. Snapshot-bounded:
// it reads `size()` once up front, so the RelationChanged events it publishes do not
// re-enter its own loop. The ring's data pointer is stable across publish
// ([event_bus.h] events()), so publishing while reading is safe here.
//
// **Known imprecision, stated rather than hidden.** When the VICTIM was the player,
// `NpcPool::kill` has already cleared its NpcPlayer bit (npc_pool.cpp does this on
// purpose, to stop dead rows resolving to row 5 forever), so the victim resolves by
// body faction and not to the player row. The direction that matters — the player as
// KILLER, whose bit is still set because they are alive — is exact.
RelationTick relations_drain_deaths(FactionRelations& rel, const Registry& reg,
                                   const NpcPool& pool, EventBus& bus,
                                   std::uint64_t tick);

} // namespace giga::game
