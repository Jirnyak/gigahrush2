"""Find existing WallBrace / incoming_mult tests and player_melee_step signature."""
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")

print("=== tests mentioning incoming / WallBrace / behaviour_incoming ===")
for p in sorted((root / "tests").rglob("*")):
    if p.suffix not in (".inl", ".cpp", ".h"):
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, line in enumerate(t.splitlines(), 1):
        if any(k in line for k in (
            "incoming_mult", "WallBrace", "behaviour_incoming",
            "player_melee_step", "nearWall",
        )):
            print(f"{p.relative_to(root)}:{i}: {line.strip()[:110]}")

print("\n=== player_melee_step decl ===")
h = (root / "src/game/combat.h").read_text(encoding="utf-8")
for i, line in enumerate(h.splitlines(), 1):
    if "player_melee_step" in line:
        print(f"combat.h:{i}: {line}")

print("\n=== main apply_damage contexts ===")
m = (root / "src/app/main.cpp").read_text(encoding="utf-8")
lines = m.splitlines()
for i, line in enumerate(lines, 1):
    if "apply_damage" in line and not line.strip().startswith("//"):
        for j in range(max(0, i-3), min(len(lines), i+3)):
            print(f"main:{j+1}: {lines[j][:100]}")
        print("---")
