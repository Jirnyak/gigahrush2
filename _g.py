import os
p = r"C:\hades\gigahrush2"
out = open(os.path.join(p, "_grep_out.txt"), "w", encoding="utf-8")

def pr(s=""):
    out.write(s + "\n")
    out.flush()

for rel in ["src/game/event_bus.h", "src/game/prop_system.h"]:
    fp = os.path.join(p, rel)
    lines = open(fp, encoding="utf-8", errors="replace").read().splitlines()
    pr(f"=== {rel} ({len(lines)} lines) ===")
    for i, l in enumerate(lines):
        if any(k in l for k in ("Debris", "publish", "GpuHandoff", "spawn_debris", "EventType", "struct Event")):
            pr(f"{i+1}|{l}")

pr("\n=== HITS ===")
for root, ds, fs in os.walk(p):
    rl = root.lower()
    if "build" in rl or ".git" in rl or "node_modules" in rl:
        continue
    for fn in fs:
        if not fn.endswith((".h", ".hpp", ".cpp", ".inl", ".md")):
            continue
        fp = os.path.join(root, fn)
        try:
            t = open(fp, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        if "DebrisSpawn" in t or "spawn_debris_pieces" in t:
            pr(f"HIT {fp}")

# Also dump prop_system detach GpuHandoff block lines 60-90
pr("\n=== prop_system.cpp 60-95 ===")
ps = open(os.path.join(p, "src/game/prop_system.cpp"), encoding="utf-8", errors="replace").read().splitlines()
for i in range(59, min(95, len(ps))):
    pr(f"{i+1}|{ps[i]}")

# suite test_gpu_handoff expectation
pr("\n=== suite gpu handoff test snippet ===")
sp = open(os.path.join(p, "tests/suite_props_game.inl"), encoding="utf-8", errors="replace").read().splitlines()
for i, l in enumerate(sp):
    if "gpu_handoff" in l.lower() or "GpuHandoff" in l or "spawn_debris" in l or "chips ==" in l:
        pr(f"{i+1}|{l}")

out.close()
print("ok")
