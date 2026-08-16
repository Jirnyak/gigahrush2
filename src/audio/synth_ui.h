// Procedural UI sound synthesizer (Soviet DVK solenoid key clicks, tritone rejection chirp, canvas rustle).
#pragma once

#include <cstdint>
#include "audio/audio_types.h"
#include "audio/dsp_math.h"

namespace giga::audio {

class UiSynth {
public:
    static constexpr int kMaxActiveUiSounds = 8;

    UiSynth();

    void trigger(UiSound sound);
    void generate(float* buffer, int numSamples);
    void reset();

private:
    struct ActiveUiSound {
        UiSound type = UiSound::None;
        int ageSamples = 0;
        int totalSamples = 0;
        float phaseA = 0.0f;
        float phaseB = 0.0f;
        uint32_t rng = 0x900dcafeu;
        StateVariableFilter filter;
        OnePoleLp lpFilter;
    };

    ActiveUiSound active_[kMaxActiveUiSounds]{};
    uint32_t globalRng_ = 0xabcdef12u;

    void process_key_click(ActiveUiSound& snd, float& outSample);
    void process_error_chirp(ActiveUiSound& snd, float& outSample);
    void process_inventory_rustle(ActiveUiSound& snd, float& outSample);
};

} // namespace giga::audio
