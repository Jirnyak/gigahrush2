from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
lines = main.splitlines()

# shotAction branches
out.append("==== shotAction branches ====")
for i, line in enumerate(lines):
    if "shotAction" in line:
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# HUD mag line
out.append("\n==== HUD mag ====")
for i, line in enumerate(lines):
    if "mag" in line.lower() and ("PlayerRanged" in line or "%u/%u" in line or "magCount" in line or "ImGui" in line):
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# find exact HUD gun block
for i, line in enumerate(lines):
    if "magCount" in line or "/%u mag" in line or " mag" in line and "Text" in line:
        lo, hi = max(0, i - 15), min(len(lines), i + 20)
        out.append(f"\n-- HUD ctx {i+1} --")
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")

# elevator mag preserve
el = (root / "src/game/elevator.cpp").read_text(encoding="utf-8", errors="replace")
out.append("\n==== elevator PlayerRanged ====")
for i, line in enumerate(el.splitlines(), 1):
    if "PlayerRanged" in line or "hadRanged" in line or "magCount" in line:
        out.append(f"{i}:{line[:180]}")

# suite mag body-swap
out.append("\n==== suite mag elevator ====")
for p in (root / "tests").glob("*.inl"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "PlayerRanged" in t and ("elevator" in t.lower() or "ride" in t.lower() or "mag" in t.lower()):
        hits = 0
        for i, line in enumerate(t.splitlines(), 1):
            if "magCount" in line or "PlayerRanged" in line and ("ride" in line.lower() or "elev" in line.lower() or "CHECK" in line):
                if hits < 20:
                    out.append(f"{p.name}:{i}:{line[:160]}")
                hits += 1
        if hits:
            out.append(f"  ... {hits} hits in {p.name}")

# QKILL in backlog?
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
out.append(f"\nQKILL in backlog: {'QKILL' in bl}")
out.append(f"quest_on_kill in backlog: {'quest_on_kill' in bl}")

# existing magshot scripts
out.append("\n==== existing magshot scripts ====")
for p in sorted((root / "shots").glob("*mag*")):
    out.append(f"{p.name} {p.stat().st_size}")

# --action corp/status/rpgcmbt pattern for harness
out.append("\n==== action harness patterns ====")
for i, line in enumerate(lines):
    if 'shotAction ==' in line or 'shotAction==' in line or '== "rpgcmbt"' in line or '== "corp"' in line or '== "status"' in line or '== "mag"' in line:
        lo, hi = max(0, i - 2), min(len(lines), i + 40)
        out.append(f"\n-- {i+1} --")
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")

Path(r"C:/hades/gigahrush2/shots/_probe_magshot_impl_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
