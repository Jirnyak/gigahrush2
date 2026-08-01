"""Probe mob_behaviour wall_bias_damage / NOT YET WIRED seams."""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

# Read the NOT YET WIRED sections in mob_behaviour.h
mb = (root / "src/game/mob_behaviour.h").read_text(encoding="utf-8")
lines = mb.splitlines()
print("=== mob_behaviour.h NOT YET / wall_bias context ===")
for i, line in enumerate(lines, 1):
    if any(k in line for k in ("NOT YET", "wall_bias", "WallBias", "wall bias", "wired")):
        lo = max(0, i - 3)
        hi = min(len(lines), i + 8)
        print(f"--- around {i} ---")
        for j in range(lo, hi):
            print(f"{j+1}: {lines[j][:120]}")

# combat.cpp wall bias readers
print("\n=== combat wall bias ===")
for rel in ["src/game/combat.cpp", "src/game/combat.h"]:
    t = (root / rel).read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if re.search(r"wall_bias|WallBias|wallBias|braced|WallBrace", line):
            print(f"{rel}:{i}: {line.strip()[:110]}")

# speech source_rules
print("\n=== speech NOT YET ===")
sp = root / "src/game/speech.h"
if sp.exists():
    t = sp.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if "NOT yet" in line or "source_rules" in line or "not yet" in line.lower():
            print(f"speech.h:{i}: {line.strip()[:110]}")

# Check elevator FOR1 already covers mag - MAGSHOT is just live HUD proof
print("\n=== elevator ranged preserve (FOR1) ===")
el = root / "src/game/elevator.cpp"
if el.exists():
    t = el.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if "PlayerRanged" in line or "magCount" in line or "PlayerMelee" in line:
            print(f"elevator.cpp:{i}: {line.strip()[:110]}")
