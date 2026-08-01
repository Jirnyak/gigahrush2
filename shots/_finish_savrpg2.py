# -*- coding: utf-8 -*-
from pathlib import Path
import re
import sys

root = Path(r"C:\hades\gigahrush2")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# --- CMake pin (idempotent) ---
cm = root / "CMakeLists.txt"
text = cm.read_text(encoding="utf-8")
text2 = re.sub(
    r'PASS_REGULAR_EXPRESSION "game_test: \d+ checks, 0 failures"',
    'PASS_REGULAR_EXPRESSION "game_test: 219546 checks, 0 failures"',
    text,
    count=1,
)
text2 = re.sub(
    r"measured 219426\.",
    "measured 219546 (SAVRPG +120 saveload CHECKs).",
    text2,
)
if "219546" not in text2:
    print("FAILED cmake pin")
    sys.exit(1)
if text2 != text:
    cm.write_text(text2, encoding="utf-8", newline="\n")
    print("cmake pinned 219546")
else:
    print("cmake already 219546")

# --- BACKLOG ---
bl = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
bt = bl.read_text(encoding="utf-8")

closed_row = (
    "| SAVRPG | F5/F9 persist RpgStats + CraftingState; kSaveVersion 6->7; "
    "wire 829/929/944 | **unit GREEN:** game_test **219546 checks, 0 failures** "
    "(+120 saveload) | this commit |\n"
)

proof_block = """
## CLOSED 2026-07-31 SAVRPG — F5/F9 RpgStats + CraftingState
```
kSaveVersion 6 -> 7
wire: visit_rpg (12 B) after player; craft_write/craft_read (93 B) after rpg
kSaveFixedWire 724 -> 829; empty 929; busy 3-opened 944
F5: runState.rpg = try_get else carriedRpg; runState.craft = crafting
F9: carriedRpg = runState.rpg; emplace_or_replace; crafting = runState.craft
suite_saveload: busy_run fills rpg+craft; same_run field CHECKs; wire_layout pins
game_test: 219546 checks, 0 failures (was 219426; +120)
pathspec: src/game/save.h src/game/save.cpp src/app/main.cpp
          tests/suite_saveload.inl CMakeLists.txt BACKLOG.md
```
Next OPEN: MAGSHOT deferred; stay off src/render/**.
"""

bt2 = bt

# Remove OPEN SAVRPG row(s)
bt2, n_open = re.subn(
    r"\| P1 \| SAVRPG \|[^\n]*\n",
    "",
    bt2,
)
print(f"removed OPEN rows: {n_open}")

# Insert CLOSED row at top of CLOSED this session table (after ATTR1 or after separator)
closed_section = bt2.split("## OPEN")[0] if "## OPEN" in bt2 else bt2
if "| SAVRPG |" not in closed_section:
    marker = "| ATTR1 | spend_attr_point"
    if marker in bt2:
        bt2 = bt2.replace(marker, closed_row + marker, 1)
        print("inserted CLOSED row before ATTR1")
    else:
        # after first table separator under CLOSED this session
        m = re.search(r"(## CLOSED this session\n\|[^\n]+\n\|[-\| ]+\n)", bt2)
        if m:
            bt2 = bt2[: m.end()] + closed_row + bt2[m.end() :]
            print("inserted CLOSED row after table header")
        else:
            print("WARN: could not find CLOSED table insert point")
else:
    print("SAVRPG already in CLOSED section")

# Append proof block if missing
if "CLOSED 2026-07-31 SAVRPG" not in bt2 and "SAVRPG — F5/F9" not in bt2:
    # update Next OPEN line in ATTR1 proof if present
    bt2 = bt2.replace(
        "Next OPEN: SAVRPG (F5/F9 RpgStats + craft known-bits, bump kSaveVersion)",
        "Next OPEN: MAGSHOT deferred (SAVRPG CLOSED)",
    )
    bt2 = bt2.rstrip() + "\n" + proof_block + "\n"
    print("appended SAVRPG proof block")
else:
    print("proof block already present")

# Also fix residual "NEXT after ATTR1" / open mentions in OPEN table notes
bt2 = re.sub(
    r"\| P1 \| SAVRPG \|[^\n]*\n",
    "",
    bt2,
)

if bt2 != bt:
    bl.write_text(bt2, encoding="utf-8", newline="\n")
    print("backlog written")
else:
    print("backlog unchanged")

# verify
bt3 = bl.read_text(encoding="utf-8")
print("--- SAVRPG lines ---")
for i, l in enumerate(bt3.splitlines(), 1):
    if "SAVRPG" in l:
        print(f"{i}: {l[:140]}")
print("--- cmake pin lines ---")
for i, l in enumerate(cm.read_text(encoding="utf-8").splitlines(), 1):
    if "219546" in l or "219426" in l:
        print(f"{i}: {l.strip()[:120]}")
print("done")
