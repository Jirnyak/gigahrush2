// Per-kind monster TRAITS — one flat row per monster kind, several readers.
//
// The reference (`../gigahrush`) splits this material across seven files
// (`src/systems/monster_traits.ts`, `monster_armor.ts`, `monster_drops.ts`,
// `monster_counterplay.ts`, `monster_terrain.ts`, `monster_bait.ts`,
// `src/systems/ai/monster_pack.ts`) plus a scattering of `switch (e.monsterKind)`
// arms inside `monsterMoveMult` / `monsterDmgMult`. That split is not a design; it
// is where each mechanic happened to be written. Here it is ONE generated table
// with several readers, because every one of those files answers the same question
// — "what is different about this KIND?" — and the answers are all per-kind scalars.
//
// ---------------------------------------------------------------------------
// WHAT ALREADY EXISTED, so nothing here duplicates it
// ---------------------------------------------------------------------------
// Read before adding a column. Four of the seven reference files are wholly or
// partly answered on this side already, and re-porting them would have produced a
// second table that disagrees with the first:
//
//   monster_drops.ts        ALREADY COVERED, in full, by [loot_table.h]. All 136
//                           authored `rareDrops` rows across all 69 kinds landed
//                           there, wired through `drop_mob_loot`'s existing roll.
//                           NOTHING about drops is in this file.
//   monster_pack.ts         The GROUPING half is covered — `MobDef::packMode /
//                           packMin / packMax / packSpread` ([mob_table.h]) plus
//                           `pack_target_node` ([wander.h]) already spawn and steer a
//                           pack as one. The TARGET-SHARE half (`shareLocalTarget`)
//                           is NOT portable and is not attempted: see the note at
//                           the bottom of this header.
//   monster_traits.ts       Панельник's wall brace is ALREADY HERE —
//                           `behaviour_incoming_mult(WallBrace, adjacentWall)` in
//                           [mob_behaviour.h] is exactly the reference's
//                           `PANELNIK_WALL_BRACE_DAMAGE_MULT` 0.58, and
//                           `behaviour_melee_reach` is its braced reach. So Панельник
//                           gets NO row in `data/monster_traits.csv` and no resist
//                           vector. Giving it one would stack 0.58 x 0.58.
//   monster_armor.ts        Authors armour for exactly FOUR kinds. One of them is
//                           Панельник (above), one is ЧЕРВИЕ (blocked: needs
//                           SCREEN/APPARATUS features in the grid). The remaining
//                           two land here — see `resist` and `wetIncomingX100`.
//
// The three that were genuinely unanswered, and are what this file is for:
//
//   monster_terrain.ts      The WET/DRY query and every kind's pace, damage,
//                           mitigation and regeneration keyed on it.
//                           [mob_behaviour.h]'s roadmap files five behaviours under
//                           "A WET/FLUID CELL QUERY (src/sim/fluid.h exists; no
//                           per-cell 'is this wet' hook)" — `cell_wet` below is that
//                           hook, and `AiFlag::WaterStrider` (2 kinds) had no reader
//                           at all.
//   monster_counterplay.ts  Fire against the four kinds fire is authored to answer.
//                           A MINIMUM damage as a fraction of maxHp, which is not
//                           expressible as a resist and which nothing here had.
//   monster_armor.ts        Закаленная Арматура's plate armour, the file's headline,
//                           and Лоточник's wet drain armour.
//
// ---------------------------------------------------------------------------
// ARMOUR RIDES THE EXISTING COMPONENT, and that is the whole point
// ---------------------------------------------------------------------------
// [combat.h] already carries `Armour { std::int8_t resist[5] }` and `apply_damage`
// already mitigates through it, exactly once, at the single damage entry point. The
// resist vector for a monster kind is therefore stored in the SAME units and the SAME
// order (`DamageChannel`: Kinetic, Buckshot, Energy, Fire, Psi) and installed on a
// spawned mob by `sync_monster_armour`, the mirror of `sync_armour` for an inventory
// holder. Consequences, all deliberate:
//
//   * `apply_damage` needs ZERO changes. Monster armour is not a second mitigation
//     path, so the "one damage function" defect [combat.h] is built around cannot be
//     reintroduced;
//   * a resist of 0 is free — `sync_monster_armour` attaches nothing, so 68 of 69
//     kinds carry no component and pay nothing;
//   * `mitigate` clamps to 95% and treats a NEGATIVE resist as a vulnerability, so
//     both directions are already expressible.
//
// **The honest divergence, stated up front because it is the biggest one in the
// file.** The reference's Закаленная Арматура armour is STATEFUL: three plates, a
// heavy hit strips one (0.68 through the plate), a weak hit chips at 7% toward a
// 24-point threshold (0.28 through the plate), and once the plates are gone damage is
// x0.92 and then unmitigated. A flat resist vector reproduces the WEAK steady state
// exactly (0.28 -> resist 72) and makes the heavy path permanently 0.68 instead of
// "0.68 three times, then 1.0". Measured against its 265 base HP with a 40-point
// heavy hit: the reference needs ~7.6 hits, this needs 9.7 — 28% tougher against
// heavy weapons. Against weak hits the two are identical, so the AUTHORED
// COUNTERPLAY is preserved in direction and magnitude (a heavy weapon is 2.4x better
// than a weak one either way); what is lost is the reward for finishing the strip.
// Restoring it needs per-monster state written from inside `apply_damage`, which is a
// change to a function this module deliberately does not touch.
//
// ---------------------------------------------------------------------------
// THE BLOCKER ON WIRING THIS, and it is not in this file
// ---------------------------------------------------------------------------
// **Every damage site in the tree passes `DamageChannel::Kinetic`.** Measured
// 2026-07-29 — seven call sites (combat.cpp x4, main.cpp x2, faction_relations.cpp x1)
// and all seven are Kinetic. `Buckshot`, `Energy`, `Fire` and `Psi` exist in the enum,
// are carried by five armour items in `data/items.csv`, and are produced by NOTHING.
// Neither `data/weapons_melee.csv` (23 rows) nor `data/weapons_ranged.csv` (29 rows)
// has a channel column.
//
// Two consequences, and both have to be said before anyone calls
// `sync_monster_armour` from a spawner:
//
//   1. **The fire counterplay below cannot fire in the running game.** It is correct,
//      tested and unreachable, because no source produces `DamageChannel::Fire`. That is
//      an upstream gap, not a defect here, and it is the honest state of the mechanic.
//   2. **Installing Закаленная Арматура's resist vector TODAY makes it 0.28 against
//      everything, including the shotgun that is supposed to be its answer** — where the
//      reference gives a shotgun 0.68 and then 1.0 once the plates are off. So the wire
//      is more faithful on the axis the kind is designed around (a knife or a pistol
//      genuinely stops mattering) and 2.4x too tough on the axis that is its
//      counterplay. Shipping half of that is worse than shipping neither: a monster
//      whose counter-weapon does not work is the "HP-only addition" monsters.md rejects.
//
// So the spawn wire and a channel are ONE change, and the channel is already derivable
// from data the weapon tables ship: `pellets > 1` identifies all 7 shotguns
// (shotgun 7, toz_shotgun 8, chizh3_shotgun 8, conscripts_doublebarrel 7,
// rb91_auto_shotgun 9, granit4u_belt_shotgun 12, pushkin_shotgun 6), and the melee
// catalog already contains the reference's exact `ARMOR_STRIP_WEAPONS` names — axe,
// liquidator_axe, chainsaw, crowbar, sledgehammer, metal_chair — plus its
// `ARMOR_TOOL_WEAPONS` fire_hook and rebar. Nothing has to be invented; a channel has to
// be chosen at the shot and the swing.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "core/math.h"          // vec3, for pos_wet
#include "ecs/registry.h"       // Registry / Entity, for sync_monster_armour
#include "game/mob_table.h"     // MobKind, kMobKindCount

namespace giga::game {

// ---------------------------------------------------------------------------
// Terrain preference — a SPAWN rule, and the one derived column in the table
// ---------------------------------------------------------------------------
// Every other number in this file is copied from the reference. This one is DERIVED,
// and saying so matters: the reference places monsters by room type and has no
// concept of a wet spawn cell at all.
//
// What it fixes is a live contradiction on this side. `mob_spawn.cpp`'s `placeable`
// refuses ANY cell holding `>= kFluidMinFlow` of liquid, for a documented and correct
// reason (a sealed sump basin is a monster in a box). But six kinds carry an authored
// pace BONUS in water and an authored PENALTY out of it — Лоточник and Трубный угорь
// at x1.45 wet / x0.72 dry, Жижевая женщина x1.48, Водяной кошмар x1.16, Чернослиз
// x0.46 the moment it leaves its own water, Олгой x1.12 / x0.55. So the six kinds
// whose whole design is the water were the six kinds forbidden from spawning in it.
//
// `Wet` therefore means "standing water is a LEGAL spawn cell for this kind", not
// "prefer it over dry". That distinction is what keeps the change small: the air test
// in `placeable` is untouched, and today's sump basin cells are HALF-SOLID (see the
// `placeable` comment), so the air test alone still refuses the sealed basin. Opening
// the water test does not open the box.
enum class TerrainPref : std::uint8_t { Any = 0, Wet, Count };

// Bait classes a kind will walk toward. Copied verbatim from the reference's
// `BAIT_TRAITS_BY_ECOLOGY_TAG` (monster_bait.ts:70), which is the authored mapping
// from a monster's ecology tag to the bait traits it responds to.
//
// **Read the note on `trait_takes_bait` before assuming this is wired.** It is DATA
// plus a measured defect report, not a live mechanic — the bait MARKER subsystem
// (placement, TTL, attraction steering, consumption) is a separate lane.
enum class BaitBit : std::uint16_t {
    Food     = 1u << 0,   // bait_food     — any FOOD item
    Meat     = 1u << 1,   // bait_meat
    Fungal   = 1u << 2,   // bait_fungal
    Govnyak  = 1u << 3,   // bait_govnyak / the govnyak marker kind
    Document = 1u << 4,   // bait_document — papers, permits, stamps
    Starch   = 1u << 5,   // bait_starch
    Sugar    = 1u << 6,   // bait_sugar
    Stale    = 1u << 7,   // bait_stale
    Wet      = 1u << 8,   // bait_wet
    Risky    = 1u << 9,   // bait_risky / bad_batch
};

constexpr bool has_bait(std::uint16_t set, BaitBit bit) noexcept {
    return (set & static_cast<std::uint16_t>(bit)) != 0u;
}

// `MonsterTraits::vulnChannel` when a kind has no authored vulnerability. Not 0,
// because 0 is `DamageChannel::Kinetic` and would silently give all 69 kinds a
// kinetic floor of 0% — a condition that is indistinguishable from "authored" by
// reading the row.
inline constexpr std::uint8_t kNoVulnChannel = 0xFFu;

// Fixed-point one. Every multiplier column is stored x100 so the table is integral
// and bit-identical across builds, exactly as `MobDef` stores its fractional
// reference values in millis and tenths ([mob_table.h]).
inline constexpr std::uint16_t kTraitUnit = 100u;

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------
// POD, trivially copyable, no pointers, 24 bytes with no interior padding. The whole
// 69-row table is 1,656 B — permanently cache-resident beside kMobTable's 2,484 B.
//
// The resist vector is FIRST and in `DamageChannel` order because it is memcpy-shaped
// onto `Armour::resist` by `sync_monster_armour`; changing its width or order without
// changing `kDamageChannels` is what the static_assert in the generated table exists
// to stop.
struct MonsterTraits {
    // --- armour: the same units, order and width as combat.h Armour::resist ---
    std::int8_t resist[5];             //  0  % mitigation per DamageChannel; <0 = vulnerable
    // --- bytes -------------------------------------------------------------
    std::uint8_t terrain;              //  5  TerrainPref
    std::uint8_t vulnChannel;          //  6  DamageChannel, or kNoVulnChannel
    std::uint8_t vulnFloorPct;         //  7  minimum damage as % of maxHp; 0 = none
    // --- wet terrain: x100, so kTraitUnit means "no change" ----------------
    std::uint16_t wetMoveX100;         //  8  pace multiplier standing in liquid
    std::uint16_t dryMoveX100;         // 10  pace multiplier on dry cells
    std::uint16_t wetDmgX100;          // 12  OUTGOING melee multiplier, wet
    std::uint16_t dryDmgX100;          // 14  OUTGOING melee multiplier, dry
    std::uint16_t wetIncomingX100;     // 16  INCOMING multiplier while wet (drain armour)
    std::uint16_t wetRegenMilliHps;    // 18  HP/s * 1000 regenerated while wet
    std::uint16_t baitMask;            // 20  BaitBit bitmask
    std::uint8_t kind;                 // 22  MobKind; must equal the row index
    std::uint8_t authored;             // 23  1 = a CSV row exists, 0 = the default row
};
static_assert(sizeof(MonsterTraits) == 24, "MonsterTraits must stay a tight 24-byte row");
static_assert(alignof(MonsterTraits) == 2);
static_assert(std::is_trivially_copyable_v<MonsterTraits>);
static_assert(offsetof(MonsterTraits, wetMoveX100) == 8, "the byte prefix moved");

// How many rows `data/monster_traits.csv` authors. The other 47 kinds resolve to the
// default row and are NOT a gap — see `monster_traits_unauthored_reason` for why each
// one has no trait to port.
//
// Declared here, in the shape `tools/check_source_rules.cmake` rule 7 can regex, so a
// CSV edit without a regenerate fails the gate instead of shipping silently. That gate
// row is not yet added — see the handoff.
inline constexpr std::size_t kMonsterTraitRows = 21;
static_assert(kMonsterTraitRows < kMobKindCount,
              "a fully authored table would mean the default row is dead");

// Generated from data/monster_traits.csv by tools/gen_monster_traits.py into
// src/game/monster_traits_table.cpp. DENSE: one entry per MobKind, in kMobTable
// order, so a lookup is an array read and never a search. Do not hand-edit the
// generated .cpp; edit the CSV and regenerate.
extern const std::array<MonsterTraits, kMobKindCount> kMonsterTraits;

// The default row, for a kind the CSV does not author and for an out-of-range id.
// All multipliers kTraitUnit, no resist, no vulnerability, no bait, TerrainPref::Any.
const MonsterTraits& monster_traits_default();

// Read a kind's row. Bounds-tolerant: any kind >= kMobKindCount answers the default
// row rather than indexing out of range, the same defensive shape as `mob_loot`
// ([loot_table.h]) and `item_def`.
const MonsterTraits& monster_traits(std::uint8_t kind);

inline const MonsterTraits& monster_traits(MobKind k) {
    return monster_traits(static_cast<std::uint8_t>(k));
}

// How many rows the GENERATED table actually marks authored. Exists so the CSV row
// count is checkable from C++ as well as from the gate: the suite asserts it equals
// kMonsterTraitRows, which catches a regenerate that dropped a row and a header
// constant that was bumped without one.
std::size_t monster_trait_authored_count();

// True when every row's `kind` equals its index. Defined in the GENERATED table, so it
// checks the data as shipped rather than as intended; a false answer means
// `monster_traits(k)` is handing out another monster's traits.
//
// A runtime predicate rather than a static_assert because `kMonsterTraits` is a runtime
// `const std::array` with external linkage (matching `kMobTable` and `kItemTable`), and
// a constexpr function may not read one — MSVC C2131, measured. The suite asserts it,
// so it is a ctest failure instead of a compile failure.
bool monster_traits_rows_indexed();

// ---------------------------------------------------------------------------
// The wet query — the hook five behaviours were blocked on
// ---------------------------------------------------------------------------
// `src/sim/fluid.h` has had the field, the threshold and a toroidal read since it
// existed; what was missing was one named predicate, so every consumer would have
// re-derived "is this cell wet" against its own threshold. Named here so it cannot
// drift from `kFluidMinFlow`, which is the same argument [sim/fluid.h] makes for
// `kFluidField` itself.
//
// `medium` is `medium_level_data(world)` ([world/medium.h] — АГРЕГАТ
// мира-автомата, воду двигает только он; fluid-поле умерло чисткой
// 2026-08-24), resolved ONCE by the caller — nullptr = сухой слой, каждый
// запрос отвечает false без касания памяти. Raw pointer, не World&: то же
// горячее место, до 98,304 кандидатов на загрузке этажа.
//
// The reference's `wetTerrainCell` also counts a SINK or TOILET feature as wet
// (monster_terrain.ts:21). This engine has no furniture features, so only the liquid
// half is ported; a bathroom reads dry until it has water in it, which is the
// conservative direction.
bool cell_wet(const std::uint32_t* medium, int x, int y, int z);

// Same, from a world position. Converts to the macro cell the body stands in and
// wraps toroidally — x/y/z all wrap, so the conversion must go through wrap_macro and
// never a bare divide ([core/wrap.h]).
bool pos_wet(const std::uint32_t* medium, const vec3& pos);

// ---------------------------------------------------------------------------
// Terrain-keyed multipliers
// ---------------------------------------------------------------------------
// Pure functions of (kind, wet), so each is testable without a world, a registry or a
// tick — the same constraint [mob_behaviour.h] holds itself to, and for the same
// reason: nothing here can desynchronise from anything.
//
// **Precedence against [mob_behaviour.h], because two pace multipliers now exist and
// a caller that applied both would be wrong.** `behaviour_move_mult` and
// `wall_bias_speed` are keyed on WALL ADJACENCY; these are keyed on WATER. They are
// disjoint by construction over the shipped table and the suite asserts it: no kind
// carries both a wall-keyed pace and a wet-keyed pace. So a caller may multiply both
// in without a claim flag — but only because the data says so, not because the shapes
// allow it, which is why the assertion exists rather than a comment.
//
// Returns exactly 1.0f for the 47 unauthored kinds and for the authored kinds whose
// column is kTraitUnit, so a caller pays one array read and one multiply by one.
float trait_move_mult(std::uint8_t kind, bool wet);

// OUTGOING melee multiplier. Ползун is the only kind whose authored value is a wet
// BONUS with no dry penalty (x1.35 in a doorway, bathroom or water — the reference's
// `inPolzunKillCell`), and only the water third of that predicate is available here.
float trait_damage_mult(std::uint8_t kind, bool wet);

// INCOMING multiplier while standing in liquid — Лоточник's `drainArmor`, x0.58.
//
// This is the one mitigation in the file that CANNOT ride the `Armour` component,
// because it is conditional on where the monster is standing and `Armour` is a static
// vector installed at spawn. It therefore needs a caller inside the damage path; see
// the handoff. Until it has one, Лоточник's wet armour is a query with no reader, and
// that is stated rather than implied.
float trait_incoming_mult(std::uint8_t kind, bool wet);

// HP per second regenerated while standing in liquid. 1.35 for Лоточник, 0 for
// everything else.
//
// Exposed as a RATE and not as a step function on purpose: applying it would write
// `MobRef::hp`, and a new writer of a value the damage path owns is exactly the class
// of bug [ai.h]'s single-writer rule exists to prevent. The caller that owns HP
// applies it; this only answers how fast.
float trait_wet_regen_hps(std::uint8_t kind);

// ---------------------------------------------------------------------------
// Counterplay — a damage FLOOR, which no existing mechanism can express
// ---------------------------------------------------------------------------
// Four kinds are authored to die to fire regardless of the weapon's damage, and the
// reference expresses it as a minimum rather than a multiplier:
//
//   Борщевик       FIRE, at least ceil(maxHp * 0.44)   borshchevik.ts:265
//   Кровавое Растение FIRE, at least ceil(maxHp * 0.38) blood_plant.ts:245
//   Туманная акула FIRE, at least maxHp + 1            fog_shark.ts:61   (a kill)
//   Рой            FIRE, at least its current HP       swarm_nests.ts:439 (a kill)
//
// A resist cannot say this. `mitigate` scales the incoming number, so a 5-damage
// improvised torch against a 96-HP Кровавое Растение would still be 5 damage at
// resist -100 (10), where the reference makes it 37. The floor is the mechanic: fire
// is the ANSWER to a plant, so a small fire beats a big bullet, and that inversion is
// the entire counterplay.
//
// Returns `base` unchanged for every other kind and every other channel — including
// for a kind with an authored floor hit on the wrong channel — so a caller may apply
// it unconditionally to every hit in the game.
//
// `maxHp` is the level-scaled maximum (`MobRef::maxHp`), not the table base, so a
// level-12 plant needs proportionally more fire. Ceiling, matching the reference's
// `Math.ceil`; the two 100% rows return `maxHp + 1` so they overkill rather than
// leaving a monster on exactly 0 HP through a rounding path.
std::int16_t trait_counterplay_damage(std::uint8_t kind, std::uint8_t channel,
                                      std::int16_t base, std::int16_t maxHp);

// True if this kind has an authored vulnerability at all. For the HUD and for a
// caller that wants to skip the call; `trait_counterplay_damage` is already a
// no-op for the rest, so this is a convenience and not a gate.
bool trait_has_vulnerability(std::uint8_t kind);

// ---------------------------------------------------------------------------
// Bait affinity — DATA, and a defect this table can finally measure
// ---------------------------------------------------------------------------
// **Neither of these has a reader in `src/`, and that is stated rather than implied.**
// The bait MECHANISM is a marker subsystem — a placed item becomes a scented marker with
// a radius, a TTL, an attraction cap and a consumption event, and an attracted monster
// has to be steered at it, which means a target this engine does not store (see the
// REJECTED note at the bottom of this header). That is a separate lane, and authoring
// the affinity data does not build it.
//
// What the column is worth today is that it settles a defect [mob_behaviour.h] recorded
// and could not measure: "`foodBait` — the flag carried by the most kinds (10) — is read
// by nothing in the reference either. Its bait attraction is gated by a hand-written
// kind list that DISAGREES with the flag for 6 kinds." This IS that list
// (`BAIT_ATTRACTED_MONSTER_KINDS`, monster_ecology.ts:115) plus the per-kind trait
// classes, so the disagreement is now a measured number instead of a remark — 10 flag
// carriers against 14 authored kinds, one flag-only and five list-only, asserted in
// tests/suite_monster.inl block 7. The five the flag misses include all three
// document-hunters, which are baited by PAPER: `foodBait` was never the right predicate
// for them, and a bait system built on the flag would have got them wrong.
bool trait_takes_bait(std::uint8_t kind, BaitBit b);

// True if this kind responds to ANY bait class. The authoritative 14, not the flag's 10.
bool trait_takes_bait_any(std::uint8_t kind);

// ---------------------------------------------------------------------------
// Spawn terrain
// ---------------------------------------------------------------------------
// True when standing water is a LEGAL spawn cell for this kind. Six kinds of 69, all
// of them carrying an authored wet pace bonus or dry penalty. See TerrainPref.
//
// NO CALLER IN `src/` YET, and unlike the bait column the blocker is not a missing
// subsystem — it is a trap that has to be answered first. `mob_spawn.cpp`'s `placeable`
// refuses liquid because a sump BASIN is sealed by its kerb, so anything placed there is
// unreachable in both directions and counts against the floor budget forever. Letting an
// aquatic kind in would put it in that box. Today the question is moot in the safe
// direction: every wet cell `floor_gen` produces is half-solid, so the AIR test already
// refuses it and the water test is redundant — measured in suite_monster.inl block 5,
// which counts wet-AND-air cells on a Derelict floor and gets zero. The wire becomes
// correct the day an OPEN pool exists, and `tests/suite_fluidrooms.inl` block 4 (which
// asserts no mob stands in water) has to be narrowed to non-aquatic kinds in the same
// change.
bool trait_allows_wet_spawn(std::uint8_t kind);

// ---------------------------------------------------------------------------
// Armour installation
// ---------------------------------------------------------------------------
// Copy this kind's resist vector onto `e`'s `Armour` component, adding it if the kind
// has any non-zero resist and REMOVING it if it does not. The mirror of
// [combat.h]'s `sync_armour` for an inventory holder, and idempotent for the same
// reason: calling it twice must not double anything.
//
// Returns true if `e` carries an `Armour` afterwards. Call it from `emplace_mob`
// ([mob_spawn.cpp]) — the single place a mob's component set is written, which is what
// keeps the floor-load spawner and the samosbor fog spawner from drifting apart about
// what a monster is.
//
// It costs nothing for 68 of 69 kinds: the resist vector is all zero, so nothing is
// attached and `apply_damage`'s `try_get<Armour>` stays a miss.
bool sync_monster_armour(Registry& reg, Entity e, std::uint8_t kind);

// ---------------------------------------------------------------------------
// What is NOT here, named so nobody specs it twice
// ---------------------------------------------------------------------------
// A short, checkable reason per unauthored kind, in the idiom
// `behaviour_is_dead` / `behaviour_is_dispatched` use: a fact that is compiled,
// greppable and testable rather than a paragraph that rots. Returns a static string,
// never null.
//
// The five reasons, and their counts over the 47 unauthored kinds:
//
//   "no trait"        the reference authors nothing per-kind for it beyond its
//                     mob_table row — it is a stat block plus shared AI, which is
//                     what monsters.md says most monsters should be
//   "mob_behaviour"   answered in [mob_behaviour.h] instead (a radius, a pace, a
//                     reach, an incoming multiplier), so a row here would double it
//   "needs light"     blocked on a per-cell light field this engine does not have
//   "needs fog"       blocked on a per-cell fog density field ([samosbor.h] has a
//                     global fog PHASE, not a field)
//   "needs state"     blocked on per-monster state or a feature grid — a dormant
//                     flag, a phase timer, an anger meter, SCREEN/APPARATUS cells
const char* monster_traits_unauthored_reason(std::uint8_t kind);

// ---------------------------------------------------------------------------
// REJECTED: `shareLocalTarget` (monster_pack.ts) is not portable here
// ---------------------------------------------------------------------------
// Stated in the header rather than in a report, because the next reader will
// otherwise re-derive it from the same two files.
//
// The reference's pack mechanic is target SHARING: a dog that sights you writes
// `candidate.ai.combatTargetId = target.id` onto up to 8 other dogs within 11 cells
// (`GREEN_DOG_PACK_RADIUS` 11, `_CAP` 8, `_SHARE_COOLDOWN_SEC` 0.75), and a fog shark
// does the same at 10 / 6 / 0.65. Those are the only two carriers.
//
// It cannot be expressed on this side, and the blocker is architectural rather than
// missing work: **a mob here has no stored target.** `mob_attack_step` and
// `wander_step` re-derive the victim every visit from [hunt.h] — the camera holder
// inside `kHuntRadius`, else a licensed crowd pick — so there is no `combatTargetId`
// to write and no component to write it into. Adding one would mean a per-mob target
// cache, a staleness rule for a target that died or changed layer, and a second
// authority on who a monster is fighting that `hunt.h` would then have to agree with.
// That is a targeting subsystem, not a trait, and it would need to answer the same
// disagreement hazard [investigate.h] documents ("the symptom is a monster that
// vibrates between a target and a sound").
//
// The half of the pack design that IS load-bearing already works: `MobDef::packMode`
// puts 8-16 Сборки in one room, `MobRef::pack` gives them a shared destination via
// `pack_target_node`, and `kHuntShare` bounds how many hunt at once. So a pack
// arrives and walks together; it just does not pass a target hand to hand.
//
// No radius, cap or cooldown from those two kinds is stored in this table. Data whose
// mechanism cannot exist is decoration, and decoration in a content table reads as
// implemented.

} // namespace giga::game
