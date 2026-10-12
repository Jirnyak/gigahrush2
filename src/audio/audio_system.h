// High-level engine audio coordinator and SDL3 hardware audio stream bridge.
#pragma once

#include "audio/audio_types.h"
#include "audio/audio_mixer.h"
#include "core/math.h"
#include "world/macro_grid.h"
#include "world/field.h"
#include "world/level_stack.h"
#include "game/samosbor.h"
#include "game/noise.h"
// (`<vector>` и `game/event_bus.h` снесены 2026-10-12: первый держал только
//  `sampleStorage_`, второй — только тип параметра `bus`, который глушился
//  `(void)bus;` и ни разу не читался. Оба ушли вместе со своими предметами.)

struct SDL_AudioStream;

namespace giga::game {
}

namespace giga::audio {

class AudioSystem {
public:
    AudioSystem();
    ~AudioSystem();

    // Initialize SDL3 audio subsystem and hardware stream. Graceful fallback on headless.
    bool init();

    // Main per-frame update loop.
    // `const game::EventBus&` снят из сигнатуры 2026-10-12: параметр принимался
    // и глушился `(void)bus;` — ни одной строки в `src/audio/` к нему не
    // обращалось (греп = 0). Единственный вход аудио из игры — поле шумов,
    // и он уже стоит параметром ниже.
    void update(float dt, const vec3& listenerPos, float listenerYaw, float listenerPitch,
                const MacroGrid& grid, const Field<float>* dangerField,
                const game::SamosborState& samosbor,
                const game::NoiseField& noiseField, float hudBrightness = 1.0f,
                LayerId activeLayer = 0);

    // (`trigger_ui` и `play_3d` снесены 2026-10-12. Это был публичный API на
    //  НОЛЬ вызывающих во всём дереве — прямое проигрывание по SoundId/UiSound
    //  в обход поля шумов, то есть «звук из ввода», против
    //  [sound-from-physics-rule]. Снесены СОЗНАТЕЛЬНО вместе со звуковым паком,
    //  который их оправдывал (решение владельца 2026-10-12: демо без звука), а
    //  не потеряны: придёт пак — вернутся вместе с ним. Живой вход поля шумов
    //  зовёт `mixer_.play_spatial_sound` напрямую из `process_noise_events`.)

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

    // (`sampleBank_`, `sampleStorage_` и `load_sample_overrides()` снесены
    //  2026-10-12 — единственная куча во всём аудио-слое и единственный
    //  рукописный парсер CSV в движке держались файлом, которого никогда не
    //  было: `data/sounds.csv` 14 байт, `data/sounds/` не существовал.
    //  Надгробие и довод в [audio_types.h].)

    void process_noise_events(const game::NoiseField& noiseField, LayerId activeLayer = 0);
};

} // namespace giga::audio
