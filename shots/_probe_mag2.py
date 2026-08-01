from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

h = (root / "src/game/combat.h").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(h.splitlines(), 1):
    if "PlayerRanged" in l or "magCount" in l or "struct Player" in l:
        out.append(f"{i}:{l}")
m = re.search(r"struct\s+PlayerRanged\s*\{[^}]+\}", h, re.S)
if m:
    out.append("STRUCT:" + m.group(0))

el = (root / "src/game/elevator.cpp").read_text(encoding="utf-8", errors="replace")
lines = el.splitlines()
seen = set()
for i, l in enumerate(lines, 1):
    if "hadRanged" in l or "magCount" in l or "PlayerRanged" in l:
        lo, hi = max(1, i - 2), min(len(lines), i + 4)
        key = (lo, hi)
        if key in seen:
            continue
        seen.add(key)
        for j in range(lo, hi + 1):
            out.append(f"el{j}:{lines[j - 1][:120]}")
        out.append("---")

main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
ml = main.splitlines()
for i in range(4080, 4115):
    if i < len(ml):
        out.append(f"m{i+1}:{ml[i][:120]}")

for i, l in enumerate(ml, 1):
    if "runState.ranged" in l or "hasRanged" in l:
        out.append(f"m{i}:{l.strip()[:120]}")

# ride / shot end logging
for i, l in enumerate(ml, 1):
    s = l.strip()
    if any(k in s for k in ("shotRide", "rideDone", "shot: saved", "framesSeen", "shotFrames")):
        if i > 4900 or "shot" in s.lower() or "ride" in s.lower():
            out.append(f"r{i}:{s[:130]}")

# weapon def magazine defaults
wh = ""
for p in [root / "src/game/combat.h", root / "src/game/items.h", root / "src/game/weapon.h"]:
    if p.exists():
        t = p.read_text(encoding="utf-8", errors="replace")
        if "magazine" in t:
            out.append(f"file {p.name} has magazine")
            for i, l in enumerate(t.splitlines(), 1):
                if "magazine" in l.lower() or "WeaponDef" in l:
                    out.append(f"  {i}:{l.strip()[:100]}")

path = root / "shots/_probe_mag2_out.txt"
path.write_text("\n".join(out), encoding="utf-8")
print("WROTE", path, path.stat().st_size)
