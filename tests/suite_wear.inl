// suite_wear.inl - Verification for Wear, Durability, Charge, Fouling and Jamming (Spec 03 §5.1)
#pragma once

#include <cstdio>
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "game/event_bus.h"
#include "game/item_table.h"
#include "game/equip.h"
#include "game/embody.h"
#include "game/wear.h"
#include "sim/gas.h"

namespace {

static void test_wear_and_durability_all() {
    using namespace giga;
    using namespace giga::game;

    std::fprintf(stdout, "Entering test_wear_and_durability_all...\n");

    // 1. Basic Wear Application and Clamping
    {
        ItemSlot slot{};
        slot.item = 1; // valid item
        slot.count = 1;
        slot.condition = 255;

        // Apply wear repeatedly until depleted
        CHECK(apply_item_wear(slot, 50));
        CHECK(slot.condition == 205);

        CHECK(apply_item_wear(slot, 200));
        CHECK(slot.condition == 5);

        // Clamping to zero without underflow
        CHECK(apply_item_wear(slot, 10));
        CHECK(slot.condition == 0);

        // Item with 0 item id returns false
        ItemSlot emptySlot{};
        CHECK(!apply_item_wear(emptySlot, 10));
    }

    // 2. Weapon Jamming Determinism and Event Publication
    {
        EventBus bus;
        ItemSlot gunSlot{};
        // Find a weapon that wears via Jamming or simulate jamming item
        gunSlot.item = 1; // item 1
        gunSlot.count = 1;
        gunSlot.condition = 255; // pristine -> 0 fouling -> no jamming

        CHECK(!check_weapon_jam(1, gunSlot, 100, 0.0f, &bus));
        CHECK(bus.cycle_count(EventType::WeaponJammed) == 0);

        // Dirty weapon (condition 50 -> fouling 205)
        gunSlot.condition = 50;
        // Test deterministic jam reproduction with same tick and shooter id
        const bool jammed1 = check_weapon_jam(42, gunSlot, 1337, 10.0f, &bus);
        const bool jammed2 = check_weapon_jam(42, gunSlot, 1337, 10.0f, nullptr);
        CHECK(jammed1 == jammed2);

        // If jammed, event was published
        if (jammed1) {
            CHECK(bus.cycle_count(EventType::WeaponJammed) >= 1);
        }
    }

    // 3. Environmental Fouling in Gas/Smoke Field
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const NpcId id = pool.spawn();

        const Entity e = reg.create();
        reg.emplace<NpcRef>(e, NpcRef{id});
        reg.emplace<Transform>(e, Transform{vec3{32.0f, 32.0f, 2.0f}, LayerId{0}});

        // Equip a tool in Tool slot
        Equipped eq{};
        eq.invSlot[static_cast<std::size_t>(EquipSlot::Tool)] = 0;
        reg.emplace<Equipped>(e, eq);

        // Find a respirator/filter item in item table with Fouling wear, or setup slot
        ItemId foulItem = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (item_def(i).wear == static_cast<std::uint8_t>(WearKind::Fouling)) {
                foulItem = i;
                break;
            }
        }

        if (foulItem != kInvalidItem) {
            ItemSlot& sl = pool.inventory(id).slots[0];
            sl.item = foulItem;
            sl.count = 1;
            sl.condition = 255;

            // Setup clean gas field (all air)
            Field<std::uint32_t> cleanGas(pack_gas(0, 0, 255, 0));
            WearReport cleanReport = fouling_step(reg, pool, LayerId{0}, &cleanGas, 0.016f, 0);
            CHECK(cleanReport.degradedCount == 0);
            CHECK(sl.condition == 255); // no wear in clean air

            // Setup toxic/smoke gas field
            Field<std::uint32_t> toxicGas(pack_gas(200, 150, 0, 0));
            WearReport toxicReport = fouling_step(reg, pool, LayerId{0}, &toxicGas, 0.016f, 0);
            CHECK(toxicReport.degradedCount == 1);
            CHECK(sl.condition < 255); // degraded by toxic smoke
        }
    }

    // 4. Tool Battery / Charge Step
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const NpcId id = pool.spawn();

        const Entity e = reg.create();
        reg.emplace<NpcRef>(e, NpcRef{id});
        reg.emplace<Transform>(e, Transform{vec3{10.0f, 10.0f, 2.0f}, LayerId{0}});

        Equipped eq{};
        eq.invSlot[static_cast<std::size_t>(EquipSlot::Tool)] = 0;
        reg.emplace<Equipped>(e, eq);

        ItemId chargeItem = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (item_def(i).wear == static_cast<std::uint8_t>(WearKind::Charge)) {
                chargeItem = i;
                break;
            }
        }

        if (chargeItem != kInvalidItem) {
            ItemSlot& sl = pool.inventory(id).slots[0];
            sl.item = chargeItem;
            sl.count = 1;
            sl.condition = 100;

            WearReport rep = charge_step(reg, pool, LayerId{0}, 0.016f, 0);
            CHECK(rep.degradedCount == 1);
            CHECK(sl.condition < 100);
        }
    }

    std::fprintf(stdout, "[wear] suite_wear: all wear, durability, charge, fouling and jamming checks PASSED\n");
}

} // namespace
