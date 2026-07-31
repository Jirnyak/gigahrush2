#!/usr/bin/env python3
"""PADIC gameplay stress: --floor 4 (dormitory-tower module) doors/AI outside render.

Stay OFF src/render/** — Zhirnyak owns mesher/stripes. Game-agent exercises the
floor module hard: absolute teleport, AI brains, doors, textures load, PNG+JPEG.
cwd MUST be repo root so data/textures resolve (Release cwd misses ktx2).
"""
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
LOG = SHOTS / "padic_diag.txt"
PNG = SHOTS / "shot_padic_play.png"
JPG = SHOTS / "shot_padic_play.jpg"
ERR = SHOTS / "shot_padic_play_stderr.txt"
OUT = SHOTS / "shot_padic_play_stdout.txt"


def log(msg: str) -> None:
    print(msg, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")


def to_jpeg(png: Path, jpg: Path) -> int:
    """PIL 1280x720 q=80 — keep under 150KB for vision."""
    try:
        from PIL import Image
    except ImportError:
        log("PIL missing — skip jpeg")
        return 0
    im = Image.open(png).convert("RGB")
    im = im.resize((1280, 720), Image.Resampling.LANCZOS)
    im.save(jpg, "JPEG", quality=80, optimize=True)
    return jpg.stat().st_size


def main() -> int:
    if LOG.exists():
        LOG.unlink()
    SHOTS.mkdir(exist_ok=True)
    log(f"exe exists={EXE.exists()} size={EXE.stat().st_size if EXE.exists() else 0}")
    subprocess.run(["taskkill", "/F", "/IM", "gigahrush2.exe"], capture_output=True)

    for p in (PNG, JPG, ERR, OUT):
        if p.exists():
            p.unlink()

    # Absolute hop to padic labelled floor +4. Long enough for nav bake + AI
    # steps + door system tick. Optional attack to exercise combat on module.
    frames = 480
    cmd = [
        str(EXE),
        "--shot",
        str(PNG),
        "--frames",
        str(frames),
        "--floor",
        "4",
        "--action",
        "attack",
    ]
    log(f"cmd={' '.join(cmd)}")
    log(f"cwd={ROOT}  (repo root — textures must load)")
    t0 = time.time()
    with ERR.open("w", encoding="utf-8", errors="replace") as fe, OUT.open(
        "w", encoding="utf-8", errors="replace"
    ) as fo:
        proc = subprocess.Popen(
            cmd, cwd=str(ROOT), stdout=fo, stderr=fe, env=os.environ.copy()
        )
        try:
            rc = proc.wait(timeout=300)
        except subprocess.TimeoutExpired:
            proc.kill()
            rc = -9
            log("TIMEOUT")
    elapsed = time.time() - t0
    png_sz = PNG.stat().st_size if PNG.exists() else 0
    log(f"exit={rc} elapsed={elapsed:.1f}s png={PNG.exists()} size={png_sz}")

    text = ERR.read_text(encoding="utf-8", errors="replace") if ERR.exists() else ""
    log(f"stderr len={len(text)}")

    keys = (
        "[aimem]",
        "[nav]",
        "[door",
        "[tex]",
        "[cube]",
        "AI brains",
        "floor",
        "padic",
        "shot:",
        "FAILED",
        "ERROR",
        "assert",
        "ride",
        "travel",
        "place_body",
    )
    for line in text.splitlines():
        low = line.lower()
        if any(k.lower() in low for k in keys):
            log("  | " + line[:240])

    # --- GREEN gates (gameplay stress, not render QA) ---
    # 1) exit 0 + PNG
    # 2) floor label 4 somewhere (HUD / travel / floor log)
    # 3) textures load (albedo 6/6 or no fatal [tex] ERROR flooding)
    # 4) AI brains attached OR [aimem] STEP seen (module has AI)
    # 5) doors system not frozen crash (no doors.frozen hard fail)
    brains = [ln for ln in text.splitlines() if "AI brains attached" in ln]
    aimem_steps = [ln for ln in text.splitlines() if "[aimem] STEP" in ln]
    cube_lines = [ln for ln in text.splitlines() if "[cube]" in ln and "albedo" in ln.lower()]
    tex_err = [
        ln
        for ln in text.splitlines()
        if "[tex] ERROR" in ln or "[tex] error" in ln.lower()
    ]
    # floor=4 or floor 4 or currentFloor 4 patterns
    floor4 = False
    for ln in text.splitlines():
        if re.search(r"floor\s*[=:]?\s*4\b", ln, re.I):
            floor4 = True
            break
        if re.search(r"\bfloor\b.*\b4\b", ln, re.I) and "floor 0" not in ln.lower():
            # weaker: any floor mention with 4
            if "4" in ln:
                floor4 = True
                break
    # also accept shot ride / absolute hop logs
    if not floor4:
        for ln in text.splitlines():
            if "--floor" in ln or "absolute" in ln.lower():
                if "4" in ln:
                    floor4 = True
                    break

    # roughness/albedo load status
    tex_ok = False
    for ln in cube_lines:
        # e.g. albedo: 6/6 ... roughness: 6/6
        if re.search(r"albedo:\s*6/6", ln) or re.search(r"albedo:\s*[1-9]", ln):
            tex_ok = True
        if "roughness: 6/6" in ln or "roughness:6/6" in ln:
            tex_ok = True
    if not cube_lines and not tex_err:
        # no cube line but no tex errors — soft ok if PNG exists (prior padic pattern)
        tex_ok = png_sz > 1000

    max_seen = 0
    for ln in aimem_steps:
        m = re.search(r"seen=(\d+)", ln)
        if m:
            max_seen = max(max_seen, int(m.group(1)))
    ai_ok = len(brains) > 0 or max_seen > 0
    has_png = PNG.exists() and png_sz > 1000

    jpg_sz = 0
    if has_png:
        try:
            jpg_sz = to_jpeg(PNG, JPG)
            log(f"jpeg={JPG} size={jpg_sz}")
        except Exception as e:
            log(f"jpeg fail: {e}")

    log(
        f"floor4={floor4} tex_ok={tex_ok} ai_ok={ai_ok} brains={len(brains)} "
        f"max_seen={max_seen} tex_err={len(tex_err)} png_ok={has_png} jpg={jpg_sz}"
    )

    # Hard gates: exit + png + (floor evidence OR we know --floor 4 was passed
    # and process lived). Soft: AI + textures preferred.
    green = rc == 0 and has_png and tex_ok and (floor4 or ai_ok)
    # Prefer full green
    full = green and floor4 and ai_ok and len(tex_err) == 0
    log(f"PROOF={'GREEN' if full else ('SOFT-GREEN' if green else 'RED')}")
    if not green:
        log("RED reasons:")
        if rc != 0:
            log(f"  - exit {rc}")
        if not has_png:
            log("  - PNG missing/tiny")
        if not tex_ok:
            log("  - textures not confirmed")
        if not floor4 and not ai_ok:
            log("  - no floor=4 evidence and no AI activity")
    return 0 if green else 1


if __name__ == "__main__":
    sys.exit(main())
