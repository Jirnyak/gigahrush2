# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
out = []

def dump_section(path, start_pat, before=5, after=40, label=""):
    p = root / path
    t = p.read_text(encoding="utf-8", errors="ignore")
    lines = t.splitlines()
    for i, l in enumerate(lines):
        if re.search(start_pat, l):
            a = max(0, i - before)
            b = min(len(lines), i + after + 1)
            out.append(f"\n===== {path}:{i+1} {label} =====")
            for j in range(a, b):
                out.append(f"{j+1}|{lines[j]}")
            break

# main: ai_step call site and surrounding
dump_section("src/app/main.cpp", r"aiTick\s*=\s*game::ai_step", before=40, after=25, label="ai_step call")
dump_section("src/app/main.cpp", r"ai_init|ai_release|AiMemory", before=5, after=15, label="ai_init/release/mem")

# all ai_init / ai_release / AiMemory call sites in whole src
out.append("\n===== ALL CALL SITES ai_init/ai_release/AiMemory =====")
for p in (root / "src").rglob("*"):
    if p.suffix.lower() not in {".h", ".hpp", ".cpp", ".inl"}:
        continue
    lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    for i, l in enumerate(lines, 1):
        if re.search(r"\b(ai_init|ai_release)\s*\(|AiMemory\s+\w+|AiMemory\*|new AiMemory|&\w*Mem\w*|aiMem|gAiMem|playerMem", l):
            if l.strip().startswith("//"):
                continue
            out.append(f"{p.relative_to(root)}:{i}:{l.strip()[:160]}")

# floor leave path in floor_stream
dump_section("src/game/floor_stream.cpp", r"fold_back|leave|unload|evict|release", before=3, after=20, label="floor leave-ish")
dump_section("src/game/floor_stream.cpp", r"void\s+\w*(ride|travel|switch|enter|leave|unload)", before=2, after=50, label="ride/travel fn")

# ai_release implementation
dump_section("src/game/ai.cpp", r"std::uint32_t ai_release", before=2, after=30, label="ai_release impl")
dump_section("src/game/ai.cpp", r"std::uint32_t ai_init|void ai_init|uint32_t ai_init", before=2, after=30, label="ai_init impl")

# ai.h contract for release/init/mem
dump_section("src/game/ai.h", r"ai_release", before=5, after=20, label="ai_release decl")
dump_section("src/game/ai.h", r"ai_init", before=5, after=20, label="ai_init decl")
dump_section("src/game/ai.h", r"class AiMemory", before=10, after=40, label="AiMemory class")

# tests for AiMemory
out.append("\n===== TEST HITS =====")
for p in (root / "tests").rglob("*") if (root / "tests").exists() else []:
    if not p.is_file():
        continue
    try:
        t = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if "AiMemory" in t or "ai_release" in t or "ai_init" in t:
        for i, l in enumerate(t.splitlines(), 1):
            if "AiMemory" in l or "ai_release" in l or "ai_init" in l:
                out.append(f"{p.relative_to(root)}:{i}:{l.strip()[:140]}")

# also suite inl under src or root
for p in root.rglob("suite_*.inl"):
    t = p.read_text(encoding="utf-8", errors="ignore")
    if "AiMemory" in t or "ai_release" in t:
        out.append(f"SUITE {p.relative_to(root)}")
        for i, l in enumerate(t.splitlines(), 1):
            if "AiMemory" in l or "ai_release" in l or "ai_init" in l or "ai_step" in l:
                out.append(f"  {i}:{l.strip()[:140]}")

dest = root / "shots" / "_aimem_detail.txt"
dest.write_text("\n".join(out), encoding="utf-8")
print("wrote", dest, "lines", len(out))
