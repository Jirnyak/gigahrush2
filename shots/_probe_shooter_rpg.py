# Inspect test_player_shoots setup for RpgStats on shooter
from pathlib import Path
lines = Path(r"C:\hades\gigahrush2\tests\game_test.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
# find test_player_shoots
start = None
for i, l in enumerate(lines):
    if "test_player_shoots" in l and ("void" in l or "static" in l):
        start = i
        print(f"def at {i+1}: {l}")
        break
if start is None:
    for i, l in enumerate(lines):
        if "player_shoots" in l:
            print(f"{i+1}: {l[:100]}")
else:
    for j in range(start, min(start+120, len(lines))):
        print(f"{j+1}: {lines[j][:130]}")

print("\n=== unarmed_melee ===")
for p in [r"C:\hades\gigahrush2\src\game\melee_table.h", r"C:\hades\gigahrush2\src\game\melee_table.cpp",
          r"C:\hades\gigahrush2\src\game\item_table.h"]:
    t = Path(p).read_text(encoding="utf-8", errors="replace") if Path(p).exists() else ""
    if "unarmed" in t.lower():
        for i, l in enumerate(t.splitlines(), 1):
            if "unarmed" in l.lower() or "cooldownMs" in l:
                print(f"{p}:{i}: {l[:120]}")

print("\n=== fresh_rpg defaults ===")
rpg = Path(r"C:\hades\gigahrush2\src\game\rpg.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(rpg, 1):
    if "fresh_rpg" in l or "random_rpg" in l:
        for j in range(i, min(i+25, len(rpg)+1)):
            print(f"{j}: {rpg[j-1][:120]}")
        print("---")
