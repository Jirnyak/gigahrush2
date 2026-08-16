// Soviet CRT/VHS HUD overlays, visor condensation and cracked glass feedback implementation.
#include "app/hud_overlay.h"

#include <cmath>
#include "imgui.h"
#include "game/embody.h"
#include "game/item_table.h"
#include "game/equip.h"

namespace giga {

GasMaskFeedbackState query_gas_mask_feedback(const Registry& reg, const game::NpcPool& pool, Entity player) {
    GasMaskFeedbackState state{};
    if (player == entt::null || !reg.valid(player)) {
        return state;
    }

    const auto* nr = reg.try_get<game::NpcRef>(player);
    if (!nr || !pool.valid(nr->id)) {
        return state;
    }

    const auto& inv = pool.inventory(nr->id);
    for (std::size_t s = 0; s < game::kInvSlots; ++s) {
        const auto& slot = inv.slots[s];
        if (slot.item == 0 || slot.count == 0) continue;
        if (!game::item_valid(slot.item)) continue;
        const auto& def = game::item_def(slot.item);
        // Check if item is a protective respiratory mask / helmet / armor
        if (def.equipSlot == static_cast<std::uint8_t>(game::EquipSlot::Armor) || def.category == static_cast<std::uint8_t>(game::ItemCategory::Tool)) {
            state.hasMask = true;
            state.condition = slot.condition;
            state.condition01 = static_cast<float>(slot.condition) / 255.0f;
            state.itemId = slot.item;
            state.itemName = game::item_name(slot.item);
            break;
        }
    }

    return state;
}

void draw_gas_mask_hud_overlay(ImDrawList* drawList, float screenW, float screenH,
                                float currentTimeSec, const GasMaskFeedbackState& state) {
    if (!drawList || screenW <= 0.0f || screenH <= 0.0f) return;

    // If no mask or condition is perfect (>90%), minimal or no condensation
    if (!state.hasMask) return;

    const float dmgRatio = 1.0f - state.condition01; // 0.0 (pristine) to 1.0 (destroyed)

    // Condensation Vignette along screen perimeter
    if (dmgRatio > 0.20f) {
        const float alpha = (dmgRatio - 0.20f) * 0.65f;
        const ImU32 fogCol = ImColor(0.20f, 0.35f, 0.22f, alpha * 0.45f);
        const float edgeW = screenW * 0.12f;
        const float edgeH = screenH * 0.12f;

        // Top & Bottom condensation bands
        drawList->AddRectFilledMultiColor(
            ImVec2(0, 0), ImVec2(screenW, edgeH),
            fogCol, fogCol, ImColor(0, 0, 0, 0), ImColor(0, 0, 0, 0));
        drawList->AddRectFilledMultiColor(
            ImVec2(0, screenH - edgeH), ImVec2(screenW, screenH),
            ImColor(0, 0, 0, 0), ImColor(0, 0, 0, 0), fogCol, fogCol);
        // Left & Right condensation bands
        drawList->AddRectFilledMultiColor(
            ImVec2(0, 0), ImVec2(edgeW, screenH),
            fogCol, ImColor(0, 0, 0, 0), ImColor(0, 0, 0, 0), fogCol);
        drawList->AddRectFilledMultiColor(
            ImVec2(screenW - edgeW, 0), ImVec2(screenW, screenH),
            ImColor(0, 0, 0, 0), fogCol, fogCol, ImColor(0, 0, 0, 0));
    }

    // Cracked Glass Fractures (when condition < 50%)
    if (dmgRatio > 0.50f) {
        const float crackAlpha = (dmgRatio - 0.50f) * 2.0f; // 0.0 to 1.0
        const ImU32 crackCol = ImColor(0.85f, 0.95f, 0.88f, crackAlpha * 0.75f);
        const ImU32 shadowCol = ImColor(0.05f, 0.10f, 0.05f, crackAlpha * 0.85f);

        const float cx = screenW * 0.82f;
        const float cy = screenH * 0.25f;

        // Radial fracture points
        const ImVec2 fractures[] = {
            ImVec2(cx, cy), ImVec2(cx - 65, cy - 45),
            ImVec2(cx - 65, cy - 45), ImVec2(cx - 130, cy - 60),
            ImVec2(cx, cy), ImVec2(cx - 40, cy + 55),
            ImVec2(cx - 40, cy + 55), ImVec2(cx - 95, cy + 120),
            ImVec2(cx, cy), ImVec2(cx + 45, cy + 30),
            ImVec2(cx + 45, cy + 30), ImVec2(cx + 80, cy + 85),
            ImVec2(cx - 65, cy - 45), ImVec2(cx - 85, cy + 10),
            ImVec2(cx - 40, cy + 55), ImVec2(cx - 20, cy + 90),
        };

        const std::size_t numSegs = sizeof(fractures) / (sizeof(ImVec2) * 2);
        for (std::size_t i = 0; i < numSegs; ++i) {
            const ImVec2 p1 = fractures[i * 2];
            const ImVec2 p2 = fractures[i * 2 + 1];
            // Shadow line for depth
            drawList->AddLine(ImVec2(p1.x + 1.0f, p1.y + 1.0f), ImVec2(p2.x + 1.0f, p2.y + 1.0f), shadowCol, 2.0f);
            // Glass reflection line
            drawList->AddLine(p1, p2, crackCol, 1.5f);
        }
    }
}

void draw_soviet_crt_hud_brackets(ImDrawList* drawList, float screenW, float screenH,
                                  float currentTimeSec, bool samosborActive, float samosborPulse) {
    if (!drawList || screenW <= 0.0f || screenH <= 0.0f) return;

    const float margin = 18.0f;
    const float bracketLen = 36.0f;
    const float thickness = 2.0f;

    const ImU32 col = samosborActive
        ? ImColor(kAmberR, kAmberG * (0.8f + 0.2f * std::sin(currentTimeSec * 6.0f)), kAmberB, 0.90f)
        : ImColor(kPhosphorR, kPhosphorG, kPhosphorB, 0.75f);

    // Top-Left Bracket
    drawList->AddLine(ImVec2(margin, margin), ImVec2(margin + bracketLen, margin), col, thickness);
    drawList->AddLine(ImVec2(margin, margin), ImVec2(margin, margin + bracketLen), col, thickness);

    // Top-Right Bracket
    drawList->AddLine(ImVec2(screenW - margin, margin), ImVec2(screenW - margin - bracketLen, margin), col, thickness);
    drawList->AddLine(ImVec2(screenW - margin, margin), ImVec2(screenW - margin, margin + bracketLen), col, thickness);

    // Bottom-Left Bracket
    drawList->AddLine(ImVec2(margin, screenH - margin), ImVec2(margin + bracketLen, screenH - margin), col, thickness);
    drawList->AddLine(ImVec2(margin, screenH - margin), ImVec2(margin, screenH - margin - bracketLen), col, thickness);

    // Bottom-Right Bracket
    drawList->AddLine(ImVec2(screenW - margin, screenH - margin), ImVec2(screenW - margin - bracketLen, screenH - margin), col, thickness);
    drawList->AddLine(ImVec2(screenW - margin, screenH - margin), ImVec2(screenW - margin, screenH - margin - bracketLen), col, thickness);
}

} // namespace giga
