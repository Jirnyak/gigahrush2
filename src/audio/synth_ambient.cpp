// SECAM 15.625 kHz CRT flyback coil whine, 100 Hz Soviet fluorescent ballast hum with starter crackle,
// and low-frequency subterranean megastructure rumble / pipe resonance implementation.
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
    crackleRng_ = 0xbeefcafeu;
    crackleEnv_ = 0.0f;
    crackleFilter_.reset();
    crackleFilter_.set_params(3800.0f, 2.5f, kAudioSampleRate);

    phaseRumble1_ = 0.0f;
    phaseRumble2_ = 0.0f;
    phasePipe1_ = 0.0f;
    phasePipe2_ = 0.0f;
    rumbleFilter_.reset();
    rumbleFilter_.set_cutoff(55.0f, kAudioSampleRate);
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
    // Dominant 100 Hz fluorescent ballast / rectified arc hum (k=1 is 100 Hz)
    constexpr float kAmps[6] = {0.40f, 0.75f, 0.35f, 0.15f, 0.20f, 0.08f};
    for (int k = 0; k < 6; ++k) {
        float f = fBase * static_cast<float>(k + 1);
        outHarmonics6[k] = kAmps[k] * std::sin(kTwoPi * f * timeSec);
    }
}

float AmbientDroneSynth::evaluate_fluorescent_hum(float timeSec) {
    float fGrid = evaluate_grid_flutter(timeSec);
    float hum100 = 0.75f * std::sin(kTwoPi * (2.0f * fGrid) * timeSec);
    float hum300 = 0.20f * std::sin(kTwoPi * (6.0f * fGrid) * timeSec);
    return hum100 + hum300;
}

float AmbientDroneSynth::evaluate_subterranean_rumble(float timeSec) {
    float r1 = std::sin(kTwoPi * 22.5f * timeSec) * (0.5f + 0.5f * std::sin(kTwoPi * 0.07f * timeSec));
    float r2 = std::sin(kTwoPi * 33.7f * timeSec) * (0.5f + 0.5f * std::sin(kTwoPi * 0.11f * timeSec));
    return 0.6f * r1 + 0.4f * r2;
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

        // 2. 50 Hz Soviet Power Grid & 100 Hz Fluorescent Ballast Hum
        float fGrid = evaluate_grid_flutter(timeAccumSec_);
        float humSum = 0.0f;
        for (int k = 0; k < 6; ++k) {
            float fHarmonic = fGrid * static_cast<float>(k + 1);
            phaseHum_[k] = wrap_phase(phaseHum_[k] + kTwoPi * fHarmonic * invSampleRate);
            humSum += kHarmonicAmps[k] * std::sin(phaseHum_[k]);
        }

        // Fluorescent Starter Flicker Crackle (Poisson stochastic pulse)
        if (crackleEnv_ > 0.001f) {
            crackleEnv_ *= 0.9985f; // Exponential decay ~3 ms tau
        } else {
            float u = splitmix32_f01(crackleRng_);
            if (u < 0.00018f) { // Occasional starter relay ionization pop
                crackleEnv_ = 0.8f + 0.4f * splitmix32_f01(crackleRng_);
            }
        }
        float rawCrackle = splitmix32_fsym(crackleRng_);
        float filteredCrackle = crackleFilter_.process_bp(rawCrackle) * crackleEnv_;

        float gridAmp = 0.030f * smoothGrid_;
        float humOut = (humSum + 0.35f * filteredCrackle) * gridAmp;

        // 3. Subterranean Megastructure Infrasound & Pipe Resonance
        phaseRumble1_ = wrap_phase(phaseRumble1_ + kTwoPi * 22.5f * invSampleRate);
        phaseRumble2_ = wrap_phase(phaseRumble2_ + kTwoPi * 33.7f * invSampleRate);
        float lfo1 = 0.5f + 0.5f * std::sin(kTwoPi * 0.07f * timeAccumSec_);
        float lfo2 = 0.5f + 0.5f * std::sin(kTwoPi * 0.11f * timeAccumSec_);
        float rawRumble = (std::sin(phaseRumble1_) * lfo1 + std::sin(phaseRumble2_) * lfo2);
        float rumbleFiltered = rumbleFilter_.process(rawRumble);

        phasePipe1_ = wrap_phase(phasePipe1_ + kTwoPi * 114.0f * invSampleRate);
        phasePipe2_ = wrap_phase(phasePipe2_ + kTwoPi * 162.0f * invSampleRate);
        float pipeSum = 0.5f * std::sin(phasePipe1_) + 0.5f * std::sin(phasePipe2_);

        float megastructureOut = (0.012f * rumbleFiltered + 0.008f * pipeSum) * smoothGrid_;

        buffer[n] = crtOut + humOut + megastructureOut;
    }
}

} // namespace giga::audio
