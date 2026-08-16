// Soviet CRT/VHS HUD overlays, visor condensation and cracked glass feedback for GigaHrush 2.
#pragma once

#include <cstdint>
#include "ecs/registry.h"
#include "game/npc_pool.h"

struct ImDrawList;

namespace giga {

// Canonical Soviet CRT / VHS phosphor palette constants (Jirnyak Mandate 19)
inline constexpr float kPhosphorR = 0.349f; // #59F266
inline constexpr float kPhosphorG = 0.949f;
inline constexpr float kPhosphorB = 0.400f;

inline constexpr float kAmberR = 0.949f;    // #F2C740
inline constexpr float kAmberG = 0.780f;
inline constexpr float kAmberB = 0.251f;

struct GasMaskFeedbackState {
    bool hasMask = false;
    std::uint8_t condition = 255;
    float condition01 = 1.0f;
    std::uint16_t itemId = 0;
    const char* itemName = nullptr;
};

// Query player's equipped gas mask / respiratory filter condition.
GasMaskFeedbackState query_gas_mask_feedback(const Registry& reg, const game::NpcPool& pool, Entity player);

// Draw cracked glass fractures and condensation vignettes when gas mask condition drops below 50%.
void draw_gas_mask_hud_overlay(ImDrawList* drawList, float screenW, float screenH,
                                float currentTimeSec, const GasMaskFeedbackState& state);

// Draw Soviet CRT hardware bezel brackets and tactical CRT telemetry overlay.
void draw_soviet_crt_hud_brackets(ImDrawList* drawList, float screenW, float screenH,
                                  float currentTimeSec, bool samosborActive, float samosborPulse);

} // namespace giga
