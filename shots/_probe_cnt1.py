# -*- coding: utf-8 -*-
"""CNT1: compare old-giga craft data vs gigahrush2 craft_recipes.csv + status parity."""
import csv
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OLD = Path(r"C:\hades\gigahrush")
GH2 = Path(r"C:\hades\gigahrush2")

# --- status parity (already known 6/6) ---
status_csv = list(csv.DictReader((GH2 / "data" / "status.csv").open(encoding="utf-8")))
print("=== STATUS ===")
print("gh2 status rows:", len(status_csv), [r["id"] for r in status_csv])
gov = (OLD / "src" / "systems" / "govnyak.ts").read_text(encoding="utf-8")
for pat in [r"RELIEF\w*\s*=\s*(\d+)", r"COUGH\w*\s*=\s*(\d+)", r"DEBT\w*\s*=\s*(\d+)",
            r"(\d+)\s*\*\s*1000", r"duration\w*\s*[:=]\s*(\d+)"]:
    ms = re.findall(pat, gov, re.I)
    if ms:
        print("govnyak match", pat, ms[:8])
# seconds constants
for line in gov.splitlines():
    if re.search(r"\b(70|210|480|70000|210000|480000)\b", line) and "const" in line.lower() or re.search(r"DURATION|SEC|MS", line):
        s = line.strip()
        if len(s) < 140 and not s.startswith("//"):
            # ascii-safe
            print("GOV", s.encode("ascii", "replace").decode("ascii"))

# --- craft sources ---
print("\n=== CRAFT SOURCES (old craft_recipe_sources.ts) ===")
src_ts = (OLD / "src" / "data" / "craft_recipe_sources.ts").read_text(encoding="utf-8")
rec_ts = (OLD / "src" / "data" / "craft_recipes.ts").read_text(encoding="utf-8")
mat_ts = (OLD / "src" / "data" / "craft_materials.ts").read_text(encoding="utf-8")

# source ids: id: 'foo' or id: "foo"
old_source_ids = sorted(set(re.findall(r"\bid\s*:\s*['\"]([a-z0-9_]+)['\"]", src_ts)))
print("old source ids:", len(old_source_ids))
for s in old_source_ids:
    print("  SRC", s)

# recipe ids from craft_recipes.ts
old_recipe_ids = sorted(set(re.findall(r"\bid\s*:\s*['\"]([a-z0-9_]+)['\"]", rec_ts)))
print("old recipe ids:", len(old_recipe_ids))
for s in old_recipe_ids:
    print("  REC", s)

# recipeIds arrays inside sources
recipe_lists = re.findall(r"recipeIds\s*:\s*\[([^\]]*)\]", src_ts, re.S)
all_from_sources = []
for block in recipe_lists:
    ids = re.findall(r"['\"]([a-z0-9_]+)['\"]", block)
    all_from_sources.extend(ids)
print("recipe refs in sources:", len(all_from_sources), "unique", len(set(all_from_sources)))

# gh2 csv
print("\n=== GH2 craft_recipes.csv ===")
rows = list(csv.DictReader((GH2 / "data" / "craft_recipes.csv").open(encoding="utf-8")))
print("rows", len(rows))
gh2_sources = [r["source_id"] for r in rows]
gh2_items = set()
for r in rows:
    for it in (r.get("recipe_items") or "").split("|"):
        it = it.strip()
        if it:
            gh2_items.add(it)
print("gh2 source_ids:")
for s in gh2_sources:
    print("  CSV", s)

old_set = set(old_source_ids)
new_set = set(gh2_sources)
print("\n=== DIFF sources ===")
print("only OLD:", sorted(old_set - new_set))
print("only GH2:", sorted(new_set - old_set))
print("common:", len(old_set & new_set))

# materials
print("\n=== MATERIALS old ===")
mat_ids = re.findall(r"id\s*:\s*['\"]([a-z0-9_]+)['\"]", mat_ts)
print("mat ids", mat_ids)

# gh2 craft system surface
print("\n=== GH2 craft.h surface ===")
craft_h = (GH2 / "src" / "game" / "craft.h").read_text(encoding="utf-8", errors="replace")
for pat in [r"kCraft\w+", r"CraftSource", r"CraftRecipe", r"struct \w+", r"enum class \w+"]:
    hits = re.findall(pat, craft_h)
    if hits:
        print(pat, "->", sorted(set(hits))[:30])

# gen expectations
gen = (GH2 / "tools" / "gen_craft_table.py").read_text(encoding="utf-8", errors="replace")
for line in gen.splitlines():
    if "EXPECTED" in line or "kCraft" in line or "len(rows)" in line:
        if len(line) < 120:
            print("GEN", line.strip())

# suite pin counts
suite = (GH2 / "tests" / "suite_craft.inl").read_text(encoding="utf-8", errors="replace")
print("suite_craft bytes", len(suite))
for pat in [r"kCraftSourceCount|kCraftRecipeCount|source_id|24|EXPECTED"]:
    print(pat, suite.count(pat) if isinstance(pat, str) and pat.isalnum() else len(re.findall(pat, suite)))

print("\n=== DONE ===")
