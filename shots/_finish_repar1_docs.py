# -*- coding: utf-8 -*-
"""Document re-PAR1 GREEN after SAVSTAT; light progress cycle note."""
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
BL = ROOT / ".agents" / "worker_game_audit" / "BACKLOG.md"
PR = ROOT / ".agents" / "worker_game_audit" / "progress.md"

BL_SEC = """
## RE-PAR1 2026-08-01 ~03:08 — post-SAVSTAT travel seam re-grep (read-only)
```
main.cpp lines=5016 bytes=289705
place_body_safely @1985 (keyboard do_ride) + @4954 (--shot travel)  GREEN
ai_release        @1910 (keyboard leave)  + @4879 (--shot leave)     GREEN
SAVSTAT F5/F9: runState.status = playerStatus @1865; load @3599       GREEN
combatCarves / playerStatus / status_step / ctl->fly=false @2360 intact
elevator.cpp: hadRanged=3 hadMelee=3 hadRpg=3 emplace_or_replace=4
HUD mag already live: ImGui gun line %u/%u mag @4005 (PlayerRanged)
No main.cpp edit. No hole.
```
MAGSHOT remains optional polish (unit pin owns mag body-swap FOR1/MAG1).
Open lane queue empty of required defects; stay off src/render/**.
"""

PR_INS = """## Cycle report (2026-08-01 ~03:08) - re-PAR1 GREEN (post-SAVSTAT)
- [x] SAVSTAT pushed **6e36b09** (tests+CMake+docs; core was 1c3c204)
- [x] re-PAR1: PBS @1985/@4954 + ai_release @1910/@4879 GREEN
- [x] SAVSTAT F5@1865 / F9@3599 status wire intact; kSaveVersion=9
- [x] MAGSHOT deferred optional (HUD mag already @4005)
- [ ] idle: pull/push loop; re-PAR1 after next foreign main thrash

"""


def main() -> None:
    bl = BL.read_text(encoding="utf-8")
    if "RE-PAR1 2026-08-01" not in bl:
        if not bl.endswith("\n"):
            bl += "\n"
        BL.write_text(bl + BL_SEC, encoding="utf-8")
        print("BACKLOG: appended re-PAR1")
    else:
        print("BACKLOG: re-PAR1 already present")

    pr = PR.read_text(encoding="utf-8")
    if "re-PAR1 GREEN (post-SAVSTAT)" not in pr:
        lines = pr.splitlines(keepends=True)
        if lines and lines[0].startswith("# progress"):
            if len(lines) > 1 and lines[1].strip() == "":
                out = lines[0] + lines[1] + PR_INS + "".join(lines[2:])
            else:
                out = lines[0] + "\n" + PR_INS + "".join(lines[1:])
            PR.write_text(out, encoding="utf-8")
        else:
            PR.write_text(PR_INS + pr, encoding="utf-8")
        print("progress: inserted re-PAR1 cycle")
    else:
        print("progress: re-PAR1 already present")

    print("ok", "RE-PAR1 2026-08-01" in BL.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
