// Per-kind monster death-drop DATA — the identity layer inside [loot.h].
//
// **This is not "monsters now drop loot".** They already do, and have for a while:
// `loot_dead_mobs` (loot.cpp) is wired into the tick at src/app/main.cpp and pays out
// of the global catalog, weighted by `item_weight_on_floor`. The porting brief that
// asked for this file claimed main lacked death drops. It does not. What main lacked is
// the ability to tell one monster from another — `drop_mob_loot` opened with
// `(void)mobKind;` and the comment "per-kind loot tables do not exist in the reference
// (66/69)". A dead Sborka and a dead Creator drew from the same distribution and
// differed only in roll count.
//
// That comment was half right, and the wrong half was load-bearing. The reference
// (`../gigahrush`, src/data/monster_ecology.ts) authors **136 `rareDrops` rows across
// all 69 kinds** — every kind has at least one — and only 3 kinds carry the richer
// `lootTable`. So 66/69 lack a *lootTable*; 0/69 lack rareDrops. The reason main could
// not see them is that the reference never reads them either: `generateMonsterLoot`
// consults `lootTable` only. The 136 rows are authored, shipped and dead upstream. This
// file is their first reader.
//
// ---------------------------------------------------------------------------
// ONE loot path, not two
// ---------------------------------------------------------------------------
// This header deliberately exposes **no spawner and no Dead-set walk**. A second
// function that iterated corpses and emplaced `Pickup` alongside `loot_dead_mobs` would
// be two systems paying out for the same death — the exact duplication this project
// keeps paying for. Instead `drop_mob_loot` calls `roll_kind_drop` *inside* the roll it
// already performs, and the authored item SUBSTITUTES for the catalog pick when it hits.
// Consequences, all of them deliberate:
//
//   * the per-kill item count is byte-for-byte what it was — `rolls_for_tier` x
//     `drop_chance_for_tier` still decides how many things fall, so the tier ramp and
//     the depth ramp survive untouched;
//   * there is exactly one `Pickup` emplacer, one scatter rule, one ammo-bundle call;
//   * a kind with no authored row is not a special case: `roll_kind_drop` returns
//     `kInvalidItem` and the catalog pick runs, which is what main did for every kind.
//
// Measured cost of the substitution, over the real items.csv with the real depth decay.
// **Re-measured 2026-07-29 across all five band-representative floors x six tiers, and
// the number this comment used to carry was too kind.** It claimed "-4% to +4%" from a
// floor-0 and floor--26 sample and so missed the E1/E2 middle, where the cost is worst.
// Catalog-only -> shipped, expected roubles per kill, averaged over the kinds that
// actually carry each tier, 40k seeds per kind:
//
//            floor 0        floor -6         floor -13/-20      floor -26
//   Trash    4.1 -> 3.9     14.8 -> 14.3      57.8 -> 55.4     128.0 -> 123.5
//   Light    8.5 -> 8.2     30.9 -> 28.3     122.0 -> 109.6    275.8 -> 250.7
//   Medium  30.7 -> 29.6   111.4 -> 105.0    441.6 -> 408.2    976.4 -> 913.4
//   Heavy   44.4 -> 44.0   161.4 -> 155.5    639.3 -> 593.2   1412.7 -> 1304.4
//   Elite   87.0 -> 90.8   315.7 -> 300.3   1250.6 -> 1139.1  2778.6 -> 2809.9
//   Boss   170.7 -> 163.6  619.4 -> 588.2   2455.9 -> 2243.6  5435.3 -> 5051.3
//
// So the true range is **-10.2% to +4.4%**, worst at Light on floor -13. The shape is
// worth understanding rather than memorising: a substitution swaps what the FLOOR'S
// CATALOG is worth per roll for what the authored row is worth. Measured over the shipped
// items.csv, the catalog's mean roll is 34.1 rub at floor 0, 122.6 at -6, 484.8 at
// -13/-20 and 1,079.8 at -26 (sum(w x value) / sum(w) over every row the floor leaves a
// non-zero weight, which is exactly the distribution `drop_mob_loot` picks from). That
// makes the LEFT column above auditable without re-running anything: catalog-only is just
// `rolls_for_tier x drop_chance_for_tier x mean roll`, and at floor 0 it reproduces all
// six cells exactly (Boss 5 x 1.00 x 34.13 = 170.7, Trash 1 x 0.12 x 34.13 = 4.1). Below
// the hub it agrees to within 2%, usually a shade low, because there a roll can also
// bundle ammo: NONE of `kRangedTable`'s 29 firearms keeps a non-zero catalog weight at
// floor 0 — the cheapest, karkarov_pistol at 320 rub, decays to 0.13 and truncates to 0 —
// so the hub is the one depth where `drop_weapon_ammo` can add nothing at all, and the
// one depth where this arithmetic is exact. Most authored rows are cheap materials (rebar
// 80, wire_coil 12), so under an E2/E3 cap the swap loses — most on a ONE-roll tier,
// averaging out across a Boss's five.
//
// It is a discount on **28 of the 30 cells above**, -0.9% to -10.2%. It is NOT always a
// discount, and the two exceptions are structural rather than noise: both are Elite, and
// Elite's ten kinds author rebar 80 / psi_dust 120 / circuit_board 35 as their likely
// rows, which at floor 0 sit at or above the 34.1-rub catalog mean the E0 cap of 90
// leaves behind (+4.4%) — while at -26 Sculpture's 14,000-rouble psi splinter, authored
// at a 10% chance, comes into band (+1.1%). Either way the depth ramp is untouched: a
// Boss still pays 31x more at -26 than at 0. 136 rows of per-kind identity for a
// single-digit move in income is the trade being made.
//
// -13 and -20 are identical because `economy_band` puts both in E2 — that is the band
// table, not a copy-paste.
//
// ---------------------------------------------------------------------------
// What the table can produce that nothing else can
// ---------------------------------------------------------------------------
// Ten of the 54 authored items carry `spawn_w_milli == 0`, so `item_weight_on_floor`
// returns 0 for them and **both** weighted rollers in the game skip them — the mob-drop
// catalog pick and the container pick. This table is their only spawn path anywhere:
// ammo_energy (300 rub), fibrous_capsule_cut (145), mutant_tissue_sample (115),
// quarantine_medcard (45), red_mold_sample (180), slime_sample_black (220),
// slime_sample_brown (35), slime_sample_green (120), strange_clot (500),
// void_spike (1500). Nine of the ten are science samples and clots — the loot a
// scientist faction and a research economy would be built on.
//
// That is also why `item_weight_on_floor` cannot simply be reused as the depth gate
// here: it would refuse all ten.
#pragma once

#include <cstdint>

#include "game/item_table.h"   // ItemId, kLootValueCap, economy_band (pulls mob_table.h)

namespace giga::game {

// ---------------------------------------------------------------------------
// One rare-drop entry (reference MonsterRareDrop).
// ---------------------------------------------------------------------------
// First-hit-single semantics: entries are walked in order and the first whose chance
// passes yields the drop. Order is therefore load-bearing, and the reference authors the
// common material first and the payout second on almost every row.
struct RareDrop {
    ItemId itemId;         // 1-based id into kItemTable
    float chance;          // authored probability in [0,1], before the depth gate
    std::uint8_t count;    // fixed count; all 136 authored rows are 1
};

// ---------------------------------------------------------------------------
// One loot-table entry (reference MonsterLootEntry). Independent roll; on a hit it
// yields a uniform count in [minCount, maxCount] inclusive.
// ---------------------------------------------------------------------------
struct LootEntry {
    ItemId itemId;
    float chance;
    std::uint8_t minCount;   // inclusive
    std::uint8_t maxCount;   // inclusive
};

// ---------------------------------------------------------------------------
// A kind's loot spec — spans into static per-kind arrays. Array index IS the kind,
// exactly as kMobTable's is.
// ---------------------------------------------------------------------------
struct MobLoot {
    const RareDrop* rare;    // never null in the shipped table: all 69 kinds have one
    std::uint8_t rareCount;
    const LootEntry* loot;   // null on 66 of 69
    std::uint8_t lootCount;
};

// Read a kind's spec. Bounds-tolerant: any kind >= kMobKindCount answers an empty spec,
// the same defensive lookup shape as mob_def / item_def.
const MobLoot& mob_loot(std::uint8_t kind);

// ---------------------------------------------------------------------------
// The depth gate — one curve, shared with the catalog
// ---------------------------------------------------------------------------
// The reference table is DEPTH-BLIND, and left that way it inverts the greed loop.
// TRESKOTNIK is a LIGHT-tier 18-hp crack-sprinter (`data/mobs.csv`, behaviour
// FractureSprint) whose rareDrops list ends in `psi_concrete_splinter` at 1.5% — worth
// **14,000 roubles** against floor 0's economy band cap of **90**. And it is not
// hypothetical: its `floors_z` column is `14|0|-36`, so it spawns on the hub floor. The
// shallowest, safest floor would be the best farm in the game, off one of its weakest
// monsters.
//
// So an entry's chance is multiplied by the SAME exponential decay
// `item_weight_on_floor` (item_table.cpp) applies to spawn weight past the band cap,
// `exp(-(value/cap - 1) * 3)`. Reusing that curve rather than inventing one is the whole
// point: a shallow floor CAN still cough up something absurd, just rarely, which is the
// documented law in item_table.h and the entire greed loop. A hard cut would replace
// "worth the risk" with "not on this floor".
//
// Measured at floor 0 (cap 90): the splinter's factor is exp(-(14000/90 - 1) * 3) =
// exp(-463.7), which underflows to exactly 0.0f in float — as do psi_mark (10,000) and
// psi_order_seal (24,000). Those three are the WHOLE set that reaches exact zero: the
// factor only underflows above roughly 3,200 rub (exp(-x) rounds to 0.0f for x > 103.97,
// so v/90 > 35.7), and every other authored row keeps a non-zero chance there. The decay
// makes the rest unfarmable rather than impossible — void_spike (1,500) at 3.9e-21,
// shark_scale (1,000) at 6.7e-14, strange_clot (500) at 1.2e-6, ammo_energy (300) at
// 9.1e-4. That last one is not rhetorical: a hub Robot hands over an energy cell once in
// ~16,000 paying rolls, and tests/suite_loottable.inl block 5 measures it (6.4e-5 per
// roll, expected 0.07 x 9.1e-4) instead of asserting it away. The dearest rows with a
// chance worth naming are bottled_voice / slime_sample_black / meat_rune /
// idol_chernobog at 200-250 rub, 1.4e-4 to 7.9e-4 per roll. At floor -26 (cap 80,000)
// every authored row is in band and the factor is 1.0. The deep floor pays and the hub
// does not, without a hard rule anywhere.
//
// There is deliberately **no second per-tier value ceiling.** One was prototyped and
// dropped: main's own catalog path applies no per-tier value cap at all, so capping only
// the authored path would make a deliberate authored row *rarer* than an incidental
// catalog roll of the same item — inverting the intent. The band decay is the gate the
// rest of the engine already uses; one gate, one curve, no disagreement.
float band_drop_scale(ItemId id, int floorZ);

// ---------------------------------------------------------------------------
// The roll
// ---------------------------------------------------------------------------
// One substituted drop, or nothing.
struct KindDrop {
    ItemId item = kInvalidItem;
    std::uint8_t count = 0;
};

// Roll `kind`'s authored drop for ONE of `drop_mob_loot`'s rolls. Deterministic in
// `seed` alone — no stored RNG state — so the same death yields the same item however
// many times it is replayed or reloaded.
//
// Draw order is lootTable then rareDrops, matching the reference's roller so the two
// passes never alias. Two honest divergences from the reference, both forced by
// returning a single item:
//
//   1. the lootTable pass takes the FIRST hit rather than accumulating every independent
//      hit, shuffling, and slicing to 3. A Zombie can still yield both its rows across a
//      kill, because Zombie is Heavy tier = 2 rolls; it just cannot yield both from one
//      roll. The reference's shuffle-and-slice exists to pick fairly among >3 hits, and
//      the widest authored lootTable is 2 entries, so there was never a 3-subset to pick.
//   2. there is no player-kill gate on the rareDrops pass. The reference has no reader
//      for these rows at all, so the gate was never a port — and here it would buy
//      nothing: main's drop VOLUME is already killer-independent, so a monster killing a
//      monster off-screen already scatters catalog loot. Gating identity on the killer
//      would only make monster-killed corpses drop generic items instead of flavourful
//      ones, at the cost of threading `Dead::killer` through the roll.
KindDrop roll_kind_drop(std::uint8_t kind, int floorZ, std::uint32_t seed);

// ---------------------------------------------------------------------------
// Drift guard for the hard-coded item ids
// ---------------------------------------------------------------------------
// The table keys **142 rows** (136 rareDrops + 6 lootTable entries) by numeric ItemId,
// and `data/items.csv` is sorted alphabetically by key — so inserting one row shifts the
// 1-based id of every row after it and this table silently starts dropping different
// items. Nothing in the type system can catch that: 327 is a valid ItemId whether or not
// it is still `rebar`.
//
// So: sum `item_def(id).value` over every authored row and pin it. Re-verified against
// the live `data/items.csv` (446 rows) on 2026-07-29 — all 54 id constants resolve to the
// key named in their comment, at the face value named in their comment, and the sum is
// exactly the number below. Regenerating for a legitimate CSV change means re-deriving
// the ids and updating this constant in the same commit.
std::int32_t loot_table_value_sum();
inline constexpr std::int32_t kLootTableValueChecksum = 104552;

} // namespace giga::game
