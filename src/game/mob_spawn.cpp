#include "game/mob_spawn.h"

#include "game/combat.h"

#include <vector>

#include "core/math.h"
#include "ecs/components.h"
#include "game/floor_gen.h"  // floor_room_stride
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

// Rooms drawn before a pack accepts one that already holds a pack.
//
// A deep floor's budget (up to 4096 heads) outruns its room count (256 on a
// stride-8 floor), so rooms MUST be shareable — "try a few unused ones, then take
// what you get" is the only termination rule that keeps a floor's head-count intact
// on exactly the floors that need the monsters most. Refusing to share would turn a
// spatial change into a population regression.
constexpr int kRoomTries = 24;

// Clamp a room-local coordinate into the interior, 1..span. The wall lattice sits
// on local 0, so 0 is never a legal standing cell even when it happens to be air
// (a knocked-out wall cell on a Derelict floor) — a monster in a doorway reads as a
// monster stuck in a wall.
int clamp_local(int v, int span) { return v < 1 ? 1 : (v > span ? span : v); }

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
                               std::uint32_t seed, std::uint32_t cap,
                               FloorKind kind) {
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

    // The room lattice, straight from the generator so the two can never disagree
    // about where a wall is. A room is the (stride-1)^2 interior at local 1..span.
    // Clamped rather than trusted. The authored strides are 8/16/32, but a stride of
    // 1 leaves a room with no interior and a stride above 128 makes the room count
    // zero — a modulo by zero followed by an out-of-bounds write, the kind of crash
    // that appears only the day someone authors a one-room floor. Clamping here
    // keeps every index below in range by construction: span <= 127 and
    // x0 + span <= 127.
    int stride = floor_room_stride(kind);
    if (stride < 2) stride = 2;
    if (stride > kMacroDim) stride = kMacroDim;
    const int roomsPerAxis = kMacroDim / stride;
    const int span = stride - 1;
    // One byte per room, sized from the real room count rather than a worst-case
    // constant: a std::vector here is a single allocation at FLOOR LOAD, which is
    // not a hot path (the same call is about to create up to 4096 entities), and it
    // is what makes a future tighter room pitch impossible to overflow.
    std::vector<std::uint8_t> packsInRoom(
        static_cast<std::size_t>(roomsPerAxis * roomsPerAxis), 0u);

    std::uint32_t spawned = 0;
    std::uint32_t packSeq = 0;

    // ONE ITERATION IS ONE PACK, not one monster. A pack that places anything
    // places at least its anchor head, so `want` iterations is a hard upper bound
    // even in the degenerate all-Loner case — the loop cannot spin.
    for (std::uint32_t p = 0; p < want && spawned < want; ++p) {
        const std::uint32_t r =
            mix(seed ^ (p * 0x9e3779b9u) ^
                static_cast<std::uint32_t>(floorNumber) * 0x85ebca6bu);

        // 1. Draw a room, preferring an empty one. This is the entire difference
        //    between a floor that has quiet rooms in it and a floor that is evenly
        //    salted: an independent cell per monster fills 134 of 256 rooms on a
        //    stride-8 floor from 194 heads, so nowhere is ever empty.
        int room = 0;
        for (int t = 0; t < kRoomTries; ++t) {
            const std::uint32_t h =
                mix(r ^ (static_cast<std::uint32_t>(t) * 0x27220a95u));
            const int rx = static_cast<int>(
                (h >> 8) % static_cast<std::uint32_t>(roomsPerAxis));
            const int ry = static_cast<int>(
                (h >> 20) % static_cast<std::uint32_t>(roomsPerAxis));
            room = ry * roomsPerAxis + rx;
            if (packsInRoom[static_cast<std::size_t>(room)] == 0) break;
        }
        std::uint8_t& roomUse = packsInRoom[static_cast<std::size_t>(room)];
        if (roomUse < 0xFFu) ++roomUse;

        // 2. ONE kind for the whole room. Rolled from its own hash rather than from
        //    `r` directly, so the room draw and the kind draw are not correlated.
        const std::uint32_t pick = mix(r ^ 0x2545f491u) % total;
        std::uint32_t ri = 0;
        while (ri + 1 < rosterN && pick >= cumWeight[ri]) ++ri;
        const MobKind mobKind = static_cast<MobKind>(roster[ri]);
        const MobDef& def = mob_def(mobKind);

        // 3. How many heads, from the row's own authored band. Loner is forced to
        //    one rather than trusted to have packMax == 1: the columns are generated
        //    from a CSV, and a Loner row with a stray packMax is a data typo, not a
        //    design decision to place five of something that hunts alone.
        std::uint32_t heads = 1;
        if (static_cast<MobPackMode>(def.packMode) != MobPackMode::Loner) {
            const std::uint32_t lo = def.packMin ? def.packMin : 1u;
            const std::uint32_t hi = def.packMax > lo ? def.packMax : lo;
            heads = lo + mix(r ^ 0x165667b1u) % (hi - lo + 1u);
        }
        // The budget is the budget: the last pack of a floor is truncated rather
        // than allowed to overshoot it.
        if (heads > want - spawned) heads = want - spawned;

        // 4. The pack's anchor: a standable cell inside the room. floor_gen
        //    guarantees a solid slab at z=0, so "air here" is sufficient.
        const int x0 = (room % roomsPerAxis) * stride;
        const int y0 = (room / roomsPerAxis) * stride;
        int ax = 0, ay = 0;
        bool haveAnchor = false;
        for (int t = 0; t < kPlaceTries; ++t) {
            const std::uint32_t h =
                mix(r ^ (static_cast<std::uint32_t>(t + 1) * 0xc2b2ae35u));
            ax = x0 + 1 +
                 static_cast<int>((h >> 7) % static_cast<std::uint32_t>(span));
            ay = y0 + 1 +
                 static_cast<int>((h >> 19) % static_cast<std::uint32_t>(span));
            if (grid.cell(ax, ay, kGroundZ) == kCellAir) { haveAnchor = true; break; }
        }
        if (!haveAnchor) continue;  // a room filled solid with rubble

        // The cohesion key. Sequential rather than hashed so the first 255 packs on
        // a floor are guaranteed distinct — a hash over 255 buckets would collide
        // after about 19 packs (birthday), which would fuse unrelated groups'
        // destinations on every floor instead of only on the crowded ones.
        const std::uint8_t packId =
            static_cast<std::uint8_t>(packSeq % kPackIdSpan + 1u);
        ++packSeq;

        int spread = static_cast<int>(def.packSpread);
        if (heads > 1 && spread < 1) spread = 1;  // a group needs somewhere to stand

        const MobTier tier = static_cast<MobTier>(def.tier);
        const vec3 half = mob_half_extents(tier);
        const std::uint16_t hp = mob_hp_at_level(def.hp, level);

        for (std::uint32_t k = 0; k < heads; ++k) {
            int cx = ax, cy = ay;
            if (k != 0) {
                bool placed = false;
                const std::uint32_t sp = static_cast<std::uint32_t>(2 * spread + 1);
                for (int t = 0; t < kPlaceTries; ++t) {
                    const std::uint32_t h =
                        mix(r ^ ((k * 0x9e3779b9u + static_cast<std::uint32_t>(t)) *
                                 0x7feb352du));
                    const int dx = static_cast<int>((h >> 6) % sp) - spread;
                    const int dy = static_cast<int>((h >> 17) % sp) - spread;
                    // The ROOM wins over packSpread. A Roamer's authored 10-cell
                    // spread inside a 7-cell apartment reads as "anywhere in this
                    // room", which is the honest resolution: letting the spread win
                    // would push half the pack through the walls into two other
                    // rooms and undo the grouping this whole function exists for.
                    cx = x0 + clamp_local(ax - x0 + dx, span);
                    cy = y0 + clamp_local(ay - y0 + dy, span);
                    if (grid.cell(cx, cy, kGroundZ) == kCellAir) {
                        placed = true;
                        break;
                    }
                }
                if (!placed) continue;
            }

            // Per-HEAD hash. `r` is per-pack now, so reusing it here would give a
            // whole pack one colour jitter and — much worse — one initial attack
            // cooldown, putting eight monsters in a room into perfect lockstep. That
            // is the very thing the stagger below exists to prevent, and packs make
            // it far more likely than independent placement ever did.
            const std::uint32_t rh = mix(r ^ (k * 0x9e3779b9u) ^ 0x51ed270bu);

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
            reg.emplace<Renderable>(e, Renderable{tier_color(tier, rh)});

            reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(mobKind), level,
                                          static_cast<std::int16_t>(hp),
                                          static_cast<std::int16_t>(hp), packId});
            // Staggered initial cooldown so a room full of mobs does not swing in
            // lockstep on the frame the player walks in.
            reg.emplace<MobCombat>(
                e, MobCombat{static_cast<std::uint16_t>(rh % (def.attackCdMs + 1u))});
            ++spawned;
        }
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
