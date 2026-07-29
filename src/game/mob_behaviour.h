// Monster behaviour dispatch, wave 1 — the stateless half.
//
// The mob table carries 47 `MobBehaviour` values and until now **nothing read a
// single one of them**. Every one of the 69 kinds walked straight at you and hit you.
// The data was ported faithfully and then ignored, which is the failure mode the
// table's own comment warns about: a column nothing reads is a column that rots.
//
// This wave deliberately implements only the behaviours that need **no per-monster
// state and no new world system**. That constraint is what makes it one increment
// instead of five: every function here is pure, so each is testable without a world,
// a registry, or a tick, and none of them can desynchronise from anything.
//
// Reconnaissance against the reference produced three findings that shaped this file
// more than any spec did:
//
//   * **`foodBait` — the flag carried by the most kinds (10) — is read by nothing in
//     the reference either.** Its bait attraction is gated by a hand-written kind
//     list that DISAGREES with the flag for 6 kinds. So the CSV column is a faithful
//     copy of a field the source ignores. Not implemented, and that is the correct
//     outcome rather than a gap.
//   * **`WeakWallBreach` (Betonoed) has no AI implementation to port** — only a
//     one-off scripted floor encounter. Also impossible here: destructible geometry
//     would invalidate the per-floor baked flow fields.
//   * **`Melee` (Gnome) is a no-op** — zero readers anywhere. It is `Plain` under
//     another name.
//
// Four behaviours are therefore formally dead, and saying so is worth more than
// specifying them: `Melee`, `WeakWallBreach`, `RangedClause` (one line, a scan
// cooldown), `SourceSwarm` (a spawner subsystem keyed on stage, not the flag).
//
// ---------------------------------------------------------------------------
// Wave 2 — the cheap two thirds of what the reference's own dispatch does
// ---------------------------------------------------------------------------
// Wave 1 answered for 5 enumerators, so 42 of 47 still behaved exactly like
// `Plain`. The measurement that shaped wave 2 is that **every non-Plain
// enumerator is carried by exactly ONE of the 69 kinds** — counted from
// data/mobs.csv: 47 distinct behaviour strings over 69 rows, 23 of them `Plain`
// and the other 46 one row each. So "rows affected" cannot rank this work; what
// ranks it is `spawn_weight`, i.e. how often a floor actually rolls the kind.
//
// The reference's dispatch turns out to be concentrated in two tables rather
// than in 46 bespoke scripts, and both are pure:
//
//   * `monsterDetectSq` — a per-behaviour sight radius. FIFTEEN cases, and ten of
//     them resolve to a bare constant that differs from the global
//     `MONSTER_DETECT`. gigahrush2 already has the exact hook
//     (`behaviour_aggro_radius`) and was using two of the ten. An eleventh case
//     resolves to `MONSTER_DETECT` itself — see `SourceSwarm` below.
//   * `monsterMoveMult` / `monsterDmgMult` — a per-behaviour pace and damage
//     multiplier keyed on local terrain. Most cases need a water, fog, light or
//     furniture query this engine does not have; two need only wall adjacency,
//     which `wander.cpp` already computes for `AiFlag::WallBias`.
//
// Wave 2 takes every case whose inputs already exist and nothing else: the eight
// unused radii from that ten, plus the spore carpet's own dormant wake radius
// (which lives at its `findCombatTarget` call rather than in `monsterDetectSq`),
// plus the two pace multipliers. GarbageSurround gains a radius without being
// newly answered — wave 1 already gave it a ring — so the net is nine radii and
// two multipliers for TEN more answered enumerators, at a cost of four extra cell
// reads for ONE additional kind (Панельник).
//
// Two findings that changed the plan, both measured against the reference:
//
//   * **`SourceSwarm`'s only mechanical reader returns the default.**
//     `monsterDetectSq` gives it `SWARM_DETECT_SQ = 20*20` and the global
//     `MONSTER_DETECT` is 20 — the same number. Wave 1 called it dead on the
//     grounds that "the flag itself is only a detect radius", which reads as
//     though there were a radius to port; there is not. Confirmed dead, and now
//     for a reason that can be checked in one line.
//   * **`DebrisLurker`'s 22 m / 12 m radius SPLIT cannot be ported yet, even
//     though its multipliers can.** The split is context-dependent, and
//     `behaviour_aggro_radius` is the gate BOTH `wander_step` and
//     `investigate_step` test to decide who owns a mob this tick
//     ([investigate.h]: "if the two ever disagree ... the symptom is a monster
//     that vibrates between a target and a sound"). A radius that varies with
//     geometry, read by only one of the two passes, is that bug. So the radius
//     stays uniform and the cover mechanic lands on the multipliers, which are
//     each local to one system and cannot desynchronise.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "game/mob_table.h"

namespace giga::game {

// ---------------------------------------------------------------------------
// Pursuit offset — the encirclement steer
// ---------------------------------------------------------------------------
// The single highest change-in-feel per line in the whole behaviour set, and it
// costs zero bytes of state.
//
// Today every aggroed monster steers at the victim's exact position, so a group
// converges into one cell and reads as a conga line. Both of the reference's
// group-positioning behaviours are *pure functions of entity ids*, so the fix is to
// steer at `victimPos + pursuit_offset(...)` and nothing else changes:
//
//   GarbageSurround (Помойный Рой) — a deterministic slot on a ring of 8 around the
//     victim at 1.65 m. Encirclement, not a queue.
//   GreenDogPack (Зелёный Пёс) — flank: offset perpendicular to the approach by
//     1.7 m, side chosen by the low bit of the id, with one dog in four cutting
//     1.2 m behind instead.
//
// Returned in metres, in world XY. `dirX/dirY` is the normalized approach direction,
// needed for the perpendicular; pass zeros and the flank degrades to no offset
// rather than to a division by zero.
struct PursuitOffset {
    float x = 0.0f;
    float y = 0.0f;
};
PursuitOffset pursuit_offset(MobBehaviour b, std::uint32_t mobId,
                             std::uint32_t victimId, float dirX, float dirY);

// ---------------------------------------------------------------------------
// Detect radius — ten of the reference's fifteen, in one switch
// ---------------------------------------------------------------------------
// Every monster used to aggro at the same `kAggroRadius` of 20 m, so a floor had
// exactly one sight range and no kind could be snuck past or noticed early.
//
// The reference's `monsterDetectSq` is a 15-case switch and ten of those cases are
// a bare constant, so ten of them fit here with no new input at all. The two
// authored to notice you LATE are what make walking past a monster possible:
//
//   DeadEcho (Безэхий)   7.5 m until revealed — it is deaf and half-blind
//   CloseReveal (Нелюдь) 6.0 m — a mimic; the "reveal" in the reference is only a
//                        message and an event, so mechanically it IS a short radius
//
// ...and wave 2 adds nine more: four that notice you LATER and five that notice you
// EARLIER. The second direction is equally authored and was equally erased — a
// "document hunter" that smells your papers from 24 m is the whole point of the
// kind, and the generic 20 made it a Сборка with more HP:
//
//   LurkingFurniture (Ковер)             2.15 m  SPORE_CARPET_WAKE_RADIUS
//   RootedPlant (Борщевик)                7.5 m  BORSHCHEVIK_DETECT_SQ
//   RootHive (Кровавое Растение)          8.25 m BLOOD_PLANT_TENDRIL_RANGE
//   GarbageSurround (Помойный Рой)       13.0 m  POMOYNY_ROY_BASE_DETECT_SQ
//   OfficeField (Канцелярский Идол)      23.0 m  KANTSELYARSKIY_IDOL_DETECT_SQ
//   DocumentHunter (Печатеед)            24.0 m  PECHATEED_DETECT_SQ
//   ProtocolPressure (Протокольник)      26.0 m  PROTOKOLNIK_DETECT_SQ
//   DocumentScent (Конторщик)            28.0 m  KONTORSHCHIK_DETECT_SQ
//   LightFollower (Лишенный)             30.0 m  LISHENNYY_DETECT_RADIUS
//
// **GarbageSurround is the one that matters most and it SHRINKS.** Помойный Рой is
// the highest-spawn-weight non-Plain kind in the catalog (2.9, against Sculpture's
// 0.1) and it is a Crowd kind that arrives 8-16 at a time, so a 20 m radius where
// 13 was authored pulled a whole rat swarm from 54% too far away. Wave 1 gave it an
// encirclement ring and left it with everyone else's sight.
//
// Three of the nine are unobservable in `wander_step` TODAY, and that is worth
// stating rather than discovering: OfficeField, RootedPlant and RootHive all sit on
// kinds whose authored speed is 0, so they carry `AiFlag::Immobile` and both
// `wander_init` and `investigate_step` skip them outright. Their radius becomes
// live the moment an attack path consults it — `mob_attack_step` currently uses the
// flat `kAggroRadius` — and it is the correct number in the meantime.
//
// LurkingFurniture is the DORMANT radius, not the awake one. The reference's spore
// carpet has two: `SPORE_CARPET_WAKE_RADIUS` 2.15 m while it is furniture and
// `SPORE_CARPET_DETECT_SQ` 17 m once something has woken it, and waking needs a
// per-monster state this file still refuses to add. Shipping the dormant number
// alone is exactly the stance `investigate.cpp` already takes for DeadEcho:
// pre-reveal behaviour IS the reference's behaviour, not a stand-in for it. A
// carpet you can walk past at 3 m is the authored trap; a carpet that charges you
// from 20 m is what the missing dispatch produced.
//
// Returns the default when a behaviour has no override, so the caller is one `min`
// and never a switch.
//
// NOTE for callers: 2.15 m is the first override BELOW `kHuntRadius` (6 m), which
// breaks the invariant [hunt.h] states as prose — "never LARGER than the smallest
// behaviour aggro radius, which is what makes 'the player wins inside kHuntRadius'
// a strict rule". `wander_step` now clamps the prey scan to this radius so the rule
// holds by construction instead of by coincidence; see the comment there.
float behaviour_aggro_radius(MobBehaviour b, float defaultRadius);

// ---------------------------------------------------------------------------
// WeepingAngel — and a live instakill this fixes
// ---------------------------------------------------------------------------
// Sculpture freezes while it is being looked at: within 25 m and inside a +/-45 deg
// cone of the viewer's facing. The reference also requires a clear line of sight;
// there is no LOS system here, so that test is dropped, and the behaviour degrades
// gracefully — it freezes slightly more often than authored, which is the safe
// direction for a monster this lethal.
//
// This is a bug fix wearing a behaviour's clothes. Sculpture's table row is 8.5
// cells/s and **1000 damage** — authored on the assumption it can only close the
// distance while unobserved. With the behaviour unimplemented it simply sprinted at
// the player and one-shot them from full health, with no counterplay whatsoever.
//
// `yaw` is the viewer's heading in radians, matching CameraTag. Cone half-angle is
// compared by cosine so there is no trig per monster beyond the viewer's own
// forward vector, which the caller computes once.
inline constexpr float kGazeRange = 25.0f;
inline constexpr float kGazeCosHalfAngle = 0.7071068f;   // cos(45 deg)

// True when the monster must hold perfectly still. `fwdX/fwdY` is the viewer's
// normalized forward; `dx/dy` the toroidal delta from viewer to monster.
bool frozen_by_gaze(MobBehaviour b, float fwdX, float fwdY, float dx, float dy);

// ---------------------------------------------------------------------------
// Wall bias — 4 kinds, one world query, no state
// ---------------------------------------------------------------------------
// `AiFlag::WallBias` is carried by 4 kinds (Тварь, Шовник, Арматура, Бетоноед) and
// read by nothing. In the reference a wall-adjacent carrier moves x1.18 and hits
// x1.2 (Тварь x1.22); in the open it moves x0.92. That is the whole mechanic, and it
// makes corridors and doorways genuinely worse places to be caught than rooms —
// which is free level design, extracted from geometry that already exists.
//
// `adjacentWall` is the caller's cardinal-neighbour test; keeping the query out of
// here is what keeps these functions pure and testable.
inline constexpr float kWallBiasSpeedNear = 1.18f;
inline constexpr float kWallBiasSpeedOpen = 0.92f;
inline constexpr float kWallBiasDamage = 1.20f;

float wall_bias_speed(std::uint32_t aiFlags, bool adjacentWall);
float wall_bias_damage(std::uint32_t aiFlags, bool adjacentWall);

// ---------------------------------------------------------------------------
// Behaviour-keyed pace — the same query, two more kinds, different numbers
// ---------------------------------------------------------------------------
// `wall_bias_speed` above answers for a shared FLAG. The reference's
// `monsterMoveMult` also answers for two BEHAVIOURS off the same wall-adjacency
// test, with their own numbers, and returns before it ever reaches the flag branch.
// That precedence is load-bearing rather than incidental: Арматура carries
// `debrisLurker` AND `wallBias`, so treating them as independent multipliers would
// give it 1.22 x 1.18 = 1.44 where the reference gives 1.22.
//
//   DebrisLurker (Арматура)  in cover x1.22, exposed x0.68 — and x1.25 / x0.75 on
//     its damage. The widest spread of any carrier in the table, which is the whole
//     kind: 210 HP and 24 damage that is genuinely dangerous against a wall and
//     genuinely weak in the middle of a room. Caught in the open it is currently
//     0.68 -> 1.0, i.e. 47% faster than authored.
//   WallBrace (Панельник)    braced x1.02, open floor x0.90.
//
// **Панельник is the clearest case in the catalog of the table already carrying
// half a mechanic.** Its authored melee reach is 1.16 cells where 66 of 69 kinds
// are 1.2 — that 1.16 is the reference's `PANELNIK_OPEN_REACH`, the *weak* half of a
// pair whose braced half is `PANELNIK_BRACE_REACH` 1.75. So the generated row is
// not generic, it is specifically the unbraced state, and with the behaviour
// undispatched Панельник was permanently stuck in it: shorter reach than a Сборка,
// no armour, no pace change. It carries no shared flag, so it got exactly x1.0.
//
// What is NOT here, and why, because both halves are one line away from working:
//   * The braced reach (1.75 vs 1.16 cells) and the braced armour
//     (`PANELNIK_WALL_BRACE_DAMAGE_MULT` 0.58 on incoming) belong to combat, and
//     `apply_damage` takes no MacroGrid — adding one is a signature change across
//     every caller, which is not this lane's to make.
//   * `PANELNIK_OPEN_SLOW_SEC` 1.35 / `PANELNIK_OPEN_SLOW_MULT` 0.58, the penalty
//     for LOSING the wall, needs a per-monster timer. Same refusal as wave 1.
inline constexpr float kDebrisCoverSpeed = 1.22f;
inline constexpr float kDebrisOpenSpeed = 0.68f;
inline constexpr float kDebrisCoverDamage = 1.25f;
inline constexpr float kDebrisOpenDamage = 0.75f;
inline constexpr float kWallBraceSpeed = 1.02f;
inline constexpr float kWallBraceOpenSpeed = 0.90f;

// `claimed` is the precedence, not a status code: true means this behaviour owns
// the pace and `wall_bias_speed` must NOT also be applied. A caller comparing
// `mult` against 1.0f instead would silently double-multiply the day a behaviour is
// authored at exactly x1.0.
struct MoveMult {
    float mult = 1.0f;
    bool claimed = false;
};
MoveMult behaviour_move_mult(MobBehaviour b, bool adjacentWall);

// Outgoing melee multiplier, same shape and the same precedence over
// `wall_bias_damage`. Not yet wired: combat.cpp:308 already computes
// `adjacent_wall(grid, tr.pos)` for Арматура (it is a WallBias carrier too), so the
// hook is one line and no new query.
float behaviour_damage_mult(MobBehaviour b, bool adjacentWall);

// Does this kind's pace depend on wall adjacency at all? THE gate that keeps the
// four cardinal cell reads off the 64 kinds that do not care: 5 of 69 answer true
// (Тварь, Шовник, Арматура, Бетоноед by flag; Панельник by behaviour), so wave 2
// adds the query for exactly one more kind.
bool wall_query_needed(std::uint32_t aiFlags, MobBehaviour b);

// ---------------------------------------------------------------------------
// Dead behaviours, named so nobody specs them twice
// ---------------------------------------------------------------------------
// True for the four confirmed to have no implementation to port. Kept as a function
// rather than a comment so the fact is compiled, greppable, and testable.
bool behaviour_is_dead(MobBehaviour b);

// True for every enumerator some function in THIS FILE answers for — i.e. the ones
// a mob can be told apart from a `Plain` mob by. 15 of 47 after wave 2, up from 5.
//
// This exists to WIRE `behaviour_is_dead`, which had no caller outside the tests and
// therefore no way to be wrong out loud. The two lists are now checked against each
// other and against the dispatchers themselves (`test_behaviours_all`): a dead
// behaviour must be answered by nothing, a dispatched one by something, and the
// declared list must match what the code actually returns. Declaring a behaviour
// implemented without implementing it, or leaving it on the dead list after
// implementing it, both fail — which is the only kind of documentation worth
// compiling.
//
// Deliberately NOT consulted by the tick. It is a statement about the code, not a
// decision inside it, and branching on it in `wander_step` would add a lookup to
// every mob every visit to save a jump-table miss on four kinds.
bool behaviour_is_dispatched(MobBehaviour b);

// ---------------------------------------------------------------------------
// The roadmap: what each remaining enumerator is blocked on
// ---------------------------------------------------------------------------
// 32 of the 47 enumerators still read as `Plain`: `Plain` itself, the 4 confirmed
// dead, and the 27 below. None of the 27 is blocked on "someone should write it";
// each is blocked on one NAMED missing piece, and the pieces repeat, so the honest
// unit of future work is the piece and not the behaviour. Ordered by the spawn weight
// of the single kind that carries each, which is the only ranking the data supports
// (see the wave 2 note at the top). Entries marked "radius ported" are the six that
// are half-live: wave 2 gave them their authored sight range and no more.
//
// A LIGHT FIELD (nothing in this engine knows how bright a cell is):
//   LampPowered (Ламповый, 2.8) — a lamp is a power source; x1.2 scan rate near one
//   LightLock (Лампоглаз, 2.2)  — stationary shooter that holds a lit line
//   LightFollower (Лишенный, 0.58) — radius ported; the lamp-as-bait half is not
//
// AN ITEM/CARRY QUERY on the target (what is in your inventory right now):
//   DocumentHunter (Печатеед, 2.6), DocumentScent (Конторщик, 0.95) — radii ported;
//     the reference then scales pace x1.2..1.78 by how many papers you carry, and
//     drops to x0.68 when you carry none
//   ScentOvercommit (Жорная Тварь, 2.2), MeatWorm (Олгой, 0.82) — food/meat as a
//     competing attractor; needs items dropped on the floor to be findable
//   ProtocolPressure (Протокольник, 0.72) — radius ported, PSI pressure is not
//
// A FOG DENSITY FIELD ([samosbor.h] has a global fog PHASE, not a per-cell field):
//   FogSwimmer (Туманная акула, 0.95) — detect 28 m in fog and 8 m dry, plus a pace
//     multiplier; a pack kind whose whole design is "the fog is a route decision"
//
// A NEUTRAL STANCE (every mob is hostile the moment it spawns):
//   SlimeScavenger (Слизневик, 1.15) — a scavenger that barters rather than attacks;
//     the reference reaches it through `monsterStage`, not through the flag
//
// A WET/FLUID CELL QUERY (src/sim/fluid.h exists; no per-cell "is this wet" hook):
//   DrainArmor (Лоточник, 2.1) — x0.58 incoming and HP regen while standing in water
//   BlackWaterWake (Чернослиз, 1.4) — x0.46 pace off its own water, x1.0 on it
//   WetLineShot (Трубный Автомат, 1.25), WaterPressureLine (Водяной кошмар, 1.15),
//     SlimeStrider (Жижевая женщина, 0.42) — same query, three different numbers
//
// PER-MONSTER STATE (a component, therefore an emplace inside a view — the crash
// [combat.cpp] documents; wants a spawn-time attach and a two-phase pass):
//   FractureSprint (Трескотник, 2.4) — windup 0.35 s, sprint 0.62 s at x3.25,
//     stagger 1.35 s, x1.45 damage and 28% self-damage on contact. The single
//     highest change-in-feel left, and it needs three timers and nothing else.
//   CrowdShove (Дикий Мертвяк, 2.15) — a charge that fills from crowd density; also
//     needs a neighbour scan, so it is not O(1)
//   ScrapWake (Ржавник, 0.85) — needs a DORMANT state to wake from; [noise.h] names
//     the rest as already present
//   BaitLine (Тонкая Тень, 1.15) — needs a FLEE steer (every steering path in the
//     tree moves toward something) plus a 5.6 s nerve timer
//   SecondBeat (Глубинная Тень, 0.62) — a paired afterimage body, spawned on chase
//   DefensiveNeutral (Гнилушка, 0.18) — hostile only once damaged
//   FogOffset (Туманник, 1.35) — a displaced FAKE silhouette: per-mob offset vector
//     with a refresh timer, and the player-facing half is a RENDER displacement
//     (webgl.ts:3909 draws the body at x+offset), so it is not a sim change at all
//
// A SUBSYSTEM, stated so nobody scopes it as a behaviour:
//   RootedPlant (Борщевик, 1.15), RootHive (Кровавое Растение, 0.16) — radii ported;
//     tendrils/seeds are area effects
//   WebSpitter (Паупсина, 1.15) — windup/range/minRange/projType ALL already in the
//     generated row; only `PAUPSINA_WEB_STRAFE_RANGE` (a strafe steer) is missing
//   LastSoundBeam (Слепоглаз, 1.05) — needs "shoot at a POINT"; [noise.h] names it
//   RoomBoundAberration (Комнатный обживальщик, 0.72) — a home anchor plus an anger meter
//   LurkingFurniture (Ковер, 0.72) — dormant radius ported; the wake, the
//     spore puff and the 17 m awake radius are not
//   FalsePhase (Ложный Дух, 0.72) — door-keyed flanking; doors exist, phases do not
//   NetPossessor (Червие, 0.42) — needs SCREEN/APPARATUS features in the grid
//   HostParasite (Головной слизень, 0.36) — attach/detach to another entity
//   MeatGrowth (Собранный человек, 0.28) — grows wall organics
//   ParasiteLeader (Мухожук-носитель, 0.18) — spawns and commands
//   FalsePatrol (Черный ликвидатор, 0.14) — needs a DISGUISED faction, i.e. a body
//     that reads as friendly until it is not
//
// CONFIRMED DEAD (see `behaviour_is_dead`): Melee, WeakWallBreach, RangedClause,
// SourceSwarm.
//
// And two blocked on nothing but the cross-system contract described at the top:
//   DebrisLurker's 22 m / 12 m cover-split radius — needs `investigate_step` to
//     consult the same geometry, or the two passes fight over the mob.
//   GreenDogPack's noiseFear half — [noise.h] and [investigate.h] already carry
//     `kDogHearing` 1.25 and `kDogFearRadius` 18 m for it; it needs the flee steer
//     BaitLine needs, plus six bytes of one-shot-per-noise-id state.

} // namespace giga::game
