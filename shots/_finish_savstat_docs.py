# -*- coding: utf-8 -*-
"""Append SAVSTAT CLOSED section + progress cycle report if missing."""
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
BL = ROOT / ".agents" / "worker_game_audit" / "BACKLOG.md"
PR = ROOT / ".agents" / "worker_game_audit" / "progress.md"

BL_SEC = """
## CLOSED 2026-08-01 SAVSTAT -- F5/F9 StatusSet active status effects
```
kSaveVersion 8 -> 9
wire: visit_status field-by-field (NOT sizeof)
  6xu32 remainMs + 6xu16 intensityE3 + 6xu8 alt = kStatusWire 42
kSaveFixedWire 850 -> 892; empty 992; busy 3-opened 1007
F5: runState.status = playerStatus; F9: playerStatus = runState.status
suite_saveload busy/same/wire; game_test 219711 (was 219621; +90)
Core 1c3c204; this commit tests+CMake+docs
pathspec: tests/suite_saveload.inl CMakeLists.txt BACKLOG.md progress.md
```
Next OPEN: MAGSHOT deferred (SAVSTAT CLOSED); stay off src/render/**
"""

PR_INS = """## Cycle report (2026-08-01 ~03:04) - SAVSTAT CLOSED
- [x] SAVSTAT: F5/F9 StatusSet persist (kSaveVersion 9, +42 wire)
- [x] suite_saveload busy_run/same_run/wire_layout pins
- [x] game_test GREEN **219711 checks, 0 failures** (was 219621; +90)
- [x] CMake pin 219621 -> 219711
- [x] BACKLOG CLOSED table + SAVSTAT section; pathspec commit

"""

def main() -> None:
    bl = BL.read_text(encoding="utf-8")
    if "CLOSED 2026-08-01 SAVSTAT" not in bl:
        if not bl.endswith("\n"):
            bl += "\n"
        BL.write_text(bl + BL_SEC, encoding="utf-8")
        print("BACKLOG: appended SAVSTAT CLOSED")
    else:
        print("BACKLOG: SAVSTAT CLOSED already present")

    pr = PR.read_text(encoding="utf-8")
    if "SAVSTAT CLOSED" not in pr:
        lines = pr.splitlines(keepends=True)
        if lines and lines[0].startswith("# progress"):
            # insert after title line
            new = [lines[0]]
            if len(lines) > 1 and lines[1].strip() == "":
                new.append(lines[1])
                rest = lines[2:]
            else:
                rest = lines[1:]
            new.append("\n" if not new[-1].endswith("\n") else "")
            # ensure blank line after title block
            body = PR_INS
            if not body.endswith("\n"):
                body += "\n"
            out = "".join(new[:1])
            # title + blank + insert + rest
            if len(lines) > 1 and lines[1].strip() == "":
                out = lines[0] + lines[1] + body + "".join(lines[2:])
            else:
                out = lines[0] + "\n" + body + "".join(lines[1:])
            PR.write_text(out, encoding="utf-8")
        else:
            PR.write_text(PR_INS + pr, encoding="utf-8")
        print("progress: inserted SAVSTAT cycle report")
    else:
        print("progress: SAVSTAT already present")

    bl2 = BL.read_text(encoding="utf-8")
    pr2 = PR.read_text(encoding="utf-8")
    print("BL has CLOSED SAVSTAT:", "CLOSED 2026-08-01 SAVSTAT" in bl2)
    print("PR has SAVSTAT CLOSED:", "SAVSTAT CLOSED" in pr2)
    # tail/head peek
    print("--- BACKLOG tail ---")
    print("\n".join(bl2.splitlines()[-12:]))
    print("--- progress head ---")
    print("\n".join(pr2.splitlines()[:20]))


if __name__ == "__main__":
    main()
