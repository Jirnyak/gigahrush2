// Loot-table DATA + the drop roll ([loot_table.h]).
//
// Per-kind rareDrops / lootTable rows ported from the reference ecology
// (`../gigahrush`, src/data/monster_ecology.ts). The reference draws from a
// large item catalog (~444 items); this engine's catalog is a representative
// span ([item_table.h]), so reference item keys with no direct id are mapped to
// the NEAREST existing item by role (documented per-row below) rather than
// dropped — the loot *presence* and rate stay faithful, the exact SKU degrades
// gracefully as the item catalog grows.
#include "game/loot_table.h"

#include "core/rng.h"
#include "game/item_table.h"
#include "game/mob_table.h"

namespace giga::game {

namespace {

// ===========================================================================
// rareDrops — one small static array per kind (first-hit-single order matters;
// earlier = higher priority). Rows are {itemId, chance, count}. Item mapping
// notes call out every non-1:1 substitution.
// ===========================================================================

// Nearest-item substitutions used repeatedly (reference key -> C++ id, by role):
//   duct_tape/filter_layer/fuse/sealant_tube/circuit_board/rock_salt -> ScrapMetal (generic craft/junk)
//   psi_dust -> PsiStim  ·  lamp_bulb -> Flashlight  ·  gasmask_filter -> Gasmask
//   *_sample / mutant_tissue / red_mold / strange_clot -> ScienceSample
//   idol_chernobog / void_spike / shark_scale / bottled_voice / siren_shard /
//     meat_rune / psi_mark / psi_order_seal / psi_concrete_splinter -> Artifact (valuable/legendary)
//   unsigned_order / blank_form / seal_wax / relay_diagram / quarantine_medcard -> Note (document)
//   antibiotic / antifungal_ointment -> Medkit  ·  cloth_roll -> WetRagBundle
//   ammo_energy -> AmmoBuck (nearest ammo; no energy ammo yet)

const RareDrop kR_Sborka[]        = {{ItemScrapMetal, 0.03f, 1}};                                   // duct_tape
const RareDrop kR_Swarm[]         = {{ItemScrapMetal, 0.035f, 1}, {ItemRawMeat, 0.018f, 1}};        // duct_tape, rawmeat
const RareDrop kR_Krysnozhka[]    = {{ItemRawMeat, 0.04f, 1}, {ItemScienceSample, 0.018f, 1}};      // rawmeat, mutant_tissue
const RareDrop kR_DikiyMertvyak[] = {{ItemBandage, 0.035f, 1}, {ItemCigs, 0.02f, 1}};               // bandage, cigs
const RareDrop kR_Gnome[]         = {{ItemRebar, 0.08f, 1}, {ItemWireCoil, 0.05f, 1}};              // rebar, wire_coil
const RareDrop kR_Zombie[]        = {{ItemNote, 0.05f, 1}, {ItemCigs, 0.03f, 1}};                   // note, cigs
const RareDrop kR_FogShark[]      = {{ItemArtifact, 0.035f, 1}, {ItemScrapMetal, 0.04f, 1}};        // shark_scale, filter_layer
const RareDrop kR_GreenDog[]      = {{ItemRawMeat, 0.045f, 1}};                                     // rawmeat
const RareDrop kR_Eye[]           = {{ItemFlashlight, 0.05f, 1}, {ItemPsiStim, 0.02f, 1}};          // lamp_bulb, psi_dust
const RareDrop kR_Spirit[]        = {{ItemPsiStim, 0.05f, 1}, {ItemArtifact, 0.015f, 1}};           // psi_dust, void_spike
const RareDrop kR_Paupsina[]      = {{ItemWireCoil, 0.045f, 1}, {ItemScrapMetal, 0.025f, 1}};       // wire_coil, duct_tape
const RareDrop kR_Paragraph[]     = {{ItemNote, 0.05f, 1}, {ItemArtifact, 0.015f, 1}};              // unsigned_order, psi_order_seal
const RareDrop kR_Lampoglaz[]     = {{ItemFlashlight, 0.07f, 1}, {ItemScrapMetal, 0.035f, 1}};      // lamp_bulb, fuse
const RareDrop kR_Slepoglaz[]     = {{ItemPsiStim, 0.04f, 1}, {ItemScienceSample, 0.02f, 1}};       // psi_dust, strange_clot
const RareDrop kR_Robot[]         = {{ItemAmmoBuck, 0.07f, 1}, {ItemScrapMetal, 0.06f, 1}};         // ammo_energy, circuit_board
const RareDrop kR_Tvar[]          = {{ItemRawMeat, 0.04f, 1}};                                      // rawmeat
const RareDrop kR_HeadSlug[]      = {{ItemMedkit, 0.035f, 1}, {ItemNote, 0.025f, 1}};               // antibiotic, quarantine_medcard
const RareDrop kR_Borshchevik[]   = {{ItemMedkit, 0.045f, 1}, {ItemGasmask, 0.025f, 1}};            // antifungal_ointment, gasmask_filter
const RareDrop kR_BloodPlant[]    = {{ItemScienceSample, 0.08f, 1}, {ItemScrapMetal, 0.06f, 1}};    // red_mold_sample, rock_salt
const RareDrop kR_KantsIdol[]     = {{ItemNote, 0.07f, 1}, {ItemPsiStim, 0.02f, 1}, {ItemNote, 0.04f, 1}}; // blank_form, psi_dust, seal_wax
const RareDrop kR_Idol[]          = {{ItemArtifact, 0.03f, 1}, {ItemArtifact, 0.015f, 1}};          // idol_chernobog, psi_mark
const RareDrop kR_Panelnik[]      = {{ItemScrapMetal, 0.05f, 1}, {ItemRebar, 0.035f, 1}};           // sealant_tube, rebar
const RareDrop kR_Rebar[]         = {{ItemRebar, 0.08f, 1}, {ItemWireCoil, 0.04f, 1}};              // rebar, wire_coil
const RareDrop kR_Polzun[]        = {{ItemScrapMetal, 0.04f, 1}, {ItemScienceSample, 0.014f, 1}};   // filter_layer, mutant_tissue
const RareDrop kR_Safeguard[]     = {{ItemScrapMetal, 0.07f, 1}, {ItemNote, 0.03f, 1}};             // circuit_board, relay_diagram
const RareDrop kR_ZakArmatura[]   = {{ItemRebar, 0.1f, 1}, {ItemMetalSheet, 0.05f, 1}};             // rebar, metal_sheet
const RareDrop kR_Sobrannyy[]     = {{ItemWetRagBundle, 0.05f, 1}, {ItemScrapMetal, 0.025f, 1}};    // cloth_roll, hermo_gasket
const RareDrop kR_Sculpture[]     = {{ItemRebar, 0.1f, 1}, {ItemArtifact, 0.1f, 1}};                // rebar, psi_concrete_splinter
const RareDrop kR_Herald[]        = {{ItemArtifact, 0.06f, 1}, {ItemArtifact, 0.04f, 1}};           // siren_shard, bottled_voice
const RareDrop kR_Mancobus[]      = {{ItemAmmoBuck, 0.08f, 1}, {ItemArtifact, 0.03f, 1}};           // ammo_energy, bottled_voice
const RareDrop kR_Matka[]         = {{ItemArtifact, 0.05f, 1}, {ItemRawMeat, 0.12f, 1}};            // meat_rune, rawmeat
const RareDrop kR_Creator[]       = {{ItemArtifact, 0.12f, 1}};                                     // void_spike
const RareDrop kR_Betonnik[]      = {{ItemRebar, 0.06f, 1}, {ItemArtifact, 0.02f, 1}};              // rebar, psi_concrete_splinter

// ===========================================================================
// lootTable — only three kinds carry one (reference). {itemId, chance, min, max}.
// ===========================================================================
const LootEntry kL_Gnome[]    = {{ItemWireCoil, 0.35f, 1, 2}, {ItemMetalSheet, 0.15f, 1, 1}};
const LootEntry kL_Zombie[]   = {{ItemWetRagBundle, 0.35f, 1, 1}, {ItemRawMeat, 0.15f, 1, 2}};
// Reference `betonoed` (concrete-eater) has no MobKind here; its lootTable is
// mapped onto the nearest concrete monster, MobBetonnik (documented in monsters.md).
const LootEntry kL_Betonnik[] = {{ItemRawMeat, 0.25f, 1, 2}, {ItemMetalSheet, 0.1f, 1, 1}};

// Helpers so the table rows stay readable: SPAN(arr) = (arr, size), NO = (null,0).
#define RARE(arr) (arr), static_cast<std::uint8_t>(sizeof(arr) / sizeof((arr)[0]))
#define LOOT(arr) (arr), static_cast<std::uint8_t>(sizeof(arr) / sizeof((arr)[0]))
#define NO_LOOT nullptr, 0

// One row per MobKind, in enum order (array index IS the kind).
const MobLoot kMobLootTable[] = {
    /* Sborka             */ {RARE(kR_Sborka), NO_LOOT},
    /* Swarm              */ {RARE(kR_Swarm), NO_LOOT},
    /* Krysnozhka         */ {RARE(kR_Krysnozhka), NO_LOOT},
    /* DikiyMertvyak      */ {RARE(kR_DikiyMertvyak), NO_LOOT},
    /* Gnome              */ {RARE(kR_Gnome), LOOT(kL_Gnome)},
    /* Zombie             */ {RARE(kR_Zombie), LOOT(kL_Zombie)},
    /* FogShark           */ {RARE(kR_FogShark), NO_LOOT},
    /* GreenDog           */ {RARE(kR_GreenDog), NO_LOOT},
    /* Eye                */ {RARE(kR_Eye), NO_LOOT},
    /* Spirit             */ {RARE(kR_Spirit), NO_LOOT},
    /* Paupsina           */ {RARE(kR_Paupsina), NO_LOOT},
    /* Paragraph          */ {RARE(kR_Paragraph), NO_LOOT},
    /* Lampoglaz          */ {RARE(kR_Lampoglaz), NO_LOOT},
    /* Slepoglaz          */ {RARE(kR_Slepoglaz), NO_LOOT},
    /* Robot              */ {RARE(kR_Robot), NO_LOOT},
    /* Tvar               */ {RARE(kR_Tvar), NO_LOOT},
    /* HeadSlug           */ {RARE(kR_HeadSlug), NO_LOOT},
    /* Borshchevik        */ {RARE(kR_Borshchevik), NO_LOOT},
    /* BloodPlant         */ {RARE(kR_BloodPlant), NO_LOOT},
    /* KantselyarskiyIdol */ {RARE(kR_KantsIdol), NO_LOOT},
    /* Idol               */ {RARE(kR_Idol), NO_LOOT},
    /* Panelnik           */ {RARE(kR_Panelnik), NO_LOOT},
    /* Rebar              */ {RARE(kR_Rebar), NO_LOOT},
    /* Polzun             */ {RARE(kR_Polzun), NO_LOOT},
    /* Safeguard          */ {RARE(kR_Safeguard), NO_LOOT},
    /* ZakalennayaArmatura*/ {RARE(kR_ZakArmatura), NO_LOOT},
    /* Sobrannyy          */ {RARE(kR_Sobrannyy), NO_LOOT},
    /* Sculpture          */ {RARE(kR_Sculpture), NO_LOOT},
    /* Herald             */ {RARE(kR_Herald), NO_LOOT},
    /* Mancobus           */ {RARE(kR_Mancobus), NO_LOOT},
    /* Matka              */ {RARE(kR_Matka), NO_LOOT},
    /* Creator            */ {RARE(kR_Creator), NO_LOOT},
    /* Betonnik           */ {RARE(kR_Betonnik), LOOT(kL_Betonnik)},
};

#undef RARE
#undef LOOT
#undef NO_LOOT

static_assert(sizeof(kMobLootTable) / sizeof(kMobLootTable[0]) == kMobKindCount,
              "loot table rows must stay in lock-step with the MobKind enum");

const MobLoot kNoLoot = {nullptr, 0, nullptr, 0};

// A stateless-hash-backed draw sequence: each next() is rand01(hash2(seed, i++)),
// so the whole roll is deterministic from `seed` with no stored RNG state — the
// engine's determinism stance ([core/rng.h]). This substitutes the reference's
// stateful xorshift32 with giga's native splitmix mixer; every loot SEMANTIC
// (draw order, first-hit rare, independent loot rolls, count ranges, shuffle +
// cap 3) is ported verbatim.
struct DrawStream {
    std::uint32_t seed;
    std::uint32_t i = 0;
    float next() { return rand01(hash2(seed, i++)); }
};

} // namespace

const MobLoot& mob_loot(std::uint16_t kind) {
    if (kind >= kMobKindCount) return kNoLoot;
    return kMobLootTable[kind];
}

LootResult roll_mob_loot(std::uint16_t kind, std::uint32_t seed, bool killerIsPlayer) {
    LootResult out{};
    out.count = 0;
    const MobLoot& spec = mob_loot(kind);
    DrawStream rng{seed, 0};

    // --- 1) lootTable: independent per-entry rolls (draw <= chance), collect the
    // hits, Fisher-Yates shuffle, keep at most 3. Fires on ANY death. -----------
    LootDrop hits[16];
    int nh = 0;
    const int lootN = spec.lootCount < 16 ? spec.lootCount : 16;
    for (int e = 0; e < lootN; ++e) {
        const LootEntry& le = spec.loot[e];
        if (rng.next() <= le.chance) {
            const int span = static_cast<int>(le.maxCount) - static_cast<int>(le.minCount) + 1;
            const int amount = static_cast<int>(le.minCount) +
                               static_cast<int>(rng.next() * static_cast<float>(span > 0 ? span : 1));
            if (amount > 0 && nh < 16) {
                hits[nh].itemId = le.itemId;
                hits[nh].count = static_cast<std::uint8_t>(amount);
                ++nh;
            }
        }
    }
    // Fisher-Yates (descending) — a random 3-subset survives when >3 entries hit.
    for (int k = nh - 1; k > 0; --k) {
        const int j = static_cast<int>(rng.next() * static_cast<float>(k + 1));
        const LootDrop tmp = hits[k];
        hits[k] = hits[j];
        hits[j] = tmp;
    }
    const int keep = nh < 3 ? nh : 3;
    for (int k = 0; k < keep; ++k) out.drops[out.count++] = hits[k];

    // --- 2) rareDrops: first-hit-single (draw < chance), PLAYER kill only. ------
    if (killerIsPlayer) {
        for (int e = 0; e < spec.rareCount; ++e) {
            const RareDrop& rd = spec.rare[e];
            if (rng.next() < rd.chance) {
                const std::uint8_t c = rd.count < 1 ? 1 : rd.count;
                if (out.count < kMaxLootDrops) {
                    out.drops[out.count].itemId = rd.itemId;
                    out.drops[out.count].count = c;
                    ++out.count;
                }
                break; // first passing entry wins, stop
            }
        }
    }

    return out;
}

} // namespace giga::game
