// Procedural Audio Engine & Real-Time DSP Synthesizer Types
// POD types, enums, voice definitions, and constants. Pure C++23, zero heap.
#pragma once

#include <cstddef>
#include <cstdint>
#include "core/math.h"

namespace giga::audio {

inline constexpr float kAudioSampleRate = 48000.0f;
inline constexpr int kAudioChannels = 2;
inline constexpr int kAudioBlockFrames = 512;
inline constexpr int kMaxSpatialVoices = 32;
inline constexpr float kMaxAudibleDistM = 48.0f;
inline constexpr float kRefDistanceM = 1.5f;
inline constexpr float kFadeDistanceM = 38.0f;

enum class SoundId : std::uint8_t {
    None = 0,
    Gunshot,
    Explosion,
    MeleeHit,
    Footstep,
    DoorMove,
    ContainerOpen,
    BodyFall,
    MonsterGrowl,
    ElectricSpark,
    ItemPickup,
    Count
};

enum class UiSound : std::uint8_t {
    None = 0,
    KeyClick,
    ErrorChirp,
    InventoryRustle,
    Count
};

inline constexpr int kCombDelaySamples = 768; // ~16 ms reflection delay at 48 kHz

struct SpatialVoice {
    vec3 pos{0.0f, 0.0f, 0.0f};
    float gain = 1.0f;
    float refDist = kRefDistanceM;
    float maxDist = kMaxAudibleDistM;
    float rolloff = 1.0f;
    SoundId sound = SoundId::None;
    bool active = false;
    std::uint32_t ageSamples = 0;
    std::uint32_t totalSamples = 0;
    std::uint32_t seed = 0;
    float customParam = 0.0f;
    float lpStateL = 0.0f;
    float lpStateR = 0.0f;
    float currentGainL = 1.0f;
    float currentGainR = 1.0f;
    float currentCutoff = 20000.0f;
    // (форковские shaftReverb/combBuf/combIdx удалены: 98 КиБ мёртвых членов —
    // объявлены и не читались нигде; реверберация живёт в synth_siren.)
};

// --- НАДГРОБИЕ: артистские сэмплы СНЕСЕНЫ 2026-10-12 ------------------------
// Здесь жили `SampleData` и `SampleBank` — политика «файл художника побеждает
// синтез», единая с текстурами ([material_textures.cpp]). Снесено РАМКОЙ, а не
// за гниль: композитора у студии нет, звукового пака не будет, предрелизное
// демо выходит БЕЗ ЗВУКА (решение владельца 2026-10-12). По данным путь был
// пуст с рождения: `data/sounds.csv` — 14 байт (одна шапка `sound_id,file`,
// ноль строк), каталога `data/sounds/` не существовало, то есть банк не
// загрузил НИ ОДНОГО байта за всю свою жизнь.
// Остаётся синтез — он и есть закон «звук из физики, не из ввода»
// ([sound-from-physics-rule]). Вернётся ВМЕСТЕ С ПАКОМ, и тем же швом: память
// держит мост AudioSystem, DSP-слой видит указатели и форматов не знает.

struct AudioConfig {
    float masterGain = 0.8f;
    float sfxGain = 1.0f;
    float ambientGain = 0.6f;
    float geigerGain = 0.75f;
    // (`musicGain` снесён 2026-10-12 вместе с музыкальным каналом микшера:
    //  процедурного дефолта у музыки не было по построению — нет файла, нет
    //  канала, — а файла теперь не будет. Ручка масштабировала ноль.)
    float sirenGain = 0.85f;
    float uiGain = 0.7f;
    bool enabled = true;
};

} // namespace giga::audio
