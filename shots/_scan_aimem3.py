# -*- coding: utf-8 -*-
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
keys = [
    "aiCfg", "AiMemory", "ai_release", "ai_step", "finish_floor",
    "begin_floor", "fold_back", "AiConfig", "activeLayer",
]
hits = [(i, l) for i, l in enumerate(main, 1) if any(k in l for k in keys)]
out = root / "shots/_aimem_main_hits.txt"
out.write_text("\n".join(f"{i}:{l}" for i, l in hits), encoding="utf-8")
print(f"main hits: {len(hits)}")
for i, l in hits:
    print(f"{i}:{l}")

print("\n===== LEAVE SITES =====")
for rel in [
    "src/game/floor_stream.cpp",
    "src/game/floor_stream.h",
    "src/game/elevator.cpp",
    "src/game/embody.cpp",
    "src/game/ai.h",
]:
    p = root / rel
    if not p.exists():
        print(f"MISSING {rel}")
        continue
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    lkeys = ["fold_back", "ai_release", "ai_init", "leave", "unload", "ride", "AiMemory"]
    lh = [(i, l) for i, l in enumerate(lines, 1) if any(k in l for k in lkeys)]
    print(f"\n--- {rel} ({len(lh)} hits) ---")
    for i, l in lh[:60]:
        print(f"{i}:{l}")

print("\n===== BACKLOG AIMEM =====")
bl = root / ".agents/worker_game_audit/BACKLOG.md"
if bl.exists():
    for i, l in enumerate(bl.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if any(k in l for k in ("AIMEM", "CARVE", "P1", "P2", "CLOSED")):
            print(f"{i}:{l}")

print("\n===== aiCfg / AiMemory context in main =====")
# print windows around key lines
want = set()
for i, l in hits:
    if any(k in l for k in ("aiCfg", "AiMemory", "ai_release", "ai_step", "finish_floor", "begin_floor")):
        for j in range(max(1, i - 3), min(len(main), i + 5) + 1):
            want.add(j)
for j in sorted(want):
    print(f"{j}|{main[j-1]}")
