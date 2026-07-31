#!/usr/bin/env python3
"""CORPSHOT proof: kill nearest mob -> corpse -> E loot -> [corp] CORPSE LOOTED."""
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
LOG = SHOTS / "corp_diag.txt"
PNG = SHOTS / "shot_corp.png"
ERR = SHOTS / "shot_corp_stderr.txt"
OUT = SHOTS / "shot_corp_stdout.txt"


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

    # Hub floor 0 has mobs. corp harness: face nearest, attackHeld, walk in,
    # then interact when corpse in 2.2m reach. 2400 frames ~40s at 60Hz —
    # enough for nav bake + walk + kill + loot.
    frames = 2400
    cmd = [
        str(EXE),
        "--shot",
        str(PNG),
        "--frames",
        str(frames),
        "--ride",
        "0",
        "--action",
        "corp",
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
            rc = proc.wait(timeout=600)
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
        "[corp]",
        "CORPSE LOOTED",
        "shot:",
        "FAILED",
        "ERROR",
        "[nav]",
        "[pop]",
        "melee",
        "death",
    )
    for line in text.splitlines():
        low = line.lower()
        if any(k.lower() in low for k in keys):
            log("  | " + line)

    has_loot = "[corp] CORPSE LOOTED" in text
    has_attack = "[corp] attack" in text
    has_corpse_reach = "[corp] corpse in reach" in text
    has_png = PNG.exists() and PNG.stat().st_size > 1000
    no_mob = "[corp] no live mob" in text

    log(
        f"has_attack={has_attack} has_corpse_reach={has_corpse_reach} "
        f"has_loot={has_loot} has_png={has_png} no_mob={no_mob}"
    )
    green = rc == 0 and has_png and has_loot
    log(f"PROOF={'GREEN' if green else 'RED'}")
    return 0 if green else 2


if __name__ == "__main__":
    sys.exit(main())
