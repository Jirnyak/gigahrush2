#include "audio/audio_device.h"
#include <cstdio>
#include <cstring>

namespace giga::audio {

bool AudioDevice::init() {
    // Open default playback device
    device = alcOpenDevice(nullptr);
    if (!device) {
        std::fprintf(stderr, "[audio] Failed to open OpenAL device\n");
        return false;
    }

    // Check for EFX (Effects Extension) for Lowpass filters (occlusion)
    if (alcIsExtensionPresent(device, "ALC_EXT_EFX")) {
        efxEnabled = true;
    } else {
        std::fprintf(stderr, "[audio] ALC_EXT_EFX not supported, occlusion will fallback to volume ducking\n");
    }

    // Request HRTF if available
    ALCint attrs[] = {
        ALC_HRTF_SOFT, ALC_TRUE, // Request HRTF enabled
        0
    };

    context = alcCreateContext(device, attrs);
    if (!context) {
        std::fprintf(stderr, "[audio] Failed to create OpenAL context\n");
        alcCloseDevice(device);
        device = nullptr;
        return false;
    }

    alcMakeContextCurrent(context);

    // Verify HRTF status
    if (alcIsExtensionPresent(device, "ALC_SOFT_HRTF")) {
        ALCint hrtfState = ALC_FALSE;
        alcGetIntegerv(device, ALC_HRTF_SOFT, 1, &hrtfState);
        hrtfEnabled = (hrtfState == ALC_TRUE);
        std::fprintf(stdout, "[audio] HRTF is %s\n", hrtfEnabled ? "enabled" : "disabled");
    }

    // Initialize EFX objects if supported
    if (efxEnabled) {
        // Load the EFX functions
        LPALGENFILTERS alGenFilters = (LPALGENFILTERS)alGetProcAddress("alGenFilters");
        LPALFILTERI alFilteri = (LPALFILTERI)alGetProcAddress("alFilteri");
        
        if (alGenFilters && alFilteri) {
            alGenFilters(1, &occlusionFilter);
            alFilteri(occlusionFilter, AL_FILTER_TYPE, AL_FILTER_LOWPASS);
        } else {
            efxEnabled = false;
        }
    }

    return true;
}

void AudioDevice::destroy() {
    if (efxEnabled && occlusionFilter) {
        LPALDELETEFILTERS alDeleteFilters = (LPALDELETEFILTERS)alGetProcAddress("alDeleteFilters");
        if (alDeleteFilters) {
            alDeleteFilters(1, &occlusionFilter);
        }
        occlusionFilter = 0;
    }

    if (context) {
        alcMakeContextCurrent(nullptr);
        alcDestroyContext(context);
        context = nullptr;
    }

    if (device) {
        alcCloseDevice(device);
        device = nullptr;
    }
}

void AudioDevice::update_listener(const float pos[3], const float forward[3], const float up[3]) {
    alListenerfv(AL_POSITION, pos);
    
    float orientation[6] = {
        forward[0], forward[1], forward[2],
        up[0], up[1], up[2]
    };
    alListenerfv(AL_ORIENTATION, orientation);
    
    // In a real voxel game, we might need to set velocity for Doppler, 
    // but for now we set it to zero.
    float vel[3] = {0.0f, 0.0f, 0.0f};
    alListenerfv(AL_VELOCITY, vel);
}

} // namespace giga::audio
