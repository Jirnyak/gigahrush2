// Rumours — what the crowd knows, and the first reason it exists.
//
// A floor carries up to 420 walking bodies and until now every one of them was
// scenery: they wandered, they could be killed, and they told you nothing. The
// building was populated and mute.
//
// **The reference has 582 authored rumours and NOT ONE of them does anything.** Its
// `RumorReveal` is a rich schema that only picks which line gets spoken and appends a
// parenthetical; `describeRumorReveal` is exported with zero callers. Quests in that
// game reveal the map — rumours never do. So this is not a port. It is the thing the
// authored volume was pointing at and never reached.
//
// The rule here is the opposite one: **a rumour must be TRUE and CHECKABLE.** Every
// line is derived from live state — what actually spawned on this floor, what the loot
// cap actually is, what the samosbor clock actually says — so acting on one pays off
// and ignoring one costs. A rumour that is only flavour is a rumour the player learns
// to skip, and then the crowd is scenery again with extra steps.
//
// Deliberately NO interaction verb. An audit established the game has no talk key, no
// NPC targeting, and no dialogue system; building three of those to deliver one line
// of text would be the expensive way round. Instead the nearest body speaks when you
// come close enough, the way an overheard remark works in a corridor — which is also
// how a crowd should feel.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "core/math.h"
#include "core/tick.h"
#include "ecs/registry.h"
#include "game/faction.h"
#include "game/item_table.h"
#include "game/mob_table.h"
#include "game/npc_pool.h"
#include "game/samosbor.h"   // SamosborState — the clock the samosbor kinds read
#include "world/level_stack.h"

namespace giga::game {

// What a rumour is about. Each kind is backed by a different piece of live state, and
// each one is worth acting on — that is the selection criterion, not variety.
enum class RumourKind : std::uint8_t {
    // "There is a <mob> on this floor." Names a kind that ACTUALLY spawned here, so
    // it is a threat warning you can verify by walking into it.
    Threat = 0,
    // "The good stuff down here goes for <N> roubles." The floor's real economy band
    // cap, which is the single number that decides whether descending is worth it.
    Wealth,
    // "The fog comes often here" / "rarely". Derived from the floor's samosbor duty,
    // which spans 1.6% to 93.8% across the stack — the most useful thing anyone
    // could tell you before you commit to a floor.
    Fog,
    // "The <faction> hold this floor." The dominant faction in the live population,
    // counted rather than authored — and it matters, because monsters ignore one of
    // them ([faction_relations.h]).
    Territory,
    // "Deeper than <N> and you do not come back." Names the deepest floor the
    // speaker's own faction is known to reach; a soft route hint.
    Depth,

    // --- the samosbor half. Driven by the LIVE clock rather than by the floor -----
    //
    // The five kinds above are all facts about a FLOOR, which is why they are
    // deterministic in (speaker, floor) and never change while you stand there. These
    // four are facts about the samosbor happening RIGHT NOW, so they move with it —
    // and that is the point. The crowd is the only channel in the game that can tell
    // you what a variant does before it does it, and a resident who has lived through
    // three samosbors knowing nothing about the fourth was the crowd being scenery
    // again with extra steps.
    //
    // Appended, never inserted, so the five existing values keep their numbers.

    // "In <N> s, samosbor: <variant>. Run for the seal." Fires during the WARNING phase
    // for every speaker, because a body standing in a corridor with the siren going
    // does not gossip about loot prices. `value` is seconds until impact, `subject` the
    // SamosborVariant already committed to by `samosbor_step`.
    Imminent,
    // "<variant> is running: <what it does>." Fires during the ACTIVE phase, and it is
    // the only place the game states a variant's effect in words — the difference
    // between maronary and veretar is otherwise invisible until it has already happened
    // to your inventory. `subject` is the variant, `value` the run's samosbor count.
    Variant,
    // "<N> samosbors so far. <M> kinds come out of the fog now." Both numbers are real:
    // `value` is `SamosborState::count` and `subject` is `samosbor_fog_roster(...).n`,
    // the size of the roster that count has actually unlocked ([mob_spawn.h]). This is
    // the one rumour that makes the `minSamosbor` progression axis visible — measured at
    // ZMinus50 the roster is 3 kinds at count 0 and 16 at count 7, and nothing else in
    // the game says so.
    Veteran,
    // "Samosbor in <N>." Fires in IDLE, and only when the wait is short enough to be a
    // decision — see `kRumourLullSpeakMs`. `value` is seconds until the fog lands
    // (Idle remainder plus the whole warning window), `subject` unused.
    Lull,

    // --- Dynamic Social & Network-Propagated Rumours --------------------------
    // "Did you hear? That stranger cleared <N> beasts on floor <Z>."
    // Player heroic deed propagated across NPC social networks.
    Heroic,
    // "Beware the outsider! On floor <Z> they slaughtered <N> people from <Faction>."
    // Player atrocities propagated across NPC social networks.
    Atrocity,
    // "On floor <Z> a war broke out between <FactionA> and <FactionB>! Casualties: <N>."
    // Faction war & territorial dispute news.
    WarNews,

    Count
};

// One overheard line. POD, no pointers, no allocation.
struct Rumour {
    RumourKind kind = RumourKind::Threat;
    // The subject: a MobKind for Threat, a Faction for Territory, a floor for Depth, a
    // SamosborVariant for Imminent and Variant, a fog-roster size for Veteran,
    // a victim Faction for Atrocity, packed Faction pair for WarNews.
    // Unused for Wealth, Fog, Lull, Heroic, which carry their numbers in `value` and `floorZ`.
    std::uint16_t subject = 0;
    std::int32_t value = 0;
    std::int16_t floorZ = 0;
    std::uint8_t credibility = 100;
    std::uint8_t hops = 0;
    bool valid = false;
};

// How close you must be to overhear, metres.
inline constexpr float kOverhearRange = 6.0f;

// Cooldown between overheard lines, in sim ticks.
inline constexpr std::uint32_t kOverhearCooldownTicks =
    2u * static_cast<std::uint32_t>(kSimHz);   // 250 ticks = 2 s, exactly

// How close the next samosbor has to be before the crowd starts counting it down
inline constexpr std::uint32_t kRumourLullSpeakMs = 5u * 60u * 1000u;
static_assert(kRumourLullSpeakMs > kSamosborWarningMs,
              "the lull horizon must be longer than the warning window it contains");

// Maximum active dynamic social rumor events tracked in the network
inline constexpr std::size_t kMaxRumourNetworkEvents = 64;

struct RumourNode {
    Rumour rumour{};
    NpcId sourceNpc = kInvalidNpc;
    std::uint64_t birthTick = 0;
    std::uint32_t diffusionCount = 0;
    bool active = false;
};

// Dynamic Rumour Diffusion Network across NPC social graphs and campfire / break routines
class RumourNetwork {
public:
    void init();

    // Seed a new rumor event in the social network (e.g. from player heroic deed, atrocity, or faction clash)
    bool seed_rumour(RumourKind kind, std::int16_t floorZ, std::uint16_t subject,
                     std::int32_t value, NpcId originNpc, std::uint64_t tick,
                     std::uint8_t initialCredibility = 100);

    // Propagate rumours between two interacting NPCs (e.g. during campfire, break, or social routine).
    // Returns true if a new rumor was successfully shared or updated.
    bool share_rumours_between(NpcPool& pool, NpcId speaker, NpcId listener,
                               std::int16_t affinity, bool isCampfireOrBreak,
                               std::uint64_t tick);

    // Diffusion pass over a floor during campfire / common room routine or macro social pass.
    // Advances propagation across connected NPC social graphs.
    std::uint32_t diffuse_step(NpcPool& pool, std::int16_t floorZ,
                               std::uint64_t tick, std::uint32_t budget = 32);

    // Find the most prominent / urgent propagated rumour known or relevant to an NPC
    Rumour best_rumour_for_npc(const NpcPool& pool, NpcId id, std::int16_t floorZ) const;

    // Clear stale rumours (older than expiration horizon)
    void prune_stale(std::uint64_t currentTick, std::uint64_t maxAgeTicks);

    std::size_t active_count() const { return count_; }
    const RumourNode* events() const { return nodes_.data(); }

private:
    std::array<RumourNode, kMaxRumourNetworkEvents> nodes_{};
    std::size_t count_ = 0;
};

RumourNetwork& global_rumour_network();

// The dominant faction among the embodied bodies on `layer`, counted rather than
// authored.
Faction dominant_faction(const NpcPool& pool, int floorNumber);

// Build the rumour a given speaker would tell, from live state and the live samosbor
// clock, optionally taking propagated social network rumours into account.
Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ, const SamosborState& sb,
                  const RumourNetwork* net = nullptr);

// The nearest speaker within kOverhearRange of the camera holder, or kInvalidNpc.
NpcId nearest_speaker(const Registry& reg, LayerId layer);

// Render a rumour into `out` as a Russian sentence. Returns false when the rumour is
// invalid, in which case `out` is untouched.
// Bounded, no allocation, no exceptions. `out` must be at least 160 bytes.
bool rumour_text(const Rumour& r, char* out, std::size_t cap);

} // namespace giga::game
