"""Wait for ATTR1 proof to finish; print summary."""
from pathlib import Path
import subprocess
import time
import sys

root = Path(__file__).resolve().parents[1]
shots = root / "shots"
out = shots / "_attr1_proof_out.txt"
gt = shots / "_game_test_attr1b.txt"
run = shots / "_attr1_proof_run.txt"

deadline = time.time() + 600  # 10 min max
last_size = -1
while time.time() < deadline:
    # still running?
    r = subprocess.run(["tasklist"], capture_output=True, text=True, errors="replace")
    gt_alive = "game_test.exe" in r.stdout
    # proof python still holding the run?
    py_count = sum(1 for line in r.stdout.splitlines() if "python.exe" in line.lower())

    if out.exists():
        text = out.read_text(encoding="utf-8", errors="replace")
        print(text)
        print("--- DONE via out file ---")
        # also show gt tail
        if gt.exists():
            gt_t = gt.read_text(encoding="utf-8", errors="replace")
            for l in gt_t.splitlines():
                if "game_test:" in l or l.startswith("EXIT:") or l.startswith("FAIL"):
                    print("GT:", l)
        sys.exit(0 if "exit=0" in text else 1)

    size = gt.stat().st_size if gt.exists() else 0
    if size != last_size:
        print(f"[{time.strftime('%H:%M:%S')}] gt_size={size} gt_alive={gt_alive} py={py_count}", flush=True)
        last_size = size
        if gt.exists():
            t = gt.read_text(encoding="utf-8", errors="replace")
            if "EXIT:" in t or ("game_test:" in t and "checks" in t):
                print("--- gt finished, waiting for proof out ---", flush=True)
                for l in t.splitlines():
                    if "game_test:" in l or l.startswith("EXIT:") or l.startswith("FAIL"):
                        print("GT:", l, flush=True)

    if not gt_alive and not out.exists():
        # maybe proof script still compressing / shooting
        if run.exists():
            rt = run.read_text(encoding="utf-8", errors="replace")
            if "SKIP shot" in rt or "rpgcmbt live" in rt or "wrote" in rt:
                print(rt)
                # give a few more seconds for out write
                time.sleep(2)
                if out.exists():
                    print(out.read_text(encoding="utf-8", errors="replace"))
                    sys.exit(0)
        # if no python and no out after gt dead — stalled
        if py_count == 0:
            print("STALLED: no game_test, no python, no out")
            if gt.exists():
                print(gt.read_text(encoding="utf-8", errors="replace")[-2000:])
            if run.exists():
                print(run.read_text(encoding="utf-8", errors="replace"))
            sys.exit(2)

    time.sleep(8)

print("TIMEOUT waiting for proof")
if gt.exists():
    print(gt.read_text(encoding="utf-8", errors="replace")[-3000:])
if run.exists():
    print(run.read_text(encoding="utf-8", errors="replace"))
sys.exit(3)
