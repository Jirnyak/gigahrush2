import time
import subprocess
from pathlib import Path

p = Path(__file__).resolve().parent / "_game_test_posrpg.txt"

for i in range(120):
    r = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq game_test.exe"],
        capture_output=True,
        text=True,
        encoding="oem",
        errors="replace",
    )
    alive = "game_test.exe" in r.stdout
    sz = p.stat().st_size if p.exists() else 0
    print(f"poll {i} alive={alive} size={sz}", flush=True)
    if not alive and i > 0:
        break
    time.sleep(5)

t = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
lines = t.splitlines()
print("DONE lines", len(lines), "size", p.stat().st_size if p.exists() else 0)
hits = [
    l
    for l in lines
    if "checks" in l.lower()
    or "FAIL" in l
    or "error C" in l
    or "possess" in l.lower()
    or "posrpg" in l.lower()
]
print("HITS", len(hits))
for h in hits[-40:]:
    print(h)
print("---TAIL---")
for l in lines[-20:]:
    print(l)
