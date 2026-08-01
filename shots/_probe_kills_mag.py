# -*- coding: utf-8 -*-
"""kills sync + F5 PlayerRanged + design comments around possession."""
from __future__ import annotations
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"C:\hades\gigahrush2")
main = (ROOT / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()

print("=== main.cpp kills assignments / HUD / mag ===")
for i, ln in enumerate(main, 1):
    if "kills" in ln or "magCount" in ln or "PlayerRanged" in ln or "shotsFired" in ln:
        # filter noise
        if any(k in ln for k in ("kills", "magCount", "PlayerRanged", "prs", "pm->", "pm.")):
            print(f"{i:5d}|{ln}")

print("\n=== combat.h PlayerRanged comment (full) ===")
ch = (ROOT / "src/game/combat.h").read_text(encoding="utf-8", errors="replace").splitlines()
for i in range(314, 335):
    print(f"{i+1:5d}|{ch[i]}")

print("\n=== suite_saveload RpgStats pins (for SAVMAG pattern) ===")
sl = (ROOT / "tests/suite_saveload.inl").read_text(encoding="utf-8", errors="replace").splitlines()
for i, ln in enumerate(sl, 1):
    if any(k in ln for k in ("rpg", "craft", "version", "kSaveVersion", "busy_run", "wire_layout", "PlayerRanged", "mag")):
        print(f"{i:5d}|{ln}")

print("\n=== CMake game_test pin ===")
cm = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8", errors="replace")
for i, ln in enumerate(cm.splitlines(), 1):
    if "219546" in ln or "game_test" in ln and "checks" in ln:
        print(f"{i:5d}|{ln}")

print("\n=== BACKLOG end (CLOSED SAVRPG + OPEN) ===")
bl = (ROOT / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace").splitlines()
for i, ln in enumerate(bl, 1):
    if "SAVRPG" in ln or "MAGSHOT" in ln or "Next OPEN" in ln or "POSRPG" in ln or "SAVMAG" in ln:
        print(f"{i:5d}|{ln}")

# death does NOT restore mag - intentional?
print("\n=== death path: does it touch PlayerRanged? ===")
for i in range(3755, 3786):
    print(f"{i+1:5d}|{main[i]}")

print("\n=== F5 save_run_now full block ===")
for i in range(1814, 1860):
    print(f"{i+1:5d}|{main[i]}")

print("\n=== F9 load rpg restore block ===")
for i in range(3520, 3560):
    print(f"{i+1:5d}|{main[i]}")

# Does survivor NPC have RpgStats when possessed voluntarily?
print("\n=== who attaches RpgStats? ===")
for p in (ROOT / "src").rglob("*.cpp"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "RpgStats" not in t:
        continue
    rel = str(p.relative_to(ROOT)).replace("\\", "/")
    for i, ln in enumerate(t.splitlines(), 1):
        if "RpgStats" in ln and any(k in ln for k in ("emplace", "get_or_emplace", "random_rpg", "fresh_rpg")):
            print(f"{rel}:{i}:{ln.strip()[:160]}")
