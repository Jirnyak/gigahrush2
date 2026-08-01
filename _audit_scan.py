# -*- coding: utf-8 -*-
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")
out = []

tests_dir = root / "tests"
for t in sorted(tests_dir.iterdir()):
    if t.suffix in (".inl", ".cpp", ".h"):
        out.append(f"TEST {t.name} {t.stat().st_size}")

for name in ("game_test.cpp", "test_main.cpp", "console_test.cpp", "tests.cpp"):
    p = tests_dir / name
    if p.exists():
        out.append(f"=== {name} ===")
        for i, l in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if any(k in l for k in ("#include", "suite_", "int main", "TEST", "run_")):
                out.append(f"{i}: {l[:140]}")

comp_p = root / "src" / "ecs" / "components.h"
if not comp_p.exists():
    # find components.h
    found = list(root.rglob("components.h"))
    out.append(f"components.h candidates: {[str(f.relative_to(root)) for f in found]}")
    comp_p = found[0] if found else None
if comp_p and comp_p.exists():
    out.append(f"=== {comp_p.relative_to(root)} ===")
    for i, l in enumerate(comp_p.read_text(encoding="utf-8").splitlines(), 1):
        if any(k in l for k in ("StaticProp", "SubVoxel", "Interactable", "AngularVelocity",
                                "Rotation", "Anchored", "PropKind", "Ragdoll", "Kinematic",
                                "Velocity", "AABB", "Transform", "struct ")):
            if any(k in l for k in ("StaticProp", "SubVoxel", "Interactable", "AngularVelocity",
                                    "PropKind", "Ragdoll", "Anchored", "Rotation")):
                out.append(f"{i}: {l[:140]}")

# suite_console end - how tests are registered
sc = (tests_dir / "suite_console.inl").read_text(encoding="utf-8")
out.append("=== suite_console tail/reg ===")
for i, l in enumerate(sc.splitlines(), 1):
    if "static void" in l or "register" in l.lower() or "RUN" in l or "case " in l or "g_tests" in l or "TestCase" in l:
        out.append(f"{i}: {l[:140]}")

# look at a simple existing suite for pattern
for suite in sorted(tests_dir.glob("suite_*.inl")):
    t = suite.read_text(encoding="utf-8")
    out.append(f"SUITE {suite.name} lines={t.count(chr(10))+1} has_static_void={t.count('static void')}")

# world layer API for tests
world_h = list(root.rglob("world.h"))
out.append(f"world.h: {[str(p.relative_to(root)) for p in world_h]}")

# check event PropDetached
for p in root.rglob("*.h"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "PropDetached" in t or "prop_detached" in t:
        out.append(f"PropDetached in {p.relative_to(root)}")
        for i, l in enumerate(t.splitlines(), 1):
            if "PropDetached" in l or "prop_detached" in l:
                out.append(f"  {i}: {l[:120]}")

(root / "_audit_out.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
print("done", len(out))
