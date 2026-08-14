// Wander locomotion — the first consumer of the baked navigation.
//
// The nav bake ([nav.h], master_prompt #11) has existed complete and tested with
// **no consumer at all**: 64 coarse nodes, an all-pairs next-hop table, and 64
// dense flow fields, none of which moved anything. This is the seam that connects
// them to visible behaviour, and it is the foundation the full utility-AI
// (master_prompt #12) later steers instead of replaces.
//
// The whole point of the bake is that steering costs **O(1) per agent** and no
// search: read one byte out of the target node's flow field at the agent's own
// cell, and that byte IS the next step along a shortest wrapped path. No A*, no
// per-agent path memory, nothing that scales with crowd size beyond the crowd
// itself.
//
// Cost is further divided by an **identity-hash stagger**: an agent is visited
// once every `kWanderPeriod` ticks, selected by its own entity id, so the per-tick
// cost is O(n / period) and there is *zero* per-agent scheduling state — no
// timers, no queues, no next-update field. That is the trick that lets the crowd
// grow without the tick growing with it.
#pragma once

#include <cstdint>

#include "core/tick.h"
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/nav.h"

namespace giga {
struct GravityField;
}

namespace giga::game {

// The lattice node this agent is currently walking toward. THREE bytes: an agent's
// entire navigation state. Everything else is in the shared baked fields, and there
// is deliberately no path in here — not per agent and not per pack.
struct WanderTarget {
    std::uint8_t node;      // lattice node 0..63
    std::uint8_t cooldown;  // staggered visits to wait before repathing
    std::uint8_t pack;      // spawn group (MobRef::pack); 0 = walks alone
};
static_assert(sizeof(WanderTarget) == 3,
              "an agent's whole navigation state is three bytes");

// Visit each agent once every N ticks. 8 at the 120 Hz sim step means ~15
// steering decisions per agent per second, which is far finer than a walking
// body needs and still costs an eighth of the naive sweep.
inline constexpr std::uint32_t kWanderPeriod = 8;

// Sight-aggro range, metres. Inside this a mob drops navigation and closes on the
// camera holder directly. 20 m is a corridor-and-a-half: far enough that a floor
// feels hunted, near enough that the whole roster does not converge at once. From
// the reference's `MONSTER_DETECT = 20`.
//
// Promoted out of wander.cpp's anonymous namespace because [investigate.h] needs the same
// number to answer "is this mob already coming for you, or is it free to
// investigate a sound". A value two systems must agree on cannot live private to
// one of them — a copied 20.0f is a divergence waiting for one of the two to be
// tuned.
inline constexpr float kAggroRadius = 20.0f;

// Sim ticks a pack holds one shared destination before agreeing on another.
//
// This is the whole cohesion mechanism, and that it is a TIME QUANTUM rather than a
// stored decision is the load-bearing part. Members sit in different stagger slots
// and reach their repath at different moments, so a destination rolled "whenever I
// happened to repath" differs member to member and the pack disperses — which is
// exactly what makes spawn-only grouping a lie: `wander_init` randomises each node
// independently and the nav bake takes ~3.7 s, so a pack looks perfect for the
// length of the bake and scatters the instant the flow fields arrive.
//
// Quantising the tick makes the destination a pure function of (pack, epoch) that
// every member recomputes for itself and all of them get the same answer. No
// leader, no shared mutable state, no message passing, no path — and no write to
// another entity, so it cannot dangle a live view.
//
// 15 s. Lattice nodes are 32 cells = 64 m apart, so that is long enough for a pack
// to cover real ground between decisions, and short enough that a pack aimed at a
// node it cannot reach stands about for 15 s rather than forever.
//
// Derived from kSimHz rather than written as a tick count, because it was a tick
// count — 1800, authored as "15 s at the 120 Hz step" — and when core/tick.h moved
// the sim to 125 Hz the epoch silently became 14.4 s while the comment kept saying
// 15. Nothing failed, which is the problem: a duration authored in seconds and
// stored in ticks is a comment away from a lie on every rate change. Spelling the
// seconds in the expression makes the rate change carry it.
inline constexpr std::uint64_t kPackEpochTicks = 15u * static_cast<std::uint64_t>(kSimHz);

// The lattice node pack `pack` is walking toward at `tick`. Pure, O(1), no state.
// Exposed so a test can assert that the pack AGREES, rather than inferring
// agreement from where the bodies ended up.
std::uint8_t pack_target_node(std::uint8_t pack, std::uint64_t tick);

// Pack target coordination — when one member of pack N spots prey, it raises
// an alert for pack N. Other members of pack N within pack alert range (24 m)
// join the chase, converging with flanking or encirclement offsets.
struct PackAlert {
    vec3 pos{0.0f, 0.0f, 0.0f};
    std::uint32_t targetId = 0;
    std::uint64_t alertTick = 0;
    LayerId layer{0};
    bool active = false;
};

inline constexpr std::uint64_t kPackAlertTtlTicks = 3u * static_cast<std::uint64_t>(kSimHz);
inline constexpr float kPackAlertRange = 24.0f; // metres

void pack_alert_broadcast(std::uint8_t pack, LayerId layer, const vec3& pos,
                          std::uint32_t targetId, std::uint64_t tick);
PackAlert pack_alert_get(std::uint8_t pack, LayerId layer, std::uint64_t tick);
void pack_alert_clear();

// Give every mob and embodied NPC on `layer` a wander target. Call after a floor
// is populated (embody + mob spawn); entities that already have a target keep it.
// The player is skipped — it holds CameraTag and is steered by input.
//
// A mob carrying a MobRef::pack starts on its PACK's destination, not on a private
// one, so a pack walks as one from the first steering pass rather than only until
// the bake lands.
std::uint32_t wander_init(Registry& reg, LayerId layer, std::uint32_t seed);

// One staggered steering pass. Sets horizontal velocity from the baked flow
// field; gravity and collision are left to physics_step, which runs after.
//
// Agents whose flow byte is a VERTICAL step do not move: a walking body cannot
// step up a storey, and stairwell/elevator traversal is not wired yet. They
// repath instead of grinding into the ceiling, which is honest but does mean the
// crowd currently explores only what is reachable on its own storey.
// `grid` is read only for the wall-adjacency test, which now serves both
// AiFlag::WallBias and the two behaviours that read the same query with their own
// numbers (DebrisLurker, WallBrace — [mob_behaviour.h]). `wall_query_needed` gates
// it to 5 of the 69 kinds (Тварь, Шовник, Арматура, Бетоноед, Панельник), and only
// for a mob already aggroed and already in its stagger slot — so 4 cell reads for
// roughly 1/8 of those kinds' heads per pass, and zero for the other 64 kinds.
//
// Not applied on the WANDER path, only on the pursuit path, which is a divergence
// from the reference worth knowing: there `monsterMoveMult` scales all monster
// movement. Extending it here would change four kinds' idle pace and would put the
// grid query on every hostile every visit rather than on aggroed ones, so it waits
// for a reason better than symmetry.
// `pool` is read to resolve a body's faction: monsters do not hunt a body they do
// not consider prey ([faction_relations.h] kMobVsFaction). That applies to the
// camera holder and — since monsters now pursue the crowd as well — to every
// resident a hunting monster weighs up. The rate control that keeps this from
// emptying a floor is [hunt.h]; read it before changing what a mob chases.
void wander_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                 const nav::CoarseGraph& coarse,
                 const nav::FineNav& fine, LayerId layer, std::uint64_t tick,
                 const GravityField* gravity = nullptr);

} // namespace giga::game
