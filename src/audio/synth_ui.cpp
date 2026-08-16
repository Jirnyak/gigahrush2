// Procedural UI sound synthesizer implementation.
#include "audio/synth_ui.h"
#include <algorithm>
#include <cmath>

namespace giga::audio {

UiSynth::UiSynth() {
    reset();
}

void UiSynth::reset() {
    for (int i = 0; i < kMaxActiveUiSounds; ++i) {
        active_[i].type = UiSound::None;
        active_[i].ageSamples = 0;
        active_[i].totalSamples = 0;
        active_[i].phaseA = 0.0f;
        active_[i].phaseB = 0.0f;
        active_[i].rng = 0x900dcafeu + static_cast<uint32_t>(i * 31);
        active_[i].filter.reset();
        active_[i].lpFilter.reset();
    }
}

void UiSynth::trigger(UiSound sound) {
    if (sound == UiSound::None) return;

    // Find free slot or replace oldest
    int bestSlot = 0;
    int maxAge = -1;
    for (int i = 0; i < kMaxActiveUiSounds; ++i) {
        if (active_[i].type == UiSound::None) {
            bestSlot = i;
            break;
        }
        if (active_[i].ageSamples > maxAge) {
            maxAge = active_[i].ageSamples;
            bestSlot = i;
        }
    }

    ActiveUiSound& slot = active_[bestSlot];
    slot.type = sound;
    slot.ageSamples = 0;
    slot.phaseA = 0.0f;
    slot.phaseB = 0.0f;
    slot.rng = splitmix32(globalRng_);
    slot.filter.reset();
    slot.lpFilter.reset();

    switch (sound) {
    case UiSound::KeyClick:
        slot.totalSamples = 576; // 12 ms at 48 kHz
        slot.filter.set_params(4500.0f, 1.5f, kAudioSampleRate);
        break;
    case UiSound::ErrorChirp:
        slot.totalSamples = 4320; // 90 ms at 48 kHz
        slot.lpFilter.set_cutoff(2500.0f, kAudioSampleRate);
        break;
    case UiSound::InventoryRustle:
        slot.totalSamples = 960; // 20 ms at 48 kHz
        slot.filter.set_params(1800.0f, 2.0f, kAudioSampleRate);
        break;
    default:
        slot.type = UiSound::None;
        break;
    }
}

void UiSynth::process_key_click(ActiveUiSound& snd, float& outSample) {
    // Soviet DVK Solenoid:
    // Component 1: Damped sine ping f = 2200 Hz, tau = 1.8 ms
    // Component 2: Contact bounce noise through 4.5 kHz BP filter, tau = 0.9 ms
    float t = static_cast<float>(snd.ageSamples) / kAudioSampleRate;
    constexpr float fKey = 2200.0f;
    constexpr float tauPing = 0.0018f;
    constexpr float tauNoise = 0.0009f;

    float envPing = std::exp(-t / tauPing);
    float ping = envPing * std::sin(kTwoPi * fKey * t);

    float rawNoise = splitmix32_fsym(snd.rng);
    float envNoise = std::exp(-t / tauNoise);
    float filteredNoise = snd.filter.process_bp(rawNoise) * envNoise;

    outSample = 0.65f * ping + 0.45f * filteredNoise;
}

void UiSynth::process_error_chirp(ActiveUiSound& snd, float& outSample) {
    // Tritone Rejection Chirp:
    // Tone A: 440 -> 180 Hz over 90 ms
    // Tone B: 622 -> 254 Hz over 90 ms (tritone interval)
    float progress = static_cast<float>(snd.ageSamples) / static_cast<float>(snd.totalSamples);
    progress = std::clamp(progress, 0.0f, 1.0f);

    float fA = lerp(440.0f, 180.0f, progress);
    float fB = lerp(622.0f, 254.0f, progress);

    constexpr float invSampleRate = 1.0f / kAudioSampleRate;
    snd.phaseA = wrap_phase(snd.phaseA + kTwoPi * fA * invSampleRate);
    snd.phaseB = wrap_phase(snd.phaseB + kTwoPi * fB * invSampleRate);

    // Square wave pair
    float sqA = (snd.phaseA < kPi) ? 0.6f : -0.6f;
    float sqB = (snd.phaseB < kPi) ? 0.4f : -0.4f;
    float rawMix = sqA + sqB;

    // Filter high-frequency edge harshness
    float filtered = snd.lpFilter.process(rawMix);

    // Linear release envelope at the end (last 720 samples = 15 ms)
    int samplesLeft = snd.totalSamples - snd.ageSamples;
    float env = 1.0f;
    if (samplesLeft < 720) {
        env = static_cast<float>(samplesLeft) / 720.0f;
    }

    outSample = filtered * env * 0.45f;
}

void UiSynth::process_inventory_rustle(ActiveUiSound& snd, float& outSample) {
    // Granular pink noise fabric rustle:
    // 3 micro-grains (384 samples each, spaced 192 samples apart)
    int grainOffsets[3] = {0, 192, 384};
    constexpr int kGrainLen = 384;
    float grainSum = 0.0f;

    for (int g = 0; g < 3; ++g) {
        int grainLocalAge = snd.ageSamples - grainOffsets[g];
        if (grainLocalAge >= 0 && grainLocalAge < kGrainLen) {
            float grainNorm = static_cast<float>(grainLocalAge) / static_cast<float>(kGrainLen);
            // Hann envelope for each micro-grain
            float grainEnv = 0.5f * (1.0f - std::cos(kTwoPi * grainNorm));
            float rawGrainNoise = splitmix32_fsym(snd.rng);
            grainSum += rawGrainNoise * grainEnv;
        }
    }

    // Resonant bandpass filter at 1800 Hz
    float filteredGrain = snd.filter.process_bp(grainSum);
    outSample = filteredGrain * 0.55f;
}

void UiSynth::generate(float* buffer, int numSamples) {
    for (int n = 0; n < numSamples; ++n) {
        float mixVal = 0.0f;
        for (int i = 0; i < kMaxActiveUiSounds; ++i) {
            ActiveUiSound& slot = active_[i];
            if (slot.type == UiSound::None) continue;

            float sample = 0.0f;
            switch (slot.type) {
            case UiSound::KeyClick:
                process_key_click(slot, sample);
                break;
            case UiSound::ErrorChirp:
                process_error_chirp(slot, sample);
                break;
            case UiSound::InventoryRustle:
                process_inventory_rustle(slot, sample);
                break;
            default:
                break;
            }

            mixVal += sample;
            ++slot.ageSamples;
            if (slot.ageSamples >= slot.totalSamples) {
                slot.type = UiSound::None;
            }
        }

        buffer[n] = mixVal;
    }
}

} // namespace giga::audio
