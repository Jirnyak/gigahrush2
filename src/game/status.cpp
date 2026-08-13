#include "game/status.h"

namespace giga::game {
namespace {

// x1000 fixed-point multiply, rounded. Two multipliers compose as
// (a * b) / 1000, and the +500 is round-to-nearest rather than truncation: chaining
// three truncating multiplies drifts down by up to 3 parts in 1000, which is small
// but one-directional, and a slow that silently gets slower every time it recomposes
// is the kind of drift nobody finds by reading.
std::uint16_t mul_e3(std::uint16_t a, std::uint16_t b) {
    const std::uint32_t v =
        (static_cast<std::uint32_t>(a) * static_cast<std::uint32_t>(b) + 500u) / 1000u;
    // Clamp to the field's width. Composing several worsening multipliers (spore haze
    // x1.65 on top of anything else) can exceed 65535 in principle; saturating is
    // correct here because a spread multiplier past 65 is already "cannot aim".
    return v > 65535u ? static_cast<std::uint16_t>(65535u)
                      : static_cast<std::uint16_t>(v);
}

// Fold one x1000 column over every active status.
template <class Pick>
std::uint16_t fold_e3(const StatusSet& set, Pick pick) {
    std::uint16_t acc = 1000;
    for (std::size_t i = 0; i < kStatusCount; ++i) {
        if (set.remainMs[i] == 0) continue;
        acc = mul_e3(acc, pick(kStatusTable[i], set.alt[i] != 0));
    }
    return acc;
}

} // namespace

void status_apply(StatusSet& set, StatusId id, bool useAlt) {
    if (!status_valid(id)) return;
    const std::size_t i = static_cast<std::size_t>(id);
    const StatusDef& d = kStatusTable[i];

    if (id == StatusId::GovnyakRelief) {
        const std::size_t c_idx = static_cast<std::size_t>(StatusId::GovnyakCough);
        const std::size_t d_idx = static_cast<std::size_t>(StatusId::GovnyakDebt);
        std::uint32_t acc = set.intensityE3[i];
        if (set.remainMs[c_idx] != 0) acc += set.intensityE3[c_idx];
        if (set.remainMs[d_idx] != 0) acc += set.intensityE3[d_idx];
        set.intensityE3[i] = acc > kStatusIntensityCapE3 ? kStatusIntensityCapE3 : static_cast<std::uint16_t>(acc);
        set.remainMs[c_idx] = 0; set.intensityE3[c_idx] = 0; set.alt[c_idx] = 0;
        set.remainMs[d_idx] = 0; set.intensityE3[d_idx] = 0; set.alt[d_idx] = 0;
    }

    const std::uint32_t ms = useAlt ? d.altDurationMs : d.durationMs;

    // The LONGER of the two wins. Re-entering a spore cloud must not shorten a haze
    // you already carry, and the reference does the same (`Math.max` on expiresAt).
    if (ms > set.remainMs[i]) {
        set.remainMs[i] = ms;
        // Latched here and not re-read per tick: taking the gasmask off midway must
        // not retroactively lengthen a haze that landed while it was on.
        set.alt[i] = useAlt ? 1u : 0u;
    }

    if (d.stacks != 0) {
        const std::uint32_t next =
            static_cast<std::uint32_t>(set.intensityE3[i]) + 1000u;
        set.intensityE3[i] = next > kStatusIntensityCapE3
                                 ? kStatusIntensityCapE3
                                 : static_cast<std::uint16_t>(next);
    } else {
        set.intensityE3[i] = 1000;
    }
}

std::uint32_t status_step(StatusSet& set, std::uint32_t dtMs) {
    std::uint32_t expired = 0;
    for (std::size_t i = 0; i < kStatusCount; ++i) {
        const std::uint32_t r = set.remainMs[i];
        if (r == 0) continue;
        if (r <= dtMs) {
            const std::uint16_t prev_intensity = set.intensityE3[i];
            set.remainMs[i] = 0;
            set.intensityE3[i] = 0;
            set.alt[i] = 0;
            ++expired;

            if (i == static_cast<std::size_t>(StatusId::GovnyakRelief)) {
                const std::size_t next_i = static_cast<std::size_t>(StatusId::GovnyakCough);
                set.remainMs[next_i] = kStatusTable[next_i].durationMs;
                set.intensityE3[next_i] = prev_intensity;
                set.alt[next_i] = 0;
            } else if (i == static_cast<std::size_t>(StatusId::GovnyakCough)) {
                const std::size_t next_i = static_cast<std::size_t>(StatusId::GovnyakDebt);
                set.remainMs[next_i] = kStatusTable[next_i].durationMs;
                set.intensityE3[next_i] = prev_intensity;
                set.alt[next_i] = 0;
            }
        } else {
            set.remainMs[i] = r - dtMs;
        }
    }
    return expired;
}

bool status_active(const StatusSet& set, StatusId id) {
    return status_valid(id) && set.remainMs[static_cast<std::size_t>(id)] != 0;
}

std::uint16_t status_move_mult_e3(const StatusSet& set) {
    // The root window uses the ALT move column, which is how paupsina expresses
    // "0.22 while rooted, 0.54 once you can walk" without being two statuses.
    std::uint16_t acc = 1000;
    for (std::size_t i = 0; i < kStatusCount; ++i) {
        if (set.remainMs[i] == 0) continue;
        const StatusDef& d = kStatusTable[i];
        const bool rooted =
            d.rootMs != 0 && set.remainMs[i] > (d.durationMs - d.rootMs);
        acc = mul_e3(acc, rooted ? d.altMoveMultE3 : d.moveMultE3);
    }
    return acc;
}

std::uint16_t status_aim_mult_e3(const StatusSet& set) {
    return fold_e3(set, [](const StatusDef& d, bool alt) {
        return alt ? d.altAimMultE3 : d.aimMultE3;
    });
}

std::uint16_t status_melee_mult_e3(const StatusSet& set) {
    return fold_e3(set, [](const StatusDef& d, bool) { return d.meleeMultE3; });
}

std::uint16_t status_heal_mult_e3(const StatusSet& set) {
    return fold_e3(set, [](const StatusDef& d, bool) { return d.healMultE3; });
}

std::uint32_t status_water_drain_e3(const StatusSet& set) {
    // Rates ADD, they do not compose multiplicatively. Two sources of thirst are
    // twice the thirst, not the product of two fractions.
    std::uint32_t sum = 0;
    for (std::size_t i = 0; i < kStatusCount; ++i)
        if (set.remainMs[i] != 0) sum += kStatusTable[i].waterDrainE3;
    return sum;
}

bool status_is_rooted(const StatusSet& set) {
    for (std::size_t i = 0; i < kStatusCount; ++i) {
        if (set.remainMs[i] == 0) continue;
        const StatusDef& d = kStatusTable[i];
        // The root is the LEADING window, so it is active while the remaining time is
        // still above (duration - rootMs).
        if (d.rootMs != 0 && set.remainMs[i] > (d.durationMs - d.rootMs)) return true;
    }
    return false;
}

} // namespace giga::game
