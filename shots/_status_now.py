from pathlib import Path
import subprocess

root = Path(r"C:/hades/gigahrush2")
out = []

for f in ["_gt_long_err.txt", "_gt_long_out.txt", "_gt_long_rc.txt"]:
    p = root / "shots" / f
    out.append(f"{f} exists={p.exists()} size={p.stat().st_size if p.exists() else 0}")
    if p.exists() and p.stat().st_size:
        t = p.read_text(encoding="utf-8", errors="replace")
        out.append("TAIL:")
        out.append(t[-800:])

r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq game_test.exe"], capture_output=True, text=True)
out.append(r.stdout)

r = subprocess.run(["git", "-C", str(root), "status", "--short"], capture_output=True, text=True)
lines = r.stdout.splitlines()
out.append(f"dirty={len(lines)}")
for l in lines:
    if any(x in l for x in ["src/", "tests/", "CMakeLists", "BACKLOG", "progress", ".agents"]):
        out.append(l)

r = subprocess.run(["git", "-C", str(root), "diff", "--stat", "src", "tests", "CMakeLists.txt"], capture_output=True, text=True)
out.append("DIFFSTAT:")
out.append(r.stdout)

r = subprocess.run(["git", "-C", str(root), "log", "-5", "--oneline"], capture_output=True, text=True)
out.append("LOG:")
out.append(r.stdout)

# CPU of game_test if running
r = subprocess.run(["wmic", "process", "where", "name='game_test.exe'", "get", "ProcessId,UserModeTime,KernelModeTime,WorkingSetSize", "/format:list"], capture_output=True, text=True)
out.append("WMIC:")
out.append(r.stdout)

Path(r"C:/hades/gigahrush2/shots/_status_now_out.txt").write_text("\n".join(out), encoding="utf-8")
print("ok")
