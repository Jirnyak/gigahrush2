"""Locate ATTR1 / AGIMV / HUD / key / rpgcmbt shot sites."""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

def show(path, start, end, label=""):
    p = root / path
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"\n===== {path} {label} {start}-{end} =====")
    for i in range(start - 1, min(end, len(lines))):
        print(f"{i+1}|{lines[i]}")

# rpg API
rpg_h = (root / "src/game/rpg.h").read_text(encoding="utf-8", errors="replace").splitlines()
for i, ln in enumerate(rpg_h, 1):
    if "spend_attr" in ln or "agi_move" in ln or "struct RpgStats" in ln or "enum class Attr" in ln or "attrPoints" in ln:
        print(f"rpg.h:{i}|{ln}")

# main: keys, HUD, move, shot action
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
needles = [
    "spend_attr", "attrPoints", "RpgStats", "kPlayerWalkSpeed", "speedScale",
    "shotAction", "wantsAttack", "SDLK_1", "SDLK_2", "SDLK_3",
    "KEY_", "scancode", "justPressed", "level", "STR", "AGI",
    "PlayerNeeds", "status_speed", "walkSpeed",
]
hits = {n: [] for n in needles}
for i, ln in enumerate(main, 1):
    for n in needles:
        if n in ln:
            hits[n].append(i)

for n, xs in hits.items():
    if xs:
        print(f"main {n}: {xs[:20]}{'...' if len(xs)>20 else ''}")

# show move block
for i, ln in enumerate(main, 1):
    if "kPlayerWalkSpeed" in ln:
        show("src/app/main.cpp", max(1, i - 15), i + 25, "MOVE")
        break

# show HUD rpg block
for i, ln in enumerate(main, 1):
    if "attrPoints" in ln or ("LVL" in ln and "XP" in ln) or "STR" in ln and "AGI" in ln:
        show("src/app/main.cpp", max(1, i - 5), i + 40, "HUD")
        break

# key handling pattern - find existing digit or F-key handling near input
for i, ln in enumerate(main, 1):
    if "SDL_SCANCODE" in ln and ("1" in ln or "2" in ln or "3" in ln or "F5" in ln or "E" in ln):
        if i < 3500:
            print(f"scancode hit {i}|{ln.strip()[:120]}")

# shot action switch
for i, ln in enumerate(main, 1):
    if "shotAction" in ln and ("==" in ln or "compare" in ln):
        print(f"shotAction {i}|{ln.strip()[:140]}")

# combat melee dmg site for log
combat = (root / "src/game/combat.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, ln in enumerate(combat, 1):
    if "melee_damage" in ln or "swingDmg" in ln or "swingCd" in ln:
        print(f"combat.cpp:{i}|{ln.rstrip()}")

# proof plan tail
pp = root / "shots/_proof_plan_rpg.md"
if pp.exists():
    t = pp.read_text(encoding="utf-8", errors="replace")
    # strip bom
    if t.startswith("\ufeff"):
        t = t[1:]
    print("\n===== PROOF PLAN =====")
    print(t[:3500])
