// suite_post_pass.inl - Post-processing, dark adaptation and status visual effects (Spec 04 §4.3)
#pragma once

#include <cstdio>
#include <cmath>
#include "render/post_pass.h"
#include "../src/render/post_pass.cpp"

namespace {

static void test_post_pass_all() {
    using namespace giga::render;

    std::fprintf(stdout, "Entering test_post_pass_all...\n");

    // 1. Asymmetric Dark Adaptation Test
    // Eye adapts quickly to bright light, slowly to deep darkness
    {
        PostState brightState{};
        brightState.darkAdapt = 1.0f;

        // Step 0.5s towards bright light (luminance 5.0 -> target exposure 0.2)
        update_dark_adaptation(brightState, 5.0f, 0.5f);
        const float brightDelta = std::abs(1.0f - brightState.darkAdapt);

        PostState darkState{};
        darkState.darkAdapt = 1.0f;

        // Step 0.5s towards dark (luminance 0.25 -> target exposure 4.0)
        update_dark_adaptation(darkState, 0.25f, 0.5f);
        const float darkDelta = std::abs(darkState.darkAdapt - 1.0f);

        // Fractional progress towards target: bright adaptation must be significantly faster
        const float brightProgress = brightDelta / (1.0f - 0.2f);
        const float darkProgress = darkDelta / (4.0f - 1.0f);

        CHECK(brightProgress > darkProgress);
        CHECK(brightProgress > 0.8f); // fast adaptation (>80% in 0.5s)
        CHECK(darkProgress < 0.4f);   // slow adaptation (<40% in 0.5s)

        std::fprintf(stdout, "[post] Dark adaptation: bright progress=%.2f, dark progress=%.2f (asymmetric OK)\n",
                     brightProgress, darkProgress);
    }

    // 2. Status Visual Effects Clamping
    {
        PostState post{};
        update_status_post_effects(post, 1.5f, -0.5f, 0.016f);
        CHECK(post.stun == 1.0f);
        CHECK(post.hallucination == 0.0f);

        update_status_post_effects(post, 0.4f, 0.75f, 0.016f);
        CHECK(std::abs(post.stun - 0.4f) < 1e-4f);
        CHECK(std::abs(post.hallucination - 0.75f) < 1e-4f);
    }

    std::fprintf(stdout, "[post] suite_post_pass: all dark adaptation and status post-processing checks PASSED\n");
}

} // namespace
