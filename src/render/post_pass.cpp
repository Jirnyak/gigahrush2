#include "render/post_pass.h"

#include <algorithm>
#include <cmath>

namespace giga::render {

void update_dark_adaptation(PostState& state, float sceneLuminance, float dt) {
    // Clamped target exposure: 0.1 for blinding light, 5.0 for deep darkness
    const float safeLum = std::clamp(sceneLuminance, 0.05f, 10.0f);
    const float targetExposure = std::clamp(1.0f / safeLum, 0.2f, 4.0f);

    // Asymmetric adaptation rate: fast adaptation to brightness (5.0s^-1), slow adaptation to darkness (0.5s^-1)
    const float rate = (targetExposure > state.darkAdapt) ? 0.5f : 5.0f;
    const float alpha = 1.0f - std::exp(-rate * std::max(dt, 0.0f));

    state.darkAdapt += (targetExposure - state.darkAdapt) * alpha;
}

void update_status_post_effects(PostState& state, float stunIntensity, float halluIntensity, float dt) {
    (void)dt;
    state.stun = std::clamp(stunIntensity, 0.0f, 1.0f);
    state.hallucination = std::clamp(halluIntensity, 0.0f, 1.0f);
}

} // namespace giga::render
