from pathlib import Path

ch = Path("src/game/craft.h").read_text(encoding="utf-8")
for i, l in enumerate(ch.splitlines(), 1):
    if any(k in l for k in ("craft_learn", "kCraftingWire", "craft_write", "craft_read", "craft_init", "struct CraftingState")):
        print(f"craft.h {i}: {l.rstrip()}")

print("---rpg---")
rh = Path("src/game/rpg.h").read_text(encoding="utf-8")
for i, l in enumerate(rh.splitlines(), 1):
    if any(k in l for k in ("struct RpgStats", "fresh_rpg", "xp", "psi", "level", "attrPoints", "attr[", "pad_")):
        print(f"rpg.h {i}: {l.rstrip()}")

print("---main---")
m = Path("src/app/main.cpp").read_text(encoding="utf-8")
for i, l in enumerate(m.splitlines(), 1):
    if any(k in l for k in ("runState.rpg", "runState.craft", "carriedRpg", "crafting = runState", "craft = crafting")):
        print(f"main {i}: {l.rstrip()}")

print("---suite---")
s = Path("tests/suite_saveload.inl").read_text(encoding="utf-8")
for i, l in enumerate(s.splitlines(), 1):
    low = l.lower()
    if any(k in low for k in ("rpg", "craft", "829", "929", "944", "busy_run", "same_run", "wire_layout", "kSaveVersion")):
        print(f"suite {i}: {l.rstrip()}")

print("---cmake pin---")
cm = Path("CMakeLists.txt").read_text(encoding="utf-8")
for i, l in enumerate(cm.splitlines(), 1):
    if "PASS_REGULAR" in l or "219426" in l or "game_test" in l and "checks" in l:
        print(f"cmake {i}: {l.rstrip()}")

print("---git---")
import subprocess
print(subprocess.check_output(["git", "status", "-sb"], text=True))
print(subprocess.check_output(["git", "diff", "--stat", "src/game/save.h", "src/game/save.cpp", "src/app/main.cpp", "tests/suite_saveload.inl"], text=True))
