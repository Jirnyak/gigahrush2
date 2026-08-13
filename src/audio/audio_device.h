#pragma once

#include <AL/al.h>
#include <AL/alc.h>
#include <AL/alext.h>

namespace giga::audio {

struct AudioDevice {
    ALCdevice* device = nullptr;
    ALCcontext* context = nullptr;
    
    // Extensions and features
    bool hrtfEnabled = false;
    bool efxEnabled = false;

    // Default global effects (like a lowpass filter for occlusion)
    ALuint occlusionFilter = 0;

    bool init();
    void destroy();
    
    void update_listener(const float pos[3], const float forward[3], const float up[3]);
};

} // namespace giga::audio
