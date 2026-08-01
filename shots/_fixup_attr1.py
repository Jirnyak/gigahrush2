# Fixups after ATTR1 patch: includes, cmake pin, verify seams
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

# main.cpp: need <algorithm> for std::max, rpg.h
main = ROOT / "src/app/main.cpp"
mt = main.read_text(encoding="utf-8")
changed = False
if "#include <algorithm>" not in mt and "std::max" in mt:
    # after first include block
    mt2 = re.sub(
        r"(#include <[^\n]+>\n)",
        r"\1#include <algorithm>\n",
        mt,
        count=1,
    )
    if mt2 != mt:
        mt = mt2
        changed = True
        print("OK added #include <algorithm>")
    else:
        print("WARN could not add algorithm")
if '#include "game/rpg.h"' not in mt:
    for inc in ['#include "game/combat.h"', '#include "game/console.h"', '#include "game/embody.h"']:
        if inc in mt:
            mt = mt.replace(inc, inc + '\n#include "game/rpg.h"', 1)
            changed = True
            print("OK added rpg.h")
            break
    else:
        # try any game include
        m = re.search(r'(#include "game/[^"]+"\n)', mt)
        if m:
            mt = mt.replace(m.group(1), m.group(1) + '#include "game/rpg.h"\n', 1)
            changed = True
            print("OK added rpg.h near", m.group(1).strip())
        else:
            print("WARN no rpg.h")
if changed:
    main.write_text(mt, encoding="utf-8", newline="\n")

# Verify key spots
checks = {
    "keybind k1": "k1 = 30" in (ROOT/"src/game/keybind.h").read_text(encoding="utf-8"),
    "keybind attr_str": "attr_str" in (ROOT/"src/game/keybind.cpp").read_text(encoding="utf-8"),
    "ConsoleRequest AttrStr": "AttrStr" in (ROOT/"src/game/console.h").read_text(encoding="utf-8"),
    "cmd_attr": "cmd_attr" in (ROOT/"src/game/console.cpp").read_text(encoding="utf-8"),
    "main spend": "spend_attr_point" in mt,
    "main agimv": "agi_move_speed_mult_e3" in mt,
    "main rpgcmbt": 'shotAction == "rpgcmbt"' in mt,
    "combat log": "[rpgcmbt] melee" in (ROOT/"src/game/combat.cpp").read_text(encoding="utf-8"),
    "suite_console attr": 'find("attr")' in (ROOT/"tests/suite_console.inl").read_text(encoding="utf-8"),
    "suite_keybind attr_str": 'find("attr_str")' in (ROOT/"tests/suite_keybind.inl").read_text(encoding="utf-8"),
}
for k,v in checks.items():
    print(("OK" if v else "MISS"), k)

# HUD block sanity - brace balance around shownDmg
idx = mt.find("shownDmg")
if idx > 0:
    print("HUD context:")
    print(mt[idx-200:idx+500])

# console register - check emdash issue
cc = (ROOT/"src/game/console.cpp").read_text(encoding="utf-8")
if "cmd_attr, complete_attr" in cc:
    print("OK cmd_attr registered")
else:
    print("MISS cmd_attr register")
    for i,l in enumerate(cc.splitlines(),1):
        if "attr" in l.lower() and ("add" in l or "cmd" in l):
            print(f"  {i}|{l}")

# CMake pin 219409 -> 219422
cm = ROOT / "CMakeLists.txt"
ct = cm.read_text(encoding="utf-8")
if "219422" in ct:
    print("SKIP pin already 219422")
elif "219409" in ct:
    ct = ct.replace(
        'PASS_REGULAR_EXPRESSION "game_test: 219409 checks, 0 failures"',
        'PASS_REGULAR_EXPRESSION "game_test: 219422 checks, 0 failures"',
        1,
    )
    # add changelog line before PASS
    old_note = "    # 219370 -> 219387 (+17) on 2026-07-31: RPG1 — RpgStats survives elevator\n"
    # find the pin line area
    if "219387 -> 219409" not in ct and "219409" in ct:
        # insert note before PASS line
        pin_line = '        PASS_REGULAR_EXPRESSION "game_test: 219422 checks, 0 failures")\n'
        note = (
            "    # 219409 -> 219422 (+13) on 2026-07-31: ATTR1 keybind/console spend +\n"
            "    # AGIMV move mult live; suite_console +9, suite_keybind +4.\n"
        )
        if pin_line in ct:
            ct = ct.replace(pin_line, note + pin_line, 1)
        cm.write_text(ct, encoding="utf-8", newline="\n")
        print("OK CMake pin 219409 -> 219422")
    else:
        cm.write_text(ct, encoding="utf-8", newline="\n")
        print("OK CMake pin replaced")
else:
    print("FAIL no 219409 pin found")
    for i,l in enumerate(ct.splitlines(),1):
        if "game_test:" in l and "checks" in l:
            print(f"  {i}|{l}")

# suite_keybind: does it resolve multi-word commands?
sk = (ROOT/"tests/suite_keybind.inl").read_text(encoding="utf-8")
print("--- keybind suite command-link logic ---")
for i,l in enumerate(sk.splitlines(),1):
    if "command" in l.lower() or "first" in l.lower() or "token" in l.lower() or "find(" in l or "space" in l:
        if i < 120:
            print(f"{i}|{l}")
