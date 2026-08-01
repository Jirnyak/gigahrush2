from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
lines = main.splitlines()

# ride transition: where shotRideDone increments and what happens to player/mag
out.append("==== shotRideDone / elevator ride in shot path ====")
for i, line in enumerate(lines):
    if any(k in line for k in ["shotRideDone", "shotRide", "elevWanted", "elevator_ride", "ride_start", "try_ride"]):
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# find block that performs ride in shot mode
out.append("\n==== elevWanted / ride call context ====")
for i, line in enumerate(lines):
    if "elevWanted" in line or "elevator_" in line and "shot" in lines[max(0,i-5):i+1].__repr__():
        pass
for i, line in enumerate(lines):
    if "elevWanted" in line:
        lo, hi = max(0, i - 5), min(len(lines), i + 25)
        out.append(f"\n-- {i+1} --")
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")

# PlayerRanged attach / fire path - how mag empties
out.append("\n==== fire / magCount decrement ====")
for i, line in enumerate(lines):
    if "magCount" in line:
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# combat fire
combat = (root / "src/game/combat.cpp").read_text(encoding="utf-8", errors="replace")
out.append("\n==== combat.cpp magCount ====")
for i, line in enumerate(combat.splitlines(), 1):
    if "magCount" in line or "reload" in line.lower():
        out.append(f"{i}:{line[:180]}")

# status action pattern to clone for magshot
out.append("\n==== status action full (template) ====")
for i, line in enumerate(lines):
    if 'shotAction == "status"' in line:
        for j in range(i, min(len(lines), i + 30)):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")
        break

# save action waits for ride
out.append("\n==== save action waits ride ====")
for i, line in enumerate(lines):
    if 'shotAction == "save"' in line or "shotRideDone >= shotRide" in line:
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# backlog MAGSHOT exact text
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
out.append("\n==== MAGSHOT backlog block ====")
ls = bl.splitlines()
for i, line in enumerate(ls):
    if "MAGSHOT" in line:
        for j in range(max(0, i - 2), min(len(ls), i + 40)):
            out.append(f"{j+1}:{ls[j][:200]}")
        break

# existing shot scripts for status/rpgcmbt
out.append("\n==== shot scripts ====")
for p in sorted((root / "shots").glob("shot_*")):
    if p.suffix in {".bat", ".cmd", ".ps1", ".sh", ".py", ".txt"}:
        out.append(f"{p.name}")

# lightChance line exact
pp = (root / "src/render/prop_placer.cpp").read_text(encoding="utf-8", errors="replace")
out.append("\n==== lightChance line ====")
for i, line in enumerate(pp.splitlines(), 1):
    if "lightChance" in line:
        out.append(f"{i}:{line}")
        # show with parens analysis
        out.append(f"  raw: {line.strip()}")

# prop populate on layer switch
out.append("\n==== layer switch populate ====")
for i, line in enumerate(lines):
    if "propPlacer.populate" in line:
        lo, hi = max(0, i - 30), min(len(lines), i + 10)
        out.append(f"\n-- populate at {i+1} --")
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")

Path(r"C:/hades/gigahrush2/shots/_probe_magshot_plan_out.txt").write_text("\n".join(out), encoding="utf-8")
print("ok", len(out))
