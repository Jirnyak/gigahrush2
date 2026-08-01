"""Probe SAVRPG seams: save version, RpgStats, craft known-bits."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
out = root / "shots" / "_probe_savrpg_out.txt"
lines = []

def log(s=""):
    print(s, flush=True)
    lines.append(s)

# 1) kSaveVersion and save API
for rel in [
    "src/game/save.h",
    "src/game/save.cpp",
    "src/game/rpg.h",
    "src/game/craft.h",
    "src/game/craft.cpp",
]:
    p = root / rel
    if not p.exists():
        log(f"MISSING {rel}")
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    log(f"=== {rel} ({len(t)} B, {t.count(chr(10))} lines) ===")
    # key symbols
    for pat in [
        r"kSaveVersion",
        r"RpgStats",
        r"save_run",
        r"load_run",
        r"known",
        r"CraftBook",
        r"craft_known",
        r"kCraft",
        r"attrPoints",
        r"struct.*Save",
        r"version",
    ]:
        hits = [(i + 1, l.rstrip()) for i, l in enumerate(t.splitlines()) if re.search(pat, l)]
        if hits:
            log(f"  -- {pat} ({len(hits)}) --")
            for ln, l in hits[:30]:
                log(f"  {ln}: {l[:140]}")

# 2) suite_save if any
for p in sorted((root / "tests").glob("suite_save*")) + sorted((root / "tests").glob("*save*")):
    log(f"TESTFILE: {p.relative_to(root)}")

# 3) main F5/F9
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
log("=== main.cpp save/load sites ===")
for i, l in enumerate(main.splitlines(), 1):
    if any(k in l for k in ("save_run", "load_run", "F5", "F9", "kSave", "SaveRequest", "request_bit(ConsoleRequest::Save", "shotAction == \"save\"", "shotAction == \"load\"")):
        log(f"  {i}: {l.rstrip()[:140]}")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
log(f"wrote {out}")
