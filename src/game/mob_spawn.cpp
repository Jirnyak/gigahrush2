#include "game/mob_spawn.h"

#include <vector>

#include "core/math.h"
#include "ecs/components.h"
#include "world/macro_grid.h"
#include "world/world.h"

namespace giga::game {

namespace {

// splitmix64-style scrambler, same as population.cpp. Keeps spawning
// reproducible without pulling in <random>.
std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// Mobs stand on the module's internal ground storey, one cell above the base
// slab that floor_gen lays at z=0 — same convention as the alife crowd
// (population.cpp). A floor NUMBER is a label, not a Z band ([floors.md]).
constexpr int kGroundZ = 1;

// Attempts per mob to find a standable cell before giving up on that one. A
// Derelict floor is 38% gap and 12% holes, so a handful of rejections is normal;
// this bound is what keeps a pathological floor from spinning.
constexpr int kPlaceTries = 24;

// Tier tint. This is a **gameplay read**, not decoration: in a dark corridor the
// player must be able to tell a monster from a civilian instantly, so the palette
// is split by axis rather than by hue-picking — monsters own the red/dark axis and
// people own green-teal/blue/violet/cyan/amber (faction.h).
//
// The first attempt did pick hues, and collided: boss yellow (1.00, 0.92, 0.30)
// was nearly indistinguishable from faction amber (0.95, 0.80, 0.22), and trash
// grey-khaki read as wall. Brightness now rises with tier along one axis, so a
// bigger threat is simply a hotter red.
//
// Render-only: deleting this changes pixels, never outcomes.
vec3 tier_color(MobTier tier, std::uint32_t jitterKey) {
    static const vec3 kTierHue[static_cast<std::size_t>(MobTier::Count)] = {
        {0.30f, 0.26f, 0.22f}, // Trash  — near-black; chaff should barely register
        {0.42f, 0.30f, 0.18f}, // Light  — dark olive
        {0.56f, 0.26f, 0.15f}, // Medium — dark rust
        {0.68f, 0.14f, 0.13f}, // Heavy  — deep blood
        {0.90f, 0.31f, 0.36f}, // Elite  — samosbor red (kSamosborRed)
        {1.00f, 0.58f, 0.52f}, // Boss   — red-shifted near-white, unmistakable
    };
    std::size_t i = static_cast<std::size_t>(tier);
    if (i >= static_cast<std::size_t>(MobTier::Count)) i = 0;
    vec3 c = kTierHue[i];
    std::uint32_t h = mix(jitterKey);
    float j = (static_cast<float>(h & 0xFFu) / 255.0f - 0.5f) * 0.14f;
    return vec3{clamp01(c.x + j), clamp01(c.y + j), clamp01(c.z + j)};
}

// Which of the six signed floor anchors a floor number sits nearest. The
// reference keys habitat off anchors rather than exact floors, so a mob's
// floorMask is matched against the nearest one.
FloorBit anchor_for_floor(int floorZ) {
    struct Anchor { int z; FloorBit bit; };
    static const Anchor kAnchors[] = {
        {-50, FloorBit::ZMinus50}, {-36, FloorBit::ZMinus36},
        {-26, FloorBit::ZMinus26}, {0, FloorBit::Z0},
        {14, FloorBit::ZPlus14},   {30, FloorBit::ZPlus30},
    };
    FloorBit best = FloorBit::Z0;
    int bestD = -1;
    for (const Anchor& a : kAnchors) {
        int d = floorZ - a.z;
        if (d < 0) d = -d;
        if (bestD < 0 || d < bestD) { bestD = d; best = a.bit; }
    }
    return best;
}

// Body half-extents for a mob. Derived from tier so a Boss is physically bigger
// than a Trash mob without needing an authored size column the reference does
// not have.
vec3 mob_half_extents(MobTier tier) {
    switch (tier) {
        case MobTier::Trash:  return vec3{0.30f, 0.30f, 0.35f};
        case MobTier::Light:  return vec3{0.35f, 0.35f, 0.55f};
        case MobTier::Medium: return vec3{0.42f, 0.42f, 0.80f};
        case MobTier::Heavy:  return vec3{0.55f, 0.55f, 1.00f};
        case MobTier::Elite:  return vec3{0.60f, 0.60f, 1.20f};
        case MobTier::Boss:   return vec3{0.90f, 0.90f, 1.70f};
        default:              return vec3{0.40f, 0.40f, 0.70f};
    }
}

} // namespace

FloorTheme theme_for_kind(FloorKind kind) {
    switch (kind) {
        case FloorKind::Residential: return FloorTheme::Living;
        case FloorKind::Commercial:  return FloorTheme::Ministry;
        case FloorKind::Industrial:  return FloorTheme::Maintenance;
        case FloorKind::Derelict:    return FloorTheme::Hell;
        default:                     return FloorTheme::Ministry;
    }
}

std::uint8_t danger_for_hostility(float hostility) {
    float h = hostility < 0.0f ? 0.0f : (hostility > 1.0f ? 1.0f : hostility);
    // 0..1 -> 1..5, so a spec's 0.05 hub reads danger 1 and its 0.90 derelict 5.
    int d = 1 + static_cast<int>(h * 4.0f + 0.5f);
    return static_cast<std::uint8_t>(d < 1 ? 1 : (d > 5 ? 5 : d));
}

std::uint32_t spawn_floor_mobs(Registry& reg, const World& world,
                               int floorNumber, std::uint8_t danger,
                               FloorTheme theme, LayerId layer,
                               std::uint32_t seed, std::uint32_t cap) {
    const MacroGrid& grid = world.grid();

    std::uint32_t want =
        static_cast<std::uint32_t>(mob_count_for_floor(floorNumber, danger, theme));
    if (cap != 0 && want > cap) want = cap;
    if (want == 0) return 0;

    const std::uint8_t level = mob_level_for_floor(floorNumber, danger);
    const std::uint8_t floorBit =
        static_cast<std::uint8_t>(anchor_for_floor(floorNumber));

    // Build the roster for this floor once: every row whose habitat includes this
    // floor's anchor and which can actually be rolled (weight > 0 excludes the
    // hand-placed kinds like CREATOR). This is the "per-floor weights over one
    // global table" contract — nothing here redefines a stat row.
    std::uint8_t roster[kMobKindCount];
    std::uint32_t cumWeight[kMobKindCount];
    std::uint32_t rosterN = 0;
    std::uint32_t total = 0;
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];
        if ((m.floorMask & floorBit) == 0) continue;
        if (m.spawnWeightX10 == 0) continue;
        total += m.spawnWeightX10;
        roster[rosterN] = static_cast<std::uint8_t>(i);
        cumWeight[rosterN] = total;
        ++rosterN;
    }
    if (rosterN == 0 || total == 0) return 0;

    std::uint32_t spawned = 0;
    for (std::uint32_t n = 0; n < want; ++n) {
        std::uint32_t r = mix(seed ^ (n * 0x9e3779b9u) ^
                              static_cast<std::uint32_t>(floorNumber) * 0x85ebca6bu);

        // Weighted pick over the roster.
        std::uint32_t pick = r % total;
        std::uint32_t ri = 0;
        while (ri + 1 < rosterN && pick >= cumWeight[ri]) ++ri;
        const MobKind kind = static_cast<MobKind>(roster[ri]);
        const MobDef& def = mob_def(kind);

        // Standable cell: air on the ground storey. floor_gen guarantees a solid
        // slab at z=0, so "air here" is sufficient — no need to probe below.
        int cx = 0, cy = 0;
        bool placed = false;
        for (int t = 0; t < kPlaceTries; ++t) {
            std::uint32_t h = mix(r ^ (static_cast<std::uint32_t>(t) * 0xc2b2ae35u));
            cx = static_cast<int>((h >> 8) & 127u);
            cy = static_cast<int>((h >> 20) & 127u);
            if (grid.cell(cx, cy, kGroundZ) == kCellAir) { placed = true; break; }
        }
        if (!placed) continue;  // dense floor, no room for this one

        const MobTier tier = static_cast<MobTier>(def.tier);
        const vec3 half = mob_half_extents(tier);

        Entity e = reg.create();
        Transform tr;
        // Centre the body on the cell and sit it on the floor of that cell.
        tr.pos = vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
                      (static_cast<float>(cy) + 0.5f) * kCellSize,
                      static_cast<float>(kGroundZ) * kCellSize + half.z};
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<Velocity>(e);
        reg.emplace<AABB>(e, AABB{half});
        // Immobile kinds (turrets, plants, spore carpets) are not moved by
        // gravity — they are part of the architecture, not bodies in it.
        if (!has_flag(def.aiFlags, AiFlag::Immobile))
            reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
        reg.emplace<Renderable>(e, Renderable{tier_color(tier, r)});

        const std::uint16_t hp = mob_hp_at_level(def.hp, level);
        reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(kind), level,
                                      static_cast<std::int16_t>(hp),
                                      static_cast<std::int16_t>(hp)});
        ++spawned;
    }
    return spawned;
}

std::uint32_t despawn_layer_mobs(Registry& reg, LayerId layer) {
    // Collect first, then destroy: destroying while iterating a view invalidates
    // it. The list is bounded by the 4096 live-actor budget.
    std::vector<Entity> doomed;
    auto view = reg.view<const MobRef, const Transform>();
    for (auto e : view)
        if (view.get<const Transform>(e).layer == layer) doomed.push_back(e);
    for (Entity e : doomed) reg.destroy(e);
    return static_cast<std::uint32_t>(doomed.size());
}

std::uint32_t count_layer_mobs(const Registry& reg, LayerId layer) {
    std::uint32_t n = 0;
    auto view = reg.view<const MobRef, const Transform>();
    for (auto e : view)
        if (view.get<const Transform>(e).layer == layer) ++n;
    return n;
}

} // namespace giga::game
