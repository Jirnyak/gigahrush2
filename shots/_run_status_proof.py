#!/usr/bin/env python3
"""STATUS proof: --action status applies ZhelemishSkin+PaupsinaWeb, ticks mults."""
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
LOG = SHOTS / "status_diag.txt"
PNG = SHOTS / "shot_status.png"
ERR = SHOTS / "shot_status_stderr.txt"
OUT = SHOTS / "shot_status_stdout.txt"


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

    # Short run: apply zh+web on first frames, tick mults, capture PNG.
    # 480 frames ~8s — enough for APPLY + several [status] tick lines.
    frames = 480
    cmd = [
        str(EXE),
        "--shot",
        str(PNG),
        "--frames",
        str(frames),
        "--ride",
        "0",
        "--action",
        "status",
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
            rc = proc.wait(timeout=300)
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
        "[status]",
        "APPLY",
        "move_e3",
        "rooted",
        "shot:",
        "FAILED",
        "ERROR",
        "assert",
    )
    for line in text.splitlines():
        low = line.lower()
        if any(k.lower() in low for k in keys):
            log("  | " + line)

    has_apply = "[status] APPLY" in text
    has_tick = "[status] tick" in text
    # move_e3 must not stay at full 1000 after zh+web (web roots / slows)
    move_ok = False
    rooted_ok = False
    for line in text.splitlines():
        if "[status] APPLY" in line or "[status] tick" in line:
            if "move_e3=" in line:
                try:
                    part = line.split("move_e3=")[1].split()[0].rstrip(",")
                    mv = int(part)
                    if mv != 1000:
                        move_ok = True
                except (IndexError, ValueError):
                    pass
            if "rooted=1" in line:
                rooted_ok = True

    has_png = PNG.exists() and PNG.stat().st_size > 1000

    log(
        f"has_apply={has_apply} has_tick={has_tick} move_ok={move_ok} "
        f"rooted_ok={rooted_ok} has_png={has_png}"
    )
    green = rc == 0 and has_png and has_apply and has_tick and move_ok
    log(f"PROOF={'GREEN' if green else 'RED'}")
    return 0 if green else 2


if __name__ == "__main__":
    sys.exit(main())
