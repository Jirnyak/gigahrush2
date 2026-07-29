// Crafting — the 4,906 authored numbers that had no reader (446 rows x 11 craft
// columns; an earlier draft of this line said 4,914, which is not 446 x 11).
//
// `data/items.csv` carries eleven craft columns on every one of its 446 rows:
// nine material counts, a station and a tier. All 446 x 9 counts are populated
// (measured: 5,613 material units across 446 rows, minimum row total 1, maximum
// 180, **zero** rows summing to 0). Until this file existed the only mention of
// any of it anywhere in `src/` was one comment in [item_table.h] reading
// "craft[9] + station + tier   crafting is not implemented". The content was
// authored and paid for; the system that reads it did not exist.
//
// **The vector means one thing in both directions, and that is the whole design.**
// Verified against the reference's `kraft.md` and `src/data/craft_recipes.ts`
// rather than assumed: `recipeForItem` sets `components = ITEM_COMPOSITIONS[id]`,
// so an item's nine numbers are simultaneously
//
//   * what a recipe SPENDS to build it  (`craftKnownRecipe`), and
//   * what breaking one down YIELDS     (`disassembleInventorySlot`).
//
// One vector, two directions, and that is why there is no separate recipe cost
// table to drift from the composition table.
//
// ---------------------------------------------------------------------------
// Why there is no 446-row craft_recipes.csv
// ---------------------------------------------------------------------------
// Because the recipes are already in `data/items.csv`, and a second copy of them
// would be the exact failure [AGENTS.md] warns about for generated tables, one
// level up: "CSV edited, generator not re-run — invisible to the compiler".
// Re-typing 4,014 integers into a second file makes that failure *authorable*.
//
// Measured before deciding, not asserted after: the reference derives every
// recipe from the item catalog (one recipe per item id, `resultCount == 1`), its
// station from `stationForItem(def, components)` and its tier from
// `tierForComponents(components)`. Replaying `tierForComponents` over items.csv
// reproduces the `craft_tier` column for **446 of 446 rows, zero mismatches**,
// and the `craft_station` distribution matches `stationForItem`'s branches
// (MEDICINE -> lab, 20 of 20; all 9 net_terminal weapons carry cybernetics or
// metamatter). So columns 27..37 are a faithful export of the reference's derived
// recipe set, not an approximation of it — the recipe table IS the item table,
// and `kCraftRecipeCount == kItemCount` by construction with recipe N being item
// N. No id space, no lookup, no drift.
//
// What `data/craft_recipes.csv` therefore holds is the content that is NOT in
// items.csv and cannot be derived from it: **recipe KNOWLEDGE** — the 23 sources
// of `craft_recipe_sources.ts` plus the default-known set, ported row for row.
// Knowing a recipe is not a property of an item; it is a property of a run.
//
// ---------------------------------------------------------------------------
// Tier is a real gate here, and it was not one in the reference
// ---------------------------------------------------------------------------
// Stated plainly because it is a deliberate divergence: in the reference `tier`
// is display metadata, checked by nothing. Here it gates, and the gate is what
// makes the two learning paths differ in kind rather than in flavour:
//
//   * a SOURCE certifies what it teaches. `grantsTier` is derived by the
//     generator as the maximum tier among the source's own recipes, so a folder
//     that teaches `gravity_beam_emitter` (tier 4, 180 units) also raises you to
//     tier 4. A taught recipe is therefore never un-craftable — that invariant
//     is enforced in the generator, not hoped for here.
//   * DISASSEMBLY teaches without certifying. Stripping a rifle can hand you its
//     schematic (the reference's 50% roll, ported) and grants no tier at all, so
//     a reverse-engineered tier-3 recipe sits in your head returning
//     `CraftFail::TierTooHigh` until somebody trains you.
//
// That is where the gate bites, and it is the only place it can: the nine
// default-known recipes are all tier 0 (measured), so a fresh run can build
// everything it starts with.
//
// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
// Flat and allocation-free throughout, per [AGENTS.md] "dense over sparse": the
// material bank is nine `std::uint32_t`, the known-recipe set is a 448-bit
// bitset (7 words) rather than a hash set, and the recipe table is a 5,352-byte
// `std::array` that is permanently cache-resident like the item and mob tables.
// `CraftingState` is 96 bytes, POD and trivially copyable, so it byte-copies into
// a pool row or a save buffer with no serializer walking a container.
//
// No exceptions: every failure is a returned `CraftFail`, which is what the
// reference's `CraftFailureReason` union already was.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "game/inventory.h"
#include "game/item_table.h"

namespace giga::game {

// ---------------------------------------------------------------------------
// The nine axes
// ---------------------------------------------------------------------------
// **The order is an API, a save and a UI contract** — the reference's kraft.md
// says so in as many words, and the columns of items.csv are written in it. Do
// not reorder without bumping the save shape; a swap of two axes is invisible to
// every compiler and silently re-prices 446 items.
inline constexpr std::size_t kCraftMaterials = 9;

enum class CraftMaterial : std::uint8_t {
    Mechanics = 0,   // tools, repair, moving parts        904 units over 195 rows
    Electronics,     // wiring, boards, batteries          372 over  67
    Consumables,     // paper, fabric, tape, packaging     1106 over 316
    Bio,             // tissue, slime, fungi, samples      389 over 113
    Chemical,        // medicine, fuel, reagents           795 over 197
    Metal,           // metal, ammo bodies, weapons        968 over 136
    Cybernetics,     // rare NET / robotics / high energy    85 over   7
    PsiMatter,       // PSI clots, cult / void matter       749 over  32
    MetaMatter,      // endgame anomaly / VOID material     245 over  10
    Count
};
static_assert(static_cast<std::size_t>(CraftMaterial::Count) == kCraftMaterials,
              "the enum and the column count are one fact");

// Where a recipe can be built. `Any` on a RECIPE means "no station needed" and is
// satisfied everywhere; `Any` passed as the station the player is STANDING at
// means "bare hands", which satisfies only `Any` recipes. Asymmetric on purpose —
// `craft_station_ok` is the one place that asymmetry lives.
enum class CraftStation : std::uint8_t {
    Any = 0,      //  22 recipes: trivial survival / document work
    Workbench,    // 237, and the only station disassembly works at
    Lathe,        //  92: mechanical, weapon, ammo, metal, tools
    Lab,          //  77: medical, PSI, samples, reagents
    NetTerminal,  //  18: cybernetics, NET, metamatter
    Count
};

// Tiers run 0..4 (230 / 137 / 51 / 17 / 11 recipes). A fresh run is tier 0.
inline constexpr std::uint8_t kCraftMaxTier = 4;

// ---------------------------------------------------------------------------
// The recipe table — one row per item, generated
// ---------------------------------------------------------------------------
// `kCraftTable[id - 1]` is the recipe for item `id`, exactly as
// `kItemTable[id - 1]` is its definition. Same 1-based indexing, same reason
// ([item_table.h]: slot 0 already means "empty"), so the two tables can never
// disagree about which row is which item.
//
// 12 bytes, no interior padding. Material counts fit a `std::uint8_t` with room
// to spare: the largest single authored axis anywhere in items.csv is 59
// (`granit4u_belt_shotgun`, metal) and the largest row total is 180.
struct CraftRecipe {
    std::uint8_t comp[kCraftMaterials];  //  0..8  cost AND disassembly yield vector
    std::uint8_t station;                //  9     CraftStation
    std::uint8_t tier;                   // 10     0..kCraftMaxTier
    std::uint8_t flags;                  // 11     kCraftKnownByDefault etc.
};
static_assert(sizeof(CraftRecipe) == 12, "CraftRecipe must stay a tight 12-byte row");
static_assert(std::is_trivially_copyable_v<CraftRecipe>);

// `flags` bits.
inline constexpr std::uint8_t kCraftKnownByDefault = 1u << 0;  // in the starting set
inline constexpr std::uint8_t kCraftDiscoverable   = 1u << 1;  // learnable at all

// One recipe per item, and that equality is the anti-drift invariant: adding an
// item row adds its recipe, and there is no second count to forget to update.
inline constexpr std::size_t kCraftRecipeCount = kItemCount;   // 446

// Generated from data/items.csv + data/craft_recipes.csv by
// tools/gen_craft_table.py. Row N is item id N+1.
extern const std::array<CraftRecipe, kCraftRecipeCount> kCraftTable;

inline const CraftRecipe& craft_recipe(ItemId id) {
    return kCraftTable[static_cast<std::size_t>(id) - 1];
}

// Total material units a recipe costs — which is also what one unit of the item
// is worth in raw material, since it is one vector read twice.
std::uint32_t craft_cost_total(ItemId id);

// ---------------------------------------------------------------------------
// Recipe knowledge — where a recipe comes from
// ---------------------------------------------------------------------------
// The reference's six source kinds, ported. Four of them (`Quest`, `Terminal`,
// `Npc`, `Floor`) name integration points this engine does not have yet: there
// is no quest system, no computer terminal and no interactable billboard. They
// ship as DATA with a working `craft_learn_from_source`, so the day one of those
// systems lands it calls one function rather than authoring content.
//
// `Item` is the kind that is live today, because it needs nothing but an
// inventory: `craft_learn_from_carried` finds a blueprint in the bag and reads
// it. That is the wired path — see [main.cpp]'s craft key.
enum class CraftSourceKind : std::uint8_t {
    Default = 0,  // known from the first frame
    Item,         // a blueprint / instruction the player is carrying
    Note,         // note data
    Quest,        // quest completion
    Terminal,     // a generated computer
    Npc,          // an NPC lesson
    Floor,        // a floor interactable
    Count
};

inline constexpr std::size_t kCraftSourceCount = 24;      // 1 default + 23 ported
inline constexpr std::size_t kCraftSourceMaxRecipes = 9;  // the default row is the widest

// One knowledge source. Fixed-width recipe list, zero-padded — `count` says how
// much of it is real, so there is no vector and no allocation.
struct CraftSource {
    ItemId recipe[kCraftSourceMaxRecipes];  //  0..17
    ItemId unlock;             // 18  the item that carries it, or kInvalidItem
    std::uint8_t count;        // 20  live entries in `recipe`
    std::uint8_t kind;         // 21  CraftSourceKind
    std::uint8_t grantsTier;   // 22  max tier among `recipe` — see the header note
    std::uint8_t consume;      // 23  spend the carrier, but only if something was learned
};
static_assert(sizeof(CraftSource) == 24);
static_assert(std::is_trivially_copyable_v<CraftSource>);

extern const std::array<CraftSource, kCraftSourceCount> kCraftSources;
// Stable ids, parallel to kCraftSources. Kept out of the row so it stays POD.
extern const std::array<const char*, kCraftSourceCount> kCraftSourceIds;
// Russian flavour text, same order. This is what makes /utf-8 load-bearing for
// this file's generated sibling as well ([AGENTS.md] §Build).
extern const std::array<const char*, kCraftSourceCount> kCraftSourceText;

// ---------------------------------------------------------------------------
// State — 96 bytes the run carries
// ---------------------------------------------------------------------------
// 446 recipes need 446 bits; 7 x 64 = 448, so the last 2 bits are always 0 and
// `craft_known_count` can popcount the lot without masking.
inline constexpr std::size_t kCraftKnownWords = (kCraftRecipeCount + 63) / 64;  // 7
// The reference's clamp, ported verbatim. Nothing in the game can reach it — the
// whole catalog disassembled one of each yields 5,613 units across nine axes —
// but a clamp that cannot be reached is a clamp that cannot overflow either.
inline constexpr std::uint32_t kCraftMaterialMax = 999999u;

// Field order is chosen so there is no interior padding on either host: the
// 8-byte-aligned bitset first, then the material bank, then the byte fields.
struct CraftingState {
    std::uint64_t known[kCraftKnownWords]{};  //  0..55  one bit per item id
    std::uint32_t mat[kCraftMaterials]{};     // 56..91  the bank, 0..kCraftMaterialMax
    std::uint8_t tier = 0;                    // 92      highest craftable tier
    std::uint8_t pad_[3]{};                   // 93..95
};
static_assert(sizeof(CraftingState) == 96, "CraftingState must stay a 96-byte POD");
static_assert(std::is_trivially_copyable_v<CraftingState>);

// ---------------------------------------------------------------------------
// Why an action failed
// ---------------------------------------------------------------------------
// The reference's `CraftFailureReason` union as an enum, which is what it always
// was. Distinct values matter: "you are at the wrong bench" and "you are not
// certified for this" want different words in front of the player, and a test
// that only asserts `!ok` cannot tell a station refusal from an empty bank.
enum class CraftFail : std::uint8_t {
    None = 0,
    UnknownItem,            // id 0, or past the end of the table
    NotLearned,             // the recipe exists and you do not know it
    NotDiscoverable,        // ...and you never can (nothing sets this today)
    StationMismatch,        // right recipe, wrong bench
    TierTooHigh,            // known but not certified — the disassembly path
    InsufficientMaterials,  // the bank is short on at least one axis
    InventoryFull,          // no slot and no stack with room
    EmptySlot,              // disassembly: nothing in that slot
    DisassemblyStation,     // disassembly: not at a workbench
    NoComposition,          // an all-zero vector; see craft_disassemble
    Count
};
const char* craft_fail_text(CraftFail e);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// A fresh run: empty bank, tier 0, the nine `kCraftKnownByDefault` recipes known.
void craft_init(CraftingState& st);

bool craft_known(const CraftingState& st, ItemId id);
std::uint32_t craft_known_count(const CraftingState& st);

// Does a recipe wanting `want` accept a player standing at `at`? A recipe marked
// `Any` is buildable anywhere including bare-handed; anything else needs its own
// bench. Total over both enums, so garbage in either argument refuses rather
// than indexing something.
bool craft_station_ok(CraftStation want, CraftStation at);

// Can this be built right now? `None` means yes. Checks in the order the player
// would ask: does the recipe exist, do you know it, are you at the right bench,
// are you certified, can you afford it, is there room for the output.
CraftFail craft_check(const CraftingState& st, const Inventory& inv, ItemId id,
                      CraftStation at);

// Per-axis shortfall for a recipe, into `out[kCraftMaterials]`. Zero where the
// bank covers the cost. What a craft menu draws in red.
void craft_missing(const CraftingState& st, ItemId id, std::uint32_t* out);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Build one. Atomic: the bank is debited only once the item is in the bag, so a
// full inventory can never eat the materials. Reports what happened rather than a
// bool, following `vendor_buy` / `apply_damage`.
struct CraftResult {
    CraftFail fail = CraftFail::None;
    ItemId item = kInvalidItem;   // what was built
    int slot = -1;                // where it landed, -1 on failure
    std::uint32_t spent = 0;      // total material units debited
};
CraftResult craft_item(CraftingState& st, Inventory& inv, ItemId id, CraftStation at);

// Break one unit out of `slot` down into material.
//
// **Lossy, by exactly the reference's authored ratio: one unit out, whatever the
// vector said.** `disassembleInventorySlot` grants `addCraftMaterial(materialId,
// 1)` — a single unit of ONE axis, chosen with the composition as the weight
// distribution. So a 180-unit gravity beam emitter yields 1 unit, a 99.44% loss,
// and the catalog average is 1 of 12.6 units (5,613 / 446). That asymmetry is
// the point of the system: disassembly is a trickle that makes junk worth
// carrying, not a refund that makes crafting free. It is asserted as a ratio in
// [suite_craft.inl] so nobody "fixes" it into a refund by accident.
//
// `rollKey` is mixed with `hash2` into the weighted pick and the learn roll —
// stateless hashing per [rng.h], so the same key gives the same outcome and a
// test can enumerate the distribution without a seeded generator to advance.
// Callers pass something that varies: the sim tick works.
struct DisassembleResult {
    CraftFail fail = CraftFail::None;
    ItemId item = kInvalidItem;
    CraftMaterial material = CraftMaterial::Count;  // Count on failure
    std::uint32_t yield = 0;                        // 1 on success — see above
    bool learned = false;                           // the 50% schematic roll hit
};
DisassembleResult craft_disassemble(CraftingState& st, Inventory& inv, int slot,
                                    CraftStation at, std::uint32_t rollKey);

// The reference's 50% chance that stripping something teaches its recipe.
inline constexpr std::uint32_t kCraftLearnPerMille = 500u;

// Learn one recipe. Returns false when it was already known or is not
// discoverable. Grants no tier — see the header note.
bool craft_learn(CraftingState& st, ItemId id);

// Apply source `index`, learning everything in it and raising `tier` to its
// `grantsTier`. Returns how many recipes were NEWLY learned; the tier is raised
// even when all of them were already known, because certification is not
// knowledge.
std::uint32_t craft_learn_from_source(CraftingState& st, std::size_t index);

// The source a given item teaches, or kCraftSourceCount if it teaches nothing.
std::size_t craft_source_for_item(ItemId id);

// **The wired learning path.** Scan `inv` for any item that carries an `Item`
// source, apply it, and consume one unit if the source says so — and only if
// something was actually learned, which is the reference's rule for single-use
// papers (`consume` "spent only after at least one new recipe is learned"). So
// re-reading a folder you have already memorised does not destroy it.
struct LearnResult {
    std::uint32_t learned = 0;         // recipes newly known
    ItemId from = kInvalidItem;        // the carrier that taught them
    std::size_t source = kCraftSourceCount;
    bool consumed = false;
    std::uint8_t tier = 0;             // the tier afterwards
};
LearnResult craft_learn_from_carried(CraftingState& st, Inventory& inv);

// ---------------------------------------------------------------------------
// One-keypress paths
// ---------------------------------------------------------------------------
// The same idiom `vendor_resupply` establishes: "the interesting decision is how
// much to spend, not which of 446 items to click" ([vendor.h]). There is no craft
// menu in this engine and inventing one is a render lane's job, so the wired
// bind picks deterministically and the primitives above stay available for a menu
// that drives per-recipe.

// The most valuable thing craftable right now at `at`, or kInvalidItem. Ties
// break on the lower item id, so two runs of the same state craft the same thing.
ItemId craft_best_available(const CraftingState& st, const Inventory& inv,
                            CraftStation at);

// The cheapest slot worth breaking down: lowest item value, never the equipped
// weapon, gun or armour, never the last unit of a survival consumable. Returns
// -1 when the bag holds nothing safe to strip. Refusing to strip what keeps you
// alive is the same rule `vendor_sell_all` follows and for the same reason.
int craft_scrap_slot(const Inventory& inv);

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
// **This lane does not own [save.h] / save.cpp**, so the codec lives here and the
// format change is a handoff. That is not a workaround: `craftingForSave` in the
// reference serializes only the bank and the known set for the same reason —
// everything else is derivable — and putting the writer next to the struct is
// what keeps the two from drifting.
//
// Little-endian, byte by byte, exactly as [save.h] describes its own fields, so
// no padding byte and no host byte order reaches the file and a save written by
// MSVC loads under Clang. 93 bytes: 7 words + 9 counts + the tier.
//
// `pad_` is deliberately NOT written — it carries nothing — which is why this is
// 93 and not `sizeof(CraftingState)`.
inline constexpr std::size_t kCraftingWire =
    kCraftKnownWords * 8 + kCraftMaterials * 4 + 1;   // 93
static_assert(kCraftingWire == 93);

// Writes exactly kCraftingWire bytes. Cannot fail.
void craft_write(const CraftingState& st, std::uint8_t* out);

// Reads them back. Returns false and leaves `st` untouched when `n` is short, so
// a truncated payload cannot half-apply — [save.h]'s rule, honoured here.
//
// Sanitizes rather than rejecting on content, which is the reference's stance
// (`sanitizeCraftingState`): material counts are clamped to kCraftMaterialMax,
// the tier to kCraftMaxTier, and known-bits above kCraftRecipeCount are dropped.
// A bit set for a row that no longer exists is exactly the items.csv drift
// [save.h] fingerprints the tables against; by the time this runs that check has
// already passed, so dropping the bit is belt-and-braces, not the defence.
bool craft_read(const std::uint8_t* in, std::size_t n, CraftingState& st);

} // namespace giga::game
