// samosbor_env.cpp — Atmospheric hazard dynamics, stage progression, blast door seal checks & environmental damage ticks.
//
// CONSTITUTION: Docs/specs/06_SAMOSBOR_AND_CRISIS.md, samosbor.h, door.h, needs.h, combat.h.
// RULES: Zero mocks, no exceptions, no RTTI, UTF-8 without BOM.

#include "game/samosbor.h"

#include <algorithm>
#include <cmath>

#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/combat.h"
#include "game/door.h"
#include "game/embody.h"
#include "game/equip.h"
#include "game/needs.h"
#include "game/npc_pool.h"
#include "game/room_zone.h"
#include "game/rpg.h"
#include "game/status.h"
#include "world/field.h"
#include "world/macro_grid.h"
#include "world/types.h"

namespace giga::game {

const char* samosbor_stage_name(SamosborStage s) {
    switch (s) {
        case SamosborStage::Idle:        return "idle";
        case SamosborStage::Warning:     return "warning";
        case SamosborStage::Active:      return "active";
        case SamosborStage::Peak:        return "peak";
        case SamosborStage::Dissipation: return "dissipation";
        case SamosborStage::Aftermath:   return "aftermath";
        default:                         return "unknown";
    }
}

SamosborStage samosbor_current_stage(const SamosborState& st) {
    switch (static_cast<SamosborPhase>(st.phase)) {
        case SamosborPhase::Idle:
            return SamosborStage::Idle;
        case SamosborPhase::Warning:
            return SamosborStage::Warning;
        case SamosborPhase::Active: {
            const float p = samosbor_phase01(st);
            if (p < 0.25f) return SamosborStage::Active;
            if (p < 0.75f) return SamosborStage::Peak;
            return SamosborStage::Dissipation;
        }
        case SamosborPhase::Aftermath:
            return SamosborStage::Aftermath;
        default:
            return SamosborStage::Idle;
    }
}

float samosbor_floor_pressure_drop(int floorZ, SamosborVariant variant, SamosborStage stage) {
    const float depth01 = mob_depth01(floorZ);
    float variantDropMult = 1.0f;
    switch (variant) {
        case SamosborVariant::Wet:      variantDropMult = 0.90f; break;
        case SamosborVariant::Electric: variantDropMult = 1.25f; break;
        case SamosborVariant::Meat:     variantDropMult = 1.05f; break;
        case SamosborVariant::Maronary: variantDropMult = 1.15f; break;
        case SamosborVariant::Istotit:  variantDropMult = 0.85f; break;
        case SamosborVariant::Veretar:  variantDropMult = 1.20f; break;
        case SamosborVariant::Classic:
        default:                        variantDropMult = 1.0f;  break;
    }

    float baseDropKpa = 0.0f;
    switch (stage) {
        case SamosborStage::Idle:
            baseDropKpa = 0.0f;
            break;
        case SamosborStage::Warning:
            baseDropKpa = 8.0f + depth01 * 6.0f;
            break;
        case SamosborStage::Active:
            baseDropKpa = 25.0f + depth01 * 15.0f;
            break;
        case SamosborStage::Peak:
            baseDropKpa = 45.0f + depth01 * 25.0f;
            break;
        case SamosborStage::Dissipation:
            baseDropKpa = 20.0f + depth01 * 10.0f;
            break;
        case SamosborStage::Aftermath:
            baseDropKpa = 4.0f + depth01 * 2.0f;
            break;
        default:
            break;
    }
    return baseDropKpa * variantDropMult;
}

float samosbor_ambient_toxicity(int floorZ, SamosborVariant variant, SamosborStage stage, float phase01) {
    const float depth01 = mob_depth01(floorZ);
    float variantToxMult = 1.0f;
    switch (variant) {
        case SamosborVariant::Wet:      variantToxMult = 1.10f; break;
        case SamosborVariant::Electric: variantToxMult = 0.95f; break;
        case SamosborVariant::Meat:     variantToxMult = 1.35f; break;
        case SamosborVariant::Maronary: variantToxMult = 1.00f; break;
        case SamosborVariant::Istotit:  variantToxMult = 0.75f; break;
        case SamosborVariant::Veretar:  variantToxMult = 1.50f; break;
        case SamosborVariant::Classic:
        default:                        variantToxMult = 1.0f;  break;
    }

    float baseTox = 0.0f;
    switch (stage) {
        case SamosborStage::Idle:
            baseTox = 0.0f;
            break;
        case SamosborStage::Warning:
            baseTox = 0.10f * depth01 * std::clamp(phase01, 0.0f, 1.0f);
            break;
        case SamosborStage::Active: {
            const float t = std::clamp(phase01 / 0.25f, 0.0f, 1.0f);
            baseTox = (0.15f + 0.55f * t) * (0.8f + 0.2f * depth01);
            break;
        }
        case SamosborStage::Peak: {
            baseTox = (0.85f + 0.15f * depth01);
            break;
        }
        case SamosborStage::Dissipation: {
            const float t = std::clamp((phase01 - 0.75f) / 0.25f, 0.0f, 1.0f);
            baseTox = (0.70f - 0.50f * t) * (0.8f + 0.2f * depth01);
            break;
        }
        case SamosborStage::Aftermath:
            baseTox = 0.15f * (1.0f - std::clamp(phase01, 0.0f, 1.0f));
            break;
        default:
            break;
    }
    return std::clamp(baseTox * variantToxMult, 0.0f, 1.0f);
}

SamosborAtmosphere samosbor_compute_atmosphere(const SamosborState& st, int floorZ, float timeSec) {
    SamosborAtmosphere atm{};
    atm.stage = samosbor_current_stage(st);
    const auto variant = static_cast<SamosborVariant>(st.variant < kSamosborVariantCount ? st.variant : 0);
    const float p = samosbor_phase01(st);

    const float dropKpa = samosbor_floor_pressure_drop(floorZ, variant, atm.stage);
    atm.pressureKpa = std::max(20.0f, 101.325f - dropKpa);
    atm.toxicity01 = samosbor_ambient_toxicity(floorZ, variant, atm.stage, p);

    float baseCa = 0.003f;
    float caAdd = 0.0f;
    float shake = 0.0f;
    float fogDen = 0.0f;
    float fogSc = 1.0f;

    switch (atm.stage) {
        case SamosborStage::Idle:
            fogDen = 0.0f;
            caAdd = 0.0f;
            shake = 0.0f;
            fogSc = 1.0f;
            break;
        case SamosborStage::Warning:
            fogDen = 0.15f * p;
            caAdd = 0.003f * p;
            shake = 0.02f * std::sin(timeSec * 15.0f) * p;
            fogSc = 1.0f - 0.10f * p;
            break;
        case SamosborStage::Active: {
            const float t = std::clamp(p / 0.25f, 0.0f, 1.0f);
            fogDen = 0.15f + 0.70f * t;
            caAdd = 0.003f + 0.008f * t;
            shake = 0.05f + 0.15f * t;
            const float in_ = p < 0.2f ? p / 0.2f : 1.0f;
            fogSc = 1.0f - (1.0f - kSamosborFogSqueeze) * in_;
            break;
        }
        case SamosborStage::Peak: {
            const float pulse = 0.5f + 0.5f * std::sin(timeSec * 3.0f);
            fogDen = 0.85f + 0.15f * pulse;
            caAdd = 0.014f + 0.006f * std::abs(std::sin(timeSec * 5.0f));
            shake = 0.20f + 0.15f * std::abs(std::sin(timeSec * 22.0f + 1.3f));
            fogSc = kSamosborFogSqueeze;
            break;
        }
        case SamosborStage::Dissipation: {
            const float t = std::clamp((p - 0.75f) / 0.25f, 0.0f, 1.0f);
            fogDen = 1.0f - 0.70f * t;
            caAdd = 0.014f - 0.008f * t;
            shake = 0.20f - 0.15f * t;
            fogSc = kSamosborFogSqueeze;
            break;
        }
        case SamosborStage::Aftermath:
            fogDen = 0.30f * (1.0f - p);
            caAdd = 0.003f * (1.0f - p);
            shake = 0.0f;
            fogSc = kSamosborFogSqueeze + (1.0f - kSamosborFogSqueeze) * p;
            break;
        default:
            break;
    }

    if (variant == SamosborVariant::Maronary) {
        caAdd *= 1.8f;
    } else if (variant == SamosborVariant::Electric) {
        shake *= 1.5f;
    } else if (variant == SamosborVariant::Meat) {
        caAdd *= 1.25f;
    } else if (variant == SamosborVariant::Wet) {
        fogDen = std::min(1.0f, fogDen * 1.15f);
    }

    atm.fogDensity = std::clamp(fogDen, 0.0f, 1.0f);
    atm.chromaticAberration = std::clamp(baseCa + caAdd, 0.001f, 0.050f);
    atm.screenShake = std::max(0.0f, shake);
    atm.fogScale = std::clamp(fogSc, kSamosborFogSqueeze, 1.0f);

    return atm;
}

bool samosbor_is_sheltered(const vec3& pos, const DoorSet& doors,
                           const MacroGrid* /*grid*/,
                           const RoomZones* rooms) {
    const int pcx = wrap_macro_x(static_cast<int>(std::floor(pos.x / kCellSize)));
    const int pcy = wrap_macro_y(static_cast<int>(std::floor(pos.y / kCellSize)));
    const int pcz = wrap_macro_z(static_cast<int>(std::floor(pos.z / kCellSize)));

    // 1. Direct proximity check to any shut or locked hermetic door (dx^2 + dy^2 + dz^2 <= 16 cells)
    for (const Door& d : doors.doors) {
        if (!d.hermetic || d.hp <= 0) continue;
        const std::uint8_t s = d.state;
        if (s != static_cast<std::uint8_t>(DoorState::Shut) &&
            s != static_cast<std::uint8_t>(DoorState::Locked))
            continue;

        const int dx = wrap_delta(pcx, static_cast<int>(d.cx), kMacroDimX);
        const int dy = wrap_delta(pcy, static_cast<int>(d.cy), kMacroDimY);
        const int dz = wrap_delta(pcz, static_cast<int>(d.cz), kMacroDimZ);
        if (dx * dx + dy * dy + dz * dz <= 16) {
            return true;
        }
    }

    // 2. Room-based hermetic apartment sealing check when RoomZones is available
    if (rooms != nullptr && rooms->ready()) {
        const std::uint16_t roomBit = room_bit_at(rooms->kind, rooms->number, pcx, pcy);
        constexpr std::uint16_t kHermeticMask =
            room_bit(RoomBit::Living) |
            room_bit(RoomBit::Medical) |
            room_bit(RoomBit::Hq);
        if ((roomBit & kHermeticMask) != 0u) {
            for (const Door& d : doors.doors) {
                if (!d.hermetic || d.hp <= 0) continue;
                const std::uint8_t s = d.state;
                if (s != static_cast<std::uint8_t>(DoorState::Shut) &&
                    s != static_cast<std::uint8_t>(DoorState::Locked))
                    continue;

                const int dx = wrap_delta(pcx, static_cast<int>(d.cx), kMacroDimX);
                const int dy = wrap_delta(pcy, static_cast<int>(d.cy), kMacroDimY);
                const int dz = wrap_delta(pcz, static_cast<int>(d.cz), kMacroDimZ);
                if (dx * dx + dy * dy <= 36 && dz * dz <= 16) {
                    return true;
                }
            }
        }
    }

    return false;
}

void samosbor_environmental_step(Registry& reg, NpcPool& pool,
                                  const DoorSet& doors, LayerId layer,
                                  const SamosborState& sam, float dt,
                                  StatusSet* playerStatus,
                                  const MacroGrid* grid,
                                  const RoomZones* rooms,
                                  int floorZ,
                                  const Field<float>* gasField) {
    if (sam.phase != static_cast<std::uint8_t>(SamosborPhase::Active))
        return;

    const auto variant = static_cast<SamosborVariant>(sam.variant < kSamosborVariantCount ? sam.variant : 0);
    const SamosborStage stage = samosbor_current_stage(sam);
    const float phase01 = samosbor_phase01(sam);
    const float ambientTox = samosbor_ambient_toxicity(floorZ, variant, stage, phase01);

    // Pre-build a flat list of shut+locked hermetic doors on this floor for fast O(n*m) shelter check
    struct HermeticCell { std::int32_t cx, cy, cz; };
    HermeticCell cellsBuf[64];
    HermeticCell* cellsPtr = cellsBuf;
    std::size_t cellCount = 0;
    bool heapFallback = false;
    std::vector<HermeticCell> cellsVec;

    for (const Door& d : doors.doors) {
        if (!d.hermetic || d.hp <= 0) continue;
        const std::uint8_t s = d.state;
        if (s != static_cast<std::uint8_t>(DoorState::Shut) &&
            s != static_cast<std::uint8_t>(DoorState::Locked))
            continue;
        if (!heapFallback && cellCount < 64u) {
            cellsBuf[cellCount++] = {
                static_cast<std::int32_t>(d.cx),
                static_cast<std::int32_t>(d.cy),
                static_cast<std::int32_t>(d.cz)};
        } else {
            if (!heapFallback) {
                cellsVec.assign(cellsBuf, cellsBuf + cellCount);
                heapFallback = true;
                cellsPtr = nullptr;
            }
            cellsVec.push_back({
                static_cast<std::int32_t>(d.cx),
                static_cast<std::int32_t>(d.cy),
                static_cast<std::int32_t>(d.cz)});
        }
    }
    const std::size_t totalCells = heapFallback ? cellsVec.size() : cellCount;
    const HermeticCell* cells   = heapFallback ? cellsVec.data() : cellsBuf;

    auto view = reg.view<const Transform, const NpcRef>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;

        const int pcx = wrap_macro_x(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
        const int pcy = wrap_macro_y(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
        const int pcz = wrap_macro_z(static_cast<int>(std::floor(tr.pos.z / kCellSize)));

        bool sheltered = false;
        for (std::size_t i = 0; i < totalCells; ++i) {
            const int dx = wrap_delta(pcx, static_cast<int>(cells[i].cx), kMacroDimX);
            const int dy = wrap_delta(pcy, static_cast<int>(cells[i].cy), kMacroDimY);
            const int dz = wrap_delta(pcz, static_cast<int>(cells[i].cz), kMacroDimZ);
            if (dx * dx + dy * dy + dz * dz <= 16) {
                sheltered = true;
                break;
            }
        }
        if (!sheltered && (grid || rooms)) {
            sheltered = samosbor_is_sheltered(tr.pos, doors, grid, rooms);
        }
        if (sheltered) continue;

        // Biological immunity check
        bool filterProtected = false;
        if (const RpgStats* rpg = reg.try_get<RpgStats>(e)) {
            if (has_mutation(*rpg, BioMutationId::GillsOfGigahrush)) {
                filterProtected = true;
            }
        }

        // Equipment Hazmat & Gas Mask Filter Degradation
        Inventory& inv = pool.inventory(id);
        const Equipped* eq = reg.try_get<Equipped>(e);
        bool hazmatProtected = false;

        if (eq) {
            // Check tool and armor slots for working respiratory filter (WearKind::Fouling)
            ItemSlot* toolSlot = equipped_slot(inv, *eq, EquipSlot::Tool);
            if (toolSlot && toolSlot->condition > 0 && item_valid(toolSlot->item)) {
                const ItemDef& tdef = item_def(toolSlot->item);
                if (tdef.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
                    filterProtected = true;
                    // Gas mask filter durability degradation scales with ambient toxicity and local gas
                    float localGas = 0.0f;
                    if (gasField != nullptr) localGas = gasField->at(pcx, pcy, pcz);
                    const float gasIntensity = ambientTox + localGas;
                    const float wearMult = (variant == SamosborVariant::Veretar) ? 2.5f : 1.0f;
                    const float filterLossRate = std::max(0.5f, gasIntensity * 3.5f * wearMult);

                    float condLoss = filterLossRate * dt;
                    while (condLoss >= 1.0f && toolSlot->condition > 0) {
                        --toolSlot->condition;
                        condLoss -= 1.0f;
                    }
                    if (condLoss > 0.0f && toolSlot->condition > 0) {
                        const std::uint32_t h = ::giga::hash_u32(static_cast<std::uint32_t>(id * 1013u + static_cast<std::uint32_t>(sam.activeMs)));
                        if ((h & 0xFFFFu) < static_cast<std::uint32_t>(condLoss * 65535.0f)) {
                            --toolSlot->condition;
                        }
                    }
                    if (toolSlot->condition == 0) {
                        filterProtected = false; // filter just fouled / expired
                    }
                }
            }

            // Check hazmat suit protection (EquipSlot::Armor)
            ItemSlot* armorSlot = equipped_slot(inv, *eq, EquipSlot::Armor);
            if (armorSlot && armorSlot->condition > 0 && item_valid(armorSlot->item)) {
                const ItemDef& adef = item_def(armorSlot->item);
                if (adef.resist[3] > 0 || adef.resist[2] > 0 || adef.resist[0] >= 60) {
                    hazmatProtected = true;
                    // Corrosive acid vapor wear in Veretar Samosbor
                    if (variant == SamosborVariant::Veretar && ambientTox > 0.25f) {
                        const float armorLossRate = 0.4f;
                        float aLoss = armorLossRate * dt;
                        if (aLoss > 0.0f && armorSlot->condition > 0) {
                            const std::uint32_t ah = ::giga::hash_u32(static_cast<std::uint32_t>(id * 2017u + static_cast<std::uint32_t>(sam.activeMs)));
                            if ((ah & 0xFFFFu) < static_cast<std::uint32_t>(aLoss * 65535.0f)) {
                                --armorSlot->condition;
                            }
                        }
                    }
                }
            }
        }

        // Apply atmospheric sensory fog/coughing status to unsheltered camera holder
        if (reg.all_of<CameraTag>(e) && playerStatus != nullptr) {
            if (variant == SamosborVariant::Meat) {
                status_apply(*playerStatus, StatusId::GovnyakCough, filterProtected);
            } else {
                status_apply(*playerStatus, StatusId::SporeHaze, filterProtected);
            }
        }

        // Unsheltered: accumulate continuous fog and toxic pressure
        Needs& n = pool.needs(id);

        // Base fog drain: absorbed by functional gas mask filter
        if (!filterProtected) {
            n.hpDebt += 0.5f * dt;
        }

        // Variant-specific additional drain
        switch (variant) {
            case SamosborVariant::Meat:
                n.water = std::max(0.0f, n.water - 0.1f * dt);
                break;
            case SamosborVariant::Electric:
                n.sleep = std::max(0.0f, n.sleep - 0.1f * dt);
                break;
            case SamosborVariant::Veretar:
                // Toxic corrosive atmosphere: mitigated by gas mask (respiratory) and hazmat armor (skin)
                if (filterProtected && hazmatProtected) {
                    // Full hazmat seal: complete protection
                } else if (filterProtected && !hazmatProtected) {
                    // Lungs safe, but exposed skin suffers minor acidic burn
                    n.hpDebt += 0.08f * dt;
                } else if (!filterProtected && hazmatProtected) {
                    // Body safe, but inhaling toxic Veretar vapors
                    n.hpDebt += 0.25f * dt;
                } else {
                    // Unmitigated corrosive chemical vapor
                    n.hpDebt += 0.30f * dt;
                }
                break;
            default:
                break;
        }

        // Spill whole HP debt through apply_damage
        if (n.hpDebt >= 1.0f) {
            const auto whole = static_cast<std::int16_t>(n.hpDebt);
            n.hpDebt -= static_cast<float>(whole);
            apply_damage(reg, pool, e, whole, kAttritionChannel, entt::null);
        }
    }

    (void)cellsPtr;
}

} // namespace giga::game
