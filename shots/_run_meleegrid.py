# Build game_test via build-win (VS2022), run full suite, capture MELEEGRID + summary.
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
LOG = ROOT / "shots" / "_game_test_meleegrid2.txt"
BUILD = ROOT / "build-win"
BAD = ROOT / "build"

# Drop the accidental Ninja tree without a compiler (created this session).
if BAD.exists() and (BAD / "CMakeCache.txt").exists():
    cache = (BAD / "CMakeCache.txt").read_text(encoding="utf-8", errors="replace")
    if "CMAKE_CXX_COMPILER-NOTFOUND" in cache or "Ninja" in cache:
        print("removing broken build/", flush=True)
        shutil.rmtree(BAD, ignore_errors=True)

def run(cmd):
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=str(ROOT))

r = run(["cmake", "--build", "build-win", "--config", "Release",
         "--target", "game_test", "-j", "8"])
if r.returncode != 0:
    print("BUILD FAILED", r.returncode, flush=True)
    sys.exit(r.returncode)

exe = BUILD / "Release" / "game_test.exe"
print("exe", exe, "exists", exe.exists(), flush=True)
if not exe.exists():
    sys.exit("no game_test.exe")

t0 = time.time()
with open(LOG, "w", encoding="utf-8", errors="replace") as f:
    p = subprocess.run([str(exe)], cwd=str(ROOT), stdout=f, stderr=subprocess.STDOUT)
elapsed = time.time() - t0
print(f"game_test exit={p.returncode} elapsed={elapsed:.1f}s log={LOG}", flush=True)

text = LOG.read_text(encoding="utf-8", errors="replace")
with open(LOG, "a", encoding="utf-8") as f:
    f.write(f"\nEXIT={p.returncode} ELAPSED={elapsed:.1f}s\n")

for line in text.splitlines():
    if any(k in line for k in (
        "MELEEGRID", "FAILED", "failed checks", "game_test:",
        "All tests", "PASS", "FAIL at",
    )):
        # avoid flooding; MELEEGRID + summary only mostly
        low = line.lower()
        if "MELEEGRID" in line or "game_test:" in line or "fail" in low:
            print(line)

print("---TAIL---", flush=True)
print("\n".join(text.splitlines()[-50:]), flush=True)

m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", text)
if m:
    print(f"RESULT checks={m.group(1)} failures={m.group(2)}", flush=True)
    sys.exit(0 if m.group(2) == "0" and p.returncode == 0 else 1)
print("NO SUMMARY", flush=True)
sys.exit(1)
