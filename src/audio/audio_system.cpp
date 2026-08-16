// High-level engine audio coordinator and SDL3 hardware audio stream bridge implementation.
#include "audio/audio_system.h"
#include <SDL3/SDL.h>
#include <cstdio>
#include <algorithm>

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
    mixer_.reset();
}

void AudioSystem::trigger_ui(UiSound sound) {
    mixer_.ui().trigger(sound);
}

void AudioSystem::play_3d(SoundId sound, const vec3& pos, float gain, float refDist, float maxDist) {
    mixer_.play_spatial_sound(sound, pos, gain, refDist, maxDist);
}

void AudioSystem::process_noise_events(const game::NoiseField& noiseField) {
    if (noiseField.quiet()) return;

    for (std::size_t i = 0; i < game::kNoiseCap; ++i) {
        const game::Noise& n = noiseField.slot[i];
        if (n.id == 0 || n.id <= lastProcessedNoiseId_) continue;

        if (n.id > lastProcessedNoiseId_) {
            lastProcessedNoiseId_ = n.id;
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
            float gain = std::clamp(static_cast<float>(n.severity) / 5.0f, 0.2f, 1.0f);
            mixer_.play_spatial_sound(mappedSound, vec3{n.x, n.y, n.z}, gain, kRefDistanceM, n.radius);
        }
    }
}

void AudioSystem::update(float dt, const vec3& listenerPos, float listenerYaw, float listenerPitch,
                         const MacroGrid& grid, const Field<float>* dangerField,
                         const game::SamosborState& samosbor, const game::EventBus& bus,
                         const game::NoiseField& noiseField, float hudBrightness) {
    (void)dt;
    (void)bus;

    // 1. Update Geiger counter danger level
    float dangerSample = 0.0f;
    if (dangerField) {
        int cx = static_cast<int>(std::floor(listenerPos.x * 0.5f));
        int cy = static_cast<int>(std::floor(listenerPos.y * 0.5f));
        int cz = static_cast<int>(std::floor(listenerPos.z * 0.5f));
        dangerSample = dangerField->at(cx, cy, cz);
    }
    mixer_.geiger().set_danger(dangerSample);

    // 2. Update Samosbor emergency siren
    bool sirenActive = (samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Warning) ||
                        samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active));
    mixer_.siren().set_active(sirenActive);

    // 3. Update Ambient CRT whine and grid hum
    mixer_.ambient().set_hud_brightness(hudBrightness);

    // 4. Ingest semantic noise events into 3D spatial voices
    process_noise_events(noiseField);

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
