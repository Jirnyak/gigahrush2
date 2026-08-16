// High-level engine audio coordinator and SDL3 hardware audio stream bridge.
#pragma once

#include "audio/audio_types.h"
#include "audio/audio_mixer.h"
#include <vector>
#include "core/math.h"
#include "world/macro_grid.h"
#include "world/field.h"
#include "world/level_stack.h"
#include "game/samosbor.h"
#include "game/event_bus.h"
#include "game/noise.h"

struct SDL_AudioStream;

namespace giga::game {
struct DoorSet;
}

namespace giga::audio {

class AudioSystem {
public:
    AudioSystem();
    ~AudioSystem();

    // Initialize SDL3 audio subsystem and hardware stream. Graceful fallback on headless.
    bool init();

    // Main per-frame update loop
    void update(float dt, const vec3& listenerPos, float listenerYaw, float listenerPitch,
                const MacroGrid& grid, const Field<float>* dangerField,
                const game::SamosborState& samosbor, const game::EventBus& bus,
                const game::NoiseField& noiseField, float hudBrightness = 1.0f,
                const game::DoorSet* doors = nullptr,
                LayerId activeLayer = 0);

    // Direct sound triggers
    void trigger_ui(UiSound sound);
    void play_3d(SoundId sound, const vec3& pos, float gain = 1.0f,
                 float refDist = kRefDistanceM, float maxDist = kMaxAudibleDistM);

    // Shutdown and release stream
    void shutdown();

    AudioMixer& mixer() { return mixer_; }
    const AudioMixer& mixer() const { return mixer_; }
    bool is_device_open() const { return deviceOpen_; }

private:
    AudioMixer mixer_;
    SDL_AudioStream* stream_ = nullptr;
    bool deviceOpen_ = false;
    uint32_t lastProcessedNoiseId_ = 0;

    // Fixed staging buffer for hardware stream pushes
    float renderBuffer_[kAudioBlockFrames * kAudioChannels]{};

    // Артистские сэмплы ([audio_types.h] политика): память живёт здесь, в
    // мосте — DSP-слой видит только указатели банка. Заполняется из
    // data/sounds.csv при init(); отсутствие файла — не ошибка, синтез.
    SampleBank sampleBank_{};
    std::vector<std::vector<float>> sampleStorage_;
    void load_sample_overrides();

    void process_noise_events(const game::NoiseField& noiseField, LayerId activeLayer = 0);
};

} // namespace giga::audio
