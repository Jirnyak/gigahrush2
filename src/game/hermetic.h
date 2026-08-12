#pragma once
#include <cstdint>
#include <vector>
#include "world/types.h"

namespace giga {
namespace game {

// ПОЧЕМУ ОТДЕЛЬНАЯ МАСКА, А НЕ kHardnessUnbreakable НА МАТЕРИАЛЕ:
// неразрушимость — свойство МАТЕРИАЛА, герметичность — свойство ОБЪЁМА.
// Гермокомната может иметь обычные стены и герметичную дверь; неразрушимая
// стена может стоять в чистом поле. Смешивать их — та же ошибка, что
// смешивать LayerId и номер этажа.
struct HermeticZones {
    // Битовая маска по макро-клеткам: 2^21 бит = 256 КиБ. Плотно и дёшево.
    std::vector<std::uint64_t> sealed;   // kMacroCells / 64
    // Двери, ведущие внутрь. Это то, к чему бегут NPC.
    std::vector<std::uint32_t> doorCells;

    HermeticZones();

    bool is_sealed(int x, int y, int z) const;
    void set_sealed(int x, int y, int z, bool value);
};

} // namespace game
} // namespace giga
