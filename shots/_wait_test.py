import time, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / "shots" / "_game_test_attr1.txt"
exe = ROOT / "build-win" / "Release" / "game_test.exe"

# If no output file or empty / no EXIT line, run test ourselves
need_run = True
if out.exists() and out.stat().st_size > 100:
    t = out.read_text(encoding="utf-8", errors="replace")
    if "checks" in t and ("EXIT:" in t or "0 failures" in t or "failure" in t):
        need_run = False
        print("existing output present")

if need_run:
    # kill stale
    subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)
    time.sleep(0.5)
    print("running game_test...")
    with open(out, "w", encoding="utf-8", errors="replace") as f:
        p = subprocess.run([str(exe)], stdout=f, stderr=subprocess.STDOUT, cwd=str(ROOT))
    with open(out, "a", encoding="utf-8") as f:
        f.write(f"\nEXIT:{p.returncode}\n")
    print(f"done exit={p.returncode}")

t = out.read_text(encoding="utf-8", errors="replace")
# print summary lines
for line in t.splitlines():
    low = line.lower()
    if "check" in low or "fail" in low or "exit" in low or "error" in low:
        print(line)
print("---TAIL---")
print("\n".join(t.splitlines()[-20:]))
