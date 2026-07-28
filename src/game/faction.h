// Factions — who the population belongs to, and the colour that says so.
//
// This is the one place faction identity and its palette live. It matters more
// than a cosmetic table, because the palette carries a **gameplay read**: at a
// glance, in a dark corridor, the player must be able to tell a person from a
// monster. So the colour space is split down the middle:
//
//   people   green-teal / blue / violet / cyan / amber   (saturated mid-brights)
//   danger   the red axis                                (reserved, see below)
//
// **Red is not a faction.** In the reference `#e64e5c` belongs to *samosbor* —
// the world-restructuring event — which is a territory owner with no diplomacy
// rather than a society. Spending red on a faction is what made a civilian
// indistinguishable from a threat. Monsters own the red/dark axis
// (`mob_spawn.cpp`); nothing here may use it.
#pragma once

#include <cstdint>

#include "core/math.h"

namespace giga::game {

// The five societies of the building. Ported from the reference's faction
// registry — note there are FIVE, which is why anything indexing factions needs
// five slots and not the four an earlier `faction & 3` mask assumed.
enum class Faction : std::uint8_t {
    Citizens = 0,  // Граждане    — the ordinary population; the civil majority
    Liquidators,   // Ликвидаторы — maintenance/authority; keep the building running
    Cultists,      // Культисты   — live among the citizens, cold-neutral to them
    Scientists,    // Учёные      — the civil bloc's third member
    Wild,          // Дикие       — hostile to everyone, including each other
    Count
};
inline constexpr std::size_t kFactionCount = static_cast<std::size_t>(Faction::Count);
static_assert(kFactionCount == 5, "five factions; index arrays must be 5 wide");

// Reserved for danger, never for a society: samosbor's own colour. Kept here so
// it is visible next to the faction hues and cannot be reused by accident.
inline constexpr vec3 kSamosborRed{0.902f, 0.306f, 0.361f};  // #e64e5c

// Body tint for the render skin: one hue per faction, plus deterministic
// per-record jitter so a crowd does not look like flat clones. The sim never
// reads this — it is purely how the body pass draws the entity.
//
// Hues are the reference's authored faction colours, not invented: they are
// mutually distinguishable AND collectively distinct from both the building's
// greys/tans and from the monster palette.
inline vec3 faction_color(std::uint16_t faction, std::uint32_t jitterKey) {
    static const vec3 kFactionHue[kFactionCount] = {
        {0.290f, 0.745f, 0.569f},  // Citizens    #4abe91 green-teal
        {0.357f, 0.620f, 0.933f},  // Liquidators #5b9eee blue
        {0.737f, 0.349f, 1.000f},  // Cultists    #bc59ff violet
        {0.404f, 0.847f, 0.910f},  // Scientists  #67d8e8 cyan
        {0.878f, 0.655f, 0.271f},  // Wild        #e0a745 amber
    };
    // Modulo, not a power-of-two mask: five is not a power of two, and `& 3`
    // silently folded Wild onto Citizens.
    vec3 c = kFactionHue[faction % kFactionCount];
    std::uint32_t h = jitterKey * 0x9e3779b9u;
    h ^= h >> 15;
    float j = (static_cast<float>(h & 0xFFu) / 255.0f - 0.5f) * 0.18f;  // +/-0.09
    return vec3{clamp01(c.x + j), clamp01(c.y + j), clamp01(c.z + j)};
}

} // namespace giga::game
