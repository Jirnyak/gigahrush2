import time
import re
from pathlib import Path

log = Path("shots/_game_test_savrpg.txt")
deadline = time.time() + 600
last_size = -1
while time.time() < deadline:
    if log.exists():
        text = log.read_text(encoding="utf-8", errors="replace")
        size = len(text)
        if size != last_size:
            last_size = size
            # progress: last non-empty line
            lines = [l for l in text.splitlines() if l.strip()]
            if lines:
                print(f"size={size} last={lines[-1][:120]}", flush=True)
        if "EXIT=" in text:
            m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", text)
            if m:
                print(f"RESULT checks={m.group(1)} failures={m.group(2)}", flush=True)
            else:
                print("EXIT seen but no summary line yet", flush=True)
                # maybe still writing
                time.sleep(1)
                text = log.read_text(encoding="utf-8", errors="replace")
                m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", text)
                if m:
                    print(f"RESULT checks={m.group(1)} failures={m.group(2)}", flush=True)
                print(text[-800:], flush=True)
            break
        # also catch summary without EXIT if process still running
        m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", text)
        if m and "EXIT=" not in text:
            # wait a bit for EXIT
            time.sleep(2)
            text = log.read_text(encoding="utf-8", errors="replace")
            if "EXIT=" in text:
                print(f"RESULT checks={m.group(1)} failures={m.group(2)}", flush=True)
                break
    time.sleep(5)
else:
    print("TIMEOUT waiting for game_test", flush=True)
    if log.exists():
        print(log.read_text(encoding="utf-8", errors="replace")[-1500:], flush=True)
