from pathlib import Path
import subprocess

p = Path(r"C:\hades\gigahrush2\tests\suite_behaviours.inl")
b = p.read_bytes()
print("size", len(b))
print("lines", b.count(b"\n") + (1 if b and not b.endswith(b"\n") else 0))
print("head", repr(b[:200]))
print("tail", repr(b[-400:] if len(b) > 400 else b))
print("MELEEGRID", b.find(b"MELEEGRID"))
print("test_behaviours", b.find(b"test_behaviours"))
print("WallBrace", b.find(b"WallBrace"))
print("section 17", b.find(b"Section 17") if b.find(b"Section 17") >= 0 else b.find(b"section 17"))

r = subprocess.run(
    ["git", "-C", r"C:\hades\gigahrush2", "status", "-sb"],
    capture_output=True, text=True,
)
print("STATUS:\n", r.stdout)
r = subprocess.run(
    ["git", "-C", r"C:\hades\gigahrush2", "log", "-3", "--oneline"],
    capture_output=True, text=True,
)
print("LOG:\n", r.stdout)
r = subprocess.run(
    ["git", "-C", r"C:\hades\gigahrush2", "diff", "--stat", "HEAD", "--",
     "src/game/combat.cpp", "tests/suite_behaviours.inl"],
    capture_output=True, text=True,
)
print("DIFFSTAT:\n", r.stdout)
r = subprocess.run(
    ["git", "-C", r"C:\hades\gigahrush2", "diff", "HEAD", "--", "src/game/combat.cpp"],
    capture_output=True, text=True,
)
print("COMBAT_DIFF:\n", r.stdout[-2000:] if r.stdout else "(empty)")
