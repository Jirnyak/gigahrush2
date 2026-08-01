import time
import re
from pathlib import Path

log = Path("shots/_gt_savrpg2.txt")
deadline = time.time() + 600
last = -1
while time.time() < deadline:
    if log.exists():
        t = log.read_text(encoding="utf-8", errors="replace")
        if len(t) != last:
            last = len(t)
            lines = [l for l in t.splitlines() if l.strip()]
            tail = lines[-1][:140] if lines else "?"
            print(f"size={last} last={tail}", flush=True)
        m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", t)
        if m:
            print(f"RESULT checks={m.group(1)} failures={m.group(2)}", flush=True)
            print(t[-600:], flush=True)
            break
        if "EXIT=" in t:
            print("EXIT without summary", flush=True)
            print(t[-800:], flush=True)
            break
    time.sleep(15)
else:
    print("TIMEOUT", flush=True)
    if log.exists():
        print(log.read_text(encoding="utf-8", errors="replace")[-1500:], flush=True)
