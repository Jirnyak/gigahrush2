from pathlib import Path
import re
root = Path(r"C:\hades\gigahrush2")
out = []
files = [
    "src/game/keybind.h", "src/game/keybind.cpp",
    "src/game/console.h", "src/game/console.cpp",
    "src/game/rpg.h", "src/game/rpg.cpp",
]
needles = re.compile(
    r"spend_attr|attr_point|kDefault|KeyAction|console_register|resupply|Command|"
    r"SCANCODE_[0-9]|attrPoints|agi_move|fresh_rpg|random_rpg",
    re.I,
)
for rel in files:
    p = root / rel
    if not p.exists():
        out.append(f"MISSING {rel}")
        continue
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    out.append(f"===== {rel} ({len(lines)} lines) =====")
    for i, ln in enumerate(lines, 1):
        if needles.search(ln):
            out.append(f"{i}|{ln}")

# also dump full keybind defaults section
for rel in ["src/game/keybind.h", "src/game/keybind.cpp", "src/game/console.h"]:
    p = root / rel
    if not p.exists():
        continue
    text = p.read_text(encoding="utf-8", errors="replace")
    out.append(f"\n##### FULL {rel} #####\n")
    out.append(text[:12000])

(root / "shots/_find_binds_out.txt").write_text("\n".join(out), encoding="utf-8")
print("ok", len(out))
