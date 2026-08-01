# MELEEGRID: tighten player→pan gap to 0.8 m (bare fist reach ≈ 1.9 m; 2.0 m misses).
from pathlib import Path

p = Path(r"C:\hades\gigahrush2\tests\suite_behaviours.inl")
t = p.read_text(encoding="utf-8")
if "MELEEGRID" not in t:
    raise SystemExit("MELEEGRID section missing")

old_pairs = [
    ("vec3{108.0f, 100.0f, 3.0f}", "vec3{109.2f, 100.0f, 3.0f}"),
    ("vec3{100.0f, 108.0f, 3.0f}", "vec3{100.0f, 109.2f, 3.0f}"),
]
# Comment about 2 m gap
old_c = "// Reach bare = 0.5 cell * kCellSize + slack ≈ 1.0+ m; 2 m gap is inside."
new_c = "// Reach bare = 0.5 cell * kCellSize + slack ≈ 1.9 m; 0.8 m gap (2 m misses)."

n = 0
if old_c in t:
    t = t.replace(old_c, new_c, 1)
    n += 1
for a, b in old_pairs:
    if a not in t:
        if b in t:
            print("already fixed:", b)
            continue
        raise SystemExit(f"missing: {a!r}")
    t = t.replace(a, b, 1)
    n += 1

p.write_text(t, encoding="utf-8", newline="\n")
print(f"geom fixed, {n} replacements")
# sanity dump
i = t.find("MELEEGRID")
print(t[i : i + 900])
