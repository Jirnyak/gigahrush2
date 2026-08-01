# -*- coding: utf-8 -*-
"""CNT1b: item-level craft recipe parity + govnyak caps."""
import csv
import re
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OLD = Path(r"C:\hades\gigahrush")
GH2 = Path(r"C:\hades\gigahrush2")

old = (OLD / "src" / "data" / "craft_recipes.ts").read_text(encoding="utf-8")
print("craft_recipes.ts bytes", len(old))
print("--- head ---")
print(old[:2000])
print("---")
print("export", re.findall(r"export const (\w+)", old))
print("export function", re.findall(r"export function (\w+)", old))

# How recipes are defined
for pat in [
    r"itemId\s*:",
    r"components\s*:",
    r"knownByDefault",
    r"discoverable",
    r"CRAFT_RECIPES",
    r"as const",
    r"Record<",
]:
    print(pat, "->", len(re.findall(pat, old)))

item_ids = re.findall(r"itemId\s*:\s*['\"]([a-z0-9_]+)['\"]", old)
print("old itemIds count", len(item_ids), "unique", len(set(item_ids)))
print("old itemIds", sorted(set(item_ids)))

# recipe id field
rids = re.findall(r"(?:^|\s)id\s*:\s*['\"]([a-z0-9_]+)['\"]", old)
print("old id fields", sorted(set(rids)))

# Maybe recipes keyed by item id as object keys
obj_keys = re.findall(r"^\s{2}([a-z][a-z0-9_]*)\s*:", old, re.M)
print("indent2 keys sample", obj_keys[:50], "count", len(obj_keys))

# composition / materials vector style
print("number arrays", len(re.findall(r"\[\s*\d+(?:\s*,\s*\d+){3,}\s*\]", old)))

# sources recipeIds vs recipes
src = (OLD / "src" / "data" / "craft_recipe_sources.ts").read_text(encoding="utf-8")
from_src = re.findall(r"recipeIds\s*:\s*\[([^\]]*)\]", src, re.S)
src_recipe_ids = []
for block in from_src:
    src_recipe_ids.extend(re.findall(r"['\"]([a-z0-9_]+)['\"]", block))
print("source recipe id refs unique", len(set(src_recipe_ids)))
print("sample src recipes", sorted(set(src_recipe_ids))[:40])

# gh2 learnable items from sources csv
rows = list(csv.DictReader((GH2 / "data" / "craft_recipes.csv").open(encoding="utf-8")))
gh2_items = set()
for r in rows:
    for it in (r.get("recipe_items") or "").split("|"):
        it = it.strip()
        if it:
            gh2_items.add(it)
print("gh2 learnable items", len(gh2_items))
print(sorted(gh2_items))

# craft_table: kCraftRecipeCount
craft_h = (GH2 / "src" / "game" / "craft.h").read_text(encoding="utf-8")
for line in craft_h.splitlines():
    if "kCraftRecipeCount" in line or "kCraftSourceCount" in line or "kCraftMaterial" in line:
        if len(line) < 120:
            print("H", line.strip())

# How many recipes in generated table
ct = (GH2 / "src" / "game" / "craft_table.cpp").read_text(encoding="utf-8", errors="replace")
print("craft_table.cpp bytes", len(ct))
print("CraftRecipe{ count", ct.count("CraftRecipe{"))
# item ids in table comments
gh2_recipe_comments = re.findall(r"//\s*\[(\d+)\]\s*([a-z0-9_]+)", ct)
print("table row comments", len(gh2_recipe_comments))
if gh2_recipe_comments:
    print("first10", gh2_recipe_comments[:10])
    print("last5", gh2_recipe_comments[-5:])

# Compare old source recipe refs to gh2 items — sources teach recipe ids which may be item ids
old_src_set = set(src_recipe_ids)
print("\n=== recipe-id refs in old sources vs gh2 items ===")
print("only OLD source-recipes:", sorted(old_src_set - gh2_items)[:50])
print("count only old", len(old_src_set - gh2_items))
print("only GH2 items not in old source refs:", sorted(gh2_items - old_src_set)[:50])
print("count only gh2", len(gh2_items - old_src_set))
print("common", len(old_src_set & gh2_items))

# govnyak
gov = (OLD / "src" / "systems" / "govnyak.ts").read_text(encoding="utf-8")
m = re.search(r"GOVNYAK_STATUS_DURATION_CAPS[\s\S]{0,500}", gov)
print("\n=== GOV CAPS ===")
if m:
    print(m.group(0).encode("ascii", "replace").decode("ascii"))
for pat in [r"govnyak_relief[^\n]{0,80}", r"govnyak_cough[^\n]{0,80}", r"govnyak_debt[^\n]{0,80}",
            r"\b70\b", r"\b210\b", r"\b480\b"]:
    hits = re.findall(pat, gov)
    if hits:
        print(pat, "->", [h.encode("ascii","replace").decode() if isinstance(h,str) else h for h in hits[:5]])

print("\nDONE")
