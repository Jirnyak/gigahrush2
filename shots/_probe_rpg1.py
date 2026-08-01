#!/usr/bin/env python3
"""RPG1 / MAGSHOT probe: what survives elevator body-swap."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def grepf(path, pats, ctx=1):
    p = ROOT / path
    if not p.is_file():
        print(f"MISSING {path}")
        return
    text = p.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    print(f"\n=== {path} ({len(lines)} lines) ===")
    for i, ln in enumerate(lines, 1):
        for pat in pats:
            if re.search(pat, ln, re.I):
                lo = max(0, i - 1 - ctx)
                hi = min(len(lines), i + ctx)
                for j in range(lo, hi):
                    mark = ">>" if j + 1 == i else "  "
                    print(f"{mark}{j+1}: {lines[j][:160]}")
                print("---")
                break

# elevator capture/restore
grepf("src/game/elevator.cpp", [
    r"PlayerRanged|PlayerMelee|Rpg|Stats|capture|restore|fold_back|embody",
    r"emplace_or_replace|try_get",
])
grepf("src/game/elevator.h", [r"."])  # just existence

# embody
grepf("src/game/embody.h", [r"struct |class |Rpg|Stats|Player"])
grepf("src/game/embody.cpp", [
    r"Rpg|Stats|PlayerRanged|PlayerMelee|roll|random",
    r"emplace|embody_as_player",
])

# search all game headers for Rpg / Stats / Skill
print("\n=== header scan Rpg/Skill/Stat ===")
for h in sorted((ROOT / "src/game").glob("*.h")):
    t = h.read_text(encoding="utf-8", errors="replace")
    if re.search(r"Rpg|SkillStat|PlayerStat|struct\s+\w*Stat", t):
        print(h.name)
        for i, ln in enumerate(t.splitlines(), 1):
            if re.search(r"Rpg|SkillStat|PlayerStat|struct\s+\w*Stat", ln):
                print(f"  {i}: {ln.strip()[:140]}")

print("\n=== ecs components scan ===")
for h in sorted((ROOT / "src").rglob("*.h")):
    if "build" in str(h) or ".claude" in str(h):
        continue
    t = h.read_text(encoding="utf-8", errors="replace")
    if "RpgStats" in t or "struct Rpg" in t or "PlayerRanged" in t:
        rel = h.relative_to(ROOT)
        print(rel)
        for i, ln in enumerate(t.splitlines(), 1):
            if re.search(r"RpgStats|struct Rpg|PlayerRanged|PlayerMelee", ln):
                print(f"  {i}: {ln.strip()[:140]}")

print("\n=== tests elevator ===")
for p in sorted((ROOT / "tests").glob("*elevator*")):
    print(p.name, p.stat().st_size)
for p in sorted((ROOT / "tests").glob("*.inl")):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "PlayerRanged" in t or "Rpg" in t or "magCount" in t:
        print(p.name)
        for i, ln in enumerate(t.splitlines(), 1):
            if re.search(r"PlayerRanged|PlayerMelee|Rpg|magCount|FOR1|MAG1", ln):
                print(f"  {i}: {ln.strip()[:140]}")
