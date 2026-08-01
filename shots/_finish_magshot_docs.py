"""Close MAGSHOT in BACKLOG + progress; prep commit message."""
from pathlib import Path
from datetime import datetime, timezone

root = Path(r"C:\hades\gigahrush2")
bl = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
pr = root / ".agents" / "worker_game_audit" / "progress.md"

# Read proof lines from live err
err = (root / "shots" / "_mag_live_err.txt").read_text(encoding="utf-8", errors="replace")
proof_lines = [L for L in err.splitlines() if "[mag]" in L or L.startswith("shot: saved")]
proof_block = "\n".join(proof_lines)
print("PROOF LINES:")
print(proof_block)

bl_t = bl.read_text(encoding="utf-8", errors="replace") if bl.exists() else ""
pr_t = pr.read_text(encoding="utf-8", errors="replace") if pr.exists() else ""

# Show current MAGSHOT mentions
print("\n=== BACKLOG MAGSHOT / OPEN ===")
for i, L in enumerate(bl_t.splitlines(), 1):
    if "MAGSHOT" in L or "OPEN" in L.upper()[:20] or L.startswith("##"):
        print(f"{i}: {L[:160]}")

print("\n=== progress head/tail ===")
plines = pr_t.splitlines()
for L in plines[:30]:
    print(L[:160])
print("...")
for L in plines[-40:]:
    print(L[:160])

# Write snippets for manual patch awareness
Path(r"C:/hades/gigahrush2/shots/_mag_proof_lines.txt").write_text(proof_block, encoding="utf-8")
