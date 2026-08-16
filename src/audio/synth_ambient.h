// SECAM 15.625 kHz CRT flyback coil whine and 50 Hz Soviet power grid hum generator.
#pragma once

#include "audio/audio_types.h"
#include "audio/dsp_math.h"

namespace giga::audio {

class AmbientDroneSynth {
public:
    AmbientDroneSynth();

    void set_hud_brightness(float brightness);
    void set_grid_intensity(float intensity);
    void generate(float* buffer, int numSamples);
    void reset();

    // Pure DSP inspection helpers for unit testing
    static float evaluate_grid_flutter(float timeSec);
    static void compute_grid_harmonics(float timeSec, float* outHarmonics6);

private:
    float hudBrightness_ = 1.0f;
    float smoothHud_ = 1.0f;
    float gridIntensity_ = 0.8f;
    float smoothGrid_ = 0.8f;

    // Oscillator phases
    float phaseCrt1_ = 0.0f; // 15625 Hz
    float phaseCrt2_ = 0.0f; // 7812.5 Hz
    float phaseCrt3_ = 0.0f; // 3906.25 Hz

    float timeAccumSec_ = 0.0f;
    float phaseHum_[6]{};    // Harmonics 1..6 (50, 100, 150, 200, 250, 300 Hz)
};

} // namespace giga::audio
