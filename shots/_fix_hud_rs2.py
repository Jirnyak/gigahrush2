# Dump full HUD block around rs / shownDmg and fix scope
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
main = ROOT / "src/app/main.cpp"
lines = main.read_text(encoding="utf-8").splitlines()

# Print lines 3860-3970
for i in range(3860, min(3975, len(lines) + 1)):
    print(f"{i}|{lines[i-1]}")
