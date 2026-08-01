"""Apply SAVRPG: kSaveVersion 7, RpgStats + CraftingState in SaveState."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# save.h
# ---------------------------------------------------------------------------
sh = (root / "src/game/save.h").read_text(encoding="utf-8")

# includes
if '#include "game/rpg.h"' not in sh:
    sh = sh.replace(
        '#include "game/quest.h"       // QuestLog, kQuestLogWire, quest_table_fingerprint\n',
        '#include "game/quest.h"       // QuestLog, kQuestLogWire, quest_table_fingerprint\n'
        '#include "game/rpg.h"         // RpgStats\n'
        '#include "game/craft.h"       // CraftingState, kCraftingWire, craft_write/read\n',
    )

# version comment + bump
old_ver = """// Version 6: THE MACRO WORLD travels too — the whole NpcPool table (verbatim flat
// columns, [npc_pool.h] save_rows), the MacroSim clock/cursors/journeys
// ([macro_sim.h] save_state) and the live FactionRelations matrix. The society you
// return to is the one you left, not a reseed. Restored from the MAIN MENU, before
// anything is embodied, so no body can hold a stale id. Earlier versions are
// rejected, per the standing rule.
inline constexpr std::uint32_t kSaveVersion = 6u;"""

new_ver = """// Version 6: THE MACRO WORLD travels too — the whole NpcPool table (verbatim flat
// columns, [npc_pool.h] save_rows), the MacroSim clock/cursors/journeys
// ([macro_sim.h] save_state) and the live FactionRelations matrix. The society you
// return to is the one you left, not a reseed. Restored from the MAIN MENU, before
// anything is embodied, so no body can hold a stale id. Earlier versions are
// rejected, per the standing rule.
// Version 7: the character sheet and the crafting bank travel too — RpgStats
// (level/xp/attrs/psi) and CraftingState (known-recipe bits + material bank +
// tier). F5/F9 no longer drop progression. craft_write/craft_read own the craft
// codec ([craft.h]); the RPG fields are written little-endian field by field.
inline constexpr std::uint32_t kSaveVersion = 7u;"""

if old_ver not in sh:
    raise SystemExit("save.h version block not found")
sh = sh.replace(old_ver, new_ver)

# wire sizes
old_wire = """inline constexpr std::size_t kPlayerWire = kNeedsWire + kInventoryWire + 4 + 4 + 4 + 3;
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
// kQuestLogWire is defined in quest.h.
inline constexpr std::size_t kSaveFixedWire = kLedgerWire + kBookWire + kPlayerWire + kQuestLogWire;"""

new_wire = """inline constexpr std::size_t kPlayerWire = kNeedsWire + kInventoryWire + 4 + 4 + 4 + 3;
// Version 7: RpgStats wire — field-by-field LE, NOT sizeof (pad_ is written so the
// footprint stays 12 and matches the POD layout without host padding surprises).
inline constexpr std::size_t kRpgWire = 4 + 2 + 1 + 1 + 3 + 1;  // 12
static_assert(kRpgWire == 12);
// kCraftingWire (93) is defined in craft.h next to craft_write/craft_read.
// kQuestLogWire is defined in quest.h.
inline constexpr std::size_t kOpenedKeyWire = 5;     // i16 floor + 3 x u8 cell
inline constexpr std::size_t kSaveFixedWire =
    kLedgerWire + kBookWire + kPlayerWire + kRpgWire + kCraftingWire + kQuestLogWire;"""

if old_wire not in sh:
    raise SystemExit("save.h wire block not found")
sh = sh.replace(old_wire, new_wire)

# SaveState fields
old_ss = """struct SaveState {
    RunLedger ledger{};
    ContractBook book{};
    PlayerSnapshot player{};
    // Every crate emptied anywhere in the building, not just on the live floor. Only the
    // resident floor's crates are live entities, so the ones from other floors exist
    // ONLY in this list — see `refresh_opened_containers`.
    std::vector<OpenedContainerKey> opened;
    // Version 2: quest log persisted across F5/F9. Written last by
    // quest_log_write; read back by quest_log_read. Exactly kQuestLogWire bytes.
    QuestLog quests{};
    // Version 6: the macro world. poolBlob is NpcPool::save_rows' verbatim table,
    // macroBlob is MacroSim::save_state, and factions is the LIVE relations
    // matrix (36 POD bytes). Restored at the earliest possible point — from the
    // MAIN MENU, before anything is embodied — so no body can hold a stale id.
    std::vector<std::uint8_t> poolBlob;
    std::vector<std::uint8_t> macroBlob;
    FactionRelations factions = kBaseFactionMatrix;
};"""

new_ss = """struct SaveState {
    RunLedger ledger{};
    ContractBook book{};
    PlayerSnapshot player{};
    // Version 7: character sheet. Lives on the player entity at runtime
    // ([rpg.h]); captured into the run on F5 and stamped back on F9. Default is
    // a zeroed POD — main seeds a real sheet via fresh_rpg / embody.
    RpgStats rpg{};
    // Version 7: crafting bank + known-recipe bits + tier ([craft.h]). Run state
    // beside the ledger in main; craft_write/craft_read own the 93-byte codec.
    CraftingState craft{};
    // Every crate emptied anywhere in the building, not just on the live floor. Only the
    // resident floor's crates are live entities, so the ones from other floors exist
    // ONLY in this list — see `refresh_opened_containers`.
    std::vector<OpenedContainerKey> opened;
    // Version 2: quest log persisted across F5/F9. Written last by
    // quest_log_write; read back by quest_log_read. Exactly kQuestLogWire bytes.
    QuestLog quests{};
    // Version 6: the macro world. poolBlob is NpcPool::save_rows' verbatim table,
    // macroBlob is MacroSim::save_state, and factions is the LIVE relations
    // matrix (36 POD bytes). Restored at the earliest possible point — from the
    // MAIN MENU, before anything is embodied — so no body can hold a stale id.
    std::vector<std::uint8_t> poolBlob;
    std::vector<std::uint8_t> macroBlob;
    FactionRelations factions = kBaseFactionMatrix;
};"""

if old_ss not in sh:
    raise SystemExit("save.h SaveState block not found")
sh = sh.replace(old_ss, new_ss)

(root / "src/game/save.h").write_text(sh, encoding="utf-8")
print("save.h OK")

# ---------------------------------------------------------------------------
# save.cpp
# ---------------------------------------------------------------------------
sc = (root / "src/game/save.cpp").read_text(encoding="utf-8")

if '#include "game/craft.h"' not in sc:
    sc = sc.replace(
        '#include "game/quest.h"       // QuestLog, quest_log_write, quest_log_read, kQuestLogWire\n',
        '#include "game/quest.h"       // QuestLog, quest_log_write, quest_log_read, kQuestLogWire\n'
        '#include "game/craft.h"       // craft_write, craft_read, kCraftingWire\n'
        '#include "game/rpg.h"         // RpgStats (visit_rpg)\n',
    )

# visit_rpg after visit_player
old_vp = """template <class Ar, class P>
void visit_player(Ar& ar, P& p) {
    visit_needs(ar, p.clock);
    visit_inventory(ar, p.inv);
    ar.i32(p.hp);
    ar.i32(p.maxHp);
    ar.i32(p.floorNumber);
    ar.u8(p.cx);
    ar.u8(p.cy);
    ar.u8(p.cz);
}

template <class Ar, class K>
void visit_key(Ar& ar, K& k) {"""

new_vp = """template <class Ar, class P>
void visit_player(Ar& ar, P& p) {
    visit_needs(ar, p.clock);
    visit_inventory(ar, p.inv);
    ar.i32(p.hp);
    ar.i32(p.maxHp);
    ar.i32(p.floorNumber);
    ar.u8(p.cx);
    ar.u8(p.cy);
    ar.u8(p.cz);
}

// Version 7: RpgStats field-by-field. pad_ is written so the wire is exactly
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

if old_vp not in sc:
    raise SystemExit("save.cpp visit_player block not found")
sc = sc.replace(old_vp, new_vp)

# static_asserts
old_sa = """// kSaveFixedWire now includes kQuestLogWire (308 B: 20 rows x 14 B + 8 + 20).
static_assert(kSaveFixedWire == 724);
static_assert(kFactionWire == 36);
// header 64 + fixed 724 + faction 36 = 824 for an empty run.
static_assert(save_bytes_for(0) == 824);
static_assert(save_bytes_for(0, 100, 50) == 824 + 150);"""

new_sa = """// kSaveFixedWire: ledger+book+player + v7 rpg(12)+craft(93) + quest log.
// Was 724 in v6; +12 +93 = 829 in v7.
static_assert(kRpgWire == 12);
static_assert(kCraftingWire == 93);
static_assert(kSaveFixedWire == 724 + 12 + 93);  // 829
static_assert(kSaveFixedWire == 829);
static_assert(kFactionWire == 36);
// header 64 + fixed 829 + faction 36 = 929 for an empty run.
static_assert(save_bytes_for(0) == 929);
static_assert(save_bytes_for(0, 100, 50) == 929 + 150);"""

if old_sa not in sc:
    raise SystemExit("save.cpp static_assert block not found")
sc = sc.replace(old_sa, new_sa)

# save_write body: after visit_player, write rpg + craft
old_sw = """    visit_ledger(bw, st.ledger);
    visit_book(bw, st.book);
    visit_player(bw, st.player);
    for (const OpenedContainerKey& k : st.opened) visit_key(bw, k);"""

new_sw = """    visit_ledger(bw, st.ledger);
    visit_book(bw, st.book);
    visit_player(bw, st.player);
    // Version 7: character sheet + crafting bank (fixed-size, in kSaveFixedWire).
    visit_rpg(bw, st.rpg);
    {
        const std::size_t at = body.size();
        body.resize(at + kCraftingWire);
        craft_write(st.craft, body.data() + at);
    }
    for (const OpenedContainerKey& k : st.opened) visit_key(bw, k);"""

if old_sw not in sc:
    raise SystemExit("save.cpp save_write body not found")
sc = sc.replace(old_sw, new_sw)

# save_read body: after visit_player, read rpg + craft
old_sr = """    visit_ledger(r, tmp.ledger);
    visit_book(r, tmp.book);
    visit_player(r, tmp.player);
    tmp.opened.resize(static_cast<std::size_t>(h.openedCount));
    for (std::size_t i = 0; i < tmp.opened.size(); ++i) visit_key(r, tmp.opened[i]);"""

new_sr = """    visit_ledger(r, tmp.ledger);
    visit_book(r, tmp.book);
    visit_player(r, tmp.player);
    // Version 7: character sheet + crafting bank.
    visit_rpg(r, tmp.rpg);
    {
        const std::size_t pos = r.at();
        if (static_cast<std::size_t>(h.payloadBytes) < pos + kCraftingWire)
            return fail(SaveError::TooShort);
        if (!craft_read(bytes + kSaveHeaderWire + pos, kCraftingWire, tmp.craft))
            return fail(SaveError::TooShort);
        r.skip(kCraftingWire);
    }
    tmp.opened.resize(static_cast<std::size_t>(h.openedCount));
    for (std::size_t i = 0; i < tmp.opened.size(); ++i) visit_key(r, tmp.opened[i]);"""

if old_sr not in sc:
    raise SystemExit("save.cpp save_read body not found")
sc = sc.replace(old_sr, new_sr)

(root / "src/game/save.cpp").write_text(sc, encoding="utf-8")
print("save.cpp OK")

# ---------------------------------------------------------------------------
# main.cpp — save_run_now capture + F9 apply
# ---------------------------------------------------------------------------
main = (root / "src/app/main.cpp").read_text(encoding="utf-8")

old_save = """        runState.player.cz = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.z / kCellSize)));
        // REFRESH, not append and not clear. [save.h]
        game::refresh_opened_containers(reg, pl, currentFloor, runState.opened);"""

new_save = """        runState.player.cz = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.z / kCellSize)));
        // Version 7: character sheet + crafting bank. Prefer the live entity
        // component; fall back to the death-surviving carried snapshot so a
        // mid-death F5 still banks progression. [save.h] SAVRPG
        if (const game::RpgStats* rs = reg.try_get<game::RpgStats>(player))
            runState.rpg = *rs;
        else
            runState.rpg = carriedRpg;
        runState.craft = crafting;
        // REFRESH, not append and not clear. [save.h]
        game::refresh_opened_containers(reg, pl, currentFloor, runState.opened);"""

if old_save not in main:
    raise SystemExit("main save_run_now capture site not found")
main = main.replace(old_save, new_save)

old_load = """                            if (pid != game::kInvalidNpc) {
                                game::apply_player_snapshot(pool, pid,
                                                            runState.player);
                                game::sync_armour(reg, pool, player);
                            }"""

new_load = """                            if (pid != game::kInvalidNpc) {
                                game::apply_player_snapshot(pool, pid,
                                                            runState.player);
                                game::sync_armour(reg, pool, player);
                            }
                            // Version 7: stamp the sheet onto the body and the
                            // death-surviving carried snapshot, then restore the
                            // crafting bank. embody_as_player may have rolled a
                            // fresh sheet from the record — overwrite it. [save.h]
                            carriedRpg = runState.rpg;
                            if (reg.valid(player))
                                reg.emplace_or_replace<game::RpgStats>(
                                    player, runState.rpg);
                            crafting = runState.craft;"""

if old_load not in main:
    raise SystemExit("main F9 apply site not found")
main = main.replace(old_load, new_load)

(root / "src/app/main.cpp").write_text(main, encoding="utf-8")
print("main.cpp OK")

# ---------------------------------------------------------------------------
# suite_saveload.inl
# ---------------------------------------------------------------------------
sl = (root / "tests/suite_saveload.inl").read_text(encoding="utf-8")

# include craft if missing (rpg via save.h)
if '#include "game/craft.h"' not in sl:
    sl = sl.replace(
        '#include "game/save.h"\n',
        '#include "game/save.h"\n'
        '#include "game/craft.h"   // craft_init, craft_learn (SAVRPG pin)\n'
        '#include "game/rpg.h"     // fresh_rpg, RpgStats (SAVRPG pin)\n',
    )

old_busy_tail = """    st.player.cx = 40;
    st.player.cy = 91;
    st.player.cz = 1;

    // Two floors' worth of emptied crates, one of them below the hub — the negative"""

new_busy_tail = """    st.player.cx = 40;
    st.player.cy = 91;
    st.player.cz = 1;

    // Version 7 / SAVRPG: a non-default sheet and a mutated craft bank so a
    // dropped field cannot hide behind fresh_rpg(1) / craft_init defaults.
    st.rpg = fresh_rpg(10);
    st.rpg.xp = 12345u;
    st.rpg.psi = 77u;
    st.rpg.attrPoints = 3u;
    st.rpg.attr[0] = 20u;  // STR
    st.rpg.attr[1] = 15u;  // AGI
    st.rpg.attr[2] = 8u;   // INT
    craft_init(st.craft);
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

    // Two floors' worth of emptied crates, one of them below the hub — the negative"""

if old_busy_tail not in sl:
    raise SystemExit("suite busy_run tail not found")
sl = sl.replace(old_busy_tail, new_busy_tail)

old_same = """    CHECK(a.player.cx == b.player.cx);
    CHECK(a.player.cy == b.player.cy);
    CHECK(a.player.cz == b.player.cz);

    CHECK(a.opened.size() == b.opened.size());"""

new_same = """    CHECK(a.player.cx == b.player.cx);
    CHECK(a.player.cy == b.player.cy);
    CHECK(a.player.cz == b.player.cz);

    // Version 7 / SAVRPG: sheet + craft bank.
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

if old_same not in sl:
    raise SystemExit("suite same_run player checks not found")
sl = sl.replace(old_same, new_same)

old_wl = """    // Derived from the serializers, not measured from a run: 33 ledger + 79 book
    // (3 x 21 + 16) + 304 player (33 needs + 256 inventory + 12 + 3) + 308 quest log
    // (20 rows x 14 + 8 earned + 5 x 4 counters) = 724, plus the fixed 36-byte
    // faction matrix and the 64-byte header (48 v1 + 8 v2 quests + 8 v6 blobs).
    static_assert(kSaveHeaderWire == 64);
    static_assert(kSaveFixedWire == 724);
    static_assert(kFactionWire == 36);
    static_assert(save_bytes_for(0) == 824);
    static_assert(save_bytes_for(3) == 824 + 15);
    static_assert(save_bytes_for(3, 100, 50) == 824 + 15 + 150);

    std::vector<std::uint8_t> bytes;
    SaveState empty;
    save_write(empty, bytes);
    CHECK(bytes.size() == save_bytes_for(0));

    const SaveState st = busy_run();
    save_write(st, bytes);
    CHECK(bytes.size() == save_bytes_for(3));
    // 839 B for a full run with three emptied crates and no macro blobs (those are
    // variable-size and pinned by macro_world_round_trips). GEOMETRY lives in the
    // per-floor files ([save.h] modular layout), never here.
    CHECK(bytes.size() == 839);"""

new_wl = """    // Derived from the serializers, not measured from a run: 33 ledger + 79 book
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
    static_assert(save_bytes_for(3, 100, 50) == 929 + 15 + 150);

    std::vector<std::uint8_t> bytes;
    SaveState empty;
    save_write(empty, bytes);
    CHECK(bytes.size() == save_bytes_for(0));

    const SaveState st = busy_run();
    save_write(st, bytes);
    CHECK(bytes.size() == save_bytes_for(3));
    // 944 B for a full run with three emptied crates and no macro blobs (those are
    // variable-size and pinned by macro_world_round_trips). GEOMETRY lives in the
    // per-floor files ([save.h] modular layout), never here. v6 was 839; +12 +93.
    CHECK(bytes.size() == 944);"""

if old_wl not in sl:
    raise SystemExit("suite wire_layout sizes not found")
sl = sl.replace(old_wl, new_wl)

(root / "tests/suite_saveload.inl").write_text(sl, encoding="utf-8")
print("suite_saveload.inl OK")

print("SAVRPG patches applied")
