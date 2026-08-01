# -*- coding: utf-8 -*-
"""Ship MAGSHOT docs + commit message. Writes BACKLOG/progress UTF-8."""
from pathlib import Path
import re
import subprocess
import sys

root = Path(r"C:\hades\gigahrush2")
bl_path = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
pr_path = root / ".agents" / "worker_game_audit" / "progress.md"
msg_path = root / "shots" / "_magshot_commit_msg.txt"

proof = """\
[mag] FORCE gun=4 name=<gun> mag=7/30 shots=42 hits=13
[mag] RIDE done=0 has=1 mag=7 weapon=4 shots=42 hits=13 ok=1
[mag] RIDE done=1 has=1 mag=7 weapon=4 shots=42 hits=13 ok=1
shot: saved -> shots/shot_mag.png (floor -8, 901 frames)
[mag] FINAL has=1 mag=7 weapon=4 shots=42 hits=13 rideDone=1
[mag] PROOF=GREEN"""

close_section = f"""
## CLOSED 2026-08-01 MAGSHOT + setvbuf QoL

### MAGSHOT — live PlayerRanged mag stamp across --ride
- Harness: `main.cpp` `--action mag` under `--shot`
  - Forces first single-pellet gun (magazine>=8, dmg>=20) + ammo into pool inventory
  - Stamps `PlayerRanged{{magCount=7, weapon=gun, shots=42, hits=13}}` once
  - Logs `[mag] FORCE`, `[mag] RIDE done=N ... ok=0|1` on each ride boundary,
    and `[mag] FINAL` + `PROOF=GREEN|RED` at capture
- Unit pin already owns pure body-swap (elevator FOR1/MAG1 / magCount==12);
  this is the live HUD/path proof that the same component survives a real hop
- No pin change (harness-only; no new CHECKs)

### Live proof (Release gigahrush2.exe, cwd repo root)
```
{proof}
```
Command: `gigahrush2.exe --shot shots/shot_mag.png --frames 900 --ride 1 --action mag`
(rc=0, ~31s, png ~2.7 MiB)

### setvbuf QoL
- `tests/game_test.cpp` `main()`: `setvbuf(stdout/stderr, nullptr, _IONBF, 0)`
  so redirected long runs show progress instead of looking hung on first suite

### Verdict
MAGSHOT CLOSED. OPEN required queue still empty. Stay off `src/render/**`.
Next OPEN: idle pull/push / re-PAR1 after foreign main; no invent.

"""

bl = bl_path.read_text(encoding="utf-8", errors="replace")

# Mark MAGSHOT row closed / remove from OPEN table
# Replace the P3 MAGSHOT table row if present
bl2 = bl
old_row = "| P3 | MAGSHOT | Optional: real-game HUD mag line across --ride | main.cpp foreign-aware | unit pin owns body-swap |"
new_row = "| P3 | MAGSHOT | **CLOSED 2026-08-01** live `--action mag` PROOF=GREEN (mag=7/shots=42/hits=13 across ride) | main.cpp harness | unit pin + live |"
if old_row in bl2:
    bl2 = bl2.replace(old_row, new_row)
    print("OK: replaced OPEN table MAGSHOT row")
else:
    # try softer match
    if "MAGSHOT" in bl2 and "| P3 | MAGSHOT |" in bl2:
        bl2 = re.sub(
            r"\| P3 \| MAGSHOT \|[^|\n]*\|[^|\n]*\|[^|\n]*\|",
            new_row,
            bl2,
            count=1,
        )
        print("OK: regex-replaced MAGSHOT row")
    else:
        print("WARN: MAGSHOT table row not found as expected")

# Append close section if not already
if "## CLOSED 2026-08-01 MAGSHOT" not in bl2:
    bl2 = bl2.rstrip() + "\n" + close_section
    print("OK: appended MAGSHOT close section")
else:
    print("SKIP: close section already present")

# Soften "MAGSHOT deferred" next-open lines at end-ish
bl2 = bl2.replace(
    "Next OPEN: MAGSHOT deferred (MELEEGRID CLOSED); stay off src/render/**.",
    "Next OPEN: idle (MAGSHOT CLOSED 2026-08-01); stay off src/render/**.",
)
bl2 = bl2.replace(
    "Next OPEN: MAGSHOT deferred (SAVMAG CLOSED)",
    "Next OPEN: idle (MAGSHOT CLOSED 2026-08-01)",
)
bl2 = bl2.replace("5. MAGSHOT still deferred", "5. MAGSHOT CLOSED 2026-08-01 (live harness)")

bl_path.write_text(bl2, encoding="utf-8", newline="\n")
print("WROTE", bl_path)

# progress.md append
pr = pr_path.read_text(encoding="utf-8", errors="replace") if pr_path.exists() else ""
entry = f"""
## 2026-08-01 MAGSHOT + setvbuf

- Shipped optional live harness `--action mag`: stamps distinctive PlayerRanged
  (mag=7, shots=42, hits=13) + gun/ammo; logs FORCE/RIDE/FINAL; PROOF=GREEN after
  `--ride 1` hop (floor -8, 901 frames). Elevator MAG1 unit pin unchanged.
- game_test main: unbuffered stdout/stderr via setvbuf (_IONBF) for redirected runs.
- Files: src/app/main.cpp, tests/game_test.cpp, BACKLOG.md, progress.md
- Proof:
```
{proof}
```
"""
if "## 2026-08-01 MAGSHOT" not in pr:
    pr = pr.rstrip() + "\n" + entry
    pr_path.write_text(pr, encoding="utf-8", newline="\n")
    print("WROTE", pr_path)
else:
    print("SKIP: progress entry exists")

msg = """feat(magshot): live --action mag PlayerRanged proof + game_test setvbuf

MAGSHOT harness under --shot stamps magCount=7/shots=42/hits=13 and gun+ammo,
logs [mag] FORCE/RIDE/FINAL, emits PROOF=GREEN after --ride hop (live verified).
Unit elevator MAG1 pin unchanged. game_test: unbuffered stdio for long redirects.
No pin change. Stay off src/render/**.
"""
msg_path.write_text(msg, encoding="utf-8", newline="\n")
print("WROTE", msg_path)
print("DONE")
