from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []
t = (root / "tests/suite_npcpool.inl").read_text(encoding="utf-8", errors="replace")
out.append(f"bytes={len(t)} lines={len(t.splitlines())}")

# structure
for i, line in enumerate(t.splitlines(), 1):
    if re.search(r"void\s+test_|printf|while\s*\(|for\s*\(|CHECK\(|npc_pool|kMax|100000|10000|sleep", line):
        out.append(f"{i}:{line.rstrip()[:180]}")

out.append("\n==== full file head 200 ====")
out.extend(f"{i+1}:{l}" for i,l in enumerate(t.splitlines()[:200]))

out.append("\n==== full file tail 100 ====")
lines = t.splitlines()
start = max(0, len(lines)-100)
out.extend(f"{i+1}:{l}" for i,l in enumerate(lines[start:], start))

Path(r"C:/hades/gigahrush2/shots/_probe_npcpool_hang_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE")
