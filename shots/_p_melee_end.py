import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

cc = pathlib.Path("src/game/combat.cpp").read_text(encoding="utf-8", errors="replace")
# print player_melee_step full body from line ~1185
lines = cc.splitlines()
start = None
for i, l in enumerate(lines):
    if "bool player_melee_step" in l:
        start = i
        break
print("start", start + 1 if start is not None else None)
if start is not None:
    for j in range(start, min(len(lines), start + 140)):
        print(f"{j+1}|{lines[j]}")

print("=== weapon_table ===")
wt = pathlib.Path("src/game/weapon_table.h").read_text(encoding="utf-8", errors="replace")
print(wt[:2500])

print("=== game_test includes ===")
gt = pathlib.Path("tests/game_test.cpp").read_text(encoding="utf-8", errors="replace")
for j, l in enumerate(gt.splitlines()[:130], 1):
    if "#include" in l or "suite_" in l:
        print(f"{j}|{l}")
