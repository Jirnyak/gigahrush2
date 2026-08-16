// Suite: Procedural Audio Synthesizer, 3D Spatial Audio & Voxel Occlusion Tests
// Comprehensive verification of DSP math, Geiger Poisson process, Samosbor siren,
// SECAM CRT & 50 Hz power hum, UI synthesis, 3D spatialization, and mixer limiting.
#pragma once

#include "audio/audio_types.h"
#include "audio/dsp_math.h"
#include "audio/synth_geiger.h"
#include "audio/synth_siren.h"
#include "audio/synth_ambient.h"
#include "audio/synth_ui.h"
#include "audio/spatial_audio.h"
#include "audio/audio_mixer.h"
#include "world/macro_grid.h"
#include <cmath>
#include <vector>

namespace giga::audio {

static void test_dsp_math_primitives() {
    // 1. Stateless PRNG splitmix32 distribution
    uint32_t state = 123456789u;
    float sum = 0.0f;
    constexpr int kPrngSamples = 10000;
    for (int i = 0; i < kPrngSamples; ++i) {
        float val = splitmix32_f01(state);
        CHECK(val >= 0.0f && val < 1.0f);
        sum += val;
    }
    float mean = sum / static_cast<float>(kPrngSamples);
    CHECK(std::fabs(mean - 0.5f) < 0.02f); // Mean should be ~0.5

    // 2. Fast tanh and master limiter soft saturation
    CHECK(std::fabs(fast_tanh(0.0f)) < 1e-6f);
    CHECK(fast_tanh(10.0f) <= 1.0f && fast_tanh(10.0f) >= 0.99f);
    CHECK(fast_tanh(-10.0f) >= -1.0f && fast_tanh(-10.0f) <= -0.99f);
    CHECK(std::fabs(master_limiter(0.0f)) < 1e-6f);
    CHECK(master_limiter(100.0f) <= 1.0f);
    CHECK(master_limiter(-100.0f) >= -1.0f);

    // 3. 1-Pole Lowpass Filter frequency attenuation
    OnePoleLp lp;
    lp.set_cutoff(1000.0f, kAudioSampleRate);
    lp.reset(0.0f);
    // DC signal should pass with gain 1.0
    float dcOut = 0.0f;
    for (int i = 0; i < 500; ++i) {
        dcOut = lp.process(1.0f);
    }
    CHECK(std::fabs(dcOut - 1.0f) < 0.01f);

    // High frequency (Nyquist = 24 kHz) should be heavily attenuated
    lp.reset(0.0f);
    float maxNyquistOut = 0.0f;
    for (int i = 0; i < 200; ++i) {
        float in = (i % 2 == 0) ? 1.0f : -1.0f;
        float out = lp.process(in);
        if (i > 50 && std::fabs(out) > maxNyquistOut) {
            maxNyquistOut = std::fabs(out);
        }
    }
    CHECK(maxNyquistOut < 0.15f); // Heavy attenuation at 24 kHz for 1 kHz cutoff

    // 4. 2nd-Order State Variable Filter (SVF)
    StateVariableFilter svf;
    svf.set_params(1450.0f, 2.2f, kAudioSampleRate);
    svf.reset();
    // Test DC input: LP should reach 1.0, BP should reach 0.0, HP should reach 0.0
    float lastLp = 0.0f, lastBp = 0.0f, lastHp = 0.0f, lastNotch = 0.0f;
    for (int i = 0; i < 1000; ++i) {
        svf.process(1.0f, lastLp, lastBp, lastHp, lastNotch);
    }
    CHECK(std::fabs(lastLp - 1.0f) < 0.01f);
    CHECK(std::fabs(lastBp) < 0.01f);
    CHECK(std::fabs(lastHp) < 0.01f);
}

static void test_geiger_poisson_synth() {
    GeigerSynth geiger;

    // 1. Background click rate at danger = 0.0
    geiger.set_danger(0.0f);
    constexpr int kSecSamples = 48000;
    std::vector<float> buf(kSecSamples);

    // Generate 5 seconds of baseline background
    int bgClicks = 0;
    for (int s = 0; s < 5; ++s) {
        geiger.generate(buf.data(), kSecSamples);
        for (int i = 1; i < kSecSamples; ++i) {
            // Detect rising edge click transient
            if (buf[i] > 0.4f && buf[i - 1] <= 0.4f) {
                ++bgClicks;
            }
        }
    }
    // Expected background is ~0.35 clicks/s * 5 s = 1.75 clicks. Should be small (0..15)
    CHECK(bgClicks >= 0 && bgClicks <= 20);

    // 2. Radiation hazard click rate at danger = 1.0
    geiger.reset();
    geiger.set_danger(1.0f);
    int radClicks = 0;
    for (int s = 0; s < 2; ++s) {
        geiger.generate(buf.data(), kSecSamples);
        for (int i = 1; i < kSecSamples; ++i) {
            if (buf[i] > 0.4f && buf[i - 1] <= 0.4f) {
                ++radClicks;
            }
        }
    }
    // High danger should generate hundreds of clicks per second
    CHECK(radClicks > 200);

    // 3. Radiation dose rate scaling at radDose = 500.0f
    geiger.reset();
    geiger.set_rad_dose(500.0f);
    int doseClicks = 0;
    for (int s = 0; s < 2; ++s) {
        geiger.generate(buf.data(), kSecSamples);
        for (int i = 1; i < kSecSamples; ++i) {
            if (buf[i] > 0.4f && buf[i - 1] <= 0.4f) {
                ++doseClicks;
            }
        }
    }
    CHECK(doseClicks > 100);

    // 4. Combined radiation hazard (danger + radDose)
    geiger.reset();
    geiger.set_radiation(0.8f, 250.0f);
    int combinedClicks = 0;
    for (int s = 0; s < 2; ++s) {
        geiger.generate(buf.data(), kSecSamples);
        for (int i = 1; i < kSecSamples; ++i) {
            if (buf[i] > 0.4f && buf[i - 1] <= 0.4f) {
                ++combinedClicks;
            }
        }
    }
    CHECK(combinedClicks > 200);

    // 5. Amplitude bounds: output must remain bounded within [-2.5, 2.5]
    for (float sample : buf) {
        CHECK(!std::isnan(sample));
        CHECK(!std::isinf(sample));
        CHECK(sample >= -2.5f && sample <= 2.5f);
    }
}

static void test_siren_c40_synth() {
    // 1. Motor glide mathematical trajectory
    float g0 = SirenSynth::evaluate_motor_glide(0.0f);
    float g1 = SirenSynth::evaluate_motor_glide(1.0f);
    float g2_5 = SirenSynth::evaluate_motor_glide(2.5f);
    float g4 = SirenSynth::evaluate_motor_glide(4.0f);
    float g6 = SirenSynth::evaluate_motor_glide(5.999f);

    CHECK(std::fabs(g0 - 0.0f) < 1e-4f);
    CHECK(g1 > g0); // Monotonic increase during spin-up
    CHECK(g2_5 > 0.99f); // Peaks at 2.5 s
    CHECK(g4 < g2_5); // Decreases during coast-down
    CHECK(g6 < g4);

    // 2. Frequency bounds and musical fifth ratio (1.503)
    float f1_min, f2_min, f1_max, f2_max;
    SirenSynth::compute_frequencies(0.0f, f1_min, f2_min);
    SirenSynth::compute_frequencies(2.5f, f1_max, f2_max);

    CHECK(std::fabs(f1_min - 220.0f) < 1.0f);
    CHECK(std::fabs(f1_max - 440.0f) < 5.0f);
    CHECK(std::fabs(f2_min / f1_min - 1.503f) < 1e-4f);
    CHECK(std::fabs(f2_max / f1_max - 1.503f) < 1e-4f);

    // 3. Audio generation and amplitude bounds
    SirenSynth siren;
    siren.set_active(true, 1.0f);
    std::vector<float> buf(kAudioBlockFrames);
    for (int i = 0; i < 50; ++i) {
        siren.generate(buf.data(), kAudioBlockFrames);
        for (float s : buf) {
            CHECK(!std::isnan(s));
            CHECK(!std::isinf(s));
            CHECK(s >= -1.5f && s <= 1.5f);
        }
    }
}

static void test_ambient_crt_grid_synth() {
    // 1. 50 Hz power grid flutter calculation
    float f0 = AmbientDroneSynth::evaluate_grid_flutter(0.0f);
    float f1 = AmbientDroneSynth::evaluate_grid_flutter(1.0f);
    CHECK(f0 >= 49.85f && f0 <= 50.15f);
    CHECK(f1 >= 49.85f && f1 <= 50.15f);

    // 2. Grid harmonics evaluation
    float harmonics[6]{};
    AmbientDroneSynth::compute_grid_harmonics(0.5f, harmonics);
    for (int k = 0; k < 6; ++k) {
        CHECK(!std::isnan(harmonics[k]));
        CHECK(std::fabs(harmonics[k]) <= 1.0f);
    }

    // 3. Audio stream generation with HUD brightness modulation
    AmbientDroneSynth ambient;
    ambient.set_hud_brightness(1.0f);
    ambient.set_grid_intensity(0.8f);

    std::vector<float> buf(kAudioBlockFrames);
    ambient.generate(buf.data(), kAudioBlockFrames);
    float maxBright = 0.0f;
    for (float s : buf) {
        if (std::fabs(s) > maxBright) maxBright = std::fabs(s);
    }
    CHECK(maxBright > 0.001f);

    // Dim HUD
    ambient.set_hud_brightness(0.0f);
    for (int i = 0; i < 20; ++i) {
        ambient.generate(buf.data(), kAudioBlockFrames);
    }
    float maxDim = 0.0f;
    for (float s : buf) {
        if (std::fabs(s) > maxDim) maxDim = std::fabs(s);
    }
    CHECK(maxDim > 0.0f);
    CHECK(maxDim < maxBright); // Bright HUD generates higher amplitude CRT coil whine
}

static void test_ui_sound_synth() {
    UiSynth ui;
    std::vector<float> buf(kAudioBlockFrames);

    // 1. Trigger KeyClick
    ui.trigger(UiSound::KeyClick);
    ui.generate(buf.data(), kAudioBlockFrames);
    float maxKey = 0.0f;
    for (float s : buf) {
        if (std::fabs(s) > maxKey) maxKey = std::fabs(s);
    }
    CHECK(maxKey > 0.05f);

    // 2. Trigger ErrorChirp
    ui.reset();
    ui.trigger(UiSound::ErrorChirp);
    ui.generate(buf.data(), kAudioBlockFrames);
    float maxChirp = 0.0f;
    for (float s : buf) {
        if (std::fabs(s) > maxChirp) maxChirp = std::fabs(s);
    }
    CHECK(maxChirp > 0.05f);

    // 3. Trigger InventoryRustle
    ui.reset();
    ui.trigger(UiSound::InventoryRustle);
    ui.generate(buf.data(), kAudioBlockFrames);
    float maxRustle = 0.0f;
    for (float s : buf) {
        if (std::fabs(s) > maxRustle) maxRustle = std::fabs(s);
    }
    CHECK(maxRustle > 0.02f);
}

static void test_3d_spatial_and_occlusion() {
    vec3 listenerPos{10.0f, 10.0f, 5.0f};
    float yaw = 0.0f;   // Facing +X
    float pitch = 0.0f;

    // 1. Direct ahead emitter (same height, 1.0 m away in +X)
    vec3 emitterAhead{11.0f, 10.0f, 5.0f};
    float gainL = 0.0f, gainR = 0.0f, dist = 0.0f;
    spatial_evaluate_geom(listenerPos, yaw, pitch, emitterAhead, gainL, gainR, dist);
    CHECK(std::fabs(dist - 1.0f) < 1e-4f);
    // Center pan: gainL == gainR == ~0.7071
    CHECK(std::fabs(gainL - gainR) < 1e-3f);
    CHECK(std::fabs(gainL * gainL + gainR * gainR - 1.0f) < 1e-3f); // Equal power

    // 2. Pure Left emitter (1.0 m in +Y, since facing +X means +Y is to the left)
    vec3 emitterLeft{10.0f, 11.0f, 5.0f};
    spatial_evaluate_geom(listenerPos, yaw, pitch, emitterLeft, gainL, gainR, dist);
    CHECK(gainL > 0.99f);
    CHECK(gainR < 0.05f);

    // 3. Pure Right emitter (1.0 m in -Y, since facing +X means -Y is to the right)
    vec3 emitterRight{10.0f, 9.0f, 5.0f};
    spatial_evaluate_geom(listenerPos, yaw, pitch, emitterRight, gainL, gainR, dist);
    CHECK(gainR > 0.99f);
    CHECK(gainL < 0.05f);

    // 4. Equal-Power Panning Law invariant across 360 degrees
    for (int deg = 0; deg < 360; deg += 15) {
        float rad = static_cast<float>(deg) * (kPi / 180.0f);
        vec3 p{listenerPos.x + std::cos(rad), listenerPos.y + std::sin(rad), listenerPos.z};
        spatial_evaluate_geom(listenerPos, yaw, pitch, p, gainL, gainR, dist);
        float power = gainL * gainL + gainR * gainR;
        CHECK(std::fabs(power - 1.0f) < 1e-3f);
    }

    // 5. Distance attenuation cutoff at 48 m
    vec3 emitterFar{10.0f + 50.0f, 10.0f, 5.0f};
    spatial_evaluate_geom(listenerPos, yaw, pitch, emitterFar, gainL, gainR, dist);
    CHECK(dist >= 48.0f);
    CHECK(gainL == 0.0f && gainR == 0.0f);

    // 6. Voxel occlusion analytical formula checks for N=0, 1, 2, 3 walls
    CHECK(compute_occlusion_cutoff(0) == 20000.0f);
    CHECK(std::fabs(compute_occlusion_cutoff(1) - (1100.0f / 2.6f)) < 1.0f); // ~423.08 Hz
    CHECK(std::fabs(compute_occlusion_cutoff(2) - (1100.0f / 4.2f)) < 1.0f); // ~261.90 Hz
    CHECK(std::fabs(compute_occlusion_cutoff(3) - (1100.0f / 5.8f)) < 1.0f); // ~189.66 Hz

    CHECK(compute_wall_attenuation(0) == 1.0f);
    CHECK(std::fabs(compute_wall_attenuation(1) - std::exp(-0.65f)) < 1e-4f); // ~0.522
    CHECK(std::fabs(compute_wall_attenuation(2) - std::exp(-1.30f)) < 1e-4f); // ~0.272
    CHECK(std::fabs(compute_wall_attenuation(3) - std::exp(-1.95f)) < 1e-4f); // ~0.142
}

static void test_audio_mixer_polyphony_and_limiting() {
    AudioMixer mixer;
    vec3 listenerPos{10.0f, 10.0f, 5.0f};

    // 1. Allocate 32 spatial voices simultaneously
    for (int i = 0; i < kMaxSpatialVoices; ++i) {
        vec3 emitterPos{listenerPos.x + 2.0f, listenerPos.y + static_cast<float>(i), listenerPos.z};
        int voiceId = mixer.play_spatial_sound(SoundId::Gunshot, emitterPos, 1.0f);
        CHECK(voiceId >= 0 && voiceId < kMaxSpatialVoices);
    }
    CHECK(mixer.active_voice_count() == kMaxSpatialVoices);

    // 2. Also enable all sub-synthesizers simultaneously at max intensity
    mixer.geiger().set_danger(1.0f);
    mixer.siren().set_active(true, 1.0f);
    mixer.ambient().set_hud_brightness(1.0f);
    mixer.ui().trigger(UiSound::ErrorChirp);

    // 3. Mix frames and verify non-clipping master limiting
    std::vector<float> stereo(kAudioBlockFrames * 2);
    for (int f = 0; f < 20; ++f) {
        mixer.mix_frames(stereo.data(), kAudioBlockFrames, listenerPos, 0.0f, 0.0f, nullptr);
        for (int i = 0; i < kAudioBlockFrames * 2; ++i) {
            float sample = stereo[i];
            CHECK(!std::isnan(sample));
            CHECK(!std::isinf(sample));
            // Master bus limiter strictly guarantees [-1.0, 1.0] output range
            CHECK(sample >= -1.0f && sample <= 1.0f);
        }
    }
}

} // namespace giga::audio

static void test_audio_all() {
    giga::audio::test_dsp_math_primitives();
    giga::audio::test_geiger_poisson_synth();
    giga::audio::test_siren_c40_synth();
    giga::audio::test_ambient_crt_grid_synth();
    giga::audio::test_ui_sound_synth();
    giga::audio::test_3d_spatial_and_occlusion();
    giga::audio::test_audio_mixer_polyphony_and_limiting();
    std::printf("[test] suite_audio: procedural DSP synthesis, 3D spatialization, and mixer limiting verified\n");
}

