// High-level engine audio coordinator and SDL3 hardware audio stream bridge implementation.
#include "audio/audio_system.h"
#include <SDL3/SDL.h>
#include <cstdio>
#include <algorithm>
#include <cmath>
#include <cstring>

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
    load_sample_overrides();
    mixer_.set_sample_bank(&sampleBank_);
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

void AudioSystem::trigger_ui(UiSound sound) {
    mixer_.ui().trigger(sound);
}

void AudioSystem::play_3d(SoundId sound, const vec3& pos, float gain, float refDist, float maxDist) {
    mixer_.play_spatial_sound(sound, pos, gain, refDist, maxDist);
}

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
                         const game::SamosborState& samosbor, const game::EventBus& bus,
                         const game::NoiseField& noiseField, float hudBrightness,
                         LayerId activeLayer) {
    (void)dt;
    (void)bus;

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


namespace {
// sound_id из CSV -> SoundId. Маленькая таблица, а не magic-числа: слаг в
// data/sounds.csv читается человеком и не едет при перестановке enum'а.
SoundId sound_id_by_name(const char* n) {
    struct Row { const char* name; SoundId id; };
    static constexpr Row kRows[] = {
        {"gunshot", SoundId::Gunshot},     {"explosion", SoundId::Explosion},
        {"melee_hit", SoundId::MeleeHit},  {"footstep", SoundId::Footstep},
        {"door_move", SoundId::DoorMove},  {"container_open", SoundId::ContainerOpen},
        {"body_fall", SoundId::BodyFall},  {"monster_growl", SoundId::MonsterGrowl},
        {"electric_spark", SoundId::ElectricSpark}, {"item_pickup", SoundId::ItemPickup},
    };
    for (const Row& r : kRows)
        if (std::strcmp(n, r.name) == 0) return r.id;
    return SoundId::None;
}
} // namespace

void AudioSystem::load_sample_overrides() {
    // Политика ассетов — единая с текстурами: дефолт процедурный, файл
    // художника побеждает, если существует и вписан в data/sounds.csv
    // (`sound_id,file`; файл ищется в data/sounds/). Спец-слаг `music` —
    // зацикленный канал музыки. Любой отказ здесь — строка в stderr и синтез,
    // никогда не смерть: звук — не причина не бутиться.
    std::FILE* f = std::fopen("data/sounds.csv", "rb");
    if (!f) return;  // файла нет — всё процедурное, это дефолт, не ошибка
    char line[512];
    bool header = true;
    while (std::fgets(line, sizeof line, f)) {
        if (header) { header = false; continue; }
        char* nl = std::strchr(line, '\n'); if (nl) *nl = 0;
        char* cr = std::strchr(line, '\r'); if (cr) *cr = 0;
        if (!line[0] || line[0] == '#') continue;
        char* comma = std::strchr(line, ',');
        if (!comma) continue;
        *comma = 0;
        const char* slug = line;
        const char* file = comma + 1;
        char path[512];
        std::snprintf(path, sizeof path, "data/sounds/%s", file);

        SDL_AudioSpec spec{};
        std::uint8_t* wav = nullptr;
        std::uint32_t wavLen = 0;
        if (!SDL_LoadWAV(path, &spec, &wav, &wavLen)) {
            std::fprintf(stderr, "[audio] %s: %s — синтез остаётся\n", path,
                         SDL_GetError());
            continue;
        }
        // Конверсия в наш формат (mono float kAudioSampleRate) силами SDL —
        // мост и есть платформенный слой, DSP форматов не знает.
        const SDL_AudioSpec want{SDL_AUDIO_F32, 1,
                                 static_cast<int>(kAudioSampleRate)};
        std::uint8_t* conv = nullptr;
        int convLen = 0;
        const bool ok = SDL_ConvertAudioSamples(&spec, wav, static_cast<int>(wavLen),
                                                &want, &conv, &convLen);
        SDL_free(wav);
        if (!ok || convLen <= 0) {
            std::fprintf(stderr, "[audio] convert %s: %s\n", path, SDL_GetError());
            continue;
        }
        const std::size_t frames = static_cast<std::size_t>(convLen) / sizeof(float);
        sampleStorage_.emplace_back(
            reinterpret_cast<const float*>(conv),
            reinterpret_cast<const float*>(conv) + frames);
        SDL_free(conv);
        SampleData sd{sampleStorage_.back().data(),
                      static_cast<std::uint32_t>(frames)};
        if (std::strcmp(slug, "music") == 0) {
            sampleBank_.music = sd;
        } else {
            const SoundId id = sound_id_by_name(slug);
            if (id == SoundId::None) {
                std::fprintf(stderr, "[audio] unknown sound_id '%s'\n", slug);
                continue;
            }
            sampleBank_.bySound[static_cast<int>(id)] = sd;
        }
        std::fprintf(stderr, "[audio] override %s <- %s (%zu frames)\n", slug,
                     file, frames);
    }
    std::fclose(f);
}

} // namespace giga::audio
