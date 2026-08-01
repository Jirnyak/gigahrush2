from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"C:\hades\gigahrush2")
out = root / "shots" / "_dump_sites_out.txt"
parts = []
def w(s=""):
    parts.append(s)

lines = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
ranges = [(1740, 1820), (2030, 2120), (2230, 2260), (2385, 2420), (2435, 2660), (3100, 3140), (3810, 3885)]
for a, b in ranges:
    w(f"---{a}-{b}---")
    for i in range(a, min(b + 1, len(lines) + 1)):
        w(f"{i}|{lines[i-1]}")
w("---rpg spend---")
rh = (root / "src/game/rpg.h").read_text(encoding="utf-8").splitlines()
for i in range(200, 230):
    w(f"{i}|{rh[i-1]}")
w("---combat swing after---")
cc = (root / "src/game/combat.cpp").read_text(encoding="utf-8").splitlines()
for i in range(1205, 1245):
    w(f"{i}|{cc[i-1]}")
w("---spend_attr impl---")
rc = (root / "src/game/rpg.cpp").read_text(encoding="utf-8").splitlines()
for i, ln in enumerate(rc, 1):
    if "spend_attr_point" in ln or "agi_move_speed" in ln:
        for j in range(max(1, i - 2), min(len(rc), i + 25) + 1):
            w(f"rpg.cpp:{j}|{rc[j-1]}")
        w("---")
# also key edge detect pattern
w("---key edge patterns---")
for i, ln in enumerate(lines, 1):
    if "SCANCODE_R" in ln or "SCANCODE_E" in ln or "SCANCODE_F5" in ln or "SCANCODE_F9" in ln or "just_pressed" in ln or "edge" in ln.lower() and "key" in ln.lower():
        if 1700 < i < 2200 or 2000 < i < 2800:
            w(f"{i}|{ln}")
out.write_text("\n".join(parts), encoding="utf-8")
print("WROTE", out, "bytes", out.stat().st_size)
