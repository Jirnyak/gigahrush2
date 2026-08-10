#include "game/hermetic.h"

namespace giga {
namespace game {

HermeticZones::HermeticZones() {
    sealed.assign((kMacroCells + 63) / 64, 0);
}

bool HermeticZones::is_sealed(int x, int y, int z) const {
    const std::size_t idx = macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z));
    return (sealed[idx / 64] & (1ULL << (idx % 64))) != 0;
}

void HermeticZones::set_sealed(int x, int y, int z, bool value) {
    const std::size_t idx = macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z));
    if (value) {
        sealed[idx / 64] |= (1ULL << (idx % 64));
    } else {
        sealed[idx / 64] &= ~(1ULL << (idx % 64));
    }
}

} // namespace game
} // namespace giga
