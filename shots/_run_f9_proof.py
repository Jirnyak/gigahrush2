#!/usr/bin/env python3
"""Two-phase F9 proof: ride+save on deep floor, then fresh process load+shot."""
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
SAV = REL / "gigahrush2.sav"
DATA_SRC = ROOT / "data"
LOG = SHOTS / "f9_diag.txt"


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


def run_shot(
    png: Path,
    err: Path,
    out: Path,
    *,
    frames: int = 900,
    ride: int = 0,
    action: str | None = None,
    timeout: int = 360,
) -> int:
    if png.exists():
        png.unlink()
    for p in (err, out):
        if p.exists():
            p.unlink()
    cmd = [str(EXE), "--shot", str(png), "--frames", str(frames), "--ride", str(ride)]
    if action:
        cmd += ["--action", action]
    log(f"cmd={' '.join(cmd)}")
    t0 = time.time()
    with err.open("w", encoding="utf-8", errors="replace") as fe, out.open(
        "w", encoding="utf-8", errors="replace"
    ) as fo:
        proc = subprocess.Popen(cmd, cwd=str(REL), stdout=fo, stderr=fe, env=os.environ.copy())
        try:
            rc = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            rc = -9
            log("TIMEOUT")
    log(
        f"exit={rc} elapsed={time.time()-t0:.1f}s "
        f"png={png.exists()} size={png.stat().st_size if png.exists() else 0}"
    )
    return rc


def summarize(err: Path, keys: tuple[str, ...]) -> None:
    if not err.exists():
        log(f"missing {err}")
        return
    text = err.read_text(encoding="utf-8", errors="replace")
    log(f"{err.name} len={len(text)}")
    for line in text.splitlines():
        low = line.lower()
        if any(k.lower() in low for k in keys):
            log("  | " + line)


def main() -> int:
    if LOG.exists():
        LOG.unlink()
    SHOTS.mkdir(exist_ok=True)
    log(f"exe exists={EXE.exists()} size={EXE.stat().st_size if EXE.exists() else 0}")
    ensure_data()
    subprocess.run(["taskkill", "/F", "/IM", "gigahrush2.exe"], capture_output=True)
    if SAV.exists():
        SAV.unlink()
        log("deleted old sav")

    # Phase 1: ride hub -> -8 -> -14, then one-shot save on deep floor.
    # ride=2 fires at frames 420 and 840; save needs rideDone>=2 and frames>=30.
    # frames=900 gives ~60 frames after second ride for save + settle + capture.
    rc1 = run_shot(
        SHOTS / "shot_f9_save.png",
        SHOTS / "shot_f9_save_stderr.txt",
        SHOTS / "shot_f9_save_stdout.txt",
        frames=900,
        ride=2,
        action="save",
    )
    log(f"sav after save: exists={SAV.exists()} size={SAV.stat().st_size if SAV.exists() else 0}")
    summarize(
        SHOTS / "shot_f9_save_stderr.txt",
        ("[save]", "shot:", "floor", "FAILED", "ERROR", "[nav]", "[pop]"),
    )
    if rc1 != 0 or not SAV.exists():
        log("PHASE1 FAIL")
        return 1

    # Phase 2: fresh process on hub (ride=0). After 30 frames, --action load fires,
    # travel_to_saved_floor hops to -14, place_body_at_cell, stderr [load] line, shot.
    # frames=900 leaves time for multi-hop load travel + nav bake + capture.
    rc2 = run_shot(
        SHOTS / "shot_f9_load.png",
        SHOTS / "shot_f9_load_stderr.txt",
        SHOTS / "shot_f9_load_stdout.txt",
        frames=900,
        ride=0,
        action="load",
    )
    summarize(
        SHOTS / "shot_f9_load_stderr.txt",
        ("[load]", "[save]", "shot:", "floor", "FAILED", "ERROR", "[nav]", "loaded"),
    )
    ok = (
        rc1 == 0
        and rc2 == 0
        and SAV.exists()
        and (SHOTS / "shot_f9_save.png").exists()
        and (SHOTS / "shot_f9_load.png").exists()
    )
    s1 = (SHOTS / "shot_f9_save_stderr.txt").read_text(encoding="utf-8", errors="replace")
    s2 = (SHOTS / "shot_f9_load_stderr.txt").read_text(encoding="utf-8", errors="replace")
    has_save = "[save]" in s1 and "saved:" in s1
    has_load = "[load]" in s2 and "loaded" in s2.lower()
    # Capture floor should be -14 on both if F9 worked
    save_floor = None
    load_floor = None
    for line in s1.splitlines():
        if line.startswith("shot:"):
            log(f"save capture: {line}")
            if "floor -14" in line:
                save_floor = -14
    for line in s2.splitlines():
        if line.startswith("shot:"):
            log(f"load capture: {line}")
            if "floor -14" in line:
                load_floor = -14
    log(f"has_save_line={has_save} has_load_line={has_load} save_floor={save_floor} load_floor={load_floor}")
    green = ok and has_save and has_load and save_floor == -14 and load_floor == -14
    log(f"PROOF={'GREEN' if green else 'RED'}")
    return 0 if green else 2


if __name__ == "__main__":
    sys.exit(main())
