# -*- coding: utf-8 -*-
from pathlib import Path
ROOT = Path(r"C:\hades\gigahrush2")

# combat.h tail + PlayerMelee area + free function decls near end
ch = (ROOT / "src/game/combat.h").read_text(encoding="utf-8").splitlines()
print(f"combat.h lines={len(ch)}")
print("--- last 50 ---")
for i, ln in enumerate(ch[-50:], len(ch)-49):
    print(f"{i}|{ln}")

print("\n--- rpg.h first 100 ---")
rh = (ROOT / "src/game/rpg.h").read_text(encoding="utf-8").splitlines()
for i, ln in enumerate(rh[:100], 1):
    print(f"{i}|{ln}")

print("\n--- rpg.h decls (functions) ---")
for i, ln in enumerate(rh, 1):
    if "void " in ln or "inline " in ln or "struct Rpg" in ln or "transfer" in ln.lower():
        print(f"{i}|{ln}")

print("\n--- suite_rpg.inl last 40 ---")
sr = (ROOT / "tests/suite_rpg.inl").read_text(encoding="utf-8").splitlines()
for i, ln in enumerate(sr[-40:], len(sr)-39):
    print(f"{i}|{ln}")

print("\n--- game_test how suite_rpg included ---")
gt = (ROOT / "tests/game_test.cpp").read_text(encoding="utf-8")
for i, ln in enumerate(gt.splitlines(), 1):
    if "suite_rpg" in ln or "test_elevator" in ln:
        print(f"{i}|{ln}")

print("\n--- CMake pin ---")
for i, ln in enumerate((ROOT/"CMakeLists.txt").read_text(encoding="utf-8").splitlines(), 1):
    if "PASS_REGULAR" in ln or "219586" in ln or "219546" in ln:
        print(f"{i}|{ln}")

print("\n--- combat.cpp has rpg include? ---")
cc = (ROOT / "src/game/combat.cpp").read_text(encoding="utf-8").splitlines()
for i, ln in enumerate(cc[:40], 1):
    print(f"{i}|{ln}")
