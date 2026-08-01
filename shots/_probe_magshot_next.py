from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
out.append("==== BACKLOG MAGSHOT / deferred / NEXT OPEN ====")
for i, line in enumerate(bl.splitlines(), 1):
    if any(k in line for k in ["MAGSHOT", "deferred", "DEFER", "NEXT OPEN", "Next OPEN", "OPEN", "ride", "lightChance", "PROP", "SHOT"]):
        out.append(f"{i}:{line[:200]}")

# full deferred sections
out.append("\n==== sections mentioning MAGSHOT (context) ====")
lines = bl.splitlines()
for i, line in enumerate(lines):
    if "MAGSHOT" in line:
        lo, hi = max(0, i - 5), min(len(lines), i + 25)
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j][:200]}")
        out.append("---")

# magazine / reload / gun code
out.append("\n==== magazine/reload API ====")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
for name in ["reload", "magazine", "chamber", "mag_", "ammo_in_mag", "try_reload", "gun_reload"]:
    c = main.lower().count(name.lower())
    if c:
        out.append(f"main {name}: {c}")

for p in (root / "src/game").glob("*.h"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if any(k in t.lower() for k in ["reload", "magazine", "chamber"]):
        out.append(f"\nFILE {p.name}")
        for i, line in enumerate(t.splitlines(), 1):
            if any(k in line.lower() for k in ["reload", "magazine", "chamber", "mag"]):
                out.append(f"  {i}:{line[:160]}")

# --action flags available
out.append("\n==== --action flags in main ====")
for i, line in enumerate(main.splitlines(), 1):
    if "--action" in line or "action ==" in line or 'action ==' in line or "g_action" in line:
        out.append(f"{i}:{line.rstrip()[:180]}")

# jirnyak next
out.append("\n==== jirnyak / HANDOFF next ====")
for name in ["jirnyak.md", "HANDOFF.md", "README.md", "AGENTS.md"]:
    p = root / name
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if any(k in line.lower() for k in ["next", "todo", "open", "priority", "magshot", "deferred"]):
            if len(line.strip()) > 10:
                out.append(f"{name}:{i}:{line.strip()[:160]}")

# HEAD
import subprocess
r = subprocess.run(["git", "-C", str(root), "log", "-1", "--oneline"], capture_output=True, text=True)
out.append(f"\nHEAD {r.stdout.strip()}")
r = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
out.append(r.stdout.strip())

# gt green confirm
gt = root / "shots/_gt_long_out.txt"
if gt.exists():
    t = gt.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"game_test: \d+ checks, \d+ failures", t)
    out.append(f"GT {m.group(0) if m else 'no summary'}")

Path(r"C:/hades/gigahrush2/shots/_probe_magshot_next_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
