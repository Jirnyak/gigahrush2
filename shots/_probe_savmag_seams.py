# probe SAVMAG seams
from pathlib import Path
root = Path(r"C:/hades/gigahrush2")

def show(path, needles, ctx=2):
    p = root / path
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"=== {path} ===")
    for i, l in enumerate(lines, 1):
        if any(n in l for n in needles):
            for j in range(max(1, i - ctx), min(len(lines), i + ctx) + 1):
                print(f"{j:5}|{lines[j-1]}")
            print("---")

show("src/game/combat.h", ["struct PlayerRanged", "struct PlayerMelee", "ItemId weapon"])
show("src/game/item_table.h", ["using ItemId", "kInvalidItem", "ItemId"], 1)

p = root / "tests/suite_saveload.inl"
lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
print("=== suite_saveload key blocks ===")
for i, l in enumerate(lines, 1):
    if any(x in l for x in [
        "Version 7", "SaveState busy_run", "void same_run", "void wire_layout",
        "kSaveFixedWire", "save_bytes_for", "st.rpg", "st.craft", "CHECK(a.rpg",
        "CHECK(a.craft", "include \"game/craft", "include \"game/rpg",
    ]):
        lo = max(1, i - 1)
        hi = min(len(lines), i + 12)
        for j in range(lo, hi + 1):
            print(f"{j:5}|{lines[j-1]}")
        print("---")

# main F5/F9 and kills
show("src/app/main.cpp", [
    "std::uint32_t kills",
    "carriedRpg",
    "runState.rpg",
    "runState.craft",
    "Version 7",
    "possessWanted",
])

# elevator ranged restore pattern
show("src/game/elevator.cpp", ["hadRanged", "PlayerRanged", "hadMelee", "hadRpg"])

print("DONE")
