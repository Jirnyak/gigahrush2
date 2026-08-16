// SECAM 15.625 kHz CRT flyback coil whine and 50 Hz Soviet power grid hum generator implementation.
#include "audio/synth_ambient.h"
#include <algorithm>
#include <cmath>

namespace giga::audio {

AmbientDroneSynth::AmbientDroneSynth() {
    reset();
}

void AmbientDroneSynth::reset() {
    hudBrightness_ = 1.0f;
    smoothHud_ = 1.0f;
    gridIntensity_ = 0.8f;
    smoothGrid_ = 0.8f;
    phaseCrt1_ = 0.0f;
    phaseCrt2_ = 0.0f;
    phaseCrt3_ = 0.0f;
    timeAccumSec_ = 0.0f;
    for (int i = 0; i < 6; ++i) {
        phaseHum_[i] = 0.0f;
    }
}

void AmbientDroneSynth::set_hud_brightness(float brightness) {
    hudBrightness_ = std::clamp(brightness, 0.0f, 1.0f);
}

void AmbientDroneSynth::set_grid_intensity(float intensity) {
    gridIntensity_ = std::clamp(intensity, 0.0f, 1.0f);
}

float AmbientDroneSynth::evaluate_grid_flutter(float timeSec) {
    // Unstable industrial generator load frequency flutter: 50 Hz +- 0.12 Hz at 0.15 Hz LFO
    return 50.0f + 0.12f * std::sin(kTwoPi * 0.15f * timeSec);
}

void AmbientDroneSynth::compute_grid_harmonics(float timeSec, float* outHarmonics6) {
    float fBase = evaluate_grid_flutter(timeSec);
    constexpr float kAmps[6] = {0.40f, 0.75f, 0.35f, 0.15f, 0.20f, 0.08f};
    for (int k = 0; k < 6; ++k) {
        float f = fBase * static_cast<float>(k + 1);
        outHarmonics6[k] = kAmps[k] * std::sin(kTwoPi * f * timeSec);
    }
}

void AmbientDroneSynth::generate(float* buffer, int numSamples) {
    constexpr float invSampleRate = 1.0f / kAudioSampleRate;
    constexpr float kCrtFreq1 = 15625.0f;
    constexpr float kCrtFreq2 = 7812.5f;
    constexpr float kCrtFreq3 = 3906.25f;

    constexpr float kHarmonicAmps[6] = {0.40f, 0.75f, 0.35f, 0.15f, 0.20f, 0.08f};

    for (int n = 0; n < numSamples; ++n) {
        // Smooth parameter changes
        smoothHud_ += 0.005f * (hudBrightness_ - smoothHud_);
        smoothGrid_ += 0.005f * (gridIntensity_ - smoothGrid_);

        timeAccumSec_ += invSampleRate;
        if (timeAccumSec_ >= 1000.0f) {
            timeAccumSec_ -= 1000.0f;
        }

        // 1. CRT Flyback Coil Whine
        phaseCrt1_ = wrap_phase(phaseCrt1_ + kTwoPi * kCrtFreq1 * invSampleRate);
        phaseCrt2_ = wrap_phase(phaseCrt2_ + kTwoPi * kCrtFreq2 * invSampleRate);
        phaseCrt3_ = wrap_phase(phaseCrt3_ + kTwoPi * kCrtFreq3 * invSampleRate);

        float crtSignal = 0.70f * std::sin(phaseCrt1_) +
                          0.20f * std::sin(phaseCrt2_) +
                          0.10f * std::sin(phaseCrt3_);
        float crtAmp = (0.015f + 0.035f * smoothHud_);
        float crtOut = crtSignal * crtAmp;

        // 2. 50 Hz Soviet Power Grid Hum
        float fGrid = evaluate_grid_flutter(timeAccumSec_);
        float humSum = 0.0f;
        for (int k = 0; k < 6; ++k) {
            float fHarmonic = fGrid * static_cast<float>(k + 1);
            phaseHum_[k] = wrap_phase(phaseHum_[k] + kTwoPi * fHarmonic * invSampleRate);
            humSum += kHarmonicAmps[k] * std::sin(phaseHum_[k]);
        }
        float gridAmp = 0.030f * smoothGrid_;
        float humOut = humSum * gridAmp;

        buffer[n] = crtOut + humOut;
    }
}

} // namespace giga::audio
