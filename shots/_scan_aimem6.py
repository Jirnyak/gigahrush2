# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
root = Path(r"C:\hades\gigahrush2")
main = (root/"src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()

print("=== --ride handling ===")
for i,l in enumerate(main,1):
    if "shotRide" in l or "rideLeft" in l or "--ride" in l or "rideFrames" in l:
        print(f"{i}:{l}")

print("\n=== shot end / capture ===")
for i,l in enumerate(main,1):
    if "shotPath" in l and ("frame" in l.lower() or "png" in l.lower() or "capture" in l.lower() or "frames" in l):
        if 1100 < i < 1300 or 4700 < i < 4790 or 2100 < i < 2200:
            print(f"{i}:{l}")

# print window 1160-1220 and 4620-4670
print("\n=== 1160-1220 ===")
for i in range(1160, 1225):
    print(f"{i}|{main[i-1]}")

print("\n=== simTick declaration ===")
for i,l in enumerate(main,1):
    if "simTick" in l and ("=" in l or "uint" in l) and i < 1800:
        print(f"{i}:{l}")
