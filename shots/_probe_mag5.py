from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
out = []

gt = (root / "tests/game_test.cpp").read_text(encoding="utf-8", errors="replace")
# elevator test around line 730
lines = gt.splitlines()
out.append("==== elevator test 700-850 ====")
for i in range(699, min(850, len(lines))):
    out.append(f"{i+1}:{lines[i]}")

# find player shoot test
for key in ["void test_player_shoots", "magCount == def.magazine", "equipped_ranged"]:
    idx = gt.find(key)
    out.append(f"find {key} -> {idx}")
    if idx >= 0:
        line = gt.count("\n", 0, idx) + 1
        out.append(f"  line {line}")
        for j in range(max(0, line - 5), min(len(lines), line + 80)):
            out.append(f"{j+1}:{lines[j][:140]}")

# inventory API
inv = (root / "src/game/inventory.h").read_text(encoding="utf-8", errors="replace")
out.append("==== inventory.h full ====")
out.append(inv)

# find inv helpers in all game sources
for p in sorted((root / "src/game").glob("*.h")):
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if any(k in l for k in ("inv_add", "inventory_add", "add_item", "try_stack", "slot_add", "give_")):
            out.append(f"{p.name}:{i}:{l.strip()[:120]}")

# item names for makarov
it = (root / "src/game/item_table.cpp")
if it.exists():
    t = it.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if any(k in l.lower() for k in ("makarov", "ammo_9mm", "pm ", "\"pm\"")):
            out.append(f"item_table.cpp:{i}:{l.strip()[:120]}")

# how main gives starting gear if any
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(main.splitlines(), 1):
    if any(k in l for k in ("inventory", "makarov", "ammo", "slots[", "give", "starting")):
        if "Inventory" in l or "slots" in l or "makarov" in l.lower() or "ammo" in l.lower() or "starting" in l.lower():
            out.append(f"main{i}:{l.strip()[:120]}")

path = root / "shots/_probe_mag5_out.txt"
path.write_text("\n".join(out), encoding="utf-8")
print("WROTE", path, path.stat().st_size)
