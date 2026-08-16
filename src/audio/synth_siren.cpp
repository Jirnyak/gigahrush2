// Samosbor C-40 civil defense siren procedural DSP generator implementation.
#include "audio/synth_siren.h"
#include <algorithm>
#include <cmath>

namespace giga::audio {

SirenSynth::SirenSynth() {
    reset();
}

void SirenSynth::reset() {
    active_ = false;
    intensity_ = 1.0f;
    currentAmp_ = 0.0f;
    cycleTime_ = 0.0f;
    phase1_ = 0.0f;
    phase2_ = 0.0f;
    hornFilter_.reset();
    hornFilter_.set_params(1450.0f, 2.2f, kAudioSampleRate);
}

void SirenSynth::set_active(bool active, float intensity) {
    active_ = active;
    intensity_ = std::clamp(intensity, 0.0f, 1.0f);
}

float SirenSynth::evaluate_motor_glide(float cycleTimeSec) {
    float t = std::fmod(cycleTimeSec, 6.0f);
    if (t < 0.0f) t += 6.0f;
    if (t < 2.5f) {
        // Spin-up phase: g(t) = 1 - exp(-2.2 * t)
        return 1.0f - std::exp(-2.2f * t);
    } else {
        // Coast-down phase: g(t) = exp(-1.1 * (t - 2.5))
        return std::exp(-1.1f * (t - 2.5f));
    }
}

void SirenSynth::compute_frequencies(float cycleTimeSec, float& outF1, float& outF2) {
    float g = evaluate_motor_glide(cycleTimeSec);
    outF1 = 220.0f + (440.0f - 220.0f) * g;
    outF2 = outF1 * 1.503f; // Acoustic fifth with 0.3% detune
}

void SirenSynth::generate(float* buffer, int numSamples) {
    constexpr float invSampleRate = 1.0f / kAudioSampleRate;
    float targetAmp = active_ ? intensity_ : 0.0f;

    for (int n = 0; n < numSamples; ++n) {
        // Smooth amplitude attack and release envelope
        if (currentAmp_ < targetAmp) {
            currentAmp_ = std::min(targetAmp, currentAmp_ + 0.0001f);
        } else if (currentAmp_ > targetAmp) {
            currentAmp_ = std::max(targetAmp, currentAmp_ - 0.00005f);
        }

        if (currentAmp_ <= 1e-6f && !active_) {
            buffer[n] = 0.0f;
            continue;
        }

        // Advance cycle timer
        cycleTime_ += invSampleRate;
        if (cycleTime_ >= 6.0f) {
            cycleTime_ -= 6.0f;
        }

        float f1, f2;
        compute_frequencies(cycleTime_, f1, f2);

        // Advance oscillator phases
        phase1_ = wrap_phase(phase1_ + kTwoPi * f1 * invSampleRate);
        phase2_ = wrap_phase(phase2_ + kTwoPi * f2 * invSampleRate);

        // Sawtooth generation
        float saw1 = 2.0f * (phase1_ * (1.0f / kTwoPi)) - 1.0f;
        float saw2 = 2.0f * (phase2_ * (1.0f / kTwoPi)) - 1.0f;
        float rawSignal = 0.6f * saw1 + 0.4f * saw2;

        // Asymmetric tanh horn overdrive saturation
        float distSignal = fast_tanh(2.8f * rawSignal + 0.35f * rawSignal * rawSignal);

        // Horn throat resonance filter (1450 Hz, Q = 2.2)
        float resonantSignal = hornFilter_.process_bp(distSignal);

        // Blended acoustic horn output
        float finalSample = (0.45f * distSignal + 0.55f * resonantSignal) * currentAmp_;
        buffer[n] = finalSample;
    }
}

} // namespace giga::audio
