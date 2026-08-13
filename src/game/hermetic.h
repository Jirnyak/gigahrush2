#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "world/types.h"

namespace giga::game {

struct HermeticZones {
    std::vector<std::uint64_t> sealed{};

    HermeticZones() {
        sealed.assign((kMacroCells + 63) / 64, 0);
    }

    bool is_sealed(int cx, int cy, int cz) const {
        if (sealed.empty()) return false;
        const std::size_t idx = macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
        return (sealed[idx / 64] & (1ULL << (idx % 64))) != 0;
    }

    void set_sealed(int cx, int cy, int cz, bool val) {
        if (sealed.empty()) {
            sealed.assign((kMacroCells + 63) / 64, 0);
        }
        const std::size_t idx = macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
        if (val) {
            sealed[idx / 64] |= (1ULL << (idx % 64));
        } else {
            sealed[idx / 64] &= ~(1ULL << (idx % 64));
        }
    }
};

} // namespace giga::game
