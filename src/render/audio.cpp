#include "render/audio.h"

#include <algorithm>
#include <cmath>

#if __has_include(<SDL3/SDL.h>)
#include <SDL3/SDL.h>
#define GIGA_AUDIO_HAS_SDL3 1
#else
#define GIGA_AUDIO_HAS_SDL3 0
#endif

#include "world/macro_grid.h"

namespace giga::render {

SpatialAudio evaluate_spatial_audio(const AudioSource& src,
                                   const ListenerFrame& listener,
                                   float refDistance,
                                   float maxDistance) {
    SpatialAudio out{};

    // Toroidal distance vector from listener to source
    const float dx = wrap_delta_f(src.pos.x, listener.pos.x, kWorldExtent);
    const float dy = wrap_delta_f(src.pos.y, listener.pos.y, kWorldExtent);
    const float dz = wrap_delta_f(src.pos.z, listener.pos.z, kWorldExtent);
    const float distSq = dx * dx + dy * dy + dz * dz;
    const float dist = std::sqrt(distSq);

    out.distance = dist;
    if (dist > maxDistance || dist < 1e-4f) {
        if (dist < 1e-4f) {
            out.gainLeft = src.gain * 0.5f;
            out.gainRight = src.gain * 0.5f;
        }
        return out;
    }

    // Inverse square distance attenuation with reference distance roll-off
    const float atten = 1.0f / (1.0f + (distSq / (refDistance * refDistance)));

    // Direction vector in listener reference frame
    const float invDist = 1.0f / dist;
    const vec3 dir{dx * invDist, dy * invDist, dz * invDist};

    // Stereo panning based on azimuth relative to listener right vector
    const float pan = dir.x * listener.right.x +
                      dir.y * listener.right.y +
                      dir.z * listener.right.z;

    const float panL = (1.0f - pan) * 0.5f;
    const float panR = (1.0f + pan) * 0.5f;

    out.gainLeft = std::clamp(src.gain * atten * panL, 0.0f, 1.0f);
    out.gainRight = std::clamp(src.gain * atten * panR, 0.0f, 1.0f);
    return out;
}

float compute_audio_occlusion(const vec3& srcPos,
                              const vec3& listenerPos,
                              const MacroGrid* grid,
                              bool pipeConnected) {
    if (!grid) return 0.0f;

    constexpr int kSamples = 16;
    int solidCount = 0;

    for (int i = 0; i < kSamples; ++i) {
        const float t = (static_cast<float>(i) + 0.5f) / static_cast<float>(kSamples);
        const float px = srcPos.x + wrap_delta_f(listenerPos.x, srcPos.x, kWorldExtent) * t;
        const float py = srcPos.y + wrap_delta_f(listenerPos.y, srcPos.y, kWorldExtent) * t;
        const float pz = srcPos.z + wrap_delta_f(listenerPos.z, srcPos.z, kWorldExtent) * t;

        const int cx = wrap_macro(static_cast<int>(std::floor(px / kCellSize)));
        const int cy = wrap_macro(static_cast<int>(std::floor(py / kCellSize)));
        const int cz = wrap_macro(static_cast<int>(std::floor(pz / kCellSize)));

        if (grid->mask(cx, cy, cz).full()) {
            ++solidCount;
        }
    }

    float wallRatio = static_cast<float>(solidCount) / static_cast<float>(kSamples);

    // Pipes bypass walls if source and listener are in same pipe network
    if (pipeConnected) {
        constexpr float kPipeLeak = 0.15f;
        wallRatio = std::min(wallRatio, kPipeLeak);
    }

    return wallRatio;
}

bool AudioSystem::init() {
    if (initialized_) return true;

#if GIGA_AUDIO_HAS_SDL3
    if (!SDL_InitSubSystem(SDL_INIT_AUDIO)) {
        return false;
    }

    SDL_AudioSpec spec{};
    spec.format = SDL_AUDIO_F32;
    spec.channels = 2;
    spec.freq = 48000;

    SDL_AudioStream* stream = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, nullptr, nullptr);
    if (stream) {
        SDL_ResumeAudioStreamDevice(stream);
        audioDevice_ = stream;
        initialized_ = true;
    } else {
        initialized_ = true; // Non-fatal headless fallback
    }
#else
    initialized_ = true; // Headless test environment
#endif

    return initialized_;
}

void AudioSystem::shutdown() {
    if (!initialized_) return;

#if GIGA_AUDIO_HAS_SDL3
    if (audioDevice_) {
        SDL_AudioStream* stream = static_cast<SDL_AudioStream*>(audioDevice_);
        SDL_DestroyAudioStream(stream);
        audioDevice_ = nullptr;
    }

    SDL_QuitSubSystem(SDL_INIT_AUDIO);
#endif
    initialized_ = false;
}

void AudioSystem::update_listener(const ListenerFrame& listener) {
    listener_ = listener;
}

void AudioSystem::play_oneshot(std::uint16_t clipId, const vec3& pos, float gain, float pitch) {
    (void)clipId;
    (void)pos;
    (void)gain;
    (void)pitch;
}

void AudioSystem::play_ui(std::uint16_t clipId, float gain) {
    (void)clipId;
    (void)gain;
}

} // namespace giga::render
