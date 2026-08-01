# -*- coding: utf-8 -*-
from pathlib import Path
root = Path(r"C:\hades\gigahrush2")
out = []
c = (root/"src/game/prop_system.cpp").read_text(encoding="utf-8").splitlines()
out.append("=== spawn/detach/ragdoll/validate bodies ===")
for i in range(len(c)):
    out.append("%d|%s" % (i+1, c[i]))
out.append("=== materials ===")
out.append((root/"src/world/materials.h").read_text(encoding="utf-8"))
out.append("=== event_bus selected ===")
e = (root/"src/game/event_bus.h").read_text(encoding="utf-8").splitlines()
for i,l in enumerate(e,1):
    if any(k in l for k in ("init","clear_cycle","cycle_count","PropDetached","struct Event","publish","events_","begin","size(","enum class EventType","propDetached","a;","b;","c;","d;")):
        out.append("%d|%s" % (i,l))
# Interactable full
for p in (root/"src").rglob("*.h"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "struct Interactable" in t or "enum class PropFallMode" in t or "struct DynamicBodyTag" in t:
        out.append("=== from %s ===" % p.relative_to(root))
        for i,l in enumerate(t.splitlines(),1):
            if any(k in l for k in ("Interactable","PropFallMode","DynamicBody","StaticProp","SubVoxel","Crate","Barrel","Kind","FallMode","Ragdoll")):
                out.append("%d|%s" % (i,l))
(root/"_fix2.txt").write_text("\n".join(out), encoding="utf-8")
print("OK", len(out), "->", root/"_fix2.txt")
