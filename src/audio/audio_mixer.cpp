// Polyphonic 32-Voice Audio Mixer Pool & Master Bus Limiter implementation.
#include "audio/audio_mixer.h"
#include "audio/spatial_audio.h"
#include <algorithm>
#include <cmath>

namespace giga::audio {

AudioMixer::AudioMixer() {
    reset();
}

void AudioMixer::reset() {
    for (int i = 0; i < kMaxSpatialVoices; ++i) {
        voices_[i].active = false;
        voices_[i].sound = SoundId::None;
        voices_[i].ageSamples = 0;
        voices_[i].totalSamples = 0;
        voices_[i].lpStateL = 0.0f;
        voices_[i].lpStateR = 0.0f;
    }
    geiger_.reset();
    siren_.reset();
    ambient_.reset();
    ui_.reset();
}

int AudioMixer::active_voice_count() const {
    int count = 0;
    for (int i = 0; i < kMaxSpatialVoices; ++i) {
        if (voices_[i].active) {
            ++count;
        }
    }
    return count;
}

int AudioMixer::play_spatial_sound(SoundId sound, const vec3& pos, float gain,
                                   float refDist, float maxDist) {
    if (sound == SoundId::None || gain <= 1e-4f) return -1;

    // Find free slot or replace highest age
    int bestSlot = 0;
    int maxAge = -1;
    for (int i = 0; i < kMaxSpatialVoices; ++i) {
        if (!voices_[i].active) {
            bestSlot = i;
            break;
        }
        if (static_cast<int>(voices_[i].ageSamples) > maxAge) {
            maxAge = static_cast<int>(voices_[i].ageSamples);
            bestSlot = i;
        }
    }

    SpatialVoice& v = voices_[bestSlot];
    v.pos = pos;
    v.gain = gain;
    v.refDist = refDist;
    v.maxDist = maxDist;
    v.rolloff = 1.0f;
    v.sound = sound;
    v.active = true;
    v.ageSamples = 0;
    v.seed = splitmix32(mixerRng_);
    v.lpStateL = 0.0f;
    v.lpStateR = 0.0f;
    v.currentGainL = 1.0f;
    v.currentGainR = 1.0f;
    v.currentCutoff = 20000.0f;

    // Артистский сэмпл диктует длительность сам ([audio_types.h] SampleBank);
    // синтезу — авторские длительности ниже.
    if (bank_) {
        const SampleData& sd = bank_->bySound[static_cast<int>(sound)];
        if (sd.data && sd.frames > 0) {
            v.totalSamples = sd.frames;
            return bestSlot;
        }
    }
    // Total sample duration per sound type
    switch (sound) {
    case SoundId::Gunshot:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.18f); // 180 ms
        break;
    case SoundId::Explosion:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.55f); // 550 ms
        break;
    case SoundId::MeleeHit:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.08f); // 80 ms
        break;
    case SoundId::Footstep:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.045f); // 45 ms
        break;
    case SoundId::DoorMove:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.28f); // 280 ms
        break;
    case SoundId::ContainerOpen:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.16f); // 160 ms
        break;
    case SoundId::BodyFall:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.14f); // 140 ms
        break;
    case SoundId::MonsterGrowl:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.35f); // 350 ms
        break;
    case SoundId::ElectricSpark:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.06f); // 60 ms
        break;
    case SoundId::ItemPickup:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.09f); // 90 ms
        break;
    default:
        v.totalSamples = static_cast<uint32_t>(kAudioSampleRate * 0.10f);
        break;
    }

    return bestSlot;
}

void AudioMixer::synthesize_spatial_voice_sample(SpatialVoice& v, float& outMono) {
    // Артистский сэмпл побеждает синтез — та же политика, что у текстур
    // ([audio_types.h] SampleBank). Длину голосу выставил trigger.
    if (bank_) {
        const SampleData& sd = bank_->bySound[static_cast<int>(v.sound)];
        if (sd.data) {
            outMono = (v.ageSamples < sd.frames) ? sd.data[v.ageSamples]
                                                 : 0.0f;
            return;
        }
    }
    float t = static_cast<float>(v.ageSamples) / kAudioSampleRate;
    float progress = static_cast<float>(v.ageSamples) / static_cast<float>(std::max(v.totalSamples, 1u));
    progress = std::clamp(progress, 0.0f, 1.0f);

    float s = 0.0f;
    switch (v.sound) {
    case SoundId::Gunshot: {
        // Sharp transient pulse + decaying white noise + sub thud
        float pulse = std::exp(-t / 0.003f) * std::sin(kTwoPi * 180.0f * t);
        float noise = splitmix32_fsym(v.seed) * std::exp(-t / 0.040f);
        float body = std::exp(-t / 0.080f) * std::sin(kTwoPi * 90.0f * t);
        s = 0.6f * pulse + 0.5f * noise + 0.4f * body;
        break;
    }
    case SoundId::Explosion: {
        // Deep sub-bass boom + heavy decaying granular rumble
        float fBoom = lerp(80.0f, 35.0f, progress);
        float boom = std::exp(-t / 0.25f) * std::sin(kTwoPi * fBoom * t);
        float noise = splitmix32_fsym(v.seed) * std::exp(-t / 0.18f);
        s = 0.7f * boom + 0.6f * noise;
        break;
    }
    case SoundId::MeleeHit: {
        // Metallic impact crack + short ring
        float crack = std::exp(-t / 0.005f) * splitmix32_fsym(v.seed);
        float ping = std::exp(-t / 0.025f) * std::sin(kTwoPi * 1100.0f * t);
        s = 0.7f * crack + 0.4f * ping;
        break;
    }
    case SoundId::Footstep: {
        // Low concrete tap + subtle scuff
        float tap = std::exp(-t / 0.008f) * std::sin(kTwoPi * 120.0f * t);
        float scuff = std::exp(-t / 0.012f) * splitmix32_fsym(v.seed);
        s = 0.5f * tap + 0.3f * scuff;
        break;
    }
    case SoundId::DoorMove: {
        // Soviet Hermetic Blast Door:
        // 1. Heavy mechanical gear/hinge friction
        float grind = splitmix32_fsym(v.seed) * std::sin(kTwoPi * 320.0f * t) * std::sin(kPi * progress);
        // 2. High-pressure pneumatic seal hiss (air-lock decompression / rubber gasket seat equalization)
        float rawNoise = splitmix32_fsym(v.seed);
        float envHiss = std::exp(-t / 0.055f) + 0.6f * std::exp(-std::fabs(t - 0.16f) / 0.025f);
        float hiss = rawNoise * std::sin(kTwoPi * 3400.0f * t) * envHiss;
        // 3. Heavy steel locking dog / latch impact clack
        float envLatch = std::exp(-std::fabs(t - 0.20f) / 0.008f);
        float latch = std::sin(kTwoPi * 780.0f * t) * envLatch;
        s = 0.40f * grind + 0.38f * hiss + 0.42f * latch;
        break;
    }
    case SoundId::ContainerOpen: {
        // Latch release click + resonance
        float click = std::exp(-t / 0.006f) * std::sin(kTwoPi * 1400.0f * t);
        float creak = std::sin(kTwoPi * (400.0f + 300.0f * progress) * t) * (1.0f - progress);
        s = 0.6f * click + 0.3f * creak;
        break;
    }
    case SoundId::BodyFall: {
        // Dull heavy impact
        float thud = std::exp(-t / 0.045f) * std::sin(kTwoPi * 65.0f * t);
        float rustle = std::exp(-t / 0.030f) * splitmix32_fsym(v.seed);
        s = 0.65f * thud + 0.35f * rustle;
        break;
    }
    case SoundId::MonsterGrowl: {
        // Low-frequency modulated roar / growl
        float mod = 1.0f + 0.4f * std::sin(kTwoPi * 35.0f * t);
        float voice = std::sin(kTwoPi * (110.0f + 20.0f * std::sin(kTwoPi * 7.0f * t)) * t) * mod;
        float dist = fast_tanh(1.8f * voice);
        float env = std::sin(kPi * progress);
        s = 0.6f * dist * env;
        break;
    }
    case SoundId::ElectricSpark: {
        // High voltage crackle zap
        float zap = splitmix32_fsym(v.seed) * std::sin(kTwoPi * 3600.0f * t);
        float env = std::exp(-t / 0.015f);
        s = 0.7f * zap * env;
        break;
    }
    case SoundId::ItemPickup: {
        // High pleasant dual chime chirp
        float fChime = lerp(880.0f, 1320.0f, progress);
        float chime = std::sin(kTwoPi * fChime * t) * (1.0f - progress);
        s = 0.5f * chime;
        break;
    }
    default:
        s = 0.0f;
        break;
    }

    outMono = s * v.gain;
}

void AudioMixer::mix_frames(float* outStereo, int numFrames,
                            const vec3& listenerPos, float listenerYaw, float listenerPitch,
                            const MacroGrid* grid) {
    if (!config_.enabled || numFrames <= 0) {
        std::fill_n(outStereo, numFrames * 2, 0.0f);
        return;
    }

    int framesToProcess = std::min(numFrames, kAudioBlockFrames);

    // 1. Generate sub-synthesizer buffers
    geiger_.generate(geigerBuf_, framesToProcess);
    siren_.generate(sirenBuf_, framesToProcess);
    ambient_.generate(ambientBuf_, framesToProcess);
    ui_.generate(uiBuf_, framesToProcess);

    // 2. Evaluate spatial parameters for each active voice
    for (int vIdx = 0; vIdx < kMaxSpatialVoices; ++vIdx) {
        SpatialVoice& v = voices_[vIdx];
        if (!v.active) continue;

        if (grid) {
            float wallAtten = 1.0f;
            spatial_evaluate(listenerPos, listenerYaw, listenerPitch, v.pos, *grid,
                             v.currentGainL, v.currentGainR, v.currentCutoff, wallAtten);
        } else {
            float dist = 0.0f;
            spatial_evaluate_geom(listenerPos, listenerYaw, listenerPitch, v.pos,
                                  v.currentGainL, v.currentGainR, dist);
            v.currentCutoff = 20000.0f;
        }
    }

    // 3. Accumulate all voices and sub-synthesizers into stereo buffer
    // Альфы фильтров окклюзии — РАЗ на блок, не на сэмпл: exp() на каждый
    // сэмпл каждого голоса = ~10 млн трансцендентных вызовов/с на главном
    // потоке (находка аудита). cutoff меняется только между блоками.
    float lpAlpha[kMaxSpatialVoices];
    for (int vIdx = 0; vIdx < kMaxSpatialVoices; ++vIdx)
        lpAlpha[vIdx] = 1.0f - std::exp(-kTwoPi * voices_[vIdx].currentCutoff /
                                        kAudioSampleRate);

    for (int n = 0; n < framesToProcess; ++n) {
        float sumL = 0.0f;
        float sumR = 0.0f;

        // Sub-synthesizers:
        // Geiger (mono centered or slight random stereo spread)
        float gSample = geigerBuf_[n] * config_.geigerGain;
        sumL += gSample * 0.707f;
        sumR += gSample * 0.707f;

        // Siren (mono centered ambient alarm)
        float sSample = sirenBuf_[n] * config_.sirenGain;
        sumL += sSample * 0.707f;
        sumR += sSample * 0.707f;

        // Ambient Drone (stereo SECAM flyback + grid hum)
        float ambSample = ambientBuf_[n] * config_.ambientGain;
        sumL += ambSample * 0.707f;
        sumR += ambSample * 0.707f;

        // UI Synthesizer (direct stereo feed)
        float uiSample = uiBuf_[n] * config_.uiGain;
        sumL += uiSample * 0.707f;
        sumR += uiSample * 0.707f;

        // 32 Spatial Voices
        for (int vIdx = 0; vIdx < kMaxSpatialVoices; ++vIdx) {
            SpatialVoice& v = voices_[vIdx];
            if (!v.active) continue;

            float monoSample = 0.0f;
            synthesize_spatial_voice_sample(v, monoSample);

            // Apply 1-pole lowpass filter for occlusion (alpha per block)
            const float alpha = lpAlpha[vIdx];
            v.lpStateL += alpha * (monoSample * v.currentGainL - v.lpStateL);
            v.lpStateR += alpha * (monoSample * v.currentGainR - v.lpStateR);

            sumL += v.lpStateL * config_.sfxGain;
            sumR += v.lpStateR * config_.sfxGain;

            ++v.ageSamples;
            if (v.ageSamples >= v.totalSamples) {
                v.active = false;
            }
        }

        // Музыкальный канал: зацикленный артистский сэмпл, моно в оба уха.
        // Процедурного дефолта у музыки нет — нет файла, нет канала.
        if (bank_ && bank_->music.data && bank_->music.frames > 0) {
            const float m = bank_->music.data[musicPos_] * config_.musicGain;
            sumL += m;
            sumR += m;
            if (++musicPos_ >= bank_->music.frames) musicPos_ = 0;
        }

        // Apply Master Bus Soft Limiter (tanh) to guarantee no digital clipping
        float limitedL = master_limiter(sumL * config_.masterGain);
        float limitedR = master_limiter(sumR * config_.masterGain);

        outStereo[n * 2 + 0] = limitedL;
        outStereo[n * 2 + 1] = limitedR;
    }

    // Zero any remaining frames if requested > kAudioBlockFrames
    if (numFrames > framesToProcess) {
        std::fill_n(outStereo + framesToProcess * 2, (numFrames - framesToProcess) * 2, 0.0f);
    }
}

} // namespace giga::audio
