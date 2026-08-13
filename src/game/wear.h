#pragma once

#include <cstdint>
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "game/event_bus.h"
#include "game/item_table.h"
#include "game/equip.h"
#include "world/field.h"

namespace giga::game {

enum class WearKind : std::uint8_t {
    None = 0,
    Durability = 1,
    Charge = 2,
    Fouling = 3,
    Jamming = 4
};

WearKind item_wear_kind(const ItemDef& def);

inline constexpr std::uint32_t kFoulPeriod = 8;
inline constexpr float kSmokeFoulMult = 1.25f;
inline constexpr float kFoulRate = 0.05f;
inline constexpr std::uint32_t kJamSalt = 0x6a616d73u; // "jams"

struct WearReport {
    std::uint32_t degradedCount = 0;
    std::uint32_t brokenCount = 0;
    std::uint32_t jammedCount = 0;
};

// Applies environmental fouling to equipped filters/respirators from gas/smoke field.
// Staggered 1-of-8 by identity.
WearReport fouling_step(Registry& reg, NpcPool& pool, LayerId layer,
                        const Field<std::uint32_t>* gasField, float dt,
                        std::uint64_t tick, EventBus* bus = nullptr);

// Applies battery/charge decay to active equipped tools.
WearReport charge_step(Registry& reg, NpcPool& pool, LayerId layer, float dt,
                       std::uint64_t tick, EventBus* bus = nullptr);

// Degrades condition of an item in inventory on use.
bool apply_item_wear(ItemSlot& slot, std::uint8_t amount = 0);

// Checks if a weapon jams during firing based on condition and environment.
// If jammed, returns true and publishes WeaponJammed event.
bool check_weapon_jam(NpcId shooterId, const ItemSlot& slot, std::uint64_t tick,
                      float envDust = 0.0f, EventBus* bus = nullptr);

} // namespace giga::game
