// Embodiment — the one seam between the cold alife population ([npcs.md]) and
// the live ECS ([ecs.md]). The world is NOT built around the player: the alife
// pool exists first, and entering a floor *materializes* that floor's slice of
// records into ECS entities. The player is not special — it is simply one of
// those embodied records that additionally gets a CameraTag + Controller.
//
// This module is pure game-layer logic over NpcPool + Registry: no SDL, no
// Vulkan, so it lives in giga_game and is exercised headless by the tests.
//
// Design decisions (see the design form in project history):
//   * No player singleton. `embody_as_player` just flips the NpcPlayer bit on an
//     ordinary record and hangs a camera on its entity. Switching bodies (or
//     dying into a new one) is: fold the old record back, embody the new one as
//     player — the camera then sits at the NEW body's stature automatically.
//   * Physical stature is data. A record's `height_mm` drives the embodied AABB
//     half-height AND, for the player, the camera eye offset, through one shared
//     helper. A child record embodies short and sees low; a tall one sees high.
//   * Embodiment is reversible. hp/inventory stay canonical in the pool row (the
//     entity shares identity by NpcId, systems read the row), so only transient
//     ECS-owned state — position — folds back. `fold_back` writes the record's
//     macro cell and clears NpcEmbodied, freezing it where it stood.
#pragma once

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/npc_pool.h"

namespace giga::game {

// Game-layer component: the alife identity behind an embodied entity. Every
// entity produced by embody() carries one, so systems can read the record
// (faction, relations, stats) and fold_back knows which row to write. The
// player entity is just an NpcRef whose record has the NpcPlayer bit.
struct NpcRef {
    NpcId id = kInvalidNpc;
};

// World units per macro cell (2 m cells; see worldgen). Kept here so embodiment
// can place a record's macro cell into world-space without pulling in app code.
inline constexpr float kEmbodyCellSize = 2.0f;

// A record shorter than this (mm) is treated as unset and embodied at a default
// adult stature, so a zeroed reserve slot still produces a sane body.
inline constexpr std::uint16_t kDefaultHeightMm = 1800; // 1.8 m

// Convert a record's stature to the collider half-height (world units). Half of
// the height, since the AABB is expressed as half-extents around Transform::pos.
float body_half_height(std::uint16_t height_mm);

// The eye height for a body of this stature (world units above Transform::pos).
// Eyes sit a little below the crown; whoever holds the camera sees from here.
float body_eye_height(std::uint16_t height_mm);

// Materialize one alife record into a live ECS entity at its macro cell.
// Maps stature -> AABB; hp/inventory stay canonical in the pool row (the entity
// carries an NpcRef back to it). Sets NpcEmbodied. Returns the created entity;
// returns entt::null if id is invalid.
Entity embody(Registry& reg, NpcPool& pool, NpcId id, LayerId layer);

// Embody `id` and additionally attach a CameraTag (eye offset from stature) and
// a Controller, and set the NpcPlayer bit. This is the ONLY thing that makes a
// record "the player" — there is no separate player object.
Entity embody_as_player(Registry& reg, NpcPool& pool, NpcId id, LayerId layer);

// Fold a live entity's transient state back into its record and de-embody it:
// writes the macro cell (and clears NpcEmbodied / NpcPlayer), then destroys the
// entity. Leaves the record otherwise intact and frozen in the cold pool.
void fold_back(Registry& reg, NpcPool& pool, NpcId id, Entity e);

} // namespace giga::game
