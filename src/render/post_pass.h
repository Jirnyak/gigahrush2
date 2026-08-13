#pragma once

#include <cstdint>
#include <algorithm>
#include <cmath>

namespace giga::render {

struct PostState {
    float darkAdapt = 1.0f;       // Exposure factor adapting to scene luminance
    float stun = 0.0f;            // 0..1: blur + chromatic aberration
    float hallucination = 0.0f;   // 0..1: UV distortion + palette shift
    float crt = 1.0f;             // 0..1: CRT scanlines and phosphor toggle
};

// Updates dark adaptation exposure with asymmetric rate: slow to adapt to dark, fast to adapt to bright
void update_dark_adaptation(PostState& state, float sceneLuminance, float dt);

// Computes post-processing parameters driven by player status effects (stun, toxicity, hallucinations)
void update_status_post_effects(PostState& state, float stunIntensity, float halluIntensity, float dt);

} // namespace giga::render
