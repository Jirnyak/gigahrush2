// Global item catalog — every item in the world as one flat DATA table ([items.md]).
//
// The same data-oriented stance as FloorSpec ([floors.md]) and the faction matrix
// ([macrosim.md]): an item's identity, worth and what happens when you use it live
// in a static catalog of POD rows, never in code branches. An inventory slot
// ([inventory.h]) stores a `uint16` id; that id indexes THIS table — array index
// IS the id, exactly as an NpcId is its pool slot. Id 0 is the empty/none sentinel.
//
// Ported from the reference (`../gigahrush`, src/data/items.ts + src/core/types.ts).
// The reference keys items by string; here the id is a small integer (the enum
// below) so lookups are O(1) array reads with no hashing in the hot path. The
// `name` field keeps the reference's string key for HUD/debug and loot resolution.
//
// Scope note: this is the sim-relevant schema + a faithful REPRESENTATIVE catalog
// (every ItemType and every use-effect archetype). Weapon *combat* stats (damage,
// range, magazine, ammo type) are a SEPARATE registry keyed by the same id — they
// land with combat, not here, exactly as the reference splits ItemDef from weapon
// stats. Growing the catalog toward the full reference set is a pure data edit.
#pragma once

#include <cstdint>

namespace giga::game {

struct Needs; // [ai.h] — apply_use_effect feeds an embodied agent's drives

// ---------------------------------------------------------------------------
// Coarse category. Numeric values are load-bearing (the reference branches on the
// ordinal and future systems will too) — FOOD..AMMO match src/core/types.ts.
// ---------------------------------------------------------------------------
enum class ItemType : std::uint8_t {
    Food = 0,   // consumable, restores the food reserve
    Drink,      // consumable, restores the water reserve
    Medicine,   // consumable, restores hp / psi (or trades reserves for sleep)
    Weapon,     // combat stats live in a separate registry (see header note)
    Tool,       // utility (lockpick, flashlight, crowbar)
    Key,        // opens a door / container
    Note,       // readable / quest text
    Misc,       // everything else — armor, junk, craft, valuables
    Ammo,       // feeds a ranged weapon
    Count,
};

// Armor damage channels ([items.md]; reference DamageType). A def's `resist[]`
// carries the percent mitigation per channel (0 for non-armor items).
enum DamageType : std::uint8_t {
    DmgKinetic = 0, // bullets / blunt
    DmgBuckshot,    // shotgun spread
    DmgEnergy,      // plasma / beam
    DmgFire,        // flame / heat
    DmgPsi,         // psychic
    kDamageTypeCount,
};

// Behaviour/economy tag families — a bitmask so one item can be several things
// (an armored coat is Armor+Valuable). A focused subset of the reference's ~40
// tokens: the ones loot placement, the economy and the AI actually branch on.
// Extend by adding a bit; rows OR the bits they carry.
enum ItemTag : std::uint32_t {
    TagNone       = 0,
    TagWeapon     = 1u << 0,
    TagRanged     = 1u << 1,
    TagMelee      = 1u << 2,
    TagAmmo       = 1u << 3,
    TagArmor      = 1u << 4,
    TagConsumable = 1u << 5,  // has a use-effect
    TagFood       = 1u << 6,
    TagDrink      = 1u << 7,
    TagMedicine   = 1u << 8,
    TagTool       = 1u << 9,
    TagKey        = 1u << 10,
    TagContraband = 1u << 11, // illegal to carry past a checkpoint
    TagValuable   = 1u << 12, // high price-to-weight — worth looting
    TagCraft      = 1u << 13, // crafting/repair material
    TagScience    = 1u << 14, // research value
    TagQuest      = 1u << 15, // objective item
};

// ---------------------------------------------------------------------------
// UseEffect — what consuming an item does, as a flat delta struct.
//
// The reference stores `use` as a closure; a closure is not data and cannot sit
// in a static table or serialise, so every closure is re-encoded here as the
// deltas it applied. Products are BAKED at authoring time: the reference's
// `feed(v)` adds v to food and v*0.7 / v*0.3 to the poo/pee digestion pools, so a
// 15-food bread stores dPendingPoo=10.5, dPendingPee=4.5 directly. Those pending
// pools are exactly the ones needs_step ([ai.h]) digests into pee/poo pressure —
// eating here closes the digestion loop #12a already models. All-zero = inert
// (weapons, keys, junk have no use-effect).
// ---------------------------------------------------------------------------
struct UseEffect {
    std::int16_t dFood;         // reserve deltas, applied clamped to [0,100]
    std::int16_t dWater;
    std::int16_t dSleep;
    std::int16_t dHp;           // + heals, - hurts (risky food, pill side-effects)
    std::int16_t dPsi;          // no psi target yet — stored, applied when psi lands
    float dPendingPoo;          // adds to the digestion pool eating fills
    float dPendingPee;
    std::uint16_t transformOutput; // item id this becomes after use (0 = consumed)
    std::uint8_t transformCount;   // how many `transformOutput` it yields
};

// ---------------------------------------------------------------------------
// One catalog row. POD aggregate — field order matches the catalog rows in
// item_table.cpp (same convention as FloorSpec).
// ---------------------------------------------------------------------------
struct ItemDef {
    ItemType type;
    const char* name;            // reference string key, e.g. "bread" — HUD/debug/loot
    std::uint16_t value;         // price in rubles (economy axis, loot value gate)
    std::uint16_t spawnW;        // base spawn weight (0 = never spawns naturally)
    std::uint16_t stack;         // max stack size in one inventory slot
    std::uint16_t durability;    // uses/condition before it breaks (0 = n/a)
    std::int8_t resist[kDamageTypeCount]; // armor mitigation %, per DamageType
    std::uint32_t tags;          // ItemTag bitmask
    std::uint16_t science;       // research value (reference scienceValue)
    std::uint8_t contraband;     // 0..100 how illegal it is to carry
    std::uint8_t deceptive;      // 0..100 how well it passes a search
    UseEffect use;               // consumption deltas (all-zero = inert)
};

// Stable integer ids. Array index IS the id; 0 = none/empty (the inventory
// convention, [inventory.h]). Keep in lock-step with the catalog rows in
// item_table.cpp — a static_assert there guards against drift.
enum ItemId : std::uint16_t {
    ItemNone = 0,
    // Food
    ItemBread, ItemCannedFood, ItemRawMeat,
    // Drink
    ItemWater, ItemVodka,
    // Medicine
    ItemBandage, ItemMedkit, ItemPainkillers, ItemPsiStim, ItemSleepingPills, ItemAntirad,
    // Weapons
    ItemAk47, ItemPistol, ItemShotgun, ItemKnife,
    // Ammo
    ItemAmmo762, ItemAmmo9mm, ItemAmmoBuck,
    // Armor (Misc + TagArmor)
    ItemArmorLight, ItemArmorHeavy, ItemHelmet, ItemGasmask,
    // Tools
    ItemCrowbar, ItemLockpick, ItemFlashlight,
    // Key / note / contraband
    ItemKeycard, ItemNote, ItemCigs,
    // Craft / junk
    ItemScrapMetal, ItemWireCoil, ItemRebar, ItemMetalSheet, ItemWetRagBundle,
    // Valuables / science
    ItemScienceSample, ItemArtifact,
    kItemCount, // == number of catalog rows, including ItemNone
};

// Read an item's definition by id. Bounds-tolerant: id 0 or any id >= kItemCount
// returns a static inert "none" row rather than indexing past the catalog (the
// same defensive lookup as FactionMatrix::attitude).
const ItemDef& item_def(std::uint16_t id);

// Resolve a reference string key ("bread") to its id, or ItemNone if unknown.
// Linear scan over the catalog — a cold path (loot authoring / table resolution),
// never the hot tick. Case-sensitive, matches the reference keys verbatim.
std::uint16_t item_id(const char* name);

// True if a def carries a tag.
inline bool item_has_tag(const ItemDef& def, ItemTag tag) {
    return (def.tags & static_cast<std::uint32_t>(tag)) != 0;
}

// Apply an item's use-effect to an embodied agent's needs and hp, in place.
// Reserves clamp to [0,100], hp clamps to [0,maxHp], pending pools stay >= 0.
// `dPsi` is stored in the table but not applied (no psi stat yet — the same
// stubbed-input stance as the scorer, [ai.h]). Returns the id the item transforms
// into (0 = fully consumed / no transform), so a caller can replace the slot.
std::uint16_t apply_use_effect(Needs& needs, std::int16_t& hp, std::int16_t maxHp,
                               const ItemDef& def);

} // namespace giga::game
