# Probe next OPEN after MELEEGRID.
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")

# OPEN table rows
print("=== OPEN section (first 80 lines after ## OPEN) ===")
if "## OPEN" in bl:
    open_part = bl.split("## OPEN", 1)[1]
    # until next ##
    open_part = open_part.split("\n## ", 1)[0]
    lines = [l for l in open_part.splitlines() if l.strip().startswith("|")]
    for l in lines[:40]:
        print(l.encode("ascii", "replace").decode("ascii"))

print("\n=== CLOSED recent ===")
for l in bl.splitlines():
    if "CLOSED 2026-08" in l or "CLOSED 2026-07-3" in l:
        print(l.encode("ascii", "replace").decode("ascii"))

# Known deferred: MAGSHOT
print("\n=== MAGSHOT mentions ===")
for i, l in enumerate(bl.splitlines()):
    if "MAGSHOT" in l:
        print(f"{i}: {l.encode('ascii','replace').decode('ascii')}")

# combat.cpp apply_damage call sites missing grid?
print("\n=== apply_damage call sites ===")
cpp = (root / "src/game/combat.cpp").read_text(encoding="utf-8")
for i, line in enumerate(cpp.splitlines(), 1):
    if "apply_damage(" in line:
        # show multi-line call roughly
        chunk = "\n".join(cpp.splitlines()[i-1:i+2])
        print(f"L{i}: {chunk[:200]}")

# player_melee / grid already fixed
print("\n=== player_melee apply_damage line ===")
for i, line in enumerate(cpp.splitlines(), 1):
    if "MELEEGRID" in line or ("apply_damage" in line and "self" in line):
        print(f"L{i}: {line}")

# suite_rpg / other gaps from prior probes
probe = root / "shots/_probe_next_gap_out.txt"
if probe.exists():
    print("\n=== prior next_gap_out tail ===")
    print(probe.read_text(encoding="utf-8", errors="replace")[-2000:])
