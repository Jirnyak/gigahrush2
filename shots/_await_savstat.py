import time, subprocess, os, sys, re

log = r"C:\Users\Admin\AppData\Local\Temp\cline\background-1785538277044-44hc9av.log"
log2 = r"C:\Users\Admin\AppData\Local\Temp\cline\background-1785538376584-244gwuq.log"
out = r"C:\hades\gigahrush2\shots\_game_test_savstat.txt"
t0 = time.time()

while time.time() - t0 < 900:
    p = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq game_test.exe", "/NH"],
        capture_output=True, text=True,
    )
    if "game_test.exe" not in p.stdout:
        break
    time.sleep(5)
else:
    open(out, "w", encoding="utf-8").write("TIMEOUT\n")
    print("TIMEOUT")
    sys.exit(1)

time.sleep(1)
parts = []
for pth in (log, log2):
    if os.path.exists(pth):
        parts.append(open(pth, encoding="utf-8", errors="replace").read())
text = "\n".join(parts)
open(out, "w", encoding="utf-8").write(text)
m = re.findall(r"game_test: \d+ checks.*", text)
print("MATCHES:", m)
print("ELAPSED", int(time.time() - t0))
print(text[-2000:] if text else "EMPTY")
