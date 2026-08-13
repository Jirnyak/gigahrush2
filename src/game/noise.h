// Noise as information — not audio.
//
// Nothing in this engine has ever made a sound a monster could act on. A gunshot,
// the loudest event in the game, was silent: it moved a projectile and nothing
// else. Four authored monster behaviours are blocked on exactly this primitive and
// on nothing else (see "What this unblocks" at the bottom), which makes it the
// highest-leverage missing piece in the 47-behaviour set.
//
// ---------------------------------------------------------------------------
// Why this is NOT the event bus
// ---------------------------------------------------------------------------
// [event_bus.h] is the right shape for "this happened": a transient ring drained
// and cleared once per tick, so nothing accumulates. Noise is the wrong shape for
// that in two ways, and both are load-bearing:
//
//   * A noise must OUTLIVE the tick that made it. A gunshot is worth walking
//     toward for ~2.8 s; an event cleared at the end of its own tick can never be
//     "recent". Making the bus persistent to fit would break the one property it
//     is documented to guarantee for every other consumer.
//   * A noise has a PLACE and a FADE. The bus event is a type tag plus three
//     opaque u32 slots — it cannot carry a position without every reader agreeing
//     on a bit-packing convention, and it has no notion of decay at all.
//
// So: its own structure, and the bus stays exactly as it is. The two coexist
// happily — a death publishes an `NpcDied` event AND a body-fall noise, because
// "the bookkeeping should know" and "something nearby should investigate" are
// genuinely different questions.
//
// ---------------------------------------------------------------------------
// Events, not a simulation
// ---------------------------------------------------------------------------
// There is no propagation solver, no acoustic field, no per-cell attenuation bake.
// A noise is a position, a loudness, and a moment; audibility is one toroidal
// distance test. That is deliberately LESS than the reference, which routes
// `getAcousticDistance` through its navigation region graph so a wall makes a
// sound arrive "further away" than it is. That is a real behavioural difference
// and it is stated here rather than buried: a gunshot on the far side of a wall is
// heard at its straight-line distance, so monsters currently hear through walls.
// Closing it needs a per-floor acoustic bake, which is a separate increment with
// its own cost, and the primitive's interface does not change when it lands —
// `heard_by` is the one place a distance is computed.
//
// ---------------------------------------------------------------------------
// Bounded and allocation-free
// ---------------------------------------------------------------------------
// A fixed 64-slot array (the reference's own `NOISE_RECORD_CAP`), swept per tick.
// No vector, no init(), no allocation anywhere in this file — a `NoiseField` is a
// 2 KB POD you can put on the stack, memcpy, or serialise verbatim.
//
// Overflow policy differs from the bus ON PURPOSE. The bus drops the newest and
// counts it, which is correct for bookkeeping. Here, dropping the newest would
// mean a full ring of footsteps could silently swallow a gunshot — the single most
// important event the system exists to carry. So a full field evicts its WEAKEST
// slot (lowest severity, then least remaining life) and only refuses the incoming
// noise when the incoming noise is itself the weakest thing present. Refusals are
// counted (`dropped`) so the tuning problem still surfaces.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "core/math.h"
#include "world/level_stack.h"   // LayerId

namespace giga::game {

struct RangedDef;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
// Radii and distances here are METRES, and the reference's authored radii are
// used 1:1 as metres rather than multiplied by kCellSize.
//
// That is not an oversight, it is the convention the hand-ported behaviour layer
// already established and it is worth pinning because the engine has TWO: the
// generated tables convert authored cells to metres (`shotRangeMm * 0.001f *
// kCellSize`), while every hand-ported AI range reads reference cells as metres —
// `kAggroRadius = 20.0f` from the reference's `MONSTER_DETECT = 20`,
// `behaviour_aggro_radius` 7.5 from `BEZEKHIY_DETECT_SQ = 7.5*7.5`,
// `kGazeRange = 25.0f`. Noise has to be comparable with the sight radius or
// "heard but not seen" is not expressible, so it joins that convention. If the
// two are ever reconciled, this whole file moves by one constant.
enum class NoiseSource : std::uint8_t {
    None = 0,
    WeaponFire,   // a gun going off — the loudest thing in the game
    Melee,        // a heavy or metal swing connecting
    Footstep,     // reserved; nothing publishes this yet
    Door,         // reserved; there are no doors yet
    Container,    // a crate/safe being opened
    Body,         // something hitting the floor dead
    Siren,        // samosbor warning; reserved
    Explosion,    // a grenade going off — louder than any gun, and the only
                  // severity-5 source in the tree ([combat.cpp] projectile_step)
    Decoy,        // a thrown noisemaker; reserved
    Count
};

// Loudness band, 0..5, matching the reference's `WorldEventSeverity`. It is the
// coarse gate every consumer filters on (`>= 2` for the investigation branch,
// `>= 2` for ScrapWake) — a footstep and a rifle must not be the same question.
inline constexpr std::uint8_t kNoiseSeverityMax = 5;

// One noise event. POD, exactly 32 bytes, no interior padding, trivially
// copyable — same stance as MobDef and Event.
struct Noise {
    float x = 0.0f;              //  0  world metres; x/y wrap toroidally, z does not
    float y = 0.0f;              //  4
    float z = 0.0f;              //  8
    float radius = 0.0f;         // 12  audible where the toroidal distance is <= this
    std::uint32_t id = 0;        // 16  monotonic, never reused; 0 means "empty slot"
    // Emitter, as `entt::to_integral`. A monster must not investigate its own
    // gunshot, and a behaviour that wants to know WHO to blame (LastSoundBeam aims
    // at the sound's source when that source is the player) needs the identity.
    std::uint32_t actor = 0;     // 20
    std::uint16_t ttlMs = 0;     // 24  remaining life — this is the fade
    std::uint16_t lifeMs = 0;    // 26  life at publish, so age = lifeMs - ttlMs
    std::uint8_t layer = 0;      // 28  LayerId, truncated; see kNoiseLayerMax
    std::uint8_t source = 0;     // 29  NoiseSource
    std::uint8_t severity = 0;   // 30  0..kNoiseSeverityMax
    std::uint8_t pad_ = 0;       // 31
};
static_assert(sizeof(Noise) == 32, "Noise must stay a tight 32-byte row");
static_assert(alignof(Noise) == 4);
static_assert(std::is_trivially_copyable_v<Noise>);

// `Noise::layer` is one byte because 64 rows x 4 spare bytes is 256 B of nothing,
// and the level stack is a handful of resident layers ([floors.md]: keepRadius is
// 0..2, so 3-5 slots). A publish from a layer beyond this is refused rather than
// aliased onto layer (id % 256) — silently answering for the wrong floor is the
// worse failure.
inline constexpr LayerId kNoiseLayerMax = 255u;

// Ring capacity. 64 is the reference's `NOISE_RECORD_CAP`, and it is generous:
// with the publishers wired today (one gunshot per weapon cooldown, one per crate,
// one per death) a busy second produces single digits.
inline constexpr std::size_t kNoiseCap = 64;

// Hard ceiling on an audible radius, metres. The reference's `NOISE_RADIUS_CAP`.
// A profile asking for more is clamped, so no data error can make one event
// audible across a 256 m torus — at which point the toroidal distance test stops
// discriminating anything, because half the world is within half the period.
inline constexpr float kNoiseRadiusCap = 48.0f;
inline constexpr float kNoiseRadiusMin = 0.75f;

// The field. Fixed storage, no allocation, trivially copyable.
struct NoiseField {
    std::array<Noise, kNoiseCap> slot{};
    std::uint32_t nextId = 1;      // 0 is reserved for "no noise"
    std::uint32_t dropped = 0;     // refused publishes since construction
    std::uint16_t liveCount = 0;   // maintained by publish/sweep, so quiet() is O(1)
    std::uint16_t pad_ = 0;

    // True when nothing at all is audible anywhere. THE gate every consumer tests
    // first, and it is true on almost every tick — which is what makes the whole
    // system free when nobody is shooting.
    bool quiet() const { return liveCount == 0; }
    std::size_t live() const { return liveCount; }
};
static_assert(std::is_trivially_copyable_v<NoiseField>);
static_assert(sizeof(NoiseField) == kNoiseCap * sizeof(Noise) + 12,
              "NoiseField is a flat POD; a hidden member would break memcpy/serialise");

// A publishable loudness. Separate from `Noise` because a profile is what a
// SOURCE knows (a rifle is this loud for this long) and a Noise is what the field
// stores (that rifle, there, with this much life left).
struct NoiseProfile {
    float radius = 0.0f;
    std::uint16_t ttlMs = 0;
    std::uint8_t severity = 0;
    NoiseSource source = NoiseSource::None;
};

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

// Add a noise at `pos` on `layer`. Returns the new id, or 0 if it was refused
// (a zero/negative radius or ttl, a layer past kNoiseLayerMax, or a full field in
// which this noise is the weakest thing present — see the overflow note above).
//
// Allocation-free and O(1) when a slot is free, O(kNoiseCap) when it must pick a
// victim to evict. Never grows.
std::uint32_t noise_publish(NoiseField& field, LayerId layer, const vec3& pos,
                            const NoiseProfile& p, std::uint32_t actor);

// Age every live noise by `dtMs` and free the expired. O(kNoiseCap), branch-light,
// no allocation. Returns the number that expired this sweep.
//
// Call it ONCE per sim tick. Where in the tick matters less than that it is one
// place: publish is idempotent-safe and the query is read-only, so the only
// ordering rule is that the sweep must not run between a publish and the consumer
// that should hear it. Sweeping at the TOP of the tick is what the wiring does,
// so a noise published this tick is guaranteed at least one full tick of life.
std::uint32_t noise_step(NoiseField& field, std::uint32_t dtMs);

// Drop everything. For a floor change: a gunshot on floor -14 must not be audible
// to the crowd on floor 0, and layer ids are recycled by the streamer.
void noise_clear(NoiseField& field);

// ---------------------------------------------------------------------------
// Source profiles — ported, not invented
// ---------------------------------------------------------------------------

// How loud a firearm is. Derived from the row, so a new CSV weapon is automatically
// as loud as its numbers deserve and there is no name list to keep in sync.
//
// This is the reference's own FALLBACK formula:
//   radius   = min(24, 9 + dmg/7 + min(8, pellets))
//   severity = radius >= 21 ? 4 : radius >= 13 ? 3 : 2
//   ttl      = 2.8 s
//
// Known divergence, stated because it is a real one: the reference ALSO carries an
// explicit 16-entry `RANGED_RADIUS_BY_WEAPON` name map that overrides the formula,
// and the two disagree substantially for automatics — `ak47` is authored at 22 and
// the formula gives 13.7, because an assault rifle is loud for its rate of fire
// rather than for its per-round damage, which the formula cannot see. The map is a
// hand list of item names; the formula reads the table we already generate. The
// formula is used here and the map is the natural content of a `noise_radius`
// column in `data/weapons_ranged.csv` — one column, one generator change, and this
// function reads the row instead of computing it. That was not bundled in here
// because touching a generated table mid-fan-out is how merges break.
NoiseProfile weapon_fire_noise(const RangedDef& d);

// A detonation, from its BLAST radius in metres — not from its damage, because what
// a room hears is how far the pressure went, not how much of it a body absorbed.
//
// This is what makes the note above literally true again: it says the reference's
// severity-5 arm is unreachable "because there is no aoeRadius among the 29
// ProjType::Normal rows". `data/weapons_ranged.csv` row 30 has one.
NoiseProfile blast_noise(float blastRadiusM);

// A body hitting the floor. Quiet and short: severity 2 is the investigation
// threshold, so a death is worth one look and no more. Not in the reference as a
// noise source at all — it publishes `entity_died` as an EVENT and several
// behaviours react to that — so this is the honest minimum that makes a kill
// audible without inventing a loudness for it.
NoiseProfile body_fall_noise();

// A crate or safe being opened. The reference's `door` profile, non-hermetic,
// non-quiet: radius 7, ttl 2.2 s, severity 2. A container lid and a door are the
// same event acoustically, and reusing the authored numbers beats guessing.
NoiseProfile container_open_noise();

// ---------------------------------------------------------------------------
// Hearing
// ---------------------------------------------------------------------------

// Straight-line toroidal distance from `pos` to `n`, metres. THE one place a
// distance is computed, so an acoustic bake later has exactly one caller to change.
float noise_distance(const Noise& n, const vec3& pos);

// Can something at `pos` hear `n`? `hearingMult` scales the noise's radius, which
// is how the reference expresses a sharp-eared kind (1.12 for the shared
// investigation branch, 1.45 for Slepoglaz, 1.55 for Tumannik).
bool noise_audible(const Noise& n, const vec3& pos, float hearingMult);

// The most worth-reacting-to noise a listener at `pos` on `layer` can hear, or
// nullptr. `outDist` receives the metres when non-null.
//
// Scored, not nearest — the reference's own weighting:
//     severity*10 + nearness*8 - age_seconds*0.5
// so a distant rifle beats a nearby footstep, a fresh sound beats a stale one, and
// among equals the closer wins. Nearest-only would make a monster investigate the
// crate it is standing next to while a firefight happens 20 m away.
//
// `ignoreActor` is skipped entirely (pass the listener's own id, or 0). Without it
// every monster that ever shoots investigates its own muzzle.
//
// O(kNoiseCap) with an early-out on `quiet()`. No allocation, no state, no memory
// of previous calls — deliberately: "have I already reacted to this one?" is the
// CONSUMER's state, and `Noise::id` is monotonic precisely so a one-shot behaviour
// (GreenDogPack's fear, ScrapWake's wake) can store six bytes and answer it.
const Noise* loudest_heard(const NoiseField& field, LayerId layer, const vec3& pos,
                           float hearingMult, std::uint8_t minSeverity,
                           std::uint32_t ignoreActor, float* outDist);

// Short ASCII label for a source, for the HUD and test output. Never null, and never
// Cyrillic: the reference's player-facing strings are Russian, but this is a debug
// readout and the HUD's Cyrillic atlas is a separate concern from the primitive.
const char* noise_source_name(NoiseSource s);

// ---------------------------------------------------------------------------
// What this unblocks, and what each still needs
// ---------------------------------------------------------------------------
// Wired here: the shared noise-investigation branch, via [hunt.h] `hunt_step` —
//   the reference's `tryFollowNoise`, minSeverity 2, hearingMult 1.12.
//
// Now POSSIBLE, each still needing its own listed piece:
//
//   LastSoundBeam (Слепоглаз, MobBehaviour::LastSoundBeam)
//       Blind: it aims at the last sound instead of at a target. `loudest_heard`
//       with hearingMult 1.45 IS the aim acquisition. Still needs: a shot that
//       fires at a POINT rather than at the camera holder — `mob_attack_step`
//       resolves one victim entity and lobs at it, and there is no code path for
//       "shoot at these coordinates". `spawn_projectile` already takes a `to`
//       vec3, so this is a branch in the attack step, not a new system.
//
//   GreenDogPack fear (Зелёный Пёс, the noiseFear half)
//       Breaks off from loud metal within 18 m. `loudest_heard` answers "is there
//       loud metal", and 18 m is `kDogFearRadius` in [hunt.h]. Still needs: (a) a
//       flee steer — every steering path in the tree moves TOWARD something; and
//       (b) six bytes of per-mob state, because the fear is one-shot per noise id
//       and lasts 4.6 s past it. That state is the reason it is not here: adding
//       a component means an `emplace` inside a view, which is the crash
//       [combat.cpp] documents at length, so it wants the two-phase treatment and
//       a spawn-time attach.
//
//   ScrapWake (Ржавник, MobBehaviour::ScrapWake)
//       Wakes on severity >= 2. That test is `loudest_heard(..., minSeverity=2,
//       ...) != nullptr` and nothing else. Still needs: a dormant state at all —
//       there is no sleeping monster in gigahrush2. Every spawned mob is awake, so
//       "wakes" has nothing to wake from. Three states, a windup timer, and a
//       fragile-while-dormant damage multiplier.
//
//   DeadEcho (Безэхий, MobBehaviour::DeadEcho)
//       Will not investigate noise until revealed. Already correct here: the
//       reference's own guard is `hasAIFlag(e,'deadEcho') && !revealed -> return
//       false`, and `hunt_step` refuses it outright, because "revealed" does not
//       exist yet and refusing is the reference's pre-reveal behaviour. When a
//       reveal flag lands this becomes a one-line condition. Still needs: the
//       reveal state (gaze-hold, close radius, or damage).
//
// Not attempted, and honest about why: the reference gates several of these on
// noise TAGS (`metal`, `pipe`, `valve`, `counterplay`) rather than on source and
// severity. Tags are a variable-length string list per record; a 32-byte POD row
// cannot carry them and should not. When a behaviour genuinely needs "was that
// metal", the answer is one more `NoiseSource` value or one flag bit, added with
// its consumer.

} // namespace giga::game
