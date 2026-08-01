from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8")
out = []

# includes at top
for i, l in enumerate(main.splitlines()[:200], 1):
    if l.startswith("#include"):
        out.append(f"{i}:{l}")

# Does combat.h pull ranged + inventory?
ch = (root / "src/game/combat.h").read_text(encoding="utf-8")
out.append("combat includes inventory: %s" % ("inventory" in ch))
out.append("combat includes ranged: %s" % ("ranged" in ch))
# Inventory via NpcPool?
np = (root / "src/game/npc_pool.h").read_text(encoding="utf-8")
out.append("npc_pool inventory: %s" % ("inventory" in np.lower()))

# mag branch present
out.append("mag action count: %d" % main.count('shotAction == "mag"'))
out.append("PROOF=GREEN count: %d" % main.count("PROOF=GREEN"))
out.append("magStamp count: %d" % main.count("magStamp"))

# setvbuf
gt = (root / "tests/game_test.cpp").read_text(encoding="utf-8")
out.append("setvbuf count: %d" % gt.count("setvbuf"))
idx = gt.find("int main()")
out.append(gt[idx : idx + 350])

# ItemSlot namespace - is it game::ItemSlot?
inv = (root / "src/game/inventory.h").read_text(encoding="utf-8")
out.append("==== inventory structs ====")
out.append(inv[:800])

# kItemCount
it = (root / "src/game/item_table.h").read_text(encoding="utf-8")
for i, l in enumerate(it.splitlines(), 1):
    if "kItemCount" in l:
        out.append(f"item_table:{i}:{l.strip()}")

path = root / "shots/_verify_mag_includes_out.txt"
path.write_text("\n".join(out), encoding="utf-8")
print("\n".join(out[:80]))
