import subprocess, time
from pathlib import Path

log = Path(r"C:\hades\gigahrush2\shots\_game_test_meleegrid2.txt")
t0 = time.time()
while time.time() - t0 < 480:
    r = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq game_test.exe"],
        capture_output=True, text=True, errors="replace",
    )
    run = "game_test.exe" in r.stdout
    sz = log.stat().st_size if log.exists() else 0
    print(f"{time.time()-t0:.0f}s run={run} sz={sz}", flush=True)
    if not run:
        break
    time.sleep(20)
print("done", flush=True)
