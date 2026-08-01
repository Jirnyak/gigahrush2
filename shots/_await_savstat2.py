import time, subprocess, os, sys, re

out_run = r"C:\hades\gigahrush2\shots\_game_test_savstat_run.txt"
summary = r"C:\hades\gigahrush2\shots\_game_test_savstat.txt"
t0 = time.time()

while time.time() - t0 < 900:
    p = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq game_test.exe", "/NH"],
        capture_output=True, text=True,
    )
    if "game_test.exe" not in p.stdout:
        break
    # progress heartbeat
    sz = os.path.getsize(out_run) if os.path.exists(out_run) else 0
    print(f"running t={int(time.time()-t0)}s size={sz}", flush=True)
    time.sleep(10)
else:
    open(summary, "w", encoding="utf-8").write("TIMEOUT\n")
    print("TIMEOUT")
    sys.exit(1)

time.sleep(1)
text = ""
if os.path.exists(out_run):
    text = open(out_run, encoding="utf-8", errors="replace").read()
open(summary, "w", encoding="utf-8").write(text)
m = re.findall(r"game_test: \d+ checks.*", text)
print("MATCHES:", m)
print("ELAPSED", int(time.time() - t0))
# print last 30 lines
lines = text.splitlines()
print("\n".join(lines[-30:]))
if not m:
    sys.exit(2)
if "0 failures" not in m[-1]:
    sys.exit(3)
