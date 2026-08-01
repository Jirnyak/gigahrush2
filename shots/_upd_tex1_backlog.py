from pathlib import Path

p = Path(r"C:\hades\gigahrush2\.agents\worker_game_audit\BACKLOG.md")
t = p.read_text(encoding="utf-8")
old = (
    "| P2 | TEX1 | 3 missing roughness ktx2 (rubber_tiles / rusty_metal_03 / "
    "rusty_corrugated_iron) | data/textures | non-fatal; albedo+normal OK; "
    "roughness mask 0x3400 (3/6); **no mock ktx2** |"
)
new = (
    "| P2 | TEX1 | CLOSED 2026-07-31 — 3 roughness ktx2 shipped; live load 6/6 "
    "| data/textures | see CLOSED TEX1 below |"
)
if old not in t:
    raise SystemExit("TEX1 open row not found")
t = t.replace(old, new, 1)
block = """

## CLOSED 2026-07-31 TEX1
- Generated via `python tools/fetch_textures.py --map roughness --only rubber_tiles,rusty_metal_03,rusty_corrugated_iron`
- Pure-Python BC7 path (no external ktx/Compressonator required); rubber_tiles used cached Poly Haven Rough jpg; rusty_* procedural fallback where Rough cache missing
- Files: rubber_tiles_roughness.ktx2, rusty_metal_03_roughness.ktx2, rusty_corrugated_iron_roughness.ktx2 (each 5592928 B BC7_UNORM 2048x12)
- PROOF=GREEN: `gigahrush2.exe --shot shots/shot_tex1.png --frames 120 --floor 0` from repo root
  - NO `[tex] ERROR` for the three missing names
  - `[cube] albedo: 6/6 ... normal: 6/6 ... roughness: 6/6 (mask 0xfc00)` (was roughness 3/6 mask 0x3400)
  - stderr: shots/shot_tex1_stderr.txt
- Not a mock: real KTX2 BC7 containers decoded+uploaded by engine
"""
if "CLOSED 2026-07-31 TEX1" not in t:
    t = t.rstrip() + block + "\n"
p.write_text(t, encoding="utf-8")
print("BACKLOG updated OK")
