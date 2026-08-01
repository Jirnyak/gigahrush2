# Find how player HP is accessed for award_xp / spend_attr wiring
from pathlib import Path

def grep(path, needles, ctx=3):
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"\n===== {path} =====")
    for i, l in enumerate(lines, 1):
        if any(n in l for n in needles):
            for j in range(max(0, i - 1 - ctx), min(len(lines), i + ctx)):
                m = ">>" if j + 1 == i else "  "
                print(f"{m}{j+1}|{lines[j]}")
            print("---")

grep("src/game/combat.cpp", ["award_xp", "max_hp", "pool.hp", "hp(", "&hp"], 4)
grep("src/app/main.cpp", ["award_xp", "pool.hp", "maxHp", "npc_hp", ".hp", "set_hp"], 2)
grep("src/game/npc_pool.h", ["hp", "maxHp", "health"], 2)
# find NpcPool hp accessors
for p in ["src/game/npc.h", "src/game/npcs.h", "src/game/pool.h", "src/game/npc_pool.h"]:
    if Path(p).exists():
        print("exists", p)
        grep(p, ["hp", "max_hp", "Health", "int16"], 1)

# search files
import os
for root, dirs, files in os.walk("src/game"):
    for f in files:
        if f.endswith((".h", ".cpp")):
            path = os.path.join(root, f)
            t = Path(path).read_text(encoding="utf-8", errors="replace")
            if "class NpcPool" in t or "NpcPool::" in t and "hp" in t:
                if "hp" in t.lower():
                    for i, l in enumerate(t.splitlines(), 1):
                        if "hp" in l.lower() and ("int16" in l or "Hp" in l or "HP" in l or "hp(" in l or "hp_" in l or "m_hp" in l or "health" in l.lower()):
                            print(f"{path}:{i}|{l}")

# also MobRef hp
grep("src/game/components.h", ["struct MobRef", "struct Health", "hp", "maxHp"], 5)
grep("src/ecs", ["struct Health", "hp"], 2)

# combat finalize award_xp
cl = Path("src/game/combat.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(cl, 1):
    if "award_xp" in l:
        for j in range(max(0, i - 15), min(len(cl), i + 20)):
            print(f"award@{j+1}|{cl[j]}")
        print("---")

# console.cpp kRequestRows full
cc = Path("src/game/console.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(cc, 1):
    if "kRequestRows" in l or "RequestRow" in l:
        for j in range(i - 1, min(len(cc), i + 40)):
            print(f"cr:{j+1}|{cc[j]}")
        print("---")

# combat block full after swing scale
for j in range(1220, min(len(cl), 1240)):
    print(f"c:{j+1}|{cl[j]}")

# BACKLOG head for format
bl = Path(".agents/worker_game_audit/BACKLOG.md")
if bl.exists():
    lines = bl.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, l in enumerate(lines[:80], 1):
        print(f"bl:{i}|{l}")
    # find RPGCMBT closed
    for i, l in enumerate(lines, 1):
        if "RPGCMBT" in l or "ATTR1" in l or "AGIMV" in l or "SAVRPG" in l:
            print(f"blhit:{i}|{l}")
