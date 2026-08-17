// Containers — the reason a room is worth entering.
//
// [loot.h] made monsters drop things and [extraction.h] made banking them the point.
// What was missing is the other 99% of the building: 256 rooms per floor, every one of
// them empty. The only way to earn anything was to kill something, which makes a
// survival game about combat by omission rather than by design.
//
// The reference's own economics doc is explicit that containers are the PRIMARY loot
// source and that monster drops are the secondary one, and it caps them per KIND
// rather than per floor:
//
//   public emergency box     0..120 rub          survival support only
//   room / owner container   0..300 early, 100..2,000 mid, with theft risk
//   locked safe              documents first, 300..10,000 by depth
//   weapon crate             ammo and access, not free early military kit
//   deep vault / stash       10,000..250,000, only with a route or faction reason
//
// That per-kind cap is the load-bearing idea and the one thing this file must not get
// wrong: **the floor's economy band raises the CEILING, and the container kind picks
// which slice of it applies.** A public box on the deepest floor is still a public box.
// Without that, depth alone would turn every waste bin into a jackpot and the E0..E4
// bands would collapse into a single multiplier.
//
// Deliberately NOT ported: locks, keys, theft reputation, owner tracking, and the
// "authored reason" tag the reference requires above 100,000 roubles. Each needs a
// system that does not exist (no lock state, no ownership, no faction crime model), and
// a lock with no key is a container that is simply invisible.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/item_table.h"
#include "game/floor_gen.h"
#include "game/noise.h"          // NoiseField, for the lid
#include "world/level_stack.h"

namespace giga::game {

// What kind of container this is. Ordered by the value slice it may hold, which is
// also the order the generator weights them in.
enum class ContainerKind : std::uint8_t {
    // Corridors and lobbies. Bandages, water, a few rounds. Never a jackpot, at any
    // depth — the reference keeps public containers low at every tier on purpose.
    PublicBox = 0,
    // Inside a room. The ordinary find, and the bulk of what a floor yields.
    RoomStash,
    // Rarer, worth crossing a floor for. Where the depth band actually bites.
    Safe,
    // Ammo and a weapon. Gated to Industrial and Derelict geometry, because a
    // residential warren full of military crates reads as a shooting range.
    WeaponCrate,
    Count
};

// Per-kind share of the floor's value cap, in percent. This is the mechanism that
// keeps a public box a public box on floor -50.
inline constexpr std::uint8_t kContainerCapPct[static_cast<std::size_t>(
    ContainerKind::Count)] = {
    6,    // PublicBox   — 6% of an E4 cap is 15,000, still not a jackpot at the bottom
    30,   // RoomStash
    100,  // Safe        — the full band cap; this is what "deep is richer" means
    45,   // WeaponCrate
};

// A container standing in the world. Renders through the body pass like a pickup, so
// no new render code — it is a box you walk into and empty.
//
// `slots` is small on purpose. The reference's deep vaults hold a handful of valuable
// things, not a warehouse; a container that yields twenty items turns looting into
// inventory management, and inventory is 64 slots with no weight system.
inline constexpr int kContainerSlots = 4;

struct Container {
    ItemId item[kContainerSlots] = {};
    std::uint8_t count[kContainerSlots] = {};
    // Износ содержимого ([inventory.h] ItemSlot::condition, тот же байт).
    // Появился вместе с двухсторонним экраном обыска: класть потёртый ствол
    // в ящик и доставать «как новый» — дюп-ремонт; свежероллленный лут — 255.
    std::uint8_t condition[kContainerSlots] = {255, 255, 255, 255};
    std::uint8_t kind = 0;      // ContainerKind
    bool opened = false;        // stays in the world once emptied; see the comment
};

// How close you must be to empty one, metres. Slightly longer than the pickup reach:
// a container is a whole cell, so its centre is further away than a dropped item's.
inline constexpr float kContainerReach = 2.4f;

// Fewest containers any floor may hold, whatever its geometry.
//
// An open-plan floor has few ROOMS and exactly as much FLOOR, so scaling purely on the
// room count starved it: an Industrial pillar plate produced 3 reachable crates across
// a whole 128x128 floor, measured in the running game. Three is not an economy, it is a
// rounding error nobody will walk into. This is the floor under that.
inline constexpr std::uint32_t kContainerFloorMin = 24;

// Half-extents of the drawn box, metres.
inline constexpr vec3 kContainerHalf{0.55f, 0.55f, 0.45f};

// Populate a freshly generated floor with containers.
//
// Placed by scanning the room lattice for interior floor cells, the same lattice pack
// spawning now uses — so containers land IN rooms rather than in walls or in the
// elevator shafts. Returns how many were created.
//
// Deterministic in (floorNumber, seed): a floor you leave and return to has the same
// containers in the same places, holding the same things, which is what makes the
// building a place rather than a slot machine. Whether an opened one STAYS opened is a
// save-system question and is not answered here.
std::uint32_t spawn_floor_containers(Registry& reg, const World& world,
                                     int floorNumber, FloorKind kind, LayerId layer,
                                     std::uint32_t seed, std::uint32_t cap);

// Empty every container within reach of the camera holder into its pool-row inventory.
// Returns the total rouble value taken, which is what the HUD counts and what
// `extraction.h` will later let you bank.
//
// An emptied container is NOT destroyed. It stays as a visibly-open box, because a
// container that vanishes when looted tells the player nothing about where they have
// already been — and on a 128^3 floor, remembering that yourself is not reasonable.
//
// `noise` is an optional sink for the lid ([noise.h]): opening a crate is audible, so
// looting a room is no longer free of consequence. Optional and trailing so the two
// existing call sites — main.cpp and test_containers — compile unchanged.
std::int32_t loot_containers_step(Registry& reg, class NpcPool& pool, LayerId layer,
                                  NoiseField* noise = nullptr);

// Roll the contents of one container. Exposed for tests: the value cap is the whole
// design and it needs to be checkable without generating a floor.
Container roll_container(ContainerKind kind, int floorZ, std::uint32_t seed);

// How many containers a floor should hold, before the cap. Scales with the room count
// rather than with depth: a deeper floor is RICHER, not fuller, and conflating the two
// is how a deep floor becomes a supermarket.
std::uint32_t container_budget(FloorKind kind);

} // namespace giga::game
