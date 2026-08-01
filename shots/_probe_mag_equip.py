from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
lines = main.splitlines()
out = []

# How guns get on player in shot/rpgcmbt
out.append("==== gun equip / PlayerRanged create ====")
for i, line in enumerate(lines):
    if any(k in line for k in ["PlayerRanged", "equip_gun", "try_equip", "magazine", "ItemId::", "give_item", "inv_add", "weapon"]):
        if any(k in line for k in ["PlayerRanged", "equip", "magazine", "ranged", "Gun", "pistol", "shotgun", "magCount", "inv_add", "ItemId"]):
            out.append(f"{i+1}:{line.rstrip()[:180]}")

# rpgcmbt action full
out.append("\n==== rpgcmbt action ====")
for i, line in enumerate(lines):
    if 'shotAction == "rpgcmbt"' in line:
        for j in range(i, min(len(lines), i + 80)):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")
        break

# combat_try_fire or fire key path
out.append("\n==== fire API in main ====")
for i, line in enumerate(lines):
    if "try_fire" in line or "ranged_fire" in line or "fire_ranged" in line or "combat_fire" in line:
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# combat.h PlayerRanged
ch = (root / "src/game/combat.h").read_text(encoding="utf-8", errors="replace")
out.append("\n==== combat.h PlayerRanged / fire ====")
for i, line in enumerate(ch.splitlines(), 1):
    if "PlayerRanged" in line or "ranged_" in line or "magCount" in line or "try_fire" in line or "fire_" in line:
        out.append(f"{i}:{line[:180]}")

# inventory gun ids
out.append("\n==== item gun ids ====")
for p in ["src/game/items.h", "src/game/inventory.h", "src/game/loot.h"]:
    t = (root / p).read_text(encoding="utf-8", errors="replace") if (root / p).exists() else ""
    for i, line in enumerate(t.splitlines(), 1):
        if any(k in line.lower() for k in ["pistol", "gun", "rifle", "shotgun", "revolver", "pm_", "ak_"]):
            out.append(f"{p}:{i}:{line[:160]}")

# elevator ride preserve ranged - already know
out.append("\n==== elevator ride_player signature ====")
eh = (root / "src/game/elevator.h").read_text(encoding="utf-8", errors="replace")
for i, line in enumerate(eh.splitlines(), 1):
    if "ride" in line.lower() or "PlayerRanged" in line:
        out.append(f"{i}:{line[:180]}")

# suite that checks mag across ride
out.append("\n==== suite mag ride ====")
for p in (root / "tests").glob("*.inl"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "magCount" in t and ("ride" in t.lower() or "elevator" in t.lower()):
        out.append(f"FILE {p.name}")
        for i, line in enumerate(t.splitlines(), 1):
            if "magCount" in line or ("PlayerRanged" in line and "CHECK" in line):
                out.append(f"  {i}:{line[:160]}")

Path(r"C:/hades/gigahrush2/shots/_probe_mag_equip_out.txt").write_text("\n".join(out), encoding="utf-8")
print("ok")
