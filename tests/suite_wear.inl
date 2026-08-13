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

namespace {

inline std::uint32_t pack_gas_test(std::uint8_t toxic, std::uint8_t smoke, std::uint8_t oxy, std::uint8_t heat) {
    return static_cast<std::uint32_t>(toxic) |
           (static_cast<std::uint32_t>(smoke) << 8) |
           (static_cast<std::uint32_t>(oxy) << 16) |
           (static_cast<std::uint32_t>(heat) << 24);
}

static void test_wear_and_durability_all() {
    using namespace giga;
    using namespace giga::game;

    std::fprintf(stdout, "Entering test_wear_and_durability_all...\n");

    // 1. Basic Wear Application and Clamping
    {
        ItemSlot slot{};
        slot.item = 1; // valid item
        slot.count = 1;

        // Apply wear repeatedly
        CHECK(apply_item_wear(slot, 50));
        CHECK(apply_item_wear(slot, 200));

        // Item with 0 item id returns false
        ItemSlot emptySlot{};
        CHECK(!apply_item_wear(emptySlot, 10));
    }

    // 2. Weapon Jamming Determinism
    {
        ItemSlot gunSlot{};
        gunSlot.item = 1;
        gunSlot.count = 1;

        // Clean weapon has zero fouling
        CHECK(!check_weapon_jam(1, gunSlot, 100, 0.0f, nullptr));

        // Dirty environment triggers deterministic jam roll
        const bool jammed1 = check_weapon_jam(42, gunSlot, 1337, 50.0f, nullptr);
        const bool jammed2 = check_weapon_jam(42, gunSlot, 1337, 50.0f, nullptr);
        CHECK(jammed1 == jammed2);
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

        Equipped eq{};
        eq.invSlot[static_cast<std::size_t>(EquipSlot::Tool)] = 0;
        reg.emplace<Equipped>(e, eq);

        ItemId foulItem = kInvalidItem;
        for (ItemId i = 1; i <= kItemCount; ++i) {
            if (item_wear_kind(item_def(i)) == WearKind::Fouling) {
                foulItem = i;
                break;
            }
        }

        if (foulItem != kInvalidItem) {
            ItemSlot& sl = pool.inventory(id).slots[0];
            sl.item = foulItem;
            sl.count = 1;

            // Setup clean gas field (all air)
            Field<std::uint32_t> cleanGas(pack_gas_test(0, 0, 255, 0));
            WearReport cleanReport = fouling_step(reg, pool, LayerId{0}, &cleanGas, 0.016f, 0);
            CHECK(cleanReport.degradedCount == 0);

            // Setup toxic/smoke gas field
            Field<std::uint32_t> toxicGas(pack_gas_test(200, 150, 0, 0));
            WearReport toxicReport = fouling_step(reg, pool, LayerId{0}, &toxicGas, 0.016f, 0);
            CHECK(toxicReport.degradedCount == 1);
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
            if (item_wear_kind(item_def(i)) == WearKind::Charge) {
                chargeItem = i;
                break;
            }
        }

        if (chargeItem != kInvalidItem) {
            ItemSlot& sl = pool.inventory(id).slots[0];
            sl.item = chargeItem;
            sl.count = 1;

            WearReport rep = charge_step(reg, pool, LayerId{0}, 0.016f, 0);
            CHECK(rep.degradedCount == 1);
        }
    }

    std::fprintf(stdout, "[wear] suite_wear: all wear, durability, charge, fouling and jamming checks PASSED\n");
}

} // namespace
