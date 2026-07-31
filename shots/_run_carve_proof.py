#!/usr/bin/env python3
"""CARVE proof: --action wall holds melee so combat proposes carve_sphere chips."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
REL = ROOT / "build-win" / "Release"
EXE = REL / "gigahrush2.exe"
SHOTS = ROOT / "shots"
DATA_SRC = ROOT / "data"
LOG = SHOTS / "carve_diag.txt"
PNG = SHOTS / "shot_carve.png"
ERR = SHOTS / "shot_carve_stderr.txt"
OUT = SHOTS / "shot_carve_stdout.txt"


def log(msg: str) -> None:
    print(msg, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")


def ensure_data() -> None:
    data_link = REL / "data"
    if data_link.exists():
        log(f"data present at {data_link}")
        return
    try:
        subprocess.check_call(
            ["cmd", "/c", "mklink", "/J", str(data_link), str(DATA_SRC)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log(f"junction {data_link} -> {DATA_SRC}")
    except Exception as e:
        log(f"junction failed: {e}")


def main() -> int:
    if LOG.exists():
        LOG.unlink()
    SHOTS.mkdir(exist_ok=True)
    log(f"exe exists={EXE.exists()} size={EXE.stat().st_size if EXE.exists() else 0}")
    ensure_data()
    subprocess.run(["taskkill", "/F", "/IM", "gigahrush2.exe"], capture_output=True)

    for p in (PNG, ERR, OUT):
        if p.exists():
            p.unlink()

    # Long enough for nav bake (~3.7s) + many melee swings into a wall.
    # wall action starts at frame 30 and only when !doors.frozen.
    frames = 1200
    cmd = [
        str(EXE),
        "--shot",
        str(PNG),
        "--frames",
        str(frames),
        "--ride",
        "0",
        "--action",
        "wall",
    ]
    log(f"cmd={' '.join(cmd)}")
    t0 = time.time()
    with ERR.open("w", encoding="utf-8", errors="replace") as fe, OUT.open(
        "w", encoding="utf-8", errors="replace"
    ) as fo:
        proc = subprocess.Popen(
            cmd, cwd=str(REL), stdout=fo, stderr=fe, env=os.environ.copy()
        )
        try:
            rc = proc.wait(timeout=420)
        except subprocess.TimeoutExpired:
            proc.kill()
            rc = -9
            log("TIMEOUT")
    log(
        f"exit={rc} elapsed={time.time()-t0:.1f}s "
        f"png={PNG.exists()} size={PNG.stat().st_size if PNG.exists() else 0}"
    )

    text = ERR.read_text(encoding="utf-8", errors="replace") if ERR.exists() else ""
    log(f"stderr len={len(text)}")
    keys = (
        "[carve]",
        "[wall]",
        "COMBAT",
        "shot:",
        "FAILED",
        "ERROR",
        "assert",
        "frozen",
    )
    for line in text.splitlines():
        low = line.lower()
        if any(k.lower() in low for k in keys):
            log("  | " + line)

    has_combat_carve = "[carve] COMBAT" in text
    has_wall = "[wall]" in text
    has_png = PNG.exists() and PNG.stat().st_size > 1000
    removed_ok = False
    if has_combat_carve:
        for line in text.splitlines():
            if "[carve] COMBAT" in line and "removed=" in line:
                try:
                    part = line.split("removed=")[1].split()[0]
                    if int(part) > 0:
                        removed_ok = True
                        break
                except (IndexError, ValueError):
                    pass

    log(
        f"has_combat_carve={has_combat_carve} removed_ok={removed_ok} "
        f"has_wall={has_wall} has_png={has_png}"
    )
    # GREEN: process ok, PNG written, combat carve path disposed at least once
    # with removed>0 (real geometry change, not just a proposal drop).
    green = rc == 0 and has_png and has_combat_carve and removed_ok
    log(f"PROOF={'GREEN' if green else 'RED'}")
    return 0 if green else 2


if __name__ == "__main__":
    sys.exit(main())
