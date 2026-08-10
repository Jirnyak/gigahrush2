#pragma once
#include <cstdint>

namespace giga {

// Four slots specified in the manifest for an equipped embodied body.
enum class EquipSlot : std::uint8_t {
    Weapon = 0,
    Armor,
    Psi,
    Tool,
    kEquipSlotCount,
    None = 0xFF
};

// Component for an embodied body. Contains indices into the body's 64-slot inventory.
struct Equipped {
    // 0xFF means the slot is empty.
    std::uint8_t invSlot[static_cast<std::size_t>(EquipSlot::kEquipSlotCount)] = {0xFF, 0xFF, 0xFF, 0xFF};
};
static_assert(sizeof(Equipped) == 4, "Equipped must be exactly 4 bytes");

} // namespace giga
