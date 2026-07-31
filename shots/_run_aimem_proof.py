#!/usr/bin/env python3
"""AIMEM proof: AiMemory passed to ai_step + ai_release on floor leave/unload."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
REL = ROOT / "build-win" / "Release"
EXE = REL / "gigahrush2.exe"
SHOTS = ROOT / "shots"
DATA_SRC = ROOT / "data"
LOG = SHOTS / "aimem_diag.txt"
PNG = SHOTS / "shot_aimem.png"
ERR = SHOTS / "shot_aimem_stderr.txt"
OUT = SHOTS / "shot_aimem_stdout.txt"


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

    # Ride 1 floor so LEAVE + RELEASE fire; long enough for nav bake + AI steps.
    # Ride fires every 420 frames when shotRideDone < shotRide.
    frames = 900
    cmd = [
        str(EXE),
        "--shot",
        str(PNG),
        "--frames",
        str(frames),
        "--ride",
        "1",
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
        "[aimem]",
        "[nav]",
        "AI brains",
        "shot:",
        "FAILED",
        "ERROR",
        "assert",
    )
    for line in text.splitlines():
        low = line.lower()
        if any(k.lower() in low for k in keys):
            log("  | " + line)

    steps = [ln for ln in text.splitlines() if "[aimem] STEP" in ln]
    leaves = [ln for ln in text.splitlines() if "[aimem] LEAVE" in ln]
    releases = [ln for ln in text.splitlines() if "[aimem] RELEASE" in ln]
    brains = [ln for ln in text.splitlines() if "AI brains attached" in ln]

    log(f"count STEP={len(steps)} LEAVE={len(leaves)} RELEASE={len(releases)} brains={len(brains)}")

    # GREEN gates:
    # 1) at least one STEP with seen>0 (ai_step live with brains)
    # 2) at least one LEAVE or RELEASE (floor leave path wired)
    # 3) PNG captured
    seen_ok = False
    max_seen = 0
    for ln in steps:
        m = re.search(r"seen=(\d+)", ln)
        if m:
            v = int(m.group(1))
            if v > max_seen:
                max_seen = v
            if v > 0:
                seen_ok = True
    leave_ok = len(leaves) > 0 or len(releases) > 0
    has_png = PNG.exists() and PNG.stat().st_size > 1000
    brains_ok = len(brains) > 0

    log(f"max_seen={max_seen} seen_ok={seen_ok} leave_ok={leave_ok} brains_ok={brains_ok} png_ok={has_png}")

    green = seen_ok and leave_ok and has_png and brains_ok and rc == 0
    log(f"PROOF={'GREEN' if green else 'RED'}")
    if not green:
        log("RED reasons:")
        if not seen_ok:
            log("  - no [aimem] STEP with seen>0 (ai_step dormant or no brains)")
        if not leave_ok:
            log("  - no [aimem] LEAVE/RELEASE (ride/unload path not hit)")
        if not brains_ok:
            log("  - no AI brains attached log")
        if not has_png:
            log("  - PNG missing or tiny")
        if rc != 0:
            log(f"  - exit code {rc}")
    return 0 if green else 1


if __name__ == "__main__":
    sys.exit(main())
