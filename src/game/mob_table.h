// Global monster table — one POD row per monster kind, shared by every floor.
//
// A floor never redefines a monster ([monsters.md]): the table is engine-wide and
// a floor's rule-set only layers weight multipliers and head-count/level budgets
// on top. Adding a monster is one row in `data/mobs.csv` plus a regenerate — not
// an `if` in the engine.
//
// Mobs are deliberately NOT in `NpcPool`: they have no macro existence, they are
// spawned per-floor from this table and vanish ([npcs.md], [monsters.md]).
//
// Provenance: ported from the TypeScript reference at ../gigahrush. The reference
// has **69** monster kinds — not the ~90 that monsters.md and the reference's own
// balance.md/ecology.md claim. 69 is what `enum MonsterKind`, `MONSTERS`,
// `MONSTER_SPRITES` and `MONSTER_ECOLOGY` all agree on, gaplessly, with zero
// orphans in either direction. Two kinds the reference's own designer table omits
// (SCULPTURE, GNOME) are included because they exist in code.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace giga::game {

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

// Row index into kMobTable. Order matches the reference enum so saves and the
// source CSV stay comparable; `MobDef::kind` re-states it for a load-time assert.
enum class MobKind : std::uint8_t {
    Sborka = 0, Tvar, Polzun, Betonnik, Zombie, Eye, Nightmare, Shadow, Rebar,
    Matka, Idol, Mancobus, Herald, Creator, Spirit, Robot, Shovnik, Lampovy,
    Pechateed, Paragraph, Nelyud, Krysnozhka, Kostorez, Safeguard,
    BlackLiquidator, KhorovayaMatka, Slimevik, Sobrannyy, ZhornayaTvar,
    Bezekhiy, Pseudolift, Slepoglaz, Olgoy, VodyanoyKoshmar, Lampoglaz,
    Tumannik, Chernosliz, Rzhavnik, Betonoed, Panelnik, Paupsina, Borshchevik,
    Obzhivalshchik, HeadSlug, Protokolnik, DikiyMertvyak, Kontorshchik,
    TonkayaTen, KantselyarskiyIdol, LozhnyyDukh, ChervieAvatar, PomoynyRoy,
    Sculpture, TrubnyyAvtomat, Lotochnik, Treskotnik, ZakalennayaArmatura,
    GlubinnayaTen, GreenDog, SlimeWoman, Gnilushka, MukhozhukHost, FogShark,
    BloodPlant, Swarm, SporeCarpet, Lishennyy, Gnome,
    Count
};
inline constexpr std::size_t kMobKindCount = static_cast<std::size_t>(MobKind::Count);
static_assert(kMobKindCount == 68, "the reference has exactly 68 monster kinds");

// HP-banded, DERIVED — the reference authors no tier field anywhere.
enum class MobTier : std::uint8_t { Trash, Light, Medium, Heavy, Elite, Boss, Count };

// ---------------------------------------------------------------------------
// Behaviour: shared bits vs. per-kind script
// ---------------------------------------------------------------------------

// The reference declares 52 distinct `aiFlags` strings, but only FOUR are carried
// by more than one monster. The other 47 are per-kind bespoke behaviour scripts
// wearing a bitmask costume — and 14 of them have no flag reader at all, being
// dispatched by `e.monsterKind === X` instead.
//
// So a faithful 51-bit mask would not fit u32, would put 47 permanently-dead bits
// in every row, and would turn AI dispatch into 51 branch tests per tick. Instead
// the genuinely cross-cutting bits live here and the singletons become one
// `MobBehaviour` id — a jump table, not a branch chain.
enum class AiFlag : std::uint32_t {
    None         = 0u,
    // Shared by more than one kind in the reference.
    FoodBait     = 1u << 0,  // 10 kinds — drawn to food/bait
    WallBias     = 1u << 1,  //  4 kinds — prefers/benefits from wall-adjacency
    Flying       = 1u << 2,  //  2 kinds — ignores fine floor blockers
    WaterStrider = 1u << 3,  //  2 kinds — no speed penalty in liquid
    // Structural bits promoted out of the reference's optional fields, so the hot
    // path can test them generically instead of comparing kinds.
    Ranged       = 1u << 4,  // has a projectile attack
    Boss         = 1u << 5,  // carries a readability/telegraph block
    Rare         = 1u << 6,  // ecology.rare — gated spawn
    Immobile     = 1u << 7,  // speed == 0 (turret/plant/carpet)
    // 8..31 reserved for future shared bits.
};

constexpr AiFlag operator|(AiFlag a, AiFlag b) noexcept {
    return static_cast<AiFlag>(static_cast<std::uint32_t>(a) |
                               static_cast<std::uint32_t>(b));
}
constexpr bool has_flag(std::uint32_t set, AiFlag bit) noexcept {
    return (set & static_cast<std::uint32_t>(bit)) != 0u;
}

// One bespoke behaviour per kind; Plain = chase-and-melee, which 23 of the 69
// kinds reduce to. Names map 1:1 onto the reference's singleton aiFlags.
//
// GreenDogPack is the one merge: GREEN_DOG is the only kind carrying two
// singleton flags (packHowl + noiseFear), which are two halves of one dog design
// — share targets on sight, break off from loud metal.
enum class MobBehaviour : std::uint8_t {
    Plain = 0,
    WeakWallBreach, DebrisLurker, LampPowered, LightLock, DocumentHunter,
    DocumentScent, DrainArmor, WaterPressureLine, RangedClause, CloseReveal,
    WallBrace, FogOffset, ScentOvercommit, GarbageSurround, SourceSwarm,
    SlimeScavenger, SlimeStrider, WeepingAngel, MeatGrowth, BlackWaterWake,
    RootedPlant, RoomBoundAberration, LastSoundBeam, MeatWorm, ScrapWake,
    BaitLine, SecondBeat, OfficeField, HostParasite, ProtocolPressure,
    CrowdShove, NetPossessor, DeadEcho, FalsePatrol, DefensiveNeutral,
    WebSpitter, FalsePhase, WetLineShot, GreenDogPack, FogSwimmer,
    ParasiteLeader, RootHive, FractureSprint, LurkingFurniture, LightFollower,
    Melee,
    Count
};

enum class MobPackMode : std::uint8_t { Loner = 0, Crowd, Territorial, Roamer, Count };

// Only WEB is authored in the reference; BULLET is the implicit default.
//
// GRENADE is the third, and it is the only one no monster row can select: nothing
// in data/mobs.csv throws. It arrives from the WEAPON side ([ranged_table.h] —
// `proj_type` column) because a grenade is a thing a body carries and throws, not a
// thing a species spits. The enum stays shared anyway, because `Projectile::proj`
// is one field and a shot in flight must be one kind of thing whoever launched it —
// the day a monster row does author `grenade`, it costs a CSV cell and no code.
enum class ProjType : std::uint8_t { Bullet = 0, Web, Grenade, Count };

// Room kinds a monster may be placed in. 11 of the reference's RoomTypes are
// actually referenced by ecology rows.
enum class RoomBit : std::uint16_t {
    Corridor   = 1u << 0,
    Common     = 1u << 1,
    Storage    = 1u << 2,
    Kitchen    = 1u << 3,
    Bathroom   = 1u << 4,
    Living     = 1u << 5,
    Office     = 1u << 6,
    Medical    = 1u << 7,
    Production = 1u << 8,
    Smoking    = 1u << 9,
    Hq         = 1u << 10,
};

// The six signed floor anchors the reference's ecology rows key off. Kept as a
// bitmask so a row's habitat is one AND, not a list walk. Note these are anchors
// on the SIGNED floor axis: negative is down (hell/void), positive is up (roof).
enum class FloorBit : std::uint8_t {
    ZMinus50 = 1u << 0,
    ZMinus36 = 1u << 1,
    ZMinus26 = 1u << 2,
    Z0       = 1u << 3,
    ZPlus14  = 1u << 4,
    ZPlus30  = 1u << 5,
};

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

// POD, trivially copyable, no pointers. Ordered widest-first so there is no
// interior padding, and the six fields the tick actually reads sit in the first
// 14 bytes. The whole 69-row table is 2,484 B — permanently cache-resident.
//
// Fractional reference values (speed 3.15, attackRate 0.24, spawnWeight 8.5) are
// stored fixed-point so the table is integral and bit-identical across builds.
struct MobDef {
    // --- hot: read every tick ---------------------------------------------
    std::uint32_t aiFlags;         //  0  AiFlag bitmask
    std::uint16_t hp;              //  4  8..1000
    std::uint16_t dmg;             //  6  0..1000
    std::uint16_t speedMmps;       //  8  cells/s * 1000, 0..8500
    std::uint16_t attackCdMs;      // 10  seconds * 1000, 240..3800
    std::uint16_t meleeReachMm;    // 12  cells   * 1000, 1050..1550
    // --- warm: read on spawn / on shot ------------------------------------
    std::uint16_t projSpeedMmps;   // 14  cells/s * 1000, 0 = melee only
    std::uint16_t spawnWeightX10;  // 16  ecology.spawnWeight * 10, 0..85
    std::uint16_t roomMask;        // 18  RoomBit bitmask
    // --- ranged: 13 of 69 kinds; zero on the rest ------------------------
    std::uint16_t shotRangeMm;     // 20  cells * 1000, 0 = melee only
    std::uint16_t minRangeMm;      // 22  dead zone; inside it a ranged kind closes
    std::uint16_t windupMs;        // 24  telegraph before the shot leaves
    // --- bytes ------------------------------------------------------------
    std::uint8_t kind;             // 26  MobKind; must equal the row index
    std::uint8_t tier;             // 27  MobTier, derived
    std::uint8_t behaviour;        // 28  MobBehaviour
    std::uint8_t projType;         // 29  ProjType
    std::uint8_t minSamosbor;      // 30  ecology.minSamosborCount; 99 = never
    std::uint8_t floorMask;        // 31  FloorBit bitmask
    std::uint8_t packMode;         // 32  MobPackMode
    std::uint8_t packMin;          // 33  1..8
    std::uint8_t packMax;          // 34  1..16
    std::uint8_t packSpread;       // 35  cells, 0..10
    // --- nav traversal profile, in SUB-VOXELS (0.25 m) ---------------------
    // The universal articulation numbers the nav bake tags graph edges with:
    // a rise <= navStepSub is a walk (stairs are 1-sub risers), a rise <=
    // navClimbSub is a jump/climb (8 = one 2 m cell), a fall <= navDropSub is a
    // drop. navFly != 0 ignores gravity entirely (and everyone flies under a
    // Zero-g regime — [world/gravity.h]). Axis-generic on purpose: "rise" is
    // against the floor module's declared gravity, never a named axis.
    std::uint8_t navStepSub;       // 36  walkable riser, sub-voxels
    std::uint8_t navClimbSub;      // 37  jump/climb height, sub-voxels
    std::uint8_t navDropSub;       // 38  safe drop, sub-voxels
    std::uint8_t navFly;           // 39  0 = walker, 1 = flyer
    // --- universal mass ([ecs/components.h] Mass) --------------------------
    // GRAMS, and the unit is the same one [prop_table.h] uses — that is the whole
    // reason this field changed shape. It used to be kg x10 here and grams in a
    // uint16 there: the same 16 bits meaning two different things, which is
    // [problems.md] §20's class ("одна величина считается по-разному"), and it bit
    // — a prop could not be authored past 65.5 kg while this table already carried
    // 900 kg rows, so a kitchen stove had to be written down as 65 kg.
    //
    // The widening cost NOTHING: `massKgX10` plus the two pad bytes that followed
    // it were already four contiguous bytes at a 4-aligned offset, so the row is
    // still exactly 44. Range 1 g .. 4294 t covers a cartridge and a lift cabin.
    //
    // Feeds E = m*v^2/2 and p = m*v — fall damage, knockback, ragdoll swing —
    // never a per-system constant.
    std::uint32_t massG;           // 40
};
static_assert(sizeof(MobDef) == 44, "MobDef must stay a tight 44-byte row");
static_assert(alignof(MobDef) == 4);
static_assert(std::is_trivially_copyable_v<MobDef>);
static_assert(offsetof(MobDef, projSpeedMmps) == 14, "hot prefix boundary moved");

// Generated from data/mobs.csv by tools/gen_mob_table.py. Do not hand-edit the
// rows; edit the CSV and regenerate.
extern const std::array<MobDef, kMobKindCount> kMobTable;

// Display names, Russian, parallel to kMobTable. Kept out of MobDef so the row
// stays pointer-free and trivially serializable.
extern const std::array<const char*, kMobKindCount> kMobNames;

inline const MobDef& mob_def(MobKind k) {
    return kMobTable[static_cast<std::size_t>(k)];
}
inline const char* mob_name(MobKind k) {
    return kMobNames[static_cast<std::size_t>(k)];
}

// Latin console tokens, parallel to kMobTable: the CSV `id` column lowercased
// ("sborka", "tvar", ...). ASCII by construction, so the debug console can name
// any monster without Cyrillic input; generated like kMobNames — edit the CSV.
extern const std::array<const char*, kMobKindCount> kMobTokens;

inline const char* mob_token(MobKind k) {
    return kMobTokens[static_cast<std::size_t>(k)];
}

// Resolve a console token back to its row, case-insensitively (ASCII only — the
// tokens are). Returns MobKind::Count when nothing matches. Linear over 69 rows:
// this runs on a typed command, never on the tick.
MobKind mob_kind_from_token(const char* token);

// ---------------------------------------------------------------------------
// Per-floor budgets — the V-shape
// ---------------------------------------------------------------------------

// Danger is NOT monotonic with depth. Floor 0 is the safe living hub and
// hostility rises in BOTH directions: the roof (+) is crowded-but-weak, the
// hell/void (-) is crowded AND elite. Head-count is driven by |floor| alone
// (trimmed by theme and danger); LEVEL is f(|floor|) + danger.
//
// These are the reference's own shipped formulas, not a reinvention — it already
// implements the V-shape on a signed z axis of [-50, +50].
inline constexpr int kFloorZSpan = 50;      // |z| at which the curve saturates
inline constexpr int kMobBudgetCap = 4096;  // shared live-actor pool

// Theme multiplier on head-count. The floor's fiction, not its depth.
enum class FloorTheme : std::uint8_t {
    Living = 0,   // 0.80 — the hub; deliberately the emptiest of monsters
    Kvartiry,     // 0.86
    Ministry,     // 1.00
    Maintenance,  // 1.12
    Hell,         // 1.28
    Void,         // 1.36
    Count
};

// clamp(|z| / 50, 0, 1) — the single depth input both budgets share.
float mob_depth01(int floorZ);

// Resolved monster head-count for a floor. Saturates at kMobBudgetCap.
int mob_count_for_floor(int floorZ, std::uint8_t danger, FloorTheme theme);

// Monster LEVEL for a floor: max(danger, round(1 + depth01*8 + (danger-1)*0.55)),
// clamped 1..12.
//
// Caveat worth knowing: from floor geometry alone this tops out at **11**, not 12
// — the maximum is 1 + 8 + (5-1)*0.55 = 11.2. The reference reaches 12 only by
// adding a per-zone bonus (`monsterLevel + floor(zoneLevel/2)`), and gigahrush2
// has no zones yet. So the advertised 1..12 band is currently 1..11.
std::uint8_t mob_level_for_floor(int floorZ, std::uint8_t danger);

// HP of a level-scaled instance: base * (1 + 0.12*(level-1)).
//
// The reference has two disagreeing HP curves — the design-floor path uses
// (0.75 + 0.13*L), the samosbor path (1 + 0.12*(L-1)). They land within 0.5% at
// L=12 by coincidence but differ by 12% at L=1. This uses the samosbor form
// because it is the one the reference's balance.md documents, and because it
// keeps a level-1 monster at exactly its authored base HP.
std::uint16_t mob_hp_at_level(std::uint16_t baseHp, std::uint8_t level);

} // namespace giga::game
