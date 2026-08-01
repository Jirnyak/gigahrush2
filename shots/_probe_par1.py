# PAR1 re-grep after RPG1 push / foreign main activity (read-only)
from pathlib import Path
p = Path(r"C:\hades\gigahrush2\src\app\main.cpp")
text = p.read_text(encoding="utf-8", errors="replace")
lines = text.splitlines()
print(f"main.cpp lines={len(lines)} bytes={p.stat().st_size}")

def find_all(sub):
    return [i for i, l in enumerate(lines, 1) if sub in l]

checks = {
    "place_body_safely": find_all("place_body_safely"),
    "ai_release": find_all("ai_release"),
    "do_ride": find_all("do_ride"),
    "combatCarves": find_all("combatCarves"),
    "playerStatus": find_all("playerStatus"),
    "status_step": find_all("status_step"),
    "ctl->fly": find_all("ctl->fly"),
    "shotAction": find_all("shotAction"),
    "propPlacer": find_all("propPlacer"),
    "light-grid": find_all("light-grid") + find_all("light_grid") + find_all("LightGrid"),
    "GpuCull": find_all("GpuCull"),
}

for k, v in checks.items():
    print(f"{k:20s} count={len(v):3d} lines={v[:12]}")

# Classify PBS sites: keyboard vs shot travel
print("\n=== place_body_safely context ===")
for i in checks["place_body_safely"]:
    lo, hi = max(1, i - 3), min(len(lines), i + 2)
    print(f"--- @{i} ---")
    for j in range(lo, hi + 1):
        print(f"{j}: {lines[j-1][:120]}")

print("\n=== ai_release context ===")
for i in checks["ai_release"]:
    lo, hi = max(1, i - 2), min(len(lines), i + 2)
    print(f"--- @{i} ---")
    for j in range(lo, hi + 1):
        print(f"{j}: {lines[j-1][:120]}")

# Elevator restore still in elevator.cpp
el = Path(r"C:\hades\gigahrush2\src\game\elevator.cpp").read_text(encoding="utf-8", errors="replace")
print("\n=== elevator.cpp restore markers ===")
for key in ["hadRanged", "hadMelee", "hadRpg", "PlayerRanged", "PlayerMelee", "RpgStats", "emplace_or_replace"]:
    print(f"  {key}: {el.count(key)}")
