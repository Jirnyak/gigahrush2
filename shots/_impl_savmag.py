# SAVMAG: kSaveVersion 7->8 — persist PlayerRanged + melee kills on F5/F9
from pathlib import Path

root = Path(r"C:/hades/gigahrush2")

# ---------------------------------------------------------------------------
# save.h
# ---------------------------------------------------------------------------
p = root / "src/game/save.h"
t = p.read_text(encoding="utf-8")

old = """// Version 7: the character sheet and the crafting bank travel too — RpgStats
// (level/xp/attrs/psi) and CraftingState (known-recipe bits + material bank +
// tier). F5/F9 no longer drop progression. craft_write/craft_read own the craft
// codec ([craft.h]); the RPG fields are written little-endian field by field.
inline constexpr std::uint32_t kSaveVersion = 7u;"""

new = """// Version 7: the character sheet and the crafting bank travel too — RpgStats
// (level/xp/attrs/psi) and CraftingState (known-recipe bits + material bank +
// tier). F5/F9 no longer drop progression. craft_write/craft_read own the craft
// codec ([craft.h]); the RPG fields are written little-endian field by field.
// Version 8: chambered firearm state and the cumulative kill tally travel too —
// PlayerRanged (mag/weapon/shots/hits + transient cooldowns) and melee kills.
// Ammo already debited into the magazine must not vanish on F9; kills already
// survive death-possession and the elevator. [combat.h] SAVMAG
inline constexpr std::uint32_t kSaveVersion = 8u;"""

if old not in t:
    raise SystemExit("save.h version block not found")
t = t.replace(old, new, 1)

# include combat.h for PlayerRanged
old = """#include "game/rpg.h"         // RpgStats
#include "game/craft.h"       // CraftingState, kCraftingWire, craft_write/read"""
new = """#include "game/rpg.h"         // RpgStats
#include "game/craft.h"       // CraftingState, kCraftingWire, craft_write/read
#include "game/combat.h"      // PlayerRanged (SAVMAG v8)"""
if old not in t:
    raise SystemExit("save.h includes not found")
t = t.replace(old, new, 1)

old = """// Version 7: RpgStats wire — field-by-field LE, NOT sizeof (pad_ is written so the
// footprint stays 12 and matches the POD layout without host padding surprises).
inline constexpr std::size_t kRpgWire = 4 + 2 + 1 + 1 + 3 + 1;  // 12
static_assert(kRpgWire == 12);
// kCraftingWire (93) is defined in craft.h next to craft_write/craft_read.
// kQuestLogWire is defined in quest.h.
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
inline constexpr std::size_t kSaveFixedWire =
    kLedgerWire + kBookWire + kPlayerWire + kRpgWire + kCraftingWire + kQuestLogWire;"""

new = """// Version 7: RpgStats wire — field-by-field LE, NOT sizeof (pad_ is written so the
// footprint stays 12 and matches the POD layout without host padding surprises).
inline constexpr std::size_t kRpgWire = 4 + 2 + 1 + 1 + 3 + 1;  // 12
static_assert(kRpgWire == 12);
// kCraftingWire (93) is defined in craft.h next to craft_write/craft_read.
// kQuestLogWire is defined in quest.h.
// Version 8 / SAVMAG: PlayerRanged field-by-field (NOT sizeof — host padding)
// + presence flag + cumulative melee kills. Cooldowns ride so a mid-reload F5
// does not free-fire on F9; hasRanged keeps lazy-attach honest (elevator rule).
inline constexpr std::size_t kRangedWire =
    2 + 2 + 2 + 2 + 4 + 4;  // cd, reload, mag, weapon, shots, hits = 16
static_assert(kRangedWire == 16);
inline constexpr std::size_t kCombatSaveWire =
    1 + kRangedWire + 4;  // hasRanged + ranged + kills = 21
static_assert(kCombatSaveWire == 21);
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
inline constexpr std::size_t kSaveFixedWire =
    kLedgerWire + kBookWire + kPlayerWire + kRpgWire + kCraftingWire +
    kCombatSaveWire + kQuestLogWire;"""

if old not in t:
    raise SystemExit("save.h wire sizes not found")
t = t.replace(old, new, 1)

old = """    // Version 7: crafting bank + known-recipe bits + tier ([craft.h]). Run state
    // beside the ledger in main; craft_write/craft_read own the 93-byte codec.
    CraftingState craft{};
    // Every crate emptied anywhere in the building, not just on the live floor. Only the"""

new = """    // Version 7: crafting bank + known-recipe bits + tier ([craft.h]). Run state
    // beside the ledger in main; craft_write/craft_read own the 93-byte codec.
    CraftingState craft{};
    // Version 8 / SAVMAG: chambered firearm + kill tally. hasRanged mirrors the
    // elevator's lazy-attach rule — do not invent PlayerRanged on a body that
    // never fired. kills is the cumulative melee tally (local `kills` in main).
    std::uint8_t hasRanged = 0;
    PlayerRanged ranged{};
    std::uint32_t kills = 0;
    // Every crate emptied anywhere in the building, not just on the live floor. Only the"""

if old not in t:
    raise SystemExit("save.h SaveState craft block not found")
t = t.replace(old, new, 1)

p.write_text(t, encoding="utf-8")
print("save.h OK")

# ---------------------------------------------------------------------------
# save.cpp
# ---------------------------------------------------------------------------
p = root / "src/game/save.cpp"
t = p.read_text(encoding="utf-8")

old = """#include "game/rpg.h"         // RpgStats (visit_rpg)"""
new = """#include "game/rpg.h"         // RpgStats (visit_rpg)
#include "game/combat.h"      // PlayerRanged (visit_ranged / SAVMAG)"""
if old not in t:
    raise SystemExit("save.cpp includes not found")
t = t.replace(old, new, 1)

old = """// Version 7: RpgStats field-by-field. pad_ is written so the wire is exactly
// kRpgWire (12) and a future non-zero pad cannot silently drop.
template <class Ar, class R>
void visit_rpg(Ar& ar, R& r) {
    ar.u32(r.xp);
    ar.u16(r.psi);
    ar.u8(r.level);
    ar.u8(r.attrPoints);
    ar.u8(r.attr[0]);
    ar.u8(r.attr[1]);
    ar.u8(r.attr[2]);
    ar.u8(r.pad_);
}

template <class Ar, class K>
void visit_key(Ar& ar, K& k) {"""

new = """// Version 7: RpgStats field-by-field. pad_ is written so the wire is exactly
// kRpgWire (12) and a future non-zero pad cannot silently drop.
template <class Ar, class R>
void visit_rpg(Ar& ar, R& r) {
    ar.u32(r.xp);
    ar.u16(r.psi);
    ar.u8(r.level);
    ar.u8(r.attrPoints);
    ar.u8(r.attr[0]);
    ar.u8(r.attr[1]);
    ar.u8(r.attr[2]);
    ar.u8(r.pad_);
}

// Version 8 / SAVMAG: PlayerRanged field-by-field. weapon is ItemId = u16.
template <class Ar, class R>
void visit_ranged(Ar& ar, R& r) {
    ar.u16(r.cooldownMs);
    ar.u16(r.reloadMs);
    ar.u16(r.magCount);
    ar.u16(r.weapon);
    ar.u32(r.shots);
    ar.u32(r.hits);
}

template <class Ar, class K>
void visit_key(Ar& ar, K& k) {"""

if old not in t:
    raise SystemExit("save.cpp visit_rpg not found")
t = t.replace(old, new, 1)

old = """// kSaveFixedWire: ledger+book+player + v7 rpg(12)+craft(93) + quest log.
// Was 724 in v6; +12 +93 = 829 in v7.
static_assert(kRpgWire == 12);
static_assert(kCraftingWire == 93);
static_assert(kSaveFixedWire == 724 + 12 + 93);  // 829
static_assert(kSaveFixedWire == 829);
static_assert(kFactionWire == 36);
// header 64 + fixed 829 + faction 36 = 929 for an empty run.
static_assert(save_bytes_for(0) == 929);
static_assert(save_bytes_for(0, 100, 50) == 929 + 150);"""

new = """// kSaveFixedWire: ledger+book+player + v7 rpg(12)+craft(93) + v8 combat(21)
// + quest log. Was 829 in v7; +21 = 850 in v8.
static_assert(kRpgWire == 12);
static_assert(kCraftingWire == 93);
static_assert(kRangedWire == 16);
static_assert(kCombatSaveWire == 21);
static_assert(kSaveFixedWire == 829 + 21);  // 850
static_assert(kSaveFixedWire == 850);
static_assert(kFactionWire == 36);
// header 64 + fixed 850 + faction 36 = 950 for an empty run.
static_assert(save_bytes_for(0) == 950);
static_assert(save_bytes_for(0, 100, 50) == 950 + 150);"""

if old not in t:
    raise SystemExit("save.cpp static_asserts not found")
t = t.replace(old, new, 1)

old = """    // Version 7: character sheet + crafting bank (fixed-size, in kSaveFixedWire).
    visit_rpg(bw, st.rpg);
    {
        const std::size_t at = body.size();
        body.resize(at + kCraftingWire);
        craft_write(st.craft, body.data() + at);
    }
    for (const OpenedContainerKey& k : st.opened) visit_key(bw, k);"""

new = """    // Version 7: character sheet + crafting bank (fixed-size, in kSaveFixedWire).
    visit_rpg(bw, st.rpg);
    {
        const std::size_t at = body.size();
        body.resize(at + kCraftingWire);
        craft_write(st.craft, body.data() + at);
    }
    // Version 8 / SAVMAG: firearm chamber + kill tally.
    bw.u8(st.hasRanged);
    visit_ranged(bw, st.ranged);
    bw.u32(st.kills);
    for (const OpenedContainerKey& k : st.opened) visit_key(bw, k);"""

if old not in t:
    raise SystemExit("save.cpp write block not found")
t = t.replace(old, new, 1)

old = """    // Version 7: character sheet + crafting bank.
    visit_rpg(r, tmp.rpg);
    {
        const std::size_t pos = r.at();
        if (static_cast<std::size_t>(h.payloadBytes) < pos + kCraftingWire)
            return fail(SaveError::TooShort);
        if (!craft_read(bytes + kSaveHeaderWire + pos, kCraftingWire, tmp.craft))
            return fail(SaveError::TooShort);
        r.skip(kCraftingWire);
    }
    tmp.opened.resize(static_cast<std::size_t>(h.openedCount));"""

new = """    // Version 7: character sheet + crafting bank.
    visit_rpg(r, tmp.rpg);
    {
        const std::size_t pos = r.at();
        if (static_cast<std::size_t>(h.payloadBytes) < pos + kCraftingWire)
            return fail(SaveError::TooShort);
        if (!craft_read(bytes + kSaveHeaderWire + pos, kCraftingWire, tmp.craft))
            return fail(SaveError::TooShort);
        r.skip(kCraftingWire);
    }
    // Version 8 / SAVMAG: firearm chamber + kill tally.
    r.u8(tmp.hasRanged);
    visit_ranged(r, tmp.ranged);
    r.u32(tmp.kills);
    tmp.opened.resize(static_cast<std::size_t>(h.openedCount));"""

if old not in t:
    raise SystemExit("save.cpp read block not found")
t = t.replace(old, new, 1)

p.write_text(t, encoding="utf-8")
print("save.cpp OK")

# ---------------------------------------------------------------------------
# main.cpp — F5 capture + F9 restore
# ---------------------------------------------------------------------------
p = root / "src/app/main.cpp"
t = p.read_text(encoding="utf-8")

old = """        // Version 7: character sheet + crafting bank. Prefer the live entity
        // component; fall back to the death-surviving carried snapshot so a
        // mid-death F5 still banks progression. [save.h] SAVRPG
        if (const game::RpgStats* rs = reg.try_get<game::RpgStats>(player))
            runState.rpg = *rs;
        else
            runState.rpg = carriedRpg;
        runState.craft = crafting;
        // REFRESH, not append and not clear. [save.h]"""

new = """        // Version 7: character sheet + crafting bank. Prefer the live entity
        // component; fall back to the death-surviving carried snapshot so a
        // mid-death F5 still banks progression. [save.h] SAVRPG
        if (const game::RpgStats* rs = reg.try_get<game::RpgStats>(player))
            runState.rpg = *rs;
        else
            runState.rpg = carriedRpg;
        runState.craft = crafting;
        // Version 8 / SAVMAG: chambered mag + kill tally. Lazy-attach stays
        // lazy — only mark hasRanged when the body actually carries the
        // component (elevator rule). kills is the person-state local that
        // death-possession already stamps onto a new body.
        if (const game::PlayerRanged* pr = reg.try_get<game::PlayerRanged>(player)) {
            runState.hasRanged = 1;
            runState.ranged = *pr;
        } else {
            runState.hasRanged = 0;
            runState.ranged = game::PlayerRanged{};
        }
        runState.kills = kills;
        // REFRESH, not append and not clear. [save.h]"""

if old not in t:
    raise SystemExit("main.cpp F5 block not found")
t = t.replace(old, new, 1)

old = """                            // Version 7: stamp the sheet onto the body and the
                            // death-surviving carried snapshot, then restore the
                            // crafting bank. embody_as_player may have rolled a
                            // fresh sheet from the record — overwrite it. [save.h]
                            carriedRpg = runState.rpg;
                            if (reg.valid(player))
                                reg.emplace_or_replace<game::RpgStats>(
                                    player, runState.rpg);
                            crafting = runState.craft;
                            // Per-floor clocks and channels reset, same as any
                            // arrival."""

new = """                            // Version 7: stamp the sheet onto the body and the
                            // death-surviving carried snapshot, then restore the
                            // crafting bank. embody_as_player may have rolled a
                            // fresh sheet from the record — overwrite it. [save.h]
                            carriedRpg = runState.rpg;
                            if (reg.valid(player))
                                reg.emplace_or_replace<game::RpgStats>(
                                    player, runState.rpg);
                            crafting = runState.craft;
                            // Version 8 / SAVMAG: restore chambered mag (lazy)
                            // and the cumulative kill tally so F9 does not free
                            // the ammo already debited into the magazine, and
                            // does not zero the HUD kills line. [combat.h]
                            kills = runState.kills;
                            if (reg.valid(player)) {
                                if (runState.hasRanged)
                                    reg.emplace_or_replace<game::PlayerRanged>(
                                        player, runState.ranged);
                                if (runState.kills != 0u)
                                    reg.emplace_or_replace<game::PlayerMelee>(
                                        player, game::PlayerMelee{0, runState.kills});
                            }
                            // Per-floor clocks and channels reset, same as any
                            // arrival."""

if old not in t:
    raise SystemExit("main.cpp F9 block not found")
t = t.replace(old, new, 1)

p.write_text(t, encoding="utf-8")
print("main.cpp OK")

# ---------------------------------------------------------------------------
# suite_saveload.inl
# ---------------------------------------------------------------------------
p = root / "tests/suite_saveload.inl"
t = p.read_text(encoding="utf-8")

old = """#include "game/craft.h"   // craft_init, craft_learn (SAVRPG pin)
#include "game/rpg.h"     // fresh_rpg, RpgStats (SAVRPG pin)"""
new = """#include "game/craft.h"   // craft_init, craft_learn (SAVRPG pin)
#include "game/rpg.h"     // fresh_rpg, RpgStats (SAVRPG pin)
#include "game/combat.h"  // PlayerRanged (SAVMAG pin)"""
if old not in t:
    raise SystemExit("suite includes not found")
t = t.replace(old, new, 1)

old = """    craft_init(st.craft);
    st.craft.mat[0] = 111u;
    st.craft.mat[3] = 222u;
    st.craft.mat[8] = 333u;
    st.craft.tier = 2u;
    // Flip one non-default discoverable bit if the table has room past defaults.
    // craft_learn no-ops on already-known / non-discoverable; the mat/tier pins
    // still catch a dropped craft section even if learn is a no-op.
    for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
        if (craft_learn(st.craft, id)) break;
    }

    // Two floors' worth of emptied crates, one of them below the hub"""

new = """    craft_init(st.craft);
    st.craft.mat[0] = 111u;
    st.craft.mat[3] = 222u;
    st.craft.mat[8] = 333u;
    st.craft.tier = 2u;
    // Flip one non-default discoverable bit if the table has room past defaults.
    // craft_learn no-ops on already-known / non-discoverable; the mat/tier pins
    // still catch a dropped craft section even if learn is a no-op.
    for (ItemId id = 1; id <= kCraftRecipeCount; ++id) {
        if (craft_learn(st.craft, id)) break;
    }

    // Version 8 / SAVMAG: non-default chamber + kills so a dropped combat
    // section cannot hide behind zero defaults.
    st.hasRanged = 1;
    st.ranged.cooldownMs = 120u;
    st.ranged.reloadMs = 450u;
    st.ranged.magCount = 7u;
    st.ranged.weapon = 1;       // any non-zero ItemId; table drift is separate
    st.ranged.shots = 42u;
    st.ranged.hits = 11u;
    st.kills = 99u;

    // Two floors' worth of emptied crates, one of them below the hub"""

if old not in t:
    raise SystemExit("suite busy_run craft block not found")
t = t.replace(old, new, 1)

old = """    // Version 7 / SAVRPG: sheet + craft bank.
    CHECK(a.rpg.xp == b.rpg.xp);
    CHECK(a.rpg.psi == b.rpg.psi);
    CHECK(a.rpg.level == b.rpg.level);
    CHECK(a.rpg.attrPoints == b.rpg.attrPoints);
    CHECK(a.rpg.attr[0] == b.rpg.attr[0]);
    CHECK(a.rpg.attr[1] == b.rpg.attr[1]);
    CHECK(a.rpg.attr[2] == b.rpg.attr[2]);
    CHECK(a.craft.tier == b.craft.tier);
    for (std::size_t w = 0; w < kCraftKnownWords; ++w)
        CHECK(a.craft.known[w] == b.craft.known[w]);
    for (std::size_t i = 0; i < kCraftMaterials; ++i)
        CHECK(a.craft.mat[i] == b.craft.mat[i]);

    CHECK(a.opened.size() == b.opened.size());"""

new = """    // Version 7 / SAVRPG: sheet + craft bank.
    CHECK(a.rpg.xp == b.rpg.xp);
    CHECK(a.rpg.psi == b.rpg.psi);
    CHECK(a.rpg.level == b.rpg.level);
    CHECK(a.rpg.attrPoints == b.rpg.attrPoints);
    CHECK(a.rpg.attr[0] == b.rpg.attr[0]);
    CHECK(a.rpg.attr[1] == b.rpg.attr[1]);
    CHECK(a.rpg.attr[2] == b.rpg.attr[2]);
    CHECK(a.craft.tier == b.craft.tier);
    for (std::size_t w = 0; w < kCraftKnownWords; ++w)
        CHECK(a.craft.known[w] == b.craft.known[w]);
    for (std::size_t i = 0; i < kCraftMaterials; ++i)
        CHECK(a.craft.mat[i] == b.craft.mat[i]);

    // Version 8 / SAVMAG: chambered firearm + kill tally.
    CHECK(a.hasRanged == b.hasRanged);
    CHECK(a.ranged.cooldownMs == b.ranged.cooldownMs);
    CHECK(a.ranged.reloadMs == b.ranged.reloadMs);
    CHECK(a.ranged.magCount == b.ranged.magCount);
    CHECK(a.ranged.weapon == b.ranged.weapon);
    CHECK(a.ranged.shots == b.ranged.shots);
    CHECK(a.ranged.hits == b.ranged.hits);
    CHECK(a.kills == b.kills);

    CHECK(a.opened.size() == b.opened.size());"""

if old not in t:
    raise SystemExit("suite same_run checks not found")
t = t.replace(old, new, 1)

old = """    // Derived from the serializers, not measured from a run: 33 ledger + 79 book
    // (3 x 21 + 16) + 304 player (33 needs + 256 inventory + 12 + 3) + 12 rpg +
    // 93 craft + 308 quest log = 829, plus the fixed 36-byte faction matrix and
    // the 64-byte header (48 v1 + 8 v2 quests + 8 v6 blobs).
    static_assert(kSaveHeaderWire == 64);
    static_assert(kRpgWire == 12);
    static_assert(kCraftingWire == 93);
    static_assert(kSaveFixedWire == 829);
    static_assert(kFactionWire == 36);
    static_assert(save_bytes_for(0) == 929);
    static_assert(save_bytes_for(3) == 929 + 15);
    static_assert(save_bytes_for(3, 100, 50) == 929 + 15 + 150);"""

new = """    // Derived from the serializers, not measured from a run: 33 ledger + 79 book
    // (3 x 21 + 16) + 304 player (33 needs + 256 inventory + 12 + 3) + 12 rpg +
    // 93 craft + 21 combat (hasRanged+ranged+kills) + 308 quest log = 850,
    // plus the fixed 36-byte faction matrix and the 64-byte header.
    static_assert(kSaveHeaderWire == 64);
    static_assert(kRpgWire == 12);
    static_assert(kCraftingWire == 93);
    static_assert(kRangedWire == 16);
    static_assert(kCombatSaveWire == 21);
    static_assert(kSaveFixedWire == 850);
    static_assert(kFactionWire == 36);
    static_assert(save_bytes_for(0) == 950);
    static_assert(save_bytes_for(3) == 950 + 15);
    static_assert(save_bytes_for(3, 100, 50) == 950 + 15 + 150);"""

if old not in t:
    raise SystemExit("suite wire_layout asserts not found")
t = t.replace(old, new, 1)

old = """    // 944 B for a full run with three emptied crates and no macro blobs (those are
    // variable-size and pinned by macro_world_round_trips). GEOMETRY lives in the
    // per-floor files ([save.h] modular layout), never here. v6 was 839; +12 +93.
    CHECK(bytes.size() == 944);"""

new = """    // 965 B for a full run with three emptied crates and no macro blobs (those are
    // variable-size and pinned by macro_world_round_trips). GEOMETRY lives in the
    // per-floor files ([save.h] modular layout), never here. v7 was 944; +21 SAVMAG.
    CHECK(bytes.size() == 965);"""

if old not in t:
    raise SystemExit("suite 944 check not found")
t = t.replace(old, new, 1)

p.write_text(t, encoding="utf-8")
print("suite_saveload.inl OK")

print("ALL SOURCE PATCHES APPLIED")
