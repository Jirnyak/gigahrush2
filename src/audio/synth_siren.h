// Samosbor C-40 civil defense siren procedural DSP generator.
// Dual-tone motor glide (220 -> 440 Hz + 1.503x fifth), asymmetric tanh overdrive, SVF throat resonance.
#pragma once

#include "audio/audio_types.h"
#include "audio/dsp_math.h"

namespace giga::audio {

class SirenSynth {
public:
    SirenSynth();

    void set_active(bool active, float intensity = 1.0f);
    bool is_active() const { return active_; }
    void generate(float* buffer, int numSamples);
    void reset();

    // Pure DSP evaluation for testing frequency bounds and waveform characteristics
    static float evaluate_motor_glide(float cycleTimeSec);
    static void compute_frequencies(float cycleTimeSec, float& outF1, float& outF2);

private:
    bool active_ = false;
    float intensity_ = 1.0f;
    float currentAmp_ = 0.0f;
    float cycleTime_ = 0.0f;
    float phase1_ = 0.0f;
    float phase2_ = 0.0f;
    StateVariableFilter hornFilter_;
};

} // namespace giga::audio
