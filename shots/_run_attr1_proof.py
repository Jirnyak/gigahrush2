"""Run game_test then live rpgcmbt shot; summarize to _attr1_proof_out.txt."""
import subprocess, sys, time, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / "shots" / "_attr1_proof_out.txt"
lines = []

def log(s=""):
    print(s, flush=True)
    lines.append(s)

# 1) game_test
log("=== game_test ===")
gt_log = ROOT / "shots" / "_game_test_attr1b.txt"
exe = ROOT / "build-win" / "Release" / "game_test.exe"
t0 = time.time()
with open(gt_log, "w", encoding="utf-8", errors="replace") as f:
    p = subprocess.run([str(exe)], stdout=f, stderr=subprocess.STDOUT, cwd=str(ROOT), timeout=600)
dt = time.time() - t0
gt_text = gt_log.read_text(encoding="utf-8", errors="replace")
with open(gt_log, "a", encoding="utf-8") as f:
    f.write(f"\nEXIT:{p.returncode}\n")
summary_line = ""
for l in gt_text.splitlines():
    if "game_test:" in l and "checks" in l:
        summary_line = l.strip()
    if l.startswith("FAIL "):
        log("FAIL: " + l)
log(f"exit={p.returncode} elapsed={dt:.1f}s")
log(summary_line or "(no summary line)")

# 2) live shot if tests green
shot_ok = False
if p.returncode == 0 and "0 failures" in (summary_line or ""):
    log("=== rpgcmbt live shot ===")
    game = ROOT / "build-win" / "Release" / "gigahrush2.exe"
    shot = ROOT / "shots" / "shot_rpgcmbt.png"
    shot_log = ROOT / "shots" / "_rpgcmbt_shot_log.txt"
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
        sp = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=str(ROOT), timeout=180)
    dt = time.time() - t0
    slog = shot_log.read_text(encoding="utf-8", errors="replace")
    log(f"shot exit={sp.returncode} elapsed={dt:.1f}s exists={shot.exists()} size={shot.stat().st_size if shot.exists() else 0}")
    # extract key lines
    for key in ("[rpgcmbt]", "[attr]", "rpgcmbt", "error", "Error", "FAIL"):
        for l in slog.splitlines():
            if key in l:
                log("  " + l[:200])
    # unique rpgcmbt lines
    seen = set()
    for l in slog.splitlines():
        if "[rpgcmbt]" in l and l not in seen:
            seen.add(l)
            log("RPG: " + l[:180])
    shot_ok = shot.exists() and shot.stat().st_size > 1000
    # JPEG compress
    if shot_ok:
        try:
            from PIL import Image
            jpg = ROOT / "shots" / "shot_rpgcmbt.jpg"
            im = Image.open(shot).convert("RGB")
            for q in (70, 55, 40, 30):
                im.save(jpg, "JPEG", quality=q, optimize=True)
                if jpg.stat().st_size < 150_000:
                    break
            log(f"JPEG {jpg} size={jpg.stat().st_size} q~{q}")
        except Exception as e:
            log(f"JPEG fail: {e}")
            # fallback: copy png note
else:
    log("SKIP shot — tests not green")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
log(f"wrote {out}")
sys.exit(0 if p.returncode == 0 else 1)
