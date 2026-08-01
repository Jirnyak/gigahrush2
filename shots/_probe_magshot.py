# Probe main.cpp for MAGSHOT-related seams (HUD mag + ride)
from pathlib import Path
p = Path(r"C:\hades\gigahrush2\src\app\main.cpp")
lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
keys = [
    "magCount", "PlayerRanged", "mag ", " HUD", "hud",
    "--ride", "shotAction", "do_ride", "[mag]", "ammo",
    "magazine", "reload", "PlayerMelee",
]
print(f"main.cpp lines={len(lines)} bytes={p.stat().st_size}")
for k in keys:
    idx = [i for i, l in enumerate(lines, 1) if k in l]
    print(f"{k!r:20s} count={len(idx):3d} lines={idx[:15]}")

# Show context around magCount / PlayerRanged HUD usage
print("\n=== magCount contexts ===")
for i, l in enumerate(lines, 1):
    if "magCount" in l or ("PlayerRanged" in l and ("hud" in l.lower() or "draw" in l.lower() or "snprintf" in l or "sprintf" in l or "fprintf" in l)):
        lo = max(1, i - 2)
        hi = min(len(lines), i + 3)
        print(f"--- @{i} ---")
        for j in range(lo, hi + 1):
            print(f"{j}: {lines[j-1]}")
