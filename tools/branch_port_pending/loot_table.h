// Monster death-drop loot tables + the drop roll ([items.md], [monsters.md]).
//
// Two independent death-drop mechanisms, ported from the reference
// (`../gigahrush`, src/data/monster_ecology.ts + src/systems/procedural_loot.ts):
//
//   1. rareDrops  — a short list on ~every mob kind, rolled FIRST-HIT-SINGLE
//                   (walk the list, the first entry whose chance passes drops one
//                   item, then stop). Player-kill-gated by the caller.
//   2. lootTable  — a richer list on only a few kinds, rolled INDEPENDENTLY per
//                   entry (each can drop, count in [min,max]), the surviving hits
//                   shuffled and capped at 3 stacks. Fires on any death.
//
// Both key drops by numeric ItemId into the item catalog ([item_table.h]); loot
// is DATA (flat POD rows keyed by MobKind), never a code branch — the same stance
// as the mob catalog ([mob_table.h]) it parallels. The value-gated PROCEDURAL
// pool (NPC/container/merchant loadouts) is a separate reference system and lands
// with NPC/container spawning, not here.
#pragma once

#include <cstdint>

namespace giga::game {

// ---------------------------------------------------------------------------
// One rare-drop entry (reference MonsterRareDrop). First-hit-single semantics:
// entries are tried in order and the first whose `chance` passes drops `count`
// of `itemId`, then the roll stops — so earlier entries are strictly favoured
// and at most one rare item is ever produced.
// ---------------------------------------------------------------------------
struct RareDrop {
    std::uint16_t itemId;  // ItemId into the item catalog
    float chance;          // independent probability in [0,1) (strict <)
    std::uint8_t count;    // fixed count (reference data is always 1)
};

// ---------------------------------------------------------------------------
// One loot-table entry (reference MonsterLootEntry). Rolled independently; on a
// hit it drops a uniform-random count in [minCount, maxCount].
// ---------------------------------------------------------------------------
struct LootEntry {
    std::uint16_t itemId;
    float chance;            // independent probability, hit when draw <= chance
    std::uint8_t minCount;   // inclusive
    std::uint8_t maxCount;   // inclusive
};

// ---------------------------------------------------------------------------
// A mob kind's loot spec — spans into static per-kind arrays (nullptr/0 when a
// kind has no such list). Parallel to the mob catalog: array index IS the kind.
// ---------------------------------------------------------------------------
struct MobLoot {
    const RareDrop* rare;    // rareDrops list (may be null)
    std::uint8_t rareCount;
    const LootEntry* loot;   // lootTable list (null on most kinds)
    std::uint8_t lootCount;
};

// Read a kind's loot spec. Bounds-tolerant: any kind >= kMobKindCount returns an
// empty spec (no drops) — the same defensive lookup as mob_def / item_def.
const MobLoot& mob_loot(std::uint16_t kind);

// ---------------------------------------------------------------------------
// The rolled result — a small fixed-capacity list, no heap. The lootTable
// contributes at most 3 stacks (its cap) and rareDrops at most 1, so 4 is the
// hard ceiling.
// ---------------------------------------------------------------------------
struct LootDrop {
    std::uint16_t itemId;
    std::uint8_t count;
};

inline constexpr int kMaxLootDrops = 4;

struct LootResult {
    LootDrop drops[kMaxLootDrops];
    std::uint8_t count;
};

// Roll a mob kind's death drops deterministically from `seed` (typically mixed
// from sim-time + entity id at the kill site, so a given death always drops the
// same thing). `killerIsPlayer` gates the rareDrops pass exactly as the reference
// does — a non-player kill rolls only the lootTable. Draw order mirrors the
// reference (lootTable first, then rareDrops) so the two passes never alias.
LootResult roll_mob_loot(std::uint16_t kind, std::uint32_t seed, bool killerIsPlayer);

} // namespace giga::game
