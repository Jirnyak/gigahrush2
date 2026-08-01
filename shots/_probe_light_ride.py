from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []
pp = (root / "src/render/prop_placer.cpp").read_text(encoding="utf-8", errors="replace")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")

out.append("==== lightChance full context ====")
lines = pp.splitlines()
for i, line in enumerate(lines):
    if "lightChance" in line or ("nOpen" in line and "solidAbove" in line):
        lo, hi = max(0, i - 20), min(len(lines), i + 30)
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j]}")
        out.append("---")

out.append("\n==== propPlacer populate / ride / shot ====")
ml = main.splitlines()
for i, line in enumerate(ml):
    if "propPlacer" in line or ("populate(" in line and "prop" in line.lower()):
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# find --ride / shot floor loop
out.append("\n==== ride/shot floor loops ====")
for i, line in enumerate(ml):
    if re.search(r"\bride\b|shotMode|g_shot|--shot|populateFloor|for \(.*floor", line, re.I):
        if any(k in line.lower() for k in ["ride", "shot", "floor", "for", "populate", "prop"]):
            out.append(f"{i+1}:{line.rstrip()[:180]}")

# interactive floor enter populate
out.append("\n==== floor enter / leave prop ====")
for i, line in enumerate(ml):
    if "populate" in line or ("prop" in line.lower() and "floor" in line.lower()):
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# BACKLOG mention of light/ride
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
out.append("\n==== backlog light/ride/prop ====")
for i, line in enumerate(bl.splitlines(), 1):
    if any(k in line.lower() for k in ["lightchance", "ride", "propplacer", "populate", "operator", "precedence"]):
        out.append(f"{i}:{line[:180]}")

# audit unwired md
au = root / "shots/_audit_unwired.md"
if au.exists():
    t = au.read_text(encoding="utf-8", errors="replace")
    out.append("\n==== audit_unwired head ====")
    out.append(t[:4000])

# explorer findings about light
for p in (root / ".agents").rglob("*.md"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "lightChance" in t or "solidAbove ||" in t:
        out.append(f"\nFILE {p.relative_to(root)}")
        for i, line in enumerate(t.splitlines(), 1):
            if "lightChance" in line or "solidAbove" in line or "ride" in line.lower() and "prop" in line.lower():
                out.append(f"  {i}:{line[:160]}")

Path(r"C:/hades/gigahrush2/shots/_probe_light_ride_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
