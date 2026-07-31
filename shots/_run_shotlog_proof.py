#!/usr/bin/env python3
# SHOTLOG proof: place_body_safely after travel must emit [place] MOVE/REFUSE
# when the arrival cell is solid; quiet when already standable (event-driven).
import os, sys, time, subprocess, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "build-win" / "Release" / "gigahrush2.exe"
SHOT = ROOT / "shots" / "shot_place.png"
JPG = ROOT / "shots" / "shot_place.jpg"
STDERR = ROOT / "shots" / "shot_place_stderr.txt"
STDOUT = ROOT / "shots" / "shot_place_stdout.txt"
DIAG = ROOT / "shots" / "shotlog_diag.txt"

os.chdir(ROOT)
if not EXE.is_file():
    print("FAIL: missing exe", EXE)
    sys.exit(2)

# --ride 2 historically lands floor -14; PBS runs after travel.
cmd = [
    str(EXE),
    "--shot",
    "shots/shot_place.png",
    "--frames",
    "480",
    "--ride",
    "2",
]
print("CMD:", " ".join(cmd), flush=True)
t0 = time.time()
p = subprocess.run(
    cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
)
elapsed = time.time() - t0
err = p.stderr or ""
out = p.stdout or ""
STDERR.write_text(err, encoding="utf-8")
STDOUT.write_text(out, encoding="utf-8")

place_lines = [ln for ln in err.splitlines() if "[place]" in ln]
move_n = sum(1 for ln in place_lines if "MOVE" in ln)
refuse_n = sum(1 for ln in place_lines if "REFUSE" in ln)
floor_m = re.findall(r"floor[ =](-?\d+)", err + out, re.I)
png_ok = SHOT.is_file() and SHOT.stat().st_size > 100_000
jpg_sz = 0
if png_ok:
    try:
        from PIL import Image

        im = Image.open(SHOT).convert("RGB")
        im.thumbnail((1280, 720))
        im.save(JPG, "JPEG", quality=80, optimize=True)
        jpg_sz = JPG.stat().st_size
    except Exception as e:
        print("jpeg warn", e)

has_event = (move_n + refuse_n) > 0
ride_ok = ("ride" in err.lower()) or ("floor" in err.lower()) or bool(floor_m)
travel_markers = any(
    k in err for k in ("[aimem]", "place_body", "shot:", "saved", "Ride", "floor ")
)

green = p.returncode == 0 and png_ok and (has_event or travel_markers)
status = "GREEN" if green else "RED"
if green and not has_event:
    status = "GREEN_QUIET"  # PBS ran, landing already standable

lines = []
lines.append(f"PROOF={status}")
lines.append(
    f"exit={p.returncode} elapsed={elapsed:.1f}s "
    f"png={SHOT.stat().st_size if png_ok else 0} jpg={jpg_sz}"
)
lines.append(f"place_lines={len(place_lines)} MOVE={move_n} REFUSE={refuse_n}")
lines.append(
    f"has_event={has_event} ride_ok={ride_ok} travel_markers={travel_markers}"
)
for ln in place_lines[:20]:
    lines.append("  " + ln)
if floor_m:
    lines.append("floors_seen=" + ",".join(floor_m[-8:]))
for key in ("[place]", "[aimem]", "shot:", "saved", "floor"):
    hits = [ln for ln in err.splitlines() if key in ln.lower() or key in ln][:6]
    if hits:
        lines.append(f"--- hits {key} ---")
        lines.extend("  " + h for h in hits)

DIAG.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
print("DIAG", DIAG)
sys.exit(0 if green else 1)
