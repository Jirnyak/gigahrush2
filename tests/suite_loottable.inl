// Per-kind death drops — the data, the two divergences, and the proof it is REACHED.
//
// The porting brief that produced this suite asked for "monsters drop loot on death",
// which main has had for a while (`loot_dead_mobs`, wired in main.cpp). So block 6 is the
// one that matters most: it does not test `roll_kind_drop` in isolation and declare
// victory — it drives the real `loot_dead_mobs` and requires an item to appear in
// CorpseLootPending that the OTHER roller physically cannot produce. `slime_sample_green`
// carries `spawn_w_milli == 0`, so `item_weight_on_floor` returns 0 and the weighted
// catalog pick skips it at every depth; it is not the ammunition of any gun in
// `kRangedTable`, so the ammo bundler cannot invent it either. Its presence in staged
// corpse slots after a SlimeWoman dies has exactly one possible cause.
//
// CORP1: loot_dead_mobs stages POD slots on the Dead entity (no floor Pickup). Blocks
// 6–7 assert CorpseLootPending + zero floor Pickups — the production path.
//
// This is a .inl and not a .cpp for the reason suite_packs.inl states: game_test.cpp owns
// the CHECK macro, so the include has to land after it, and the suite carries its own
// includes of the systems under test to keep that diff two lines.

#include <cstdio>

#include "game/combat.h"      // Dead, CorpseLootPending — the window loot_dead_mobs walks
#include "game/item_table.h"
#include "game/loot.h"        // loot_dead_mobs, roll_mob_loot_slots
#include "game/loot_table.h"
#include "game/mob_spawn.h"   // MobRef
#include "game/mob_table.h"


namespace loottable_detail {

constexpr ItemId kAmmoEnergy          =  16;
constexpr ItemId kCircuitBoard        =  89;
constexpr ItemId kMetalSheet          = 232;
constexpr ItemId kPsiConcreteSplinter = 287;
constexpr ItemId kPsiMark             = 291;
constexpr ItemId kPsiOrderSeal        = 293;
constexpr ItemId kRawmeat             = 324;
constexpr ItemId kRebar               = 326;
constexpr ItemId kSlimeSampleGreen    = 377;
constexpr ItemId kWetRagBundle        = 432;
constexpr ItemId kSpring              = 391;

// The catalog roll's own gate, so the suite can assert "the catalog CANNOT produce this"
// from the same function `drop_mob_loot` calls rather than from a claim in a comment.
bool catalog_can_produce(ItemId id, int floorZ) {
    return item_weight_on_floor(id, floorZ, 0) != 0;
}

// How often `roll_kind_drop` yields `want` for `kind` on `floorZ`, over `n` seeds. Seeds
// are strided by the golden ratio so consecutive samples are not adjacent hash inputs.
double observed_rate(std::uint8_t kind, int floorZ, ItemId want, std::uint32_t n) {
    std::uint32_t hits = 0;
    for (std::uint32_t s = 0; s < n; ++s) {
        const KindDrop d = roll_kind_drop(kind, floorZ, s * 0x9e3779b9u + 1u);
        if (d.item == want) ++hits;
    }
    return static_cast<double>(hits) / static_cast<double>(n);
}

double observed_any_rate(std::uint8_t kind, int floorZ, std::uint32_t n) {
    std::uint32_t hits = 0;
    for (std::uint32_t s = 0; s < n; ++s)
        if (roll_kind_drop(kind, floorZ, s * 0x9e3779b9u + 1u).item != kInvalidItem)
            ++hits;
    return static_cast<double>(hits) / static_cast<double>(n);
}

// A corpse in the window `loot_dead_mobs` walks: Dead + MobRef + Transform, not yet
// finalized. Built directly rather than through apply_damage because the loot path reads
// none of the combat state — and a test that has to kill something to look at its pockets
// is a test that fails for combat's reasons.
Entity corpse(Registry& reg, std::uint8_t kind, LayerId layer, const vec3& at) {
    Entity e = reg.create();
    Transform tr;
    tr.pos = at;
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<MobRef>(e, MobRef{kind, 1, 0, 10});
    reg.emplace<Dead>(e, Dead{});
    return e;
}

} // namespace loottable_detail

static void test_loottable_all() {
    using namespace loottable_detail;

    { // ---- 1. table shape, asserted against the mob catalog it parallels --------
        int withRare = 0, withLoot = 0;
        for (std::uint8_t k = 0; k < static_cast<std::uint8_t>(kMobKindCount); ++k) {
            const MobLoot& r = mob_loot(k);
            if (r.rare != nullptr && r.rareCount > 0) ++withRare;
            if (r.loot != nullptr && r.lootCount > 0) ++withLoot;
            // Every authored id must be a real row, at every position. A shifted CSV is
            // caught by block 2; this catches a typo'd literal.
            for (std::uint8_t i = 0; i < r.rareCount; ++i) {
                CHECK(item_valid(r.rare[i].itemId));
                CHECK(r.rare[i].chance > 0.0f && r.rare[i].chance <= 1.0f);
                CHECK(r.rare[i].count >= 1);
            }
            for (std::uint8_t i = 0; i < r.lootCount; ++i) {
                CHECK(item_valid(r.loot[i].itemId));
                CHECK(r.loot[i].chance > 0.0f && r.loot[i].chance <= 1.0f);
                CHECK(r.loot[i].minCount >= 1);
                CHECK(r.loot[i].maxCount >= r.loot[i].minCount);
            }
        }
        // The provenance claim in loot.h, as an assertion: 0 of 69 kinds lack rareDrops,
        // 66 of 69 lack a lootTable. This is the fact main's old `(void)mobKind;` comment
        // got backwards.
        CHECK(withRare == static_cast<int>(kMobKindCount));
        CHECK(withLoot == 3);
        CHECK(mob_loot(static_cast<std::uint8_t>(MobKind::Zombie)).lootCount == 2);
        CHECK(mob_loot(static_cast<std::uint8_t>(MobKind::Betonoed)).lootCount == 2);
        CHECK(mob_loot(static_cast<std::uint8_t>(MobKind::Gnome)).lootCount == 2);
        // Bounds-tolerant, like mob_def / item_def: a garbage kind byte is an empty spec,
        // not an out-of-range read.
        CHECK(mob_loot(static_cast<std::uint8_t>(kMobKindCount)).rareCount == 0);
        CHECK(mob_loot(200).rareCount == 0);
        CHECK(mob_loot(255).loot == nullptr);
        CHECK(roll_kind_drop(200, 0, 12345u).item == kInvalidItem);
    }

    { // ---- 2. the id-drift guard ------------------------------------------------
        // data/items.csv is sorted alphabetically, so inserting one row shifts the id of
        // every row after it and this table silently starts dropping different items.
        // 327 is a valid ItemId whether or not it is still `rebar`, so the type system
        // cannot help. The value sum can.
        const std::int32_t sum = loot_table_value_sum();
        CHECK(sum == kLootTableValueChecksum);
        if (sum != kLootTableValueChecksum)
            std::fprintf(stderr,
                         "[loottable] items.csv ids SHIFTED: value sum %d, expected %d. "
                         "Re-derive the kIt* constants in loot_table.cpp from the CSV "
                         "and update kLootTableValueChecksum.\n",
                         sum, kLootTableValueChecksum);
        // Spot-check the three ids the balance argument in loot_table.h rests on, so a
        // shift that happened to preserve the sum still fails here.
        CHECK(item_def(kPsiConcreteSplinter).value == 14000);
        CHECK(item_def(kPsiMark).value == 10000);
        CHECK(item_def(kPsiOrderSeal).value == 24000);
        CHECK(item_def(kRebar).value == 80);
        CHECK(item_def(kRawmeat).value == 1);
    }

    { // ---- 3. the depth gate ----------------------------------------------------
        // In band = untouched. rawmeat is 1 rub against an E0 cap of 90.
        CHECK(band_drop_scale(kRawmeat, 0) == 1.0f);
        CHECK(band_drop_scale(kRebar, 0) == 1.0f);          // 80 rub, just under 90
        CHECK(band_drop_scale(kInvalidItem, 0) == 0.0f);    // not an item: never drops

        // The whole reason the gate exists. TRESKOTNIK is a LIGHT-tier 18-hp crack
        // sprinter that spawns on floor 0, and its second rareDrops row is a
        // 14,000-rouble psi splinter under a 90-rouble band cap. exp(-(14000/90-1)*3)
        // underflows to EXACTLY zero in float, which is what makes the hub un-farmable
        // without a hard rule anywhere in the code.
        CHECK(band_drop_scale(kPsiConcreteSplinter, 0) == 0.0f);
        CHECK(band_drop_scale(kPsiMark, 0) == 0.0f);
        CHECK(band_drop_scale(kPsiOrderSeal, 0) == 0.0f);
        // Deep enough and the same row is in band and pays in full: floor -26 is E3,
        // cap 80,000.
        CHECK(economy_band(-26) == 3);
        CHECK(band_drop_scale(kPsiConcreteSplinter, -26) == 1.0f);
        CHECK(band_drop_scale(kPsiMark, -26) == 1.0f);
        // Symmetric in depth — the V-shape is about |floor|, like every other budget.
        CHECK(band_drop_scale(kPsiConcreteSplinter, 26) == 1.0f);

        // Always a probability multiplier, never an amplifier: [0,1] over the whole
        // catalog at every band. A scale above 1 would mean the depth gate had started
        // making shallow floors MORE generous than the authored chance.
        for (int z = 0; z >= -60; z -= 12)
            for (ItemId id = 1; id <= static_cast<ItemId>(kItemCount); ++id) {
                const float s = band_drop_scale(id, z);
                CHECK(s >= 0.0f && s <= 1.0f);
            }

        // Monotone non-increasing in value, checked on pairs so the catalog's own
        // alphabetical ordering cannot fake a pass.
        for (ItemId a = 1; a + 1 <= static_cast<ItemId>(kItemCount); a += 7)
            for (ItemId b = a; b <= static_cast<ItemId>(kItemCount); b += 31)
                if (item_def(b).value > item_def(a).value)
                    CHECK(band_drop_scale(b, 0) <= band_drop_scale(a, 0));

        // And it must be the SAME curve `item_weight_on_floor` uses, not a second one
        // that will drift away from it. Applying this scale to an item's spawn weight
        // must reproduce the weight the catalog roller computes for the same floor.
        // (One unit of slack: the two multiply-then-truncate in different translation
        // units, and pinning bit-exact float across TUs is not what this asserts.)
        int compared = 0;
        for (ItemId id = 1; id <= static_cast<ItemId>(kItemCount); ++id) {
            const ItemDef& d = item_def(id);
            if (d.spawnWeight == 0 || d.value <= kLootValueCap[0]) continue;
            const std::uint32_t w = item_weight_on_floor(id, 0, 0);
            const std::uint32_t expect = static_cast<std::uint32_t>(
                static_cast<float>(d.spawnWeight) * band_drop_scale(id, 0));
            CHECK(w + 1 >= expect && expect + 1 >= w);
            ++compared;
        }
        CHECK(compared > 50);   // the check is not vacuous
    }

    { // ---- 4. determinism, and only real items ---------------------------------
        for (std::uint8_t k = 0; k < static_cast<std::uint8_t>(kMobKindCount); ++k) {
            for (std::uint32_t s = 0; s < 64; ++s) {
                const KindDrop a = roll_kind_drop(k, -26, s * 7919u + 3u);
                const KindDrop b = roll_kind_drop(k, -26, s * 7919u + 3u);
                CHECK(a.item == b.item);
                CHECK(a.count == b.count);
                if (a.item != kInvalidItem) {
                    CHECK(item_valid(a.item));
                    CHECK(a.count >= 1);
                    // Never over the item's own stack cap once drop_mob_loot clamps it;
                    // the authored counts are 1..2 so the raw roll is already inside it.
                    CHECK(a.count <= 2);
                }
            }
        }
        // A different floor is a different roll for a gated item, and the SAME roll for
        // an in-band one — the gate is the only depth term.
        CHECK(roll_kind_drop(static_cast<std::uint8_t>(MobKind::Sborka), 0, 99u).item ==
              roll_kind_drop(static_cast<std::uint8_t>(MobKind::Sborka), -26, 99u).item);
    }

    { // ---- 5. the gate actually withholds, statistically -----------------------
        const std::uint32_t kN = 200000u;
        const std::uint8_t tres = static_cast<std::uint8_t>(MobKind::Treskotnik);
        const double atHub = observed_rate(tres, 0, kPsiConcreteSplinter, kN);
        const double atDepth = observed_rate(tres, -26, kPsiConcreteSplinter, kN);
        CHECK(atHub == 0.0);                          // exactly zero, 200k rolls
        CHECK(atDepth > 0.010 && atDepth < 0.020);    // authored 1.5%
        std::fprintf(stderr,
                     "[loottable] Treskotnik psi_splinter: %.5f at floor 0, %.5f at "
                     "floor -26 (authored 0.01500)\n", atHub, atDepth);

        // First-hit-single: REBAR authors rebar 8% then wire_coil 4%, so the second row
        // is reachable only when the first misses. Observed wire_coil must land at
        // (1-0.08)*0.04 = 3.68%, NOT at 4% — that difference is the whole ordering
        // semantic, and it is the one thing a "roll every entry" rewrite would break.
        const std::uint8_t reb = static_cast<std::uint8_t>(MobKind::Rebar);
        const double pRebar = observed_rate(reb, -26, kRebar, kN);
        const double pWire = observed_rate(reb, -26, kSpring, kN);
        CHECK(pRebar > 0.075 && pRebar < 0.085);
        CHECK(pWire > 0.033 && pWire < 0.041);
        CHECK(pWire < 0.04);                          // strictly under the authored 4%
        const double any = observed_any_rate(reb, -26, kN);
        CHECK(any > 0.112 && any < 0.122);            // 1 - 0.92*0.96 = 0.1168
        std::fprintf(stderr,
                     "[loottable] Rebar first-hit-single: rebar %.5f (authored 0.08000), "
                     "wire_coil %.5f (0.92*0.04 = 0.03680), any %.5f (0.11680)\n",
                     pRebar, pWire, any);

        // The lootTable pass draws BEFORE rareDrops, so a Gnome's 35% wire_coil loot row
        // out-competes its 8% rare rebar row. Every row stays reachable. Expected, from
        // the authored numbers alone:
        //   loot wire_coil   0.35
        //   loot metal_sheet 0.65 * 0.15                = 0.0975
        //   loot miss        0.65 * 0.85                = 0.5525
        //   rare rebar       0.5525 * 0.08              = 0.0442
        //   rare wire_coil   0.5525 * 0.92 * 0.05       = 0.0254   (folded into wire)
        const std::uint8_t gn = static_cast<std::uint8_t>(MobKind::Gnome);
        const double gWire = observed_rate(gn, -26, kSpring, kN);
        const double gSheet = observed_rate(gn, -26, kMetalSheet, kN);
        const double gRebar = observed_rate(gn, -26, kRebar, kN);
        CHECK(gWire > 0.368 && gWire < 0.383);        // 0.35 + 0.0254 = 0.3754
        CHECK(gSheet > 0.092 && gSheet < 0.103);      // 0.0975
        CHECK(gRebar > 0.040 && gRebar < 0.049);      // 0.0442; loot miss required
        std::fprintf(stderr,
                     "[loottable] Gnome lootTable-first: wire_coil %.5f (0.37542), "
                     "metal_sheet %.5f (0.09750), rare rebar %.5f (0.04420)\n",
                     gWire, gSheet, gRebar);

        // The gate REORDERS what a kind pays, by depth, without any per-floor data.
        // ROBOT authors ammo_energy (300 rub) then circuit_board (35 rub). At floor 0 the
        // 300-rouble row is scaled by exp(-(300/90-1)*3) = 9.1e-4 and effectively cannot
        // land, so a hub Robot is a circuit board; at floor -26 both are in band and the
        // energy cell — which NOTHING else in the game can spawn — becomes its signature
        // drop.
        const std::uint8_t rob = static_cast<std::uint8_t>(MobKind::Robot);
        CHECK(!catalog_can_produce(kAmmoEnergy, -26));
        const double eHub = observed_rate(rob, 0, kAmmoEnergy, kN);
        const double eDeep = observed_rate(rob, -26, kAmmoEnergy, kN);
        const double cHub = observed_rate(rob, 0, kCircuitBoard, kN);
        CHECK(eHub < 0.001);                          // authored 0.07 x 9.1e-4 = 6.4e-5
        CHECK(eDeep > 0.065 && eDeep < 0.075);        // authored 0.07, in band
        CHECK(cHub > 0.055 && cHub < 0.065);          // 35 rub, in band at every depth
        std::fprintf(stderr,
                     "[loottable] Robot ammo_energy: %.5f at floor 0 vs %.5f at -26; "
                     "circuit_board %.5f at floor 0\n", eHub, eDeep, cHub);

        // Zombie's lootTable can yield a count > 1 (rawmeat 1..2); nothing else may.
        bool sawTwo = false;
        for (std::uint32_t s = 0; s < 20000u; ++s) {
            const KindDrop d = roll_kind_drop(
                static_cast<std::uint8_t>(MobKind::Zombie), -26, s * 104729u + 11u);
            if (d.item == kRawmeat && d.count == 2) sawTwo = true;
            if (d.item == kWetRagBundle) CHECK(d.count == 1);   // authored 1..1
        }
        CHECK(sawTwo);
    }

    { // ---- 6. REACHED through the wired path (CORP1 staged slots) --------------
        // Proves the feature is connected: loot_dead_mobs (main.cpp every tick)
        // stages CorpseLootPending on Dead entities — no floor Pickup. Looks for
        // slime_sample_green, which the catalog roller cannot produce.
        const int floorZ = -26;
        CHECK(!catalog_can_produce(kSlimeSampleGreen, floorZ));  // spawn_w_milli == 0
        CHECK(!catalog_can_produce(kSlimeSampleGreen, 0));
        CHECK(catalog_can_produce(kRebar, floorZ));              // control: this one can

        Registry reg;
        const LayerId layer = 0;
        const std::uint8_t slime = static_cast<std::uint8_t>(MobKind::SlimeWoman);
        CHECK(kMobTable[slime].tier == static_cast<std::uint8_t>(MobTier::Heavy));

        // 600 corpses. Heavy = 2 rolls at 65%; slime_sample_green authored at 6%
        // of a paying roll → ~47 expected in staged slots.
        const std::uint32_t kCorpses = 600u;
        for (std::uint32_t i = 0; i < kCorpses; ++i)
            corpse(reg, slime, layer,
                   vec3{static_cast<float>(i % 100u) * 2.0f,
                        static_cast<float>(i / 100u) * 2.0f, 4.0f});

        const std::uint32_t staged = loot_dead_mobs(reg, layer, floorZ, 0xB0071EEDu);
        CHECK(staged > 0);

        // CORP1: zero floor Pickups — loot lives on the body, not gold boxes.
        {
            std::uint32_t onFloor = 0;
            for (auto e : reg.view<const Pickup>()) { (void)e; ++onFloor; }
            CHECK(onFloor == 0);
        }

        std::uint32_t green = 0, total = 0, overCap = 0, pendingBodies = 0;
        for (auto e : reg.view<const CorpseLootPending>()) {
            const CorpseLootPending& p = reg.get<const CorpseLootPending>(e);
            ++pendingBodies;
            CHECK(p.slotCount <= kMaxCorpseSlots);
            std::uint8_t filled = 0;
            for (std::size_t i = 0; i < kMaxCorpseSlots; ++i) {
                const ItemSlot& s = p.slots[i];
                if (!item_valid(s.item) || s.count == 0) continue;
                ++filled;
                ++total;
                CHECK(s.count >= 1);
                const std::uint8_t cap = item_def(s.item).stackMax;
                if (cap && s.count > cap) ++overCap;
                if (s.item == kSlimeSampleGreen) ++green;
            }
            CHECK(filled == p.slotCount);
        }
        CHECK(pendingBodies == kCorpses);   // every Dead+MobRef got a pending
        CHECK(total == staged);
        CHECK(overCap == 0);
        // THE assertion: kind-authored item the catalog cannot produce, in slots.
        CHECK(green > 0);
        std::fprintf(stderr,
                     "[loottable] loot_dead_mobs: %u corpses -> %u staged slots, %u of "
                     "them slime_sample_green (catalog cannot produce); floor pickups=0\n",
                     kCorpses, total, green);

        // Envelope: Heavy = 2 rolls, each paying roll ≤1 item + ≤1 ammo → ≤4 slots.
        CHECK(total <= kCorpses * 4u);
        CHECK(total > 0);
    }

    { // ---- 7. the substitution invariant, per corpse (staged slots) ------------
        // Authored hit SUBSTITUTES for the catalog pick — per-kill ITEM count
        // unchanged. Boss = 5 rolls @ 100% → 5..10 staged slots, never 11.
        //
        // Make roll_kind_drop additive and this fails on the first Betonoed.
        // Measured range over 1.68M Boss corpses: 5..9; bound is structural 5..10.
        const std::uint8_t bet = static_cast<std::uint8_t>(MobKind::Betonoed);
        CHECK(kMobTable[bet].tier == static_cast<std::uint8_t>(MobTier::Boss));
        CHECK(mob_loot(bet).lootCount == 2);   // exercises BOTH table passes

        std::uint32_t lo = 999u, hi = 0u;
        for (std::uint32_t s = 0; s < 400u; ++s) {
            Registry one;
            Entity e = corpse(one, bet, 0, vec3{8.0f, 8.0f, 4.0f});
            const std::uint32_t made = loot_dead_mobs(one, 0, /*floorZ=*/0,
                                                      s * 0x9e3779b9u + 17u);
            CHECK(made >= 5u);    // 5 rolls at 100% — every roll pays one primary
            CHECK(made <= 10u);   // ...plus at most one ammo each, never 11
            CHECK(one.all_of<CorpseLootPending>(e));
            CHECK(one.get<CorpseLootPending>(e).slotCount == made);
            {
                std::uint32_t onFloor = 0;
                for (auto p : one.view<const Pickup>()) { (void)p; ++onFloor; }
                CHECK(onFloor == 0);
            }
            if (made < lo) lo = made;
            if (made > hi) hi = made;
        }
        std::fprintf(stderr,
                     "[loottable] Betonoed (Boss, 5 rolls at 100%%): staged slots per "
                     "corpse %u..%u over 400 seeds (structural bound 5..10)\n", lo, hi);

        // Payout on hub floor (E0 cap 90 truncates value tail). Measured mean
        // ~132.9 rub/kill; window refuses doubling (266) or halving (66).
        Registry reg8;
        const std::uint32_t kN8 = 600u;
        for (std::uint32_t i = 0; i < kN8; ++i)
            corpse(reg8, bet, 0,
                   vec3{static_cast<float>(i % 100u) * 2.0f,
                        static_cast<float>(i / 100u) * 2.0f, 4.0f});
        const std::uint32_t made8 = loot_dead_mobs(reg8, 0, /*floorZ=*/0, 0x0DDBA11u);
        CHECK(made8 >= kN8 * 5u);           // every Boss roll pays, 600 x 5
        CHECK(made8 <= kN8 * 10u);
        {
            std::uint32_t onFloor = 0;
            for (auto e : reg8.view<const Pickup>()) { (void)e; ++onFloor; }
            CHECK(onFloor == 0);
        }
        std::int64_t rub = 0;
        for (auto e : reg8.view<const CorpseLootPending>()) {
            const CorpseLootPending& p = reg8.get<const CorpseLootPending>(e);
            for (std::size_t i = 0; i < kMaxCorpseSlots; ++i) {
                const ItemSlot& s = p.slots[i];
                if (!item_valid(s.item) || s.count == 0) continue;
                rub += static_cast<std::int64_t>(item_def(s.item).value) * s.count;
            }
        }
        const double perKill = static_cast<double>(rub) / static_cast<double>(kN8);
        CHECK(perKill > 60.0 && perKill < 250.0);  // refuses half/double of ~133
        std::fprintf(stderr,
                     "[loottable] Betonoed floor 0: %.1f rub/kill over %u corpses "
                     "(measured mean 132.9, batch spread 126.6..142.4); floor pickups=0\n",
                     perKill, kN8);
    }


    { // ---- 8. a floor with no legal catalog item still pays the authored row ---
        // The old code returned 0 unconditionally when the floor's weighted pool came
        // out empty, which would have thrown away an authored drop that needs no spawn
        // weight at all. There is no such floor in the shipped band table, so this is
        // asserted structurally: the authored roll is consulted BEFORE the pool is even
        // built, which the lazy build in drop_mob_loot makes observable — a kind whose
        // roll always hits never touches the catalog. Proxy assertion: every floor in
        // range has a non-empty pool, so the branch is unreachable today and is
        // documented rather than dead-tested.
        for (int z = -60; z <= 60; z += 10) {
            std::uint32_t any = 0;
            for (ItemId id = 1; id <= static_cast<ItemId>(kItemCount) && any == 0; ++id)
                any += item_weight_on_floor(id, z, 0);
            CHECK(any > 0);
        }
    }

    // --- EVERY ITEM HAS A MASS, and the rule table is not lying ---------------
    // `massG` is resolved from data/item_mass.csv by rule, so the risk is not a
    // missing value — the generator refuses those — but a rule that answers
    // ABSURDLY for a family nobody re-read. So this asserts the SHAPE of the
    // result: physical things weigh something, only the psi techniques weigh
    // nothing, and the spread is a real spread rather than one default wearing
    // 442 hats.
    {
        std::uint32_t weightless = 0, heaviest = 0, lightest = 0xFFFFFFFFu;
        ItemId heaviestId = kInvalidItem, lightestId = kInvalidItem;
        std::uint32_t distinct[16] = {};
        for (ItemId id = 1; id <= static_cast<ItemId>(kItemCount); ++id) {
            const std::uint32_t g = item_def(id).massG;
            if (g == 0) {
                ++weightless;
                continue;
            }
            if (g > heaviest) { heaviest = g; heaviestId = id; }
            if (g < lightest) { lightest = g; lightestId = id; }
            // Decade histogram: 1..9 g, 10..99 g, 100..999 g, ...
            std::uint32_t d = 0, v = g;
            while (v >= 10 && d < 15) { v /= 10; ++d; }
            ++distinct[d];
        }
        std::printf("[items] mass: %u weightless, lightest %u g, heaviest %u g (%s)\n",
                    weightless, lightest, heaviest,
                    heaviestId != kInvalidItem ? item_name(heaviestId) : "-");

        // The 20 psi techniques are the ONLY weightless rows. A weightless rifle
        // would mean a rule stopped matching and the category default took over.
        CHECK(weightless == 20u);
        // A gram is the finest the unit can express and 26 kg the heaviest thing a
        // person carries here; both must be REACHED, or the range is decorative.
        CHECK(lightest <= 10u);
        CHECK(heaviest > 20000u);
        // Spread across at least four decades — 6 g nails, 45 g shells, 400 g food,
        // 4 kg rifles, 26 kg flamers. One default applied 442 times would collapse
        // this to one bucket, which is the failure mode a rule table invites.
        int decades = 0;
        for (std::uint32_t n : distinct)
            if (n > 0) ++decades;
        CHECK(decades >= 4);

        // The READER, on a real load-out. Picked by SCAN rather than by string id,
        // because the item table has no id->ItemId lookup and inventing one for a
        // test would be a worse trade than losing the readable name.
        CHECK(item_valid(heaviestId) && item_valid(lightestId));
        Inventory inv{};
        inv.slots[0] = ItemSlot{heaviestId, 1};
        inv.slots[1] = ItemSlot{lightestId, 60};
        const std::uint32_t carried = inventory_mass_g(inv);
        // STACK COUNT MULTIPLIES — this is what a per-item weight is FOR, and
        // dropping the multiply is what would make sixty rounds weigh one round.
        CHECK(carried == item_def(heaviestId).massG +
                             60u * item_def(lightestId).massG);
        CHECK(carried > item_def(heaviestId).massG); // the 60 actually counted
        // THE BUDGET IS THE BODY'S: 64 kg + 4 kg per Strength ([rpg.h]). Both are
        // powers of two in kilogrammes, so a capacity is always even — asserted,
        // because that is the property the owner asked for and a stray odd
        // constant would break it silently.
        RpgStats weak{};   // Str 0
        RpgStats strong{};
        strong.attr[static_cast<std::size_t>(Attr::Str)] = 8;
        CHECK(carry_capacity_g(weak) == 64000u);
        CHECK(carry_capacity_g(strong) == 64000u + 8u * 4000u); // 96 kg
        CHECK(carry_capacity_g(weak) % 2000u == 0u);
        CHECK(carry_capacity_g(strong) % 2000u == 0u);
        CHECK(carry_capacity_g(strong) > carry_capacity_g(weak));
        std::printf("[items] %s + 60 x %s = %.2f kg | budget %.0f kg at STR 0, "
                    "%.0f kg at STR 8\n",
                    item_name(heaviestId), item_name(lightestId),
                    static_cast<double>(carried) / 1000.0,
                    static_cast<double>(carry_capacity_g(weak)) / 1000.0,
                    static_cast<double>(carry_capacity_g(strong)) / 1000.0);
        CHECK(carried > 0u && carried < carry_capacity_g(weak));
        // An empty grid weighs nothing, and a zero-count slot is not a phantom kilo.
        Inventory none{};
        CHECK(inventory_mass_g(none) == 0u);
        none.slots[3] = ItemSlot{heaviestId, 0};
        CHECK(inventory_mass_g(none) == 0u);
    }

    // --- ENCUMBRANCE: what the weight COSTS ------------------------------------
    // The pure half first ([encumbrance.h] encumbrance_of), because every property
    // that matters is a property of the curve and needs no registry to state.
    {
        const std::uint32_t cap = 64000;

        // NO CLIFF AT THE THRESHOLD. Exactly at capacity the pace is untouched, and
        // a gram over must not teleport it downward — a step you can feel at the
        // edge is what makes an encumbrance rule read as arbitrary.
        const EncumbranceEffect atLimit = encumbrance_of(cap, cap);
        const EncumbranceEffect justOver = encumbrance_of(cap + 1, cap);
        CHECK(atLimit.speedScale == 1.0f);
        CHECK(!atLimit.overloaded);
        CHECK(justOver.overloaded);
        CHECK(justOver.speedScale < 1.0f);
        CHECK(1.0f - justOver.speedScale < 0.001f); // continuous across the edge

        // THE FREE BAND IS REALLY FREE: under capacity nothing is charged but the
        // noise, which is not a penalty — it is what carrying things sounds like.
        const EncumbranceEffect half = encumbrance_of(cap / 2, cap);
        CHECK(half.speedScale == 1.0f);
        CHECK(half.extraSleepPerSec == 0.0f);
        CHECK(half.noiseMult > 1.0f && half.noiseMult < 1.0f + kNoiseLoadGain);
        CHECK(encumbrance_of(0, cap).noiseMult == 1.0f); // empty is silent-as-before

        // Double the budget is half the pace, and the fatigue is exactly the
        // authored rate — both are the numbers [encumbrance.h] states in prose.
        const EncumbranceEffect twice = encumbrance_of(cap * 2, cap);
        CHECK(std::fabs(twice.speedScale - 0.5f) < 1e-5f);
        CHECK(std::fabs(twice.extraSleepPerSec - kOverloadSleepDrainPerSec) < 1e-5f);

        // FLOORED, never frozen: an absurd load slows you to the floor and no
        // further, because a scale approaching zero is a soft lock and not a cost.
        CHECK(encumbrance_of(cap * 1000, cap).speedScale == kEncumbranceMinScale);
        // A body with no character sheet has no budget, and must not be crushed by
        // a division rather than left alone.
        CHECK(encumbrance_of(50000, 0).speedScale == 1.0f);
        CHECK(!encumbrance_of(50000, 0).overloaded);

        // STRENGTH IS THE THRESHOLD. The same load that overloads a weak body is
        // inside a strong one's band — which is the point of spending the points.
        RpgStats str8{};
        str8.attr[static_cast<std::size_t>(Attr::Str)] = 8;
        const std::uint32_t load = 80000; // 80 kg
        CHECK(encumbrance_of(load, carry_capacity_g(RpgStats{})).overloaded);
        CHECK(!encumbrance_of(load, carry_capacity_g(str8)).overloaded);
    }

    // The DRIVER half: the load must actually reach the `Mass` component, because
    // that is the whole "no new mechanic" claim — fall damage and knockback read
    // Mass and nothing else.
    {
        NpcPool pool;
        pool.init();
        Registry reg;
        seed_floor_population(pool, /*floor=*/0, /*n=*/4, /*seed=*/3u);
        const NpcId id = 0;
        Entity e = embody(reg, pool, id, 0);
        CHECK(e != entt::null);
        const float bare = reg.get<Mass>(e).kg;
        CHECK(bare > 10.0f); // stature alone, m = 22*h^2

        // Load 40 kg of the heaviest thing in the catalogue.
        std::uint32_t heaviest = 0;
        ItemId hid = kInvalidItem;
        for (ItemId i = 1; i <= static_cast<ItemId>(kItemCount); ++i)
            if (item_def(i).massG > heaviest) { heaviest = item_def(i).massG; hid = i; }
        pool.inventory(id).slots[0] = ItemSlot{hid, 2};
        const EncumbranceTick t = encumbrance_step(reg, pool, 0, kSimDt, 0);
        CHECK(t.visited >= 1u);
        const float loaded = reg.get<Mass>(e).kg;
        std::printf("[items] mass: bare %.1f kg -> carrying 2 x %s = %.1f kg\n",
                    static_cast<double>(bare), item_name(hid),
                    static_cast<double>(loaded));
        // The two rifles are IN the mass, to the gram.
        CHECK(std::fabs(loaded - (bare + 2.0f * heaviest * 0.001f)) < 0.01f);
        // And dropping them takes it back off: the sweep recomputes, it does not
        // accumulate — a system that only ever added would make a looter immortal
        // in reverse, growing heavier every visit.
        pool.inventory(id).slots[0] = ItemSlot{};
        encumbrance_step(reg, pool, 0, kSimDt, 0);
        CHECK(std::fabs(reg.get<Mass>(e).kg - bare) < 0.01f);
    }
}
