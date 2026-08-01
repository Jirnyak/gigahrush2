"""Poll ATTR1 proof progress."""
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parents[1]
shots = root / "shots"

def tail(p: Path, n=20):
    if not p.exists():
        return f"(missing {p.name})"
    t = p.read_text(encoding="utf-8", errors="replace")
    lines = t.splitlines()
    return f"size={p.stat().st_size} lines={len(lines)}\n" + "\n".join(lines[-n:])

print("=== _attr1_proof_out ===")
print(tail(shots / "_attr1_proof_out.txt", 40))
print("=== _attr1_proof_run ===")
print(tail(shots / "_attr1_proof_run.txt", 20))
print("=== _game_test_attr1b ===")
print(tail(shots / "_game_test_attr1b.txt", 25))
print("=== procs ===")
r = subprocess.run(
    ["tasklist"],
    capture_output=True, text=True, errors="replace"
)
for line in r.stdout.splitlines():
    low = line.lower()
    if any(x in low for x in ("game_test", "python", "gigahrush")):
        print(line)
print("=== shot ===")
for name in ("shot_rpgcmbt.png", "shot_rpgcmbt.jpg", "_rpgcmbt_shot_log.txt"):
    p = shots / name
    if p.exists():
        print(f"{name}: {p.stat().st_size} B mtime={p.stat().st_mtime}")
    else:
        print(f"{name}: missing")
