#include "audio/voice.h"
#include "audio/audio_device.h"
#include <cmath>
#include <algorithm>
#include <cstdio>

namespace giga::audio {

bool VoiceManager::init(const AudioDevice& dev, int maxHwVoices) {
    hwVoices_.resize(maxHwVoices);
    
    for (int i = 0; i < maxHwVoices; ++i) {
        alGenSources(1, &hwVoices_[i].source);
        
        // Setup distance model properties
        alSourcef(hwVoices_[i].source, AL_ROLLOFF_FACTOR, 1.0f);
        alSourcef(hwVoices_[i].source, AL_REFERENCE_DISTANCE, 1.0f);
        alSourcef(hwVoices_[i].source, AL_MAX_DISTANCE, 50.0f);

        if (dev.efxEnabled) {
            LPALGENFILTERS alGenFilters = (LPALGENFILTERS)alGetProcAddress("alGenFilters");
            LPALFILTERI alFilteri = (LPALFILTERI)alGetProcAddress("alFilteri");
            if (alGenFilters && alFilteri) {
                alGenFilters(1, &hwVoices_[i].filter);
                alFilteri(hwVoices_[i].filter, AL_FILTER_TYPE, AL_FILTER_LOWPASS);
            }
        }
    }
    return true;
}

void VoiceManager::destroy() {
    LPALDELETEFILTERS alDeleteFilters = (LPALDELETEFILTERS)alGetProcAddress("alDeleteFilters");
    for (auto& hw : hwVoices_) {
        alDeleteSources(1, &hw.source);
        if (hw.filter && alDeleteFilters) {
            alDeleteFilters(1, &hw.filter);
        }
    }
    hwVoices_.clear();
    logicalVoices_.clear();
}

std::uint32_t VoiceManager::play(ALuint buffer, const float pos[3], float volume, bool loop) {
    LogicalVoice v;
    v.id = nextId_++;
    v.position[0] = pos[0];
    v.position[1] = pos[1];
    v.position[2] = pos[2];
    v.baseVolume = volume;
    v.loop = loop;
    v.playing = true;
    v.buffer = buffer;
    
    logicalVoices_.push_back(v);
    return v.id;
}

void VoiceManager::stop(std::uint32_t id) {
    LogicalVoice* v = get_logical(id);
    if (!v) return;
    v->playing = false;
    if (v->hwVoiceIndex >= 0) {
        alSourceStop(hwVoices_[v->hwVoiceIndex].source);
        alSourcei(hwVoices_[v->hwVoiceIndex].source, AL_BUFFER, 0);
        hwVoices_[v->hwVoiceIndex].active = false;
        v->hwVoiceIndex = -1;
    }
}

void VoiceManager::set_position(std::uint32_t id, const float pos[3]) {
    LogicalVoice* v = get_logical(id);
    if (!v) return;
    v->position[0] = pos[0];
    v->position[1] = pos[1];
    v->position[2] = pos[2];
}

void VoiceManager::set_occlusion(std::uint32_t id, float hfGain) {
    LogicalVoice* v = get_logical(id);
    if (!v) return;
    v->occlusionHfGain = hfGain;
}

LogicalVoice* VoiceManager::get_logical(std::uint32_t id) {
    for (auto& v : logicalVoices_) {
        if (v.id == id) return &v;
    }
    return nullptr;
}

void VoiceManager::update(const AudioDevice& dev, const float listenerPos[3]) {
    // 1. Clean up finished voices
    for (auto it = logicalVoices_.begin(); it != logicalVoices_.end();) {
        if (it->hwVoiceIndex >= 0) {
            ALint state;
            alGetSourcei(hwVoices_[it->hwVoiceIndex].source, AL_SOURCE_STATE, &state);
            if (state == AL_STOPPED && !it->loop) {
                hwVoices_[it->hwVoiceIndex].active = false;
                it->playing = false;
            }
        }
        
        if (!it->playing) {
            if (it->hwVoiceIndex >= 0) {
                hwVoices_[it->hwVoiceIndex].active = false;
            }
            it = logicalVoices_.erase(it);
        } else {
            ++it;
        }
    }
    
    // 2. Calculate priorities
    for (auto& v : logicalVoices_) {
        if (!v.playing) continue;
        
        float dx = v.position[0] - listenerPos[0];
        float dy = v.position[1] - listenerPos[1];
        float dz = v.position[2] - listenerPos[2];
        float distSq = dx*dx + dy*dy + dz*dz;
        
        if (distSq > v.maxDistance * v.maxDistance) {
            v.priority = 0.0f; // Too far
        } else {
            float dist = std::sqrt(distSq);
            dist = std::max(dist, v.minDistance);
            v.priority = v.baseVolume * (1.0f / dist) * v.occlusionHfGain;
        }
    }
    
    // Sort logical voices by priority (highest first)
    std::vector<LogicalVoice*> sortedVoices;
    for (auto& v : logicalVoices_) {
        if (v.priority > 0.0f) {
            sortedVoices.push_back(&v);
        } else if (v.hwVoiceIndex >= 0) {
            // Priority is 0, stop the hardware voice
            alSourceStop(hwVoices_[v.hwVoiceIndex].source);
            alSourcei(hwVoices_[v.hwVoiceIndex].source, AL_BUFFER, 0);
            hwVoices_[v.hwVoiceIndex].active = false;
            v.hwVoiceIndex = -1;
        }
    }
    
    std::sort(sortedVoices.begin(), sortedVoices.end(), [](const LogicalVoice* a, const LogicalVoice* b) {
        return a->priority > b->priority;
    });
    
    // 3. Assign hardware voices to top N logical voices
    int limit = std::min((int)sortedVoices.size(), (int)hwVoices_.size());
    
    // First, preserve mappings that are still valid and in the top N
    for (int i = 0; i < limit; ++i) {
        LogicalVoice* v = sortedVoices[i];
        if (v->hwVoiceIndex >= 0) {
            hwVoices_[v->hwVoiceIndex].logicalId = v->id;
        }
    }
    
    // Evict hardware voices that are playing logical voices not in top N
    for (int i = limit; i < sortedVoices.size(); ++i) {
        LogicalVoice* v = sortedVoices[i];
        if (v->hwVoiceIndex >= 0) {
            alSourceStop(hwVoices_[v->hwVoiceIndex].source);
            alSourcei(hwVoices_[v->hwVoiceIndex].source, AL_BUFFER, 0);
            hwVoices_[v->hwVoiceIndex].active = false;
            v->hwVoiceIndex = -1;
        }
    }
    
    // Assign free hardware voices to unassigned top N logical voices
    for (int i = 0; i < limit; ++i) {
        LogicalVoice* v = sortedVoices[i];
        if (v->hwVoiceIndex < 0) {
            // Find free hw voice
            int hwIdx = -1;
            for (int h = 0; h < hwVoices_.size(); ++h) {
                if (!hwVoices_[h].active) {
                    hwIdx = h;
                    break;
                }
            }
            if (hwIdx >= 0) {
                v->hwVoiceIndex = hwIdx;
                hwVoices_[hwIdx].active = true;
                hwVoices_[hwIdx].logicalId = v->id;
                
                // Initialize AL source
                alSourcei(hwVoices_[hwIdx].source, AL_BUFFER, v->buffer);
                alSourcei(hwVoices_[hwIdx].source, AL_LOOPING, v->loop ? AL_TRUE : AL_FALSE);
                alSourcePlay(hwVoices_[hwIdx].source);
            }
        }
    }
    
    // 4. Update AL parameters for active hardware voices
    LPALFILTERF alFilterf = (LPALFILTERF)alGetProcAddress("alFilterf");
    
    for (auto& hw : hwVoices_) {
        if (!hw.active) continue;
        
        LogicalVoice* v = get_logical(hw.logicalId);
        if (!v) {
            hw.active = false;
            alSourceStop(hw.source);
            continue;
        }
        
        alSourcefv(hw.source, AL_POSITION, v->position);
        alSourcef(hw.source, AL_GAIN, v->baseVolume);
        
        // EFX Occlusion using Lowpass Filter
        if (dev.efxEnabled && hw.filter && alFilterf) {
            // AL_LOWPASS_GAIN limits the overall volume of the filter
            alFilterf(hw.filter, AL_LOWPASS_GAIN, 1.0f);
            
            // AL_LOWPASS_GAINHF cuts high frequencies (0.0 to 1.0)
            // v->occlusionHfGain (1.0 = no occlusion, 0.1 = heavily occluded)
            alFilterf(hw.filter, AL_LOWPASS_GAINHF, v->occlusionHfGain);
            
            // Attach filter to source (AL_DIRECT_FILTER)
            alSourcei(hw.source, AL_DIRECT_FILTER, hw.filter);
        }
    }
}

} // namespace giga::audio
