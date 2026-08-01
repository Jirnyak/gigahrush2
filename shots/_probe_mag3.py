from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

# How PlayerRanged is attached / reload / equip
for rel in [
    "src/game/combat.cpp",
    "src/game/combat.h",
    "src/game/inventory.h",
    "src/game/inventory.cpp",
    "src/game/items.h",
]:
    p = root / rel
    if not p.exists():
        out.append(f"MISSING {rel}")
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    out.append(f"==== {rel} ====")
    for i, l in enumerate(t.splitlines(), 1):
        if any(
            k in l
            for k in (
                "PlayerRanged",
                "magCount",
                "equipped_ranged",
                "ranged_for_item",
                "reload",
                "magazine",
                "give_item",
                "equip",
                "kItem",
                "Pistol",
                "pistol",
                "Shotgun",
                "shotgun",
            )
        ):
            out.append(f"{i}:{l.rstrip()[:140]}")

# suite elevator mag pin
for rel in ["tests/game_test.cpp", "tests/suite_elevator.inl", "tests/suite_saveload.inl"]:
    p = root / rel
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    out.append(f"==== {rel} mag pins ====")
    for i, l in enumerate(t.splitlines(), 1):
        if "magCount" in l or "hadRanged" in l or "PlayerRanged" in l:
            out.append(f"{i}:{l.rstrip()[:140]}")

# prior magshot plan if any
for name in ["_probe_magshot_plan_out.txt", "_probe_magshot_impl_out.txt", "_probe_magshot_next_out.txt"]:
    p = root / "shots" / name
    if p.exists():
        out.append(f"==== prior {name} ====")
        out.append(p.read_text(encoding="utf-8", errors="replace")[:3000])

path = root / "shots/_probe_mag3_out.txt"
path.write_text("\n".join(out), encoding="utf-8")
print("WROTE", path, path.stat().st_size)
