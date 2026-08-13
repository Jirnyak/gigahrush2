// RPG progression — levels, XP, the three attributes, and every derived stat.
//
// Ported from the reference `systems/rpg.ts` (418 lines). The reference's own
// `data/rpg_progression.ts` is TWO LINES — just the two caps — so the numbers below
// come from the system file, not from a data table. That is why this lands as a
// header of constants rather than a generated CSV table like items/mobs: there are
// no ROWS here, only formulas. The one genuinely row-shaped thing in the reference
// (per-kind kill XP, 36 authored entries over 69 kinds) belongs in data/mobs.csv
// beside the stats it scales, not in a second parallel file.
//
// WHAT ALREADY EXISTED, and is deliberately not duplicated. `mob_table.h` already
// carries the monster-scaling half of `rpg.ts`: `mob_hp_at_level` is that file's
// `scaleMonsterHp` (1 + 0.12*(L-1)). The dmg/speed curves (1 + 0.10, 1 + 0.02) are
// documented there as inline. This file is the PLAYER/NPC half, which had nowhere
// to live: level, xp, attrPoints, str/agi/int, psi, and the 13 derived multipliers.
//
// FIXED POINT, x1000, for the same reason [status.h] gives: this tree pins bit-exact
// digests and a float multiplier chain is not guaranteed identical between MSVC and
// Clang ([AGENTS.md]). x1.0 is 1000. The reference computes in doubles; every value
// here is the rounded x1000 integer of that double, and the tests pin the reference's
// own worked examples.
//
// NOT PORTED, deliberately, with the reason:
//   * `regenPsi` — the reference body is empty (PSI recovers only from items and
//     level-ups). An empty function is not a feature; the absence IS the design.
//   * `randomGaussian` / `generateHeight` — this tree already has `height_for_age`
//     in [population.h], and a Box-Muller pair needs stored RNG state, which the
//     stateless `(id,salt)` hashing in [core/rng.h] exists to avoid.
//   * `calcZoneLevel` — its ZONE_CELL is W/8 over the reference's flat 1024-wide
//     zone grid. This engine's danger model is the V-shape about the hub keyed on
//     floor NUMBER ([mob_table.h] `mob_level_for_floor`), which is already built and
//     is not the same function. Porting the zone version would be a second,
//     disagreeing definition of monster level.
//   * `questDifficulty` / `questXpReward` / `questMoneyReward` — quest rewards are
//     [quest.h]'s business; the XP half enters through `xp_for_quest` below so there
//     is exactly one XP awarder.
#pragma once

#include <cstdint>
#include <type_traits>
#include "game/item_table.h"

#include "game/mob_table.h"

namespace giga::game {

// Both caps are the reference's `RPG_LEVEL_CAP` / `RPG_ATTRIBUTE_CAP` = 255.
//
// 255 and not 256 is load-bearing: level and each attribute are stored in a
// std::uint8_t, so the cap is exactly the storage maximum and a clamp at the cap
// cannot be confused with a wrap to 0. `NpcPool::level()` is already u8.
inline constexpr std::uint8_t kRpgLevelCap = 255;
inline constexpr std::uint8_t kRpgAttributeCap = 255;

// The three attributes, and WHICH SLOT each occupies in the pool's generic 8-slot
// `attrs()` block ([npc_pool.h]).
//
// That block is documented as deliberately unnamed — "attribute names are not
// finalized". They are finalized now, by the reference: str/agi/int and nothing
// else. Naming the first three slots rather than adding three new pool columns
// keeps the 2^20-record footprint unchanged (the slots are already allocated and
// already seeded 3..15 by `seed_floor_from_spec`), and leaves slots 3..7 free.
enum class Attr : std::uint8_t { Str = 0, Agi, Int, Count };
inline constexpr std::size_t kAttrCount = static_cast<std::size_t>(Attr::Count);

// ---------------------------------------------------------------------------
// The XP curve
// ---------------------------------------------------------------------------
// Cost to advance FROM level-1 TO `level`: 75 + 25*rank + 10*rank*(rank-1), where
// rank = level-1. The reference pins three worked values in its own comment, and
// they are the tests: xpForLevel(2) = 100, (5) = 295, (10) = 1020.
//
// Returns 0 for level <= 1 (there is no cost to be level 1). u32 is sufficient and
// checked: at the cap, rank = 254 gives 75 + 6350 + 10*254*253 = 649,045.
std::uint32_t xp_for_level(std::uint8_t level);

// Cumulative XP to reach `level` from scratch — the reference's `totalXpForLevel`,
// which sums `xpForLevel(1..level)`. u64 because the sum to the cap is ~54.9M; it
// fits u32, but the running sum is clearer unbounded and this is not a hot path.
std::uint64_t total_xp_for_level(std::uint8_t level);

std::uint8_t clamp_rpg_level(int level);
std::uint8_t clamp_rpg_attribute(int points);

// ---------------------------------------------------------------------------
// Live per-character state
// ---------------------------------------------------------------------------
// POD, 12 bytes. This is the reference's `RPGStats` minus the two fields that are
// derived rather than stored: `maxPsi` (always `max_psi(*this)`) and `maxHp`
// (always `max_hp(*this)`). The reference stores maxPsi AND recomputes it at four
// separate sites, which is the same class of defect [combat.h] documents for
// damage — a cached value that can disagree with its own formula. Here there is
// nowhere for it to drift.
//
// `psi` IS stored, because it is a spendable resource, not a derived stat.
struct RpgStats {
    std::uint32_t xp = 0;          // 0  toward the NEXT level, not cumulative
    std::uint16_t psi = 100;       // 4  current; max is derived
    std::uint8_t level = 1;        // 6
    std::uint8_t attrPoints = 0;   // 7  unspent
    std::uint8_t attr[kAttrCount] = {0, 0, 0};  // 8  str, agi, int
    std::uint8_t pad_ = 0;         // 11
};
static_assert(sizeof(RpgStats) == 12, "RpgStats must stay a tight POD");
static_assert(std::is_trivially_copyable_v<RpgStats>);

// ---------------------------------------------------------------------------
// CARRY CAPACITY — what STRENGTH is for, and the first thing in this file that
// spends an attribute on something the player can feel.
// ---------------------------------------------------------------------------
// 64 kg base, +4 kg per point of Str. Both are powers of two in KILOGRAMS
// (2^6 and 2^2), which is the owner's call and the house style ([jirnyak.md] §1:
// prefer powers of two wherever a number is free to be one). The useful
// consequence is that a capacity is always 64 + 4*str — even, and readable at a
// glance as "how many rifles" rather than as an arbitrary budget.
//
// GRAMS, like every other mass in the tree ([item_table.h] massG, [prop_table.h],
// [mob_table.h]) — a capacity and a load must be the same kind of number or the
// comparison needs a conversion, and a conversion is where units go wrong.
//
// It reads STRENGTH and not Endurance deliberately: `Attr` is {Str, Agi, Int}
// ([rpg.h] above) and the manifesto's eight-attribute sheet is not built. Hanging
// this off Str is the honest wiring for the attributes that EXIST; the day
// Endurance lands, this is the one line that moves.
inline constexpr std::uint32_t kCarryBaseG = 64000;
inline constexpr std::uint32_t kCarryPerStrG = 4000;

inline constexpr std::uint32_t carry_capacity_g(const RpgStats& r) {
    return kCarryBaseG +
           kCarryPerStrG * static_cast<std::uint32_t>(r.attr[static_cast<std::size_t>(Attr::Str)]);
}

// Base + per-level linear growth, straight from the reference constants.
inline constexpr std::uint16_t kBaseHp = 100;
inline constexpr std::uint16_t kHpPerLevel = 1;
inline constexpr std::uint16_t kBasePsi = 100;
inline constexpr std::uint16_t kPsiPerLevel = 1;

// Level component only, before the attribute multiplier.
std::uint16_t level_hp(std::uint8_t level);
std::uint16_t level_psi(std::uint8_t level);

// Level base times the attribute multiplier, rounded. STR feeds HP at +1%/point,
// INT feeds PSI at +1%/point.
std::uint16_t max_hp(const RpgStats& r);
std::uint16_t max_psi(const RpgStats& r);

// A level-1 character with no points spent, at full PSI.
RpgStats fresh_rpg(std::uint8_t level = 1);

// An NPC/monster rolled to `level`: it has (level-1) points, distributed 34/33/33
// across str/agi/int. Deterministic from `seed` via [core/rng.h]'s stateless
// hashing — the reference calls a stateful `rng()` per point, which cannot be
// replayed; same substitution `loot_table.cpp` documents.
RpgStats random_rpg(std::uint8_t level, std::uint32_t seed);

// ---------------------------------------------------------------------------
// Derived stats — every multiplier x1000
// ---------------------------------------------------------------------------
// Three shapes, and which one a stat uses is the reference's choice, not ours:
//
//   LINEAR      1 + p*k          — grows without bound (HP, melee dmg, move speed)
//   INVERSE     1 / (1 + p*k)    — approaches 0, never reaches it (cooldowns,
//                                  spread, wear, psi cost). This is what keeps AGI
//                                  from ever giving a zero-cooldown attack.
//   ASYMPTOTIC  1 + A*(1-e^(-pk/A)) — saturates at a hard ceiling A (xp, contract
//                                  and document rewards). INT's xp bonus can never
//                                  exceed +100% no matter how many points go in.
std::uint16_t str_melee_dmg_mult_e3(const RpgStats& r);
std::uint16_t str_durability_wear_mult_e3(const RpgStats& r);
std::uint16_t agi_move_speed_mult_e3(const RpgStats& r);
std::uint16_t agi_attack_speed_mult_e3(const RpgStats& r);   // <1000 = faster
std::uint16_t agi_ranged_spread_mult_e3(const RpgStats& r);  // <1000 = tighter
std::uint16_t int_xp_mult_e3(const RpgStats& r);
std::uint16_t int_psi_cost_mult_e3(const RpgStats& r);
std::uint16_t int_contract_reward_mult_e3(const RpgStats& r);
std::uint16_t int_document_reward_mult_e3(const RpgStats& r);

// Flat seconds added to a PSI effect's duration, +1 s per INT point.
std::uint16_t int_psi_duration_bonus_sec(const RpgStats& r);

// A heavy weapon (base cooldown >= 0.65 s) is sped up by STR; a light one is not.
// The threshold is the reference's `HEAVY_WEAPON_COOLDOWN` and the gate is why STR
// is not simply a universal attack-speed stat.
inline constexpr std::uint16_t kHeavyWeaponCooldownMs = 650;
std::uint16_t str_heavy_weapon_speed_mult_e3(const RpgStats& r,
                                            std::uint16_t baseCooldownMs);

// Melee damage for a swing, rounded. Matches the reference's two-branch
// `meleeBaseDamage`: WITH a weapon, damage is `weaponDamage + (level-1)`; BARE
// HANDED it is `max(1, level)` and the weapon number is ignored entirely. Then the
// STR multiplier applies to whichever. `weaponId == 0` means bare hands, the same
// sentinel [item_table.h] uses.
std::int16_t melee_damage(const RpgStats& r, ItemId weaponId,
                          std::int16_t weaponDamage);

// PSI cost after INT efficiency, floored at 1. The reference rounds to one decimal
// place; costs here are integers, so this rounds to the nearest whole point.
std::uint16_t adjusted_psi_cost(std::uint16_t baseCost, const RpgStats& r);

// Attempts to spend PSI points after INT cost adjustment. Returns true if afford and debited.
bool psi_spend(RpgStats& r, std::uint16_t baseCost);

// Regenerates PSI towards max_psi based on INT attribute.
void psi_regen_step(RpgStats& r, float dt);

// Drains PSI (e.g. from mental damage or samosbor field exposure), clamped to zero.
void psi_drain(RpgStats& r, std::uint16_t amount);

// ---------------------------------------------------------------------------
// XP sources
// ---------------------------------------------------------------------------
// Every kill/quest XP number in the game comes from one of these three, so the INT
// bonus is applied in exactly one place (`award_xp`) and cannot be double-counted.
//
// Per-kind base XP times the monster's own level: base * (1 + 0.22*(L-1)). The
// reference authors 36 of the 69 kinds explicitly and defaults the rest to 10.
std::uint32_t xp_for_monster_kill(MobKind kind, std::uint8_t monsterLevel);
std::uint32_t xp_for_npc_kill(std::uint8_t npcLevel);
std::uint32_t xp_for_quest(std::uint16_t difficultyE1);  // difficulty x10

// What one `award_xp` call did. Returned rather than pushed to a message log,
// because `giga_game` has no HUD — the caller turns this into a feed line.
struct XpAward {
    std::uint32_t granted = 0;      // after the INT multiplier
    std::uint8_t levelsGained = 0;
    std::uint8_t newLevel = 1;
    bool atCap = false;
};

// Award XP, applying the INT bonus, and level up as many times as the total
// allows. Each level grants +1 attribute point and refills PSI to the new max.
//
// `hp`/`maxHp` are optional and updated in step: a level-up raises max HP via the
// STR curve, and the reference adds the DIFFERENCE to current HP rather than
// refilling — so levelling heals you by exactly what it added, never fully. Pass
// nullptr for a character whose HP lives elsewhere ([combat.h] documents that split).
//
// At the cap, XP is zeroed rather than accumulated: a capped character's xp bar is
// meaningless and a growing number would eventually overflow.
XpAward award_xp(RpgStats& r, std::uint32_t amount,
                 std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);

// Spend one unspent point on `a`. Returns false with nothing changed if there are
// no points, or the attribute is already at cap.
//
// STR and INT immediately re-derive max HP / max PSI and credit the gain to the
// current value, matching `award_xp`'s difference rule.
bool spend_attr_point(RpgStats& r, Attr a,
                      std::int16_t* hp = nullptr, std::int16_t* maxHp = nullptr);

} // namespace giga::game
