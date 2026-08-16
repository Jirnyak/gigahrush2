// High-level engine audio coordinator and SDL3 hardware audio stream bridge implementation.
#include "audio/audio_system.h"
#include "game/door.h"
#include <SDL3/SDL.h>
#include <cstdio>
#include <algorithm>
#include <cmath>

namespace giga::audio {

AudioSystem::AudioSystem() {
}

AudioSystem::~AudioSystem() {
    shutdown();
}

bool AudioSystem::init() {
    if (!SDL_InitSubSystem(SDL_INIT_AUDIO)) {
        std::fprintf(stderr, "[audio] SDL_InitSubSystem(SDL_INIT_AUDIO) failed: %s (running headless/silent)\n",
                     SDL_GetError());
        deviceOpen_ = false;
        return true; // Non-fatal for headless test suites
    }

    SDL_AudioSpec spec;
    spec.format = SDL_AUDIO_F32;
    spec.channels = kAudioChannels;
    spec.freq = static_cast<int>(kAudioSampleRate);

    stream_ = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, nullptr, nullptr);
    if (!stream_) {
        std::fprintf(stderr, "[audio] SDL_OpenAudioDeviceStream failed: %s (running headless/silent)\n",
                     SDL_GetError());
        deviceOpen_ = false;
        return true; // Non-fatal
    }

    if (!SDL_ResumeAudioStreamDevice(stream_)) {
        std::fprintf(stderr, "[audio] SDL_ResumeAudioStreamDevice warning: %s\n", SDL_GetError());
    }

    deviceOpen_ = true;
    std::fprintf(stderr, "[audio] AudioSystem initialized: 48 kHz stereo 32-bit float (SDL3 AudioStream)\n");
    return true;
}

void AudioSystem::shutdown() {
    if (stream_) {
        SDL_DestroyAudioStream(stream_);
        stream_ = nullptr;
    }
    deviceOpen_ = false;
    lastProcessedNoiseId_ = 0;
    mixer_.reset();
}

void AudioSystem::trigger_ui(UiSound sound) {
    mixer_.ui().trigger(sound);
}

void AudioSystem::play_3d(SoundId sound, const vec3& pos, float gain, float refDist, float maxDist) {
    mixer_.play_spatial_sound(sound, pos, gain, refDist, maxDist);
}

void AudioSystem::process_noise_events(const game::NoiseField& noiseField, LayerId activeLayer) {
    if (noiseField.quiet()) return;

    if (noiseField.nextId <= lastProcessedNoiseId_) {
        // NoiseField was cleared or reset
        lastProcessedNoiseId_ = 0;
    }

    uint32_t maxIdThisFrame = lastProcessedNoiseId_;

    for (std::size_t i = 0; i < game::kNoiseCap; ++i) {
        const game::Noise& n = noiseField.slot[i];
        if (n.id == 0 || n.id <= lastProcessedNoiseId_) continue;

        if (n.id > maxIdThisFrame) {
            maxIdThisFrame = n.id;
        }

        // Check layer matching or vertical attenuation
        float layerGainMult = 1.0f;
        if (n.layer != (activeLayer & 0xFFu)) {
            int dLayer = std::abs(static_cast<int>(n.layer) - static_cast<int>(activeLayer & 0xFFu));
            if (dLayer > 1) {
                continue; // Too distant vertically across floors to hear
            }
            layerGainMult = 0.35f; // Muffled adjacent floor noise
        }

        SoundId mappedSound = SoundId::None;
        switch (static_cast<game::NoiseSource>(n.source)) {
        case game::NoiseSource::WeaponFire:
            mappedSound = SoundId::Gunshot;
            break;
        case game::NoiseSource::Explosion:
            mappedSound = SoundId::Explosion;
            break;
        case game::NoiseSource::Melee:
            mappedSound = SoundId::MeleeHit;
            break;
        case game::NoiseSource::Container:
            mappedSound = SoundId::ContainerOpen;
            break;
        case game::NoiseSource::Body:
            mappedSound = SoundId::BodyFall;
            break;
        case game::NoiseSource::Footstep:
            mappedSound = SoundId::Footstep;
            break;
        case game::NoiseSource::Door:
            mappedSound = SoundId::DoorMove;
            break;
        default:
            break;
        }

        if (mappedSound != SoundId::None) {
            float gain = std::clamp(static_cast<float>(n.severity) / 5.0f, 0.2f, 1.0f) * layerGainMult;
            mixer_.play_spatial_sound(mappedSound, vec3{n.x, n.y, n.z}, gain, kRefDistanceM, n.radius);
        }
    }

    lastProcessedNoiseId_ = maxIdThisFrame;
}

void AudioSystem::update(float dt, const vec3& listenerPos, float listenerYaw, float listenerPitch,
                         const MacroGrid& grid, const Field<float>* dangerField,
                         const game::SamosborState& samosbor, const game::EventBus& bus,
                         const game::NoiseField& noiseField, float hudBrightness,
                         const game::DoorSet* doors, float radDose,
                         LayerId activeLayer, int currentFloor) {
    (void)dt;
    (void)bus;
    (void)currentFloor;

    // 1. Update Geiger counter danger and radiation dose level
    float dangerSample = 0.0f;
    if (dangerField) {
        int cx = static_cast<int>(std::floor(listenerPos.x * 0.5f));
        int cy = static_cast<int>(std::floor(listenerPos.y * 0.5f));
        int cz = static_cast<int>(std::floor(listenerPos.z * 0.5f));
        dangerSample = dangerField->at(cx, cy, cz);
    }
    mixer_.geiger().set_radiation(dangerSample, radDose);

    // 2. Update Samosbor emergency siren with blast door and vertical distance attenuation
    bool sirenActive = (samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Warning) ||
                        samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active));
    float sirenIntensity = 0.0f;
    if (sirenActive) {
        sirenIntensity = (samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active)) ? 1.0f : 0.85f;

        // Blast door attenuation check: when sheltered in hermetic room, siren is acoustically muffled
        if (doors != nullptr && game::samosbor_is_sheltered(listenerPos, *doors, &grid)) {
            sirenIntensity *= 0.25f; // Muffled by hermetic blast doors
        }

        // Vertical floor attenuation scaling
        float vertAtten = 1.0f / (1.0f + 0.03f * std::abs(listenerPos.z - 32.0f));
        sirenIntensity *= vertAtten;
    }
    mixer_.siren().set_active(sirenActive, sirenIntensity);

    // 3. Update Ambient CRT whine and grid hum
    mixer_.ambient().set_hud_brightness(hudBrightness);

    // 4. Ingest semantic noise events into 3D spatial voices (with voxel wall attenuation)
    process_noise_events(noiseField, activeLayer);

    // 5. Hardware audio streaming pump
    if (stream_ && deviceOpen_) {
        constexpr int kTargetQueuedBytes = 2048 * sizeof(float) * kAudioChannels; // ~42 ms buffer
        int currentQueued = SDL_GetAudioStreamQueued(stream_);

        while (currentQueued < kTargetQueuedBytes) {
            mixer_.mix_frames(renderBuffer_, kAudioBlockFrames, listenerPos, listenerYaw, listenerPitch, &grid);
            int pushBytes = kAudioBlockFrames * kAudioChannels * static_cast<int>(sizeof(float));
            if (!SDL_PutAudioStreamData(stream_, renderBuffer_, pushBytes)) {
                break;
            }
            currentQueued += pushBytes;
        }
    }
}

} // namespace giga::audio
