#pragma once

#include <AL/al.h>
#include <AL/alc.h>
#include <AL/alext.h>
#include <vector>
#include <cstdint>

namespace giga::audio {

struct AudioDevice;

struct LogicalVoice {
    std::uint32_t id = 0;
    float position[3] = {0.0f, 0.0f, 0.0f};
    float baseVolume = 1.0f;
    float currentGain = 1.0f;
    float pitch = 1.0f;
    float occlusionHfGain = 1.0f;
    float maxDistance = 50.0f;
    float minDistance = 1.0f;
    bool loop = false;
    bool playing = false;
    
    // The hardware voice currently playing this logical voice
    int hwVoiceIndex = -1;
    
    // The buffer containing the PCM data
    ALuint buffer = 0;
    
    // Calculated priority this frame
    float priority = 0.0f;
};

struct HardwareVoice {
    ALuint source = 0;
    ALuint filter = 0; // Lowpass filter object attached to this source
    std::uint32_t logicalId = 0;
    bool active = false;
};

class VoiceManager {
public:
    bool init(const AudioDevice& dev, int maxHwVoices = 32);
    void destroy();

    // Returns a handle to a new logical voice
    std::uint32_t play(ALuint buffer, const float pos[3], float volume = 1.0f, bool loop = false);
    void stop(std::uint32_t id);
    void set_position(std::uint32_t id, const float pos[3]);
    void set_occlusion(std::uint32_t id, float hfGain); // 0.0 to 1.0 (1.0 = no occlusion)

    // Evaluates priorities based on listener pos, steals voices if necessary, and applies parameters
    void update(const AudioDevice& dev, const float listenerPos[3]);

private:
    std::vector<HardwareVoice> hwVoices_;
    std::vector<LogicalVoice> logicalVoices_;
    std::uint32_t nextId_ = 1;
    
    // Helpers
    int find_free_hw_voice();
    int find_lowest_priority_hw_voice(float& outPriority);
    LogicalVoice* get_logical(std::uint32_t id);
};

} // namespace giga::audio
