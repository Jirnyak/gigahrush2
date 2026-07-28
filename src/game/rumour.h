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

#include <cstdint>

#include "core/math.h"
#include "core/tick.h"
#include "ecs/registry.h"
#include "game/faction.h"
#include "game/item_table.h"
#include "game/mob_table.h"
#include "game/npc_pool.h"
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
    Count
};

// One overheard line. POD, no pointers, no allocation — it is built on demand from
// world state and thrown away, never stored per NPC.
struct Rumour {
    RumourKind kind = RumourKind::Threat;
    // The subject: a MobKind for Threat, a Faction for Territory, a floor for Depth.
    // Unused for Wealth and Fog, which carry their number in `value`.
    std::uint16_t subject = 0;
    std::int32_t value = 0;
    bool valid = false;
};

// How close you must be to overhear, metres. Wider than melee reach and narrower than
// the aggro radius on purpose: you should catch remarks while walking past a group,
// not sweep the whole floor from a doorway.
inline constexpr float kOverhearRange = 6.0f;

// Cooldown between overheard lines: 2 s. Without one, standing in a crowd would
// replace the line every frame and none of them would be readable — the system would
// produce a flicker rather than information.
//
// This is the one of the three drifted epochs where the drift was actually readable by
// a player: 240 ticks was 2 s at 120 Hz and became 1.92 s at 125 Hz, and the whole
// point of the constant is that a human has time to read a line before it is replaced.
// Derived from kSimHz so the reading budget is stated in the unit a human reads in.
inline constexpr std::uint32_t kOverhearCooldownTicks = 2u * static_cast<std::uint32_t>(kSimHz);

// Build the rumour a given speaker would tell, from live state.
//
// Deterministic in (speakerId, floorZ): the same person always says the same thing
// about the same floor, so a rumour reads as something that body KNOWS rather than as
// dice. Walk back to them and they repeat it.
Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ);

// The nearest speaker within kOverhearRange of the camera holder, or kInvalidNpc.
// Skips the camera holder itself and anything not embodied on this layer.
NpcId nearest_speaker(const Registry& reg, LayerId layer);

// Render a rumour into `out` as a Russian sentence. Returns false when the rumour is
// invalid, in which case `out` is untouched.
//
// Bounded, no allocation, no exceptions. `out` must be at least 160 bytes.
bool rumour_text(const Rumour& r, char* out, std::size_t cap);

} // namespace giga::game
