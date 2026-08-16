// Doors — the only part of a floor's geometry that changes after it is generated.
//
// `floor_gen.cpp` punches one opening per wall segment so each storey is a
// connected apartment graph, and until now that opening was a permanent hole:
// nothing in the building could be shut. `samosbor.h` prices its 30 s decision
// window as "shelter, run, **close a door**, save an NPC, drop loot, or risk it",
// and one of those six was not implementable. On floor -50, at ~94% duty, walking
// was the entire counterplay.
//
// A door is grid FURNITURE, not an entity, and that is a load-bearing choice:
//
//   * it costs one dense array lookup to answer "is this cell a shut door", which
//     is what makes the per-tick check affordable at all;
//   * damaging one writes to no ECS pool, so `door_step` cannot dangle the live
//     view it is iterating — the crash `src/game/combat.cpp` documents at length;
//   * a door has no position of its own to keep in sync. Its cells ARE its
//     identity.
//
// ---------------------------------------------------------------------------
// THE BAKE. Read this before changing anything here.
// ---------------------------------------------------------------------------
// Navigation is baked per floor: a 64-node coarse graph plus 64 dense 128^3 flow
// fields, ~128 MiB, measured ~3.7 s across 20 threads ([nav_async.h]). A cell
// whose solidity changes invalidates that bake, and a door changes solidity every
// time it moves.
//
// **The bake sees every doorway permanently OPEN. A shut door is a runtime, purely
// LOCAL subtraction from the baked plan.** Doors are therefore built open, and
// only the player (or a monster) ever closes one.
//
// Why this and not the alternatives:
//
//   * Re-baking per toggle is 3.7 s of 20 threads for one keypress. Not a budget
//     question — an impossibility.
//   * Baking the CURRENT door configuration is strictly worse than useless: the
//     first toggle invalidates it, and it fails in the dangerous direction. A flow
//     field baked with a door shut routes agents the long way round for the rest of
//     the floor's life even after the door opens, and its coarse graph can report a
//     node UNREACHABLE, which strands a whole pack at `kFlowNone`.
//   * Baking all-open makes the field an *upper bound* on connectivity: it is only
//     ever optimistic, never wrong about a route that exists. That is the standard
//     static-global-plan + dynamic-local-avoidance split, and the local half is
//     `door_step`.
//
// The cost, stated plainly: with a door shut, the flow field's advice is locally
// wrong, and an agent that just walks it would press into the door forever. So the
// local rule must resolve every jam, and it does — by breaking the door or by
// opening it (see `door_step`). What agents do NOT get is the globally optimal
// detour around a shut door; they get through it instead. Nothing re-bakes, nothing
// searches, and the tick stays O(live agents).
//
// One hard ordering rule follows: `nav::AsyncBake` hands a raw pointer to the live
// `MacroGrid` to a worker thread and its contract is "do not mutate the World until
// ready()". Doors are the first system that ever wanted to. Set `DoorSet::frozen`
// while a bake is in flight and every mutator here becomes a no-op — that is a data
// race avoided, and it also keeps the all-open premise above true for the geometry
// the worker is reading.
#pragma once

#include <cstdint>
#include <vector>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/floor_spec.h"
#include "game/inventory.h"
#include "world/level_stack.h"  // LayerId
#include "world/types.h"

namespace giga {
class World;
}

namespace giga::game {

enum class DoorState : std::uint8_t {
    Open = 0,  // cells are air; the baked state, and what the bake assumes
    Shut,      // cells are solid kMatDoor: blocks movement, blocks a monster
    Locked,    // solid cell; requires keycard in inventory to toggle open
    Broken,    // destroyed. Air forever — a shut door is a spent resource
};

enum class KeycardTier : std::uint8_t {
    None = 0,
    Red = 1,     // Red Keycard (Level 1 Security)
    Blue = 2,    // Blue Keycard (Level 2 Security)
    Master = 3,  // Master Keycard (Bypasses all tiers)
};

// Structural HP of one door.
//
// Calibrated against the real table rather than picked: a monster works on a door
// at its own `dmg / attackCdMs`, so 120 HP sets the whole spread from data that
// already exists (measured over data/mobs.csv, 69 rows):
//
//   PAUPSINA        dmg 0                -> never gets through, at all
//   SLIMEVIK        1.1 dmg/s            -> 109 s
//   the median kind 9.4 dmg/s            ->  12.8 s
//   NIGHTMARE      27.8 dmg/s            ->   4.3 s
//   SCULPTURE    4000   dmg/s            ->   0.03 s (the Weeping Angel; correct)
//   a pack of 8 SBORKA, 4.6 each         ->   3.3 s
//
// 12.8 s of a 30 s samosbor warning window is a real decision, and the two ends of
// the roster are a monster that can never follow you through a door and one you
// cannot keep out. No new CSV column pays for any of that.
inline constexpr std::int16_t kDoorHp = 120;

// How far the player may reach to work a door, metres. 3.0 m is a cell and a half:
// you must be standing in or beside the doorway, never across the room.
inline constexpr float kDoorReach = 3.0f;

// Milliseconds of UNBROKEN contact before a body that cannot smash a door simply
// pushes it open. This is the reason a jam is impossible: everything that can walk
// gets through a shut door eventually, destructively or not.
//
// 1500 ms is a beat, not a lock. A resident lives here and opens doors; that a
// neighbour will re-open the one you shut in ~1.5 s is the mechanic's honest price,
// and it is what stops "shut the door" from being a permanent floor edit.
inline constexpr std::uint16_t kDoorForceMs = 1500;

// One door. 16 bytes, POD, no pointers — 16 k doors on a Residential floor is
// 256 KiB, against the 128 MiB of flow fields beside it.
struct Door {
    std::uint16_t cx = 0;    // leaf column, X (0..511)
    std::uint16_t cy = 0;    // leaf column, Y (0..511)
    std::uint8_t cz = 0;     // BOTTOM leaf cell, Z (0..15)
    std::uint8_t h = 0;      // leaf height in cells
    std::uint8_t axis : 2 = 0;        // Doorway::axis (0 or 1)
    std::uint8_t keycardTier : 5 = 0; // Keycard access tier (0=None, 1=Red, 2=Blue, 3=Master)
    // §23 гермодверь: apartment door on Living / Medical / Hq. Seals Samosbor
    // purple fog while Shut/Locked and hp > 0. Tagged at door_build.
    std::uint8_t hermetic : 1 = 0;
    std::uint8_t state = static_cast<std::uint8_t>(DoorState::Open);
    std::int16_t hp = kDoorHp;
    // Damage below one whole HP, in milli-HP. Lets a 1.1 dmg/s monster make
    // progress at a 120 Hz tick without a float on the door or a timer per mob.
    std::uint16_t chipMilli = 0;
    // Milliseconds of contact by something that is pushing rather than hitting.
    std::uint16_t forceMs = 0;
    // Tick of the last contact, so `forceMs` can require CONTINUOUS pressing
    // without any per-door sweep to decay it. A gap of more than one tick resets.
    std::uint16_t lastTick = 0;
};
static_assert(sizeof(Door) == 16, "Door must stay a tight 16-byte row");

inline constexpr std::uint32_t kNoDoor = 0xFFFFFFFFu;

// Every door on one live floor, plus the dense cell->door index the tick reads.
//
// Dense, per performance.md: the index is 128^3 uint32 = 8 MiB, allocated once per
// live floor beside a 128 MiB nav bake, and it makes "is this cell a shut door" a
// single indexed load. A sparse map would save 8 MiB and put a hash lookup in the
// per-agent path — the exact trade this codebase says to refuse.
struct DoorSet {
    std::vector<Door> doors;
    std::vector<std::uint32_t> index;  // doorId + 1 per cell; 0 = no door
    std::uint32_t shut = 0;            // doors currently in DoorState::Shut
    std::uint32_t broken = 0;          // doors destroyed on this visit
    // Set while a nav bake is in flight. Every mutator below refuses — see the
    // ordering rule in the header comment.
    bool frozen = false;

    // Macro cells whose masks this system changed since the app last drained
    // the list (shut, open, force-open, break). The same handoff contract as
    // CarveResult::dirtyCells ([world/destruct.h]): door.cpp only appends; the
    // app owes its consumers (the GPU voxel mirror) one drain + clear() per
    // frame. Bounded by real door events, so it stays tiny.
    std::vector<std::uint32_t> dirtyCells;

    bool empty() const { return doors.empty(); }

    // Door occupying a cell, or kNoDoor. Clamps coordinates to valid sector bounds.
    std::uint32_t at(int x, int y, int z) const {
        if (index.empty()) return kNoDoor;
        const auto c = clamp_macro(x, y, z);
        const std::size_t idx = macro_index(c.x, c.y, c.z);
        if (idx >= index.size()) return kNoDoor;
        const std::uint32_t v = index[idx];
        return v ? v - 1u : kNoDoor;
    }
    // Same, but only reports a door that is currently blocking.
    std::uint32_t shut_at(int x, int y, int z) const {
        const std::uint32_t id = at(x, y, z);
        if (id == kNoDoor) return kNoDoor;
        return doors[id].state == static_cast<std::uint8_t>(DoorState::Shut)
                   ? id
                   : kNoDoor;
    }
};

// Build every door of the floor `world` currently holds, and stamp the frames.
//
// Call AFTER generate_floor and BEFORE the nav bake starts. Leaves every door
// Open, so the grid handed to the bake is the all-open geometry the bake must see.
//
// A doorway becomes a door only if the finished grid agrees it is one: the opening
// cell is air and BOTH jambs are solid. That filters the two cases where the
// generator's own later passes have already destroyed the opening as an
// architectural feature — the 7x7 lattice lobbies, which carve straight through
// wall lines, and a Derelict floor's `gapPct`, which knocks out 38% of the wall and
// takes a jamb with it. So a Residential floor gets a door in every doorway and a
// Derelict one gets a door only where the frame survived, which is the right answer
// arrived at by asking the grid instead of assuming.
//
// Returns the number of doors built.
std::uint32_t door_build(World& world, DoorSet& doors, int number,
                         const FloorSpec& spec, unsigned seed);

// Shut or open one door. Returns false when nothing changed: the door is Broken,
// it is already in that state, the set is frozen, or (shutting) a body is standing
// in the doorway.
//
// That last refusal is not politeness. `physics_step` resolves a swept AABB by
// backing out of an overlap; a body that is ALREADY inside solid has nowhere to
// back out to, so sealing a doorway on the player is a soft-lock, not a squeeze.
bool door_set(World& world, DoorSet& doors, const Registry& reg, LayerId layer,
              std::uint32_t id, bool shut);

// Helper: checks if player inventory satisfies door's keycard requirement
bool inventory_has_keycard(const Inventory& inv, std::uint8_t requiredTier);

// Toggle the nearest workable door within kDoorReach of `pos`. Returns the door id
// on success, or kNoDoor when nothing is in range or the toggle was refused.
//
// Searches the dense index around the caller's own cell (+-2 in X/Y, +-1 in Z)
// rather than walking the door list: 75 indexed loads instead of 16 k, and it is
// the same O(1) lookup the tick uses.
std::uint32_t door_toggle_near(World& world, DoorSet& doors, const Registry& reg,
                               LayerId layer, const vec3& pos,
                               const Inventory* playerInv = nullptr);

// Read-only query: return the nearest workable door within kDoorReach of `pos`,
// or kNoDoor when nothing is in range. Same cell-indexed O(75) search as
// door_toggle_near but mutates nothing — safe for per-frame HUD prompts.
std::uint32_t door_query_near(const DoorSet& doors, const vec3& pos);

// Shut every door that will accept it. For a capture, a test, or a future
// "lock-down" event; returns how many closed.
std::uint32_t door_shut_all(World& world, DoorSet& doors, const Registry& reg,
                            LayerId layer);

// Toggle door locks across the floor layer (closing/locking all open doors or opening all shut doors).
std::uint32_t door_toggle_locks(World& world, DoorSet& doors, const Registry& reg,
                                LayerId layer);

// What one door pass resolved. All zero on the overwhelmingly common tick.
struct DoorTick {
    std::uint32_t pressing = 0;   // bodies in contact with a shut door
    std::uint32_t opened = 0;     // doors pushed open (non-destructive)
    std::uint32_t broken = 0;     // doors destroyed this tick
    std::uint8_t lastKind = 0xFF; // MobKind of the last breaker; 0xFF = not a mob
    // World-space centre of the last broken / force-opened door this tick.
    // Valid only when broken > 0 or opened > 0, respectively. The render
    // layer reads these for debris particles and noise without touching the
    // DoorSet or breaking the game-render boundary.
    vec3 lastBreakPos{0, 0, 0};
    vec3 lastOpenPos{0, 0, 0};
};

// §23 nearest hermetic shelter: scan doors on this floor for hermetic==1 with
// hp > 0, return the cell of the closest door (toroidal XY). True when at least
// one shelter exists; out* then hold that door's (cx,cy,cz). When the caller is
// already at a hermetic door cell, out equals the query cell.
//
// Pure query — no World mutation. Used by IntentFlee so NPCs run to sealed
// apartments during Samosbor purple fog (gradient/memory remain the fallback).
bool door_nearest_shelter(const World& world, const DoorSet& doors,
                          int cx, int cy, int cz,
                          int& outX, int& outY, int& outZ);

// One pass: let whoever is standing against a shut door do something about it.
//
// The whole rule, and it is deliberately derived from columns that already exist
// rather than from a new one:
//
//   * a MOB with dmg > 0 **breaks** it, at its own `dmg / attackCdMs`. Permanently
//     — a Broken door never comes back, so a long fight degrades the floor.
//   * anything else **pushes it open** after kDoorForceMs of contact. That is every
//     resident (a person opens a door) and also the one monster in the table with
//     no attack, which is what makes a permanent jam impossible.
//   * the camera holder is skipped. The player works a door with `door_toggle_near`
//     and a keypress, not by leaning on it.
//
// No aggro test and no faction gate, on purpose. Gating on "has seen the player"
// would need the victim's position, the faction matrix and wander.cpp's private
// aggro radius duplicated here; and the behaviour it would buy — monsters ignoring
// doors until they notice you — is worse. A floor whose monsters wear its doors
// down as they patrol is the reading this game wants, and it makes a shut door a
// consumable resource instead of a wall.
//
// Contact is tested by ADJACENCY, not by velocity, and that is a correction rather
// than a preference: `physics_step` zeroes the horizontal velocity on the first
// tick of contact and `wander_step` only rewrites it once every kWanderPeriod = 8
// ticks, so a velocity probe samples intent on 1 tick in 8 and would stretch every
// break time eightfold.
//
// Cost: nothing at all while no door is shut (the early-out below), and otherwise
// four indexed loads per live agent per tick.
DoorTick door_step(Registry& reg, World& world, DoorSet& doors, LayerId layer,
                   float dt, std::uint64_t tick);

} // namespace giga::game
