#!/usr/bin/env python3
"""Run gigahrush2 --shot with correct cwd/data layout; analyze result."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")
REL = ROOT / "build-win" / "Release"
EXE = REL / "gigahrush2.exe"
SHOTS = ROOT / "shots"
PNG = SHOTS / "shot_travel.png"
ERR = SHOTS / "shot_travel_stderr.txt"
OUT = SHOTS / "shot_travel_stdout.txt"
LOG = SHOTS / "diag.txt"
DATA_SRC = ROOT / "data"


def log(msg: str) -> None:
    print(msg, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")


def main() -> int:
    if LOG.exists():
        LOG.unlink()
    SHOTS.mkdir(exist_ok=True)
    log(f"exe exists={EXE.exists()} size={EXE.stat().st_size if EXE.exists() else 0}")
    log(f"data src={DATA_SRC} exists={DATA_SRC.exists()}")
    # Ensure Release can see data/ relative path
    data_link = REL / "data"
    if not data_link.exists():
        # prefer junction
        try:
            subprocess.check_call(
                ["cmd", "/c", "mklink", "/J", str(data_link), str(DATA_SRC)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            log(f"created junction {data_link} -> {DATA_SRC}")
        except Exception as e:
            log(f"junction failed: {e}; trying copytree skip")
    else:
        log(f"data already present at {data_link}")

    # Also check shaders path (GIGA_SHADER_DIR may be compile-time)
    for name in ("shaders", "assets"):
        p = REL / name
        src = ROOT / name
        log(f"{name}: release={p.exists()} root={src.exists()}")

    # Kill leftover gigahrush2
    subprocess.run(["taskkill", "/F", "/IM", "gigahrush2.exe"], capture_output=True)

    if PNG.exists():
        PNG.unlink()
    for p in (ERR, OUT):
        if p.exists():
            p.unlink()

    # Prefer cwd=repo root so data/textures resolves; many builds use GIGA_SHADER_DIR absolute
    cwd = str(ROOT)
    env = os.environ.copy()
    # Some builds look relative to exe; run from Release with data junction
    cwd = str(REL)

    cmd = [
        str(EXE),
        "--shot",
        str(PNG),
        "--frames",
        "900",
        "--ride",
        "2",
    ]
    log(f"cmd={' '.join(cmd)}")
    log(f"cwd={cwd}")
    t0 = time.time()
    with ERR.open("w", encoding="utf-8", errors="replace") as fe, OUT.open(
        "w", encoding="utf-8", errors="replace"
    ) as fo:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=fo,
            stderr=fe,
            env=env,
        )
        try:
            rc = proc.wait(timeout=360)
        except subprocess.TimeoutExpired:
            proc.kill()
            rc = -9
            log("TIMEOUT killed after 360s")
    dt = time.time() - t0
    log(f"exit={rc} elapsed={dt:.1f}s")
    log(f"png exists={PNG.exists()} size={PNG.stat().st_size if PNG.exists() else 0}")

    err_text = ERR.read_text(encoding="utf-8", errors="replace")
    out_text = OUT.read_text(encoding="utf-8", errors="replace") if OUT.exists() else ""
    log(f"stderr_len={len(err_text)} stdout_len={len(out_text)}")
    # key lines
    for key in (
        "shot:",
        "place_body",
        "floor",
        "FAILED",
        "population",
        "[pop]",
        "[nav]",
        "gpu-ms",
        "error",
        "ERROR",
        "abort",
        "Assertion",
    ):
        hits = [ln for ln in err_text.splitlines() if key.lower() in ln.lower()]
        if hits:
            log(f"--- matches {key!r} ({len(hits)}) ---")
            for ln in hits[-20:]:
                log(ln)

    log("--- STDERR TAIL ---")
    for ln in err_text.splitlines()[-60:]:
        log(ln)
    if out_text.strip():
        log("--- STDOUT TAIL ---")
        for ln in out_text.splitlines()[-30:]:
            log(ln)

    # PNG basic analysis
    if PNG.exists() and PNG.stat().st_size > 100:
        try:
            from PIL import Image  # type: ignore

            im = Image.open(PNG)
            log(f"PNG {im.size} mode={im.mode}")
            # sample center + corners brightness
            px = im.convert("RGB")
            w, h = px.size
            samples = [
                (w // 2, h // 2),
                (w // 4, h // 2),
                (3 * w // 4, h // 2),
                (w // 2, h // 4),
                (w // 2, 3 * h // 4),
            ]
            for x, y in samples:
                log(f"  sample ({x},{y})={px.getpixel((x, y))}")
        except Exception as e:
            log(f"PIL analyze failed: {e}; raw header={PNG.read_bytes()[:16]!r}")

    return 0 if PNG.exists() and rc == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
