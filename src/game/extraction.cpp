#include "game/extraction.h"

#include "game/combat.h"   // equipped_melee / equipped_armour
#include "world/materials.h"
#include "world/types.h"

namespace giga::game {

bool on_extraction_pad(const MacroGrid& grid, const vec3& pos) {
    // Z WRAPS here on purpose. One World is ONE floor — other floors are other
    // Worlds in the stack — and the module's storey 0 stands on the attic
    // sandwich at z=127 (the torus's z-wrap), which is exactly where the
    // extraction paint lives. The old "z must not wrap" guard came from the
    // pre-module stack-of-storeys geometry and made the bank undetectable.
    const int cx = static_cast<int>(pos.x / kCellSize);
    const int cy = static_cast<int>(pos.y / kCellSize);
    const int cz = static_cast<int>(pos.z / kCellSize);
    // The cell the feet are in, then the one below. A standing body's origin sits a
    // little above the surface it rests on, so checking only the containing cell
    // makes the pad work when you clip into it and not when you stand on it.
    for (int dz = 0; dz >= -1; --dz) {
        const int z = wrap_macro(cz + dz);
        if (grid.cell(cx, cy, z) == kMatExtract) return true;
    }
    return false;
}

bool bankable_category(ItemCategory cat) {
    switch (cat) {
        case ItemCategory::Food:
        case ItemCategory::Drink:
        case ItemCategory::Medicine:
        case ItemCategory::Ammo:
        case ItemCategory::Key:
            return false;   // survival kit and route progress: never taken
        default:
            return true;    // Misc, Weapon, Tool, Note: haul
    }
}

bool bankable_slot(const Inventory& inv, int slot) {
    if (slot < 0 || slot >= kInvSlots) return false;
    const ItemSlot& sl = inv.slots[slot];
    if (!item_valid(sl.item) || sl.count == 0) return false;
    // What you are holding stays in your hands. Banking must never disarm you — if
    // it did, the optimal play would be to never bank, and the whole mechanic would
    // be stillborn.
    if (sl.item == equipped_melee(inv) || sl.item == equipped_armour(inv))
        return false;
    return bankable_category(static_cast<ItemCategory>(item_def(sl.item).category));
}

std::int32_t deposit_valuables(Inventory& inv, RunLedger& led) {
    std::int32_t sum = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        if (!bankable_slot(inv, i)) continue;
        ItemSlot& sl = inv.slots[i];
        sum += item_def(sl.item).value * static_cast<std::int32_t>(sl.count);
        sl.item = kInvalidItem;
        sl.count = 0;
    }
    if (sum <= 0) return 0;   // runs every tick you stand on the pad; usually nothing
    led.banked += sum;
    ++led.deposits;
    if (sum > led.bestHaul) led.bestHaul = sum;
    return sum;
}

std::int32_t at_risk_value(const Inventory& inv) {
    std::int32_t sum = 0;
    for (const ItemSlot& sl : inv.slots)
        if (item_valid(sl.item) && sl.count != 0)
            sum += item_def(sl.item).value * static_cast<std::int32_t>(sl.count);
    return sum;
}

void record_death(RunLedger& led, const Inventory& lost) {
    ++led.deaths;
    led.lostToDeath += at_risk_value(lost);
}

void record_floor(RunLedger& led, int floorZ) {
    const int a = floorZ < 0 ? -floorZ : floorZ;
    const int best = led.deepestFloor < 0 ? -led.deepestFloor : led.deepestFloor;
    if (a > best) {
        led.deepestFloor = floorZ;
        led.deepestBand = economy_band(floorZ);
    }
}

float risk_share(const RunLedger& led, std::int32_t carried) {
    if (carried <= 0) return 0.0f;
    const double total = static_cast<double>(led.banked) + carried;
    if (total <= 0.0) return 0.0f;
    return static_cast<float>(carried / total);
}

} // namespace giga::game
