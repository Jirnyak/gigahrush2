# -*- coding: utf-8 -*-
"""Find next real work after MAGSHOT close."""
from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

root = Path(r"C:\hades\gigahrush2")
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
pr = (root / ".agents/worker_game_audit/progress.md").read_text(encoding="utf-8", errors="replace")

print("=== OPEN section (first 80 lines after OPEN) ===")
idx = bl.find("## OPEN")
if idx >= 0:
    chunk = bl[idx:idx+2500]
    print(chunk)

print("\n=== Last CLOSED section ===")
# last CLOSED heading
import re
closes = list(re.finditer(r"^## CLOSED.*$", bl, re.M))
if closes:
    c = closes[-1]
    print(bl[c.start():c.start()+1200])

print("\n=== progress last 60 lines ===")
print("\n".join(pr.splitlines()[-60:]))

# jirnyak dirty?
import subprocess
st = subprocess.check_output(["git","-C",str(root),"status","--short"], text=True, errors="replace")
print("\n=== git status (tracked mods only) ===")
for L in st.splitlines():
    if L.startswith(" M") or L.startswith("M ") or L.startswith("MM"):
        print(L)
