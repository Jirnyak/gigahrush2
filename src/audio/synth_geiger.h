// Geiger counter stochastic Poisson click generator (Soviet STS-5 / SBM-20 model).
// Modulated by radiation/danger field with ionization dead-time saturation.
#pragma once

#include <cstdint>
#include "audio/audio_types.h"
#include "audio/dsp_math.h"

namespace giga::audio {

class GeigerSynth {
public:
    static constexpr int kClickSamples = 192;   // ~4.0 ms discharge duration
    static constexpr int kMaxClicks = 16;       // Concurrent click polyphony
    static constexpr int kDeadTimeSamples = 8;  // ~160 us GM tube dead-time

    GeigerSynth();

    void set_danger(float danger);
    float get_danger() const { return danger_; }
    void generate(float* buffer, int numSamples);
    void reset();

private:
    struct ActiveClick {
        int sampleIndex = -1; // -1 = inactive
        float amplitude = 1.0f;
    };

    float danger_ = 0.0f;
    float smoothDanger_ = 0.0f;
    uint32_t rngState_ = 0x1337beefu;
    int deadTimeRemaining_ = 0;
    ActiveClick clicks_[kMaxClicks]{};
    float clickTable_[kClickSamples]{};

    void init_click_table();
};

} // namespace giga::audio
