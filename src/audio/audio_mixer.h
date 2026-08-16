// Polyphonic 32-Voice Audio Mixer Pool & Master Bus Limiter.
#pragma once

#include "audio/audio_types.h"
#include "audio/dsp_math.h"
#include "audio/synth_geiger.h"
#include "audio/synth_siren.h"
#include "audio/synth_ambient.h"
#include "audio/synth_ui.h"

namespace giga {
class MacroGrid;
}

namespace giga::audio {

class AudioMixer {
public:
    AudioMixer();

    void reset();

    // Voice allocation
    int play_spatial_sound(SoundId sound, const vec3& pos, float gain = 1.0f,
                           float refDist = kRefDistanceM, float maxDist = kMaxAudibleDistM);

    // Sub-synthesizer access
    GeigerSynth& geiger() { return geiger_; }
    SirenSynth& siren() { return siren_; }
    AmbientDroneSynth& ambient() { return ambient_; }
    UiSynth& ui() { return ui_; }
    AudioConfig& config() { return config_; }
    const AudioConfig& config() const { return config_; }

    // Spatial voice pool inspection
    int active_voice_count() const;
    SpatialVoice& voice(int index) { return voices_[index]; }
    const SpatialVoice& voice(int index) const { return voices_[index]; }

    // Mix generation (interleaved stereo: L0, R0, L1, R1, ...)
    void mix_frames(float* outStereo, int numFrames,
                    const vec3& listenerPos, float listenerYaw, float listenerPitch,
                    const MacroGrid* grid = nullptr);

private:
    AudioConfig config_;
    SpatialVoice voices_[kMaxSpatialVoices]{};

    GeigerSynth geiger_;
    SirenSynth siren_;
    AmbientDroneSynth ambient_;
    UiSynth ui_;

    uint32_t mixerRng_ = 0x543210feu;

    // Temporary mono buffers for sub-synthesizer evaluation
    float geigerBuf_[kAudioBlockFrames]{};
    float sirenBuf_[kAudioBlockFrames]{};
    float ambientBuf_[kAudioBlockFrames]{};
    float uiBuf_[kAudioBlockFrames]{};

    void synthesize_spatial_voice_sample(SpatialVoice& v, float& outMono);
};

} // namespace giga::audio
