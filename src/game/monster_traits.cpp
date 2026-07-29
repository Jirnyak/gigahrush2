// Trait readers. The DATA lives in the generated monster_traits_table.cpp; this file
// is the behaviour, and every function in it is either pure or a single component
// write.
#include "game/monster_traits.h"

#include <cmath>

#include "core/wrap.h"        // wrap_macro — x/y/z all wrap, so no bare divide
#include "game/combat.h"      // Armour, DamageChannel, kDamageChannels
#include "sim/fluid.h"        // fluid_at, kFluidMinFlow — the wet threshold has ONE owner
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

// x100 fixed point back to a float. One place, so a column that forgets to divide is
// a compile error rather than a monster moving 100x too fast.
constexpr float from_x100(std::uint16_t v) {
    return static_cast<float>(v) * 0.01f;
}

} // namespace

const MonsterTraits& monster_traits_default() { return kDefaultRow; }

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

bool cell_wet(const float* fluid, int x, int y, int z) {
    return fluid_at(fluid, x, y, z) >= kFluidMinFlow;
}

bool pos_wet(const float* fluid, const vec3& pos) {
    if (!fluid) return false;
    // floor(), not a truncating cast: a body standing at x = -0.4 sits in cell -1,
    // and `static_cast<int>` would put it in cell 0 on the far side of the wrap.
    // Positions are wrapped into [0, kWorldExtent) by physics, so this only bites on
    // a caller passing an unwrapped delta — which wrap_macro then fixes anyway.
    const float inv = 1.0f / kCellSize;
    const int cx = static_cast<int>(std::floor(pos.x * inv));
    const int cy = static_cast<int>(std::floor(pos.y * inv));
    const int cz = static_cast<int>(std::floor(pos.z * inv));
    return cell_wet(fluid, cx, cy, cz);
}

// ---------------------------------------------------------------------------
// Terrain-keyed multipliers
// ---------------------------------------------------------------------------

float trait_move_mult(std::uint8_t kind, bool wet) {
    const MonsterTraits& t = monster_traits(kind);
    return from_x100(wet ? t.wetMoveX100 : t.dryMoveX100);
}

float trait_damage_mult(std::uint8_t kind, bool wet) {
    const MonsterTraits& t = monster_traits(kind);
    return from_x100(wet ? t.wetDmgX100 : t.dryDmgX100);
}

float trait_incoming_mult(std::uint8_t kind, bool wet) {
    if (!wet) return 1.0f;   // drain armour exists only in the water
    return from_x100(monster_traits(kind).wetIncomingX100);
}

float trait_wet_regen_hps(std::uint8_t kind) {
    return static_cast<float>(monster_traits(kind).wetRegenMilliHps) * 0.001f;
}

// ---------------------------------------------------------------------------
// Counterplay
// ---------------------------------------------------------------------------

bool trait_has_vulnerability(std::uint8_t kind) {
    const MonsterTraits& t = monster_traits(kind);
    return t.vulnChannel != kNoVulnChannel && t.vulnFloorPct > 0u;
}

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
// Bait affinity
// ---------------------------------------------------------------------------

bool trait_takes_bait(std::uint8_t kind, BaitBit b) {
    return has_bait(monster_traits(kind).baitMask, b);
}

bool trait_takes_bait_any(std::uint8_t kind) {
    return monster_traits(kind).baitMask != 0u;
}

// ---------------------------------------------------------------------------
// Spawn terrain
// ---------------------------------------------------------------------------

bool trait_allows_wet_spawn(std::uint8_t kind) {
    return monster_traits(kind).terrain ==
           static_cast<std::uint8_t>(TerrainPref::Wet);
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

// ---------------------------------------------------------------------------
// Why each unauthored kind has no row
// ---------------------------------------------------------------------------

const char* monster_traits_unauthored_reason(std::uint8_t kind) {
    if (monster_traits(kind).authored != 0u) return "authored";

    // Answered in mob_behaviour.h instead — a radius, a pace, a reach or an incoming
    // multiplier. A trait row for one of these would DOUBLE the mechanic, which is the
    // specific mistake Панельник would have caused (0.58 x 0.58).
    switch (static_cast<MobKind>(kind)) {
        case MobKind::Panelnik:        // WallBrace: incoming 0.58 + reach 1.75 + pace
        case MobKind::Rebar:           // DebrisLurker: pace 1.22/0.68, damage 1.25/0.75
        case MobKind::Bezekhiy:        // DeadEcho: 7.5 m sight + facing damage 1.55/0.72
        case MobKind::Nelyud:          // CloseReveal: 6 m sight
        case MobKind::Treskotnik:      // FractureSprint: the whole burst cycle
        case MobKind::Sculpture:       // WeepingAngel: frozen_by_gaze
        case MobKind::Paupsina:        // WebSpitter: the strafing standoff
        case MobKind::DikiyMertvyak:   // CrowdShove: hurt pace 0.96
        case MobKind::SporeCarpet:     // LurkingFurniture: 2.15 m dormant radius
        case MobKind::KantselyarskiyIdol:  // OfficeField: 23 m
        case MobKind::Lishennyy:       // LightFollower: 30 m
        case MobKind::Shovnik:         // WallBias flag: pace 1.18/0.92, damage 1.20
        case MobKind::Betonoed:        // WallBias flag; WeakWallBreach is dead
            return "mob_behaviour";

        // Blocked on a per-cell LIGHT field. Nothing in this engine knows how bright a
        // cell is, and all four mechanics are "brighter is stronger/weaker".
        case MobKind::Lampovy:         // lampPowered
        case MobKind::Lampoglaz:       // lightLock
        case MobKind::Shadow:          // light 0.78 lit / 1.08 dark, pace AND damage
        case MobKind::GlubinnayaTen:   // secondBeat needs a lit exit to break
            return "needs light";

        // Blocked on a per-cell FOG DENSITY field. samosbor.h has a global fog PHASE.
        //
        // Туманная акула is NOT here even though its `fogSwimmer` half is equally
        // blocked (28 m sight in fog / 8 m dry, pace x0.34 dry): it IS authored, for its
        // fire vulnerability, so it returns "authored" above and a case for it here would
        // be dead code that reads as a gap. Its fog half is named in [mob_behaviour.h]'s
        // roadmap, which is where an unported behaviour belongs.
        case MobKind::Tumannik:        // fogOffset, and its visible half is a RENDER offset
            return "needs fog";

        // Blocked on per-monster state or on grid features this engine has no concept
        // of (SCREEN, APPARATUS, furniture, doors as an ownable anchor).
        case MobKind::ChervieAvatar:   // netPossessor: needs SCREEN/APPARATUS cells
        case MobKind::Rzhavnik:        // scrapWake: needs a dormant state to wake from
        case MobKind::TonkayaTen:      // baitLine: needs a flee steer + a nerve timer
        case MobKind::Obzhivalshchik:  // roomBoundAberration: home anchor + anger meter
        case MobKind::LozhnyyDukh:     // falsePhase: a door-keyed phase
        case MobKind::HeadSlug:        // hostParasite: attach/detach to another entity
        case MobKind::Sobrannyy:       // meatGrowth: grows wall organics
        case MobKind::MukhozhukHost:   // parasiteLeader: spawns and commands
        case MobKind::BlackLiquidator: // falsePatrol: needs a DISGUISED faction
        case MobKind::Gnilushka:       // defensiveNeutral: hostile only once damaged
        case MobKind::Slepoglaz:       // lastSoundBeam: needs "shoot at a POINT"
        case MobKind::TrubnyyAvtomat:  // wetLineShot: a wet-line BFS gate on the SHOT,
                                       // not a multiplier — a subsystem, not a trait
        case MobKind::Matka:           // spawner boss
        case MobKind::KhorovayaMatka:  // spawner boss with wave counting
            return "needs state";

        default:
            break;
    }
    // Everything else is a stat block plus shared AI, which is what monsters.md says
    // most monsters SHOULD be: "Большинство монстров должны выражаться этими полями
    // плюс shared AI." An empty trait row for one of them is correct, not a gap.
    return "no trait";
}

} // namespace giga::game
