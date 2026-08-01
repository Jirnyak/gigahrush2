import subprocess, time, sys
from pathlib import Path

out = Path(r"C:\hades\gigahrush2\shots\_rpg1_test_out.txt")
deadline = time.time() + 600  # 10 more minutes
while time.time() < deadline:
    r = subprocess.run(
        ["tasklist"],
        capture_output=True,
        text=True,
        errors="replace",
    )
    alive = "game_test.exe" in r.stdout
    size = out.stat().st_size if out.exists() else 0
    print(f"t={time.strftime('%H:%M:%S')} alive={alive} size={size}", flush=True)
    if not alive:
        text = out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""
        print("---OUT---", flush=True)
        print(text[-4000:], flush=True)
        # look for summary
        for line in text.splitlines():
            if "game_test:" in line or line.startswith("EXIT="):
                print("SUMMARY:", line, flush=True)
        sys.exit(0 if "0 failures" in text else 1)
    time.sleep(20)

print("TIMEOUT still alive", flush=True)
sys.exit(2)
