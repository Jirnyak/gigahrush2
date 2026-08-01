# -*- coding: utf-8 -*-
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")
out = []

h = (root / "src/game/prop_system.h").read_text(encoding="utf-8")
out.append("=== prop_system.h ===")
out.append(h)

c = (root / "src/game/prop_system.cpp").read_text(encoding="utf-8")
out.append("=== prop_system.cpp (selected) ===")
lines = c.splitlines()
# print full file numbered - it's 382 lines, ok
for i, l in enumerate(lines, 1):
    out.append(f"{i}|{l}")

eb = (root / "src/game/event_bus.h").read_text(encoding="utf-8")
out.append("=== event_bus.h PropDetached region ===")
for i, l in enumerate(eb.splitlines(), 1):
    if any(k in l for k in (
        "PropDetached", "propDetached", "drain", "begin", "end(",
        "events_", "struct Event", "EventType", "payload", "class EventBus",
        "publish", "size(", "count", "for_each", "read"
    )):
        out.append(f"{i}|{l}")

# also check game components for DynamicBodyTag / Interactable
for rel in ["src/game/prop_system.h", "src/ecs/components.h"]:
    p = root / rel
    t = p.read_text(encoding="utf-8")
    if "DynamicBody" in t or "Interactable" in t:
        out.append(f"=== tags in {rel} ===")
        for i, l in enumerate(t.splitlines(), 1):
            if any(k in l for k in ("DynamicBody", "Interactable", "StaticProp", "SubVoxel")):
                out.append(f"{i}|{l}")

# search Interactable definition
for p in (root / "src").rglob("*.h"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "struct Interactable" in t:
        out.append(f"=== Interactable in {p.relative_to(root)} ===")
        # dump surrounding 80 lines
        ls = t.splitlines()
        for i, l in enumerate(ls):
            if "struct Interactable" in l:
                start = max(0, i - 5)
                end = min(len(ls), i + 60)
                for j in range(start, end):
                    out.append(f"{j+1}|{ls[j]}")
                break

(root / "_api_full.txt").write_text("\n".join(out), encoding="utf-8")
print("OK", len(out))
