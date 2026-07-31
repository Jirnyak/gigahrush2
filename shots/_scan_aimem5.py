# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
root = Path(r"C:\hades\gigahrush2")
main = (root/"src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()

# danger field wiring
print("=== danger ===")
for i,l in enumerate(main,1):
    if "danger" in l and ("Field" in l or "diffusion" in l or "activeGrid" in l or "const Field" in l or "danger =" in l or "*danger" in l or "danger," in l):
        if i < 1600 or (2150 < i < 2320):
            print(f"{i}:{l}")

print("\n=== shot action handling ===")
for i,l in enumerate(main,1):
    if "shotAction" in l or "--action" in l or 'action ==' in l:
        print(f"{i}:{l}")

print("\n=== existing shot harnesses ===")
for p in sorted((root/"shots").glob("_run_*.py")):
    print(p.name, p.stat().st_size)

print("\n=== build-win exe ===")
bw = root/"build-win"
if bw.exists():
    for p in bw.rglob("gigahrush*.exe"):
        print(p, p.stat().st_size, p.stat().st_mtime)
    for p in bw.rglob("game_test*.exe"):
        print(p, p.stat().st_size)

print("\n=== progress.md tail ===")
pr = root/".agents/worker_game_audit/progress.md"
if pr.exists():
    lines = pr.read_text(encoding="utf-8", errors="replace").splitlines()
    for l in lines[-40:]:
        print(l)

print("\n=== BACKLOG lines 1-40 ===")
bl = (root/".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace").splitlines()
for i,l in enumerate(bl[:50],1):
    print(f"{i}:{l}")

# ai.cpp memory remember path - what makes remembered > 0
print("\n=== ai.cpp remember/recall sites ===")
ai = (root/"src/game/ai.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i,l in enumerate(ai,1):
    if any(k in l for k in ("remember", "recalled", "memoryFled", "useMem", "MemDanger", "MemHurt")):
        print(f"{i}:{l}")
