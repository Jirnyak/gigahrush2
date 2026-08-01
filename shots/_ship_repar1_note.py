# -*- coding: utf-8 -*-
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")
bl = root / ".agents/worker_game_audit/BACKLOG.md"
pr = root / ".agents/worker_game_audit/progress.md"
msg = root / "shots/_repar1_mag_commit_msg.txt"

note = """
## RE-PAR1 2026-08-01 ~10:45 — post-MAGSHOT travel seam re-grep (read-only)

11/11 OK, fails=0:
- place_body_safely ×2 in main (keyboard L2047 + --shot travel L5139)
- ai_release ×2 in main (keyboard leave L1971 + --shot leave L5063)
- floor_stream unload still calls ai_release
- elevator still restores PlayerRanged (hadRanged) + RpgStats
- QKILL wires present (quest_on_kill + quest_on_giver_died)
- MAGSHOT harness present (`--action mag` + PROOF lines)

No code change. OPEN required queue still empty. Stay off src/render/**.
"""

bt = bl.read_text(encoding="utf-8", errors="replace")
if "## RE-PAR1 2026-08-01 ~10:45" not in bt:
    bl.write_text(bt.rstrip() + "\n" + note, encoding="utf-8", newline="\n")
    print("WROTE BACKLOG RE-PAR1")
else:
    print("SKIP BACKLOG")

pt = pr.read_text(encoding="utf-8", errors="replace")
entry = """
## 2026-08-01 RE-PAR1 post-MAGSHOT
- Read-only travel seam re-grep: 11/11 OK (place_body_safely×2, ai_release×2 main + floor_stream, elevator mag/rpg, QKILL, MAGSHOT harness).
- No code change. OPEN still empty.
"""
if "## 2026-08-01 RE-PAR1 post-MAGSHOT" not in pt:
    pr.write_text(pt.rstrip() + "\n" + entry, encoding="utf-8", newline="\n")
    print("WROTE progress")
else:
    print("SKIP progress")

msg.write_text(
    "docs(audit): RE-PAR1 post-MAGSHOT travel seams still green (11/11)\n\n"
    "Read-only re-grep after MAGSHOT close: place_body_safely×2, ai_release×2,\n"
    "floor_stream release, elevator mag/rpg restore, QKILL+MAGSHOT harness present.\n"
    "No code change. OPEN queue empty.\n",
    encoding="utf-8",
    newline="\n",
)
print("DONE")
