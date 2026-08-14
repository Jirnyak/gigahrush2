#include "core/rng.h"
#include "game/mob_spawn.h"

#include "game/combat.h"

#include <algorithm>
#include <vector>

#include "core/math.h"
#include "core/wrap.h"        // wrap_delta_f — the census and the placement must agree
#include "ecs/components.h"
#include "game/floor_gen.h"  // floor_room_stride, floor_room_mask
#include "game/wander.h"     // wander_init — a fog mob with no WanderTarget is a statue
#include "game/monster_traits.h"
#include "sim/fluid.h"       // fluid_data/fluid_at — nothing stands in a sealed sump
#include "world/macro_grid.h"
#include "world/world.h"

namespace giga::game {

namespace {


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

// A cell a monster may be placed in: air, and not standing water (unless water-based).
//
// A sump's basin is sealed on all four sides by its kerb ([floor_gen.h] Standing
// water), so a head placed there is a monster in a box: it can never reach the player,
// the player can never reach it, and it counts against the floor's budget forever.
// Today's basin cells are HALF-SOLID, so the air test already refuses them on type —
// the water test states the rule rather than the accident, and it is the half that
// survives a floor kind seeding an open pool, where the cell is plain air.
//
// `wet` is the layer's resolved fluid array (nullptr on a dry layer), fetched once per
// spawn call rather than per candidate — a deep floor tests up to 98,304 candidates.
bool placeable(const float* wet, const World& w, int x, int y, int z,
               std::uint8_t kind = 0xFFu) {
    if (!floor_standable(w, x, y, z)) return false;
    if (kind != 0xFFu && trait_allows_wet_spawn(kind)) return true;
    return fluid_at(wet, x, y, z) < kFluidMinFlow;
}

// A floor's spawn roster: the rows a weighted draw may pick, with prefix sums.
//
// One of these per ROOM KIND plus one unfiltered, built in a single 69-row pass. That
// is 11 bit tests per surviving row — 759 in the worst case, over a permanently
// cache-resident 2,484 B table, once per floor load — instead of rebuilding a roster
// per pack, which at a deep floor's 4096-head budget would be 4096 x 69 row tests.
struct Roster {
    std::uint8_t kind[kMobKindCount];
    std::uint32_t cum[kMobKindCount];
    std::uint32_t n = 0;
    std::uint32_t total = 0;
};

void roster_add(Roster& r, std::size_t row, std::uint32_t weight) {
    r.total += weight;
    r.kind[r.n] = static_cast<std::uint8_t>(row);
    r.cum[r.n] = r.total;
    ++r.n;
}



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
    std::uint32_t h = hash_u32(jitterKey);
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

// World position of a mob of this tier standing on cell (cx, cy) of the ground
// storey. Split out because the FOG spawner has to know the exact position before
// it commits to it: its candidate cell is only legal if `samosbor_census` would
// count the resulting body inside the outer radius, and the body sits `half.z`
// above the cell floor — up to 1.70 m for a Boss, which is enough to push a
// 40 m-away candidate out of a 40 m census bubble.
vec3 mob_stand_pos(int cx, int cy, int cz, const vec3& half) {
    return vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
                (static_cast<float>(cy) + 0.5f) * kCellSize,
                static_cast<float>(cz) * kCellSize + half.z};
}

// Create ONE live monster. **The single place a mob entity's component set is
// written**, so the floor-load spawner and the samosbor fog spawner cannot drift
// apart about what a monster *is*.
//
// That is not a stylistic preference here. main.cpp carried the same bug twice
// because it has two floor-ride paths (the keyboard one and the --shot one) and the
// first fix touched only one; the comment at its second site says so. A mob missing
// MobCombat is invisible to `mob_attack_step`, and one missing GravityAffected hangs
// in the air — both are silent, and both are what a second hand-rolled emplace block
// eventually produces.
//
// `headHash` is the per-HEAD scramble: it drives the colour jitter and the initial
// attack cooldown, so two heads created from one pack hash must not share it or a
// room full of monsters swings in lockstep.
Entity emplace_mob(Registry& reg, LayerId layer, MobKind kind, const MobDef& def,
                   std::uint8_t level, int cx, int cy, int cz,
                   std::uint32_t headHash, std::uint8_t packId) {
    const MobTier tier = static_cast<MobTier>(def.tier);
    const vec3 half = mob_half_extents(tier);
    const std::uint16_t hp = mob_hp_at_level(def.hp, level);

    Entity e = reg.create();
    Transform tr;
    // Centre the body on the cell and sit it on the floor of that cell.
    tr.pos = mob_stand_pos(cx, cy, cz, half);
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{half});
    // Immobile kinds (turrets, plants, spore carpets) are not moved by gravity —
    // they are part of the architecture, not bodies in it.
    if (!has_flag(def.aiFlags, AiFlag::Immobile))
        reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
    reg.emplace<Renderable>(e, Renderable{tier_color(tier, headHash)});

    // Universal mass ([ecs/components.h]): the table's authored kilograms.
    reg.emplace<Mass>(e, Mass{static_cast<float>(def.massG) * 0.001f});
    reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(kind), level,
                                  static_cast<std::int16_t>(hp),
                                  static_cast<std::int16_t>(hp), packId});
    // Staggered initial cooldown so a room full of mobs does not swing in lockstep
    // on the frame the player walks in.
    reg.emplace<MobCombat>(
        e, MobCombat{static_cast<std::uint16_t>(headHash % (def.attackCdMs + 1u))});
    return e;
}

} // namespace

Entity spawn_mob_at(Registry& reg, LayerId layer, MobKind kind,
                    std::uint8_t level, int cx, int cy, int cz,
                    std::uint32_t salt) {
    if (static_cast<std::size_t>(kind) >= kMobKindCount) return entt::null;
    const MobDef& def = mob_def(kind);
    const std::uint8_t lv = level < 1 ? 1 : (level > 12 ? 12 : level);
    // Same scramble family the pack placer feeds emplace_mob, so two console
    // spawns in a row do not share colour jitter or swing in lockstep.
    const std::uint32_t headHash =
        (salt ^ 0x9e3779b9u) * 0x85ebca6bu + static_cast<std::uint32_t>(kind);
    return emplace_mob(reg, layer, kind, def, lv, cx, cy, cz, headHash,
                       /*packId=*/0);
}

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
    const float* wet = fluid_data(world);  // resolved ONCE; see placeable

    std::uint32_t want =
        static_cast<std::uint32_t>(mob_count_for_floor(floorNumber, danger, theme));
    if (cap != 0 && want > cap) want = cap;
    if (want == 0) return 0;

    const std::uint8_t level = mob_level_for_floor(floorNumber, danger);
    const std::uint8_t floorBit =
        static_cast<std::uint8_t>(anchor_for_floor(floorNumber));

    // Build the rosters for this floor once: every row whose habitat includes this
    // floor's anchor and which can actually be rolled (weight > 0 excludes the
    // hand-placed kinds like CREATOR). This is the "per-floor weights over one
    // global table" contract — nothing here redefines a stat row.
    //
    // **`MobDef::roomMask` gets its first reader here.** All 69 rows author a `rooms`
    // column and nothing in the tree had ever looked at one, so the whole ecology
    // column was decoration. A room now draws only from the kinds authored to live in
    // that kind of room.
    //
    // Slot kFloorRoomBits is the unfiltered roster, and it is a FALLBACK rather than a
    // spare: the room filter empties the roster outright on real floors. Measured over
    // data/mobs.csv against the six habitat anchors — bathroom is empty at Z-50, Z+14
    // and Z+30; kitchen at Z-50; smoking at Z-26; hq at Z+14. A room whose roster came
    // out empty would silently drop that pack, and a floor whose mix leans on such a
    // bit would lose a slice of its whole population. So an empty room roster falls
    // back to the floor's, exactly as samosbor_fog_roster relaxes rather than starving
    // ([mob_spawn.h]).
    Roster rosters[kFloorRoomBits + 1] = {};
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];
        if ((m.floorMask & floorBit) == 0) continue;
        if (m.spawnWeightX10 == 0) continue;
        roster_add(rosters[kFloorRoomBits], i, m.spawnWeightX10);
        for (std::size_t b = 0; b < kFloorRoomBits; ++b)
            if ((m.roomMask & (1u << b)) != 0)
                roster_add(rosters[b], i, m.spawnWeightX10);
    }
    const Roster& floorRoster = rosters[kFloorRoomBits];
    if (floorRoster.n == 0 || floorRoster.total == 0) return 0;

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
            hash_u32(seed ^ (p * 0x9e3779b9u) ^
                static_cast<std::uint32_t>(floorNumber) * 0x85ebca6bu);

        // 1. Draw a room, preferring an empty one. This is the entire difference
        //    between a floor that has quiet rooms in it and a floor that is evenly
        //    salted: an independent cell per monster fills 134 of 256 rooms on a
        //    stride-8 floor from 194 heads, so nowhere is ever empty.
        int room = 0;
        for (int t = 0; t < kRoomTries; ++t) {
            const std::uint32_t h =
                hash_u32(r ^ (static_cast<std::uint32_t>(t) * 0x27220a95u));
            const int rx = static_cast<int>(
                (h >> 8) % static_cast<std::uint32_t>(roomsPerAxis));
            const int ry = static_cast<int>(
                (h >> 20) % static_cast<std::uint32_t>(roomsPerAxis));
            room = ry * roomsPerAxis + rx;
            if (packsInRoom[static_cast<std::size_t>(room)] == 0) break;
        }
        std::uint8_t& roomUse = packsInRoom[static_cast<std::size_t>(room)];
        if (roomUse < 0xFFu) ++roomUse;

        const int rx = room % roomsPerAxis;
        const int ry = room / roomsPerAxis;

        // 2. ONE kind for the whole room, drawn from THAT ROOM'S roster. Rolled from
        //    its own hash rather than from `r` directly, so the room draw and the kind
        //    draw are not correlated.
        //
        //    `floor_room_mask` is keyed on (kind, floorNumber, room) and on nothing
        //    else, which is what lets the container spawner agree with this about what
        //    room 5 is without either storing a tag ([floor_gen.h]).
        const int bit =
            floor_room_bit_index(floor_room_mask(kind, floorNumber, rx, ry));
        const Roster& rs =
            (bit >= 0 && rosters[bit].n != 0) ? rosters[bit] : floorRoster;
        const std::uint32_t pick = hash_u32(r ^ 0x2545f491u) % rs.total;
        std::uint32_t ri = 0;
        while (ri + 1 < rs.n && pick >= rs.cum[ri]) ++ri;
        const MobKind mobKind = static_cast<MobKind>(rs.kind[ri]);
        const MobDef& def = mob_def(mobKind);

        // 3. How many heads, from the row's own authored band. Loner is forced to
        //    one rather than trusted to have packMax == 1: the columns are generated
        //    from a CSV, and a Loner row with a stray packMax is a data typo, not a
        //    design decision to place five of something that hunts alone.
        std::uint32_t heads = 1;
        if (static_cast<MobPackMode>(def.packMode) != MobPackMode::Loner) {
            const std::uint32_t lo = def.packMin ? def.packMin : 1u;
            const std::uint32_t hi = def.packMax > lo ? def.packMax : lo;
            heads = lo + hash_u32(r ^ 0x165667b1u) % (hi - lo + 1u);
        }
        // The budget is the budget: the last pack of a floor is truncated rather
        // than allowed to overshoot it.
        if (heads > want - spawned) heads = want - spawned;

        // 4. The pack's anchor: a standable cell inside the room. floor_gen
        //    guarantees a solid slab at z=0, so "air, and dry" is sufficient.
        const int x0 = rx * stride;
        const int y0 = ry * stride;
        int ax = 0, ay = 0, packH = 0;
        bool haveAnchor = false;
        for (int t = 0; t < kPlaceTries; ++t) {
            const std::uint32_t h =
                hash_u32(r ^ (static_cast<std::uint32_t>(t + 1) * 0xc2b2ae35u));
            ax = x0 + 1 +
                 static_cast<int>((h >> 7) % static_cast<std::uint32_t>(span));
            ay = y0 + 1 +
                 static_cast<int>((h >> 19) % static_cast<std::uint32_t>(span));
            // The pack's storey, drawn over the WHOLE gravity axis: the torus
            // has no privileged floor, so packs live on every storey of the
            // tower. Members below share it — a pack is one room on one storey.
            packH = static_cast<int>(hash_u32(h ^ 0xA5A5A5A5u) %
                                     static_cast<std::uint32_t>(kMacroDim));
            if (placeable(wet, world, ax, ay, packH, static_cast<std::uint8_t>(mobKind))) { haveAnchor = true; break; }
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

        for (std::uint32_t k = 0; k < heads; ++k) {
            int cx = ax, cy = ay;
            if (k != 0) {
                bool placed = false;
                const std::uint32_t sp = static_cast<std::uint32_t>(2 * spread + 1);
                for (int t = 0; t < kPlaceTries; ++t) {
                    const std::uint32_t h =
                        hash_u32(r ^ ((k * 0x9e3779b9u + static_cast<std::uint32_t>(t)) *
                                 0x7feb352du));
                    const int dx = static_cast<int>((h >> 6) % sp) - spread;
                    const int dy = static_cast<int>((h >> 17) % sp) - spread;
                    // The ROOM wins over packSpread. A Roamer's authored 10-cell
                    // spread inside a 7-cell apartment reads as "anywhere in this
                    // room", which is the honest resolution: letting the spread win
                    // would push half the pack through the walls into two other
                    // rooms and undo the grouping this whole function exists for.
                    cx = x0 + std::clamp(ax - x0 + dx, 1, span);
                    cy = y0 + std::clamp(ay - y0 + dy, 1, span);
                    if (placeable(wet, world, cx, cy, packH, static_cast<std::uint8_t>(mobKind))) {
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
            const std::uint32_t rh = hash_u32(r ^ (k * 0x9e3779b9u) ^ 0x51ed270bu);
            emplace_mob(reg, layer, mobKind, def, level, cx, cy, packH, rh,
                        packId);
            ++spawned;
        }
    }
    return spawned;
}

std::uint32_t despawn_layer_mobs(Registry& reg, LayerId layer) {
    // Collect first, then destroy: destroying while iterating a view invalidates
    // it. The list is bounded by the 4096 live-actor budget.
    auto view = reg.view<const MobRef, const Transform>();
    std::vector<Entity> doomed;
    doomed.reserve(view.size_hint());
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

// ---------------------------------------------------------------------------
// Fog spawn — the samosbor's spawn pressure, wired
// ---------------------------------------------------------------------------

namespace {

// Fog spawn entropy salt, distinct from every constant the floor-load spawner uses
// so a fog arrival and a load-time pack that happen to share a (tick, floor) pair
// cannot draw the same kind into the same cell.
constexpr std::uint32_t kFogSalt = 0xF0605EEDu;

// Attempts per head to find a legal fog arrival cell.
//
// The GEOMETRY almost never costs anything: candidates are drawn from the
// (2*20+1)^2 = 1681-cell square around the anchor and the legal annulus between the
// two census radii is pi*(20^2 - 12^2)/1681 = 47.8% of it, so 32 tries clear the
// geometric test with probability 1 - 0.522^32, about 1e-9. What actually spends the
// budget is the AIR test: a Derelict floor is 38% gap and 12% holes, and a player
// standing in a sealed stairwell can legitimately have no legal arrival cell at all.
// Giving up on that head is the correct answer — the alternative is spawning inside
// a wall.
constexpr int kFogPlaceTries = 32;

// The half of a fog tick that needs no anchor: a FogSpawn exists only inside an
// Active phase, and both edges of that window are enforced here rather than at two
// call sites. `activeEnded` is the ordinary edge; `warningBegan` is the safety net
// for a cycle whose end was never observed (samosbor_step's four-crossing clamp, a
// loaded save, a ride taken mid-samosbor).
std::uint32_t fog_phase_cleanup(Registry& reg, const SamosborTransition& tr,
                                LayerId layer) {
    if (!tr.activeEnded && !tr.warningBegan) return 0;
    return despawn_layer_fog_mobs(reg, layer);
}

} // namespace

FogRoster samosbor_fog_roster(int floorNumber, std::uint16_t samosborCount) {
    const std::uint8_t floorBit =
        static_cast<std::uint8_t>(anchor_for_floor(floorNumber));

    // Pass 1: the habitat roster, UNGATED, to learn this floor's first unlock — the
    // lowest minSamosbor any kind that could ever stand here carries. Reading it off
    // the floor's own content is what makes the relaxation data-driven; a constant
    // would be a guess, and the reference's guess (default the count to 1) is wrong
    // for ZMinus50, whose lowest is 2.
    std::uint16_t lowest = 0xFFFFu;
    std::uint32_t habitatN = 0;
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];
        if ((m.floorMask & floorBit) == 0) continue;
        if (m.spawnWeightX10 == 0) continue;
        ++habitatN;
        const std::uint16_t need = static_cast<std::uint16_t>(m.minSamosbor);
        if (need < lowest) lowest = need;
    }

    FogRoster out;
    if (habitatN == 0) return out;  // no kind is authored for this anchor at all

    // `samosborCount >= lowest` is EXACTLY the condition "the gated roster is
    // non-empty", so lifting the count to `lowest` relaxes if and only if the gate
    // would have emptied the roster, and by the least amount that works. Monotone by
    // construction: a higher count can only ever admit a superset.
    out.effCount = samosborCount >= lowest ? samosborCount : lowest;
    out.relaxed = out.effCount != samosborCount;

    // Pass 2: the same three filters plus the unlock. Prefix sums so one draw over
    // `total` picks a kind — a flat scan of at most 69 rows out of a 2,484 B
    // cache-resident table, at one build per fog tick.
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];
        if ((m.floorMask & floorBit) == 0) continue;
        if (m.spawnWeightX10 == 0) continue;
        if (!samosbor_allows_kind(m, out.effCount)) continue;
        out.total += m.spawnWeightX10;
        out.kind[out.n] = static_cast<std::uint8_t>(i);
        out.cumWeight[out.n] = out.total;
        ++out.n;
    }
    return out;
}

std::uint32_t despawn_layer_fog_mobs(Registry& reg, LayerId layer) {
    // Collect first, then destroy: destroying while iterating a view invalidates it.
    auto view = reg.view<const FogSpawn, const Transform>();
    std::vector<Entity> doomed;
    doomed.reserve(view.size_hint());
    for (auto e : view)
        if (view.get<const Transform>(e).layer == layer) doomed.push_back(e);
    for (Entity e : doomed) reg.destroy(e);
    return static_cast<std::uint32_t>(doomed.size());
}

std::uint32_t count_layer_fog_mobs(const Registry& reg, LayerId layer) {
    std::uint32_t n = 0;
    auto view = reg.view<const FogSpawn, const Transform>();
    for (auto e : view)
        if (view.get<const Transform>(e).layer == layer) ++n;
    return n;
}

FogTickReport samosbor_fog_tick_at(Registry& reg, const World& world,
                                   const SamosborState& st,
                                   const SamosborTransition& tr, LayerId layer,
                                   vec3 around, int floorNumber,
                                   std::uint8_t danger, std::uint64_t simTick) {
    FogTickReport out;
    out.despawned = fog_phase_cleanup(reg, tr, layer);

    // No pressure outside the Active phase. This is the gate the whole subsystem
    // hangs off, and it is why a 2% duty floor barely notices this function exists
    // while a 94% duty floor is running it almost continuously — the depth gradient
    // reaching the spawner with no `if (deep)` anywhere.
    if (!samosbor_active(st)) return out;

    // Cadence, forced onto the arrival tick. `activeBegan` matters more than it
    // looks: without it the first fog head lands up to kFogSpawnPeriodTicks after
    // the fog does, and on a floor whose whole Active phase is 30 s that is a 7%
    // dead window at the one moment the player is looking for the threat.
    if (!tr.activeBegan && (simTick % kFogSpawnPeriodTicks) != 0u) return out;

    const SamosborVariant variant = static_cast<SamosborVariant>(st.variant);
    const bool highRisk = danger >= kFogHighRiskDanger;

    out.census = samosbor_census(reg, layer, around, &world.grid());
    out.censused = true;
    out.target = samosbor_threat_target(floorNumber, variant, highRisk);
    out.headroom = samosbor_threat_headroom(out.census, highRisk);

    // Built BEFORE the early-outs below, at the cost of two 69-row scans every 2 s,
    // so the report always says what the unlock left available. A HUD or a test that
    // sees `spawned == 0` needs to know whether the budget was full or the roster was
    // empty, and those are opposite problems.
    const FogRoster roster = samosbor_fog_roster(floorNumber, st.count);
    out.rosterN = static_cast<std::uint8_t>(roster.n);
    out.effCount = roster.effCount;
    out.relaxed = roster.relaxed;

    // DEMAND is measured against `withinOuter`, not `withinNear`, and the constants
    // say so: kThreatPressureMax (7) is kThreatBackoffOuter (7) and kThreatSpikeMax
    // (10) is kThreatHardMaxOuter (10). The target band was calibrated against the
    // outer count; comparing it to the near count would ask for 7 hostiles inside
    // 24 m while the back-off refuses the 5th, and the tick would spin asking.
    const std::uint8_t demand =
        out.census.withinOuter < out.target
            ? static_cast<std::uint8_t>(out.target - out.census.withinOuter)
            : static_cast<std::uint8_t>(0);
    // Two independent brakes and both must hold: `demand` is what the floor WANTS,
    // `headroom` is what the back-off ALLOWS. The back-off wins ties by being the
    // smaller of the two.
    out.wanted = std::min(demand, out.headroom);
    if (out.wanted == 0) return out;
    if (roster.n == 0 || roster.total == 0) return out;

    const float* wet = fluid_data(world);  // resolved ONCE; see placeable
    const std::uint8_t level = mob_level_for_floor(floorNumber, danger);
    const float nearR2 = kThreatNearRadiusM * kThreatNearRadiusM;
    const float outerR2 = kThreatOuterRadiusM * kThreatOuterRadiusM;
    const int acx = wrap_macro(static_cast<int>(around.x / kCellSize));
    const int acy = wrap_macro(static_cast<int>(around.y / kCellSize));
    const int acz = wrap_macro(static_cast<int>(around.z / kCellSize));
    const std::uint32_t span =
        static_cast<std::uint32_t>(2 * kThreatOuterRadiusCells + 1);
    const std::uint32_t wanted = out.wanted;

    // Re-tested after EVERY head rather than trusting the headroom computed above,
    // which is what samosbor.h asks a caller to do: each arrival changes the census
    // the next one is judged against, and the hard cap has to be the last word even
    // if `wanted` was computed generously.
    ThreatCensus live = out.census;

    for (std::uint32_t i = 0; i < wanted; ++i) {
        if (!samosbor_fog_spawn_allowed(live, highRisk)) break;
        if (live.withinOuter >= out.target) break;

        const std::uint32_t r =
            hash_u32(kFogSalt ^ (static_cast<std::uint32_t>(simTick) * 0x9e3779b9u) ^
                ((i + 1u) * 0x85ebca6bu) ^
                (static_cast<std::uint32_t>(floorNumber) * 0x27220a95u));

        // KIND FIRST, cell second — the order is load-bearing. The body sits
        // `half.z` above the cell floor (1.70 m for a Boss), and the legality test
        // below is the census's own distance test on the FINAL position, so the cell
        // cannot be judged before the tier that decides how tall the thing is.
        const std::uint32_t pick = hash_u32(r ^ 0x2545f491u) % roster.total;
        std::uint32_t ri = 0;
        while (ri + 1 < roster.n && pick >= roster.cumWeight[ri]) ++ri;
        const MobKind kind = static_cast<MobKind>(roster.kind[ri]);
        const MobDef& def = mob_def(kind);
        const vec3 half = mob_half_extents(static_cast<MobTier>(def.tier));

        // A cell in the ANNULUS between the two census radii: 24 m..40 m from the
        // anchor. Never inside the near radius, because a monster appearing 5 m away
        // out of nothing is not pressure, it is a bug the player cannot distinguish
        // from one. They still count against `withinOuter`, so the budget sees them.
        int cx = 0, cy = 0;
        float d2 = 0.0f;
        bool placed = false;
        for (int t = 0; t < kFogPlaceTries; ++t) {
            const std::uint32_t h =
                hash_u32(r ^ (static_cast<std::uint32_t>(t + 1) * 0xc2b2ae35u));
            const int tx = wrap_macro(acx + static_cast<int>((h >> 7) % span) -
                                      kThreatOuterRadiusCells);
            const int ty = wrap_macro(acy + static_cast<int>((h >> 19) % span) -
                                      kThreatOuterRadiusCells);
            if (!placeable(wet, world, tx, ty, acz, static_cast<std::uint8_t>(kind))) continue;

            // The census's own arithmetic, on the exact position about to be
            // written. **This is the invariant that makes the budget terminate**:
            // anything spawned here is guaranteed to be counted by the next
            // samosbor_census, so the loop cannot add heads the gate never sees.
            // Getting it wrong is not a rounding error — a flying player at z = 180 m
            // is 88 cells above the ground storey, every arrival would fall outside
            // the 40 m bubble, the census would keep reporting an empty floor and the
            // spawner would run until the 4096-actor pool was gone. As written, that
            // player simply gets no fog spawns, which is the honest answer while
            // there is no air-spawn rule.
            const vec3 at = mob_stand_pos(tx, ty, acz, half);
            const float dx = wrap_delta_f(around.x, at.x, kWorldExtent);
            const float dy = wrap_delta_f(around.y, at.y, kWorldExtent);
            const float dz = wrap_delta_f(around.z, at.z, kWorldExtent);
            d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < nearR2 || d2 > outerR2) continue;
            cx = tx;
            cy = ty;
            placed = true;
            break;
        }
        if (!placed) continue;

        // ONE head, and `packMode` is deliberately ignored. A fog roster is full of
        // Crowd kinds with authored packs of 8..16, and the budget being spent is
        // measured in *threats near the player* with a ceiling of 7 — so honouring
        // one Crowd row would blow the whole band in a single draw and then the
        // back-off would starve the rest of the samosbor. Grouping is a floor-load
        // property ([mob_spawn.h] header); fog arrivals trickle. pack = 0 is the
        // matching truth for wander: "walks alone".
        Entity e = emplace_mob(reg, layer, kind, def, level, cx, cy, acz,
                               hash_u32(r ^ 0x51ed270bu), /*packId=*/0u);
        reg.emplace<FogSpawn>(e);
        ++out.spawned;

        // Exactly samosbor_census's two tests, applied to the head just added. The
        // `<= nearR2` branch is unreachable for all but an exact-boundary candidate
        // and is kept anyway: the moment it stops mirroring the census, the re-test
        // above starts answering a different question than the gate.
        if (live.withinOuter < 0xFFu) ++live.withinOuter;
        if (d2 <= nearR2 && live.withinNear < 0xFFu) ++live.withinNear;
    }

    // **A fog mob with no WanderTarget is a STATUE.** `wander_step` iterates
    // `view<Transform, Velocity, WanderTarget>` and `wander_init` runs only at floor
    // load (main.cpp's finish_floor_nav), so a head created mid-samosbor would stand
    // exactly where it appeared until something killed it — and it would still
    // attack, so it would read as a turret rather than as a bug. Reusing wander_init
    // rather than hand-rolling the node roll is deliberate: it already skips the
    // camera holder, skips anything that has a target, and refuses Immobile kinds a
    // destination, and a second copy of that roll is how the two would drift.
    //
    // Cost: one O(entities on layer) pass plus one std::vector that holds only the
    // heads just added, on the ticks that actually spawned — at most once every
    // kFogSpawnPeriodTicks (2 s).
    if (out.spawned != 0)
        out.wandering =
            wander_init(reg, layer, kFogSalt ^ static_cast<std::uint32_t>(simTick));
    return out;
}

FogTickReport samosbor_fog_tick(Registry& reg, const World& world,
                                const SamosborState& st,
                                const SamosborTransition& tr, LayerId layer,
                                Entity anchor, int floorNumber,
                                std::uint8_t danger, std::uint64_t simTick) {
    const Transform* tf =
        reg.valid(anchor) ? reg.try_get<Transform>(anchor) : nullptr;
    if (tf == nullptr || tf->layer != layer) {
        // Nothing to measure pressure around: the anchor died and has not been
        // re-possessed, or it is on another layer. The phase clean-up still has to
        // run — a death mid-samosbor would otherwise leak that samosbor's whole fog
        // population until some later cycle noticed — but nothing spawns.
        FogTickReport out;
        out.despawned = fog_phase_cleanup(reg, tr, layer);
        return out;
    }
    return samosbor_fog_tick_at(reg, world, st, tr, layer, tf->pos, floorNumber,
                                danger, simTick);
}

} // namespace giga::game
