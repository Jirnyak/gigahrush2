// High-level engine audio coordinator and SDL3 hardware audio stream bridge implementation.
#include "audio/audio_system.h"
#include <SDL3/SDL.h>
#include <cstdio>
#include <algorithm>
#include <cmath>
// (`<cstring>` снят 2026-10-12: его единственными потребителями были
//  `std::strcmp`/`std::strchr` внутри снесённого парсера `data/sounds.csv`.)

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
    // (Здесь стояли `load_sample_overrides()` + `mixer_.set_sample_bank(...)`.
    //  Снесены 2026-10-12: загружать было нечего — надгробие в [audio_types.h].
    //  Микшер синтезирует из коробки, никакой подготовки init'у не нужно.)
    return true;
}

void AudioSystem::shutdown() {
    if (stream_) {
        SDL_DestroyAudioStream(stream_);
        stream_ = nullptr;
    }
    deviceOpen_ = false;
    lastProcessedNoiseId_ = 0;
    mixer_.reset();
}

// НАДГРОБИЕ: `trigger_ui` и `play_3d` жили здесь и снесены 2026-10-12. Обе были
// одной строкой проброса в микшер и обе имели НОЛЬ вызывающих во всём дереве —
// публичный API «сыграй звук по id», то есть звук из ввода, а не из физики
// ([sound-from-physics-rule]). Оправдывал их звуковой пак; пака не будет
// (решение владельца 2026-10-12: композитора нет, демо без звука), поэтому
// снесены СОЗНАТЕЛЬНО и вернутся ВМЕСТЕ С ПАКОМ, а не потерялись. Живой вход в
// пространственные голоса — `process_noise_events` ниже, он зовёт
// `mixer_.play_spatial_sound` напрямую.

void AudioSystem::process_noise_events(const game::NoiseField& noiseField, LayerId activeLayer) {
    if (noiseField.quiet()) return;

    if (noiseField.nextId <= lastProcessedNoiseId_) {
        // NoiseField was cleared or reset
        lastProcessedNoiseId_ = 0;
    }

    uint32_t maxIdThisFrame = lastProcessedNoiseId_;

    for (std::size_t i = 0; i < game::kNoiseCap; ++i) {
        const game::Noise& n = noiseField.slot[i];
        if (n.id == 0 || n.id <= lastProcessedNoiseId_) continue;

        if (n.id > maxIdThisFrame) {
            maxIdThisFrame = n.id;
        }

        // Check layer matching or vertical attenuation
        float layerGainMult = 1.0f;
        if (n.layer != (activeLayer & 0xFFu)) {
            int dLayer = std::abs(static_cast<int>(n.layer) - static_cast<int>(activeLayer & 0xFFu));
            if (dLayer > 1) {
                continue; // Too distant vertically across floors to hear
            }
            layerGainMult = 0.35f; // Muffled adjacent floor noise
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
            float gain = std::clamp(static_cast<float>(n.severity) / 5.0f, 0.2f, 1.0f) * layerGainMult;
            mixer_.play_spatial_sound(mappedSound, vec3{n.x, n.y, n.z}, gain, kRefDistanceM, n.radius);
        }
    }

    lastProcessedNoiseId_ = maxIdThisFrame;
}

void AudioSystem::update(float dt, const vec3& listenerPos, float listenerYaw, float listenerPitch,
                         const MacroGrid& grid, const Field<float>* dangerField,
                         const game::SamosborState& samosbor,
                         const game::NoiseField& noiseField, float hudBrightness,
                         LayerId activeLayer) {
    // Кадровый `dt` синтезу не нужен и поэтому не используется: все четыре
    // синта тикают ПО СЭМПЛАМ внутри `mix_frames` (48 кГц), а не по кадрам, —
    // шаг времени у них свой и ровный, 1/kAudioSampleRate. Параметр оставлен
    // сознательно: он часть контракта «система на кадр», и первый же эффект с
    // кадровой огибающей (затухание шины при паузе) возьмёт его без правки
    // вызывающего. `(void)bus;` рядом НЕ стоит — параметр снят, см. [.h].
    (void)dt;

    // 1. Update Geiger counter danger and radiation dose level
    float dangerSample = 0.0f;
    if (dangerField) {
        int cx = wrap_macro(static_cast<int>(std::floor(listenerPos.x / kCellSize)));
        int cy = wrap_macro(static_cast<int>(std::floor(listenerPos.y / kCellSize)));
        int cz = wrap_macro(static_cast<int>(std::floor(listenerPos.z / kCellSize)));
        dangerSample = dangerField->at(cx, cy, cz);
    }
    mixer_.geiger().set_radiation(dangerSample, 0.0f);  // radDose придёт со своей системой

    // 2. Update Samosbor emergency siren with blast door and vertical distance attenuation
    bool sirenActive = (samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Warning) ||
                        samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active));
    float sirenIntensity = 0.0f;
    if (sirenActive) {
        sirenIntensity = (samosbor.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active)) ? 1.0f : 0.85f;

        // Приглушение за гермодверью: samosbor_is_sheltered форка у нас нет;
        // когда появится свой предикат укрытия — вернуть *0.25f здесь.
        // Вертикальное затухание «от середины стека» удалено: на торе середины
        // нет, этажное затухание уже делает ветка n.layer != activeLayer.
    }
    mixer_.siren().set_active(sirenActive, sirenIntensity);

    // 3. Update Ambient CRT whine and grid hum
    mixer_.ambient().set_hud_brightness(hudBrightness);

    // 4. Ingest semantic noise events into 3D spatial voices (with voxel wall attenuation)
    process_noise_events(noiseField, activeLayer);

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


// НАДГРОБИЕ: здесь жили `sound_id_by_name` (таблица слаг→SoundId) и
// `load_sample_overrides()` — 66 строк, ЕДИНСТВЕННЫЙ рукописный парсер CSV в
// движке и единственная куча во всём аудио-слое. Снесены 2026-10-12.
//
// Почему умерло, а не ждёт: путь не загрузил ни одного байта за всю свою жизнь
// (`data/sounds.csv` — 14 байт, одна шапка и ноль строк; каталога
// `data/sounds/` не существовало), а теперь у него нет и будущего — композитора
// у студии нет, звукового пака не будет, предрелизное демо выходит БЕЗ ЗВУКА
// (решение владельца 2026-10-12). Это РАМКА, а не недоделка: рамка записана в
// markoaudit/plans/steam-readiness.md, секция «ЗВУК».
//
// Умерло вместе с ним и то, что оно одно держало: `SampleData`/`SampleBank`
// ([audio_types.h]), `AudioMixer::set_sample_bank` + `bank_`/`musicPos_` и
// музыкальный канал ([audio_mixer.cpp]), `data/sounds.csv` целиком и его строка
// в `GIGA_CSV_UNCOVERED` (tools/check_csv_columns.cmake) — пин `covered=2/18`
// поехал на `2/17` ТЕМ ЖЕ коммитом, иначе гейт сказал бы «ФАНТОМ CSV»
// (проверено мутацией).
//
// Что ОСТАЛОСЬ и почему: синтез (geiger/siren/ambient/ui + 10 голосов в
// `audio_mixer.cpp`) и сам микшер работают и соответствуют закону «звук из
// физики, не из ввода» ([sound-from-physics-rule]) — их сносить незачем,
// процедурный дефолт играет из коробки и без пака.
//
// Вернётся ВМЕСТЕ С ПАКОМ и тем же швом: мост (этот файл) грузит и владеет
// памятью, DSP-слой видит указатели и форматов не знает. Второй раз писать
// парсер руками не надо — к тому дню `data/sounds.csv` заводится кодогеном, как
// остальные 17 таблиц (markoaudit/13-duplication.md §18).

} // namespace giga::audio
