# Probe healWanted, wall action, suite pins, combat log site
from pathlib import Path

def grep(path, needles, ctx=2):
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    for i, l in enumerate(lines, 1):
        if any(n in l for n in needles):
            for j in range(max(0, i - 1 - ctx), min(len(lines), i + ctx)):
                m = ">>" if j + 1 == i else "  "
                print(f"{m}{j+1}|{lines[j]}")
            print("---")

print("=== healWanted ===")
grep(
    "src/app/main.cpp",
    ["healWanted", "eatWanted", "bool heal", "bool saveWanted", "bool interactWanted"],
    3,
)

print("=== wall action sites ===")
lines = Path("src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(lines, 1):
    if 'shotAction == "wall"' in l:
        for j in range(i - 1, min(len(lines), i + 90)):
            print(f"{j+1}|{lines[j]}")
        print("---")

print("=== suite keybind/console ===")
for p in ["tests/suite_keybind.inl", "tests/suite_console.inl", "tests/suite_rpg.inl"]:
    if not Path(p).exists():
        print("missing", p)
        continue
    ls = Path(p).read_text(encoding="utf-8", errors="replace").splitlines()
    print(p, "lines", len(ls))
    for i, l in enumerate(ls, 1):
        low = l.lower()
        if any(
            n in l
            for n in [
                "count()",
                "register_defaults",
                "spend_attr",
                "attrPoints",
                "AttrStr",
                "attr_str",
                "ConsoleRequest",
                "kRequestRows",
                "CHECK(",
            ]
        ):
            if "CHECK" in l or "count" in low or "register" in low or "spend" in low or "Attr" in l:
                print(f"{p}:{i}|{l}")

print("=== cmake pin ===")
for i, l in enumerate(
    Path("CMakeLists.txt").read_text(encoding="utf-8", errors="replace").splitlines(), 1
):
    if "219" in l or "CHECK" in l or "pin" in l.lower() or "EXPECTED" in l:
        print(f"cm:{i}|{l}")

print("=== combat rpgcmbt ===")
cl = Path("src/game/combat.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
for i, l in enumerate(cl, 1):
    if any(n in l for n in ["RPGCMBT", "swingDmg", "swingCd", "melee_damage", "agi_attack"]):
        print(f"c:{i}|{l}")

# dump combat block 1205-1245
print("=== combat block ===")
for j in range(1205, min(len(cl), 1245)):
    print(f"{j+1}|{cl[j]}")

# dump healWanted sim action around where heal is consumed
print("=== heal consume context ===")
for i, l in enumerate(lines, 1):
    if "healWanted" in l and ("=" in l or "if" in l):
        for j in range(max(0, i - 3), min(len(lines), i + 25)):
            print(f"{j+1}|{lines[j]}")
        print("---")

# count keybind defaults / console request rows
print("=== counts ===")
kb = Path("src/game/keybind.cpp").read_text(encoding="utf-8", errors="replace")
print("keybind add count", kb.count("t.add({"))
ch = Path("src/game/console.h").read_text(encoding="utf-8", errors="replace")
# enum members before Count
import re
m = re.search(r"enum class ConsoleRequest.*?\n(.*?)\n\s*Count", ch, re.S)
if m:
    body = m.group(1)
    members = [x.strip() for x in re.split(r"[,/\n]+", body) if x.strip() and not x.strip().startswith("//")]
    # better parse
print("ConsoleRequest block:")
in_enum = False
n = 0
for l in ch.splitlines():
    if "enum class ConsoleRequest" in l:
        in_enum = True
        continue
    if in_enum:
        if "Count" in l:
            print("  Count at member index", n)
            break
        # strip comments
        s = l.split("//")[0].strip().rstrip(",")
        if s:
            for part in s.split(","):
                part = part.strip()
                if part:
                    print(f"  [{n}] {part}")
                    n += 1

# suite_rpg spend_attr tests
print("=== suite_rpg spend ===")
if Path("tests/suite_rpg.inl").exists():
    ls = Path("tests/suite_rpg.inl").read_text(encoding="utf-8", errors="replace").splitlines()
    for i, l in enumerate(ls, 1):
        if "spend_attr" in l or "test_rpg" in l or "attrPoints" in l:
            print(f"rpg:{i}|{l}")
