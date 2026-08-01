"""Compare old-giga crafting surface vs gigahrush2 craft_recipes.csv."""
import os
import re
from pathlib import Path

old = Path(r"C:\hades\gigahrush\src\systems\crafting.ts")
new_csv = Path(r"C:\hades\gigahrush2\data\craft_recipes.csv")
text = old.read_text(encoding="utf-8")
print("old crafting.ts bytes", len(text), "lines", text.count("\n")+1)

# crude recipe-ish ids
ids = sorted(set(re.findall(r"['\"]([a-z][a-z0-9_]{2,})['\"]", text)))
print("string tokens sample", len(ids))
# look for recipe arrays / outputs
for pat in [
    r"recipes\s*[:=]",
    r"CRAFT",
    r"export function",
    r"export const",
]:
    print(pat, "->", len(re.findall(pat, text)))

# print function names
fns = re.findall(r"export function (\w+)", text)
print("export functions:", fns)
consts = re.findall(r"export const (\w+)", text)
print("export consts:", consts[:40])

# pull any multi-item recipe lists
for m in re.finditer(r"(?:ingredients|inputs|recipe|needs)\s*[:=]\s*\[([^\]]{0,400})\]", text, re.I):
    print("LIST", m.group(0)[:200].replace("\n"," "))

csv_lines = new_csv.read_text(encoding="utf-8").strip().splitlines()
print("\ngh2 craft rows", len(csv_lines)-1)
# check gen craft
gen = list(Path(r"C:\hades\gigahrush2\tools").glob("*craft*"))
print("tools", gen)

# govnyak durations only
g = Path(r"C:\hades\gigahrush\src\systems\govnyak.ts").read_text(encoding="utf-8")
for line in g.splitlines():
    if re.search(r"DURATION|duration|_SEC|_MS|relief|cough|debt", line, re.I):
        if len(line) < 160:
            print("GOV", line.strip())
