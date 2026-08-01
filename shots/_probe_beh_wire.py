"""Who calls the 7 behaviour dispatchers claimed unwired?"""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
names = [
    "behaviour_damage_mult",
    "behaviour_claims_damage",
    "facing_damage_mult",
    "burst_damage_mult",
    "burst_speed_mult",
    "burst_phase",
    "behaviour_melee_reach",
    "behaviour_incoming_mult",
    "behaviour_hurt_move_mult",
    "wall_query_needed",
    "behaviour_move_mult",
]

for name in names:
    print(f"\n=== {name} ===")
    for p in sorted((root / "src").rglob("*")):
        if p.suffix not in (".h", ".cpp", ".inl"):
            continue
        if "render" in p.parts:
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        for i, line in enumerate(t.splitlines(), 1):
            if name in line and not line.strip().startswith("//"):
                # skip pure declarations in .h that are just the signature
                rel = p.relative_to(root)
                print(f"  {rel}:{i}: {line.strip()[:100]}")

# apply_damage incoming?
print("\n=== apply_damage body start (incoming?) ===")
cp = (root / "src/game/combat.cpp").read_text(encoding="utf-8")
# find apply_damage function and print first 80 non-empty lines of it
m = re.search(r"DamageResult apply_damage\(", cp)
if m:
    chunk = cp[m.start(): m.start() + 2500]
    for i, line in enumerate(chunk.splitlines()[:60], 1):
        print(f"  {line[:110]}")
