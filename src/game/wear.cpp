#include "game/wear.h"
#include <algorithm>
#include <cmath>
#include "core/math.h"
#include "core/rng.h"
#include "ecs/components.h"
#include "game/embody.h"
#include "sim/gas.h"

namespace giga::game {

WearReport fouling_step(Registry& reg, NpcPool& pool, LayerId layer,
                        const Field<std::uint32_t>* gasField, float dt,
                        std::uint64_t tick, EventBus* bus) {
    (void)bus;
    WearReport report{};
    if (!gasField) return report;

    auto view = reg.view<const Transform, const NpcRef, const Equipped>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const auto& nr = view.get<const NpcRef>(e);
        if (!pool.valid(nr.id)) continue;
        if ((tick + nr.id) % kFoulPeriod != 0) continue;

        Inventory& inv = pool.inventory(nr.id);
        const auto& eq = view.get<const Equipped>(e);
        const std::uint8_t toolSlot = eq.invSlot[static_cast<std::size_t>(EquipSlot::Tool)];
        const std::uint8_t armorSlot = eq.invSlot[static_cast<std::size_t>(EquipSlot::Armor)];

        const std::uint8_t candidateSlots[2] = {toolSlot, armorSlot};
        for (std::uint8_t s : candidateSlots) {
            if (s >= kInvSlots) continue;
            ItemSlot& sl = inv.slots[s];
            if (sl.item == 0) continue;

            const ItemDef& def = item_def(sl.item);
            if (def.wear != static_cast<std::uint8_t>(WearKind::Fouling)) continue;

            const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
            const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
            const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));

            float toxic = 0.0f, smoke = 0.0f, oxy = 0.0f, heat = 0.0f;
            unpack_gas(gasField->at(cx, cy, cz), toxic, smoke, oxy, heat);

            const float load = toxic + smoke * kSmokeFoulMult;
            if (load > 2.0f) {
                const float costFloat = load * dt * kFoulRate * static_cast<float>(kFoulPeriod);
                const std::uint8_t foulCost = static_cast<std::uint8_t>(std::clamp(costFloat, 1.0f, 255.0f));

                if (sl.condition > foulCost) {
                    sl.condition -= foulCost;
                } else {
                    sl.condition = 0;
                    ++report.brokenCount;
                }
                ++report.degradedCount;
            }
        }
    }
    return report;
}

WearReport charge_step(Registry& reg, NpcPool& pool, LayerId layer, float dt,
                       std::uint64_t tick, EventBus* bus) {
    (void)dt;
    (void)bus;
    WearReport report{};

    auto view = reg.view<const Transform, const NpcRef, const Equipped>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const auto& nr = view.get<const NpcRef>(e);
        if (!pool.valid(nr.id)) continue;
        if ((tick + nr.id) % kFoulPeriod != 0) continue;

        Inventory& inv = pool.inventory(nr.id);
        const auto& eq = view.get<const Equipped>(e);
        const std::uint8_t toolSlot = eq.invSlot[static_cast<std::size_t>(EquipSlot::Tool)];
        if (toolSlot >= kInvSlots) continue;

        ItemSlot& sl = inv.slots[toolSlot];
        if (sl.item == 0) continue;

        const ItemDef& def = item_def(sl.item);
        if (def.wear != static_cast<std::uint8_t>(WearKind::Charge)) continue;

        const std::uint8_t cost = def.wearPerUse > 0 ? def.wearPerUse : 1;
        if (sl.condition > cost) {
            sl.condition -= cost;
        } else {
            sl.condition = 0;
            ++report.brokenCount;
        }
        ++report.degradedCount;
    }
    return report;
}

bool apply_item_wear(ItemSlot& slot, std::uint8_t amount) {
    if (slot.item == 0) return false;
    const ItemDef& def = item_def(slot.item);
    if (def.wear == static_cast<std::uint8_t>(WearKind::None)) return false;

    const std::uint8_t cost = amount > 0 ? amount : (def.wearPerUse > 0 ? def.wearPerUse : 1);
    if (slot.condition > cost) {
        slot.condition -= cost;
    } else {
        slot.condition = 0;
    }
    return true;
}

bool check_weapon_jam(NpcId shooterId, const ItemSlot& slot, std::uint64_t tick,
                      float envDust, EventBus* bus) {
    if (slot.item == 0) return false;
    const ItemDef& def = item_def(slot.item);
    if (def.wear != static_cast<std::uint8_t>(WearKind::Jamming)) return false;

    const std::uint32_t fouling = static_cast<std::uint32_t>(255u - slot.condition) +
                                  static_cast<std::uint32_t>(std::clamp(envDust, 0.0f, 100.0f));
    if (fouling == 0) return false;

    const std::uint32_t jamHash = hash3(static_cast<std::uint32_t>(shooterId),
                                        static_cast<std::uint32_t>(tick), kJamSalt);
    const float jamRoll = static_cast<float>(jamHash & 0xFFFFu) / 65535.0f;
    constexpr float kMaxJamProb = 0.35f;
    const float jamChance = (static_cast<float>(fouling) / 255.0f) * kMaxJamProb;

    if (jamRoll < jamChance) {
        if (bus) {
            Event ev{};
            ev.type = EventType::WeaponJammed;
            ev.a = static_cast<std::uint32_t>(shooterId);
            bus->publish(ev);
        }
        return true;
    }
    return false;
}

} // namespace giga::game
