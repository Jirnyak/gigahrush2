# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

root = Path(r"C:\hades\gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()

# Find travel / unload / streamer / ai includes / finish_floor
keys = ["streamer.", "travel(", "unload(", "keep_only", "ai_release", "finish_floor_nav",
        "include \"game/ai", "aiCfg", "AiMemory", "prevLayer", "oldLayer", "leaving"]
print("=== KEY HITS ===")
for i, l in enumerate(main, 1):
    if any(k in l for k in keys):
        print(f"{i}:{l}")

print("\n=== WINDOW around travel/ride floor change ~3300-3500 not load ===")
# find streamer.travel
for i, l in enumerate(main, 1):
    if "streamer.travel" in l or "streamer.keep_only" in l or "streamer.unload" in l:
        lo, hi = max(0, i-15), min(len(main), i+40)
        print(f"\n--- around {i} ---")
        for j in range(lo, hi):
            print(f"{j+1}|{main[j]}")

print("\n=== BACKLOG full AIMEM section ===")
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(bl.splitlines(), 1):
    if "AIMEM" in l or "AiMemory" in l or "ai_release" in l or "ai_step" in l:
        print(f"{i}:{l}")

print("\n=== includes top of main ===")
for i, l in enumerate(main[:120], 1):
    if "include" in l and ("ai" in l.lower() or "floor" in l.lower() or "embody" in l.lower()):
        print(f"{i}:{l}")

print("\n=== finish_floor_nav full ===")
for i in range(1054, 1068):
    print(f"{i}|{main[i-1]}")

print("\n=== ai_step call + surrounding 2288-2310 ===")
for i in range(2288, 2312):
    print(f"{i}|{main[i-1]}")

print("\n=== HUD ai section 3905-3930 ===")
for i in range(3905, 3935):
    print(f"{i}|{main[i-1]}")

print("\n=== floor change ~4660-4720 ===")
for i in range(4660, 4720):
    print(f"{i}|{main[i-1]}")

# floor_stream unload - does it have ai include?
fs = (root / "src/game/floor_stream.cpp").read_text(encoding="utf-8", errors="replace")
print("\n=== floor_stream includes ===")
for i, l in enumerate(fs.splitlines()[:30], 1):
    print(f"{i}:{l}")

print("\n=== embody fold_back ===")
emb = (root / "src/game/embody.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(emb, 1):
    if "fold_back" in l or "AiBrain" in l or "ai_" in l:
        print(f"{i}:{l}")
# print fold_back body
for i, l in enumerate(emb, 1):
    if l.startswith("void fold_back"):
        for j in range(i-1, min(len(emb), i+40)):
            print(f"{j+1}|{emb[j]}")
        break

print("\n=== AiMemory forget on death? suite notes ===")
# check if main has any death forget
for i, l in enumerate(main, 1):
    if "forget" in l.lower() and "mem" in l.lower():
        print(f"{i}:{l}")
