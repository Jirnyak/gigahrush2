// Item catalog data + lookups ([item_table.h]).
//
// The rows below are the DATA — one ItemDef per ItemId, in enum order so array
// index == id. Ported from the reference (`../gigahrush`, src/data/items.ts): a
// faithful representative span covering every ItemType and every use-effect
// archetype (feed / drink / medicine / psi / sleeping-pill trade-off / risky
// food). Values (price, spawn weight, resistances) follow the reference rows
// where it gave concrete numbers and its spirit elsewhere. Growing this toward
// the full ~444-item set is a pure data edit — no code changes.
#include "game/item_table.h"

#include <cstring>

#include "game/ai.h" // Needs + NeedId indices for apply_use_effect

namespace giga::game {

namespace {

// Field order: type, name, value, spawnW, stack, durability, resist[5],
// tags, science, contraband, deceptive, use{dFood,dWater,dSleep,dHp,dPsi,
// dPendingPoo,dPendingPee, transformOutput,transformCount}.
//
// Row index MUST equal the ItemId enum value (static_assert below guards it).
const ItemDef kItemTable[] = {
    // 0 — none/empty sentinel (an empty inventory slot resolves here).
    {ItemType::Misc, "none", 0, 0, 0, 0, {0, 0, 0, 0, 0}, TagNone, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},

    // --- Food (reserve: food; fills the poo/pee digestion pools) -------------
    {ItemType::Food, "bread", 3, 40, 10, 0, {0, 0, 0, 0, 0},
     TagFood | TagConsumable, 0, 0, 0, {15, 0, 0, 0, 0, 10.5f, 4.5f, 0, 0}},
    {ItemType::Food, "canned_food", 8, 28, 8, 0, {0, 0, 0, 0, 0},
     TagFood | TagConsumable, 0, 0, 0, {30, 0, 0, 0, 0, 21.0f, 9.0f, 0, 0}},
    {ItemType::Food, "rawmeat", 2, 18, 6, 0, {0, 0, 0, 0, 0},
     TagFood | TagConsumable, 0, 0, 0, {18, 0, 0, -6, 0, 18.0f, 7.2f, 0, 0}},

    // --- Drink (reserve: water; fills the pee pool) --------------------------
    {ItemType::Drink, "water", 2, 40, 10, 0, {0, 0, 0, 0, 0},
     TagDrink | TagConsumable, 0, 0, 0, {0, 25, 0, 0, 0, 0.0f, 15.0f, 0, 0}},
    {ItemType::Drink, "vodka", 15, 10, 6, 0, {0, 0, 0, 0, 0},
     TagDrink | TagConsumable | TagContraband, 0, 25, 0,
     {0, 10, 0, 0, 0, 0.0f, 6.0f, 0, 0}},

    // --- Medicine (hp / psi; sleeping pills trade reserves for sleep) --------
    {ItemType::Medicine, "bandage", 10, 22, 8, 0, {0, 0, 0, 0, 0},
     TagMedicine | TagConsumable, 0, 0, 0, {0, 0, 0, 15, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Medicine, "medkit", 60, 8, 3, 0, {0, 0, 0, 0, 0},
     TagMedicine | TagConsumable | TagValuable, 0, 0, 0,
     {0, 0, 0, 45, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Medicine, "painkillers", 25, 14, 6, 0, {0, 0, 0, 0, 0},
     TagMedicine | TagConsumable, 0, 0, 0, {0, 0, 0, 20, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Medicine, "psi_stim", 80, 6, 4, 0, {0, 0, 0, 0, 0},
     TagMedicine | TagConsumable | TagValuable, 0, 0, 0,
     {0, 0, 0, 0, 30, 0.0f, 0.0f, 0, 0}},
    {ItemType::Medicine, "sleeping_pills", 18, 10, 6, 0, {0, 0, 0, 0, 0},
     TagMedicine | TagConsumable, 0, 0, 0, {-8, -16, 45, -4, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Medicine, "antirad", 35, 8, 6, 0, {0, 0, 0, 0, 0},
     TagMedicine | TagConsumable, 0, 0, 0, {0, 0, 0, 8, 0, 0.0f, 0.0f, 0, 0}},

    // --- Weapons (inert use; combat stats are a separate registry) -----------
    {ItemType::Weapon, "ak47", 5500, 3, 1, 100, {0, 0, 0, 0, 0},
     TagWeapon | TagRanged | TagValuable, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Weapon, "pistol", 800, 10, 1, 80, {0, 0, 0, 0, 0},
     TagWeapon | TagRanged, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Weapon, "shotgun", 2200, 6, 1, 90, {0, 0, 0, 0, 0},
     TagWeapon | TagRanged | TagValuable, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Weapon, "knife", 120, 14, 1, 120, {0, 0, 0, 0, 0},
     TagWeapon | TagMelee, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},

    // --- Ammo ----------------------------------------------------------------
    {ItemType::Ammo, "ammo_762", 40, 20, 60, 0, {0, 0, 0, 0, 0}, TagAmmo, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Ammo, "ammo_9mm", 25, 22, 45, 0, {0, 0, 0, 0, 0}, TagAmmo, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Ammo, "ammo_buckshot", 35, 16, 30, 0, {0, 0, 0, 0, 0}, TagAmmo, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},

    // --- Armor (Misc + TagArmor; resist[] is the mitigation %) ---------------
    {ItemType::Misc, "armor_light", 500, 8, 1, 120, {20, 30, 0, 5, 0},
     TagArmor | TagValuable, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "armor_heavy", 1800, 3, 1, 200, {40, 45, 10, 15, 0},
     TagArmor | TagValuable, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "helmet", 260, 10, 1, 100, {15, 10, 0, 0, 5},
     TagArmor, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "gasmask", 180, 10, 1, 80, {0, 0, 5, 10, 10},
     TagArmor, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},

    // --- Tools ---------------------------------------------------------------
    {ItemType::Tool, "crowbar", 90, 12, 1, 150, {0, 0, 0, 0, 0},
     TagTool | TagMelee, 0, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Tool, "lockpick", 45, 14, 10, 20, {0, 0, 0, 0, 0}, TagTool, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Tool, "flashlight", 70, 12, 1, 100, {0, 0, 0, 0, 0}, TagTool, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},

    // --- Key / note / contraband ---------------------------------------------
    {ItemType::Key, "keycard", 0, 6, 1, 0, {0, 0, 0, 0, 0}, TagKey | TagQuest, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Note, "note", 0, 10, 1, 0, {0, 0, 0, 0, 0}, TagQuest, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "cigs", 20, 16, 10, 0, {0, 0, 0, 0, 0},
     TagConsumable | TagContraband, 0, 20, 0, {0, 0, 0, 0, 5, 0.0f, 0.0f, 0, 0}},

    // --- Craft / junk (monster & container drops) ----------------------------
    {ItemType::Misc, "scrap_metal", 6, 26, 20, 0, {0, 0, 0, 0, 0}, TagCraft, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "wire_coil", 12, 22, 15, 0, {0, 0, 0, 0, 0}, TagCraft, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "rebar", 10, 18, 10, 0, {0, 0, 0, 0, 0}, TagCraft | TagMelee, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "metal_sheet", 15, 16, 10, 0, {0, 0, 0, 0, 0}, TagCraft, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "wet_rag_bundle", 3, 14, 12, 0, {0, 0, 0, 0, 0}, TagCraft, 0, 0, 0,
     {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},

    // --- Valuables / science --------------------------------------------------
    {ItemType::Misc, "science_sample", 0, 6, 8, 0, {0, 0, 0, 0, 0},
     TagScience | TagValuable, 120, 0, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
    {ItemType::Misc, "artifact", 3500, 1, 1, 0, {0, 0, 0, 0, 0},
     TagScience | TagValuable, 400, 40, 0, {0, 0, 0, 0, 0, 0.0f, 0.0f, 0, 0}},
};

static_assert(sizeof(kItemTable) / sizeof(kItemTable[0]) == kItemCount,
              "item_table rows must stay in lock-step with the ItemId enum");

} // namespace

const ItemDef& item_def(std::uint16_t id) {
    if (id >= kItemCount) return kItemTable[ItemNone];
    return kItemTable[id];
}

std::uint16_t item_id(const char* name) {
    if (name == nullptr) return ItemNone;
    for (std::uint16_t i = 0; i < kItemCount; ++i) {
        if (std::strcmp(kItemTable[i].name, name) == 0) return i;
    }
    return ItemNone;
}

std::uint16_t apply_use_effect(Needs& needs, std::int16_t& hp, std::int16_t maxHp,
                               const ItemDef& def) {
    const UseEffect& u = def.use;

    // Reserves (food/water/sleep) clamp to [kNeedMin, kNeedMax].
    auto add_reserve = [&](NeedId n, int delta) {
        float v = needs.v[n] + static_cast<float>(delta);
        if (v < kNeedMin) v = kNeedMin;
        if (v > kNeedMax) v = kNeedMax;
        needs.v[n] = v;
    };
    add_reserve(NeedFood, u.dFood);
    add_reserve(NeedWater, u.dWater);
    add_reserve(NeedSleep, u.dSleep);

    // hp clamps to [0, maxHp] — a use-effect may heal or (risky food/pills) hurt.
    int h = static_cast<int>(hp) + static_cast<int>(u.dHp);
    if (h < 0) h = 0;
    if (h > maxHp) h = maxHp;
    hp = static_cast<std::int16_t>(h);

    // Fill the digestion pools needs_step later turns into pee/poo pressure.
    needs.pendingPoo += u.dPendingPoo;
    needs.pendingPee += u.dPendingPee;
    if (needs.pendingPoo < 0.0f) needs.pendingPoo = 0.0f;
    if (needs.pendingPee < 0.0f) needs.pendingPee = 0.0f;

    // u.dPsi intentionally not applied — no psi stat yet (stubbed-input stance).
    return u.transformOutput;
}

} // namespace giga::game
