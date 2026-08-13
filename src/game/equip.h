#pragma once

#include <cstddef>
#include <cstdint>
#include "game/item_table.h"

namespace giga::game {

inline constexpr std::size_t kEquipSlotCount = static_cast<std::size_t>(EquipSlot::Count);

struct Equipped {
    std::uint8_t invSlot[kEquipSlotCount]{255, 255, 255, 255}; // 255 = none
};
static_assert(sizeof(Equipped) == 4);

} // namespace giga::game
