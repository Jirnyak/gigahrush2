"""Launch game_test, wait for completion, print summary."""
import subprocess
import sys
import time
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
exe = root / "build-win" / "Release" / "game_test.exe"
log = root / "shots" / "_game_test_savrpg.txt"

if not exe.exists():
    print(f"MISSING {exe}")
    sys.exit(2)

print(f"starting {exe}", flush=True)
log.write_text("", encoding="utf-8")
t0 = time.time()
with open(log, "w", encoding="utf-8", errors="replace") as f:
    proc = subprocess.Popen(
        [str(exe)],
        cwd=str(root),
        stdout=f,
        stderr=subprocess.STDOUT,
    )
    print(f"pid={proc.pid}", flush=True)
    rc = proc.wait()
elapsed = time.time() - t0
print(f"rc={rc} elapsed={elapsed:.1f}s", flush=True)

text = log.read_text(encoding="utf-8", errors="replace")
with open(log, "a", encoding="utf-8") as f:
    f.write(f"\nEXIT={rc}\n")

m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", text)
if m:
    print(f"RESULT checks={m.group(1)} failures={m.group(2)}", flush=True)
else:
    print("NO SUMMARY LINE", flush=True)
    print(text[-2000:], flush=True)
    # also look for FAIL lines
    fails = [l for l in text.splitlines() if "FAIL" in l or "fail" in l]
    for l in fails[-20:]:
        print(l, flush=True)

sys.exit(0 if rc == 0 and m and m.group(2) == "0" else 1)
