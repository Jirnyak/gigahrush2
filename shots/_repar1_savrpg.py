# -*- coding: utf-8 -*-
from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

root = Path(r"C:\hades\gigahrush2")
main = root / "src" / "app" / "main.cpp"
t = main.read_text(encoding="utf-8", errors="replace")
lines = t.splitlines()
print("lines", len(lines), "bytes", len(t.encode("utf-8")))

keys = [
    "place_body_safely",
    "ai_release",
    "combatCarves",
    "playerStatus",
    "status_step",
    "ctl->fly",
    "shotAction",
    "runState.rpg",
    "runState.craft",
    "carriedRpg",
    "crafting = runState",
    "save_run_now",
]

for k in keys:
    hits = [i + 1 for i, l in enumerate(lines) if k in l]
    extra = "..." if len(hits) > 12 else ""
    print(f"{k}: {hits[:12]}{extra} n={len(hits)}")

# elevator FOR1/MAG1/RPG1 still present?
el = (root / "src" / "game" / "elevator.cpp").read_text(encoding="utf-8", errors="replace")
for k in ["hadRpg", "hadRanged", "hadMelee", "emplace_or_replace"]:
    print(f"elevator {k}: {el.count(k)}")

# save version
sh = (root / "src" / "game" / "save.h").read_text(encoding="utf-8", errors="replace")
for line in sh.splitlines():
    if "kSaveVersion" in line or "kSaveFixedWire" in line or "kRpgWire" in line:
        print("save.h:", line.strip()[:100])

pbs = [i + 1 for i, l in enumerate(lines) if "place_body_safely" in l]
air = [i + 1 for i, l in enumerate(lines) if "ai_release" in l]
ok = len(pbs) >= 2 and len(air) >= 2 and "runState.rpg" in t and "runState.craft" in t
print("GATE", "GREEN" if ok else "RED", "pbs", pbs, "ai_release", air)

