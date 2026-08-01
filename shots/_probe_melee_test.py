# Find existing player_melee_step unit test patterns
from pathlib import Path
root = Path(r"C:\hades\gigahrush2\tests")
for p in sorted(root.rglob("*")):
    if p.suffix not in {".cpp", ".inl"}:
        continue
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    hits = [i for i, l in enumerate(lines, 1) if "player_melee_step" in l or "player_ranged_step" in l]
    if hits:
        print(f"\n===== {p.name} hits={hits} =====")
        for i in hits[:6]:
            lo, hi = max(1, i - 5), min(len(lines), i + 25)
            print(f"--- @{i} ---")
            for j in range(lo, hi + 1):
                print(f"{j}: {lines[j-1][:130]}")
