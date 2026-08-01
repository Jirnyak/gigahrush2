"""POSRPG ship prep: locate pin, show diffs, verify transfer symbols."""
from pathlib import Path
import re
import subprocess

root = Path(r"C:\hades\gigahrush2")

# CMake pin
cm = (root / "CMakeLists.txt").read_text(encoding="utf-8")
for i, line in enumerate(cm.splitlines(), 1):
    if "PASS_REGULAR_EXPRESSION" in line:
        print(f"CMAKE {i}: {line.strip()}")

# BACKLOG head + SAVMAG/POSRPG mentions
bl = root / ".agents/worker_game_audit/BACKLOG.md"
if bl.exists():
    text = bl.read_text(encoding="utf-8")
    lines = text.splitlines()
    print(f"BACKLOG lines={len(lines)}")
    for i, line in enumerate(lines, 1):
        if any(k in line for k in ("POSRPG", "SAVMAG", "OPEN", "CLOSED", "## ")):
            if i < 80 or "SAVMAG" in line or "POSRPG" in line:
                print(f"BL {i}: {line[:140]}")

# transfer symbols
for rel in [
    "src/game/combat.cpp",
    "src/app/main.cpp",
    "tests/suite_rpg.inl",
]:
    p = root / rel
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if "transfer_player_progression" in line or "test_rpg_possess" in line:
            print(f"{rel}:{i}: {line.strip()[:120]}")

# git
for cmd in [
    ["git", "status", "-sb"],
    ["git", "diff", "--stat",
     "src/game/combat.h", "src/game/combat.cpp", "src/app/main.cpp",
     "tests/suite_rpg.inl", "CMakeLists.txt"],
    ["git", "log", "-3", "--oneline"],
    ["git", "rev-parse", "HEAD"],
]:
    print("===", " ".join(cmd))
    r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout)
    if r.stderr:
        print(r.stderr)
