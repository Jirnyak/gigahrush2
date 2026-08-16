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
    radDose_ = 0.0f;
    smoothDanger_ = 0.0f;
    smoothRadDose_ = 0.0f;
    deadTimeRemaining_ = 0;
    for (int i = 0; i < kMaxClicks; ++i) {
        clicks_[i].sampleIndex = -1.0f;
        clicks_[i].pitchRate = 1.0f;
        clicks_[i].amplitude = 1.0f;
    }
}

void GeigerSynth::set_danger(float danger) {
    danger_ = std::clamp(danger, 0.0f, 1.0f);
}

void GeigerSynth::set_rad_dose(float radDose) {
    radDose_ = std::max(0.0f, radDose);
}

void GeigerSynth::set_radiation(float danger, float radDose) {
    danger_ = std::clamp(danger, 0.0f, 1.0f);
    radDose_ = std::max(0.0f, radDose);
}

void GeigerSynth::generate(float* buffer, int numSamples) {
    // Inhomogeneous Poisson point process:
    // lambda(effectiveHazard) = lambda0 + kRad * effectiveHazard^2 (events / second)
    constexpr float lambda0 = 0.35f;    // Baseline background click rate
    constexpr float kRad = 850.0f;      // Maximum hazard radiation click rate
    constexpr float invSampleRate = 1.0f / kAudioSampleRate;

    for (int n = 0; n < numSamples; ++n) {
        // Smooth danger and radDose changes over time
        smoothDanger_ += 0.002f * (danger_ - smoothDanger_);
        smoothRadDose_ += 0.002f * (radDose_ - smoothRadDose_);

        // Normalized radiation dose factor (250-500 mSv is significant exposure)
        float doseFactor = std::clamp(smoothRadDose_ / 500.0f, 0.0f, 1.0f);
        float effectiveHazard = std::clamp(smoothDanger_ + 0.5f * doseFactor, 0.0f, 1.0f);

        float lambda = lambda0 + kRad * (effectiveHazard * effectiveHazard);
        float pTrigger = lambda * invSampleRate;

        // Dynamic pitch scaling: higher radiation dose rate shifts ionization frequency up (0.90x -> 1.45x)
        float basePitch = 0.90f + 0.40f * effectiveHazard + 0.15f * doseFactor;

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
                float maxProgress = -1.0f;
                for (int s = 0; s < kMaxClicks; ++s) {
                    if (clicks_[s].sampleIndex < 0.0f) {
                        bestSlot = s;
                        break;
                    }
                    if (clicks_[s].sampleIndex > maxProgress) {
                        maxProgress = clicks_[s].sampleIndex;
                        bestSlot = s;
                    }
                }

                // Randomize click amplitude and pitch slightly for realistic tube discharge variations
                float ampJitter = 0.85f + 0.30f * splitmix32_f01(rngState_);
                float pitchJitter = basePitch * (0.96f + 0.08f * splitmix32_f01(rngState_));

                clicks_[bestSlot].sampleIndex = 0.0f;
                clicks_[bestSlot].pitchRate = pitchJitter;
                clicks_[bestSlot].amplitude = ampJitter;
            }
        }

        // Accumulate active clicks with sub-sample linear interpolation for dynamic pitch scaling
        float sampleVal = 0.0f;
        for (int s = 0; s < kMaxClicks; ++s) {
            float idx = clicks_[s].sampleIndex;
            if (idx >= 0.0f && idx < static_cast<float>(kClickSamples - 1)) {
                int i0 = static_cast<int>(idx);
                float frac = idx - static_cast<float>(i0);
                float clickSample = (1.0f - frac) * clickTable_[i0] + frac * clickTable_[i0 + 1];
                sampleVal += clicks_[s].amplitude * clickSample;
                clicks_[s].sampleIndex = idx + clicks_[s].pitchRate;
                if (clicks_[s].sampleIndex >= static_cast<float>(kClickSamples - 1)) {
                    clicks_[s].sampleIndex = -1.0f;
                }
            }
        }

        buffer[n] = sampleVal;
    }
}

} // namespace giga::audio
