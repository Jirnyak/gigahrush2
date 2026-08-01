# -*- coding: utf-8 -*-
"""POSRPG seam dump: embody, BACKLOG OPEN, elevator test, includes at main top."""
from pathlib import Path
ROOT = Path(r"C:\hades\gigahrush2")

def dump(path, needles, ctx=2):
    p = ROOT / path
    if not p.exists():
        print(f"MISSING {path}")
        return
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"\n=== {path} ===")
    for i, ln in enumerate(lines, 1):
        if any(n in ln for n in needles):
            lo, hi = max(1, i - ctx), min(len(lines), i + ctx)
            for j in range(lo, hi + 1):
                mark = ">" if j == i else " "
                print(f"{mark}{j:5d}|{lines[j-1]}")
            print("---")

dump("src/game/embody.cpp", ["RpgStats", "embody_as_player", "random_rpg", "emplace"])
dump("src/game/embody.h", ["embody", "RpgStats"])
dump("src/game/elevator.cpp", ["hadRpg", "hadMelee", "hadRanged", "RpgStats", "PlayerMelee", "PlayerRanged"])
dump("src/app/main.cpp", ["#include \"game/combat", "#include \"game/rpg", "#include \"game/elevator"])
# first 80 lines of main includes
main = (ROOT / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
print("\n=== main.cpp includes (1-120) ===")
for i, ln in enumerate(main[:120], 1):
    if "include" in ln.lower() or ln.startswith("//") or not ln.strip():
        print(f"{i:4d}|{ln}")

bl = ROOT / ".agents/worker_game_audit/BACKLOG.md"
if bl.exists():
    print("\n=== BACKLOG OPEN / POSRPG / recent CLOSED ===")
    text = bl.read_text(encoding="utf-8", errors="replace")
    for i, ln in enumerate(text.splitlines(), 1):
        if any(k in ln for k in ("OPEN", "POSRPG", "SAVMAG", "SAVRPG", "RPG1", "MAGSHOT", "possess", "| OPEN", "CLOSED")):
            print(f"{i:4d}|{ln}")

# elevator test window
gt = ROOT / "tests/game_test.cpp"
lines = gt.read_text(encoding="utf-8", errors="replace").splitlines()
print("\n=== game_test elevator window 700-860 ===")
for i in range(700, min(860, len(lines))):
    print(f"{i+1:4d}|{lines[i]}")

# suite_rpg end for where to add test
print("\n=== suite_rpg.inl last 80 lines (where to append) ===")
sr = (ROOT / "tests/suite_rpg.inl").read_text(encoding="utf-8", errors="replace").splitlines()
for i, ln in enumerate(sr[-80:], len(sr) - 79):
    print(f"{i:4d}|{ln}")

# CMake pin
cm = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8", errors="replace")
for i, ln in enumerate(cm.splitlines(), 1):
    if "PASS_REGULAR" in ln or "game_test" in ln and "checks" in ln:
        print(f"CMAKE {i}|{ln}")
