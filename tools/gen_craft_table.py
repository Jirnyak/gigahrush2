#!/usr/bin/env python3
"""Generate src/game/craft_table.cpp from data/items.csv + data/craft_recipes.csv.

Sibling of tools/gen_item_table.py and tools/gen_mob_table.py, deliberately the
same shape: the content is data ([craft.h]), so adding a craftable is one CSV row
plus a regenerate, never an edit to engine code. Not wired into CMake — the
generated .cpp is committed, so the build needs no Python — and it hard-fails on an
unknown token rather than mapping it to a default, because silently defaulting is
how a content table rots.

    python tools/gen_craft_table.py

TWO INPUTS, and the split is the whole design decision:

  * data/items.csv columns 27..37 are the RECIPES. One recipe per item id, its
    cost vector being the item's own nine authored craft_* counts, its station
    `craft_station` and its tier `craft_tier`. This generator does not compute any
    of those — it copies them — because the reference already derived them and the
    columns are a faithful export of that derivation (replaying its
    `tierForComponents` over items.csv reproduces craft_tier for 446 of 446 rows).
    Re-typing those 4,014 integers into a second CSV would make "CSV edited,
    generator not re-run" an *authorable* failure rather than merely a possible
    one, so there is no second copy.

  * data/craft_recipes.csv is recipe KNOWLEDGE: the 23 sources of the reference's
    craft_recipe_sources.ts plus the default-known set, ported row for row. That
    is the content items.csv cannot hold, because knowing a recipe is a property
    of a run and not of an item.

`grantsTier` is DERIVED here rather than authored, and that is what makes the tier
gate safe: it is the maximum tier among the source's own recipes, so a source can
never teach a recipe the learner is not certified to build. Author a folder that
teaches a tier-4 emitter and it certifies to tier 4, by construction. The only
path that teaches without certifying is disassembly, which is code and not data.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEMS_PATH = os.path.join(REPO, "data", "items.csv")
SOURCES_PATH = os.path.join(REPO, "data", "craft_recipes.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "craft_table.cpp")

# Must equal kItemCount in item_table.h AND kCraftRecipeCount in craft.h, which is
# defined as kItemCount — so the recipe count cannot drift from the item count by
# construction and this is only a guard on the CSV itself.
EXPECTED_ITEM_ROWS = 442
# Must equal kCraftSourceCount in craft.h. The `source_rules` ctest compares this
# CSV's row count against that constant; see the note at the bottom of this file.
EXPECTED_SOURCE_ROWS = 24
# Must equal kCraftSourceMaxRecipes in craft.h.
MAX_SOURCE_RECIPES = 9
MAX_TIER = 4

# The nine axes, in the order kraft.md calls "an API, a save and a UI contract".
# Reordering this list silently re-prices all 446 items and invalidates every save.
MATERIAL_COLS = [
    "craft_mechanics", "craft_electronics", "craft_consumables", "craft_bio",
    "craft_chemical", "craft_metal", "craft_cybernetics", "craft_psimatter",
    "craft_metamatter",
]

STATION = {
    "any": "Any", "workbench": "Workbench", "lathe": "Lathe", "lab": "Lab",
    "net_terminal": "NetTerminal",
}

KIND = {
    "default": "Default", "item": "Item", "note": "Note", "quest": "Quest",
    "terminal": "Terminal", "npc": "Npc", "floor": "Floor",
}


def die(msg):
    sys.stderr.write("gen_craft_table: %s\n" % msg)
    sys.exit(1)


def cpp_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def pick(table, row, col, i, what, who):
    tok = (row.get(col) or "").strip()
    if tok not in table:
        die("row %d (%s): unknown %s %r — add it to the map here AND to the enum "
            "in craft.h" % (i, who, what, tok))
    return table[tok]


def read_items():
    with open(ITEMS_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if len(rows) != EXPECTED_ITEM_ROWS:
        die("expected %d item rows, got %d — if the catalog really changed, update "
            "EXPECTED_ITEM_ROWS here AND kItemCount in item_table.h, then re-run "
            "BOTH generators" % (EXPECTED_ITEM_ROWS, len(rows)))
    return rows


def read_sources():
    with open(SOURCES_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if len(rows) != EXPECTED_SOURCE_ROWS:
        die("expected %d source rows, got %d — update EXPECTED_SOURCE_ROWS here AND "
            "kCraftSourceCount in craft.h (the source_rules ctest compares the two)"
            % (EXPECTED_SOURCE_ROWS, len(rows)))
    return rows


def main():
    items = read_items()
    sources = read_sources()

    # id string -> 1-based ItemId, the same numbering item_table.cpp emits.
    item_id = {}
    for i, r in enumerate(items):
        key = (r.get("id") or "").strip()
        if not key:
            die("item row %d has no id" % i)
        if key in item_id:
            die("duplicate item id %r at row %d" % (key, i))
        item_id[key] = i + 1

    # --- the default-known set, from the one `default` row -------------------
    default_rows = [r for r in sources
                    if (r.get("kind") or "").strip() == "default"]
    if len(default_rows) != 1:
        die("expected exactly 1 kind=default row in %s, got %d — the starting "
            "recipe set is one authored list, not a scatter of flags"
            % (os.path.basename(SOURCES_PATH), len(default_rows)))
    default_known = set()
    for tok in (default_rows[0].get("recipe_items") or "").split("|"):
        tok = tok.strip()
        if not tok:
            continue
        if tok not in item_id:
            die("default row names item %r, which is not in items.csv" % tok)
        default_known.add(tok)

    # --- recipes: one per item, copied from items.csv ------------------------
    recipes, used_station = [], set()
    tier_of = {}
    zero_rows = 0
    total_units = 0
    tier_hist = [0] * (MAX_TIER + 1)
    for i, r in enumerate(items):
        who = r["id"]
        comp = []
        for col in MATERIAL_COLS:
            text = (r.get(col) or "").strip()
            v = 0 if not text else int(round(float(text)))
            if not (0 <= v <= 255):
                die("row %d (%s): %s = %r is outside the 0..255 a CraftRecipe "
                    "material byte can hold" % (i, who, col, text))
            comp.append(v)
        total = sum(comp)
        if total == 0:
            # craft_disassemble would have to divide by this to pick a weighted
            # axis. Refused here so the runtime's NoComposition branch stays
            # unreachable rather than becoming a live modulo-by-zero.
            zero_rows += 1
            die("row %d (%s): all nine craft_* columns are 0. A zero composition "
                "cannot be disassembled (weighted pick over a zero total) and "
                "cannot be crafted meaningfully. Author the vector."
                % (i, who))
        total_units += total

        station = pick(STATION, r, "craft_station", i, "craft station", who)
        used_station.add(station)

        text = (r.get("craft_tier") or "").strip()
        tier = 0 if not text else int(round(float(text)))
        if not (0 <= tier <= MAX_TIER):
            die("row %d (%s): craft_tier = %r is outside 0..%d — widen "
                "kCraftMaxTier in craft.h first" % (i, who, text, MAX_TIER))
        tier_hist[tier] += 1
        tier_of[who] = tier

        # Every recipe is discoverable: the reference sets `discoverable: true`
        # unconditionally and ships an empty CRAFT_RECIPE_EXCEPTIONS. The flag
        # exists so a future authored exception is a data change, not a code one.
        flags = ["kCraftDiscoverable"]
        if who in default_known:
            flags.append("kCraftKnownByDefault")

        recipes.append(
            "    // [%d] id %d  %s  tier %d  total %d\n"
            "    CraftRecipe{ {%s}, u8(CraftStation::%s), %d,\n"
            "                 static_cast<std::uint8_t>(%s) },"
            % (i, i + 1, who, tier, total,
               ", ".join(str(x) for x in comp), station, tier,
               " | ".join(flags)))

    # A default-known id that named nothing would have been caught above; a
    # default-known id that named something with no recipe cannot happen, because
    # every item has one. Assert the count so the ported list cannot silently shrink.
    if len(default_known) != 8:
        die("the reference's DEFAULT_KNOWN_RECIPE_IDS has 8 entries; this CSV's "
            "default row has %d. If the starting set really changed, say so in "
            "craft.h too — suite_craft.inl asserts it." % len(default_known))

    # --- sources ------------------------------------------------------------
    src_rows, id_rows, text_rows = [], [], []
    seen_src, used_kind = set(), set()
    learn_total = 0
    for i, r in enumerate(sources):
        sid = (r.get("source_id") or "").strip()
        if not sid:
            die("source row %d has no source_id" % i)
        if sid in seen_src:
            die("duplicate source_id %r at row %d" % (sid, i))
        seen_src.add(sid)

        kind = pick(KIND, r, "kind", i, "source kind", sid)
        used_kind.add(kind)

        ids = [t.strip() for t in (r.get("recipe_items") or "").split("|")
               if t.strip()]
        if not ids:
            die("source %r teaches nothing. A source with no recipes is dead "
                "content; delete the row or fill it." % sid)
        if len(ids) > MAX_SOURCE_RECIPES:
            die("source %r teaches %d recipes, over the %d a CraftSource row "
                "holds — widen kCraftSourceMaxRecipes in craft.h and here"
                % (sid, len(ids), MAX_SOURCE_RECIPES))
        seen_here = set()
        for tok in ids:
            if tok not in item_id:
                die("source %r names item %r, which is not in items.csv. A recipe "
                    "for an item that does not exist is a mockup." % (sid, tok))
            if tok in seen_here:
                die("source %r names item %r twice" % (sid, tok))
            seen_here.add(tok)
        learn_total += len(ids)

        unlock = (r.get("unlock_item") or "").strip()
        if kind == "Item":
            if not unlock:
                die("source %r is kind=item but names no unlock_item — nothing "
                    "in the world can teach it" % sid)
            if unlock not in item_id:
                die("source %r has unlock_item %r, which is not in items.csv"
                    % (sid, unlock))
        elif unlock:
            die("source %r is kind=%s but carries unlock_item %r. Only kind=item "
                "is resolved through the inventory; a stray carrier here would "
                "silently never fire." % (sid, kind.lower(), unlock))

        consume = (r.get("consume") or "0").strip()
        if consume not in ("0", "1"):
            die("source %r: consume = %r, expected 0 or 1" % (sid, consume))
        if consume == "1" and kind != "Item":
            die("source %r is kind=%s with consume=1, but only a carried item can "
                "be spent" % (sid, kind.lower()))

        # DERIVED, never authored: certify exactly what you teach. See the module
        # docstring — this is the invariant that makes a taught recipe craftable.
        grants = max(tier_of[t] for t in ids)

        padded = [str(item_id[t]) for t in ids]
        padded += ["0"] * (MAX_SOURCE_RECIPES - len(padded))
        src_rows.append(
            "    // [%d] %s  kind %s  teaches %d  grants tier %d\n"
            "    CraftSource{ {%s},\n"
            "                 %s, %d, u8(CraftSourceKind::%s), %d, %s },"
            % (i, sid, kind, len(ids), grants,
               ", ".join(padded),
               ("%d" % item_id[unlock]) if unlock else "kInvalidItem",
               len(ids), kind, grants, consume))
        id_rows.append("    %s," % cpp_string(sid))
        text_rows.append("    %s," % cpp_string((r.get("text_ru") or "").strip()))

    # An enumerator no row uses is either dead weight or a sign the CSV drifted —
    # the same NOTE gen_item_table.py prints for ItemCategory / UseEffect.
    for name, used, table in (("CraftStation", used_station, STATION),
                              ("CraftSourceKind", used_kind, KIND)):
        unused = sorted(set(table.values()) - used)
        if unused:
            sys.stderr.write("gen_craft_table: NOTE %s values unused by any row: "
                             "%s\n" % (name, ", ".join(unused)))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER % (EXPECTED_ITEM_ROWS, total_units, tier_hist[0],
                           tier_hist[1], tier_hist[2], tier_hist[3], tier_hist[4],
                           EXPECTED_SOURCE_ROWS, learn_total))
        fh.write("const std::array<CraftRecipe, kCraftRecipeCount> kCraftTable = {{\n")
        fh.write("\n".join(recipes))
        fh.write("\n}};\n\n")
        fh.write("const std::array<CraftSource, kCraftSourceCount> kCraftSources = {{\n")
        fh.write("\n".join(src_rows))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kCraftSourceCount> kCraftSourceIds = {{\n")
        fh.write("\n".join(id_rows))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kCraftSourceCount> kCraftSourceText = {{\n")
        fh.write("\n".join(text_rows))
        fh.write("\n}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write(
        "gen_craft_table: wrote %d recipes (%d material units, tiers %s) and %d "
        "sources (%d taught recipes, %d zero-composition rows) to %s\n"
        % (len(recipes), total_units, "/".join(str(x) for x in tier_hist),
           len(src_rows), learn_total, zero_rows, OUT_PATH))


HEADER = """// GENERATED by tools/gen_craft_table.py from data/items.csv +
// data/craft_recipes.csv — do not hand-edit. Edit the CSVs and re-run the
// generator; see [craft.h].
//
// %d recipes, one per item id, carrying %d authored material units in total
// (tier histogram %d/%d/%d/%d/%d). The cost vectors are COPIED from items.csv
// columns 27..37, not computed here: they are the reference's own
// ITEM_COMPOSITIONS export, and a second derivation would be a second thing to
// drift.
//
// %d knowledge sources teaching %d recipes between them. `grantsTier` on each is
// DERIVED as the maximum tier it teaches, so a source always certifies what it
// hands over.
//
// This file carries Cyrillic string literals (the source flavour text), which is
// what makes /utf-8 load-bearing on MSVC rather than merely defensive — the same
// reason item_table.cpp and mob_table.cpp need it ([AGENTS.md] SSBuild).
#include "game/craft.h"

namespace giga::game {

namespace {
constexpr std::uint8_t u8(CraftStation v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(CraftSourceKind v) { return static_cast<std::uint8_t>(v); }
} // namespace

"""

FOOTER = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()
