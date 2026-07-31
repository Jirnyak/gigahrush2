# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
src = root / "src"
keys = re.compile(r"ai_release|AiMemory|ai_step|fold_back|floor_stream|AiBrain|ai_acquire", re.I)
hits = []
for p in src.rglob("*"):
    if p.suffix.lower() not in {".h", ".hpp", ".cpp", ".inl", ".c"}:
        continue
    try:
        lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        continue
    for i, l in enumerate(lines, 1):
        if keys.search(l):
            hits.append(f"{p.relative_to(root)}:{i}:{l.strip()[:140]}")

out = root / "shots" / "_aimem_hits.txt"
out.write_text("\n".join(hits) + f"\n\nTOTAL={len(hits)}\n", encoding="utf-8")
print("TOTAL", len(hits))
print("wrote", out)
# also list ai-ish files
files = []
for p in src.rglob("*"):
    if p.is_file() and any(k in p.name.lower() for k in ("ai", "floor_stream", "memory", "embody", "elevator")):
        files.append(str(p.relative_to(root)))
print("FILES", len(files))
for f in sorted(files)[:60]:
    print(f)
