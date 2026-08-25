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
//
// ---------------------------------------------------------------------------
// Wave 3 — what the two earlier waves could not see from `monsterDetectSq`
// ---------------------------------------------------------------------------
// Wave 2 declared `monsterDetectSq` exhausted, and for that function it was: its
// 15 cases are 11 ported constants plus 4 blocked on a light/fog/water/state input
// this engine does not have. The error was treating that ONE switch as the whole
// sight story. The reference sets a per-kind `detectSq` in a **second** place — an
// `else if` chain in its monster update, *after* `monsterDetectSq` has already
// returned — and three behaviour-carrying kinds get their radius only there or from
// their own target-finder. So three more radii were sitting in plain sight:
//
//   FractureSprint (Трескотник)   18.0 m  TRESKOTNIK_DETECT_SQ    (spawn weight 2.4)
//   MeatWorm (Олгой)              24.0 m  OLGOY_DETECT_RADIUS     (0.82)
//   FalsePhase (Ложный Дух)       24.0 m  FALSE_PHASE_DETECT_SQ   (0.72)
//
// **FractureSprint is the highest-weight kind in the catalog that still read as
// `Plain`** once the light-field and item-query families are set aside, and its
// radius SHRINKS from 20 to 18 — the same direction as GarbageSurround's, and for
// the same reason: a kind authored to be approached was pulling from further away
// than authored.
//
// Wave 3 then adds two mechanics, chosen because both fit hooks that ALREADY have a
// live caller — `pursuit_offset` and the aggro switch — so they are reachable the
// moment they compile rather than after a wiring pass:
//
//   * **WebSpitter (Паупсина) gets its strafing standoff.** The reference's
//     `tryPaupsinaRangeStep` is a pursuit offset in all but name, and it is the
//     FIRST offset in this file with a negative radial term — the only one that can
//     make a monster back away. See `pursuit_offset` below.
//   * **FractureSprint gets its burst cycle**, as a stateless phase function of
//     (id, tick) in the `mob_hunts_npcs` idiom, so the "needs three timers" entry on
//     the wave-2 roadmap turns out to need three *constants* and no component.
//
// And two findings about the code rather than the data, both of which mean a
// declared behaviour is doing less than the roadmap claims:
//
//   * **`behaviour_damage_mult` has no caller in `src/` at all.** DebrisLurker is
//     listed as dispatched and its 1.25/0.75 damage split has never been applied to
//     a single point of damage: `combat.cpp` calls `wall_bias_damage` only, so
//     Арматура gets the shared flag's 1.2/1.0 and Панельник gets 1.0. The wave-2
//     comment says the hook is "one line and no new query" — it is, and the line was
//     never added. Its speed half IS live (wander.cpp), which is why the suite's
//     velocity blocks pass and hid this.
//   * **`kAggroRadius` is the reference's RANGED default, not its melee one.**
//     `MONSTER_DETECT = 20` is what a ranged or immobile kind gets;
//     `MONSTER_MELEE_DETECT = 30` is what a mobile melee kind gets, selected by
//     `!def.isRanged && def.speed > 0`. So the flat 20 m is wrong for the 54 rows of
//     69 that are mobile melee, and every "notices you EARLIER than 20 m" line is
//     measured against the wrong baseline. Not fixed here: `kAggroRadius` lives in
//     [wander.h], the change is floor-wide balance rather than behaviour dispatch,
//     and it is a table-derived default (a function of `isRanged`/`speed`) rather
//     than a behaviour override, so it does not belong in this file's switch.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "core/tick.h"
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
// Wave 3 adds the third, and it is the one that changes what the hook can express:
//
//   WebSpitter (Паупсина) — a strafing STANDOFF. Both offsets above are tangential,
//     so no value they return can stop a monster closing; this one carries a
//     negative RADIAL term, and that single sign is the whole behaviour. A web
//     spitter's kit is 11.5-cell range with a 3.4-cell dead zone, and with the
//     behaviour undispatched it walked into its own dead zone and stayed there —
//     the one kind in the table whose attack is control rather than damage, in
//     permanent melee.
//
// The arithmetic that makes a constant offset a standoff, because it is not obvious
// and it is why no distance parameter is needed: the caller steers at
// `victimDelta + off`, so an offset of `-dir * K` gives a steer of magnitude
// `|victimDelta| * (1 - K/|victimDelta|)`, which points AT the victim beyond K and
// AWAY from it inside K. Adding a fixed perpendicular `S` on top leaves the radial
// equilibrium at exactly K and spends the rest of the speed budget tangentially, so
// the monster settles into a circle of radius K and orbits it. Reference parity: the
// reference re-derives a goal cell every 0.75 s from `stepAway`/`stepSide` pairs that
// grow when it is inside the dead zone; here the steer magnitude does that growing by
// construction, which is the same curve without the per-frame path assignment.
//
// Returned in metres, in world XY. `dirX/dirY` is the normalized approach direction,
// needed for the perpendicular; pass zeros and the flank and the standoff both
// degrade to no offset rather than to a division by zero.
struct PursuitOffset {
    float x = 0.0f;
    float y = 0.0f;
};

// PAUPSINA_WEB_STRAFE_RANGE / the reference's own `stepSide` at or beyond the dead
// zone. The side is `id % 2`, verbatim, so the swarm splits without coordinating.
inline constexpr float kWebStandoff = 7.25f;
inline constexpr float kWebStrafeSide = 3.5f;

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
// ...and wave 3 adds the three that are NOT in `monsterDetectSq`, so no amount of
// re-reading that switch would have found them (see the wave 3 note at the top):
//
//   FractureSprint (Трескотник)          18.0 m  TRESKOTNIK_DETECT_SQ
//   MeatWorm (Олгой)                     24.0 m  OLGOY_DETECT_RADIUS
//   FalsePhase (Ложный Дух)              24.0 m  FALSE_PHASE_DETECT_SQ
//
// Each of the three is a bare constant in the reference and each has a second half
// that is NOT ported, stated so the radius is not mistaken for the kind:
// Трескотник's is the burst cycle below (wave 3 ports it); Олгой's is a blood/corpse
// scent that widens the same radius to 30 m for a bleeding target, which needs a
// damage-trail this engine does not have; Ложный Дух's is a door-keyed phase.
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
// DeadEcho — the same two vectors, read for the opposite reason
// ---------------------------------------------------------------------------
// `frozen_by_gaze` asks "is the viewer looking AT it". Безэхий's damage multiplier
// asks "is the viewer looking AWAY", off the identical inputs the caller has already
// computed, and this is the cheapest genuinely-new mechanic left in the whole table:
// zero new state, zero new query, and it turns a facing into a stat.
//
//   back turned (dot <= -0.18)  x1.55
//   anything else               x0.72
//
// It is also the only damage number in the file whose two branches straddle 1.0, and
// that asymmetry is the design: Безэхий is authored at 9 damage and 7.5 m of sight,
// i.e. it cannot fight you, it can only catch you not looking. Undispatched it hit a
// flat 9 either way, which is the weakest monster on the roster with no upside — the
// 1.55 was the entire point of the kind.
//
// Same convention as `frozen_by_gaze` on purpose, so a caller cannot get one right
// and the other backwards: `fwdX/fwdY` is the VIEWER's normalized forward, `dx/dy`
// the toroidal delta from VIEWER to MONSTER. Standing on top of it reads as facing
// it (the reference's `facingDotTo` returns 1 below a 0.001 m separation), so a
// zero-length delta yields 0.72 and never the bonus.
//
// NOT YET WIRED, and the reason is a signature rather than a design: `combat.cpp`
// resolves the camera holder from a `view<const CameraTag, const Transform>` and
// keeps only `playerPos`, so the yaw it iterates past is one captured line away.
// Until that line exists this function has no caller outside the suite — exactly the
// state `behaviour_damage_mult` has been in since wave 2 (see the top of this file).
inline constexpr float kDeadEchoBackDot = -0.18f;      // BEZEKHIY_BACK_DOT
inline constexpr float kDeadEchoBackDamage = 1.55f;
inline constexpr float kDeadEchoFacedDamage = 0.72f;

float facing_damage_mult(MobBehaviour b, float fwdX, float fwdY, float dx, float dy);

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
// What is NOT here, and why:
//   * The braced reach and the braced armour were filed here in wave 2 as blocked on
//     "`apply_damage` takes no MacroGrid — a signature change across every caller".
//     **Wave 4 ported both**; see `behaviour_melee_reach` / `behaviour_incoming_mult`
//     below. The wave-2 reading was of the wrong function: the mob-attack pass that
//     calls `apply_damage` holds the grid and already queries it.
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
// `wall_bias_damage`. Not yet wired: combat.cpp already computes
// `body_wall_adjacent(grid, tr.pos)` for Арматура (it is a WallBias carrier too), so the
// hook is one line and no new query.
float behaviour_damage_mult(MobBehaviour b, bool adjacentWall);

// Does this behaviour OWN the outgoing damage, i.e. must `wall_bias_damage` be skipped
// rather than also applied? The exact counterpart of `MoveMult::claimed`, and it exists
// because wave 2 gave the pace a claim flag, said in the same breath that damage has
// "the same precedence", and then shipped damage as a bare float with no way to express
// it. A caller had only `!= 1.0f` to work from — which is precisely the mistake the
// `MoveMult::claimed` comment above is written to prevent, three declarations further
// up in the same file:
//
//   "A caller comparing `mult` against 1.0f instead would silently double-multiply the
//    day a behaviour is authored at exactly x1.0."
//
// It happens to work today because DebrisLurker's 1.25/0.75 straddle 1.0. It would stop
// working the first time a behaviour claims damage in only one of its two wall states,
// and the symptom would be Арматура hitting for 1.25 x 1.2 = 1.5 in cover — a number
// the reference never gives it.
//
// A separate predicate rather than a return-type change, so the tested signature of
// `behaviour_damage_mult` is untouched and this is purely additive.
bool behaviour_claims_damage(MobBehaviour b);

// Does this kind's pace depend on wall adjacency at all? THE gate that keeps the
// four cardinal cell reads off the 64 kinds that do not care: 5 of 69 answer true
// (Тварь, Шовник, Арматура, Бетоноед by flag; Панельник by behaviour), so wave 2
// adds the query for exactly one more kind.
//
// Wave 4 note for the COMBAT caller: this is the right gate there too, and it already
// holds. combat.cpp runs `body_wall_adjacent` behind `has_flag(def.aiFlags, WallBias)`,
// which is this predicate minus its behaviour half — so switching that branch to
// `wall_query_needed(def.aiFlags, beh)` adds the query for Панельник alone and for no
// other kind. That is what makes the two hooks below free rather than a new scan.
bool wall_query_needed(std::uint32_t aiFlags, MobBehaviour b);

// ---------------------------------------------------------------------------
// WallBrace — the other two thirds, on a query that is already being run
// ---------------------------------------------------------------------------
// Панельник is the kind this file has documented as half-implemented since wave 2:
// its generated melee reach of 1.16 cells IS the reference's `PANELNIK_OPEN_REACH`,
// the weak half of a pair, and with only the pace ported it was permanently unbraced.
// Wave 2 filed the rest under "belong to combat, and `apply_damage` takes no
// MacroGrid — adding one is a signature change across every caller". That reading was
// of the wrong function: the mob-attack pass in combat.cpp already holds the grid and
// already calls `body_wall_adjacent(grid, tr.pos)` one line above where these belong. No
// signature changes, no new query, and 5 of 69 kinds pay for it.
//
//   braced reach    1.75 cells  PANELNIK_BRACE_REACH   (vs the row's 1.16)
//   braced armour   x0.58       PANELNIK_WALL_BRACE_DAMAGE_MULT, on INCOMING damage
//
// Together with the pace that is already live these make Панельник the first kind in
// the table whose behaviour touches all four of what a melee monster is: how fast it
// closes, how far it can reach, how hard it hits, and how hard it is to kill. Against
// a wall it out-reaches every other kind in the catalog (1.75 cells where the widest
// authored row is Тварь's 1.55) and takes 42% less; caught in the open it is shorter
// than a Сборка and unarmoured. That spread is the whole kind, and none of it has ever
// been in the game.
//
// **These two are a REACH and an INCOMING multiplier, which no behaviour in this file
// has touched before.** Every hook above answers with a sight radius, a steer, a pace
// or an outgoing damage number. Stating that is the point: it is why they are not
// another `behaviour_move_mult` case in disguise.
inline constexpr float kWallBraceReachCells = 1.75f;   // PANELNIK_BRACE_REACH
inline constexpr float kWallBraceIncoming = 0.58f;     // PANELNIK_WALL_BRACE_DAMAGE_MULT

// Melee reach in METRES, converted here rather than by the caller so the override and
// the default cannot disagree about units — the trap [suite_behaviours.inl] documents
// at length is that table ranges are cells and the radii in this file are not.
// `baseReachMm` is `MobDef::meleeReachMm`, cells * 1000.
//
// Note 1750 would be OUT OF RANGE for the table column (`meleeReachMm` is documented
// 1050..1550), so this genuinely cannot be a CSV edit: the row correctly carries the
// unbraced value and the braced one only exists as a function of geometry.
float behaviour_melee_reach(MobBehaviour b, std::uint16_t baseReachMm,
                            bool adjacentWall);

// Multiplier on damage coming IN to this mob. 1.0 for every behaviour but WallBrace,
// and 1.0 for an unbraced Панельник, so no kind is quietly given armour.
//
// The reference floors the result at 1 point of damage (`Math.max(1, Math.round(...))`)
// so a braced Панельник can never be immune to a weak hit. That floor is the CALLER's:
// it belongs where the damage is an integer, and applying it to a float multiplier here
// would silently turn x0.58 into x1.0 for any hit under 2 points.
float behaviour_incoming_mult(MobBehaviour b, bool adjacentWall);

// ---------------------------------------------------------------------------
// CrowdShove — the one input at the dispatch site nothing had read
// ---------------------------------------------------------------------------
// `MobRef` has carried `hp` and `maxHp` since it existed and no behaviour has ever
// looked at either, so "has this monster been hurt yet" was free the whole time.
//
// Дикий Мертвяк's `monsterMoveMult` branch is `dikiyMertvyakDamagedEarly(e) ? 0.96 :
// 1 + min(1.2, shoveCharge) * 0.18`, and `dikiyMertvyakDamagedEarly` is exactly
// `hp < maxHp` (the reference compares against a latched `shoveStartHp` and a 0.5
// epsilon; with integer HP those are the same predicate). So the DAMAGED half ports
// verbatim and the charge half does not.
//
// **This is deliberately the minor half and saying so is the point.** The kind's
// headline is the shove itself, which fills from a neighbour-density scan
// (`DIKIY_SHOVE_RADIUS`, `cheapCrowdPressure`) and is therefore not O(1) — it stays on
// the roadmap. What lands is x0.96 once hurt, i.e. a runner that commits and then
// cannot re-commit, on the kind that arrives 5-10 at a time at spawn weight 2.15.
// Undamaged the reference returns `1 + 0 * 0.18` = exactly 1.0, so a fresh Дикий
// Мертвяк is bit-for-bit what it is today and only a hurt one changes.
//
// The precedence question, because there are now two pace multipliers: this one and
// `behaviour_move_mult` can never both bite, and it is structural rather than lucky.
// CrowdShove claims no wall pace and Дикий Мертвяк carries no wall flag, so
// `wall_query_needed` is false for it and `behaviour_move_mult` is never even called.
// Asserted for all 47 enumerators in the suite so a future wall-and-health behaviour
// cannot introduce a silent product.
inline constexpr float kCrowdShoveHurtSpeed = 0.96f;   // DIKIY_MERTVYAK, damaged

// Pace multiplier from the mob's OWN health. 1.0 for every behaviour but CrowdShove,
// and 1.0 for an untouched carrier.
//
// Ungated on purpose, unlike `behaviour_move_mult`: that one is gated because it needs
// four cell READS, while this needs two integers the caller already has in the MobRef
// it dereferenced to find the behaviour. A jump-table miss per mob per visit is not
// worth a branch to avoid.
//
// `maxHp <= 0` returns 1.0 rather than dividing or comparing into nonsense — a mob with
// no maximum is a spawn bug, and slowing it would hide that rather than report it.
float behaviour_hurt_move_mult(MobBehaviour b, std::int16_t hp, std::int16_t maxHp);

// ---------------------------------------------------------------------------
// FractureSprint — three timers that turn out to need no timer
// ---------------------------------------------------------------------------
// The wave-2 roadmap called this "the single highest change-in-feel left" and filed
// it under PER-MONSTER STATE, needing "three timers and nothing else". It needs three
// CONSTANTS: the cycle is a pure function of (id, tick) in exactly the idiom
// [hunt.h] uses for hunting licences and [wander.h] uses for pack epochs. There is no
// component, no emplace, no two-phase pass, and nothing that can desynchronise
// between two consumers, because neither consumer stores anything.
//
// Трескотник's cycle, ported verbatim (2.32 s end to end):
//
//   Windup  0.35 s  frozen — the red cracks flare; this IS the counterplay
//   Sprint  0.62 s  x3.25 speed and x1.45 damage on contact
//   Stagger 1.35 s  frozen — brittle, and the window it can be shot in
//
// Gated on `dist <= 7.5 m` (TRESKOTNIK_WINDUP_RANGE), so a Трескотник closes at its
// ordinary 5.5 m/s from 18 m and only then falls into the cycle. Outside the gate the
// phase is `Idle` and the multiplier is exactly 1.0, so the 68 other kinds and every
// out-of-range Трескотник are bit-for-bit unaffected.
//
// **The honest divergence**, because it is the whole cost of dropping the state: the
// reference TRIGGERS the windup on entering 7.5 m with the attack cooldown clear,
// while this cycle free-runs. So a Трескотник that crosses 7.5 m mid-sprint gets one
// burst with no telegraph. That is a first-entry-only artefact — it stays inside 7.5 m
// for many cycles, and every sprint after the first is preceded by its own windup —
// but it is real and it is the one thing a per-monster timer would buy.
//
// Two reference details deliberately NOT ported, both stated so they are not
// mistaken for oversights:
//   * `Math.max(speed * 3.25, 7.5 cells/s)` — the floor never binds. Трескотник is
//     the sole carrier at 2.75 cells/s and 2.75 x 3.25 = 8.94 >= 7.5, so the floor is
//     dead arithmetic for every row in the table. Porting it would also mean handing
//     this function the caller's speed for no observable effect.
//   * The 22% self-damage and 0.75 s stagger on sprinting into geometry, and the
//     windup interrupt on being hit. Both need to know what happened since the last
//     tick, which is the state this function exists to avoid. Physics already stops a
//     sprinting body at a wall, so the sprint ends against cover either way — it just
//     costs the monster nothing.
inline constexpr float kFractureWindupSec = 0.35f;
inline constexpr float kFractureSprintSec = 0.62f;
inline constexpr float kFractureStaggerSec = 1.35f;
inline constexpr float kFractureSprintMult = 3.25f;
inline constexpr float kFractureBurstDamage = 1.45f;
inline constexpr float kFractureRange = 7.5f;   // TRESKOTNIK_WINDUP_RANGE

// Durations spelled in SECONDS and converted here, never authored as tick counts.
// [wander.h] records what the other way costs: `kPackEpochTicks` was written as 1800
// "= 15 s at 120 Hz", core/tick.h moved the sim to 125 Hz, and the epoch silently
// became 14.4 s while the comment kept claiming 15. Nothing failed, which is the
// problem.
inline constexpr std::uint64_t kFractureWindupTicks =
    static_cast<std::uint64_t>(kFractureWindupSec * static_cast<float>(kSimHz));
inline constexpr std::uint64_t kFractureSprintTicks =
    static_cast<std::uint64_t>(kFractureSprintSec * static_cast<float>(kSimHz));
inline constexpr std::uint64_t kFractureStaggerTicks =
    static_cast<std::uint64_t>(kFractureStaggerSec * static_cast<float>(kSimHz));
inline constexpr std::uint64_t kFractureCycleTicks =
    kFractureWindupTicks + kFractureSprintTicks + kFractureStaggerTicks;
static_assert(kFractureCycleTicks > 0, "a zero-length cycle would divide by zero");

enum class BurstPhase : std::uint8_t { Idle = 0, Windup, Sprint, Stagger };

// Where in its cycle this monster is. `Idle` for every behaviour but FractureSprint
// and for a carrier further than kFractureRange from what it is chasing.
//
// The per-identity offset is what keeps a pack of them off lockstep, and it is a
// separate hash from the wander stagger on purpose: sharing one would tie the phase a
// monster sprints in to the phase it is *visited* in, so a whole cohort would sprint
// on the same tick it re-plans.
BurstPhase burst_phase(MobBehaviour b, std::uint32_t mobId, std::uint64_t tick,
                       float dist);

// Speed multiplier for that phase: 1.0 Idle, 0.0 Windup and Stagger, 3.25 Sprint.
//
// Zero really is zero rather than a small number — the reference returns before it
// moves the body in both frozen phases, and a Трескотник creeping during its
// telegraph would erase the tell the whole kind is balanced around.
float burst_speed_mult(BurstPhase p);

// Outgoing damage multiplier for that phase: 1.45 mid-sprint, 1.0 otherwise. Same
// unwired state as `behaviour_damage_mult` and `facing_damage_mult` — combat.cpp
// applies neither yet.
float burst_damage_mult(BurstPhase p);

// ---------------------------------------------------------------------------
// Dead behaviours, named so nobody specs them twice
// ---------------------------------------------------------------------------
// True for the four confirmed to have no implementation to port. Kept as a function
// rather than a comment so the fact is compiled, greppable, and testable.
bool behaviour_is_dead(MobBehaviour b);

// True for every enumerator some function in THIS FILE answers for — i.e. the ones
// a mob can be told apart from a `Plain` mob by. 20 of 47 after wave 4, up from 19
// after wave 3, 15 after wave 2 and 5 after wave 1.
//
// "Answered by this file" is NOT the same as "reaching the player", and wave 3 is
// where the two came apart far enough to need saying. Of the 20, NINETEEN are live
// today — `behaviour_aggro_radius` is called by both `wander_step` and
// `investigate_step`, `pursuit_offset` and `behaviour_move_mult` by `wander_step`,
// `frozen_by_gaze` by `wander_step`. Exactly ONE — CrowdShove — answers only inside
// this suite, and the reason is that SEVEN dispatchers here have no caller in `src/`
// at all: `behaviour_damage_mult` (DebrisLurker's damage half, unwired since wave 2),
// `facing_damage_mult` (DeadEcho), `burst_damage_mult` + `burst_speed_mult`
// (FractureSprint) and wave 4's `behaviour_melee_reach` / `behaviour_incoming_mult`
// (WallBrace) / `behaviour_hurt_move_mult` (CrowdShove). Those seven answer for FIVE
// kinds, and four of the five are also answered by a live radius or pace — so the
// count of unwired FUNCTIONS (seven) and of unreachable ENUMERATORS (one) are
// different numbers, and an earlier revision of this paragraph conflated them.
// `test_behaviours_all` asserts the enumerator count, which is the authority here.
//
// DebrisLurker, DeadEcho, FractureSprint and WallBrace are each independently answered
// by a LIVE radius or pace, so they are half-live rather than inert. **CrowdShove is
// the first entry on the list below whose only answer comes from an unwired function**,
// so until `behaviour_hurt_move_mult` has a caller it is indistinguishable from Plain
// in the running game — which is why the suite asserts the reachable/unreachable split
// as a named set rather than as a count.
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
// 27 of the 47 enumerators still read as `Plain`: `Plain` itself, the 4 confirmed
// dead, and the 22 below. None of the 22 is blocked on "someone should write it";
// each is blocked on one NAMED missing piece, and the pieces repeat, so the honest
// unit of future work is the piece and not the behaviour. Ordered by the spawn weight
// of the single kind that carries each, which is the only ranking the data supports
// (see the wave 2 note at the top). Entries marked "radius ported" are the NINE that
// are half-live: waves 2 and 3 gave them their authored sight range and no more.
//
// **The highest-value item on this list is not a behaviour, and after wave 4 it is
// bigger than it was.** It is a handful of lines in `wander_step` and the mob-attack
// pass of `combat.cpp`: SEVEN dispatchers here are written, tested and applied to
// nothing — `behaviour_damage_mult`, `facing_damage_mult`, `burst_damage_mult`,
// `burst_speed_mult`, `behaviour_melee_reach`, `behaviour_incoming_mult` and
// `behaviour_hurt_move_mult`. That is more finished mechanic per line than anything
// below, and one of them (`burst_speed_mult`) carries the whole published design of a
// spawn-weight-2.4 kind. The exact shapes they need, in ascending order of cost:
//
//   `burst_speed_mult`        one multiply in `wander_step` beside the pace multiply
//                             that is already there; it has `id`, `tick` and the chase
//                             distance in scope already.
//   `behaviour_hurt_move_mult` the same multiply, from the `MobRef` already dereferenced.
//   `behaviour_damage_mult`   one multiply where `wall_bias_damage` is already applied,
//                             and the precedence in `MoveMult::claimed` spelled out for
//                             damage too, or Арматура compounds 1.25 with the flag's 1.2.
//   `behaviour_melee_reach`   replace the `reach` line; widen the wall-query branch from
//                             the flag to `wall_query_needed`.
//   `behaviour_incoming_mult` needs the DEFENDER's row, so it belongs in `apply_damage`
//                             or at the queue site, not beside the attacker's multiply.
//   `facing_damage_mult`      a captured `CameraTag::yaw` beside the existing
//                             `playerPos`.
//   `burst_damage_mult`       the same multiply as `behaviour_damage_mult`, from `d2`.
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
//   ScentOvercommit (Жорная Тварь, 2.2) — food/meat as a competing attractor; needs
//     items dropped on the floor to be findable
//   MeatWorm (Олгой, 0.82) — radius ported (24 m); the 30 m BLOOD radius it widens to
//     for a bleeding target needs a damage trail, and the corpse/ambush halves need
//     droppable items. Same attractor as ScentOvercommit, different numbers.
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
// [combat.cpp] documents; wants a spawn-time attach and a two-phase pass).
//
// Shorter than it was, and the reason is worth carrying forward: FractureSprint was
// the headline entry here and it did not need state at all. Before filing anything
// else under this heading, check whether the thing being timed is a CYCLE (a pure
// function of (id, tick) — `burst_phase`, `mob_hunts_npcs`, `pack_target_node`) or a
// RESPONSE to an event (genuinely needs a component). The four below are responses:
//   CrowdShove (Дикий Мертвяк, 2.15) — HURT PACE PORTED (wave 4, x0.96 once damaged).
//     The charge itself fills from crowd density, which needs a neighbour scan and is
//     therefore not O(1) — that half is the response, and it is what is left.
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
//   LastSoundBeam (Слепоглаз, 1.05) — needs "shoot at a POINT"; [noise.h] names it
//   RoomBoundAberration (Комнатный обживальщик, 0.72) — a home anchor plus an anger meter
//   LurkingFurniture (Ковер, 0.72) — dormant radius ported; the wake, the
//     spore puff and the 17 m awake radius are not
//   FalsePhase (Ложный Дух, 0.72) — radius ported (24 m); the door-keyed flank itself
//     needs a phase state, and its 0.72/0.62 weak-phase multipliers hang off that
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
//
// NOT A BEHAVIOUR, and the largest single number wrong in the sight model:
//   `kAggroRadius` = 20 m is the reference's `MONSTER_DETECT`, which it hands to
//   RANGED and IMMOBILE kinds only. A mobile melee kind gets `MONSTER_MELEE_DETECT`
//   = 30 m (`!def.isRanged && def.speed > 0`). Measured on data/mobs.csv that is 54
//   of 69 rows sighted at 20 m where 30 m is authored, so the whole "notices you
//   earlier than 20 m" framing above is stated against the wrong baseline: at the
//   correct default, DocumentHunter's 24 m and ProtocolPressure's 26 m are kinds that
//   notice you LATE, not early. Fixing it belongs in [wander.h] with the constant, is
//   derived from the ROW rather than from the behaviour, and is a floor-wide balance
//   change — so it is named here and deliberately not done here.
//
//   CONFIRMED verbatim in wave 4, so the next reader does not have to re-derive it:
//   `const baseDetectSq = def && !def.isRanged && def.speed > 0 ?
//   MONSTER_MELEE_DETECT_SQ : MONSTER_DETECT_SQ;` — one line, in the monster update,
//   immediately before the `monsterDetectSq` call this file's switch mirrors.

// ---------------------------------------------------------------------------
// Wave 4 — the hook surface is exhausted; the WIRING is not
// ---------------------------------------------------------------------------
// Waves 2 and 3 each found more radii by re-reading the reference. Wave 4 went
// looking for a fourth batch and found that there is none, which is a result rather
// than a shortfall — so it is recorded here instead of being re-derived a fifth time.
//
// A behaviour in this file can only reach the running game through a function that
// ALREADY has a caller, because nothing here dispatches itself. There are exactly
// four such functions and all four were checked against the reference's own tables:
//
//   `pursuit_offset`         mined out. The reference has three geometric steers and
//                            this file has all three (POMOYNY_ROY's ring, GREEN_DOG's
//                            flank, PAUPSINA's standoff). Nothing else in it offsets a
//                            goal from the target; every other repositioner picks an
//                            absolute CELL from a grid scan (TONKAYA_TEN's bait line,
//                            LOZHNYY_DUKH's door), which is not an offset and cannot be
//                            expressed here at any radius.
//   `behaviour_aggro_radius` mined out for behaviours. `monsterDetectSq`'s 15 cases and
//                            the four overrides at the second detect site are all
//                            accounted for: 14 ported, SourceSwarm == the default, and
//                            netPossessor / fogSwimmer / blackWaterWake / debrisLurker
//                            vary with an input this engine lacks. The two remaining
//                            overrides there (KOSTOREZ, SAFEGUARD) sit on `Plain` rows,
//                            so they are not behaviour dispatch at all.
//   `behaviour_move_mult`    mined out for WALL-keyed pace, which is all its signature
//                            can express. `monsterMoveMult`'s other cases need water,
//                            fog, light, an inventory or a per-monster phase.
//   `frozen_by_gaze`         single-kind by construction.
//
// So the enumerator count cannot move much further without handing the dispatch site's
// existing state to a new hook, and wave 4 does exactly that — twice for a dimension
// this file has never touched, once for an input it has never read:
//
//   * **WallBrace gets its reach and its armour** (`behaviour_melee_reach`,
//     `behaviour_incoming_mult`). Both hang off `adjacentWall`, the query combat.cpp
//     ALREADY runs on the line above where they belong. The wave-2 note said these
//     "belong to combat, and `apply_damage` takes no MacroGrid" — true of
//     `apply_damage`, but the mob-attack pass that CALLS it has the grid in hand and
//     uses it (`wall_bias_damage(def.aiFlags, body_wall_adjacent(grid, tr.pos))`). The
//     signature change that was thought to be needed is not.
//   * **CrowdShove reads the mob's own health** (`behaviour_hurt_move_mult`). `MobRef`
//     has carried `hp` and `maxHp` since it existed and no behaviour has ever looked at
//     either. It is the last free input at the dispatch site.
//
// And a wiring audit, which turned out to matter more than another radius. Of the nine
// dispatchers that existed BEFORE wave 4, FOUR had never had a caller anywhere in
// `src/` — and wave 4's own three land unwired as well, so the live total is SEVEN (the
// roadmap block above lists all seven and the shape each one needs):
//
//   `behaviour_damage_mult`  unwired since wave 2 — the file says so.
//   `facing_damage_mult`     unwired since wave 3 — the file says so.
//   `burst_damage_mult`      unwired since wave 3 — the file says so.
//   `burst_speed_mult`       unwired since wave 3 — and the file says the OPPOSITE.
//
// That last one is the correction. The wave-3 note above claims its two mechanics were
// "chosen because both fit hooks that ALREADY have a live caller — `pursuit_offset` and
// the aggro switch — so they are reachable the moment they compile". That is true of
// WebSpitter and false of FractureSprint: `burst_phase` and `burst_speed_mult` are NEW
// hooks, `wander_step` calls neither, and Трескотник's entire published mechanic — the
// 0.35 s telegraph, the x3.25 lunge, the 1.35 s brittle window — has never once run in
// the game. Its 18 m radius is live, so the kind is half-live and the suite's own
// block 9 admits the other half ("nothing in src/ calls `burst_phase` yet") while the
// header promised it. At spawn weight 2.4 that is the most finished-but-invisible
// mechanic in the tree, and it costs one line in `wander_step` next to the pace
// multiply that is already there.
//
// Two reference mismatches found while confirming the above. Neither is fixable from
// this file — both need the mob's KIND at a call site that only passes flags — so they
// are recorded rather than half-done:
//
//   * **Тварь's pace is wrong in a live path.** `monsterMoveMult` has a TVAR case,
//     `adjacentWall ? 1.12 : 0.96`, and it returns BEFORE the `wallBias` branch. Тварь
//     carries `wallBias`, so this file's `wall_bias_speed` hands it 1.18 / 0.92 — a
//     number the reference never gives it. Spawn weight 6.2, the second-highest row in
//     the catalog and the highest-weight kind that touches the wall system at all.
//   * **`adjacentWall` is only half the reference's wall test.** Its `wallBias` branch
//     is `ctx.adjacentWall || ctx.narrowDoorOrCorner`, and `narrowDoorOrCorner` is not
//     computed here — so all four flag carriers take the OPEN penalty in a doorway
//     where the reference gives them the bonus. `kMatDoor` exists ([materials.h]), so
//     the input is present and only the test is missing.

} // namespace giga::game
