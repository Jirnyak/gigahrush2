# Probe SAVSTAT (StatusSet F5/F9) + other shippable gaps.
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

# StatusSet layout
for name in ["status.h", "status.cpp"]:
    p = root / "src/game" / name
    if not p.exists():
        # find
        hits = list((root / "src/game").rglob("*status*"))
        print("status files:", hits)
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    print(f"=== {name} size={len(t)} ===")
    for i, l in enumerate(t.splitlines(), 1):
        if re.search(r"struct Status|class Status|StatusSet|status_apply|status_step|kStatus|duration|remaining", l):
            print(f"L{i}: {l.rstrip()[:140]}")

# How big is StatusSet POD?
print("\n=== status.h full structs (excerpt) ===")
sh = list((root/"src/game").rglob("status.h"))
if sh:
    t = sh[0].read_text(encoding="utf-8", errors="replace")
    # print whole if small
    if len(t) < 15000:
        print(t[:8000].encode("ascii","replace").decode("ascii"))
    else:
        print(t[:8000].encode("ascii","replace").decode("ascii"))

# player_ranged_step body for RPG
print("\n=== player_ranged_step full scan ===")
cpp = (root/"src/game/combat.cpp").read_text(encoding="utf-8")
lines = cpp.splitlines()
for i,l in enumerate(lines):
    if "bool player_ranged_step" in l or "player_ranged_step(" in l and i < 50:
        pass
idx = None
for i,l in enumerate(lines):
    if re.match(r"^\s*(bool|void)\s+player_ranged_step", l) or "player_ranged_step(" in l and "{" in l and "bool" in l:
        idx = i
        break
if idx is None:
    for i,l in enumerate(lines):
        if "player_ranged_step" in l and not l.strip().startswith("//") and not l.strip().startswith("*"):
            print(f"mention L{i+1}: {l[:120]}")
else:
    for j in range(idx, min(idx+100, len(lines))):
        print(f"L{j+1}: {lines[j][:140]}")
        if j > idx and lines[j].startswith("}") and len(lines[j].strip())==1:
            break

# death path: does it transfer kills/ranged?
print("\n=== main death path window ~3380-3850 ===")
main = (root/"src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
ml = main.splitlines()
for i in range(3380, min(3850, len(ml))):
    l = ml[i]
    if re.search(r"kills|PlayerMelee|PlayerRanged|carriedRpg|possess|RpgStats|ranged|mag", l):
        print(f"L{i+1}: {l.rstrip()[:140]}".encode("ascii","replace").decode("ascii"))

# Inventory on possess?
print("\n=== inventory possess/elevator ===")
for p in [root/"src/game/combat.cpp", root/"src/game/elevator.cpp", root/"src/app/main.cpp"]:
    t = p.read_text(encoding="utf-8", errors="replace")
    for i,l in enumerate(t.splitlines(),1):
        if re.search(r"Inventory|transfer.*inv|inv.*transfer|bag", l, re.I) and re.search(r"possess|elevator|embody|transfer", l, re.I):
            print(f"{p.name}:{i}: {l.strip()[:140]}")

# int_ helpers unused?
print("\n=== rpg.cpp exported helpers + callers ===")
rpg_cpp = (root/"src/game/rpg.cpp").read_text(encoding="utf-8", errors="replace")
rpg_h = (root/"src/game/rpg.h").read_text(encoding="utf-8", errors="replace")
# find function defs
fns = re.findall(r"^(?:inline\s+)?(?:std::\w+|int|float|bool|void|std::uint\w+)\s+(\w+)\s*\(", rpg_h, re.M)
print("rpg.h fns:", fns)
for fn in fns:
    # count callers outside rpg
    n = 0
    sites = []
    for p in (root/"src").rglob("*.cpp"):
        if p.name.startswith("rpg"): continue
        tt = p.read_text(encoding="utf-8", errors="replace")
        c = tt.count(fn+"(")
        if c:
            n += c
            sites.append(f"{p.name}:{c}")
    for p in (root/"tests").rglob("*"):
        if p.suffix not in (".inl",".cpp",".h"): continue
        tt = p.read_text(encoding="utf-8", errors="replace")
        c = tt.count(fn+"(")
        if c:
            n += c
            sites.append(f"{p.name}:{c}")
    print(f"  {fn}: callers={n} {sites[:8]}")

# ai.h NOT wired note
print("\n=== ai.h line 33 context ===")
ai = (root/"src/game/ai.h").read_text(encoding="utf-8", errors="replace")
al = ai.splitlines()
for i in range(max(0,25), min(50,len(al))):
    print(f"L{i+1}: {al[i][:140]}".encode("ascii","replace").decode("ascii"))

# Check if PlayerMelee kills transfer on death (not just possess)
print("\n=== death possess_a_survivor ===")
for i,l in enumerate(ml):
    if "possess_a_survivor" in l or "possess_nearest" in l:
        print(f"L{i+1}: {l.rstrip()[:140]}")

print("DONE")
