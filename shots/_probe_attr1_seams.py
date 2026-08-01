# Probe ATTR1/AGIMV seams: keybind, console, main drain, move, spend_attr
from pathlib import Path

def dump_range(path, start, end, label=None):
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"\n===== {label or path} {start}-{end} =====")
    for i in range(start - 1, min(end, len(lines))):
        print(f"{i+1}|{lines[i]}")

def grep(path, needles, context=0):
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    print(f"\n===== GREP {path} =====")
    for i, l in enumerate(lines, 1):
        if any(n in l for n in needles):
            lo = max(1, i - context)
            hi = min(len(lines), i + context)
            for j in range(lo, hi + 1):
                mark = ">>" if j == i else "  "
                print(f"{mark}{j}|{lines[j-1]}")

# keybind.h full-ish
dump_range("src/game/keybind.h", 1, 120, "keybind.h head")
grep("src/game/keybind.h", ["scan::", "kF", "kW", "kA", "namespace", "register", "struct Key", "scancode", "k1", "Digit"])

# keybind.cpp
grep("src/game/keybind.cpp", ["register_defaults", "heal", "resupply", "scan::", "bind(", "command", "add(", "push"])
dump_range("src/game/keybind.cpp", 1, 200, "keybind.cpp")

# console.h
dump_range("src/game/console.h", 1, 200, "console.h")
grep("src/game/console.h", ["ConsoleRequest", "Heal", "Resupply", "Count", "request", "enum"])

# console.cpp register
grep("src/game/console.cpp", ["register_defaults", "heal", "resupply", "request", "ConsoleRequest", "Attr"])
# find register_defaults body
lines = Path("src/game/console.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(lines, 1):
    if "register_defaults" in l or "register_commands" in l:
        dump_range("src/game/console.cpp", i, min(i + 80, len(lines)), f"console.cpp from {i}")

# rpg spend_attr + agi_move
dump_range("src/game/rpg.h", 140, 230, "rpg.h API")
grep("src/game/rpg.cpp", ["spend_attr_point", "agi_move_speed"])
lines = Path("src/game/rpg.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(lines, 1):
    if "spend_attr_point" in l or "agi_move_speed_mult_e3" in l:
        dump_range("src/game/rpg.cpp", i, min(i + 40, len(lines)), f"rpg.cpp from {i}")

# main drain + move
grep("src/app/main.cpp", ["ConsoleRequest", "req.", "take_request", "pending", "Heal", "Resupply", "spend_attr", "moveSpeed", "speedScale", "kPlayerWalkSpeed"])
dump_range("src/app/main.cpp", 2080, 2180, "main drain ~2104")
dump_range("src/app/main.cpp", 2370, 2430, "main move ~2399")
dump_range("src/app/main.cpp", 2430, 2660, "main shotAction")

# suite console / rpg spend tests
for p in ["tests/suite_console.inl", "tests/suite_rpg.inl", "tests/suite_keybind.inl"]:
    if Path(p).exists():
        grep(p, ["spend_attr", "attrPoints", "ConsoleRequest", "Count", "heal", "command_count", "n_commands", "keybind"])

# CMake pin
grep("CMakeLists.txt", ["219409", "CHECKS", "check_count", "EXPECTED"])

# SDL scancodes for digits - search if any reference
grep("src/game/keybind.h", ["30", "31", "32", "k1", "Digit", "SCANCODE"])
# check SDL header if present
import os
for root, dirs, files in os.walk("build-win"):
    for f in files:
        if f == "SDL_scancode.h":
            p = os.path.join(root, f)
            print("FOUND", p)
            dump_range(p, 1, 80)
            grep(p, ["SCANCODE_1", "SCANCODE_2", "SCANCODE_3"])
            raise SystemExit
print("no SDL_scancode.h under build-win")
# try vcpkg / external
for cand in [
    r"C:\hades\gigahrush2\third_party",
    r"C:\hades\gigahrush2\external",
    r"C:\hades\gigahrush2\deps",
]:
    if Path(cand).exists():
        print("ext", cand, list(Path(cand).iterdir())[:20])
