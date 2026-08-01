import pathlib
import re

files = [
    "src/game/combat.h",
    "src/game/melee_table.h",
    "src/game/ranged_table.h",
    "tests/suite_rpg.inl",
    "CMakeLists.txt",
    ".agents/worker_game_audit/BACKLOG.md",
]

for p in files:
    path = pathlib.Path(p)
    if not path.exists():
        print("MISSING", p)
        continue
    t = path.read_text(encoding="utf-8", errors="replace")
    print("=====", p, "lines", t.count("\n") + 1)
    if p.endswith("combat.h"):
        for pat in [
            "struct PlayerMelee",
            "struct PlayerRanged",
            "player_melee_step",
            "player_ranged_step",
        ]:
            i = t.find(pat)
            if i >= 0:
                print("---", pat, "@", t[:i].count("\n") + 1)
                print(t[i : i + 500])
                print("---")
    if p.endswith("melee_table.h"):
        for pat in ["struct MeleeDef", "unarmed_melee", "cooldownMs", "kMelee"]:
            i = t.find(pat)
            if i >= 0:
                print("---", pat)
                print(t[max(0, i - 80) : i + 350])
                print("---")
    if p.endswith("ranged_table.h"):
        for pat in ["struct RangedDef", "spreadE4", "cooldownMs"]:
            i = t.find(pat)
            if i >= 0:
                print("---", pat)
                print(t[max(0, i - 40) : i + 400])
                print("---")
    if p.endswith("suite_rpg.inl"):
        lines = t.splitlines()
        print("LAST 80:")
        for j, l in enumerate(lines[-80:], start=len(lines) - 79):
            print(f"{j}|{l}")
        # also show formula test section around melee_damage checks
        print("MELEE FORMULA SECTION:")
        for j, l in enumerate(lines, 1):
            if "melee_damage" in l or "agi_attack" in l or "agi_ranged" in l or "str_heavy" in l:
                print(f"{j}|{l}")
    if p.endswith("CMakeLists.txt"):
        for j, l in enumerate(t.splitlines(), 1):
            if "PASS_REGULAR" in l or ("219" in l and "game" in l.lower()):
                print(f"{j}|{l}")
    if p.endswith("BACKLOG.md"):
        print(t[:3000])
        print("---TAIL---")
        print(t[-2500:])
