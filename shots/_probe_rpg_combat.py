# Probe RPG mults + combat apply sites
from pathlib import Path

def show(path, keys, ctx=3):
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"\n===== {path} ({len(lines)} lines) =====")
    for i, l in enumerate(lines, 1):
        if any(k in l for k in keys):
            lo, hi = max(1, i - ctx), min(len(lines), i + ctx)
            print(f"--- @{i} ---")
            for j in range(lo, hi + 1):
                mark = ">>>" if j == i else "   "
                print(f"{mark}{j}: {lines[j-1]}")

show(r"C:\hades\gigahrush2\src\game\rpg.h", [
    "melee_damage", "str_melee", "agi_attack", "agi_ranged", "str_heavy",
    "mult_e3", "Attr::",
])
show(r"C:\hades\gigahrush2\src\game\rpg.cpp", [
    "melee_damage", "str_melee_dmg_mult_e3", "agi_attack_speed_mult_e3",
    "agi_ranged_spread_mult_e3", "str_heavy_weapon_speed_mult_e3",
])
show(r"C:\hades\gigahrush2\src\game\combat.cpp", [
    "player_melee_step", "player_ranged_step", "wp->dmg", "melee_damage",
    "cooldownMs", "spreadE4", "def->dmg", "def->spread", "def->cooldown",
    "cdMs", "held", "unarmed_melee",
])

# Find test pins
import os
root = Path(r"C:\hades\gigahrush2\tests")
print("\n===== test mentions =====")
for p in root.rglob("*"):
    if p.suffix not in {".cpp", ".inl", ".h"}:
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    hits = []
    for k in ["melee_damage", "str_melee_dmg", "agi_attack_speed", "agi_ranged_spread",
              "str_heavy", "RpgStats", "player_melee", "player_ranged"]:
        if k in t:
            hits.append(k)
    if hits:
        print(f"{p.name}: {hits}")
