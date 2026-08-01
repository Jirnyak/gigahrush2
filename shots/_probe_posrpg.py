# -*- coding: utf-8 -*-
"""Deep probe POSRPG voluntary possess + PlayerRanged layout + elevator mirror."""
from __future__ import annotations
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"C:\hades\gigahrush2")

def main():
    print("=== PlayerRanged / PlayerMelee definitions + key uses ===")
    for p in list((ROOT / "src").rglob("*.h")) + list((ROOT / "src").rglob("*.cpp")) + list((ROOT / "tests").rglob("*")):
        if p.suffix not in {".h", ".hpp", ".cpp", ".inl", ".cc"}:
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        if "PlayerRanged" not in t and "PlayerMelee" not in t:
            continue
        rel = str(p.relative_to(ROOT)).replace("\\", "/")
        ls = t.splitlines()
        for i, ln in enumerate(ls, 1):
            if "PlayerRanged" in ln or "PlayerMelee" in ln:
                print(f"{rel}:{i}:{ln.rstrip()[:180]}")

    print("\n=== elevator.cpp body-swap window (Rpg/Ranged/Melee) ===")
    elev = (ROOT / "src/game/elevator.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
    for i, ln in enumerate(elev, 1):
        if any(k in ln for k in ("RpgStats", "PlayerRanged", "PlayerMelee", "hadRpg", "hadRanged", "hadMelee", "carry", "emplace")):
            lo = max(0, i - 3)
            hi = min(len(elev), i + 2)
            print(f"-- @{i} --")
            for j in range(lo, hi):
                m = ">" if j + 1 == i else " "
                print(f"{m}{j+1:4d}|{elev[j]}")

    print("\n=== embody.cpp RpgStats attach ===")
    emb = (ROOT / "src/game/embody.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
    for i, ln in enumerate(emb, 1):
        if any(k in ln for k in ("RpgStats", "random_rpg", "fresh_rpg", "PlayerRanged", "PlayerMelee")):
            lo = max(0, i - 2)
            hi = min(len(emb), i + 3)
            print(f"-- @{i} --")
            for j in range(lo, hi):
                m = ">" if j + 1 == i else " "
                print(f"{m}{j+1:4d}|{emb[j]}")

    print("\n=== main.cpp death + possess windows full ===")
    main_ls = (ROOT / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
    # print windows around key lines
    for center in (1677, 1838, 3146, 3383, 3544, 3766, 3778):
        lo = max(0, center - 15)
        hi = min(len(main_ls), center + 20)
        print(f"\n---- main.cpp ~{center} ----")
        for j in range(lo, hi):
            print(f"{j+1:5d}|{main_ls[j]}")

    print("\n=== F5/F9 rpg+craft capture ===")
    for i, ln in enumerate(main_ls, 1):
        if "runState.rpg" in ln or "runState.craft" in ln or "save_run_now" in ln or "kills" in ln and "PlayerMelee" in ln:
            print(f"{i:5d}|{ln}")

    # Does possess_nearest keep old body's RpgStats? It moves camera only - survivor may lack RpgStats
    print("\n=== Does possess_a_survivor / nearest stamp weapons/rpg? ===")
    for name in ("possess_a_survivor", "possess_nearest_survivor"):
        for i, ln in enumerate(main_ls, 1):
            if f"Entity {name}" in ln or (name in ln and "player =" in ln):
                print(f"{i:5d}|{ln}")

    # suite pins for possess?
    print("\n=== tests mentioning possess / carriedRpg ===")
    for p in (ROOT / "tests").rglob("*"):
        if p.suffix not in {".inl", ".cpp", ".h"}:
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        if "possess" in t.lower() or "carriedRpg" in t or "PlayerRanged" in t:
            rel = str(p.relative_to(ROOT)).replace("\\", "/")
            for i, ln in enumerate(t.splitlines(), 1):
                if any(k in ln for k in ("possess", "carriedRpg", "PlayerRanged", "PlayerMelee", "mag")):
                    print(f"{rel}:{i}:{ln.rstrip()[:160]}")

if __name__ == "__main__":
    main()
