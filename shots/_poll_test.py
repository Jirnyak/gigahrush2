import time, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / "shots" / "_game_test_attr1.txt"
exe = ROOT / "build-win" / "Release" / "game_test.exe"
marker = ROOT / "shots" / "_test_done.flag"

def procs():
    r = subprocess.run(["tasklist"], capture_output=True, text=True, errors="replace")
    names = []
    for line in r.stdout.splitlines():
        if "game_test.exe" in line.lower() or "python.exe" in line.lower():
            names.append(line.strip()[:80])
    return names

# If test not done, run it now (blocking, up to 10 min)
t = out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""
if "EXIT:" not in t and "checks," not in t:
    print("starting fresh game_test run")
    subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)
    time.sleep(1)
    with open(out, "w", encoding="utf-8", errors="replace") as f:
        p = subprocess.run([str(exe)], stdout=f, stderr=subprocess.STDOUT, cwd=str(ROOT), timeout=600)
    with open(out, "a", encoding="utf-8") as f:
        f.write(f"\nEXIT:{p.returncode}\n")
    marker.write_text(f"done {p.returncode}\n", encoding="utf-8")
else:
    print("already have result")

t = out.read_text(encoding="utf-8", errors="replace")
print(f"size={len(t)}")
for line in t.splitlines():
    low = line.lower()
    if "check" in low or "fail" in low or line.startswith("EXIT") or "error" in low:
        print(line)
print("---TAIL---")
print("\n".join(t.splitlines()[-15:]))
print("PROCS:", procs())
