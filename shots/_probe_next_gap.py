# -*- coding: utf-8 -*-
"""Probe POSRPG / SAVMAG / samosbor wire gaps after SAVRPG 6a60f5d."""
from __future__ import annotations
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"C:\hades\gigahrush2")

def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8", errors="replace")

def lines_of(rel: str):
    return read(rel).splitlines()

def dump_hits(rel: str, pats: list[str], ctx: int = 2):
    ls = lines_of(rel)
    print(f"\n=== {rel} ===")
    for i, ln in enumerate(ls, 1):
        for p in pats:
            if p in ln:
                lo = max(1, i - ctx)
                hi = min(len(ls), i + ctx)
                print(f"-- hit '{p}' @{i} --")
                for j in range(lo, hi + 1):
                    mark = ">" if j == i else " "
                    print(f"{mark}{j:5d}|{ls[j-1]}")
                break

def struct_block(rel: str, name: str, max_lines: int = 80):
    ls = lines_of(rel)
    print(f"\n=== struct {name} in {rel} ===")
    for i, ln in enumerate(ls):
        if re.search(rf"\bstruct\s+{name}\b", ln):
            for j in range(i, min(len(ls), i + max_lines)):
                print(f"{j+1:5d}|{ls[j]}")
                if j > i and ls[j].strip().startswith("};"):
                    break
            return
    print("(not found)")

def main():
    print("HEAD probe POSRPG/SAVMAG/samosbor")

    # --- PlayerRanged / PlayerMelee layout ---
    for rel in [
        "src/game/combat.h",
        "src/game/ranged.h",
        "src/game/weapon.h",
        "src/ecs/components.h",
        "src/game/shooter.h",
    ]:
        p = ROOT / rel
        if p.exists():
            dump_hits(rel, ["PlayerRanged", "PlayerMelee", "struct Player", "mag", "ammo"])

    # Find where PlayerRanged is defined
    print("\n=== find PlayerRanged definition ===")
    for p in (ROOT / "src").rglob("*.h"):
        t = p.read_text(encoding="utf-8", errors="replace")
        if re.search(r"struct\s+PlayerRanged\b", t):
            rel = str(p.relative_to(ROOT)).replace("\\", "/")
            print(f"FOUND {rel}")
            struct_block(rel, "PlayerRanged")
            struct_block(rel, "PlayerMelee")

    # --- save wire: any ranged/melee? ---
    dump_hits("src/game/save.h", ["Ranged", "Melee", "mag", "weapon", "kSaveVersion", "SaveState", "kRpgWire"])
    dump_hits("src/game/save.cpp", ["Ranged", "Melee", "visit_rpg", "visit_player", "craft_"])

    # --- main possess / F5 / F9 / carriedRpg ---
    dump_hits("src/app/main.cpp", [
        "possessWanted", "possess_nearest", "carriedRpg", "carriedRanged",
        "PlayerRanged", "PlayerMelee", "runState.rpg", "runState.craft",
        "embody_as_player", "fresh_rpg", "random_rpg", "save_run_now",
        "F5", "F9", "samosbor",
    ], ctx=3)

    # --- elevator for comparison ---
    dump_hits("src/game/elevator.cpp", [
        "PlayerRanged", "PlayerMelee", "RpgStats", "hadRpg", "hadRanged", "hadMelee",
    ], ctx=2)

    # --- embody ---
    dump_hits("src/game/embody.cpp", [
        "RpgStats", "PlayerRanged", "PlayerMelee", "random_rpg", "fresh_rpg",
    ], ctx=2)
    dump_hits("src/game/embody.h", [
        "RpgStats", "PlayerRanged", "PlayerMelee", "random_rpg", "fresh_rpg",
    ], ctx=2)

    # --- samosbor wire in main ---
    dump_hits("src/app/main.cpp", ["samosbor_", "Samosbor", "samosbor."], ctx=1)
    dump_hits("src/game/samosbor.h", ["samosbor_step", "struct Samosbor", "depth"], ctx=1)

    # --- BACKLOG open ---
    bl = read(".agents/worker_game_audit/BACKLOG.md")
    print("\n=== BACKLOG OPEN rows ===")
    for ln in bl.splitlines():
        if "OPEN" in ln.upper() or ln.strip().startswith("|"):
            if any(x in ln for x in ("OPEN", "MAGSHOT", "POSRPG", "SAVMAG", "P1", "P2", "P3", "CLOSED")):
                print(ln)

    # --- death vs voluntary possess windows ---
    ls = lines_of("src/app/main.cpp")
    print("\n=== main.cpp possess / death windows ===")
    for i, ln in enumerate(ls, 1):
        if any(k in ln for k in ("possessWanted", "possess_nearest_survivor", "carriedRpg",
                                  "embody_as_player", "DEATH", "death", "on_death")):
            if "possess" in ln.lower() or "carriedRpg" in ln or "embody_as_player" in ln or "DEATH" in ln or "on_death" in ln:
                print(f"{i:5d}|{ln}")

if __name__ == "__main__":
    main()
