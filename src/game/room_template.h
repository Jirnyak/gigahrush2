#pragma once

#include "game/mob_table.h"   // RoomBit
#include "game/prop_table.h"  // PropId
#include <cstdint>
#include <cstddef>

namespace giga::game {

struct RoomFurniture {
    std::uint16_t room;   // RoomBit
    std::uint16_t prop;   // PropId ordinal
    std::uint8_t slot;    // 0..kRoomSlots-1
    bool useSpot;         // may an NPC stand AT it?
};

// How many distinct interior cells a room offers.
inline constexpr std::uint8_t kRoomSlots = 9;

// PropId ordinals, spelled once.
inline constexpr std::uint16_t kPropKitchenStove = 5;
inline constexpr std::uint16_t kPropKitchenTable = 6;
inline constexpr std::uint16_t kPropToiletPan = 7;
inline constexpr std::uint16_t kPropBedCot = 8;
inline constexpr std::uint16_t kPropTerminal = 0; // 'terminal' from props.csv
inline constexpr std::uint16_t kPropBareBulb = 2; // 'bare_bulb'

inline constexpr RoomFurniture kRoomFurniture[] = {
    // --- Kitchen (variant 0, 2 props) ---
    {static_cast<std::uint16_t>(RoomBit::Kitchen), kPropKitchenStove, 0, true},
    {static_cast<std::uint16_t>(RoomBit::Kitchen), kPropKitchenTable, 4, false},
    // --- Bathroom (variant 0, 2 props) ---
    {static_cast<std::uint16_t>(RoomBit::Bathroom), kPropToiletPan, 0, true},
    {static_cast<std::uint16_t>(RoomBit::Bathroom), kPropToiletPan, 2, true},
    // --- Living (variant 0, 2 props) ---
    {static_cast<std::uint16_t>(RoomBit::Living), kPropBedCot, 6, true},
    {static_cast<std::uint16_t>(RoomBit::Living), kPropBedCot, 8, true},
    
    // --- Storage (variant 0, 1 prop) ---
    {static_cast<std::uint16_t>(RoomBit::Storage), kPropTerminal, 4, true},
    
    // --- Common (variant 0, 1 prop) ---
    {static_cast<std::uint16_t>(RoomBit::Common), kPropKitchenTable, 4, false},
    
    // --- Corridor (variant 0, 1 prop) ---
    {static_cast<std::uint16_t>(RoomBit::Corridor), kPropBareBulb, 4, false},
    
    // --- Production (variant 0, 1 prop) ---
    {static_cast<std::uint16_t>(RoomBit::Production), kPropTerminal, 0, true},
    
    // --- Smoking (variant 0, 1 prop) ---
    {static_cast<std::uint16_t>(RoomBit::Smoking), kPropBareBulb, 4, false},
    
    // --- Hq (variant 0, 1 prop) ---
    {static_cast<std::uint16_t>(RoomBit::Hq), kPropTerminal, 4, true},
};

inline constexpr std::size_t kRoomFurnitureCount =
    sizeof(kRoomFurniture) / sizeof(kRoomFurniture[0]);

struct RoomTemplate {
    std::uint16_t room;          // RoomBit
    std::uint8_t  variant;       // 0..3, вариантов раскладки на тип
    std::uint8_t  weight;        // вес выбора варианта
    std::uint8_t  propCount;     // сколько строк мебели ниже
    std::uint8_t  firstProp;     // индекс в общий массив RoomFurniture
    std::uint8_t  maxProps;      // Бюджет ЯВНЫЙ, закрывает §2.6
};

inline constexpr RoomTemplate kRoomTemplates[] = {
    // room, variant, weight, propCount, firstProp, maxProps
    {static_cast<std::uint16_t>(RoomBit::Corridor),   0, 100, 1, 8, 1},
    {static_cast<std::uint16_t>(RoomBit::Common),     0, 100, 1, 7, 1},
    {static_cast<std::uint16_t>(RoomBit::Storage),    0, 100, 1, 6, 1},
    {static_cast<std::uint16_t>(RoomBit::Kitchen),    0, 100, 2, 0, 2},
    {static_cast<std::uint16_t>(RoomBit::Bathroom),   0, 100, 2, 2, 2},
    {static_cast<std::uint16_t>(RoomBit::Living),     0, 100, 2, 4, 2},
    {static_cast<std::uint16_t>(RoomBit::Office),     0, 100, 0, 0, 0}, // Deferred (no desk prop yet)
    {static_cast<std::uint16_t>(RoomBit::Medical),    0, 100, 0, 0, 0}, // Deferred (no medical bed yet)
    {static_cast<std::uint16_t>(RoomBit::Production), 0, 100, 1, 9, 1},
    {static_cast<std::uint16_t>(RoomBit::Smoking),    0, 100, 1, 10, 1},
    {static_cast<std::uint16_t>(RoomBit::Hq),         0, 100, 1, 11, 1},
};

inline constexpr std::size_t kRoomTemplateCount =
    sizeof(kRoomTemplates) / sizeof(kRoomTemplates[0]);

} // namespace giga::game
