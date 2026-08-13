#include "game/craft.h"

#include <bit>

#include "core/rng.h"            // hash2 / rand01 / rand_below — stateless, no seed to advance
#include "game/combat.h"         // equipped_melee / equipped_armour
#include "game/ranged_table.h"   // equipped_ranged

namespace giga::game {

namespace {

// Where one unit of `id` would land: a partial stack of the same item first, then
// the first free slot. Exactly the rule `give_loot` follows (loot.cpp:262) — one
// spelling of "put an item in a bag" per file is already one too many, but that
// one is buried inside a pickup loop and not callable, so this mirrors it rather
// than diverging from it. Returns -1 when the bag has no room at all.
int slot_for_one(const Inventory& inv, ItemId id) {
    const std::uint8_t cap = item_def(id).stackMax;
    if (cap > 1) {
        for (int i = 0; i < kInvSlots; ++i)
            if (inv.slots[i].item == id && inv.slots[i].count < cap) return i;
    }
    return inv.first_free();
}

// Mirrors vendor.cpp's rule, and the duplication is deliberate rather than lazy:
// `survival_category` / `kKeepAlive` are file-static in vendor.cpp and there is no
// header to reach them through. Copying two lines is the smaller sin than editing
// a file this lane does not own, but it IS a copy — if the vendor's keep-alive
// rule is retuned, this is the second site.
constexpr std::uint16_t kKeepAlive = 2;

bool survival_category(ItemCategory cat) {
    return cat == ItemCategory::Food || cat == ItemCategory::Drink ||
           cat == ItemCategory::Medicine;
}

// Salts, so the weighted material pick and the schematic roll do not correlate:
// with one key both would be the same word, and every item that rolled its rarest
// axis would also have taught its recipe.
constexpr std::uint32_t kMaterialSalt = 0x0C7AF7u;
constexpr std::uint32_t kLearnSalt    = 0x1EA711u;

} // namespace

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const char* craft_fail_text(CraftFail e) {
    switch (e) {
        case CraftFail::None:                  return "ok";
        case CraftFail::UnknownItem:           return "no such item";
        case CraftFail::NotLearned:            return "recipe not learned";
        case CraftFail::NotDiscoverable:       return "recipe cannot be learned";
        case CraftFail::StationMismatch:       return "wrong station";
        case CraftFail::TierTooHigh:           return "not certified for this tier";
        case CraftFail::InsufficientMaterials: return "not enough material";
        case CraftFail::InventoryFull:         return "no room in the bag";
        case CraftFail::EmptySlot:             return "nothing in that slot";
        case CraftFail::DisassemblyStation:    return "need a workbench";
        case CraftFail::NoComposition:         return "item has no composition";
        case CraftFail::Count:                 break;
    }
    return "unknown";
}

std::uint32_t craft_cost_total(ItemId id) {
    if (!item_valid(id)) return 0;
    const CraftRecipe& r = craft_recipe(id);
    std::uint32_t t = 0;
    for (std::size_t i = 0; i < kCraftMaterials; ++i) t += r.comp[i];
    return t;
}

void craft_init(CraftingState& st) {
    st = CraftingState{};
    for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
        if ((craft_recipe(id).flags & kCraftKnownByDefault) == 0) continue;
        const std::size_t bit = static_cast<std::size_t>(id) - 1;
        st.known[bit >> 6] |= (1ull << (bit & 63));
    }
}

bool craft_known(const CraftingState& st, ItemId id) {
    if (!item_valid(id)) return false;
    const std::size_t bit = static_cast<std::size_t>(id) - 1;
    return (st.known[bit >> 6] & (1ull << (bit & 63))) != 0;
}

std::uint32_t craft_known_count(const CraftingState& st) {
    // The 448-bit set covers 446 recipes, so the top 2 bits are structurally 0 and
    // there is nothing to mask off before counting.
    std::uint32_t n = 0;
    for (std::size_t w = 0; w < kCraftKnownWords; ++w)
        n += static_cast<std::uint32_t>(std::popcount(st.known[w]));
    return n;
}

bool craft_station_ok(CraftStation want, CraftStation at) {
    if (want >= CraftStation::Count || at >= CraftStation::Count) return false;
    // Asymmetric: `Any` on the RECIPE means "needs nothing", so it is satisfied by
    // every bench and by bare hands. `Any` as the PLAYER's station means bare
    // hands, which satisfies only an `Any` recipe.
    return want == CraftStation::Any || want == at;
}

void craft_missing(const CraftingState& st, ItemId id, std::uint32_t* out) {
    if (!out) return;
    for (std::size_t i = 0; i < kCraftMaterials; ++i) out[i] = 0;
    if (!item_valid(id)) return;
    const CraftRecipe& r = craft_recipe(id);
    for (std::size_t i = 0; i < kCraftMaterials; ++i)
        if (st.mat[i] < r.comp[i]) out[i] = r.comp[i] - st.mat[i];
}

CraftFail craft_check(const CraftingState& st, const Inventory& inv, ItemId id,
                      CraftStation at) {
    if (!item_valid(id)) return CraftFail::UnknownItem;
    const CraftRecipe& r = craft_recipe(id);
    if (!craft_known(st, id))
        return (r.flags & kCraftDiscoverable) ? CraftFail::NotLearned
                                              : CraftFail::NotDiscoverable;
    if (!craft_station_ok(static_cast<CraftStation>(r.station), at))
        return CraftFail::StationMismatch;
    if (r.tier > st.tier) return CraftFail::TierTooHigh;
    for (std::size_t i = 0; i < kCraftMaterials; ++i)
        if (st.mat[i] < r.comp[i]) return CraftFail::InsufficientMaterials;
    if (slot_for_one(inv, id) < 0) return CraftFail::InventoryFull;
    return CraftFail::None;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

CraftResult craft_item(CraftingState& st, Inventory& inv, ItemId id,
                       CraftStation at) {
    CraftResult out{};
    out.fail = craft_check(st, inv, id, at);
    if (out.fail != CraftFail::None) return out;

    // Place FIRST, debit second. The reference debits then restores on failure
    // (`craftKnownRecipe` puts the vector back if `addItem` refuses after the
    // precheck); doing it in this order makes the rollback unnecessary rather than
    // correct-if-remembered, because `slot_for_one` and the write below cannot
    // disagree — they are the same index.
    const int slot = slot_for_one(inv, id);
    if (slot < 0) {                       // unreachable: craft_check just tested it
        out.fail = CraftFail::InventoryFull;
        return out;
    }
    if (inv.slots[slot].item == id)
        inv.slots[slot].count = static_cast<std::uint16_t>(inv.slots[slot].count + 1);
    else
        inv.slots[slot] = ItemSlot{id, 1};

    const CraftRecipe& r = craft_recipe(id);
    for (std::size_t i = 0; i < kCraftMaterials; ++i) {
        st.mat[i] -= r.comp[i];
        out.spent += r.comp[i];
    }
    out.item = id;
    out.slot = slot;
    return out;
}

DisassembleResult craft_disassemble(CraftingState& st, Inventory& inv, int slot,
                                    CraftStation at, std::uint32_t rollKey) {
    DisassembleResult out{};
    if (slot < 0 || slot >= kInvSlots) { out.fail = CraftFail::EmptySlot; return out; }
    // The workbench is the only disassembly station, straight from the reference's
    // `canDisassembleAtStation`. Checked before the slot contents so standing at a
    // lathe gives the same answer whatever is in the bag.
    if (at != CraftStation::Workbench) {
        out.fail = CraftFail::DisassemblyStation;
        return out;
    }
    const ItemSlot& s = inv.slots[slot];
    if (!item_valid(s.item) || s.count == 0) { out.fail = CraftFail::EmptySlot; return out; }

    const ItemId id = s.item;
    const CraftRecipe& r = craft_recipe(id);
    std::uint32_t total = 0;
    for (std::size_t i = 0; i < kCraftMaterials; ++i) total += r.comp[i];
    // Unreachable against the shipped table — all 446 rows sum to at least 1, and
    // tools/gen_craft_table.py refuses to emit a zero row precisely so this branch
    // cannot be reached. It stays as the tripwire for the day that check is
    // loosened, because the alternative here is a modulo by zero.
    if (total == 0) { out.fail = CraftFail::NoComposition; return out; }

    // Weighted pick over the composition: the axes are the buckets and their counts
    // are the weights, so a 30-metal 1-bio item hands back metal 30 times as often.
    const std::uint32_t roll =
        rand_below(hash2(rollKey, kMaterialSalt ^ id), total);
    std::uint32_t acc = 0;
    std::size_t pick = kCraftMaterials - 1;
    for (std::size_t i = 0; i < kCraftMaterials; ++i) {
        acc += r.comp[i];
        if (roll < acc) { pick = i; break; }
    }

    // Consume the unit only now that the yield is decided, so no path removes an
    // item and then fails.
    ItemSlot& live = inv.slots[slot];
    live.count = static_cast<std::uint16_t>(live.count - 1);
    if (live.count == 0) live = ItemSlot{};

    // ONE unit, whatever the vector totals. See the ratio note in craft.h.
    st.mat[pick] = st.mat[pick] + 1u;
    if (st.mat[pick] > kCraftMaterialMax) st.mat[pick] = kCraftMaterialMax;

    out.fail = CraftFail::None;
    out.item = id;
    out.material = static_cast<CraftMaterial>(pick);
    out.yield = 1;

    // The reference's 50% schematic roll. Teaches, never certifies — so a tier-3
    // recipe learned this way answers TierTooHigh until a source raises the tier.
    if (rand_below(hash2(rollKey, kLearnSalt ^ id), 1000u) < kCraftLearnPerMille)
        out.learned = craft_learn(st, id);
    return out;
}

bool craft_learn(CraftingState& st, ItemId id) {
    if (!item_valid(id)) return false;
    if ((craft_recipe(id).flags & kCraftDiscoverable) == 0) return false;
    if (craft_known(st, id)) return false;
    const std::size_t bit = static_cast<std::size_t>(id) - 1;
    st.known[bit >> 6] |= (1ull << (bit & 63));
    return true;
}

std::uint32_t craft_learn_from_source(CraftingState& st, std::size_t index) {
    if (index >= kCraftSourceCount) return 0;
    const CraftSource& src = kCraftSources[index];
    std::uint32_t learned = 0;
    for (std::size_t i = 0; i < src.count && i < kCraftSourceMaxRecipes; ++i)
        if (craft_learn(st, src.recipe[i])) ++learned;
    // Raised even when nothing was new: certification is not knowledge, and a
    // player who disassembled their way to a recipe still needs the paper.
    if (src.grantsTier > st.tier)
        st.tier = src.grantsTier > kCraftMaxTier ? kCraftMaxTier : src.grantsTier;
    return learned;
}

std::size_t craft_source_for_item(ItemId id) {
    if (!item_valid(id)) return kCraftSourceCount;
    for (std::size_t i = 0; i < kCraftSourceCount; ++i)
        if (kCraftSources[i].unlock == id) return i;
    return kCraftSourceCount;
}

LearnResult craft_learn_from_carried(CraftingState& st, Inventory& inv) {
    LearnResult out{};
    out.tier = st.tier;
    for (int i = 0; i < kInvSlots; ++i) {
        ItemSlot& s = inv.slots[i];
        if (!item_valid(s.item) || s.count == 0) continue;
        const std::size_t src = craft_source_for_item(s.item);
        if (src == kCraftSourceCount) continue;

        const std::uint8_t tierBefore = st.tier;
        const std::uint32_t learned = craft_learn_from_source(st, src);
        // Nothing new AND no new certification: leave the paper alone and keep
        // looking, so one exhausted folder does not mask a second unread one.
        if (learned == 0 && st.tier == tierBefore) continue;

        out.learned = learned;
        out.from = s.item;
        out.source = src;
        out.tier = st.tier;
        // The reference's rule verbatim: single-use papers are "spent only after at
        // least one new recipe is learned". A folder that only re-certified you is
        // not spent.
        if (kCraftSources[src].consume != 0 && learned > 0) {
            s.count = static_cast<std::uint16_t>(s.count - 1);
            if (s.count == 0) s = ItemSlot{};
            out.consumed = true;
        }
        return out;
    }
    return out;
}

// ---------------------------------------------------------------------------
// One-keypress paths
// ---------------------------------------------------------------------------

ItemId craft_best_available(const CraftingState& st, const Inventory& inv,
                            CraftStation at) {
    ItemId best = kInvalidItem;
    std::int32_t bestValue = -1;
    for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
        if (craft_check(st, inv, id, at) != CraftFail::None) continue;
        const std::int32_t v = item_def(id).value;
        // Strictly greater, so the first (lowest) id wins a tie and the pick is
        // reproducible across runs.
        if (v > bestValue) { bestValue = v; best = id; }
    }
    return best;
}

int craft_scrap_slot(const Inventory& inv) {
    const ItemId keepMelee = equipped_melee(inv);
    const ItemId keepArmour = equipped_armour(inv);
    const ItemId keepGun = equipped_ranged(inv);

    // Survival stock is tallied over the WHOLE bag before anything is chosen, for
    // the reason vendor.cpp gives: deciding per-slot would let two slots of one
    // bandage each both qualify and leave zero.
    std::uint16_t have[static_cast<std::size_t>(ItemCategory::Count)] = {};
    for (const ItemSlot& s : inv.slots) {
        if (!item_valid(s.item) || s.count == 0) continue;
        const auto cat = static_cast<ItemCategory>(item_def(s.item).category);
        have[static_cast<std::size_t>(cat)] =
            static_cast<std::uint16_t>(have[static_cast<std::size_t>(cat)] + s.count);
    }

    int best = -1;
    std::int32_t bestValue = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (!item_valid(s.item) || s.count == 0) continue;
        if (s.item == keepMelee || s.item == keepArmour || s.item == keepGun) continue;
        const auto cat = static_cast<ItemCategory>(item_def(s.item).category);
        if (survival_category(cat) &&
            have[static_cast<std::size_t>(cat)] <= kKeepAlive) continue;
        const std::int32_t v = item_def(s.item).value;
        if (best < 0 || v < bestValue) { best = i; bestValue = v; }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

namespace {

void put_u32(std::uint8_t*& p, std::uint32_t v) {
    *p++ = static_cast<std::uint8_t>(v & 0xffu);
    *p++ = static_cast<std::uint8_t>((v >> 8) & 0xffu);
    *p++ = static_cast<std::uint8_t>((v >> 16) & 0xffu);
    *p++ = static_cast<std::uint8_t>((v >> 24) & 0xffu);
}

std::uint32_t get_u32(const std::uint8_t*& p) {
    const std::uint32_t v = static_cast<std::uint32_t>(p[0]) |
                            (static_cast<std::uint32_t>(p[1]) << 8) |
                            (static_cast<std::uint32_t>(p[2]) << 16) |
                            (static_cast<std::uint32_t>(p[3]) << 24);
    p += 4;
    return v;
}

} // namespace

void craft_write(const CraftingState& st, std::uint8_t* out) {
    if (!out) return;
    std::uint8_t* p = out;
    for (std::size_t w = 0; w < kCraftKnownWords; ++w) {
        put_u32(p, static_cast<std::uint32_t>(st.known[w] & 0xffffffffull));
        put_u32(p, static_cast<std::uint32_t>(st.known[w] >> 32));
    }
    for (std::size_t i = 0; i < kCraftMaterials; ++i) put_u32(p, st.mat[i]);
    *p++ = st.tier;
}

bool craft_read(const std::uint8_t* in, std::size_t n, CraftingState& st) {
    if (!in || n < kCraftingWire) return false;   // untouched on refusal
    CraftingState tmp{};
    const std::uint8_t* p = in;
    for (std::size_t w = 0; w < kCraftKnownWords; ++w) {
        const std::uint32_t lo = get_u32(p);
        const std::uint32_t hi = get_u32(p);
        tmp.known[w] = static_cast<std::uint64_t>(lo) |
                       (static_cast<std::uint64_t>(hi) << 32);
    }
    for (std::size_t i = 0; i < kCraftMaterials; ++i) {
        const std::uint32_t v = get_u32(p);
        tmp.mat[i] = v > kCraftMaterialMax ? kCraftMaterialMax : v;
    }
    const std::uint8_t tier = *p++;
    tmp.tier = tier > kCraftMaxTier ? kCraftMaxTier : tier;

    // Drop bits naming rows the table does not have. 448 bits over 446 recipes, so
    // this only ever clears the top 2 of the last word today. `if constexpr`
    // because the count is known at compile time and MSVC /W4 raises C4127 on a
    // runtime `if` over a constant — and [AGENTS.md] means zero warnings.
    constexpr std::size_t kSpareBits = kCraftKnownWords * 64 - kCraftRecipeCount;
    if constexpr (kSpareBits > 0)
        tmp.known[kCraftKnownWords - 1] &= (~0ull >> kSpareBits);

    st = tmp;
    return true;
}

CraftResult craft_from_junk(Inventory& inv, const JunkRecipe& recipe, CraftStation at) {
    if (!item_valid(recipe.resultItem)) {
        return CraftResult{CraftFail::UnknownItem, kInvalidItem, -1, 0};
    }
    if (!craft_station_ok(recipe.station, at)) {
        return CraftResult{CraftFail::StationMismatch, kInvalidItem, -1, 0};
    }
    if (recipe.reqCount == 0) {
        return CraftResult{CraftFail::NoComposition, kInvalidItem, -1, 0};
    }

    // Check material quantities across inventory
    for (std::size_t r = 0; r < recipe.reqCount && r < kJunkMaxReqs; ++r) {
        const auto& req = recipe.reqs[r];
        std::uint32_t have = 0;
        for (int i = 0; i < kInvSlots; ++i) {
            const ItemSlot& sl = inv.slots[i];
            if (sl.item == 0 || sl.count == 0) continue;
            if (item_def(sl.item).category == static_cast<std::uint8_t>(req.category)) {
                have += sl.count;
            }
        }
        if (have < req.count) {
            return CraftResult{CraftFail::InsufficientMaterials, kInvalidItem, -1, 0};
        }
    }

    // Check if there is room for result
    const int targetSlot = slot_for_one(inv, recipe.resultItem);
    if (targetSlot < 0) {
        return CraftResult{CraftFail::InventoryFull, kInvalidItem, -1, 0};
    }

    // Spend materials deterministically (from lower slots to higher)
    std::uint32_t totalSpentValue = 0;
    for (std::size_t r = 0; r < recipe.reqCount && r < kJunkMaxReqs; ++r) {
        const auto& req = recipe.reqs[r];
        std::uint32_t needed = req.count;
        for (int i = 0; i < kInvSlots && needed > 0; ++i) {
            ItemSlot& sl = inv.slots[i];
            if (sl.item == 0 || sl.count == 0) continue;
            if (item_def(sl.item).category == static_cast<std::uint8_t>(req.category)) {
                const std::uint32_t take = (needed < static_cast<std::uint32_t>(sl.count))
                                               ? needed
                                               : static_cast<std::uint32_t>(sl.count);
                totalSpentValue += static_cast<std::uint32_t>(item_def(sl.item).value) * take;
                sl.count = static_cast<std::uint16_t>(sl.count - take);
                needed -= take;
                if (sl.count == 0) {
                    sl = ItemSlot{};
                }
            }
        }
    }

    // Place crafted item in inventory
    ItemSlot& dst = inv.slots[targetSlot];
    if (dst.item == recipe.resultItem) {
        dst.count = static_cast<std::uint16_t>(dst.count + recipe.resultCount);
    } else {
        dst.item = recipe.resultItem;
        dst.count = recipe.resultCount;
    }

    return CraftResult{CraftFail::None, recipe.resultItem, targetSlot, totalSpentValue};
}

} // namespace giga::game
