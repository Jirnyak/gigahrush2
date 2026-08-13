#pragma once

#include <cstddef>
#include <cstdint>
#include "core/math.h"
#include "core/wrap.h"
#include "world/types.h"

namespace giga {
class MacroGrid;
}

namespace giga::render {

struct AudioSource {
    vec3 pos{};          // World position
    float gain = 1.0f;   // Base volume 0..1
    float pitch = 1.0f;  // Playback pitch
    std::uint16_t clipId = 0;
    std::uint8_t flags = 0;
};

struct ListenerFrame {
    vec3 pos{0.0f, 0.0f, 0.0f};
    vec3 fwd{0.0f, 1.0f, 0.0f};
    vec3 right{1.0f, 0.0f, 0.0f};
    vec3 up{0.0f, 0.0f, 1.0f};
};

struct SpatialAudio {
    float gainLeft = 0.0f;
    float gainRight = 0.0f;
    float distance = 0.0f;
    float occlusion = 0.0f; // 0.0 = clear, 1.0 = fully blocked
};

// Calculates spatial attenuation, stereo panning and toroidal distance
SpatialAudio evaluate_spatial_audio(const AudioSource& src,
                                   const ListenerFrame& listener,
                                   float refDistance = 4.0f,
                                   float maxDistance = 64.0f);

// Calculates occlusion through voxel volume with optional duct/pipe bypass
float compute_audio_occlusion(const vec3& srcPos,
                              const vec3& listenerPos,
                              const giga::MacroGrid* grid,
                              bool pipeConnected = false);

class AudioSystem {
public:
    AudioSystem() = default;
    ~AudioSystem() { shutdown(); }

    bool init();
    void shutdown();

    void update_listener(const ListenerFrame& listener);
    void play_oneshot(std::uint16_t clipId, const vec3& pos, float gain = 1.0f, float pitch = 1.0f);
    void play_ui(std::uint16_t clipId, float gain = 1.0f);

    bool is_initialized() const { return initialized_; }

private:
    bool initialized_ = false;
    void* audioDevice_ = nullptr;
    ListenerFrame listener_{};
};

} // namespace giga::render
