"""Extract GT summary, fix CMake pin if needed, run rpgcmbt live shot."""
from pathlib import Path
import subprocess
import sys
import time
import re

root = Path(__file__).resolve().parents[1]
shots = root / "shots"
out_path = shots / "_attr1_fix_shot_out.txt"
lines = []

def log(s=""):
    print(s, flush=True)
    lines.append(s)

# --- parse GT ---
gt = (shots / "_game_test_attr1b.txt").read_text(encoding="utf-8", errors="replace")
count = None
fails = None
for l in gt.splitlines():
    m = re.search(r"game_test:\s*(\d+)\s+checks,\s*(\d+)\s+failures", l)
    if m:
        count = int(m.group(1))
        fails = int(m.group(2))
        log(f"GT: {l.strip()}")
    if l.startswith("EXIT:"):
        log(l.strip())
    if l.startswith("FAIL "):
        log("FAIL: " + l)

if count is None or fails is None:
    log("ERROR: no GT summary")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    sys.exit(2)

log(f"measured pin target: {count} checks, {fails} failures")
if fails != 0:
    log("ABORT: failures != 0")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    sys.exit(1)

# --- patch CMake pin if needed ---
cm = root / "CMakeLists.txt"
cm_text = cm.read_text(encoding="utf-8")
old_re = r'PASS_REGULAR_EXPRESSION "game_test: \d+ checks, 0 failures"'
new_pin = f'PASS_REGULAR_EXPRESSION "game_test: {count} checks, 0 failures"'
m = re.search(old_re, cm_text)
if not m:
    log("ERROR: pin line not found in CMakeLists")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    sys.exit(3)
cur = m.group(0)
if cur != new_pin:
    # also update changelog comment if 219425 mentioned
    cm_text2 = cm_text.replace(cur, new_pin)
    # bump note
    cm_text2 = cm_text2.replace(
        "AGIMV move mult live; suite_console +attr bits, suite_keybind +4; measured 219425.",
        f"AGIMV move mult live; suite_console +attr bits, suite_keybind +4; measured {count}.",
    )
    cm.write_text(cm_text2, encoding="utf-8")
    log(f"CMake pin updated: {cur} -> {new_pin}")
else:
    log(f"CMake pin already {count}")

# --- live shot ---
log("=== rpgcmbt live shot ===")
game = root / "build-win" / "Release" / "gigahrush2.exe"
shot = shots / "shot_rpgcmbt.png"
shot_log = shots / "_rpgcmbt_shot_log.txt"
if shot.exists():
    shot.unlink()
cmd = [
    str(game),
    "--shot", str(shot),
    "--frames", "900",
    "--ride", "0",
    "--action", "rpgcmbt",
]
t0 = time.time()
with open(shot_log, "w", encoding="utf-8", errors="replace") as f:
    sp = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=str(root), timeout=180)
dt = time.time() - t0
slog = shot_log.read_text(encoding="utf-8", errors="replace")
sz = shot.stat().st_size if shot.exists() else 0
log(f"shot exit={sp.returncode} elapsed={dt:.1f}s exists={shot.exists()} size={sz}")

# key lines
seen = set()
for l in slog.splitlines():
    for key in ("[rpgcmbt]", "[attr]", "error", "Error", "FAIL", "shot:"):
        if key in l and l not in seen:
            seen.add(l)
            log("  " + l[:200])

shot_ok = shot.exists() and sz > 1000
jpg_ok = False
if shot_ok:
    try:
        from PIL import Image
        jpg = shots / "shot_rpgcmbt.jpg"
        im = Image.open(shot).convert("RGB")
        q_used = 70
        for q in (70, 55, 40, 30):
            im.save(jpg, "JPEG", quality=q, optimize=True)
            q_used = q
            if jpg.stat().st_size < 150_000:
                break
        log(f"JPEG {jpg.name} size={jpg.stat().st_size} q={q_used}")
        jpg_ok = jpg.stat().st_size < 150_000
    except Exception as e:
        log(f"JPEG fail: {e}")

rpg_lines = [l for l in slog.splitlines() if "[rpgcmbt]" in l]
log(f"rpgcmbt_log_lines={len(rpg_lines)} shot_ok={shot_ok} jpg_ok={jpg_ok}")
proof = shot_ok and len(rpg_lines) > 0
log(f"PROOF={'GREEN' if proof else 'RED'}")

out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
sys.exit(0 if proof else 1)
