// suite_audio.inl - Spatial acoustics, toroidal distance, occlusion, and SDL audio (Spec 04 §4.1, §4.2)
#pragma once

#include <cstdio>
#include <cmath>
#include "render/audio.h"
#include "world/macro_grid.h"
#include "../src/render/audio.cpp"

namespace {

static void test_audio_and_acoustics_all() {
    using namespace giga;
    using namespace giga::render;

    std::fprintf(stdout, "Entering test_audio_and_acoustics_all...\n");

    // 1. Toroidal Wrap Distance Test (Spec 04 §5.1)
    // Source at 250m on a 256m torus is 6m away across the wrap boundary.
    {
        ListenerFrame listener{};
        listener.pos = vec3{2.0f, 10.0f, 0.0f};
        listener.right = vec3{1.0f, 0.0f, 0.0f};
        listener.fwd = vec3{0.0f, 1.0f, 0.0f};
        listener.up = vec3{0.0f, 0.0f, 1.0f};

        AudioSource src{};
        src.pos = vec3{252.0f, 10.0f, 0.0f}; // 250m direct coordinate delta, 6m wrapped
        src.gain = 1.0f;

        SpatialAudio spat = evaluate_spatial_audio(src, listener, 4.0f, 64.0f);

        // Measured toroidal distance must be exactly 6.0m
        CHECK(std::abs(spat.distance - 6.0f) < 0.01f);

        // Should be audible and not culled
        CHECK(spat.gainLeft > 0.0f || spat.gainRight > 0.0f);

        // Source is to the left (-X wrapped): gainLeft > gainRight
        CHECK(spat.gainLeft > spat.gainRight);

        std::fprintf(stdout, "[audio] Toroidal wrap: source at x=252 listener at x=2 heard at dist=%.2f m (L=%.2f, R=%.2f)\n",
                     spat.distance, spat.gainLeft, spat.gainRight);
    }

    // 2. Stereo Panning Test
    {
        ListenerFrame listener{};
        listener.pos = vec3{10.0f, 10.0f, 0.0f};
        listener.right = vec3{1.0f, 0.0f, 0.0f}; // +X is right

        // Source on the right
        AudioSource srcRight{};
        srcRight.pos = vec3{14.0f, 10.0f, 0.0f};
        srcRight.gain = 1.0f;

        SpatialAudio spatR = evaluate_spatial_audio(srcRight, listener, 4.0f, 64.0f);
        CHECK(spatR.gainRight > spatR.gainLeft);

        // Source on the left
        AudioSource srcLeft{};
        srcLeft.pos = vec3{6.0f, 10.0f, 0.0f};
        srcLeft.gain = 1.0f;

        SpatialAudio spatL = evaluate_spatial_audio(srcLeft, listener, 4.0f, 64.0f);
        CHECK(spatL.gainLeft > spatL.gainRight);
    }

    // 3. Wall and Pipe Occlusion Test (Spec 04 §4.2)
    {
        MacroGrid grid{};
        // Fill a wall at cell x=5, y=5, z=0
        grid.set_cell(5, 5, 0, 1);
        grid.mask(5, 5, 0).set_all();

        const vec3 srcPos{4.0f * kCellSize + 1.0f, 5.0f * kCellSize + 1.0f, 1.0f};
        const vec3 listenerPos{6.0f * kCellSize + 1.0f, 5.0f * kCellSize + 1.0f, 1.0f};

        // Occlusion without pipe connection
        float occlBlocked = compute_audio_occlusion(srcPos, listenerPos, &grid, false);
        CHECK(occlBlocked > 0.0f);

        // Occlusion with pipe connection bypass
        float occlPipe = compute_audio_occlusion(srcPos, listenerPos, &grid, true);
        CHECK(occlPipe <= 0.15f);
        CHECK(occlPipe <= occlBlocked);

        std::fprintf(stdout, "[audio] Occlusion: wall=%.2f, pipe_bypass=%.2f\n",
                     occlBlocked, occlPipe);
    }

    // 4. AudioSystem Subsystem Test
    {
        AudioSystem audio;
        CHECK(audio.init());
        CHECK(audio.is_initialized());
        audio.shutdown();
        CHECK(!audio.is_initialized());
    }

    std::fprintf(stdout, "[audio] suite_audio: all spatial, toroidal wrap, panning and occlusion tests PASSED\n");
}

} // namespace
