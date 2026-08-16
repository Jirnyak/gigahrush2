// Geiger counter stochastic Poisson click generator implementation.
#include "audio/synth_geiger.h"
#include <algorithm>
#include <cmath>

namespace giga::audio {

GeigerSynth::GeigerSynth() {
    init_click_table();
    reset();
}

void GeigerSynth::init_click_table() {
    constexpr float f0 = 2950.0f;          // Resonant piezo frequency
    constexpr float tauRise = 0.00004f;    // 0.04 ms rise time
    constexpr float tauDecay = 0.00075f;   // 0.75 ms decay time
    float maxVal = 0.0f;

    for (int i = 0; i < kClickSamples; ++i) {
        float t = static_cast<float>(i) / kAudioSampleRate;
        float env = std::exp(-t / tauDecay) - std::exp(-t / tauRise);
        float s = env * std::sin(kTwoPi * f0 * t);
        clickTable_[i] = s;
        if (std::fabs(s) > maxVal) {
            maxVal = std::fabs(s);
        }
    }

    if (maxVal > 1e-6f) {
        float invMax = 1.0f / maxVal;
        for (int i = 0; i < kClickSamples; ++i) {
            clickTable_[i] *= invMax;
        }
    }
}

void GeigerSynth::reset() {
    danger_ = 0.0f;
    smoothDanger_ = 0.0f;
    deadTimeRemaining_ = 0;
    for (int i = 0; i < kMaxClicks; ++i) {
        clicks_[i].sampleIndex = -1;
        clicks_[i].amplitude = 1.0f;
    }
}

void GeigerSynth::set_danger(float danger) {
    danger_ = std::clamp(danger, 0.0f, 1.0f);
}

void GeigerSynth::generate(float* buffer, int numSamples) {
    // Inhomogeneous Poisson point process:
    // lambda(danger) = lambda0 + kRad * danger^2 (events / second)
    constexpr float lambda0 = 0.35f;    // Baseline background click rate
    constexpr float kRad = 850.0f;      // Maximum hazard radiation click rate
    constexpr float invSampleRate = 1.0f / kAudioSampleRate;

    for (int n = 0; n < numSamples; ++n) {
        // Smooth danger changes over time
        smoothDanger_ += 0.002f * (danger_ - smoothDanger_);
        float lambda = lambda0 + kRad * (smoothDanger_ * smoothDanger_);
        float pTrigger = lambda * invSampleRate;

        // Check GM tube dead-time saturation
        if (deadTimeRemaining_ > 0) {
            --deadTimeRemaining_;
        } else {
            float u = splitmix32_f01(rngState_);
            if (u < pTrigger) {
                // Trigger a new click discharge
                deadTimeRemaining_ = kDeadTimeSamples;

                // Find free slot or replace oldest
                int bestSlot = 0;
                int maxProgress = -1;
                for (int s = 0; s < kMaxClicks; ++s) {
                    if (clicks_[s].sampleIndex < 0) {
                        bestSlot = s;
                        break;
                    }
                    if (clicks_[s].sampleIndex > maxProgress) {
                        maxProgress = clicks_[s].sampleIndex;
                        bestSlot = s;
                    }
                }

                // Randomize click amplitude slightly for realistic tube discharge variations
                float ampJitter = 0.85f + 0.30f * splitmix32_f01(rngState_);
                clicks_[bestSlot].sampleIndex = 0;
                clicks_[bestSlot].amplitude = ampJitter;
            }
        }

        // Accumulate active clicks
        float sampleVal = 0.0f;
        for (int s = 0; s < kMaxClicks; ++s) {
            int idx = clicks_[s].sampleIndex;
            if (idx >= 0 && idx < kClickSamples) {
                sampleVal += clicks_[s].amplitude * clickTable_[idx];
                clicks_[s].sampleIndex = idx + 1;
                if (clicks_[s].sampleIndex >= kClickSamples) {
                    clicks_[s].sampleIndex = -1;
                }
            }
        }

        buffer[n] = sampleVal;
    }
}

} // namespace giga::audio
