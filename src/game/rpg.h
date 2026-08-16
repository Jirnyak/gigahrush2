// RPG progression — levels, XP, 5 attributes, perks, traits, bio-mutations, and augmentations.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "game/item_table.h"
#include "game/mob_table.h"

namespace giga::game {

inline constexpr std::uint8_t kRpgLevelCap = 255;
inline constexpr std::uint8_t kRpgAttributeCap = 255;

// The five core attributes.
enum class Attr : std::uint8_t {
    Str = 0,   // Strength: Melee damage, carry capacity, heavy weapon cooldown efficiency
    Agi = 1,   // Agility: Move speed, attack speed/cooldown, ranged spread reduction, evasion
    End = 2,   // Endurance: Max HP bonus, radiation/toxin resistance, stamina efficiency
    Int = 3,   // Intellect: Max PSI, XP bonus, PSI cost reduction, duration, contract rewards
    Per = 4,   // Perception: Critical strike chance, effective ranged accuracy, detection range
    Count = 5
};
inline constexpr std::size_t kAttrCount = static_cast<std::size_t>(Attr::Count);

// ---------------------------------------------------------------------------
// Character Traits (Starting / Archetype Specializations with tradeoffs)
// ---------------------------------------------------------------------------
enum class TraitId : std::uint8_t {
    None = 0,
    HeavyHanded,      // +20% melee damage, -10% attack speed
    FastMetabolism,   // +30% heal rate, +25% rad sensitivity & hunger drain
    Gifted,           // +1 all attributes, -10% XP gain rate
    TunnelVision,     // +15% accuracy, -15% peripheral detection
    ConcreteBlood,    // +20 max HP, -5% move speed
    PsionicAttuned,   // +30 max PSI, -10% kinetic damage resist
    PackMule,         // +16 kg carry capacity, -5% agility speed
    ChemResistant,    // 50% drug duration/addiction, 50% medicine effectiveness
    NightOwl,         // +10% speed/perception in darkness, -10% in bright light
    Hoarder,          // +10% scrap/loot value, +10% equipment wear
    Count
};
inline constexpr std::size_t kTraitCount = static_cast<std::size_t>(TraitId::Count);

struct TraitDef {
    TraitId id = TraitId::None;
    const char* name = "";
    const char* nameRu = "";
    const char* desc = "";
    std::int16_t hpBonus = 0;
    std::int16_t psiBonus = 0;
    std::int32_t carryBonusG = 0;
    std::int16_t meleeMultE3 = 1000;
    std::int16_t attackSpeedMultE3 = 1000;
    std::int16_t moveSpeedMultE3 = 1000;
    std::int16_t xpMultE3 = 1000;
    std::int16_t radSensitivityE3 = 1000;
    std::int16_t accuracyMultE3 = 1000;
    std::int16_t healMultE3 = 1000;
    std::int16_t kineticResistPct = 0;
    std::int8_t attrBonus = 0;
};

// ---------------------------------------------------------------------------
// Perks (Level-up Progression with Attribute/Level Prerequisites)
// ---------------------------------------------------------------------------
enum class PerkId : std::uint8_t {
    None = 0,
    IronGrip,             // Str 6, Lvl 2: Heavy weapon CD penalty removed, +10% melee dmg
    Sprinter,             // Agi 6, Lvl 2: +10% move speed, reduced stamina cost
    LeadBelly,            // End 5, Lvl 2: Immune to contaminated food/water radiation
    Educated,             // Int 6, Lvl 2: +15% XP and document reward, +1 extra skill point/3 lvls
    EagleEye,             // Per 6, Lvl 2: +10% ranged crit, +5m detection range
    Gunslinger,           // Agi 7, Per 5, Lvl 4: -25% reload time, -15% weapon spread
    Toughness,            // End 6, Lvl 4: +25 Max HP, +5% damage reduction to all channels
    Pyromaniac,           // Int 5, Lvl 4: +25% Fire damage dealt, fire resistance
    SilentStep,           // Agi 7, Lvl 4: Footstep noise -50%, detection delay +30%
    CyberneticAffinity,   // Int 7, End 5, Lvl 6: Implant rejection 0%, implant degradation -50%
    PsiOverload,          // Int 8, Lvl 6: Critical hits discharge psionic shock wave
    SamosborSurvivor,     // End 8, Lvl 8: 50% damage reduction from Samosbor fog/psi pressure
    Count
};
inline constexpr std::size_t kPerkCount = static_cast<std::size_t>(PerkId::Count);

struct PerkDef {
    PerkId id = PerkId::None;
    const char* name = "";
    const char* nameRu = "";
    const char* desc = "";
    std::uint8_t minLevel = 1;
    std::uint8_t minAttr[kAttrCount] = {0, 0, 0, 0, 0};
    PerkId requiredPerk = PerkId::None;
};

// ---------------------------------------------------------------------------
// Bio-Mutations (Radiation-Induced Genetic Alterations)
// ---------------------------------------------------------------------------
enum class BioMutationId : std::uint8_t {
    None = 0,
    ChitinousPlates,      // +25% kinetic/buckshot resist, +20 Max HP, BUT -20% Agi speed, suit weight +50%
    HypertrophiedMuscles, // +35% melee damage, +16 kg carry capacity, BUT -3 Intellect, +50% hunger drain
    ThirdEye,             // +3 Perception, +35 Max PSI, monster wall detection, BUT -20% Fire resist, light sensitivity
    AcidicBlood,          // Melee attackers take 15 acid damage, BUT bleeding 2x, medicine heal -30%
    GillsOfGigahrush,     // Toxic gas / SporeHaze immunity, water drain -30%, BUT takes 1.5x fire dmg, -10 Max HP
    SporeSymbiosis,       // Passive HP regen near fungus/slime, BUT Govnyak vulnerability, antibiotic immunity
    BoneClaws,            // Unarmed damage +25 + bleeding, BUT delicate firearm handling penalty
    AdrenalineGland,      // Low HP (<30%) grants +50% speed / +30% attack speed, BUT -20 Max PSI, +40% fatigue
    Count
};
inline constexpr std::size_t kBioMutationCount = static_cast<std::size_t>(BioMutationId::Count);

struct BioMutationDef {
    BioMutationId id = BioMutationId::None;
    const char* name = "";
    const char* nameRu = "";
    const char* buffDesc = "";
    const char* penaltyDesc = "";
    std::int16_t hpBonus = 0;
    std::int16_t psiBonus = 0;
    std::int32_t carryBonusG = 0;
    std::int16_t meleeMultE3 = 1000;
    std::int16_t moveSpeedMultE3 = 1000;
    std::int16_t kineticResistPct = 0;
    std::int16_t fireResistPct = 0;
    std::int16_t acidResistPct = 0;
    std::int16_t gasResistPct = 0;
};

// ---------------------------------------------------------------------------
// Cybernetic / Mechanical Augmentations (Implants & Durability)
// ---------------------------------------------------------------------------
enum class ImplantSlot : std::uint8_t {
    Cranial = 0,    // Neural co-processor / PSI relay
    Ocular,         // Bionic thermal/optical HUD
    Thoracic,       // Heart/lung cardio filter pump
    ArmLeft,        // Left arm hydraulic servo
    ArmRight,       // Right arm recoil stabilizer
    LegLeft,        // Left leg pneumatic actuator
    LegRight,       // Right leg pneumatic actuator
    Subdermal,      // Subdermal armor mesh
    Count
};
inline constexpr std::size_t kImplantSlotCount = static_cast<std::size_t>(ImplantSlot::Count);

enum class ImplantId : std::uint8_t {
    None = 0,
    NeuralCoProcessor,       // +4 Intellect, -20% PSI cost, +15% XP
    BionicEyeThermal,        // +3 Perception, monster outline, +15% ranged crit
    CardioFilterPump,        // +3 Endurance, +40% toxic/gas resist, -30% stamina drain
    HydraulicArmServo,       // +4 Strength, +35% melee dmg, -30% recoil
    PneumaticLegActuators,   // +20% move speed, +50% jump height, -50% fall damage
    SubdermalArmorPlating,   // +15% all damage mitigation, +25 Max HP
    PsiEmitterRelay,         // +40 Max PSI, enables active psionic wave
    DermalInsulator,         // +25% Energy & Fire resistance, shock protection
    Count
};
inline constexpr std::size_t kImplantCount = static_cast<std::size_t>(ImplantId::Count);

struct ImplantDef {
    ImplantId id = ImplantId::None;
    ImplantSlot slot = ImplantSlot::Cranial;
    const char* name = "";
    const char* nameRu = "";
    const char* desc = "";
    std::uint16_t maxDurability = 1000; // x10 scale (1000 = 100.0%)
    std::int8_t attrBonus[kAttrCount] = {0, 0, 0, 0, 0};
    std::int16_t hpBonus = 0;
    std::int16_t psiBonus = 0;
    std::int16_t meleeMultE3 = 1000;
    std::int16_t moveMultE3 = 1000;
    std::int16_t damageMitigatePct = 0;
    std::int16_t gasResistPct = 0;
    std::int16_t fireResistPct = 0;
    std::int16_t energyResistPct = 0;
};

// ---------------------------------------------------------------------------
// The XP curve
// ---------------------------------------------------------------------------
std::uint32_t xp_for_level(std::uint8_t level);
std::uint64_t total_xp_for_level(std::uint8_t level);
std::uint8_t clamp_rpg_level(int level);
std::uint8_t clamp_rpg_attribute(int points);

// ---------------------------------------------------------------------------
// Live per-character state (Tight POD)
// ---------------------------------------------------------------------------
struct RpgStats {
    std::uint32_t xp = 0;          // 0  toward the NEXT level, not cumulative
    std::uint16_t psi = 100;       // 4  current; max is derived
    std::uint8_t level = 1;        // 6
    std::uint8_t attrPoints = 0;   // 7  unspent attribute points
    std::uint8_t attr[kAttrCount] = {0, 0, 0, 0, 0}; // 8..12: Str, Agi, End, Int, Per
    std::uint8_t perkPoints = 0;   // 13 unspent perk points
    std::uint16_t radDose = 0;     // 14 accumulated radiation exposure (mSv)
    std::uint32_t traitMask = 0;   // 16 active TraitId bitset
    std::uint32_t perkMask = 0;    // 20 active PerkId bitset
    std::uint32_t mutationMask = 0;// 24 active BioMutationId bitset
    std::uint8_t implantId[kImplantSlotCount] = {}; // 28 installed ImplantId per slot
    std::uint16_t implantDurability[kImplantSlotCount] = {}; // 36 durability per slot (0..1000)
    std::uint8_t pad_ = 0;         // 52
};
static_assert(std::is_trivially_copyable_v<RpgStats>);

// ---------------------------------------------------------------------------
// RAW & EFFECTIVE ATTRIBUTES
// ---------------------------------------------------------------------------
std::uint8_t raw_attr_of(const RpgStats& r, Attr a);
std::uint8_t effective_attr_of(const RpgStats& r, Attr a);

// ---------------------------------------------------------------------------
// CARRY CAPACITY & BASE STATS
// ---------------------------------------------------------------------------
inline constexpr std::uint32_t kCarryBaseG = 64000;
inline constexpr std::uint32_t kCarryPerStrG = 4000;
inline constexpr std::uint32_t kCarryPerEndG = 2000;

std::uint32_t carry_capacity_g(const RpgStats& r);

inline constexpr std::uint16_t kBaseHp = 100;
inline constexpr std::uint16_t kHpPerLevel = 1;
inline constexpr std::uint16_t kBasePsi = 100;
inline constexpr std::uint16_t kPsiPerLevel = 1;

std::uint16_t level_hp(std::uint8_t level);
std::uint16_t level_psi(std::uint8_t level);
std::uint16_t max_hp(const RpgStats& r);
std::uint16_t max_psi(const RpgStats& r);

RpgStats fresh_rpg(std::uint8_t level = 1);
RpgStats random_rpg(std::uint8_t level, std::uint32_t seed);

// ---------------------------------------------------------------------------
// Derived stats — every multiplier x1000
// ---------------------------------------------------------------------------
std::uint16_t str_melee_dmg_mult_e3(const RpgStats& r);
std::uint16_t str_durability_wear_mult_e3(const RpgStats& r);
bool rpg_adrenaline_active(const RpgStats& r, std::int16_t hp, std::int16_t maxHp);
std::uint16_t agi_move_speed_mult_e3(const RpgStats& r, std::int16_t hp = -1, std::int16_t maxHp = -1);
std::uint16_t agi_attack_speed_mult_e3(const RpgStats& r, std::int16_t hp = -1, std::int16_t maxHp = -1);   // <1000 = faster
std::uint16_t agi_ranged_spread_mult_e3(const RpgStats& r);  // <1000 = tighter
std::uint16_t agi_dodge_chance_e3(const RpgStats& r);

std::uint16_t end_max_hp_mult_e3(const RpgStats& r);
std::uint16_t end_radiation_resist_e3(const RpgStats& r);
std::uint16_t end_stamina_drain_mult_e3(const RpgStats& r);

std::uint16_t int_xp_mult_e3(const RpgStats& r);
std::uint16_t int_psi_cost_mult_e3(const RpgStats& r);
std::uint16_t int_contract_reward_mult_e3(const RpgStats& r);
std::uint16_t int_document_reward_mult_e3(const RpgStats& r);
std::uint16_t int_hack_success_mult_e3(const RpgStats& r);
std::uint16_t int_psi_duration_bonus_sec(const RpgStats& r);

std::uint16_t per_crit_chance_e3(const RpgStats& r);
float per_detection_range_m(const RpgStats& r);
std::uint16_t per_ranged_accuracy_mult_e3(const RpgStats& r);

inline constexpr std::uint16_t kHeavyWeaponCooldownMs = 650;
std::uint16_t str_heavy_weapon_speed_mult_e3(const RpgStats& r,
                                            std::uint16_t baseCooldownMs);

std::int16_t melee_damage(const RpgStats& r, ItemId weaponId,
                          std::int16_t weaponDamage);

std::uint16_t adjusted_psi_cost(std::uint16_t baseCost, const RpgStats& r);

// Total damage resistance for channel from traits, perks, mutations, and functioning implants
std::int16_t rpg_damage_resistance_pct(const RpgStats& r, std::uint8_t damageChannel);
std::uint16_t rpg_heal_mult_e3(const RpgStats& r);
std::uint16_t rpg_water_drain_mult_e3(const RpgStats& r);

// ---------------------------------------------------------------------------
// Traits & Perks API
// ---------------------------------------------------------------------------
const TraitDef& trait_def(TraitId id);
bool has_trait(const RpgStats& r, TraitId id);
bool add_trait(RpgStats& r, TraitId id);
bool remove_trait(RpgStats& r, TraitId id);

const PerkDef& perk_def(PerkId id);
bool perk_prerequisites_met(const RpgStats& r, PerkId id);
bool has_perk(const RpgStats& r, PerkId id);
bool unlock_perk(RpgStats& r, PerkId id);

// ---------------------------------------------------------------------------
// Bio-Mutation API
// ---------------------------------------------------------------------------
const BioMutationDef& bio_mutation_def(BioMutationId id);
bool has_mutation(const RpgStats& r, BioMutationId id);
bool apply_mutation(RpgStats& r, BioMutationId id,
                    std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);
bool remove_mutation(RpgStats& r, BioMutationId id,
                     std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);
BioMutationId roll_random_mutation(const RpgStats& r, std::uint32_t seed);
void add_radiation_dose(RpgStats& r, std::uint16_t mSv, std::uint32_t seed = 0,
                        std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);

// ---------------------------------------------------------------------------
// Augmentation / Cybernetic Implant API
// ---------------------------------------------------------------------------
const ImplantDef& implant_def(ImplantId id);
bool implant_is_functioning(const RpgStats& r, ImplantSlot slot);
bool implant_install(RpgStats& r, ImplantSlot slot, ImplantId id,
                     std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);
bool implant_uninstall(RpgStats& r, ImplantSlot slot,
                       std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);
bool implant_repair(RpgStats& r, ImplantSlot slot, std::uint16_t repairPoints);
void implant_degrade_step(RpgStats& r, float dtSec);
void implant_take_damage(RpgStats& r, std::int16_t dmg, std::uint8_t damageChannel);

// ---------------------------------------------------------------------------
// XP Sources & Progression
// ---------------------------------------------------------------------------
std::uint32_t xp_for_monster_kill(MobKind kind, std::uint8_t monsterLevel);
std::uint32_t xp_for_npc_kill(std::uint8_t npcLevel);
std::uint32_t xp_for_quest(std::uint16_t difficultyE1);

struct XpAward {
    std::uint32_t granted = 0;      // after INT & trait multipliers
    std::uint8_t levelsGained = 0;
    std::uint8_t newLevel = 1;
    bool atCap = false;
};

XpAward award_xp(RpgStats& r, std::uint32_t amount,
                 std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);

bool spend_attr_point(RpgStats& r, Attr a,
                      std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);

} // namespace giga::game
