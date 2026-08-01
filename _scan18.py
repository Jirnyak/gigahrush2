# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
out = []

phys_p = root / "src" / "sim" / "physics.cpp"
phys = phys_p.read_text(encoding="utf-8")
out.append("=== physics.cpp ===")
out.append(f"exists={phys_p.exists()} size={phys_p.stat().st_size}")
out.append(f"AngularVelocity in file: {'AngularVelocity' in phys}")
for i, l in enumerate(phys.splitlines(), 1):
    if any(k in l for k in ("Angular", "quat", "ragdoll", "omega", "orientation", "Orientation")):
        out.append(f"{i}: {l[:160]}")

sc_p = root / "tests" / "suite_console.inl"
sc = sc_p.read_text(encoding="utf-8")
out.append("=== suite_console.inl ===")
out.append(f"size={sc_p.stat().st_size}")
for i, l in enumerate(sc.splitlines(), 1):
    if any(k in l.lower() for k in ("anchor", "prop_ragdoll", "ragdoll", "prop_system", "seed_wall", "interactable", "section 18", "§18")):
        out.append(f"{i}: {l[:160]}")

j = (root / "jirnyak.md").read_text(encoding="utf-8")
out.append("=== jirnyak.md section search ===")
for key in ["## 18", "### 18", "18. Prop", "Prop system", "prop_system", "anchor_validate", "§18"]:
    out.append(f"find {key!r}: {j.find(key)}")

# find numbered sections
for m in re.finditer(r"^#{1,3} .*$", j, re.M):
    line = m.group(0)
    if "18" in line or "Prop" in line or "prop" in line or "Ragdoll" in line or "Anchor" in line:
        out.append(f"heading@{m.start()}: {line[:120]}")

prop_cpp = root / "src" / "game" / "prop_system.cpp"
out.append(f"prop_system.cpp exists={prop_cpp.exists()}")
if prop_cpp.exists():
    pc = prop_cpp.read_text(encoding="utf-8")
    out.append(f"prop_system.cpp lines={pc.count(chr(10))+1}")
    for i, l in enumerate(pc.splitlines(), 1):
        if "void " in l or "bool " in l:
            out.append(f"  {i}: {l[:120]}")

# cmake
for cm in root.rglob("CMakeLists.txt"):
    t = cm.read_text(encoding="utf-8", errors="replace")
    if "prop_system" in t:
        out.append(f"CMAKE {cm.relative_to(root)} has prop_system")
        for i, l in enumerate(t.splitlines(), 1):
            if "prop_system" in l:
                out.append(f"  {i}: {l.strip()[:120]}")

# main wiring verify
main = (root / "src" / "app" / "main.cpp").read_text(encoding="utf-8")
out.append(f"main anchor_validate_step count={main.count('anchor_validate_step')}")
out.append(f"main prop_ragdoll_step count={main.count('prop_ragdoll_step')}")

out_path = root / "_scan18.txt"
out_path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("OK", out_path, "lines", len(out))
