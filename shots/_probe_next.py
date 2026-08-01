# -*- coding: utf-8 -*-
"""Daemon next-work probe: MAGSHOT seams + OPEN backlog + known gaps."""
from pathlib import Path
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"C:\hades\gigahrush2")

# --- BACKLOG OPEN table ---
bl = (root / ".agents" / "worker_game_audit" / "BACKLOG.md").read_text(encoding="utf-8")
print("=== BACKLOG OPEN section (first 40 lines after marker) ===")
if "## OPEN" in bl:
    sec = bl.split("## OPEN", 1)[1].split("## ", 1)[0]
    for i, l in enumerate(sec.splitlines()[:40], 1):
        print(f"  {l}")

# --- MAGSHOT: PlayerRanged / mag HUD / ride ---
main = (root / "src" / "app" / "main.cpp").read_text(encoding="utf-8", errors="replace")
lines = main.splitlines()
print("\n=== main.cpp MAG / ranged HUD / ride seams ===")
for pat in [
    r"mag",
    r"PlayerRanged",
    r"PlayerMelee",
    r"hadRanged",
    r"carriedRanged",
    r"--ride",
    r"do_ride",
    r"shotAction",
]:
    hits = []
    for i, l in enumerate(lines, 1):
        if re.search(pat, l, re.I):
            hits.append((i, l.strip()[:110]))
    print(f"\n-- {pat} n={len(hits)} --")
    for i, s in hits[:8]:
        print(f"  {i}: {s}")
    if len(hits) > 8:
        print(f"  ... +{len(hits)-8} more")

# elevator body-swap already has mag?
el = (root / "src" / "game" / "elevator.cpp").read_text(encoding="utf-8", errors="replace")
print("\n=== elevator.cpp ranged/melee capture ===")
for i, l in enumerate(el.splitlines(), 1):
    if any(k in l for k in ("Ranged", "Melee", "hadR", "hadM", "mag")):
        print(f"  {i}: {l.strip()[:110]}")

# suite coverage
print("\n=== tests mentioning mag / PlayerRanged / elevator ===")
tests = root / "tests"
for p in sorted(tests.glob("*.*")):
    t = p.read_text(encoding="utf-8", errors="replace")
    if any(k in t for k in ("PlayerRanged", "magCount", "test_elevator", "FOR1", "MAG1")):
        n = sum(1 for k in ("PlayerRanged", "magCount", "mag") if k in t)
        print(f"  {p.name}: hits-ish size={len(t)}")

# game_test elevator pins
gt = (root / "tests" / "game_test.cpp").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(gt.splitlines(), 1):
    if "Ranged" in l or "mag" in l.lower() and "elevator" in gt[max(0, gt.find(l)-200):gt.find(l)+200].lower():
        if "Ranged" in l or "magCount" in l or "PlayerMelee" in l:
            print(f"  game_test:{i}: {l.strip()[:100]}")

# Look for other unfinished TODOs in game layer (not render)
print("\n=== TODO/FIXME/XXX in src/game (sample) ===")
count = 0
for p in sorted((root / "src" / "game").rglob("*.{h,cpp}".replace("{h,cpp}", "*"))):
    if p.suffix not in (".h", ".cpp"):
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if re.search(r"\b(TODO|FIXME|XXX|HACK)\b", l) and "giga-check" not in l:
            print(f"  {p.relative_to(root)}:{i}: {l.strip()[:100]}")
            count += 1
            if count >= 25:
                break
    if count >= 25:
        break
print(f"  (showed up to {count})")

# AGENTS / ORIGINAL next?
for name in ["AGENTS.md", "ORIGINAL_REQUEST.md", ".agents/worker_game_audit/ORIGINAL_REQUEST.md"]:
    p = root / name
    if p.exists():
        print(f"\n=== {name} exists size={p.stat().st_size} ===")

# Check if voluntary possess still drops RpgStats (noted as follow-up)
print("\n=== possess / embody RpgStats seams ===")
for p in [root / "src" / "game" / "embody.cpp", root / "src" / "app" / "main.cpp"]:
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if any(k in l for k in ("possess", "embody", "carriedRpg", "random_rpg", "fresh_rpg")):
            if "possess" in l.lower() or "embody" in l or "carriedRpg" in l or "random_rpg" in l:
                print(f"  {p.name}:{i}: {l.strip()[:110]}")

print("\nDONE probe_next")
