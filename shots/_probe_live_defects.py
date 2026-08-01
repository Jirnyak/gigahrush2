from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

def read(p):
    p = Path(p)
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""

main = read(root / "src/app/main.cpp")
pp = read(root / "src/render/prop_placer.cpp")
ph = read(root / "src/render/prop_placer.h")

# 1) propPlacer.populate in interactive vs ride
out.append("==== propPlacer.populate sites ====")
for i, line in enumerate(main.splitlines(), 1):
    if "propPlacer" in line or "populate" in line and "prop" in line.lower():
        out.append(f"{i}:{line.rstrip()[:180]}")

out.append("\n==== --shot --ride path ====")
lines = main.splitlines()
for i, line in enumerate(lines):
    if "ride" in line.lower() or "--shot" in line or "shotMode" in line or "shot_ride" in line:
        if any(k in line for k in ["ride", "shot", "floor", "populate", "for ("]):
            out.append(f"{i+1}:{line.rstrip()[:180]}")

# show ride loop body if found
for i, line in enumerate(lines):
    if re.search(r"ride|shotRide|g_shot", line) and ("for" in line or "while" in line or "floor" in line.lower()):
        lo, hi = max(0, i-5), min(len(lines), i+40)
        out.append(f"\n-- context {i+1} --")
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")

# 2) lightChancePct operator precedence
out.append("\n==== lightChancePct expression ====")
for i, line in enumerate(pp.splitlines(), 1):
    if "lightChance" in line or "nOpen" in line and "light" in line.lower():
        out.append(f"{i}:{line.rstrip()[:180]}")
for i, line in enumerate(pp.splitlines(), 1):
    if "solidAbove" in line and "nOpen" in line:
        out.append(f"HIT {i}:{line.rstrip()[:200]}")
        for j in range(i, min(i+5, len(pp.splitlines())+1)):
            out.append(f"  {j}:{pp.splitlines()[j-1].rstrip()[:180]}")

# 3) game_test unbuffered?
out.append("\n==== game_test main setvbuf/printf ====")
gt = read(root / "tests/game_test.cpp")
for i, line in enumerate(gt.splitlines()[:80], 1):
    out.append(f"{i}:{line.rstrip()[:160]}")
out.append("...")
for i, line in enumerate(gt.splitlines(), 1):
    if "setvbuf" in line or "ios_base" in line or "unitbuf" in line or "setbuf" in line:
        out.append(f"{i}:{line.rstrip()[:160]}")

# 4) current git dirty that looks like real work
out.append("\n==== interesting dirty files sample ====")
# just list status via reading nothing - note in out
out.append("(see git status)")

# 5) BACKLOG empty claim vs any [ ] 
bl = read(root / ".agents/worker_game_audit/BACKLOG.md")
open_items = [f"{i}:{l}" for i,l in enumerate(bl.splitlines(),1) if l.strip().startswith("- [ ]")]
out.append(f"\nBACKLOG unchecked items: {len(open_items)}")
out.extend(open_items[:30])

# 6) quest_objective_text / time_text HUD gap?
out.append("\n==== HUD uses objective/time text? ====")
out.append(f"quest_objective_text main={main.count('quest_objective_text')}")
out.append(f"quest_time_text main={main.count('quest_time_text')}")
out.append(f"quest_line main={main.count('quest_line')}")
# show HUD quest block
for i, line in enumerate(lines):
    if "qline" in line or "quest_line" in line or "qActive" in line:
        lo, hi = max(0,i-3), min(len(lines), i+8)
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")
        out.append("---")

Path(r"C:/hades/gigahrush2/shots/_probe_live_defects_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
