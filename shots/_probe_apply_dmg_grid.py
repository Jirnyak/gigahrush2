"""Do all apply_damage call sites pass grid?"""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
for p in sorted((root / "src").rglob("*")):
    if p.suffix not in (".h", ".cpp", ".inl"):
        continue
    if "render" in p.parts:
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if "apply_damage" in line and not line.strip().startswith("//"):
            print(f"{p.relative_to(root)}:{i}: {line.strip()[:120]}")

# also check player_melee / projectile for grid to apply_damage
print("\n=== combat.cpp apply_damage calls with context ===")
cp = (root / "src/game/combat.cpp").read_text(encoding="utf-8")
for m in re.finditer(r"apply_damage\([^;]+;", cp):
    s = m.group(0).replace("\n", " ")
    print(s[:160])
