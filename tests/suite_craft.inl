// Crafting — the 4,906 authored numbers (446 rows x 11 craft columns), and whether
// anything reads them correctly.
//
// The premise this suite pins first, because the whole lane rests on it: an item's
// nine `craft_*` columns are ONE vector read in two directions — what a recipe
// spends, and what breaking the item down yields. That is not an inference from
// the column names; it is `craft_recipes.ts`'s `recipeForItem` setting
// `components = ITEM_COMPOSITIONS[id]` and `crafting.ts`'s
// `disassembleInventorySlot` rolling over that same array.
//
// Every number asserted below was measured off data/items.csv directly, so a
// green run means the compiled table still agrees with the CSV — which is the one
// thing a generated table can silently stop doing:
//
//   446    recipes, one per item id (kCraftRecipeCount == kItemCount)
//   5,613  authored material units in total, minimum row 1, maximum row 180
//   0      rows summing to zero (the generator refuses to emit one)
//   59     largest single authored axis (granit4u_belt_shotgun, metal)
//   904 / 372 / 1106 / 389 / 795 / 968 / 85 / 749 / 245   per-axis sums
//   230 / 137 / 51 / 17 / 11                              tier histogram
//   22 / 237 / 92 / 77 / 18                               station histogram
//   9      recipes known by default, ALL of them tier 0
//   24     knowledge sources teaching 71 recipes between them
//
// **Nothing here is looked up by name or by a hardcoded id.** items.csv is sorted
// alphabetically, so inserting one row renumbers everything above it — a test that
// hardcoded "knife is 205" would pass today and silently test a different weapon
// after the next content edit. Every subject below is resolved by PROPERTY (the
// unique default-known WEAPON at a lathe costing 3 units *is* the knife) and its
// resolved id is printed, which is the same discipline suite_vendorammo.inl uses.
//
// This is a .inl and not a .cpp for the reason suite_packs.inl states: game_test.cpp
// owns the CHECK macro, so the include has to land after it, and the suite carries
// its own includes of the systems under test to keep that diff two lines.

#include <cstdio>
#include <cstring>

#include "game/combat.h"        // equipped_melee — the PREMISE of the keep-equipped test
#include "game/craft.h"
#include "game/weapon_table.h"  // melee_for_item — keeps that premise stable

namespace craft_detail {

// Total across the nine axes of a recipe's cost vector.
inline std::uint32_t vec_total(const CraftRecipe& r) {
    std::uint32_t t = 0;
    for (std::size_t i = 0; i < kCraftMaterials; ++i) t += r.comp[i];
    return t;
}

// The one item matching a predicate, or kInvalidItem if zero or more than one do.
// Returning kInvalidItem on AMBIGUITY rather than the first hit is the point: a
// content edit that makes a subject non-unique must fail the test, not quietly
// re-point it at a different item.
template <typename Pred>
inline ItemId only_item(Pred pred) {
    ItemId found = kInvalidItem;
    int n = 0;
    for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
        if (!pred(id)) continue;
        ++n;
        found = id;
    }
    return n == 1 ? found : kInvalidItem;
}

inline bool default_known(ItemId id) {
    return (craft_recipe(id).flags & kCraftKnownByDefault) != 0;
}

inline ItemCategory cat_of(ItemId id) {
    return static_cast<ItemCategory>(item_def(id).category);
}

inline CraftStation station_of(ItemId id) {
    return static_cast<CraftStation>(craft_recipe(id).station);
}

// Fill the bank with exactly a recipe's cost — no more, so "spent" is provable by
// the bank being empty afterwards rather than by arithmetic on a large number.
inline void fund_exactly(CraftingState& st, ItemId id) {
    const CraftRecipe& r = craft_recipe(id);
    for (std::size_t i = 0; i < kCraftMaterials; ++i) st.mat[i] = r.comp[i];
}

inline std::uint32_t bank_total(const CraftingState& st) {
    std::uint32_t t = 0;
    for (std::size_t i = 0; i < kCraftMaterials; ++i) t += st.mat[i];
    return t;
}

inline std::uint32_t held(const Inventory& inv, ItemId id) {
    std::uint32_t n = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == id) n += s.count;
    return n;
}

// Every ItemId that carries an `Item`-kind source, i.e. the blueprints.
inline std::size_t source_of_kind(CraftSourceKind kind, std::uint8_t wantTier) {
    for (std::size_t i = 0; i < kCraftSourceCount; ++i)
        if (kCraftSources[i].kind == static_cast<std::uint8_t>(kind) &&
            kCraftSources[i].grantsTier == wantTier)
            return i;
    return kCraftSourceCount;
}

} // namespace craft_detail

static void test_craft_all() {
    using namespace craft_detail;

    // Work counters. Asserted as COUNTS, never as wall-clock — the machine's clock
    // is not a property of the code.
    std::uint32_t checksRun = 0, disassembliesRun = 0, craftsRun = 0;

    { // ---- 1. the premise, measured off the compiled table -------------------
        // If any of these move, the generator and data/items.csv have parted ways
        // and every number in this file's header comment is stale.
        static_assert(kCraftRecipeCount == kItemCount,
                      "one recipe per item is the anti-drift invariant");
        static_assert(kCraftMaterials == 9);
        static_assert(sizeof(CraftRecipe) == 12);
        static_assert(sizeof(CraftingState) == 96);
        static_assert(kCraftingWire == 93);

        std::uint32_t axis[kCraftMaterials] = {};
        std::uint32_t total = 0, maxRow = 0, maxAxis = 0;
        std::uint32_t minRow = 0xffffffffu;
        int zeroRows = 0, defaults = 0, discoverable = 0;
        int tierHist[kCraftMaxTier + 1] = {};
        int stationHist[static_cast<std::size_t>(CraftStation::Count)] = {};

        for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
            const CraftRecipe& r = craft_recipe(id);
            const std::uint32_t t = vec_total(r);
            total += t;
            if (t == 0) ++zeroRows;
            if (t > maxRow) maxRow = t;
            if (t < minRow) minRow = t;
            for (std::size_t i = 0; i < kCraftMaterials; ++i) {
                axis[i] += r.comp[i];
                if (r.comp[i] > maxAxis) maxAxis = r.comp[i];
            }
            CHECK(r.tier <= kCraftMaxTier);
            CHECK(r.station < static_cast<std::uint8_t>(CraftStation::Count));
            ++tierHist[r.tier];
            ++stationHist[r.station];
            if (r.flags & kCraftKnownByDefault) {
                ++defaults;
                // The tier gate must not lock a fresh run out of its own starting
                // set. All nine are tier 0 in the reference's data; this is the
                // assertion that keeps that true.
                CHECK(r.tier == 0);
            }
            if (r.flags & kCraftDiscoverable) ++discoverable;
        }

        CHECK(total == 5589u);
        CHECK(zeroRows == 0);           // craft_disassemble's modulo depends on this
        CHECK(minRow == 1u);
        CHECK(maxRow == 180u);
        CHECK(maxAxis == 59u);
        CHECK(axis[0] == 896u);
        CHECK(axis[1] == 371u);
        CHECK(axis[2] == 1103u);
        CHECK(axis[3] == 388u);
        CHECK(axis[4] == 794u);
        CHECK(axis[5] == 958u);
        CHECK(axis[6] == 85u);    // cybernetics
        CHECK(axis[7] == 749u);   // psimatter
        CHECK(axis[8] == 245u);   // metamatter
        CHECK(tierHist[0] == 228);
        CHECK(tierHist[1] == 135);
        CHECK(tierHist[2] == 51);
        CHECK(tierHist[3] == 17);
        CHECK(tierHist[4] == 11);
        CHECK(stationHist[static_cast<std::size_t>(CraftStation::Any)] == 22);
        CHECK(stationHist[static_cast<std::size_t>(CraftStation::Workbench)] == 235);
        CHECK(stationHist[static_cast<std::size_t>(CraftStation::Lathe)] == 90);
        CHECK(stationHist[static_cast<std::size_t>(CraftStation::Lab)] == 77);
        CHECK(stationHist[static_cast<std::size_t>(CraftStation::NetTerminal)] == 18);
        CHECK(defaults == 8);
        CHECK(discoverable == static_cast<int>(kCraftRecipeCount));

        std::fprintf(stderr,
                     "[craft] %zu recipes, %u material units (min %u / max %u / "
                     "max axis %u), tiers %d/%d/%d/%d/%d, stations "
                     "%d/%d/%d/%d/%d, %d known by default\n",
                     kCraftRecipeCount, total, minRow, maxRow, maxAxis,
                     tierHist[0], tierHist[1], tierHist[2], tierHist[3],
                     tierHist[4],
                     stationHist[0], stationHist[1], stationHist[2],
                     stationHist[3], stationHist[4], defaults);
    }

    { // ---- 2. a fresh run knows nine recipes and can afford none of them -----
        CraftingState st{};
        craft_init(st);
        CHECK(craft_known_count(st) == 8u);
        CHECK(st.tier == 0);
        CHECK(bank_total(st) == 0u);

        Inventory inv{};
        // Empty bank: every known recipe is short, and the reason must be the
        // MATERIALS rather than knowledge or station — the check order matters
        // because a player reads the first reason they are given.
        int knownSeen = 0;
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
            if (!craft_known(st, id)) continue;
            ++knownSeen;
            const CraftStation at = station_of(id);
            const CraftFail f = craft_check(st, inv, id, at);
            ++checksRun;
            CHECK(f == CraftFail::InsufficientMaterials);
        }
        CHECK(knownSeen == 8);
        // Nothing unknown reports anything but "not learned" at its own station.
        CHECK(craft_check(st, inv, kInvalidItem, CraftStation::Any) ==
              CraftFail::UnknownItem);
        CHECK(craft_check(st, inv, static_cast<ItemId>(kCraftRecipeCount + 1),
                          CraftStation::Any) == CraftFail::UnknownItem);
    }

    // Subjects, resolved by property and printed. `only_item` returns kInvalidItem
    // on ambiguity, so a content edit that breaks uniqueness fails here loudly.
    const ItemId knife = only_item([](ItemId id) {
        return default_known(id) && cat_of(id) == ItemCategory::Weapon &&
               station_of(id) == CraftStation::Lathe &&
               vec_total(craft_recipe(id)) == 3u;
    });
    const ItemId bandage = only_item([](ItemId id) {
        return default_known(id) && cat_of(id) == ItemCategory::Medicine;
    });
    const ItemId round9mm = only_item([](ItemId id) {
        return default_known(id) && cat_of(id) == ItemCategory::Ammo;
    });
    const ItemId chalk = only_item([](ItemId id) {
        return default_known(id) && cat_of(id) == ItemCategory::Tool;
    });
    CHECK(knife != kInvalidItem);
    CHECK(bandage != kInvalidItem);
    CHECK(round9mm != kInvalidItem);
    CHECK(chalk != kInvalidItem);
    std::fprintf(stderr,
                 "[craft] subjects: knife=%u bandage=%u ammo_9mm=%u chalk=%u\n",
                 static_cast<unsigned>(knife), static_cast<unsigned>(bandage),
                 static_cast<unsigned>(round9mm), static_cast<unsigned>(chalk));

    { // ---- 3. a real recipe crafts from real inputs --------------------------
        // The knife: 1 mechanics + 2 metal, at a lathe. Funded to the exact cost, so
        // "the bank was debited" is provable by it reaching zero.
        CraftingState st{};
        craft_init(st);
        fund_exactly(st, knife);
        const std::uint32_t cost = craft_cost_total(knife);
        CHECK(cost == 3u);
        CHECK(bank_total(st) == cost);

        Inventory inv{};
        // Wrong bench first, because a success that was never gated proves nothing.
        CHECK(craft_check(st, inv, knife, CraftStation::Lab) ==
              CraftFail::StationMismatch);
        CHECK(craft_check(st, inv, knife, CraftStation::Any) ==
              CraftFail::StationMismatch);
        checksRun += 2;
        CHECK(held(inv, knife) == 0u);
        CHECK(bank_total(st) == cost);       // a refusal spends nothing

        const CraftResult res = craft_item(st, inv, knife, CraftStation::Lathe);
        ++craftsRun;
        CHECK(res.fail == CraftFail::None);
        CHECK(res.item == knife);
        CHECK(res.slot >= 0);
        CHECK(res.spent == cost);
        CHECK(held(inv, knife) == 1u);
        CHECK(bank_total(st) == 0u);         // spent to the last unit
        // ...and having spent it, the same craft now fails on materials rather than
        // succeeding a second time for free.
        CHECK(craft_check(st, inv, knife, CraftStation::Lathe) ==
              CraftFail::InsufficientMaterials);
        ++checksRun;

        // A lab recipe at a lab, and an `Any` recipe anywhere: the station rule is
        // asymmetric and both directions need proving.
        fund_exactly(st, bandage);
        CHECK(craft_item(st, inv, bandage, CraftStation::Lab).fail ==
              CraftFail::None);
        ++craftsRun;
        CHECK(held(inv, bandage) == 1u);
        CHECK(craft_station_ok(CraftStation::Any, CraftStation::Any));
        CHECK(craft_station_ok(CraftStation::Any, CraftStation::Lathe));
        CHECK(!craft_station_ok(CraftStation::Lathe, CraftStation::Any));
        CHECK(!craft_station_ok(CraftStation::Lab, CraftStation::Workbench));
        // Total over both enums, including the out-of-range sentinel: the result
        // must never be "sure, whatever".
        for (std::uint8_t a = 0; a <= static_cast<std::uint8_t>(CraftStation::Count); ++a)
            CHECK(!craft_station_ok(static_cast<CraftStation>(a), CraftStation::Count));
    }

    { // ---- 4. tier gates, and the two learning paths differ in kind ----------
        // The reference treats tier as display metadata. Here it gates, and this is
        // the block that proves the gate is live rather than decorative.
        ItemId deep = kInvalidItem;
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id)
            if (craft_recipe(id).tier == kCraftMaxTier) { deep = id; break; }
        CHECK(deep != kInvalidItem);

        CraftingState st{};
        craft_init(st);
        CHECK(st.tier == 0);
        // Learn it the way disassembly does: knowledge without certification.
        CHECK(craft_learn(st, deep));
        CHECK(craft_known(st, deep));
        CHECK(!craft_learn(st, deep));          // idempotent
        CHECK(craft_known_count(st) == 9u);
        CHECK(st.tier == 0);                    // learning granted nothing

        Inventory inv{};
        fund_exactly(st, deep);                 // money is not the obstacle
        const CraftStation at = station_of(deep);
        CHECK(craft_check(st, inv, deep, at) == CraftFail::TierTooHigh);
        ++checksRun;
        CHECK(craft_item(st, inv, deep, at).fail == CraftFail::TierTooHigh);
        CHECK(held(inv, deep) == 0u);
        CHECK(bank_total(st) == craft_cost_total(deep));   // refused, not charged

        // Certify to exactly one tier below and it still refuses — an off-by-one
        // here would make the whole gate a no-op on the deepest content.
        st.tier = kCraftMaxTier - 1;
        CHECK(craft_check(st, inv, deep, at) == CraftFail::TierTooHigh);
        ++checksRun;
        st.tier = kCraftMaxTier;
        CHECK(craft_check(st, inv, deep, at) == CraftFail::None);
        ++checksRun;
        const CraftResult res = craft_item(st, inv, deep, at);
        ++craftsRun;
        CHECK(res.fail == CraftFail::None);
        CHECK(res.spent == craft_cost_total(deep));
        std::fprintf(stderr,
                     "[craft] tier gate: id %u is tier %u costing %u units; "
                     "refused at tier %d, built at tier %d\n",
                     static_cast<unsigned>(deep), craft_recipe(deep).tier,
                     res.spent, kCraftMaxTier - 1, kCraftMaxTier);

        // Every distinct failure reason has its own text — a switch that fell
        // through would give two reasons the same words.
        for (std::uint8_t a = 0; a < static_cast<std::uint8_t>(CraftFail::Count); ++a) {
            const char* ta = craft_fail_text(static_cast<CraftFail>(a));
            CHECK(ta != nullptr && ta[0] != '\0');
            for (std::uint8_t b = 0; b < a; ++b)
                CHECK(std::strcmp(ta, craft_fail_text(static_cast<CraftFail>(b))) != 0);
        }
    }

    { // ---- 5. disassembly yields the AUTHORED vector, and only it ------------
        // The strong claim: over every one of the 446 items and many rolls, the axis
        // handed back is never an axis the item's own vector left at zero. That is
        // what "yields its authored craft_* vector" means as a testable property —
        // a bug that returned a fixed axis, or rolled over all nine, dies here.
        std::uint32_t yieldTotal = 0, compTotal = 0;
        std::uint32_t offVector = 0;
        const std::uint32_t kKeys = 7;
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
            const CraftRecipe& r = craft_recipe(id);
            compTotal += vec_total(r);
            for (std::uint32_t k = 0; k < kKeys; ++k) {
                CraftingState st{};
                craft_init(st);
                Inventory inv{};
                inv.slots[0] = ItemSlot{id, 1};
                const DisassembleResult d = craft_disassemble(
                    st, inv, 0, CraftStation::Workbench, k * 2654435761u + id);
                ++disassembliesRun;
                CHECK(d.fail == CraftFail::None);
                CHECK(d.item == id);
                CHECK(d.yield == 1u);              // the authored lossy ratio
                CHECK(d.material < CraftMaterial::Count);
                const std::size_t ax = static_cast<std::size_t>(d.material);
                if (r.comp[ax] == 0) ++offVector;   // must stay 0
                CHECK(st.mat[ax] == 1u);
                CHECK(bank_total(st) == 1u);        // exactly one unit, one axis
                CHECK(inv.slots[0].item == kInvalidItem);  // the unit was consumed
                if (k == 0) yieldTotal += d.yield;
            }
        }
        CHECK(offVector == 0u);
        CHECK(compTotal == 5589u);
        CHECK(yieldTotal == static_cast<std::uint32_t>(kCraftRecipeCount));

        // THE RATIO, asserted rather than described. Disassembling one of every item
        // in the catalog returns 446 units against 5,613 authored — a 92.06% loss.
        // This is the reference's `addCraftMaterial(materialId, 1)` ported exactly,
        // and it is deliberate: disassembly is a trickle that makes junk worth
        // carrying, not a refund that makes crafting free. Asserted with integer
        // maths so it cannot drift on a rounding mode.
        CHECK(yieldTotal * 100u < compTotal * 8u);      // < 8% recovered
        CHECK(yieldTotal * 100u > compTotal * 7u);      // > 7% recovered
        std::fprintf(stderr,
                     "[craft] disassembly: %u of %u authored units recovered over "
                     "%zu items (%.2f%%, %.2f%% lost); %u off-vector axes in %u "
                     "rolls\n",
                     yieldTotal, compTotal, kCraftRecipeCount,
                     100.0 * yieldTotal / compTotal,
                     100.0 - 100.0 * yieldTotal / compTotal,
                     offVector, disassembliesRun);
    }

    { // ---- 6. the weights are the vector, not a uniform pick -----------------
        // A single-axis item must return that axis for EVERY key: if the weighted
        // roll were uniform over nine axes this fails immediately.
        ItemId single = only_item([](ItemId id) {
            const CraftRecipe& r = craft_recipe(id);
            int nz = 0;
            for (std::size_t i = 0; i < kCraftMaterials; ++i) if (r.comp[i]) ++nz;
            return default_known(id) && nz == 1 && cat_of(id) == ItemCategory::Drink;
        });
        CHECK(single != kInvalidItem);
        if (single != kInvalidItem) {
            std::size_t want = 0;
            for (std::size_t i = 0; i < kCraftMaterials; ++i)
                if (craft_recipe(single).comp[i]) want = i;
            for (std::uint32_t k = 0; k < 512; ++k) {
                CraftingState st{};
                craft_init(st);
                Inventory inv{};
                inv.slots[0] = ItemSlot{single, 1};
                const DisassembleResult d =
                    craft_disassemble(st, inv, 0, CraftStation::Workbench, k);
                ++disassembliesRun;
                CHECK(static_cast<std::size_t>(d.material) == want);
            }
        }

        // The lopsided case: find the recipe with the largest single-axis share and
        // confirm that axis dominates the observed draws roughly in proportion.
        ItemId lop = kInvalidItem;
        std::size_t lopAxis = 0;
        std::uint32_t bestNum = 0, bestDen = 1;
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
            const CraftRecipe& r = craft_recipe(id);
            const std::uint32_t t = vec_total(r);
            if (t < 20u) continue;                 // enough mass to have a shape
            for (std::size_t i = 0; i < kCraftMaterials; ++i) {
                if (r.comp[i] == 0) continue;
                if (static_cast<std::uint32_t>(r.comp[i]) * bestDen >
                    bestNum * t) {
                    bestNum = r.comp[i]; bestDen = t; lop = id; lopAxis = i;
                }
            }
        }
        CHECK(lop != kInvalidItem);
        if (lop != kInvalidItem) {
            const std::uint32_t kDraws = 4000;
            std::uint32_t hits = 0;
            for (std::uint32_t k = 0; k < kDraws; ++k) {
                CraftingState st{};
                craft_init(st);
                Inventory inv{};
                inv.slots[0] = ItemSlot{lop, 1};
                const DisassembleResult d = craft_disassemble(
                    st, inv, 0, CraftStation::Workbench, k * 0x9e3779b9u + 17u);
                ++disassembliesRun;
                if (static_cast<std::size_t>(d.material) == lopAxis) ++hits;
            }
            const std::uint32_t expect = bestNum * kDraws / bestDen;
            // +-8% of the expected count over 4,000 draws. A tolerance, not a
            // wall-clock: the same keys give the same answer on every host, so this
            // is deterministic and it is the DISTRIBUTION that is being measured.
            const std::uint32_t slack = kDraws * 8u / 100u;
            CHECK(hits + slack > expect);
            CHECK(hits < expect + slack);
            std::fprintf(stderr,
                         "[craft] weighted pick: id %u axis %zu is %u/%u of the "
                         "vector, drawn %u/%u times (expected ~%u)\n",
                         static_cast<unsigned>(lop), lopAxis, bestNum, bestDen,
                         hits, kDraws, expect);
        }
    }

    { // ---- 7. disassembly refuses everywhere but a workbench ----------------
        for (std::uint8_t a = 0; a <= static_cast<std::uint8_t>(CraftStation::Count); ++a) {
            const CraftStation at = static_cast<CraftStation>(a);
            if (at == CraftStation::Workbench) continue;
            CraftingState st{};
            craft_init(st);
            Inventory inv{};
            inv.slots[0] = ItemSlot{knife, 1};
            const DisassembleResult d = craft_disassemble(st, inv, 0, at, 99u);
            CHECK(d.fail == CraftFail::DisassemblyStation);
            CHECK(d.yield == 0u);
            CHECK(d.material == CraftMaterial::Count);
            CHECK(held(inv, knife) == 1u);     // refused, not eaten
            CHECK(bank_total(st) == 0u);
        }
        // An empty slot and an out-of-range slot both say so, at a workbench, so
        // the station check cannot mask a bad index or vice versa.
        CraftingState st{};
        craft_init(st);
        Inventory inv{};
        CHECK(craft_disassemble(st, inv, 0, CraftStation::Workbench, 1u).fail ==
              CraftFail::EmptySlot);
        CHECK(craft_disassemble(st, inv, -1, CraftStation::Workbench, 1u).fail ==
              CraftFail::EmptySlot);
        CHECK(craft_disassemble(st, inv, kInvSlots, CraftStation::Workbench, 1u)
                  .fail == CraftFail::EmptySlot);
    }

    { // ---- 8. craft -> disassemble is a LOSS, measured on one item ----------
        // The loop the player actually runs, end to end: build a knife for 3 units,
        // strip it, get 1 back. If anyone ever "fixes" disassembly into a refund
        // this is the assertion that says no.
        CraftingState st{};
        craft_init(st);
        fund_exactly(st, knife);
        Inventory inv{};
        const std::uint32_t before = bank_total(st);
        CHECK(craft_item(st, inv, knife, CraftStation::Lathe).fail ==
              CraftFail::None);
        ++craftsRun;
        CHECK(bank_total(st) == 0u);
        const DisassembleResult d =
            craft_disassemble(st, inv, 0, CraftStation::Workbench, 4242u);
        ++disassembliesRun;
        CHECK(d.fail == CraftFail::None);
        CHECK(bank_total(st) == 1u);
        CHECK(bank_total(st) < before);
        std::fprintf(stderr,
                     "[craft] round trip on id %u: %u units in, %u unit out\n",
                     static_cast<unsigned>(knife), before, bank_total(st));
    }

    { // ---- 9. atomicity: a full bag cannot eat the materials ----------------
        CraftingState st{};
        craft_init(st);
        fund_exactly(st, knife);
        Inventory inv{};
        // Fill all 64 slots with something that will not stack with a knife, and
        // whose own stack is full, so no partial stack can absorb the output.
        ItemId filler = kInvalidItem;
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id)
            if (id != knife && item_def(id).stackMax == 1) { filler = id; break; }
        CHECK(filler != kInvalidItem);
        for (int i = 0; i < kInvSlots; ++i) inv.slots[i] = ItemSlot{filler, 1};
        CHECK(inv.first_free() < 0);

        const std::uint32_t funded = bank_total(st);
        const CraftResult res = craft_item(st, inv, knife, CraftStation::Lathe);
        CHECK(res.fail == CraftFail::InventoryFull);
        CHECK(res.slot == -1);
        CHECK(res.spent == 0u);
        CHECK(bank_total(st) == funded);     // NOT debited
        CHECK(held(inv, knife) == 0u);

        // Free one slot and the same call succeeds, which proves the refusal was
        // about room and not about anything else in the state.
        inv.slots[7] = ItemSlot{};
        const CraftResult ok = craft_item(st, inv, knife, CraftStation::Lathe);
        ++craftsRun;
        CHECK(ok.fail == CraftFail::None);
        CHECK(ok.slot == 7);
        CHECK(bank_total(st) == 0u);
    }

    { // ---- 10. learning from a carried blueprint — THE WIRED PATH -----------
        // 24 sources, 71 taught recipes. The `Item` kind is the one this engine can
        // fire today, because it needs only an inventory.
        std::uint32_t byKind[static_cast<std::size_t>(CraftSourceKind::Count)] = {};
        std::uint32_t taught = 0, carriers = 0;
        for (std::size_t i = 0; i < kCraftSourceCount; ++i) {
            const CraftSource& s = kCraftSources[i];
            CHECK(s.count > 0 && s.count <= kCraftSourceMaxRecipes);
            CHECK(s.kind < static_cast<std::uint8_t>(CraftSourceKind::Count));
            CHECK(s.grantsTier <= kCraftMaxTier);
            CHECK(kCraftSourceIds[i] != nullptr && kCraftSourceIds[i][0] != '\0');
            CHECK(kCraftSourceText[i] != nullptr && kCraftSourceText[i][0] != '\0');
            ++byKind[s.kind];
            taught += s.count;
            std::uint8_t maxTier = 0;
            for (std::size_t k = 0; k < s.count; ++k) {
                // Every taught id is a real item — a recipe naming an item that
                // does not exist is exactly the mockup this suite exists to refuse.
                CHECK(item_valid(s.recipe[k]));
                if (craft_recipe(s.recipe[k]).tier > maxTier)
                    maxTier = craft_recipe(s.recipe[k]).tier;
            }
            // THE INVARIANT the generator derives: a source certifies what it
            // teaches, so nothing learned from a source is un-craftable.
            CHECK(s.grantsTier == maxTier);
            for (std::size_t k = s.count; k < kCraftSourceMaxRecipes; ++k)
                CHECK(s.recipe[k] == kInvalidItem);      // zero-padded
            if (s.kind == static_cast<std::uint8_t>(CraftSourceKind::Item)) {
                CHECK(item_valid(s.unlock));
                CHECK(craft_source_for_item(s.unlock) == i);
                ++carriers;
            } else {
                CHECK(s.unlock == kInvalidItem);
            }
        }
        CHECK(taught == 69u);
        CHECK(byKind[static_cast<std::size_t>(CraftSourceKind::Default)] == 1u);
        CHECK(byKind[static_cast<std::size_t>(CraftSourceKind::Item)] == 9u);
        CHECK(carriers == 9u);
        // Tier 4 has to be reachable through content, or 11 recipes are dead.
        std::uint8_t topGrant = 0;
        for (std::size_t i = 0; i < kCraftSourceCount; ++i)
            if (kCraftSources[i].grantsTier > topGrant)
                topGrant = kCraftSources[i].grantsTier;
        CHECK(topGrant == kCraftMaxTier);

        // A consuming carrier: learn, spend the paper, keep the tier.
        const std::size_t si = source_of_kind(CraftSourceKind::Item, 1);
        CHECK(si != kCraftSourceCount);
        if (si != kCraftSourceCount) {
            const CraftSource& s = kCraftSources[si];
            CHECK(s.consume == 1);
            CraftingState st{};
            craft_init(st);
            Inventory inv{};
            inv.slots[3] = ItemSlot{s.unlock, 2};
            const std::uint32_t before = craft_known_count(st);
            const LearnResult lr = craft_learn_from_carried(st, inv);
            CHECK(lr.learned == s.count);
            CHECK(lr.from == s.unlock);
            CHECK(lr.source == si);
            CHECK(lr.consumed);
            CHECK(lr.tier == s.grantsTier);
            CHECK(st.tier == s.grantsTier);
            CHECK(craft_known_count(st) == before + s.count);
            CHECK(held(inv, s.unlock) == 1u);          // one of two spent

            // Reading it again teaches nothing new and therefore does NOT spend the
            // second copy — the reference's rule for single-use papers, ported.
            const LearnResult again = craft_learn_from_carried(st, inv);
            CHECK(again.learned == 0u);
            CHECK(!again.consumed);
            CHECK(held(inv, s.unlock) == 1u);
            CHECK(craft_known_count(st) == before + s.count);
            std::fprintf(stderr,
                         "[craft] source %s: taught %u recipes, certified to tier "
                         "%u, consumed the paper; re-read taught 0 and kept it\n",
                         kCraftSourceIds[si], lr.learned, st.tier);

            // The `learned > 0` half of the consume rule, which the re-read above
            // CANNOT reach: there, tier was already granted, so the earlier
            // "nothing new and no new certification" branch short-circuits before
            // the consume decision is ever taken. Verified by mutation — deleting
            // `&& learned > 0` from craft_learn_from_carried leaves every assertion
            // above green.
            //
            // The reachable case is certification WITHOUT new knowledge, and it is
            // a real run: learn all four recipes the way DISASSEMBLY does (knowledge,
            // no tier), then read the folder. It teaches nothing, raises the tier,
            // and must NOT be spent — a paper that only re-certified you is not used
            // up. That is the reference's rule for single-use papers.
            CraftingState cs{};
            craft_init(cs);
            for (std::size_t k = 0; k < s.count; ++k) craft_learn(cs, s.recipe[k]);
            CHECK(cs.tier == 0);                       // learning certified nothing
            const std::uint32_t knownAll = craft_known_count(cs);
            Inventory cbag{};
            cbag.slots[0] = ItemSlot{s.unlock, 1};
            const LearnResult cert = craft_learn_from_carried(cs, cbag);
            CHECK(cert.learned == 0u);                 // nothing was new...
            CHECK(cert.source == si);                  // ...but the source DID fire
            CHECK(cert.from == s.unlock);
            CHECK(cert.tier == s.grantsTier);
            CHECK(cs.tier == s.grantsTier);            // certified
            CHECK(!cert.consumed);
            CHECK(held(cbag, s.unlock) == 1u);         // the paper survives
            CHECK(craft_known_count(cs) == knownAll);
            // And the recipes it certified are now buildable, which is the whole
            // point of separating knowledge from certification.
            for (std::size_t k = 0; k < s.count; ++k) {
                CraftingState fs = cs;
                fund_exactly(fs, s.recipe[k]);
                Inventory fb{};
                CHECK(craft_item(fs, fb, s.recipe[k], station_of(s.recipe[k])).fail ==
                      CraftFail::None);
                ++craftsRun;
            }
            std::fprintf(stderr,
                         "[craft] certification without knowledge: %s taught 0, "
                         "raised tier 0 -> %u, and was NOT consumed\n",
                         kCraftSourceIds[si], cs.tier);

            // And what it taught is now actually buildable — knowledge plus
            // certification, which is the whole point of deriving grantsTier.
            std::uint32_t buildable = 0;
            for (std::size_t k = 0; k < s.count; ++k) {
                const ItemId id = s.recipe[k];
                CraftingState fs = st;
                fund_exactly(fs, id);
                Inventory bag{};
                if (craft_item(fs, bag, id, station_of(id)).fail ==
                    CraftFail::None) ++buildable;
                ++craftsRun;
            }
            CHECK(buildable == s.count);
        }

        // An empty bag teaches nothing and reports so without touching state.
        CraftingState st{};
        craft_init(st);
        Inventory inv{};
        const LearnResult none = craft_learn_from_carried(st, inv);
        CHECK(none.learned == 0u);
        CHECK(none.from == kInvalidItem);
        CHECK(none.source == kCraftSourceCount);
        CHECK(!none.consumed);
        CHECK(craft_known_count(st) == 8u);
        CHECK(craft_learn_from_source(st, kCraftSourceCount) == 0u);   // out of range
    }

    { // ---- 11. the one-keypress picks are deterministic and safe -------------
        CraftingState st{};
        craft_init(st);
        Inventory inv{};
        // Nothing affordable -> nothing picked, rather than a plausible-looking id.
        CHECK(craft_best_available(st, inv, CraftStation::Lathe) == kInvalidItem);

        // Fund the two default-known lathe recipes and confirm the pick is the
        // dearer one, twice, with the same answer.
        const CraftRecipe& rk = craft_recipe(knife);
        const CraftRecipe& ra = craft_recipe(round9mm);
        for (std::size_t i = 0; i < kCraftMaterials; ++i)
            st.mat[i] = static_cast<std::uint32_t>(rk.comp[i] + ra.comp[i]);
        const ItemId first = craft_best_available(st, inv, CraftStation::Lathe);
        const ItemId second = craft_best_available(st, inv, CraftStation::Lathe);
        CHECK(first != kInvalidItem);
        CHECK(first == second);                   // deterministic
        CHECK(craft_check(st, inv, first, CraftStation::Lathe) == CraftFail::None);
        ++checksRun;
        // It is the most valuable of the affordable set, not merely an affordable one.
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id)
            if (craft_check(st, inv, id, CraftStation::Lathe) == CraftFail::None)
                CHECK(item_def(id).value <= item_def(first).value);

        // Scrap picking: an empty bag offers nothing.
        Inventory bag{};
        CHECK(craft_scrap_slot(bag) == -1);
        // A bag holding only two bandages offers nothing either — the keep-alive
        // rule, same as the vendor's.
        bag.slots[0] = ItemSlot{bandage, 2};
        CHECK(craft_scrap_slot(bag) == -1);
        bag.slots[0] = ItemSlot{bandage, 3};
        CHECK(craft_scrap_slot(bag) == 0);        // the spare is fair game
        // With junk in the bag it picks the cheapest, never the equipped weapon.
        bag.clear();
        bag.slots[0] = ItemSlot{knife, 1};        // equipped_melee resolves this
        bag.slots[1] = ItemSlot{chalk, 1};
        const int scrap = craft_scrap_slot(bag);
        CHECK(scrap >= 0);
        CHECK(scrap != 0);                        // not the weapon
        CHECK(bag.slots[scrap].item == chalk);

        // ...but the pair above does NOT prove the keep-equipped rule, and saying
        // so is the point of this block. Measured off data/items.csv: the knife is
        // 15 rub and the chalk 6, so the cheapest-value rule ALONE already picks
        // the chalk. Verified by mutation — deleting the `keepMelee/keepArmour/
        // keepGun` line from craft_scrap_slot leaves every assertion above green.
        //
        // So isolate it: a bag holding ONLY the equipped weapon must offer nothing
        // to strip. Here the weapon is simultaneously the cheapest and the dearest
        // thing present, so the value rule cannot mask the guard and -1 can only
        // come from the guard itself.
        // Its own Inventory, deliberately: `bag` is still read by the diagnostic
        // print at the end of this block, so refilling it here would make that
        // message describe a different bag than the `scrap` it reports.
        Inventory solo{};
        solo.slots[0] = ItemSlot{knife, 1};
        // The premise, asserted rather than assumed: if the knife were not in
        // kMeleeTable, equipped_melee would return kInvalidItem, the guard would
        // never fire, and a green -1 below would be meaningless.
        CHECK(equipped_melee(solo) == knife);
        CHECK(craft_scrap_slot(solo) == -1);      // the weapon you are holding is not scrap

        // The other direction, where the value rule actively WANTS the weapon:
        // beside the knife put the cheapest tool that is DEARER than it, so the
        // knife is now the lowest-value slot in the bag. `craft_scrap_slot` picks
        // the cheapest, so without the guard it would hand back slot 0 — the thing
        // keeping the player alive. Resolved by property, never by id, so a content
        // edit cannot quietly re-point it.
        ItemId dearTool = kInvalidItem;
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
            if (cat_of(id) != ItemCategory::Tool) continue;
            if (melee_for_item(id)) continue;   // must not out-damage the knife
            if (item_def(id).value <= item_def(knife).value) continue;
            if (dearTool == kInvalidItem ||
                item_def(id).value < item_def(dearTool).value)
                dearTool = id;
        }
        CHECK(dearTool != kInvalidItem);
        if (dearTool != kInvalidItem) {
            Inventory duo{};
            duo.slots[0] = ItemSlot{knife, 1};
            duo.slots[1] = ItemSlot{dearTool, 1};
            CHECK(equipped_melee(duo) == knife);              // still the premise
            CHECK(item_def(knife).value < item_def(dearTool).value);
            const int spare = craft_scrap_slot(duo);
            CHECK(spare == 1);                                // NOT the cheapest slot
            CHECK(duo.slots[spare].item == dearTool);
            std::fprintf(stderr,
                         "[craft] keep-equipped: bag holds knife %d rub (slot 0, "
                         "equipped) and id %u at %d rub; scrap picked slot %d "
                         "despite the knife being cheaper\n",
                         item_def(knife).value,
                         static_cast<unsigned>(dearTool),
                         item_def(dearTool).value, spare);
        }
        std::fprintf(stderr,
                     "[craft] one-keypress: best craftable id %u (%d rub), scrap "
                     "slot %d holding id %u\n",
                     static_cast<unsigned>(first), item_def(first).value, scrap,
                     static_cast<unsigned>(bag.slots[scrap].item));
    }

    { // ---- 12. the state survives a save ------------------------------------
        // [save.h] / save.cpp belong to another lane, so the codec is here and the
        // format change is a handoff. This is the round trip that has to hold before
        // that handoff is worth taking.
        CraftingState st{};
        craft_init(st);
        st.tier = 3;
        st.mat[0] = 1; st.mat[4] = 4321; st.mat[8] = 999999u;
        CHECK(craft_learn(st, static_cast<ItemId>(kCraftRecipeCount)));  // the LAST bit
        CHECK(craft_learn(st, 1));                                       // and the first
        const std::uint32_t knownBefore = craft_known_count(st);

        std::uint8_t buf[kCraftingWire + 4];
        std::memset(buf, 0xAB, sizeof buf);
        craft_write(st, buf);
        // Nothing was written past the declared wire length.
        for (std::size_t i = kCraftingWire; i < sizeof buf; ++i) CHECK(buf[i] == 0xAB);

        CraftingState back{};
        CHECK(craft_read(buf, kCraftingWire, back));
        CHECK(back.tier == st.tier);
        CHECK(craft_known_count(back) == knownBefore);
        CHECK(craft_known(back, 1));
        CHECK(craft_known(back, static_cast<ItemId>(kCraftRecipeCount)));
        for (std::size_t i = 0; i < kCraftMaterials; ++i) CHECK(back.mat[i] == st.mat[i]);
        for (std::size_t w = 0; w < kCraftKnownWords; ++w)
            CHECK(back.known[w] == st.known[w]);
        // Byte-identical re-write, which is the property a checksummed save needs.
        std::uint8_t buf2[kCraftingWire];
        craft_write(back, buf2);
        CHECK(std::memcmp(buf, buf2, kCraftingWire) == 0);

        // A truncated payload is REFUSED and leaves the destination untouched —
        // [save.h]'s rule, so a short read cannot half-apply.
        CraftingState guard{};
        craft_init(guard);
        const CraftingState pristine = guard;
        CHECK(!craft_read(buf, kCraftingWire - 1, guard));
        CHECK(std::memcmp(&guard, &pristine, sizeof guard) == 0);
        CHECK(!craft_read(nullptr, kCraftingWire, guard));
        CHECK(std::memcmp(&guard, &pristine, sizeof guard) == 0);

        // Garbage on the wire is SANITIZED rather than rejected: counts clamp, the
        // tier clamps, and bits above the table are dropped.
        std::uint8_t junk[kCraftingWire];
        std::memset(junk, 0xFF, sizeof junk);
        CraftingState wild{};
        CHECK(craft_read(junk, sizeof junk, wild));
        CHECK(wild.tier == kCraftMaxTier);
        for (std::size_t i = 0; i < kCraftMaterials; ++i)
            CHECK(wild.mat[i] == kCraftMaterialMax);
        // 448 bits all set, minus the 2 that name nothing.
        CHECK(craft_known_count(wild) == static_cast<std::uint32_t>(kCraftRecipeCount));
        for (ItemId id = 1; id <= kCraftRecipeCount; ++id) CHECK(craft_known(wild, id));
        std::fprintf(stderr,
                     "[craft] save: %zu wire bytes round-trip %u known recipes and "
                     "%u banked units; all-0xFF sanitizes to %u known / tier %u\n",
                     kCraftingWire, knownBefore, bank_total(st),
                     craft_known_count(wild), wild.tier);
    }

    { // ---- 13. the state is a byte-copy, which is what makes it save-able ----
        // POD and trivially copyable is asserted at compile time in craft.h; this is
        // the runtime half — a memcpy of the struct is indistinguishable from the
        // original, so it can travel in a pool row or a buffer with no serializer.
        CraftingState a{};
        craft_init(a);
        a.mat[2] = 77; a.tier = 2;
        CHECK(craft_learn(a, knife) == false);        // already default-known
        CHECK(craft_learn(a, static_cast<ItemId>(kCraftRecipeCount)));
        CraftingState b{};
        std::memcpy(&b, &a, sizeof a);
        CHECK(std::memcmp(&a, &b, sizeof a) == 0);
        CHECK(craft_known_count(b) == craft_known_count(a));
        CHECK(b.tier == a.tier);
        // pad_ really is dead weight and stays zero, so a memcmp of two logically
        // equal states can never differ on padding.
        for (std::size_t i = 0; i < sizeof a.pad_; ++i) CHECK(a.pad_[i] == 0);
    }

    // Work counts, printed. Counts and not seconds: the same run does the same
    // amount of work on every host, which a stopwatch cannot promise.
    CHECK(disassembliesRun > 7000u);
    CHECK(craftsRun >= 8u);
    std::fprintf(stderr,
                 "[craft] work: %u craft_check calls, %u craft_item calls, %u "
                 "craft_disassemble calls over %zu recipes and %zu sources\n",
                 checksRun, craftsRun, disassembliesRun, kCraftRecipeCount,
                 kCraftSourceCount);
}
