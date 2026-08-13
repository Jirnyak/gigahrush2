#include "game/rpg.h"

#include <cmath>

#include "core/rng.h"

namespace giga::game {
namespace {

// Reference constants, `systems/rpg.ts:33-56`. Named exactly as there so a diff
// against the reference is mechanical.
constexpr float kStrHpPerPoint = 0.01f;
constexpr float kStrMeleeDamagePerPoint = 0.01f;
constexpr float kStrDurabilityWearPerPoint = 0.08f;
constexpr float kStrHeavyWeaponSpeedPerPoint = 0.05f;
constexpr float kAgiMoveSpeedPerPoint = 0.01f;
constexpr float kAgiAttackCooldownPerPoint = 0.02f;
constexpr float kAgiSpreadPerPoint = 0.12f;
constexpr float kIntPsiPerPoint = 0.01f;
constexpr float kIntPsiDurationSecPerPoint = 1.0f;
constexpr float kIntXpBonusPerPoint = 0.08f;
constexpr float kIntXpBonusAsymptote = 1.0f;
constexpr float kIntContractRewardPerPoint = 0.04f;
constexpr float kIntContractRewardAsymptote = 0.5f;
constexpr float kIntDocumentRewardPerPoint = 0.06f;
constexpr float kIntDocumentRewardAsymptote = 0.7f;
constexpr float kIntPsiCostEfficiencyPerPoint = 0.035f;

// Round-half-up to the x1000 fixed point, clamped into u16. The clamp matters:
// a linear multiplier at 255 points is only x3.55, but nothing guarantees a future
// coefficient stays that tame, and a silent wrap would read as a debuff.
std::uint16_t to_e3(float mult) {
    const float scaled = mult * 1000.0f;
    if (!(scaled > 0.0f)) return 0;              // also catches NaN
    const int r = static_cast<int>(scaled + 0.5f);
    return static_cast<std::uint16_t>(r > 65535 ? 65535 : r);
}

// The reference's three multiplier shapes (`rpg.ts:114-125`).
float linear_mult(std::uint8_t points, float perPoint) {
    return 1.0f + static_cast<float>(points) * perPoint;
}

float inverse_mult(std::uint8_t points, float perPoint) {
    return 1.0f / (1.0f + static_cast<float>(points) * perPoint);
}

float asymptotic_bonus(std::uint8_t points, float perPoint, float asymptote) {
    if (points == 0 || perPoint <= 0.0f || asymptote <= 0.0f) return 0.0f;
    const float p = static_cast<float>(points);
    return asymptote * (1.0f - std::exp(-(p * perPoint) / asymptote));
}

std::uint8_t attr_of(const RpgStats& r, Attr a) {
    return r.attr[static_cast<std::size_t>(a)];
}

// Round-half-up into u16, the same shape `mob_table.cpp` uses.
std::uint16_t round_u16(float v) {
    if (!(v > 0.0f)) return 0;
    const int r = static_cast<int>(v + 0.5f);
    return static_cast<std::uint16_t>(r > 65535 ? 65535 : r);
}

// Per-kind kill XP. 36 of the 69 kinds are authored in the reference
// (`rpg.ts:337-374`); every other kind falls through to 10, which is the
// reference's own `?? 10` default and not a placeholder.
//
// A switch rather than a 69-entry table because the table would be 33 copies of
// the default value, and a reader could not tell an authored 10 (SBORKA) from an
// unauthored one. Here the default is visibly the default.
//
// Five reference kinds have no MobKind in this engine's 69 and are therefore
// absent, not silently remapped: MonsterKind.BETONOED maps to MobKind::Betonoed
// (present), but the reference's separate SOBRANNYY/KHOROVAYA_MATKA/TONKAYA_TEN/
// LOZHNYY_DUKH/DIKIY_MERTVYAK all DO exist here, so the only true gaps are
// reference kinds this engine's table never adopted.
std::uint32_t monster_base_xp(MobKind kind) {
    switch (kind) {
        case MobKind::Sborka:            return 10;
        case MobKind::Tvar:              return 50;
        case MobKind::Polzun:            return 100;
        case MobKind::Betonnik:          return 240;
        case MobKind::Betonoed:          return 130;
        case MobKind::Zombie:            return 14;
        case MobKind::DikiyMertvyak:     return 16;
        case MobKind::Eye:               return 35;
        case MobKind::Nightmare:         return 90;
        case MobKind::Shadow:            return 70;
        case MobKind::TonkayaTen:        return 58;
        case MobKind::Rebar:             return 110;
        case MobKind::Matka:             return 300;
        case MobKind::KhorovayaMatka:    return 380;
        case MobKind::Sobrannyy:         return 220;
        case MobKind::Mancobus:          return 400;
        case MobKind::Herald:            return 360;
        case MobKind::Creator:           return 10000;
        case MobKind::Spirit:            return 80;
        case MobKind::LozhnyyDukh:       return 95;
        case MobKind::Idol:              return 20;
        case MobKind::Robot:             return 70;
        case MobKind::TrubnyyAvtomat:    return 150;
        case MobKind::Shovnik:           return 64;
        case MobKind::Lampovy:           return 56;
        case MobKind::Lampoglaz:         return 84;
        case MobKind::Pechateed:         return 76;

        case MobKind::Paragraph:         return 90;
        case MobKind::Nelyud:            return 140;
        case MobKind::Krysnozhka:        return 48;
        case MobKind::GreenDog:          return 72;
        case MobKind::Kostorez:          return 190;
        case MobKind::Safeguard:         return 250;
        case MobKind::Rzhavnik:          return 70;
        case MobKind::Olgoy:             return 170;
        default:                         return 10;
    }
}

// base * (1 + 0.22*(level-1)), rounded — the shared shape of all three XP sources.
std::uint32_t scale_kill_xp(std::uint32_t base, std::uint8_t level) {
    const std::uint8_t lv = level < 1 ? 1 : level;
    const float v = static_cast<float>(base) *
                    (1.0f + 0.22f * (static_cast<float>(lv) - 1.0f));
    const float r = v + 0.5f;
    return r > 4294967040.0f ? 4294967040u : static_cast<std::uint32_t>(r);
}

// Credit a max-HP increase to current HP by the DIFFERENCE, never a refill. Shared
// by award_xp and spend_attr_point because the reference does the same arithmetic in
// both, and doing it twice by hand is how the two drift apart.
void credit_max_hp_gain(const RpgStats& r, std::int16_t* hp, std::int16_t* maxHp) {
    if (maxHp == nullptr) return;
    const std::int16_t newMax = static_cast<std::int16_t>(max_hp(r));
    const int diff = static_cast<int>(newMax) - static_cast<int>(*maxHp);
    *maxHp = newMax;
    if (hp == nullptr) return;
    const int gain = diff > 0 ? diff : 0;
    const int raised = static_cast<int>(*hp) + gain;
    *hp = static_cast<std::int16_t>(raised > newMax ? newMax : raised);
}

} // namespace

std::uint8_t clamp_rpg_level(int level) {
    if (level < 1) return 1;
    return static_cast<std::uint8_t>(level > kRpgLevelCap ? kRpgLevelCap : level);
}

std::uint8_t clamp_rpg_attribute(int points) {
    if (points < 0) return 0;
    return static_cast<std::uint8_t>(points > kRpgAttributeCap ? kRpgAttributeCap
                                                              : points);
}

std::uint32_t xp_for_level(std::uint8_t level) {
    if (level <= 1) return 0;
    const std::uint32_t rank = static_cast<std::uint32_t>(level) - 1u;
    return 75u + 25u * rank + 10u * rank * (rank - 1u);
}

std::uint64_t total_xp_for_level(std::uint8_t level) {
    std::uint64_t total = 0;
    for (std::uint32_t i = 1; i <= static_cast<std::uint32_t>(level); ++i)
        total += xp_for_level(static_cast<std::uint8_t>(i));
    return total;
}

std::uint16_t level_hp(std::uint8_t level) {
    const std::uint8_t lv = clamp_rpg_level(level);
    return static_cast<std::uint16_t>(kBaseHp + kHpPerLevel * (lv - 1));
}

std::uint16_t level_psi(std::uint8_t level) {
    const std::uint8_t lv = clamp_rpg_level(level);
    return static_cast<std::uint16_t>(kBasePsi + kPsiPerLevel * (lv - 1));
}

std::uint16_t max_hp(const RpgStats& r) {
    return round_u16(static_cast<float>(level_hp(r.level)) *
                     linear_mult(attr_of(r, Attr::Str), kStrHpPerPoint));
}

std::uint16_t max_psi(const RpgStats& r) {
    return round_u16(static_cast<float>(level_psi(r.level)) *
                     linear_mult(attr_of(r, Attr::Int), kIntPsiPerPoint));
}

RpgStats fresh_rpg(std::uint8_t level) {
    RpgStats r;
    r.level = clamp_rpg_level(level);
    r.psi = max_psi(r);
    return r;
}

RpgStats random_rpg(std::uint8_t level, std::uint32_t seed) {
    RpgStats r;
    r.level = clamp_rpg_level(level);
    const std::uint32_t points = static_cast<std::uint32_t>(r.level) - 1u;
    // The reference's 34/33/33 split, one draw per point. Stateless: the draw index
    // is the salt, so the same (seed, level) always rolls the same build and no RNG
    // state has to be stored on a 2^20-record pool.
    for (std::uint32_t i = 0; i < points; ++i) {
        const float x = rand01(hash2(seed, i));
        const std::size_t slot = x < 0.34f ? 0u : (x < 0.67f ? 1u : 2u);
        if (r.attr[slot] < kRpgAttributeCap) ++r.attr[slot];
    }
    r.psi = max_psi(r);
    return r;
}

std::uint16_t str_melee_dmg_mult_e3(const RpgStats& r) {
    return to_e3(linear_mult(attr_of(r, Attr::Str), kStrMeleeDamagePerPoint));
}

std::uint16_t str_durability_wear_mult_e3(const RpgStats& r) {
    return to_e3(inverse_mult(attr_of(r, Attr::Str), kStrDurabilityWearPerPoint));
}

std::uint16_t agi_move_speed_mult_e3(const RpgStats& r) {
    return to_e3(linear_mult(attr_of(r, Attr::Agi), kAgiMoveSpeedPerPoint));
}

std::uint16_t agi_attack_speed_mult_e3(const RpgStats& r) {
    return to_e3(inverse_mult(attr_of(r, Attr::Agi), kAgiAttackCooldownPerPoint));
}

std::uint16_t agi_ranged_spread_mult_e3(const RpgStats& r) {
    return to_e3(inverse_mult(attr_of(r, Attr::Agi), kAgiSpreadPerPoint));
}

std::uint16_t int_xp_mult_e3(const RpgStats& r) {
    return to_e3(1.0f + asymptotic_bonus(attr_of(r, Attr::Int),
                                         kIntXpBonusPerPoint,
                                         kIntXpBonusAsymptote));
}

std::uint16_t int_psi_cost_mult_e3(const RpgStats& r) {
    return to_e3(inverse_mult(attr_of(r, Attr::Int),
                              kIntPsiCostEfficiencyPerPoint));
}

std::uint16_t int_contract_reward_mult_e3(const RpgStats& r) {
    return to_e3(1.0f + asymptotic_bonus(attr_of(r, Attr::Int),
                                         kIntContractRewardPerPoint,
                                         kIntContractRewardAsymptote));
}

std::uint16_t int_document_reward_mult_e3(const RpgStats& r) {
    return to_e3(1.0f + asymptotic_bonus(attr_of(r, Attr::Int),
                                         kIntDocumentRewardPerPoint,
                                         kIntDocumentRewardAsymptote));
}

std::uint16_t int_psi_duration_bonus_sec(const RpgStats& r) {
    return static_cast<std::uint16_t>(static_cast<float>(attr_of(r, Attr::Int)) *
                                      kIntPsiDurationSecPerPoint);
}

std::uint16_t str_heavy_weapon_speed_mult_e3(const RpgStats& r,
                                            std::uint16_t baseCooldownMs) {
    if (baseCooldownMs < kHeavyWeaponCooldownMs) return 1000;
    return to_e3(inverse_mult(attr_of(r, Attr::Str), kStrHeavyWeaponSpeedPerPoint));
}

std::int16_t melee_damage(const RpgStats& r, ItemId weaponId,
                          std::int16_t weaponDamage) {
    const int levelBonus = static_cast<int>(r.level) - 1;
    int base;
    if (weaponId != 0) {
        const int wd = weaponDamage > 0 ? static_cast<int>(weaponDamage) : 0;
        base = wd + levelBonus;
    } else {
        // Bare-handed damage is the level itself and ignores the weapon number
        // entirely — the reference's `Math.max(1, Math.floor(rpg.level))`.
        base = r.level < 1 ? 1 : static_cast<int>(r.level);
    }
    const float scaled = static_cast<float>(base) *
                         (static_cast<float>(str_melee_dmg_mult_e3(r)) / 1000.0f);
    const int out = static_cast<int>(scaled + 0.5f);
    return static_cast<std::int16_t>(out > 32767 ? 32767 : (out < 0 ? 0 : out));
}

std::uint16_t adjusted_psi_cost(std::uint16_t baseCost, const RpgStats& r) {
    if (baseCost == 0) return 0;
    const float v = static_cast<float>(baseCost) *
                    (static_cast<float>(int_psi_cost_mult_e3(r)) / 1000.0f);
    const std::uint16_t out = round_u16(v);
    return out < 1 ? 1 : out;  // the reference's max(1, ...)
}

std::uint32_t xp_for_monster_kill(MobKind kind, std::uint8_t monsterLevel) {
    return scale_kill_xp(monster_base_xp(kind), monsterLevel);
}

std::uint32_t xp_for_npc_kill(std::uint8_t npcLevel) {
    return scale_kill_xp(10, npcLevel);
}

std::uint32_t xp_for_quest(std::uint16_t difficultyE1) {
    // The reference's `questXpReward` is round(20 * difficulty); difficulty arrives
    // here x10, so this is round(20 * d / 10) = round(2 * d).
    return static_cast<std::uint32_t>(difficultyE1) * 2u;
}

XpAward award_xp(RpgStats& r, std::uint32_t amount,
                 std::int16_t* hp, std::int16_t* maxHp) {
    XpAward out;
    r.level = clamp_rpg_level(r.level);

    if (r.level >= kRpgLevelCap) {
        r.xp = 0;
        const std::uint16_t cap = max_psi(r);
        if (r.psi > cap) r.psi = cap;
        out.newLevel = r.level;
        out.atCap = true;
        return out;
    }

    // The INT bonus applies HERE and only here, so no caller can double it.
    const std::uint64_t adjusted =
        (static_cast<std::uint64_t>(amount) *
         static_cast<std::uint64_t>(int_xp_mult_e3(r)) + 500ull) / 1000ull;
    out.newLevel = r.level;
    if (adjusted == 0) return out;

    out.granted = adjusted > 0xFFFFFFFFull ? 0xFFFFFFFFu
                                           : static_cast<std::uint32_t>(adjusted);
    // Saturate rather than wrap: xp is spent down by every level-up below, so this
    // only bites for an absurd single award.
    const std::uint64_t pooled =
        static_cast<std::uint64_t>(r.xp) + static_cast<std::uint64_t>(out.granted);
    r.xp = pooled > 0xFFFFFFFFull ? 0xFFFFFFFFu
                                  : static_cast<std::uint32_t>(pooled);

    while (r.level < kRpgLevelCap) {
        const std::uint32_t need = xp_for_level(static_cast<std::uint8_t>(r.level + 1));
        if (r.xp < need) break;
        r.xp -= need;
        ++r.level;
        if (r.attrPoints < 255) ++r.attrPoints;
        r.psi = max_psi(r);   // full PSI on level up
        credit_max_hp_gain(r, hp, maxHp);
        ++out.levelsGained;
    }

    if (r.level >= kRpgLevelCap) {
        r.xp = 0;
        out.atCap = true;
    }
    out.newLevel = r.level;
    return out;
}

bool spend_attr_point(RpgStats& r, Attr a, std::int16_t* hp, std::int16_t* maxHp) {
    if (a >= Attr::Count) return false;
    if (r.attrPoints == 0) return false;
    const std::size_t slot = static_cast<std::size_t>(a);
    if (r.attr[slot] >= kRpgAttributeCap) return false;

    const std::uint16_t oldPsiMax = max_psi(r);
    --r.attrPoints;
    ++r.attr[slot];

    if (a == Attr::Str) credit_max_hp_gain(r, hp, maxHp);
    if (a == Attr::Int) {
        const std::uint16_t newMax = max_psi(r);
        const int gain = static_cast<int>(newMax) - static_cast<int>(oldPsiMax);
        const int raised = static_cast<int>(r.psi) + (gain > 0 ? gain : 0);
        r.psi = static_cast<std::uint16_t>(raised > newMax ? newMax : raised);
    }
    return true;
}

bool psi_spend(RpgStats& r, std::uint16_t baseCost) {
    const std::uint16_t cost = adjusted_psi_cost(baseCost, r);
    if (r.psi >= cost) {
        r.psi -= cost;
        return true;
    }
    return false;
}

void psi_regen_step(RpgStats& r, float dt) {
    const std::uint16_t cap = max_psi(r);
    if (r.psi >= cap) return;

    const std::uint8_t intVal = r.attr[static_cast<std::size_t>(Attr::Int)];
    const float rate = 1.0f + 0.15f * static_cast<float>(intVal);
    const float gainFloat = rate * std::max(dt, 0.0f);
    const std::uint16_t gain = static_cast<std::uint16_t>(gainFloat >= 1.0f ? gainFloat : 1);

    const std::uint32_t next = static_cast<std::uint32_t>(r.psi) + gain;
    r.psi = static_cast<std::uint16_t>(next > cap ? cap : next);
}

void psi_drain(RpgStats& r, std::uint16_t amount) {
    if (r.psi > amount) {
        r.psi -= amount;
    } else {
        r.psi = 0;
    }
}

} // namespace giga::game
