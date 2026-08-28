// Utility AI — the intent ARBITER for embodied NPC bodies ([ai.md], #12).
//
// ===========================================================================
// READ THIS FIRST: WHO OWNS `Velocity`.
// ===========================================================================
// This file exists because main already has systems that steer. Dropping a
// second steerer in would make two systems write the same body's horizontal
// `Velocity` on the same tick, and the symptom is a creature that vibrates —
// a bug that reads as broken physics and is not. The parked branch driver
// (`tools/branch_port_pending/ai.cpp`) was exactly that second writer, which is
// why `main.cpp` parked it instead of calling it.
//
// The measured writer list on main (2026-07-29, per-tick passes only):
//
//   controller_step   src/sim/controller.cpp    view<Transform,Velocity,Controller,CameraTag>
//                     -> the camera holder ONLY (needs BOTH Controller and
//                        CameraTag). Unconditional every tick. The player.
//   wander_step       src/game/wander.cpp      view<Transform,Velocity,WanderTarget>
//                     -> layer-filtered, skips CameraTag, identity-staggered
//                        1-in-kWanderPeriod(8). EVERY visited body is written
//                        (each branch either steers or explicitly zeroes x/y).
//                        This is the crowd's real steerer: flow-field roaming,
//                        pack cohesion, mob pursuit, gaze-freeze, wall-bias pace.
//   investigate_step  src/game/investigate.cpp view<const MobRef,const Transform,Velocity>
//                     -> MOBS ONLY. Never touches a body without MobRef, so it
//                        cannot collide with this file's scope. Deliberately
//                        shares wander's stagger phase to override it.
//   physics_step      src/sim/physics.cpp      view<Transform,Velocity> excl SelfIntegrating
//                     -> reads to integrate; writes v.z (gravity/jump) and zeroes
//                        an axis on collision. The integrator, not a steerer.
//   slow_step         src/game/combat.cpp      view<Slowed,Transform,Velocity>
//                     -> CLAMPS magnitude, idempotent by construction. A
//                        post-filter, not an owner. NOT wired in main.cpp today.
//   faction_feud_step src/game/faction_relations.cpp view<Transform,Velocity,const NpcRef>
//                     -> IS a second NPC writer, and it is LIVE: main.cpp calls it
//                        every tick (main.cpp ~line 1022, after wander_step and
//                        investigate_step, before physics_step), and it writes
//                        `Velocity& vel = view.get<Velocity>(e)` at
//                        faction_relations.cpp ~line 270. Its scope is EXACTLY this
//                        file's — an NpcRef body — so it needs the SAME one-line
//                        guard wander_step gets below, and it needs it on the day
//                        `AiConfig::enabled` is first set true. An earlier revision
//                        of this comment claimed it was unwired; that was wrong, and
//                        it is the one hole in the single-writer claim below.
//                        Gated on a staggered fight licence plus an enemy in range,
//                        so the overlap is a handful of bodies per tick — and because
//                        it runs LAST the symptom is not vibration but a flee that is
//                        silently cancelled: the AI's write is simply discarded.
//   one-shot, not per-tick: embody.cpp / mob_spawn.cpp / loot.cpp emplace a
//                        zeroed Velocity at creation; combat.cpp emplaces a
//                        projectile's launch velocity; save.cpp zeroes on load.
//
// THE RULE THIS FILE ENFORCES: for a given body on a given tick, exactly one
// system writes horizontal `Velocity`. It is enforced by a TOKEN, not by call
// order — call order is not a contract (main.cpp already reorders this loop for
// samosbor, and a last-writer-wins arrangement breaks silently the next time it
// moves, while also paying for a write nobody reads).
//
// STATE OF THAT RULE — CORRECTED, and the previous revision was wrong in a way worth
// recording. It claimed the token mechanism was complete and that `wander_step`'s
// guard was "proven from both sides by suite_utilai.inl", leaving only
// `faction_feud_step` outstanding. In fact `ai_owns_motion` had NO caller anywhere in
// `src/`: every reference to it lived inside `suite_utilai.inl`, which applies the
// guard in its own harness. The suite therefore proved the RULE and not the WIRING,
// while this header read as though the wiring existed — so unparking `ai_step` would
// have produced exactly the vibration the whole design exists to prevent.
//
// Both call sites are real now: `src/game/wander.cpp` and
// `src/game/faction_relations.cpp` each carry `if (ai_owns_motion(reg, e)) continue;`.
// The mechanism is whole in the tree, not only in the test's model of it.
//
// Both guards are ADDITIVE while `ai_init` has no caller: no `AiBrain` means
// `ai_owns_motion` returns false, so both passes are bit-for-bit what they were. That
// is deliberate — the guards land BEFORE the AI is switched on, so the day `ai_step`
// is unparked is a one-line change against arbitration that is already green, instead
// of three interacting changes landing together.
//
// The token is `AiBrain::motion`. `ai_step` runs BEFORE `wander_step`, decides
// per body whether it or wander steers this tick, and writes the token. Then:
//
//   * `ai_step` writes Velocity iff `motion == MotionOwner::Ai`;
//   * `wander_step` skips a body iff `ai_owns_motion(reg, e)` — one line.
//
// Two properties make this safe to land:
//
//   1. NO `AiBrain` COMPONENT => `ai_owns_motion` is false => wander_step
//      behaves EXACTLY as it does today. `AiBrain` is attached only by
//      `ai_init`, so if `ai_init` is never called the guard is a load of a null
//      pointer and nothing else changes. That is what makes default-off real
//      rather than aspirational.
//   2. SCOPE IS EMBODIED NPC BODIES: `NpcRef` and NOT `MobRef` and NOT
//      `CameraTag`. Mobs keep the existing wander/investigate arbitration
//      untouched (they have their own behaviour tables, [mob_behaviour.h]); the
//      player keeps `controller_step`. So the foreign steering systems that need a
//      guard are `wander_step` and `faction_feud_step` — two `continue`s, no more,
//      and BOTH ARE IN PLACE as of this revision,
//      because `investigate_step` is excluded by TYPE (it views `const MobRef`) and
//      `controller_step` needs BOTH `Controller` and `CameraTag`. See "STATE OF THAT
//      RULE" above for how this claim was wrong before both guards were real.
//
// ===========================================================================
// WHAT THE BRAIN ACTUALLY DECIDES
// ===========================================================================
// A pure scorer ranks 13 intents 0..100; argmax + hysteresis commits one. Ported
// from the reference `npc_utility.ts` / `npc_fsm.ts` per-intent bodies. Inputs
// the engine cannot yet supply (mob perception, a room-affordance model, a
// minute-of-day clock) enter through the `Perception` seam at zero/none/-1, so
// their additive terms contribute 0 and the ranking among the LIVE inputs
// (needs + the diffusion danger field + this file's memory column + faction
// traits) is the reference's.
//
// AN INTENT EARNS Ai OWNERSHIP WHEN IT HAS SOMEWHERE TO GO, and until 2026-08-06
// exactly one ever did. `IntentFlee` has TWO direction sources, tried in order:
//
//   1. the live baked diffusion danger gradient ([diffusion.md]);
//   2. failing that, the body's own remembered danger cells (see MEMORY below).
//
// Source 2 exists because the diffusion field EVAPORATES, so without it a body
// hands itself straight back to wander the moment the field it was running from
// decays — and walks back into the corridor on the next re-plan.
//
// EVERY OTHER INTENT DELEGATED TO `wander_step`, and that single fact is what made
// the whole scorer decoration: measured on a live run, `own_ai=0` out of 419 bodies
// with the clock running for all of them ([problems.md] §27 — the reverted fix). A
// decision to eat that cannot steer a body is not a decision.
//
// It is now a THIRD source, and it is a table rather than a second special case:
// `intent_room_mask` ([room_zone.h]) answers "which room kind satisfies this
// intent", and an intent with an answer descends that kind's baked 128^3 field,
// walks to its own SEAT inside the room, and holds still there while the room's
// ambient recovery does the work. eat/drink -> Kitchen, toilet -> Bathroom,
// sleep -> Living today; work/social/patrol are a ROW away and deliberately not
// taken yet, so one behaviour change is measurable at a time.
//
// An intent with NO row, or a floor whose mix contains none of the rooms it names
// (an Industrial floor has no kitchen at all), still delegates to `wander_step` —
// which is right: wander already owns the flow-field roaming this engine has, and
// duplicating it here would be a worse copy.
//
// STORAGE: needs are NOT re-homed here. `Needs` is a NpcPool row on purpose
// ([needs.h]: the elevator destroys and rebuilds the player body, so a component
// would reset the survival clock every floor ride). This file only READS that
// row, and never advances it — widening the survival clock to the crowd is a
// separate decision [needs.h] explicitly defers. A crowd row is usually
// `seeded == 0` (all zeros), which would read as "starving, parched and
// exhausted" and peg the whole crowd on eat/drink; so an unseeded row is
// substituted by a deterministic local roll from the record id. Local, not
// written back: the scorer mutates no shared state.
//
// ===========================================================================
// MEMORY (`AiMemory`) — the second thing the brain has, and the reason a crowd
// reads as alive rather than as 400 identical reflexes.
// ===========================================================================
// The reference keeps a per-NPC `NpcMemory` in a module-level `Map` with an
// 8-entry `observedFacts` ring, per-kind TTLs, and a freshness curve
// (`src/systems/npc_memory.ts`). Ported here as a FLAT id-indexed column of
// fixed 8-slot rings — no map, no per-body allocation, no pointer chasing.
//
// WHY IT IS NOT ON THE ENTITY. Memory is keyed by `NpcId`, not by `Entity`, for
// exactly the reason [needs.h] gives for the survival clock: an elevator ride
// DESTROYS the body and builds a new one, so an ECS component would wipe what
// the person knows every time they change floor. A resident who saw a monster on
// floor -8 still knows it after riding to -14 and back. `AiBrain` stays on the
// entity because it is transient scheduling state that SHOULD reset.
//
// FOOTPRINT, stated because "affordable at 2^20" is the only bar that matters
// here (all figures at kNpcPoolSize == 2^20, where 1 B/row == 1.0 MiB exactly,
// the same arithmetic [npc_pool.h] "Column allocation policy" uses):
//
//   MemoryTrace   8 B  (one uint32 of packed kind/strength/payload + one float)
//   MemoryRow    64 B  (kMemSlots == 8 traces, the reference's own per-NPC cap)
//   ---------------------------------------------------------------------
//   full 2^20 capacity      64 B x 1,048,576 = 64.0 MiB
//   the 950k active target  64 B x   950,000 = 58.0 MiB
//   demo stack (420 seeded) grown to the 4096-row chunk floor = 256.0 KiB
//   nothing has remembered anything yet                       = 0 B
//
// For scale: `rel_`, the widest column in the pool, is 128 B/row = 128.0 MiB.
// Memory is exactly half of that, and unlike `rel_` it has a reader on the same
// day it lands. `kMemSlots` is the one knob — at 4 slots the row is 32 B and the
// capacity figure halves; a `static_assert` pins the width so a retune is
// visible in the diff rather than silent.
//
// AND IT IS A **DEMAND** COLUMN. `AiMemory` starts with an EMPTY vector and
// allocates nothing until the first `ai_remember_*` call, growing geometrically
// from a 4096-row floor (`kMemChunk` == [npc_pool.h] `kNpcLazyChunk`, and
// geometric for the reason that comment measures: fixed-chunk growth at the 950k
// target would copy the column 232 times). A 64 MiB allocation nothing reads is
// precisely the waste this project keeps finding, so `resident_bytes()` reports
// the live figure and the suite prints it.
//
// WHAT IT CHANGES. Memory enters the scorer through the `Perception` seam like
// every other input, so it cannot reach around the pure function:
//
//   * a remembered DANGER or HURT cell becomes another channel of
//     `compute_threat_pressure` (scaled by kMemThreatWeight, the same way the
//     reference scales gunfire 0.75 and fog 0.6 as weaker evidence). This is the
//     load-bearing behaviour: the diffusion field EVAPORATES ([diffusion.md]), so
//     without memory a body forgets a corridor was lethal the moment the field
//     decays and walks straight back in. With memory it keeps fleeing.
//   * a remembered SITE (food/water/rest/toilet/ally) becomes a per-intent
//     `localScore` affordance — the reference's room-affordance slot, capped at
//     the reference's own `Math.min(10, ...)` — plus a per-intent `targetPenalty`
//     distance cost using the reference's verbatim `clamp01(d/96)*24`.
//   * a remembered FOE (an NpcId, not a cell) becomes a grudge, split between
//     combat and flee by the body's `risk` trait: the same insult makes a
//     Liquidator turn and fight and a Citizen run.
//
// WHAT WRITES IT. Two recorders are LIVE inside `ai_step` and need no other
// system: the danger field at the body's own cell (sampled on its staggered
// re-plan, which is the reference's "sample recent local facts on your own AI
// tick"), and an HP DROP (checked every tick, because damage is an event and the
// cell it happened in is the fact). `MemFood`/`MemWater`/`MemRest`/`MemToilet`/
// `MemAlly`/`MemFoe` have NO producer in `src/` yet and that is stated rather
// than faked — the read path is real and measured, so the day container/loot/
// combat code calls `ai_remember_cell`/`ai_remember_actor` the term lights up
// with no scorer edit. Same stubbed-input stance as `Perception` itself.
//
// LOCALITY, not omniscience: a body only ever records the cell it is STANDING
// in. There is no scan, no radius query, no event ring walk — which is both the
// reference's rule ("NPCs should react by locality and memory, not by
// omniscience") and the only version that is O(1) per body.
#pragma once

#include <cstdint>
#include <vector>

#include "core/rng.h"          // hash_u32 / hash2 / rand01 — stateless identity hashing
#include "ecs/registry.h"      // Registry, Entity
#include "game/faction.h"      // Faction / kFactionCount — the trait table's index
#include "game/npc_pool.h"     // NpcPool, NpcId, Needs (the pool row this reads)
#include "world/level_stack.h" // LayerId
#include "world/types.h"       // kCellSize — the seat radius is stated in cells

// Pointer/reference parameters need only a declaration, so the header stays
// light; ai.cpp includes world/field.h + world/macro_grid.h for the definitions.
namespace giga {
template <class T> class Field;
class MacroGrid;
class World;
} // namespace giga

namespace giga::game {

// ---------------------------------------------------------------------------
// The 13 intents, in the reference's fixed order.
//
// The INDEX is load-bearing twice over: `select_intent` breaks argmax ties
// toward the lower index, and each intent's identity-jitter channel is
// "score:<name>" (kIntentScoreChannel), so reordering reshuffles every agent's
// behaviour.
// ---------------------------------------------------------------------------
enum IntentId : std::uint8_t {
    IntentSafety = 0,
    IntentCombat,
    IntentFlee,
    IntentToilet,
    IntentDrink,
    IntentEat,
    IntentSleep,
    IntentWork,
    IntentHeal,
    IntentSocial,
    IntentPatrol,
    IntentFactionAssault,
    IntentWander,
    kIntentCount
};

// "no committed intent yet" sentinel for AiBrain::currentIntent.
inline constexpr std::uint8_t kIntentNone = 0xFFu;

inline constexpr const char* kIntentName[kIntentCount] = {
    "safety", "combat", "flee",   "toilet", "drink",  "eat",   "sleep",
    "work",   "heal",   "social", "patrol", "assault", "wander",
};
// The reference keys its jitter channels by the runtime string "score:"+name.
// Pre-built literals so the hot path folds a fixed string with no concatenation.
inline constexpr const char* kIntentScoreChannel[kIntentCount] = {
    "score:safety", "score:combat", "score:flee",   "score:toilet",
    "score:drink",  "score:eat",    "score:sleep",  "score:work",
    "score:heal",   "score:social", "score:patrol", "score:faction_assault",
    "score:wander",
};

// ---------------------------------------------------------------------------
// MotionOwner — the arbitration token. See the file header.
//
// `Wander` is 0 so a zero-initialised `AiBrain` delegates: the failure mode of
// forgetting to set the token is "behaves like today", never "frozen crowd".
// ---------------------------------------------------------------------------
enum class MotionOwner : std::uint8_t {
    Wander = 0, // wander_step writes this body's horizontal Velocity
    Ai = 1,     // ai_step writes it; wander_step must skip the body
};

// ---------------------------------------------------------------------------
// AiBrain — the whole per-body brain state, and it is deliberately tiny.
//
// The reference parks this in module WeakMaps; here it is an ECS component so it
// materialises on `ai_init` and folds away with the entity, like Velocity.
// `nextDecisionAt` is the ONLY scheduling state: no wheel, no queue, no per-body
// timer list. `switches` is telemetry that exists to be measured — a hysteresis
// claim you cannot count is not a claim.
// ---------------------------------------------------------------------------
struct AiBrain {
    std::uint8_t currentIntent = kIntentNone;
    std::uint8_t motion = static_cast<std::uint8_t>(MotionOwner::Wander);
    std::uint16_t decisions = 0; // re-plan count
    std::uint16_t switches = 0;  // times currentIntent actually CHANGED
    // The HP this body had when `ai_step` last visited it, so a DROP is
    // detectable without a damage event bus: `hp < lastHp` on any tick means the
    // body was hurt HERE, and "here" is the fact worth remembering.
    //
    // This field is the former `pad_`, reclaimed rather than appended, which is
    // why the 16-byte assert below is unchanged. Zero-init is correct and not a
    // sentinel: the first visit sees `hp > 0 == lastHp`, i.e. a heal, records
    // nothing, and latches the real value. `std::int16_t` because that is exactly
    // `NpcPool::hp`'s type — a narrower field would silently clip a boss.
    std::int16_t lastHp = 0;
    float stateTimer = 0.0f;     // seconds committed to currentIntent
    float nextDecisionAt = 0.0f; // absolute sim time of the next re-plan
};
static_assert(sizeof(AiBrain) == 16, "the whole brain is 16 bytes per body");

// THE GUARD other steering systems call. One line at the top of their per-entity
// body: `if (ai_owns_motion(reg, e)) continue;`.
//
// A body with no AiBrain returns false, which is what makes this additive: with
// `ai_init` never called, every existing steerer is bit-for-bit unchanged.
inline bool ai_owns_motion(const Registry& reg, Entity e) {
    const AiBrain* b = reg.try_get<AiBrain>(e);
    return b != nullptr && b->motion == static_cast<std::uint8_t>(MotionOwner::Ai);
}

// --- Identity hashing -------------------------------------------------------
// Reuses the shared lowbias32 finaliser ([core/rng.h] hash_u32 == the reference
// mix32) and rand01 (== the reference jitter01). Only the FNV-1a string fold is
// AI-local, because the reference keys its jitter channels by string and we
// reproduce that byte-for-byte. DISTINCT from the Murmur3 fmix32 used elsewhere.
inline constexpr std::uint32_t kFnvPrime = 16777619u;    // FNV-1a 32
inline constexpr std::uint32_t kHashGolden = 0x9e3779b9u; // channel decorrelator

inline void fnv_fold(std::uint32_t& h, const char* s) {
    for (; *s != '\0'; ++s) {
        h ^= static_cast<std::uint32_t>(static_cast<unsigned char>(*s));
        h *= kFnvPrime;
    }
}

// channelSeed(idSeed, channel): fold the channel string into idSeed^golden, then
// finalise with mix32. Matches the reference channelSeed string path.
inline std::uint32_t channel_seed(std::uint32_t idSeed, const char* channel) {
    std::uint32_t h = idSeed ^ kHashGolden;
    fnv_fold(h, channel);
    return hash_u32(h);
}

// Per-agent identity seed (the reference `alifeId` channel). The NpcId is the
// stable identity, so an agent's jitter is reproducible across embodiments with
// zero stored RNG state — the same body behaves the same way after an elevator.
inline std::uint32_t identity_seed(std::uint32_t npcId) {
    return hash_u32(0xa11fe000u ^ npcId);
}

// Signed jitter in [-amp, amp] (rand01 == the reference jitter01).
inline float jitter_signed(std::uint32_t channelSeed, float amp) {
    return (rand01(channelSeed) * 2.0f - 1.0f) * amp;
}

// --- Faction traits ---------------------------------------------------------
// With no occupation layer yet ([npcs.md]), the scorer's behavioural traits
// resolve purely from faction. The table is kFactionCount + 1 rows wide because
// `kFactionPlayerRow` ([faction_relations.h]) is a real index a pool row can
// hold; the player row equals the Citizen row, which is the reference's
// "default" branch. `workDrive` is the reference default 0.5 everywhere until
// occupations land.
inline constexpr std::size_t kAiTraitRows = kFactionCount + 1;
struct FactionTraits {
    float duty;
    float sociability;
    float risk;
    float panic;
    float patrolDrive;
    float workDrive;
};
inline constexpr FactionTraits kFactionTraits[kAiTraitRows] = {
    /* Citizens    */ {0.55f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
    /* Liquidators */ {0.82f, 0.48f, 0.74f, 0.22f, 0.82f, 0.50f},
    /* Cultists    */ {0.62f, 0.32f, 0.60f, 0.35f, 0.58f, 0.50f},
    /* Scientists  */ {0.74f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
    /* Wild        */ {0.55f, 0.25f, 0.60f, 0.35f, 0.42f, 0.50f},
    /* Player row  */ {0.55f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
};
// Clamp rather than modulo: folding an out-of-range faction onto Citizens would
// repeat the `faction & 3` bug that silently made Wild behave like a citizen.
inline const FactionTraits& faction_traits(std::uint16_t faction) {
    const std::size_t i = static_cast<std::size_t>(faction);
    return kFactionTraits[i < kAiTraitRows ? i : kAiTraitRows - 1];
}

// ===========================================================================
// MEMORY — the fixed-size ring. See the file banner for why it exists, where it
// lives, and what it costs.
// ===========================================================================

// What a trace can be about. The ENUM VALUE is stored in 4 bits of the packed
// word, so the count is capped at 16 and `MemNone == 0` doubles as "empty slot"
// (a zeroed row is genuinely empty, never a fact about cell 0).
//
// Two payload families, and which one a kind uses is fixed per kind:
//   CELL  — MemDanger, MemHurt, MemFood, MemWater, MemRest, MemToilet
//   ACTOR — MemFoe, MemAlly   (payload is an NpcId)
// `mem_kind_is_actor` is the one place that mapping lives.
enum MemoryKind : std::uint8_t {
    MemNone = 0,  // empty slot
    MemDanger,    // the danger field was hot at this cell
    MemHurt,      // I lost HP at this cell
    MemFoe,       // this PERSON hurt me (payload = NpcId)
    MemFood,      // there was food at this cell
    MemWater,     // there was water at this cell
    MemRest,      // this cell was safe enough to sleep in
    MemToilet,    // this cell will do for relief
    MemAlly,      // this PERSON is worth talking to (payload = NpcId)
    kMemKindCount
};
static_assert(kMemKindCount <= 16,
              "MemoryKind is stored in 4 bits of MemoryTrace::packed");

inline constexpr bool mem_kind_is_actor(std::uint8_t kind) {
    return kind == MemFoe || kind == MemAlly;
}

// Per-kind lifetime in SECONDS, ported from the reference `observedFactTtl`
// (npc_memory.ts): murder/samosbor/rare-monster class 900, resource/shortage
// class 720. The value is the WHOLE decay model — there is no per-slot TTL byte,
// because a table keyed by kind is data-driven and a stored copy would be 8 more
// bytes per row saying the same thing eight times.
inline constexpr float kMemTtlSec[kMemKindCount] = {
    /* MemNone   */ 0.0f,
    /* MemDanger */ 900.0f,
    /* MemHurt   */ 900.0f,
    /* MemFoe    */ 900.0f,
    /* MemFood   */ 720.0f,
    /* MemWater  */ 720.0f,
    /* MemRest   */ 720.0f,
    /* MemToilet */ 720.0f,
    /* MemAlly   */ 720.0f,
};
inline constexpr float mem_ttl_sec(std::uint8_t kind) {
    return kind < kMemKindCount ? kMemTtlSec[kind] : 0.0f;
}

// The reference's `mostUsefulObservedFact` freshness curve, verbatim:
// `max(0, 30 - floor(age / 30))`. It starts at 30 and reaches 0 at exactly 900 s,
// which is the longest TTL above — the two numbers agree in the reference and are
// kept agreeing here. Integer truncation IS floor for a non-negative age, so this
// needs no <cmath> and stays constexpr in the header.
inline constexpr float kMemFreshnessMax = 30.0f;
inline constexpr float kMemFreshnessStepSec = 30.0f;
inline constexpr float mem_freshness(float ageSec) {
    if (ageSec < 0.0f) return kMemFreshnessMax;
    const float steps =
        static_cast<float>(static_cast<int>(ageSec / kMemFreshnessStepSec));
    const float f = kMemFreshnessMax - steps;
    return f > 0.0f ? f : 0.0f;
}

// --- The packed payload -----------------------------------------------------
// One 32-bit word carries the whole fact except its timestamp:
//
//   bits  0..20  payload — 21 bits
//   bits 21..24  kind    —  4 bits (MemoryKind)
//   bits 25..31  strength—  7 bits (0..127, the reference's 1..100 `score` band)
//
// 21 payload bits is not a coincidence and both users are asserted below: a macro
// cell is 3 x 7 bits (kMacroDim == 128) = 21, and an NpcId is kNpcPoolBits == 20.
// Packing them into one field is what keeps the trace at 8 bytes instead of 12,
// i.e. the row at 64 B instead of 96 B — 32.0 MiB of capacity.
inline constexpr std::uint32_t kMemPayloadBits = 21;
inline constexpr std::uint32_t kMemPayloadMask = (1u << kMemPayloadBits) - 1u;
inline constexpr std::uint32_t kMemKindShift = kMemPayloadBits;      // 21
inline constexpr std::uint32_t kMemStrengthShift = kMemKindShift + 4; // 25
inline constexpr std::uint32_t kMemStrengthMax = 127;                 // 7 bits

inline constexpr std::uint32_t kMemCellBits = 7; // kMacroDim == 128 -> 7 bits/axis
static_assert(kMemCellBits * 3 <= kMemPayloadBits,
              "a macro cell must fit the packed payload");
static_assert(kNpcPoolBits <= kMemPayloadBits,
              "an NpcId must fit the packed payload");

inline constexpr std::uint32_t mem_pack_cell(int cx, int cy, int cz) {
    return (static_cast<std::uint32_t>(cx) & 0x7Fu) |
           ((static_cast<std::uint32_t>(cy) & 0x7Fu) << kMemCellBits) |
           ((static_cast<std::uint32_t>(cz) & 0x7Fu) << (kMemCellBits * 2));
}
inline constexpr int mem_cell_x(std::uint32_t payload) {
    return static_cast<int>(payload & 0x7Fu);
}
inline constexpr int mem_cell_y(std::uint32_t payload) {
    return static_cast<int>((payload >> kMemCellBits) & 0x7Fu);
}
inline constexpr int mem_cell_z(std::uint32_t payload) {
    return static_cast<int>((payload >> (kMemCellBits * 2)) & 0x7Fu);
}

// One remembered fact. POD, trivially copyable, no indirection.
//
// `seenAt` is absolute sim SECONDS on the same clock as `AiBrain::nextDecisionAt`
// and `ai_step`'s `now`, stored as a float for the same reason that field does —
// a 16-bit tick counter would wrap inside a long session and a wrap reads as
// "just seen", which is the one failure mode a memory must not have.
struct MemoryTrace {
    std::uint32_t packed = 0;  // strength | kind | payload
    float seenAt = 0.0f;       // absolute sim seconds

    std::uint8_t kind() const {
        return static_cast<std::uint8_t>((packed >> kMemKindShift) & 0xFu);
    }
    std::uint32_t payload() const { return packed & kMemPayloadMask; }
    // 0..1, the observed magnitude at record time.
    float strength() const {
        return static_cast<float>((packed >> kMemStrengthShift) & kMemStrengthMax) /
               static_cast<float>(kMemStrengthMax);
    }
    bool empty() const { return kind() == MemNone; }
};
static_assert(sizeof(MemoryTrace) == 8, "a trace is 8 bytes; the row width depends on it");
static_assert(alignof(MemoryTrace) == 4);

inline MemoryTrace mem_trace(std::uint8_t kind, std::uint32_t payload,
                             float strength01, float seenAt) {
    const float s = strength01 < 0.0f ? 0.0f : (strength01 > 1.0f ? 1.0f : strength01);
    const std::uint32_t q = static_cast<std::uint32_t>(
        s * static_cast<float>(kMemStrengthMax) + 0.5f);
    MemoryTrace t;
    t.packed = (payload & kMemPayloadMask) |
               (static_cast<std::uint32_t>(kind & 0xFu) << kMemKindShift) |
               ((q > kMemStrengthMax ? kMemStrengthMax : q) << kMemStrengthShift);
    t.seenAt = seenAt;
    return t;
}

// The reference's `MAX_OBSERVED_FACTS_PER_NPC`. Changing it changes the row
// width, which the static_assert below makes visible.
inline constexpr int kMemSlots = 8;

// One body's whole memory. NO head cursor: insertion picks an empty, then an
// expired, then the WEAKEST slot (lowest strength+freshness, ties to the lower
// index), which is the reference's `trimObservedFacts` + `mostUsefulObservedFact`
// pair run backwards. Dropping the cursor is what makes the row exactly 64 B.
struct MemoryRow {
    MemoryTrace slot[kMemSlots];
};
static_assert(sizeof(MemoryRow) == 8 * kMemSlots,
              "64 B/row at kMemSlots == 8, i.e. 64.0 MiB at kNpcPoolSize; the file "
              "banner's whole footprint table is derived from this number");

// Growth floor, deliberately the same 4096 as [npc_pool.h] `kNpcLazyChunk`: one
// resize covers ~10x the demo stack's startup crowd of 420.
inline constexpr std::uint32_t kMemChunk = 4096;

// Read-only blank returned for a record with no row yet, so a caller reads an
// empty memory instead of indexing an empty vector.
inline constexpr MemoryRow kBlankMemoryRow{};

// ---------------------------------------------------------------------------
// AiMemory — the DEMAND column.
//
// Owned and passed explicitly ([AGENTS.md] "No global state"), id-indexed and
// dense, so iteration order can never depend on a hash container and two
// identical runs produce byte-identical rows. `row()` on an unallocated id is
// legal and returns the blank.
//
// REFERENCE LIFETIME, the one trap: `remember()` may grow the vector, so a
// reference from `row()` dies at the next `remember()`. Exactly the rule
// [npc_pool.h] states for `attrs()`/`relations()` across a `spawn()`.
// ---------------------------------------------------------------------------
class AiMemory {
public:
    // File a trace. Returns true if it landed (it always does, unless the kind is
    // MemNone). Three-stage placement, all of it a fixed 8-slot scan:
    //   1. COALESCE an existing live trace with the same (kind, payload) —
    //      refresh `seenAt`, keep the STRONGER strength. This is what stops a body
    //      standing in a hot cell for 200 ticks from filling all 8 slots with the
    //      same fact, and it is the reference's `existing.severity = max(...)`,
    //      `existing.lastAt = event.time` shape from room_memory.ts.
    //   2. else take the first EMPTY or EXPIRED slot (lowest index).
    //   3. else EVICT the weakest by (strength + freshness), ties to lower index.
    bool remember(NpcId id, std::uint8_t kind, std::uint32_t payload,
                  float strength01, double now);

    // Read a row. Blank (all MemNone) for an id that has never remembered.
    const MemoryRow& row(NpcId id) const {
        return id < rows_.size() ? rows_[id] : kBlankMemoryRow;
    }

    // Non-expired traces in `id`'s row at `now`. Telemetry and tests; O(kMemSlots).
    std::uint32_t live_traces(NpcId id, double now) const;

    // Drop every trace for one record (death, or an explicit forget). Cheap and
    // allocation-free; does NOT shrink the column.
    void forget(NpcId id);

    // Rows the column currently covers. 0 until the first remember().
    std::uint32_t rows() const { return static_cast<std::uint32_t>(rows_.size()); }

    // Bytes held, summed over vector capacity — the same measurement
    // `NpcPool::resident_bytes()` reports, so the footprint claim in the file
    // banner is checkable at runtime instead of only on paper.
    std::size_t resident_bytes() const {
        return rows_.capacity() * sizeof(MemoryRow);
    }

    // Cumulative traces written / coalesced. Distinguishing the two is what
    // proves the ring is not just churning.
    std::uint32_t writes() const { return writes_; }
    std::uint32_t coalesced() const { return coalesced_; }
    std::uint32_t evictions() const { return evictions_; }

private:
    // Geometric growth from kMemChunk. Fixed-chunk growth would copy the column
    // at every boundary — 232 copies at the 950k target, which is the measured
    // reason [npc_pool.h] chose geometric for its own lazy columns.
    void ensure(NpcId id);

    std::vector<MemoryRow> rows_;
    std::uint32_t writes_ = 0;
    std::uint32_t coalesced_ = 0;
    std::uint32_t evictions_ = 0;
};

// --- Recall -----------------------------------------------------------------

// How far a remembered cell still counts, in MACRO CELLS. 12 cells = 24 m at
// kCellSize, which brackets the reference's 16 m `threatDistance` ramp and its
// bounded local queries (radius 4..40 units). DATA, retune freely.
inline constexpr int kMemRecallCells = 12;

// A remembered threat is weaker evidence than a live one, so its channel is
// scaled — the same shape as the reference's own weaker channels (gunfire 0.75,
// fog 0.6) rather than a new mechanism. At 0.70 a maxed remembered danger reads
// as threat 0.70, which clears the flee/work crossover (~0.101) by a wide margin
// but still loses to a live field of the same magnitude.
inline constexpr float kMemThreatWeight = 0.70f;

// The reference caps a room-type affordance at `Math.min(10, weight * 0.18)`.
// A remembered site is an affordance, so it borrows that cap verbatim instead of
// inventing a coefficient.
inline constexpr float kMemAffordanceCap = 10.0f;

// The reference `targetPenalty` distance term, verbatim: `clamp01(d / 96) * 24`,
// with d in world units — metres here.
inline constexpr float kMemTargetDistSpan = 96.0f;
inline constexpr float kMemTargetDistWeight = 24.0f;

// Only a danger this strong (after `unitish`, so scale-independent) is worth
// filing. The reference refuses to record below severity 2 of 5;
// 0.20 is that bar expressed in unit terms.
inline constexpr float kMemDangerRecordUnit = 0.20f;

// What one pass over a row concluded. Fixed size, no allocation, and indexed BY
// KIND so a new MemoryKind needs no new field here.
struct MemoryRecall {
    float threat = 0.0f;   // 0..1, strongest remembered danger/hurt near this cell
    float grudge = 0.0f;   // 0..1, strongest remembered foe
    NpcId foe = kInvalidNpc; // who the grudge names (kInvalidNpc if none)
    // Horizontal unit vector pointing AWAY from the remembered danger centroid.
    // Only valid when `haveAway`; z is never set — v.z belongs to gravity.
    float awayX = 0.0f;
    float awayY = 0.0f;
    bool haveAway = false;
    // Nearest live site of each kind: its strength 0..1 and its distance in
    // cells. `siteStrength[k] == 0` means "no live trace of kind k".
    float siteStrength[kMemKindCount] = {};
    float siteDistCells[kMemKindCount] = {};
    std::uint32_t live = 0; // non-expired traces seen
};

// One pass over `id`'s row. PURE: reads the column and nothing else, touches no
// world, no grid, no pool, allocates nothing, and its result depends only on
// (row contents, cell, now) — so it is order-independent and reproducible.
//
// `cx/cy/cz` must already be wrapped (`wrap_macro`); distance is toroidal on all
// three axes, which is what stops a memory 2 cells away across the seam from
// reading as 126 cells away.
MemoryRecall ai_recall(const AiMemory& mem, NpcId id, int cx, int cy, int cz,
                       double now);

// ---------------------------------------------------------------------------
// Perception — the momentary snapshot the scorer reads.
//
// Built once per body per re-plan from whatever the engine exposes today. Every
// field the engine cannot supply keeps its zero/none/-1 default so the
// corresponding term vanishes; the -1 sentinels reproduce the reference's
// `undefined` branches exactly. The scorer is a PURE function of
// (Perception, Needs) — it never touches the pool or the world — which is what
// lets a later system fill a field and switch its term on with NO scorer edit,
// and what lets the whole ranking be unit-tested headless.
// ---------------------------------------------------------------------------
struct Perception {
    // -- live today --
    std::uint32_t idSeed = 0;  // identity_seed(NpcId)
    std::uint16_t faction = 0; // -> faction_traits()
    float hp = 0.0f;
    float maxHp = 0.0f;
    float danger = 0.0f; // the diffusion "danger" field at the body's cell

    // -- per-body state from AiBrain, set by the driver --
    std::uint8_t currentIntent = kIntentNone;
    float stickinessAmount = 0.0f; // 0 when hysteresis is disabled
    float minuteOfDay = -1.0f;     // <0 == no clock -> every rhythm term is 0

    // -- stubbed: 0/false/-1 => the term contributes 0 --
    float visibleHostiles = 0.0f;
    float threatDistance = -1.0f; // metres; -1 == reference `undefined`
    float hostilePower = 0.0f;
    float allyPower = 0.0f;
    bool strongerHostile = false;
    bool cornered = false;
    bool armed = false;
    bool orderedCombat = false;
    bool inShelter = false;
    bool isTraveler = false;
    bool factionAssaultTarget = false;
    float monster = 0.0f;
    float gunfire = 0.0f;
    float fire = 0.0f;
    float fog = 0.0f;
    bool samosborActive = false;
    bool samosborWarning = false;

    // -- memory (AiMemory), zero when the body remembers nothing --
    // Another threat channel, so it raises safety/flee and suppresses
    // work/eat/sleep/social through the SAME `threat` term the live field uses.
    // This is what makes an evaporated danger field still matter.
    float rememberedThreat = 0.0f; // 0..1
    // 0..1 toward a remembered attacker. Split between combat and flee by the
    // body's `risk` trait in `apply_recall`, so the same insult makes a
    // Liquidator turn and fight and a Citizen run.
    float grudge = 0.0f;

    // Room-affordance bias and the chosen target's cost — PER INTENT, which is
    // the reference's own shape (`context.local?.[intent]`,
    // `context.target?.[intent]`). These were scalars while nothing filled them;
    // memory is the first supplier, and the widening is exactly the "they become
    // per-intent arrays when rooms/targets land — additive, no coefficient
    // changes" note this comment used to carry. All-zero by default, so a body
    // with no memory scores bit-for-bit what it scored before.
    float localScore[kIntentCount] = {};
    float targetPenalty[kIntentCount] = {};

    // -- role ([role.h]), zero == Resident == the all-ones multiplier row --
    std::uint8_t role = 0;        // RoleId; the pool column, sampled at re-plan
    float nearbyWounded01 = 0.0f; // wounded fraction of allies in medic reach
};

// Fold a recall into a Perception. Pure, and separate from `ai_recall` so the
// mapping from "what I remember" to "what the scorer sees" is one readable place
// and is unit-testable without a registry, a pool or a world.
//
// `faction` is needed only for the grudge split (it reads `risk`), which is why it
// is a parameter rather than another Perception field.
void apply_recall(const MemoryRecall& r, std::uint16_t faction, Perception& p);

// --- Selection FSM thresholds (the SHIPPING values from npc_fsm.ts) ---------
// The switch margin is the FSM override 7, NOT the npc_utility default 8; using
// 8 diverges at the hysteresis boundary.
inline constexpr float kSwitchMargin = 7.0f;
inline constexpr float kEmergencyScore = 58.0f;
inline constexpr float kRethinkBaseSec = 1.5f;   // re-plan cadence lower bound
inline constexpr float kRethinkSpreadSec = 2.5f; // + rand01*spread -> [1.5, 4.0]
inline constexpr float kStickBase = 5.0f;        // stickiness at t=0
inline constexpr float kStickCap = 7.0f;         // max growth of the bonus
inline constexpr float kStickPerSec = 0.18f;     // growth per second held

// The re-plan stagger's jitter channel: a distinct hash stream from the score
// jitter, so cadence phase is uncorrelated with the score nudges.
inline constexpr const char* kRethinkChannel = "utility_rethink";

// Flee pace, m/s. Matched to `wander.cpp`'s kNpcWalkSpeed (1.35) times a panic
// factor: a body running from a danger gradient should visibly outpace a body
// strolling to a lattice node, or the intent is invisible. DATA, retune freely.
inline constexpr float kFleeSpeed = 1.35f * 1.6f;

// Errand pace, m/s — walking to the kitchen is not fleeing. Deliberately EQUAL to
// `wander.cpp`'s kNpcWalkSpeed so a body that switches from roaming to an errand
// changes DIRECTION and not gait; the flee multiplier above is what makes panic
// legible, and it only reads as panic while the ordinary pace is the ordinary one.
inline constexpr float kErrandSpeed = 1.35f;

// How close to its seat a body must be to count as SETTLED, in metres. Below this
// it stops and the room's ambient recovery does the work ([room_zone.h] micro-goal).
// One third of a cell: tight enough that bodies visibly spread across a room's nine
// interior cells rather than piling on its centre, loose enough that swept-AABB
// collision against furniture cannot leave a body shuffling forever.
inline constexpr float kSeatArriveM = kCellSize * 0.35f;

// Below this squared gradient magnitude the danger field carries no usable
// direction (uniform or empty), and flee hands ownership BACK to wander rather
// than writing a zero velocity — a frozen body is a worse answer than a
// strolling one.
inline constexpr float kMinFleeGrad2 = 1e-10f;

// The survival intents that may preempt the current one without the margin.
inline bool intent_is_emergency(std::uint8_t intent) {
    return intent == IntentSafety || intent == IntentFlee ||
           intent == IntentCombat || intent == IntentHeal;
}

// Stickiness bonus for the current intent: 5 + min(7, t*0.18) -> [5, 12].
inline float stickiness_amount(float stateTimer) {
    const float grown = stateTimer * kStickPerSec;
    return kStickBase + (grown < kStickCap ? grown : kStickCap);
}

// Pure scorer: fill out[kIntentCount] with each intent's 0..100 utility. No side
// effects, no world reads, order-independent. The current intent's stickiness
// bonus is applied HERE (via Perception::stickinessAmount) so `select_intent`
// only needs raw scores — matching the reference.
void score_intents(const Perception& p, const Needs& needs, float out[kIntentCount]);

// Plain argmax, ties toward the lower index. This is selection with hysteresis
// DISABLED, and it is public because proving the hysteresis does something means
// measuring both arms.
std::uint8_t select_intent_raw(const float scores[kIntentCount]);

// Argmax + hysteresis. An emergency survival intent scoring >= kEmergencyScore
// preempts immediately; otherwise a challenger must beat the incumbent (which
// already carries its stickiness bonus) by kSwitchMargin. Pass kIntentNone for a
// fresh body (returns the raw argmax).
std::uint8_t select_intent(const float scores[kIntentCount], std::uint8_t current);

// ---------------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------------

// `enabled` DEFAULTS TO FALSE. The system is wired, tested and dormant until a
// caller opts in — [AGENTS.md] "keep the build green at every step" applied to
// behaviour: a dormant tested system beats one that fights physics.
//
// `hysteresis` is a real switch and not a debug flag: it is the axis the test
// measures. With it off, stickiness is zeroed AND selection is raw argmax, so
// the two arms differ in exactly the mechanism under test.
//
// The cadence is configurable because the shipping [1.5, 4.0] s cadence is
// 187..500 ticks at kSimHz, so a 100-tick measurement would contain at most one
// re-plan and could not distinguish anything. Setting both to 0 makes every tick
// a re-plan, which is the only way "switches per 100 ticks" is a number.
//
// `memory` is the second measured axis, for the same reason: proving memory
// changes a decision means running both arms with nothing else different. It has
// no effect at all unless `ai_step` is handed an `AiMemory`, so the REAL off
// switch is passing no store; this flag is what lets one store be A/B'd.
struct AiConfig {
    bool enabled = false;
    bool hysteresis = true;
    bool memory = true;
    float rethinkBaseSec = kRethinkBaseSec;
    float rethinkSpreadSec = kRethinkSpreadSec;
};

// What one `ai_step` did. Returned rather than only published so a HUD or a test
// can print it without re-scanning the registry.
struct AiTick {
    std::uint32_t considered = 0; // bodies in scope on this layer
    std::uint32_t replanned = 0;  // bodies whose deadline came due
    std::uint32_t switches = 0;   // committed intent actually CHANGED
    std::uint32_t aiOwned = 0;    // bodies ai_step steered (wander skipped them)
    std::uint32_t wanderOwned = 0; // bodies delegated to wander_step
    // -- memory --
    std::uint32_t recalled = 0;   // bodies whose memory row was read this tick
    std::uint32_t remembered = 0; // traces filed this tick
    std::uint32_t memoryFled = 0; // bodies steered by a REMEMBERED danger cell
                                  // because the live gradient carried no direction
    // -- rooms ([room_zone.h], §27 legs (a)+(b)) --
    std::uint32_t roomOwned = 0;  // bodies walking an ERRAND: a non-flee intent that
                                  // found a destination and took the token
    std::uint32_t settled = 0;    // of those, the ones already INSIDE the room they
                                  // wanted (walking the last metres to their seat or
                                  // already holding still on it)
    // How the walkers are being steered, because "errand" alone cannot tell a body
    // routing cleanly from a body shoving at a wall. `errandStep` took a horizontal
    // flow step — the field answered. `errandColumn` fell back to the bearing toward
    // the target room's column because the field's next step was VERTICAL and a
    // walking body cannot climb; that path ignores geometry, so a large and steady
    // errandColumn is the signature of a crowd pressed against walls rather than
    // walking to kitchens. Split out for exactly that reason.
    std::uint32_t errandStep = 0;
    std::uint32_t errandColumn = 0;
    std::uint32_t errandLost = 0; // wanted a room, none reachable -> delegated
    // Summed toroidal distance, in macro cells, from each walking body to the room
    // it is walking to. Divided by `errandStep + errandColumn` this is the crowd's
    // mean remaining errand — and it is the ONE number that separates "walking" from
    // "shoving at a wall", which no ownership counter can: a stuck crowd reports a
    // perfectly healthy `errandStep` forever. Watch it FALL.
    std::uint32_t errandDistCells = 0;
    // Errand bodies that PHYSICS REFUSED TO MOVE last tick, detected with no stored
    // state at all: `ai_step` runs before `physics_step`, so the Velocity it reads on
    // entry is last tick's POST-collision value, and `physics_step` zeroes the axis a
    // body collided on. A body we drove at kErrandSpeed that comes back at ~0 hit
    // something. This is the counter that distinguishes "the field is wrong" from
    // "the field is right and the geometry says no".
    std::uint32_t errandStalled = 0;
    // Committed intents, histogrammed. This is the number that says whether the
    // scorer is decoration: with the needs clock frozen the crowd's argmax is a pure
    // function of (faction, id) and this histogram is CONSTANT IN TIME — the exact
    // symptom [problems.md] §27 opens with. A moving histogram is the proof.
    std::uint32_t byIntent[kIntentCount] = {};
};

// Attach an `AiBrain` to every embodied NPC body on `layer` that lacks one, and
// return how many were attached. Call after the floor is populated, alongside
// `wander_init`.
//
// Explicit rather than lazy inside `ai_step` for two reasons. (1) Emplacing a
// component mid-view can reallocate the registry's pool container and dangle the
// view being iterated — the crash discipline combat.cpp/wander.cpp document at
// length; doing it in a separate entry point makes the hazard structural rather
// than a comment. (2) It keeps `ai_step` a single allocation-free sweep, so the
// per-tick cost is one pass and not two ([AGENTS.md] "do not allocate per-frame
// in hot paths").
//
// Scope: `NpcRef` and NOT `MobRef` and NOT `CameraTag`. Mobs and the player are
// deliberately excluded — see the file header.
std::uint32_t ai_init(Registry& reg, LayerId layer);

// Hand every AiBrain on `layer` back to `MotionOwner::Wander` and return how
// many were released.
//
// This exists because disabling `ai_step` mid-run is otherwise a trap: the token
// is persistent state, so a body left holding `MotionOwner::Ai` would be skipped
// by `wander_step` forever and stand still. Call this when clearing
// `AiConfig::enabled`, or on unload.
std::uint32_t ai_release(Registry& reg, LayerId layer);

// One arbitration + steering pass over the embodied NPC bodies on `layer`.
//
// MUST RUN BEFORE `wander_step`, and that ordering is part of the contract, not
// a preference: the token this writes is read by wander on the SAME tick, so a
// body handed back mid-tick is steered by wander immediately instead of coasting
// for a frame.
//
// Per body: re-plan if its identity-staggered deadline has passed (build a
// Perception, score, select, reschedule), then set the token, then — if it owns
// the body — write horizontal Velocity from the negated diffusion danger
// gradient. `v.z` is left to gravity, exactly as wander does.
//
// `danger` may be null (the floor seeded no diffusion field) -> threat reads 0,
// nobody flees, every body delegates to wander, and the pass is a no-op on
// Velocity. That is the scorer's stubbed-input stance, not a special case.
//
// `mem` may be null, and null is bit-for-bit the behaviour before memory existed:
// nothing is recalled, nothing is recorded, no allocation happens. When it is
// supplied the pass gains three things:
//
//   * RECALL, and it is NOT once per body per tick. The row is read only when the
//     body is re-planning (the scorer is the consumer) or is currently fleeing
//     (the steering direction is the consumer). At the shipping [1.5, 4.0] s
//     cadence that is ~0.36 recalls/body/second plus the fleeing slice, not 125 —
//     the sweep stays O(n) with a small constant, and `AiTick::recalled` reports
//     the real count instead of a claim.
//   * TWO LIVE RECORDERS. A hot danger field at the body's own cell is filed on
//     its staggered re-plan (the reference's "sample local facts on your own AI
//     tick"); an HP DROP is filed the tick it happens, because damage is an event
//     and `AiBrain::lastHp` is what detects it with no event bus.
//   * A MEMORY FLEE FALLBACK. Flee still prefers the live `-diffusion_gradient`.
//     When that gradient is flat — the field evaporated, or the body is in a
//     uniform pocket — it now steers away from the remembered danger centroid
//     instead of handing the body back to wander. Same intent, same token, same
//     single writer: `IntentFlee` remains the ONLY intent that takes
//     `MotionOwner::Ai`, so the arbitration story in the file header is unchanged
//     in shape and `AiTick::memoryFled` counts exactly the new cases.
//
// Pure game layer over EnTT + NpcPool + a read-only field/grid, so it is
// exercised headless by `game_test`.
//
//
// `rooms` (optional, §27 leg (a)+(b)) is what ends "IntentFlee is the ONLY owning
// intent". With it, an intent the affordance table gives a destination
// ([room_zone.h] kRoomAffordance — eat/drink/toilet/sleep today) descends that
// room kind's baked field, walks to its SEAT inside the room, and holds there
// while the room restores it. Null, or a floor whose room mix contains none of
// those kinds, is bit-for-bit the pre-rooms pass: the intent still wins, it simply
// has nowhere to go and delegates to `wander_step` exactly as it always did.
//
// THE SINGLE-WRITER STORY IS UNCHANGED IN SHAPE, and that is the reason this is
// safe to widen. Ownership is still one token, still decided in one place, still
// re-derived every tick. What changed is only the SET of intents that can earn it;
// `wander_step` and `faction_feud_step` read the same `ai_owns_motion` guard and
// neither had to learn anything about rooms.
struct RoomZones; // room_zone.h — likewise
AiTick ai_step(Registry& reg, NpcPool& pool, const Field<float>* danger,
               const MacroGrid& grid, LayerId layer, double now, float dt,
               const AiConfig& cfg = {}, AiMemory* mem = nullptr,
               const void* doorsDead = nullptr, // МОГИЛА ДВЕРЕЙ: слот пустует до новой системы
               const World* world = nullptr,
               const RoomZones* rooms = nullptr);

} // namespace giga::game

namespace giga {
struct GravityField;
struct DiffusionDriver;
class World;
namespace nav {
struct CoarseGraph;
struct FineNav;
} // namespace nav
} // namespace giga

namespace giga::game {

// Patrol execution — the FIRST consumer of the baked coarse graph + flow fields
// as a ROUTE, which is the exact thing the `IntentPatrol -> Corridor` refusal in
// [room_zone.h] was waiting for: a destination without a route is loitering
// wearing patrol's name. Runs AFTER `ai_step` and BEFORE `wander_step`: it
// steers only IntentPatrol bodies `ai_step` left to wander, and CLAIMS them
// (MotionOwner::Ai) so wander skips them — one writer per body per tick, same
// arbitration every other steering system obeys. A body whose flow byte says
// "unreachable from here" is left to wander (a pocket is wander's problem).
// `gravity` names the walking plane, same convention as `faction_feud_step`.
void ai_patrol_step(Registry& reg, const nav::CoarseGraph& coarse,
                    const nav::FineNav& fine, LayerId layer, float dt,
                    const GravityField* gravity = nullptr);

// The danger field's PRODUCER — the write half of the loop ai_step's threat
// term has been waiting on ([diffusion.h], problems.md §52). Fleeing bodies
// (IntentFlee/IntentSafety) publish `faction panic × dt` at their own cell
// through the driver; the sweep and decay stay the driver's business. Runs
// before diffusion_tick in the same sim tick, so a panic published on tick N
// spreads on the next cadence sweep, never racing it.
void ai_panic_publish_step(Registry& reg, const NpcPool& pool,
                           DiffusionDriver& driver, World& world,
                           LayerId layer, float dt);

// The NPC equip DECIDER ([equip.h]): экипировка — решение, и для тел с AiBrain
// решает этот проход. Staggered per body (~2 s game time), re-scores the bag —
// weapon (gun over club, then DPS/damage), armour (total resist) — and records
// the choice in the body's Equipped component, which combat's strict readers
// then obey. THE single writer of Equipped for AiBrain bodies; the player's is
// written only by their own hand (console `equip`). Runs after ai_step in the
// tick: intent first, wardrobe second.
void ai_equip_step(Registry& reg, const NpcPool& pool, LayerId layer,
                   std::uint64_t tick);

// --- Recorders anything may call --------------------------------------------
// The write side of the seam, deliberately public and deliberately tiny: filing a
// fact is ONE call with no registry, no world and no allocation, which is what
// makes it cheap for combat/loot/container code to become a producer later.
//
// `strength01` is clamped to [0,1] and quantised to 7 bits. `now` is absolute sim
// seconds — the same clock `ai_step` is given.
//
// Which kinds have a producer TODAY (stated, not implied): MemDanger and MemHurt
// are filed by `ai_step` itself. MemFood / MemWater / MemRest / MemToilet /
// MemFoe / MemAlly have NO caller in `src/` yet — the scorer reads them, so they
// light up the day a producer appears, and until then they contribute 0 exactly
// like every other stubbed `Perception` input.
bool ai_remember_cell(AiMemory& mem, NpcId id, std::uint8_t kind, int cx, int cy,
                      int cz, float strength01, double now);
bool ai_remember_actor(AiMemory& mem, NpcId id, std::uint8_t kind, NpcId who,
                       float strength01, double now);

} // namespace giga::game
