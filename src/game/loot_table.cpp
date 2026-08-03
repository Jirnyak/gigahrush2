// Per-kind death-drop DATA + the single-drop roll ([loot_table.h]).
//
// All 136 rareDrops rows and all 3 lootTable rows are transcribed from the reference
// ecology (`../gigahrush`, src/data/monster_ecology.ts) with **zero item substitutions**.
// That is worth stating because it is where this port got luckier than expected: every
// one of the 54 distinct item keys the reference's loot names resolves to a real row in
// `data/items.csv`, verified key by key against the live 446-row CSV. An earlier attempt
// against a 36-item hand-written catalog had to map 23 of them onto "the nearest item by
// role" — duct_tape/fuse/circuit_board/rock_salt all collapsing onto one generic junk
// row, nine distinct artifacts collapsing onto one. The generated catalog makes that
// whole apparatus unnecessary: the loot is the authored loot.
//
// Chances and counts are verbatim too. What is NOT verbatim is depth — see
// `band_drop_scale` in the header, without which a floor-0 TRESKOTNIK could hand over a
// 14,000-rouble psi splinter under a 90-rouble band cap.
//
// Hard-coded ids are a real fragility and are guarded rather than hoped about.
// `data/items.csv` is sorted alphabetically by key, so INSERTING a row shifts the 1-based
// id of every row after it, and nothing in the compiler would notice — the table would
// still build and would then drop the wrong items. `loot_table_value_sum` plus the pinned
// `kLootTableValueChecksum` turn that into one failing assertion in
// tests/suite_loottable.inl. Every row comment names the key, so the fix is mechanical.
#include "game/loot_table.h"

#include <cmath>

#include "game/mob_table.h"

namespace giga::game {

namespace {

#include "core/rng.h"
// A stateless draw sequence: draw i is giga::rand01(giga::hash2(seed, i)).
// No RNG state to store — hash2/rand01 live in core/rng.h (single source).
struct DrawStream {
    std::uint32_t seed;
    std::uint32_t i = 0;
    float next() { return giga::rand01(giga::hash2(seed, i++)); }
};

// ===========================================================================
// Item ids. One block, so a CSV row insert has ONE place to be repaired, and every line
// carries the key + face value it was balanced against.
//
// `w=0` marks a row with `spawn_w_milli == 0`: `item_weight_on_floor` returns 0 for it,
// so BOTH weighted rollers in the game skip it — the mob catalog pick (loot.cpp) and the
// container pick (container.cpp). Those ten items have no other spawn path anywhere, and
// this table is the only thing that can produce them.
// ===========================================================================
constexpr ItemId kItAmmoEnergy          =   16;  // ammo_energy             300 rub  w=0
constexpr ItemId kItAntibiotic          =   25;  // antibiotic               70 rub
constexpr ItemId kItAntidep             =   26;  // antidep                  95 rub
constexpr ItemId kItAntifungalOintment  =   28;  // antifungal_ointment      55 rub
constexpr ItemId kItBandage             =   40;  // bandage                  10 rub
constexpr ItemId kItBlankForm           =   46;  // blank_form               10 rub
constexpr ItemId kItBottledVoice        =   60;  // bottled_voice           250 rub
constexpr ItemId kItCigs                =   88;  // cigs                      5 rub
constexpr ItemId kItCircuitBoard        =   89;  // circuit_board            35 rub
constexpr ItemId kItClothRoll           =   94;  // cloth_roll                6 rub
constexpr ItemId kItDuctTape            = 121;  // duct_tape                 8 rub
constexpr ItemId kItFakePass            = 132;  // fake_pass                45 rub
constexpr ItemId kItFibrousCapsuleCut   = 134;  // fibrous_capsule_cut     145 rub  w=0
constexpr ItemId kItFilterLayer         = 137;  // filter_layer             16 rub
constexpr ItemId kItFuse                = 156;  // fuse                     20 rub
constexpr ItemId kItGasmaskFilter       = 159;  // gasmask_filter           70 rub
constexpr ItemId kItHermoGasket         = 183;  // hermo_gasket             60 rub
constexpr ItemId kItIdolChernobog       = 189;  // idol_chernobog          200 rub
constexpr ItemId kItInkBottle           = 192;  // ink_bottle                8 rub
constexpr ItemId kItLampBulb            = 210;  // lamp_bulb                12 rub
constexpr ItemId kItLiquidatorToken     = 221;  // liquidator_token         80 rub
constexpr ItemId kItManometer           = 227;  // manometer                35 rub
constexpr ItemId kItMeatRune            = 230;  // meat_rune               220 rub
constexpr ItemId kItMetalSheet          = 232;  // metal_sheet              22 rub
constexpr ItemId kItMetalWater          = 233;  // metal_water               2 rub
constexpr ItemId kItMutantTissueSample  = 242;  // mutant_tissue_sample    115 rub  w=0
constexpr ItemId kItNeighborComplaint   = 246;  // neighbor_complaint        5 rub
constexpr ItemId kItNote                = 254;  // note                      1 rub
constexpr ItemId kItOfficialPermitSlip  = 256;  // official_permit_slip     48 rub
constexpr ItemId kItPsiConcreteSplinter = 287;  // psi_concrete_splinter 14000 rub
constexpr ItemId kItPsiDust             = 289;  // psi_dust                120 rub
constexpr ItemId kItPsiMark             = 291;  // psi_mark              10000 rub
constexpr ItemId kItPsiOrderSeal        = 293;  // psi_order_seal        24000 rub
constexpr ItemId kItQuarantineMedcard   = 311;  // quarantine_medcard       45 rub  w=0
constexpr ItemId kItRawmeat             = 324;  // rawmeat                   1 rub
constexpr ItemId kItRebar               = 326;  // rebar                    80 rub
constexpr ItemId kItRedMoldSample       = 329;  // red_mold_sample         180 rub  w=0
constexpr ItemId kItRelayDiagram        = 330;  // relay_diagram            30 rub
constexpr ItemId kItRockSalt            = 334;  // rock_salt                 4 rub
constexpr ItemId kItSealWax             = 351;  // seal_wax                 14 rub
constexpr ItemId kItSealantTube         = 352;  // sealant_tube             20 rub
constexpr ItemId kItSharkScale          = 355;  // shark_scale            1000 rub
constexpr ItemId kItSirenShard          = 364;  // siren_shard              90 rub
constexpr ItemId kItSlimeSampleBlack    = 372;  // slime_sample_black      220 rub  w=0
constexpr ItemId kItSlimeSampleBrown    = 374;  // slime_sample_brown       35 rub  w=0
constexpr ItemId kItSlimeSampleGreen    = 377;  // slime_sample_green      120 rub  w=0
constexpr ItemId kItSporePrint          = 390;  // spore_print              12 rub
constexpr ItemId kItStrangeClot         = 397;  // strange_clot            500 rub  w=0
constexpr ItemId kItUnpeopleDetector    = 413;  // unpeople_detector       300 rub
constexpr ItemId kItUnsignedOrder       = 414;  // unsigned_order           22 rub
constexpr ItemId kItVoidSpike           = 421;  // void_spike             1500 rub  w=0
constexpr ItemId kItWetRagBundle        = 432;  // wet_rag_bundle            4 rub
constexpr ItemId kItSpring              = 391;  // spring                    7 rub

// ===========================================================================
// rareDrops — one array per kind. ORDER IS LOAD-BEARING: first-hit-single means the
// earlier entry is strictly favoured, and the reference authors the common material
// first and the payout second on almost every row.
// ===========================================================================
constexpr RareDrop kR_Sborka[] = {{kItDuctTape, 0.03f, 1}};
constexpr RareDrop kR_Tvar[] = {{kItRawmeat, 0.04f, 1}};
constexpr RareDrop kR_Polzun[] = {{kItFilterLayer, 0.04f, 1}, {kItMutantTissueSample, 0.014f, 1}};
constexpr RareDrop kR_Betonnik[] = {{kItRebar, 0.06f, 1}, {kItPsiConcreteSplinter, 0.02f, 1}};
constexpr RareDrop kR_Zombie[] = {{kItNote, 0.05f, 1}, {kItCigs, 0.03f, 1}};
constexpr RareDrop kR_Eye[] = {{kItLampBulb, 0.05f, 1}, {kItPsiDust, 0.02f, 1}};
constexpr RareDrop kR_Nightmare[] = {{kItPsiDust, 0.06f, 1}, {kItAntidep, 0.02f, 1}};
constexpr RareDrop kR_Shadow[] = {{kItStrangeClot, 0.03f, 1}};
constexpr RareDrop kR_Rebar[] = {{kItRebar, 0.08f, 1}, {kItSpring, 0.04f, 1}};
constexpr RareDrop kR_Matka[] = {{kItMeatRune, 0.05f, 1}, {kItRawmeat, 0.12f, 1}};
constexpr RareDrop kR_Idol[] = {{kItIdolChernobog, 0.03f, 1}, {kItPsiMark, 0.015f, 1}};
constexpr RareDrop kR_Mancobus[] = {{kItAmmoEnergy, 0.08f, 1}, {kItBottledVoice, 0.03f, 1}};
constexpr RareDrop kR_Herald[] = {{kItSirenShard, 0.06f, 1}, {kItBottledVoice, 0.04f, 1}};
constexpr RareDrop kR_Creator[] = {{kItVoidSpike, 0.12f, 1}};
constexpr RareDrop kR_Spirit[] = {{kItPsiDust, 0.05f, 1}, {kItVoidSpike, 0.015f, 1}};
constexpr RareDrop kR_Robot[] = {{kItAmmoEnergy, 0.07f, 1}, {kItCircuitBoard, 0.06f, 1}};
constexpr RareDrop kR_Shovnik[] = {{kItHermoGasket, 0.05f, 1}, {kItSealantTube, 0.03f, 1}};
constexpr RareDrop kR_Lampovy[] = {{kItLampBulb, 0.06f, 1}, {kItFuse, 0.04f, 1}};
constexpr RareDrop kR_Pechateed[] = {{kItInkBottle, 0.05f, 1}, {kItBlankForm, 0.04f, 1}};

constexpr RareDrop kR_Paragraph[] = {{kItUnsignedOrder, 0.05f, 1}, {kItPsiOrderSeal, 0.015f, 1}};
constexpr RareDrop kR_Nelyud[] = {{kItFakePass, 0.04f, 1}, {kItUnpeopleDetector, 0.015f, 1}};
constexpr RareDrop kR_Krysnozhka[] = {{kItRawmeat, 0.04f, 1}, {kItMutantTissueSample, 0.018f, 1}};
constexpr RareDrop kR_Kostorez[] = {{kItMetalSheet, 0.08f, 1}, {kItRebar, 0.06f, 1}};
constexpr RareDrop kR_Safeguard[] = {{kItCircuitBoard, 0.07f, 1}, {kItRelayDiagram, 0.03f, 1}};
constexpr RareDrop kR_BlackLiquidator[] = {{kItLiquidatorToken, 0.035f, 1}, {kItGasmaskFilter, 0.045f, 1}};
constexpr RareDrop kR_KhorovayaMatka[] = {{kItMeatRune, 0.06f, 1}, {kItRawmeat, 0.16f, 1}, {kItFibrousCapsuleCut, 0.025f, 1}};
constexpr RareDrop kR_Slimevik[] = {{kItFilterLayer, 0.05f, 1}, {kItSlimeSampleBrown, 0.04f, 1}};
constexpr RareDrop kR_Sobrannyy[] = {{kItClothRoll, 0.05f, 1}, {kItHermoGasket, 0.025f, 1}};
constexpr RareDrop kR_ZhornayaTvar[] = {{kItRawmeat, 0.07f, 1}};
constexpr RareDrop kR_Bezekhiy[] = {{kItSpring, 0.035f, 1}, {kItSealantTube, 0.02f, 1}};
constexpr RareDrop kR_Pseudolift[] = {{kItCircuitBoard, 0.04f, 1}, {kItRelayDiagram, 0.025f, 1}};
constexpr RareDrop kR_Slepoglaz[] = {{kItPsiDust, 0.04f, 1}, {kItStrangeClot, 0.02f, 1}};
constexpr RareDrop kR_Olgoy[] = {{kItRawmeat, 0.12f, 1}, {kItMeatRune, 0.03f, 1}, {kItFibrousCapsuleCut, 0.02f, 1}};
constexpr RareDrop kR_VodyanoyKoshmar[] = {{kItMetalWater, 0.06f, 1}, {kItPsiDust, 0.025f, 1}};
constexpr RareDrop kR_Lampoglaz[] = {{kItLampBulb, 0.07f, 1}, {kItFuse, 0.035f, 1}};
constexpr RareDrop kR_Tumannik[] = {{kItFilterLayer, 0.035f, 1}, {kItPsiDust, 0.015f, 1}};
constexpr RareDrop kR_Chernosliz[] = {{kItSlimeSampleBlack, 0.05f, 1}, {kItPsiDust, 0.015f, 1}};
constexpr RareDrop kR_Rzhavnik[] = {{kItRebar, 0.05f, 1}, {kItSpring, 0.04f, 1}};
constexpr RareDrop kR_Betonoed[] = {{kItRebar, 0.05f, 1}, {kItPsiConcreteSplinter, 0.025f, 1}};
constexpr RareDrop kR_Panelnik[] = {{kItSealantTube, 0.05f, 1}, {kItRebar, 0.035f, 1}};
constexpr RareDrop kR_Paupsina[] = {{kItSpring, 0.045f, 1}, {kItDuctTape, 0.025f, 1}};
constexpr RareDrop kR_Borshchevik[] = {{kItAntifungalOintment, 0.045f, 1}, {kItGasmaskFilter, 0.025f, 1}};
constexpr RareDrop kR_Obzhivalshchik[] = {{kItNeighborComplaint, 0.08f, 1}, {kItSealantTube, 0.035f, 1}};
constexpr RareDrop kR_HeadSlug[] = {{kItAntibiotic, 0.035f, 1}, {kItQuarantineMedcard, 0.025f, 1}};
constexpr RareDrop kR_Protokolnik[] = {{kItUnsignedOrder, 0.06f, 1}, {kItPsiDust, 0.025f, 1}};
constexpr RareDrop kR_DikiyMertvyak[] = {{kItBandage, 0.035f, 1}, {kItCigs, 0.02f, 1}};
constexpr RareDrop kR_Kontorshchik[] = {{kItBlankForm, 0.06f, 1}, {kItOfficialPermitSlip, 0.025f, 1}};
constexpr RareDrop kR_TonkayaTen[] = {{kItStrangeClot, 0.02f, 1}};
constexpr RareDrop kR_KantselyarskiyIdol[] = {{kItBlankForm, 0.07f, 1}, {kItPsiDust, 0.02f, 1}, {kItSealWax, 0.04f, 1}};
constexpr RareDrop kR_LozhnyyDukh[] = {{kItPsiDust, 0.05f, 1}, {kItBlankForm, 0.03f, 1}};
constexpr RareDrop kR_ChervieAvatar[] = {{kItCircuitBoard, 0.08f, 1}, {kItAmmoEnergy, 0.035f, 1}};
constexpr RareDrop kR_PomoynyRoy[] = {{kItRawmeat, 0.03f, 1}, {kItDuctTape, 0.025f, 1}};
constexpr RareDrop kR_Sculpture[] = {{kItRebar, 0.1f, 1}, {kItPsiConcreteSplinter, 0.1f, 1}};
constexpr RareDrop kR_TrubnyyAvtomat[] = {{kItCircuitBoard, 0.08f, 1}, {kItAmmoEnergy, 0.05f, 1}, {kItManometer, 0.04f, 1}};
constexpr RareDrop kR_Lotochnik[] = {{kItFilterLayer, 0.05f, 1}, {kItClothRoll, 0.04f, 1}};
constexpr RareDrop kR_Treskotnik[] = {{kItRebar, 0.04f, 1}, {kItPsiConcreteSplinter, 0.015f, 1}};
constexpr RareDrop kR_ZakalennayaArmatura[] = {{kItRebar, 0.1f, 1}, {kItMetalSheet, 0.05f, 1}};
constexpr RareDrop kR_GlubinnayaTen[] = {{kItStrangeClot, 0.035f, 1}, {kItPsiDust, 0.015f, 1}};
constexpr RareDrop kR_GreenDog[] = {{kItRawmeat, 0.045f, 1}};
constexpr RareDrop kR_SlimeWoman[] = {{kItSlimeSampleGreen, 0.06f, 1}, {kItFilterLayer, 0.04f, 1}};
constexpr RareDrop kR_Gnilushka[] = {{kItSlimeSampleBrown, 0.035f, 1}, {kItNote, 0.04f, 1}};
constexpr RareDrop kR_MukhozhukHost[] = {{kItUnsignedOrder, 0.06f, 1}, {kItQuarantineMedcard, 0.03f, 1}};
constexpr RareDrop kR_FogShark[] = {{kItSharkScale, 0.035f, 1}, {kItFilterLayer, 0.04f, 1}};
constexpr RareDrop kR_BloodPlant[] = {{kItRedMoldSample, 0.08f, 1}, {kItRockSalt, 0.06f, 1}};
constexpr RareDrop kR_Swarm[] = {{kItDuctTape, 0.035f, 1}, {kItRawmeat, 0.018f, 1}};
constexpr RareDrop kR_SporeCarpet[] = {{kItSporePrint, 0.055f, 1}, {kItFilterLayer, 0.035f, 1}, {kItRockSalt, 0.025f, 1}};
constexpr RareDrop kR_Lishennyy[] = {{kItStrangeClot, 0.035f, 1}, {kItPsiDust, 0.02f, 1}};
constexpr RareDrop kR_Gnome[] = {{kItRebar, 0.08f, 1}, {kItSpring, 0.05f, 1}};

// ===========================================================================
// lootTable — the only three kinds the reference authors one for.
// ===========================================================================
constexpr LootEntry kL_Zombie[] = {{kItWetRagBundle, 0.35f, 1, 1}, {kItRawmeat, 0.15f, 1, 2}};
constexpr LootEntry kL_Betonoed[] = {{kItRawmeat, 0.25f, 1, 2}, {kItMetalSheet, 0.1f, 1, 1}};
constexpr LootEntry kL_Gnome[] = {{kItSpring, 0.35f, 1, 2}, {kItMetalSheet, 0.15f, 1, 1}};

// (ptr, count) from an array, so a row cannot state a length its array does not have.
#define SPAN(arr) (arr), static_cast<std::uint8_t>(sizeof(arr) / sizeof((arr)[0]))

// One row per MobKind, in kMobTable order — array index IS the kind.
constexpr MobLoot kMobLootTable[] = {
    /*  0 Sborka               */ {SPAN(kR_Sborka), nullptr, 0},
    /*  1 Tvar                 */ {SPAN(kR_Tvar), nullptr, 0},
    /*  2 Polzun               */ {SPAN(kR_Polzun), nullptr, 0},
    /*  3 Betonnik             */ {SPAN(kR_Betonnik), nullptr, 0},
    /*  4 Zombie               */ {SPAN(kR_Zombie), SPAN(kL_Zombie)},
    /*  5 Eye                  */ {SPAN(kR_Eye), nullptr, 0},
    /*  6 Nightmare            */ {SPAN(kR_Nightmare), nullptr, 0},
    /*  7 Shadow               */ {SPAN(kR_Shadow), nullptr, 0},
    /*  8 Rebar                */ {SPAN(kR_Rebar), nullptr, 0},
    /*  9 Matka                */ {SPAN(kR_Matka), nullptr, 0},
    /* 10 Idol                 */ {SPAN(kR_Idol), nullptr, 0},
    /* 11 Mancobus             */ {SPAN(kR_Mancobus), nullptr, 0},
    /* 12 Herald               */ {SPAN(kR_Herald), nullptr, 0},
    /* 13 Creator              */ {SPAN(kR_Creator), nullptr, 0},
    /* 14 Spirit               */ {SPAN(kR_Spirit), nullptr, 0},
    /* 15 Robot                */ {SPAN(kR_Robot), nullptr, 0},
    /* 16 Shovnik              */ {SPAN(kR_Shovnik), nullptr, 0},
    /* 17 Lampovy              */ {SPAN(kR_Lampovy), nullptr, 0},
    /* 18 Pechateed            */ {SPAN(kR_Pechateed), nullptr, 0},

    /* 20 Paragraph            */ {SPAN(kR_Paragraph), nullptr, 0},
    /* 21 Nelyud               */ {SPAN(kR_Nelyud), nullptr, 0},
    /* 22 Krysnozhka           */ {SPAN(kR_Krysnozhka), nullptr, 0},
    /* 23 Kostorez             */ {SPAN(kR_Kostorez), nullptr, 0},
    /* 24 Safeguard            */ {SPAN(kR_Safeguard), nullptr, 0},
    /* 25 BlackLiquidator      */ {SPAN(kR_BlackLiquidator), nullptr, 0},
    /* 26 KhorovayaMatka       */ {SPAN(kR_KhorovayaMatka), nullptr, 0},
    /* 27 Slimevik             */ {SPAN(kR_Slimevik), nullptr, 0},
    /* 28 Sobrannyy            */ {SPAN(kR_Sobrannyy), nullptr, 0},
    /* 29 ZhornayaTvar         */ {SPAN(kR_ZhornayaTvar), nullptr, 0},
    /* 30 Bezekhiy             */ {SPAN(kR_Bezekhiy), nullptr, 0},
    /* 31 Pseudolift           */ {SPAN(kR_Pseudolift), nullptr, 0},
    /* 32 Slepoglaz            */ {SPAN(kR_Slepoglaz), nullptr, 0},
    /* 33 Olgoy                */ {SPAN(kR_Olgoy), nullptr, 0},
    /* 34 VodyanoyKoshmar      */ {SPAN(kR_VodyanoyKoshmar), nullptr, 0},
    /* 35 Lampoglaz            */ {SPAN(kR_Lampoglaz), nullptr, 0},
    /* 36 Tumannik             */ {SPAN(kR_Tumannik), nullptr, 0},
    /* 37 Chernosliz           */ {SPAN(kR_Chernosliz), nullptr, 0},
    /* 38 Rzhavnik             */ {SPAN(kR_Rzhavnik), nullptr, 0},
    /* 39 Betonoed             */ {SPAN(kR_Betonoed), SPAN(kL_Betonoed)},
    /* 40 Panelnik             */ {SPAN(kR_Panelnik), nullptr, 0},
    /* 41 Paupsina             */ {SPAN(kR_Paupsina), nullptr, 0},
    /* 42 Borshchevik          */ {SPAN(kR_Borshchevik), nullptr, 0},
    /* 43 Obzhivalshchik       */ {SPAN(kR_Obzhivalshchik), nullptr, 0},
    /* 44 HeadSlug             */ {SPAN(kR_HeadSlug), nullptr, 0},
    /* 45 Protokolnik          */ {SPAN(kR_Protokolnik), nullptr, 0},
    /* 46 DikiyMertvyak        */ {SPAN(kR_DikiyMertvyak), nullptr, 0},
    /* 47 Kontorshchik         */ {SPAN(kR_Kontorshchik), nullptr, 0},
    /* 48 TonkayaTen           */ {SPAN(kR_TonkayaTen), nullptr, 0},
    /* 49 KantselyarskiyIdol   */ {SPAN(kR_KantselyarskiyIdol), nullptr, 0},
    /* 50 LozhnyyDukh          */ {SPAN(kR_LozhnyyDukh), nullptr, 0},
    /* 51 ChervieAvatar        */ {SPAN(kR_ChervieAvatar), nullptr, 0},
    /* 52 PomoynyRoy           */ {SPAN(kR_PomoynyRoy), nullptr, 0},
    /* 53 Sculpture            */ {SPAN(kR_Sculpture), nullptr, 0},
    /* 54 TrubnyyAvtomat       */ {SPAN(kR_TrubnyyAvtomat), nullptr, 0},
    /* 55 Lotochnik            */ {SPAN(kR_Lotochnik), nullptr, 0},
    /* 56 Treskotnik           */ {SPAN(kR_Treskotnik), nullptr, 0},
    /* 57 ZakalennayaArmatura  */ {SPAN(kR_ZakalennayaArmatura), nullptr, 0},
    /* 58 GlubinnayaTen        */ {SPAN(kR_GlubinnayaTen), nullptr, 0},
    /* 59 GreenDog             */ {SPAN(kR_GreenDog), nullptr, 0},
    /* 60 SlimeWoman           */ {SPAN(kR_SlimeWoman), nullptr, 0},
    /* 61 Gnilushka            */ {SPAN(kR_Gnilushka), nullptr, 0},
    /* 62 MukhozhukHost        */ {SPAN(kR_MukhozhukHost), nullptr, 0},
    /* 63 FogShark             */ {SPAN(kR_FogShark), nullptr, 0},
    /* 64 BloodPlant           */ {SPAN(kR_BloodPlant), nullptr, 0},
    /* 65 Swarm                */ {SPAN(kR_Swarm), nullptr, 0},
    /* 66 SporeCarpet          */ {SPAN(kR_SporeCarpet), nullptr, 0},
    /* 67 Lishennyy            */ {SPAN(kR_Lishennyy), nullptr, 0},
    /* 68 Gnome                */ {SPAN(kR_Gnome), SPAN(kL_Gnome)},
};

#undef SPAN

static_assert(sizeof(kMobLootTable) / sizeof(kMobLootTable[0]) == kMobKindCount,
              "loot rows must stay in lock-step with the MobKind enum");

// Every kind must carry at least one rare row. This is the property the header's
// provenance note claims (0/69 lack rareDrops), asserted rather than believed — a row
// added with `nullptr, 0` by copy-paste would silently make that kind generic again.
constexpr bool every_kind_has_a_rare_row() {
    for (const MobLoot& r : kMobLootTable)
        if (r.rare == nullptr || r.rareCount == 0) return false;
    return true;
}
static_assert(every_kind_has_a_rare_row(),
              "a kind with no rareDrops row falls back to the generic catalog forever");

constexpr MobLoot kNoLoot = {nullptr, 0, nullptr, 0};

} // namespace

const MobLoot& mob_loot(std::uint8_t kind) {
    if (static_cast<std::size_t>(kind) >= kMobKindCount) return kNoLoot;
    return kMobLootTable[kind];
}

float band_drop_scale(ItemId id, int floorZ) {
    if (!item_valid(id)) return 0.0f;
    const std::int32_t cap = kLootValueCap[economy_band(floorZ)];
    const std::int32_t v = item_def(id).value;
    // A free item is always in band; guarding the divide also guards a cap of 0, which
    // kLootValueCap does not contain today but which a future band could.
    if (v <= cap || cap <= 0) return 1.0f;
    const float over = static_cast<float>(v) / static_cast<float>(cap);
    return std::exp(-(over - 1.0f) * 3.0f);
}

std::int32_t loot_table_value_sum() {
    std::int32_t sum = 0;
    for (const MobLoot& r : kMobLootTable) {
        for (std::uint8_t i = 0; i < r.rareCount; ++i)
            if (item_valid(r.rare[i].itemId)) sum += item_def(r.rare[i].itemId).value;
        for (std::uint8_t i = 0; i < r.lootCount; ++i)
            if (item_valid(r.loot[i].itemId)) sum += item_def(r.loot[i].itemId).value;
    }
    return sum;
}

KindDrop roll_kind_drop(std::uint8_t kind, int floorZ, std::uint32_t seed) {
    const MobLoot& spec = mob_loot(kind);
    DrawStream rng{seed, 0};

    // --- 1) lootTable: independent per entry, first hit taken. ---------------------
    // Draw order matches the reference's roller (lootTable before rareDrops) so the two
    // passes never alias. Every entry is DRAWN even after a hit, so adding a row cannot
    // shift the stream position of the rareDrops pass below — determinism across a data
    // edit is worth two dead draws on 3 of 69 kinds.
    KindDrop out;
    for (std::uint8_t e = 0; e < spec.lootCount; ++e) {
        const LootEntry& le = spec.loot[e];
        const float c = le.chance * band_drop_scale(le.itemId, floorZ);
        const float draw = rng.next();
        const int span =
            static_cast<int>(le.maxCount) - static_cast<int>(le.minCount) + 1;
        const int amount = static_cast<int>(le.minCount) +
                           static_cast<int>(rng.next() *
                                            static_cast<float>(span > 0 ? span : 1));
        if (out.item != kInvalidItem) continue;   // already hit; draws still consumed
        // `c > 0` is not redundant with `<=`, and the asymmetry is the bug it prevents.
        // The reference compares `rand() <= entry.chance` for lootTable and this port
        // keeps that, but `rand01` returns a HALF-OPEN [0,1) that does produce exactly
        // 0.0f — once per 2^24 draws. So a chance the depth gate has crushed to 0.0f
        // would still hit one kill in 16.7 million, and the item it handed over is
        // exactly the one the gate exists to withhold. Cheap guard, unbounded
        // consequence. Purely defensive today: the 6 authored lootTable entries are
        // wet_rag_bundle (4 rub), rawmeat (1), metal_sheet (22) and spring (7), all
        // under the E0 cap of 90, so `c` never reaches 0 at any depth.
        if (c <= 0.0f || draw > c) continue;
        if (amount <= 0) continue;
        out.item = le.itemId;
        out.count = static_cast<std::uint8_t>(amount);
    }
    if (out.item != kInvalidItem) return out;

    // --- 2) rareDrops: first-hit-single. -------------------------------------------
    // Not folded into the loop above: the two passes differ in comparison (`<` vs `<=`),
    // in count model (fixed vs a range) and in whether a miss keeps walking, and a merged
    // loop carrying three flags to express that is how one of them quietly acquires the
    // other's semantics.
    for (std::uint8_t e = 0; e < spec.rareCount; ++e) {
        const RareDrop& rd = spec.rare[e];
        const float c = rd.chance * band_drop_scale(rd.itemId, floorZ);
        // Strict `<` here, so a chance of 0 cannot hit at all and needs no guard.
        if (rng.next() >= c) continue;
        out.item = rd.itemId;
        out.count = rd.count < 1 ? 1 : rd.count;
        break;   // the first passing entry wins
    }
    return out;
}

} // namespace giga::game
