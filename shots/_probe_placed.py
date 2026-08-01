#!/usr/bin/env python3
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
t = Path(r"C:\hades\gigahrush2\src\game\save.h").read_text(encoding="utf-8").splitlines()
# find PlacedCell struct
for i, l in enumerate(t):
    if "struct PlacedCell" in l or "PlacedCell {" in l or "struct PlacedCell" in l:
        for j in range(i, min(i + 40, len(t))):
            print(f"{j+1}|{t[j]}")
        break
else:
    for i, l in enumerate(t):
        if "PlacedCell" in l and ("struct" in l or "{" in l or "moved" in l or "ok" in l):
            print(f"{i+1}|{l}")
# also dump nearby comments
print("---")
for i, l in enumerate(t):
    if "PlacedCell" in l:
        print(f"{i+1}|{l}")
