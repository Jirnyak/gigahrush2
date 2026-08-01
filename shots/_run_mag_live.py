"""Live MAGSHOT proof: --action mag --ride 1 --shot."""
from pathlib import Path
import subprocess
import sys
import os
import time

root = Path(r"C:\hades\gigahrush2")
exe = root / "build-win" / "Release" / "gigahrush2.exe"
shot = root / "shots" / "shot_mag.png"
err_path = root / "shots" / "_mag_live_err.txt"
out_path = root / "shots" / "_mag_live_out.txt"
rc_path = root / "shots" / "_mag_live_rc.txt"

if shot.exists():
    shot.unlink()

cmd = [
    str(exe),
    "--shot", str(shot),
    "--frames", "900",
    "--ride", "1",
    "--action", "mag",
]
print("cmd:", " ".join(cmd), flush=True)
print("cwd:", root, flush=True)
print("exe exists:", exe.exists(), exe.stat().st_size if exe.exists() else 0, flush=True)

t0 = time.time()
# Run from repo root so data/ resolves
with open(out_path, "wb") as outf, open(err_path, "wb") as errf:
    p = subprocess.run(
        cmd,
        cwd=str(root),
        stdout=outf,
        stderr=errf,
        timeout=300,
    )
elapsed = time.time() - t0
rc_path.write_text(f"EXIT={p.returncode}\nELAPSED={elapsed:.1f}\n", encoding="utf-8")
print(f"rc={p.returncode} elapsed={elapsed:.1f}s", flush=True)

err = err_path.read_text(encoding="utf-8", errors="replace")
out = out_path.read_text(encoding="utf-8", errors="replace")
print("err_bytes", len(err), "out_bytes", len(out), "png", shot.exists(),
      shot.stat().st_size if shot.exists() else 0, flush=True)

# Filter interesting lines
for label, text in [("ERR", err), ("OUT", out)]:
    print(f"==== {label} mag/shot/ride/PROOF ====", flush=True)
    for L in text.splitlines():
        low = L.lower()
        if any(k in L for k in ("[mag]", "PROOF", "shot:", "ride", "FORCE", "RIDE", "FAIL")) \
           or "error" in low or "Error" in L:
            print(L, flush=True)

# Tail last 30 err lines always
print("==== ERR tail ====", flush=True)
for L in err.splitlines()[-30:]:
    print(L, flush=True)

# summary flags
green = "[mag] PROOF=GREEN" in err or "[mag] PROOF=GREEN" in out
force = "[mag] FORCE" in err or "[mag] FORCE" in out
ride_ok = "ok=1" in err and "[mag] RIDE" in err
print(f"SUMMARY force={force} ride_ok={ride_ok} green={green} png={shot.exists()}", flush=True)
sys.exit(0 if green else 1)
