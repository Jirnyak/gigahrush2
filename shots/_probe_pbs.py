#!/usr/bin/env python3
from pathlib import Path
root = Path(r"C:\hades\gigahrush2")
for base in (root / "src", root / "tests"):
    if not base.exists():
        continue
    for f in sorted(base.rglob("*")):
        if f.suffix not in {".h", ".hpp", ".cpp", ".inl", ".c"}:
            continue
        try:
            t = f.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if "place_body_safely" in t or "place_body_at_cell" in t:
            print("FILE", f.relative_to(root))
            for i, l in enumerate(t.splitlines(), 1):
                if "place_body" in l:
                    print(f"  {i}|{l}")
