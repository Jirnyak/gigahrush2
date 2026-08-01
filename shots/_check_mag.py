from pathlib import Path

t = Path(r"C:/hades/gigahrush2/src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
keys = [
    'shotAction == "mag"',
    "[mag] FORCE",
    "[mag] RIDE",
    "[mag] PROOF",
    "magStamp",
    "PlayerRanged",
    "ranged_for_item",
    "kItemCount",
    "ItemSlot",
]
for k in keys:
    print(k, "YES" if k in t else "NO")
print("bytes", len(t))
i = t.find('shotAction == "mag"')
print("mag_at", i)
if i >= 0:
    snip = t[i : i + 2200]
    Path(r"C:/hades/gigahrush2/shots/_mag_snip.txt").write_text(snip, encoding="utf-8")
    print("snip_written")
    # also find FINAL proof
j = t.find("[mag] PROOF")
print("proof_at", j)
if j >= 0:
    Path(r"C:/hades/gigahrush2/shots/_mag_proof_snip.txt").write_text(t[j - 200 : j + 400], encoding="utf-8")

gt = Path(r"C:/hades/gigahrush2/tests/game_test.cpp").read_text(encoding="utf-8", errors="replace")
print("setvbuf_gt", "setvbuf" in gt)
si = gt.find("setvbuf")
if si >= 0:
    print(gt[max(0, si - 80) : si + 120])

# includes needed?
need = []
for h in ["ranged_table.h", "item_table.h", "inventory"]:
    print("include", h, "YES" if h in t[:5000] else "NO")

# combat.h exposure
ch = Path(r"C:/hades/gigahrush2/src/game/combat.h").read_text(encoding="utf-8", errors="replace")
print("combat_has_PlayerRanged", "PlayerRanged" in ch)
print("combat_includes_ranged", "ranged" in ch.lower())
for line in ch.splitlines()[:40]:
    if "include" in line or "PlayerRanged" in line:
        print("CH:", line)
