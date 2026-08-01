# Show suite_rpg.inl structure + where to add combat wire pin
from pathlib import Path
p = Path(r"C:\hades\gigahrush2\tests\suite_rpg.inl")
lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
print(f"suite_rpg.inl lines={len(lines)}")
for i, l in enumerate(lines, 1):
    if "TEST" in l or "melee_damage" in l or "agi_attack" in l or "CHECK" in l and i < 80:
        if "TEST" in l or "void " in l or "melee_damage" in l or i < 40:
            print(f"{i}: {l[:120]}")

print("\n--- last 40 lines ---")
for i, l in enumerate(lines[-40:], len(lines)-39):
    print(f"{i}: {l[:120]}")

# How game_test includes suites
gt = Path(r"C:\hades\gigahrush2\tests\game_test.cpp").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(gt.splitlines(), 1):
    if "suite_rpg" in l or "run_rpg" in l or "rpg" in l.lower() and ("include" in l or "run_" in l):
        print(f"gt {i}: {l[:120]}")
