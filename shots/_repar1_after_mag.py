# -*- coding: utf-8 -*-
"""RE-PAR1 after MAGSHOT: travel seam re-grep (read-only)."""
from pathlib import Path
import re
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

root = Path(r"C:\hades\gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
fs = (root / "src/game/floor_stream.cpp").read_text(encoding="utf-8", errors="replace") if (root / "src/game/floor_stream.cpp").exists() else ""
elev = (root / "src/game/elevator.cpp").read_text(encoding="utf-8", errors="replace")

checks = []

def hit(label, ok, detail=""):
    checks.append((label, ok, detail))
    print(f"{'OK' if ok else 'FAIL'}: {label}" + (f" — {detail}" if detail else ""))

# place_body_safely at travel sites
pbs = [m.start() for m in re.finditer(r"place_body_safely\s*\(", main)]
hit("place_body_safely call sites in main", len(pbs) >= 2, f"count={len(pbs)}")

# ai_release at leave sites
ar = [m.start() for m in re.finditer(r"ai_release\s*\(", main)]
hit("ai_release call sites in main", len(ar) >= 2, f"count={len(ar)}")

# do_ride / shot travel still present
hit("do_ride present", "do_ride" in main or "shotRide" in main)
hit("shot travel / ride harness", "shotRide" in main and "shotRideDone" in main)

# floor_stream unload ai_release
if fs:
    hit("floor_stream ai_release", "ai_release" in fs)
else:
    hit("floor_stream.cpp exists", False)

# elevator preserves PlayerRanged + RpgStats (prior closes)
hit("elevator PlayerRanged restore", "PlayerRanged" in elev and "hadRanged" in elev)
hit("elevator RpgStats restore", "RpgStats" in elev or "hadRpg" in elev)

# QKILL still wired
hit("quest_on_kill in main", "quest_on_kill" in main)
hit("quest_on_giver_died in main", "quest_on_giver_died" in main)

# MAGSHOT still present
hit("mag action harness", 'shotAction == "mag"' in main)
hit("mag PROOF line", "[mag] PROOF" in main)

# Context dumps for place_body_safely
print("\n=== place_body_safely contexts ===")
for i, pos in enumerate(pbs[:6]):
    line = main.count("\n", 0, pos) + 1
    ctx = main[max(0, pos-180):pos+120].replace("\n", " ")
    print(f"  [{i}] L{line}: ...{ctx[:200]}...")

print("\n=== ai_release contexts ===")
for i, pos in enumerate(ar[:6]):
    line = main.count("\n", 0, pos) + 1
    ctx = main[max(0, pos-180):pos+120].replace("\n", " ")
    print(f"  [{i}] L{line}: ...{ctx[:200]}...")

fails = sum(1 for _, ok, _ in checks if not ok)
print(f"\nRE-PAR1 SUMMARY: {len(checks)-fails}/{len(checks)} OK, fails={fails}")
out = root / "shots" / "_repar1_after_mag_out.txt"
# already redirected by caller often; also write structured
lines = [f"{'OK' if ok else 'FAIL'}\t{lab}\t{det}" for lab, ok, det in checks]
out.write_text("\n".join(lines) + f"\nSUMMARY\t{fails}\n", encoding="utf-8")
sys.exit(1 if fails else 0)
