// Trait readers. The DATA lives in the generated monster_traits_table.cpp; this file
// is the behaviour, and every function in it is either pure or a single component
// write.
#include "game/monster_traits.h"

#include <cmath>

#include "core/wrap.h"        // wrap_macro — x/y/z all wrap, so no bare divide
#include "game/combat.h"      // Armour, DamageChannel, kDamageChannels
#include "world/medium.h"     // medium_level_data, kWetQuanta — порог мокрого один
#include "world/types.h"      // kCellSize

namespace giga::game {

// The resist vector is copied element-wise onto Armour::resist, so the two widths are
// the same number or the copy below silently truncates. Pinned here rather than in the
// header so monster_traits.h does not have to include combat.h.
static_assert(sizeof(MonsterTraits::resist) / sizeof(std::int8_t) == kDamageChannels,
              "MonsterTraits::resist width must match the damage channel count");

namespace {

// The default row. All multipliers are kTraitUnit, so every `trait_*_mult` returns
// exactly 1.0f for a kind the CSV does not author — a caller cannot tell the default
// row from an authored row of ones, which is the point: there is no special case.
const MonsterTraits kDefaultRow = {
    {0, 0, 0, 0, 0},
    static_cast<std::uint8_t>(TerrainPref::Any),
    kNoVulnChannel,
    0u,
    kTraitUnit, kTraitUnit, kTraitUnit, kTraitUnit, kTraitUnit,
    0u,
    0u,
    0u,
    0u,
};

} // namespace

const MonsterTraits& monster_traits(std::uint8_t kind) {
    const std::size_t i = static_cast<std::size_t>(kind);
    if (i >= kMobKindCount) return kDefaultRow;
    return kMonsterTraits[i];
}

std::size_t monster_trait_authored_count() {
    std::size_t n = 0;
    for (std::size_t i = 0; i < kMobKindCount; ++i)
        if (kMonsterTraits[i].authored != 0u) ++n;
    return n;
}

// ---------------------------------------------------------------------------
// Wet query
// ---------------------------------------------------------------------------

bool cell_wet(const std::uint32_t* medium, int x, int y, int z) {
    if (!medium) return false;
    const std::size_t ci =
        macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z));
    return (medium[ci] & 0xFFFFu) >= kWetQuanta;
}

bool pos_wet(const std::uint32_t* medium, const vec3& pos) {
    if (!medium) return false;
    // floor(), not a truncating cast: a body standing at x = -0.4 sits in cell -1,
    // and `static_cast<int>` would put it in cell 0 on the far side of the wrap.
    // Positions are wrapped into [0, kWorldExtent) by physics, so this only bites on
    // a caller passing an unwrapped delta — which wrap_macro then fixes anyway.
    const float inv = 1.0f / kCellSize;
    const int cx = static_cast<int>(std::floor(pos.x * inv));
    const int cy = static_cast<int>(std::floor(pos.y * inv));
    const int cz = static_cast<int>(std::floor(pos.z * inv));
    return cell_wet(medium, cx, cy, cz);
}

// ---------------------------------------------------------------------------
// Terrain-keyed multipliers
// ---------------------------------------------------------------------------

float trait_wet_regen_hps(std::uint8_t kind) {
    return static_cast<float>(monster_traits(kind).wetRegenMilliHps) * 0.001f;
}

// ---------------------------------------------------------------------------
// Counterplay
// ---------------------------------------------------------------------------

std::int16_t trait_counterplay_damage(std::uint8_t kind, std::uint8_t channel,
                                      std::int16_t base, std::int16_t maxHp) {
    const MonsterTraits& t = monster_traits(kind);
    if (t.vulnChannel == kNoVulnChannel || t.vulnFloorPct == 0u) return base;
    if (t.vulnChannel != channel) return base;
    if (maxHp <= 0) return base;   // a mob with no maximum is a spawn bug, not a plant

    // Ceiling on integers, matching the reference's Math.ceil. Computed in int so a
    // level-12 boss's 5,000 HP x 100% cannot overflow the i16 the caller passes.
    const int mx = static_cast<int>(maxHp);
    const int pct = static_cast<int>(t.vulnFloorPct);
    int floorDmg = (mx * pct + 99) / 100;
    // A 100% row is authored as "at least maxHp + 1" — an overkill rather than a hit
    // that leaves the body on exactly zero through some other rounding path.
    if (pct >= 100) floorDmg = mx + 1;
    if (floorDmg > 32767) floorDmg = 32767;
    return base >= static_cast<std::int16_t>(floorDmg)
               ? base
               : static_cast<std::int16_t>(floorDmg);
}

// ---------------------------------------------------------------------------
// Armour installation
// ---------------------------------------------------------------------------

bool sync_monster_armour(Registry& reg, Entity e, std::uint8_t kind) {
    if (!reg.valid(e)) return false;
    const MonsterTraits& t = monster_traits(kind);

    bool any = false;
    for (std::size_t i = 0; i < kDamageChannels; ++i)
        if (t.resist[i] != 0) any = true;

    if (!any) {
        // REMOVE rather than leave a zeroed component behind. A zero-resist Armour is
        // functionally inert, but it would make `apply_damage`'s `try_get<Armour>` hit
        // on every mob in the game — 68 of 69 kinds — turning a storage miss into a
        // pointer chase per hit for no mitigation at all.
        if (reg.all_of<Armour>(e)) reg.remove<Armour>(e);
        return false;
    }

    Armour a;
    for (std::size_t i = 0; i < kDamageChannels; ++i) a.resist[i] = t.resist[i];
    // Idempotent: emplace_or_replace, so a second call cannot stack or assert.
    reg.emplace_or_replace<Armour>(e, a);
    return true;
}

} // namespace giga::game
