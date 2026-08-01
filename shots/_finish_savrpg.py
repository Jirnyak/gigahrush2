from pathlib import Path
import re
import subprocess
import sys

root = Path(r"C:\hades\gigahrush2")

# --- CMake pin ---
cm = root / "CMakeLists.txt"
text = cm.read_text(encoding="utf-8")
old = 'PASS_REGULAR_EXPRESSION "game_test: 219426 checks, 0 failures"'
new = 'PASS_REGULAR_EXPRESSION "game_test: 219546 checks, 0 failures"'
if old not in text:
    # try find current pin
    m = re.search(r'PASS_REGULAR_EXPRESSION "game_test: (\d+) checks, 0 failures"', text)
    print("current pin:", m.group(0) if m else "NONE")
    if not m:
        sys.exit(1)
    text2 = text.replace(m.group(0), new.split("PASS")[0] + 'PASS_REGULAR_EXPRESSION "game_test: 219546 checks, 0 failures"')
    # simpler
    text2 = re.sub(
        r'PASS_REGULAR_EXPRESSION "game_test: \d+ checks, 0 failures"',
        'PASS_REGULAR_EXPRESSION "game_test: 219546 checks, 0 failures"',
        text,
        count=1,
    )
else:
    text2 = text.replace(old, new)

# also update the comment near the pin
text2 = re.sub(
    r"measured 219426\.",
    "measured 219546 (SAVRPG +120 saveload CHECKs).",
    text2,
)
if "219546" not in text2:
    print("FAILED to pin cmake")
    sys.exit(1)
cm.write_text(text2, encoding="utf-8", newline="\n")
print("cmake pinned 219546")

# --- BACKLOG ---
bl = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
bt = bl.read_text(encoding="utf-8")
# Find SAVRPG section and mark CLOSED
# Dump relevant lines
for i, l in enumerate(bt.splitlines(), 1):
    if "SAVRPG" in l or "ATTR1" in l or "OPEN NEXT" in l or "ACTIVE" in l:
        print(f"BL {i}: {l}")

# Replace OPEN SAVRPG with CLOSED block if present
closed_block = (
    "### SAVRPG — CLOSED 2026-07-31\n"
    "- kSaveVersion 6→7: RpgStats (12 B) + CraftingState (93 B) on the wire.\n"
    "- F5 captures live RpgStats (else carriedRpg) + crafting; F9 restores both.\n"
    "- suite_saveload busy_run/same_run/wire_layout pin 829/929/944 + field CHECKs.\n"
    "- game_test: 219546 checks, 0 failures (was 219426; +120 saveload).\n"
)

if "SAVRPG" in bt:
    # If already has a SAVRPG heading, rewrite that section's status
    if "SAVRPG — CLOSED" in bt or "SAVRPG CLOSED" in bt:
        print("SAVRPG already closed in backlog")
    else:
        # Try common patterns
        patterns = [
            (r"(###?\s*SAVRPG[^\n]*\n)(.*?)(?=\n###|\n## |\Z)", closed_block + "\n"),
            (r"(- \[ \][^\n]*SAVRPG[^\n]*)", "- [x] SAVRPG CLOSED (kSaveVersion 7, 219546 checks)"),
            (r"(SAVRPG[^\n]*OPEN[^\n]*)", "SAVRPG — CLOSED 2026-07-31 (v7, 219546 checks)"),
        ]
        new_bt = bt
        for pat, rep in patterns:
            n2, n = re.subn(pat, rep, new_bt, count=1, flags=re.S)
            if n:
                new_bt = n2
                print(f"matched pattern {pat[:40]}")
                break
        else:
            # append closed block near top after first heading
            new_bt = bt.rstrip() + "\n\n" + closed_block + "\n"
            print("appended CLOSED block")
        bl.write_text(new_bt, encoding="utf-8", newline="\n")
else:
    bl.write_text(bt.rstrip() + "\n\n" + closed_block + "\n", encoding="utf-8", newline="\n")
    print("appended SAVRPG CLOSED (no prior mention)")

# show post-edit SAVRPG lines
bt2 = bl.read_text(encoding="utf-8")
for i, l in enumerate(bt2.splitlines(), 1):
    if "SAVRPG" in l:
        print(f"BL2 {i}: {l}")

print("done finish_savrpg")
