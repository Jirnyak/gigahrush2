"""Poll until game_test finishes; print MELEEGRID + summary."""
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
LOG = ROOT / "shots" / "_game_test_meleegrid2.txt"


def running() -> bool:
    r = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq game_test.exe"],
        capture_output=True,
        text=True,
        errors="replace",
    )
    return "game_test.exe" in r.stdout


t0 = time.time()
print(f"await start running={running()}", flush=True)
while running() and time.time() - t0 < 600:
    time.sleep(15)
    sz = LOG.stat().st_size if LOG.exists() else 0
    print(f"  wait {time.time() - t0:.0f}s size={sz}", flush=True)

still = running()
print(f"await end running={still}", flush=True)
if still:
    subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)
    print("TIMEOUT killed", flush=True)
    sys.exit(2)

time.sleep(2)
t = LOG.read_text(encoding="utf-8", errors="replace") if LOG.exists() else ""
print(f"size={len(t)}", flush=True)
for line in t.splitlines():
    if "MELEEGRID" in line or "game_test:" in line or "FAIL" in line:
        print(line, flush=True)
print("---TAIL---", flush=True)
print("\n".join(t.splitlines()[-40:]), flush=True)
m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", t)
print("RESULT", m.groups() if m else None, flush=True)
sys.exit(0 if m and m.group(2) == "0" else 1)
