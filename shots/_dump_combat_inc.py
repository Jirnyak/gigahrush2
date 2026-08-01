from pathlib import Path
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

out = []
ch = Path(r"C:/hades/gigahrush2/src/game/combat.h").read_text(encoding="utf-8", errors="replace")
out.append("=== combat.h includes / PlayerRanged / ranged ===")
for i, line in enumerate(ch.splitlines(), 1):
    if "include" in line or "PlayerRanged" in line or "ranged" in line.lower() or "RangedDef" in line:
        out.append(f"{i}: {line}")

# who provides ranged_for_item
for root, dirs, files in os.walk(r"C:/hades/gigahrush2/src"):
    for f in files:
        if f.endswith((".h", ".hpp", ".cpp")):
            p = Path(root) / f
            try:
                t = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            if "ranged_for_item" in t and f.endswith(".h"):
                out.append(f"ranged_for_item in HEADER: {p}")
            if "struct RangedDef" in t or "struct ItemSlot" in t:
                out.append(f"def in: {p}")

# inventory.h / item_table chain from combat
for name in ["inventory.h", "item_table.h", "ranged_table.h", "weapon_table.h"]:
    p = Path(r"C:/hades/gigahrush2/src/game") / name
    out.append(f"exists {name}: {p.exists()}")
    if p.exists():
        t = p.read_text(encoding="utf-8", errors="replace")
        for i, line in enumerate(t.splitlines()[:80], 1):
            if "include" in line or "ranged_for_item" in line or "RangedDef" in line or "ItemSlot" in line or "kItemCount" in line:
                out.append(f"  {name}:{i}: {line}")

# full mag branch
main = Path(r"C:/hades/gigahrush2/src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
i = main.find('shotAction == "mag"')
j = main.find('shotAction == "attack"')  # next branch maybe
out.append(f"\n=== mag branch start {i} ===")
if i >= 0:
    # find end of mag block roughly - next else if shotAction
    rest = main[i:]
    # take until we hit "} else if (shotAction" after the mag block
    end = rest.find('} else if (shotAction')
    if end < 0:
        end = 2500
    out.append(rest[: end + 30])

# FINAL proof context
k = main.find("[mag] PROOF")
out.append(f"\n=== proof context {k} ===")
if k >= 0:
    out.append(main[k - 500 : k + 350])

text = "\n".join(out)
Path(r"C:/hades/gigahrush2/shots/_dump_combat_inc_out.txt").write_text(text, encoding="utf-8")
print(text)
