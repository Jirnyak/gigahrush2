"""Poll until game_test.exe exits, then summarize output."""
import subprocess, time, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / "shots" / "_game_test_attr1.txt"
summary = ROOT / "shots" / "_game_test_summary.txt"

def running():
    r = subprocess.run(["tasklist"], capture_output=True, text=True, errors="replace")
    return "game_test.exe" in r.stdout.lower()

deadline = time.time() + 600  # 10 min
print(f"await start running={running()}", flush=True)
while running() and time.time() < deadline:
    time.sleep(10)
    sz = out.stat().st_size if out.exists() else 0
    print(f"  still running size={sz}", flush=True)

still = running()
print(f"await end running={still}", flush=True)

# If still running after timeout, kill and report
if still:
    subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)
    time.sleep(1)
    msg = "TIMEOUT killed game_test"
    summary.write_text(msg + "\n", encoding="utf-8")
    print(msg)
    sys.exit(2)

# Give poll_test a moment to append EXIT
time.sleep(2)

t = out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""
# Also check poll out
po = ROOT / "shots" / "_poll_test_out.txt"
pt = po.read_text(encoding="utf-8", errors="replace") if po.exists() else ""

lines_out = []
lines_out.append(f"size={len(t)} poll_out_size={len(pt)}")
for src_name, src in [("main", t), ("poll", pt)]:
    for l in src.splitlines():
        low = l.lower()
        if any(x in low for x in ("check", "fail", "exit", "error", "assert")):
            lines_out.append(f"[{src_name}] {l}")
lines_out.append("---TAIL main---")
lines_out.extend((t.splitlines()[-30:] if t else ["empty"]))
lines_out.append("---TAIL poll---")
lines_out.extend((pt.splitlines()[-30:] if pt else ["empty"]))

text = "\n".join(lines_out) + "\n"
summary.write_text(text, encoding="utf-8")
print(text)
