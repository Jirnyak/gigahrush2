"""Probe next real game gap after POSRPG ship. Stay off render/**."""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

# BACKLOG OPEN rows that are not CLOSED
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8")
print("=== OPEN table (non-CLOSED) ===")
in_open = False
for line in bl.splitlines():
    if line.startswith("## OPEN"):
        in_open = True
        continue
    if in_open and line.startswith("## "):
        break
    if in_open and line.startswith("|") and "CLOSED" not in line and "Pri" not in line and "----" not in line:
        print(line)

# Search for known deferred / TODO / FIXME in game lane
print("\n=== deferred/TODO in src/game + main (sample) ===")
patterns = [
    r"TODO|FIXME|XXX|HACK|deferred|not yet|camera-only|survives possession",
    r"MAGSHOT|POSRPG|ATTR1",
]
hits = []
for p in list((root / "src/game").rglob("*.{h,cpp}".replace("{h,cpp}", "*"))) + [root / "src/app/main.cpp"]:
    if not p.is_file():
        continue
    if p.suffix not in (".h", ".cpp", ".inl"):
        continue
    # skip render
    if "render" in p.parts:
        continue
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    for i, line in enumerate(t.splitlines(), 1):
        low = line.lower()
        if any(k in low for k in ("todo", "fixme", "xxx:", "deferred", "not yet wired", "camera-only")):
            if "http" in low:
                continue
            hits.append(f"{p.relative_to(root)}:{i}: {line.strip()[:100]}")

for h in hits[:40]:
    print(h)
print(f"... total todo-ish hits: {len(hits)}")

# Mag/HUD seams for MAGSHOT optional
print("\n=== MAG / HUD seams ===")
for rel in ["src/app/main.cpp", "src/game/combat.h", "src/game/hud.h", "src/game/hud.cpp"]:
    p = root / rel
    if not p.exists():
        # try find hud
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if re.search(r"magCount|mag\b|HUD.*ranged|ranged.*HUD|shots|hits", line, re.I):
            if i < 50 or "mag" in line.lower() or "HUD" in line:
                if any(k in line for k in ("magCount", "mag ", "shots", "hits", "ranged")):
                    print(f"{rel}:{i}: {line.strip()[:110]}")

# list hud files
print("\n=== hud-ish files ===")
for p in (root / "src").rglob("*hud*"):
    print(p.relative_to(root))
for p in (root / "src").rglob("*Hud*"):
    print(p.relative_to(root))

# git log recent
import subprocess
r = subprocess.run(["git", "log", "-8", "--oneline"], cwd=root, capture_output=True, text=True)
print("\n=== recent commits ===")
print(r.stdout)
