from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

for rel in [
    "src/game/ranged_table.h",
    "src/game/ranged_table.cpp",
    "src/game/item_table.h",
    "src/game/item_def.h",
    "src/game/loot.h",
    "src/game/inventory.h",
]:
    p = root / rel
    if not p.exists():
        # glob
        hits = list((root / "src/game").glob(Path(rel).name))
        out.append(f"missing {rel} hits={hits}")
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    out.append(f"==== {rel} ({len(t)}) ====")
    for i, l in enumerate(t.splitlines(), 1):
        if any(
            k in l
            for k in (
                "equipped_ranged",
                "RangedDef",
                "magazine",
                "struct",
                "pistol",
                "Pistol",
                "PM",
                "AK",
                "give",
                "add_item",
                "inv_add",
                "inventory_add",
                "ItemId",
                "kFirst",
                "ammo",
            )
        ):
            out.append(f"{i}:{l.rstrip()[:140]}")

# combat.h equipped_ranged decl
h = (root / "src/game/combat.h").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(h.splitlines(), 1):
    if "equipped_ranged" in l or "ranged_for_item" in l:
        out.append(f"combat.h:{i}:{l.rstrip()[:140]}")

# how tests give gun
gt = (root / "tests/game_test.cpp").read_text(encoding="utf-8", errors="replace")
# find test_player_shoots region
idx = gt.find("test_player_shoots")
if idx < 0:
    idx = gt.find("magCount == def.magazine")
start = max(0, gt.rfind("\nvoid ", 0, idx) if idx > 0 else 0)
chunk = gt[start : start + 2500] if idx >= 0 else ""
out.append("==== shoot test chunk ====")
out.append(chunk[:2500])

# inventory helpers
for p in (root / "src/game").glob("*.h"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "inventory_add" in t or "inv_add" in t or "add_to_inventory" in t or "try_add" in t:
        out.append(f"inv helper in {p.name}")
        for i, l in enumerate(t.splitlines(), 1):
            if any(k in l for k in ("inventory_add", "inv_add", "add_to_inv", "try_add", "give_item", "add_item")):
                out.append(f"  {i}:{l.strip()[:120]}")

path = root / "shots/_probe_mag4_out.txt"
path.write_text("\n".join(out), encoding="utf-8")
print("WROTE", path, path.stat().st_size)
