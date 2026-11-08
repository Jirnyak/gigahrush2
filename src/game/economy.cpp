#include "game/economy.h"

// Кошелёк и глубина живут в своём же заголовке ([economy.h]) — экстракшн-пад
// снесён 2026-11-08, банк-надстройка снесена тем же решением владельца.
#include "game/item_table.h"   // kItemRuble + inventory_give — касса чеканит монеты

namespace giga::game {

// --- касса (строка стойки в [conversation.md]) -----------------------------

std::int32_t teller_deposit_cash(Inventory& inv, RunLedger& led) {
    std::int64_t moved = 0;
    for (ItemSlot& s : inv.slots) {
        if (s.item != kItemRuble || s.count == 0) continue;
        moved += s.count;
        s = ItemSlot{};
    }
    led.banked += moved;
    return static_cast<std::int32_t>(moved);
}

std::int32_t teller_withdraw_cash(Inventory& inv, RunLedger& led,
                                  std::int32_t amount) {
    if (amount <= 0 || led.banked <= 0) return 0;
    std::int64_t want = amount;
    if (want > led.banked) want = led.banked;
    std::int32_t landed = 0;
    // In stack-sized instalments: a withdrawal past 65,535 cannot ride one
    // give, and the remainder of a FULL bag must stay in the account.
    while (want > 0) {
        const std::uint16_t chunk =
            static_cast<std::uint16_t>(want > 65535 ? 65535 : want);
        const std::uint16_t unplaced = inventory_give(inv, kItemRuble, chunk);
        landed += chunk - unplaced;
        want -= chunk;
        if (unplaced != 0) break;   // bag full: the rest stays banked
    }
    led.banked -= landed;
    return landed;
}

void record_floor(RunLedger& led, int floorZ) {
    const int a = floorZ < 0 ? -floorZ : floorZ;
    const int best = led.deepestFloor < 0 ? -led.deepestFloor : led.deepestFloor;
    if (a > best) {
        led.deepestFloor = floorZ;
        led.deepestBand = economy_band(floorZ);
    }
}

} // namespace giga::game
