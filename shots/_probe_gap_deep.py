# Deep gap probe after MELEEGRID — find next shippable defect.
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

# 1) TODO/FIXME in src/game
print("=== TODO/FIXME/HACK in src/game ===")
hits = []
for p in list((root / "src/game").rglob("*.cpp")) + list((root / "src/game").rglob("*.h")):
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if re.search(r"TODO|FIXME|HACK|XXX|latent|DEFER|not wired|missing grid", l, re.I):
            hits.append(f"{p.name}:{i}: {l.strip()[:140]}")
for h in hits[:80]:
    print(h.encode("ascii", "replace").decode("ascii"))
print("count", len(hits))

# 2) rpg formulas
rpg = (root / "src/game/rpg.h").read_text(encoding="utf-8", errors="replace")
print("\n=== rpg.h key symbols ===")
for name in [
    "melee_damage", "ranged_damage", "gun", "spread", "agi_", "str_", "int_",
    "award_xp", "psi", "spend_attr", "agi_move", "agi_attack", "agi_ranged",
    "str_heavy", "int_",
]:
    n = rpg.count(name)
    if n:
        print(f"  {name}: {n}")

# 3) apply_damage call sites full
cpp = (root / "src/game/combat.cpp").read_text(encoding="utf-8")
print("\n=== apply_damage call sites (joined) ===")
for m in re.finditer(r"apply_damage\s*\([^;]{0,250}\)", cpp, re.S):
    s = " ".join(m.group(0).split())
    print(" ", s[:200])

# 4) audit unwired if present
uw = root / "shots/_audit_unwired.md"
if uw.exists():
    print("\n=== _audit_unwired.md (first 80 lines) ===")
    for l in uw.read_text(encoding="utf-8", errors="replace").splitlines()[:80]:
        print(l.encode("ascii", "replace").decode("ascii"))

# 5) death path RPG / mag restore gaps
print("\n=== death/possess transfer call sites ===")
for p in [root / "src/game/combat.cpp", root / "src/app/main.cpp"]:
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if re.search(r"transfer_player_progression|carriedRpg|possess_nearest|finalize_deaths|award_xp", l):
            print(f"{p.name}:{i}: {l.strip()[:140]}".encode("ascii", "replace").decode("ascii"))

# 6) ranged damage RPG wire?
print("\n=== player_ranged_step RPG bits ===")
# find function and nearby lines with dmg/spread/Rpg
in_fn = False
start = None
lines = cpp.splitlines()
for i, l in enumerate(lines):
    if "player_ranged_step" in l and "{" in l or (l.strip().startswith("bool player_ranged_step")):
        in_fn = True
        start = i
    if in_fn and start is not None and i > start + 120:
        break
    if in_fn and re.search(r"RpgStats|spread|def->dmg|agi_|swingDmg|rawDmg|dmg", l):
        print(f"L{i+1}: {l.rstrip()[:140]}")

# 7) suite files mentioning OPEN / FAIL / skip
print("\n=== tests mentioning deferred/skip/WIP ===")
for p in (root / "tests").rglob("*.inl"):
    t = p.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines(), 1):
        if re.search(r"DEFER|SKIP|WIP|not yet|TODO|FIXME|latent", l, re.I):
            print(f"{p.name}:{i}: {l.strip()[:120]}".encode("ascii", "replace").decode("ascii"))

# 8) crafting save? status save?
print("\n=== save wire fields (save.h) ===")
sh = (root / "src/game/save.h").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(sh.splitlines(), 1):
    if re.search(r"kSave|Version|Rpg|Craft|Ranged|Status|kills|wire", l):
        print(f"L{i}: {l.rstrip()[:120]}")

# 9) StatusSet on save?
print("\n=== StatusSet save/load? ===")
for p in [root / "src/game/save.cpp", root / "src/app/main.cpp"]:
    t = p.read_text(encoding="utf-8", errors="replace")
    n = t.count("StatusSet") + t.count("playerStatus") + t.count("status_")
    print(p.name, "status-ish hits", n)
    for i, l in enumerate(t.splitlines(), 1):
        if "StatusSet" in l or "playerStatus" in l and ("save" in l.lower() or "load" in l.lower() or "F5" in l or "F9" in l or "runState" in l):
            print(f"  {p.name}:{i}: {l.strip()[:120]}")

# 10) critique notes
cr = root / "shots/_critique_rpgcmbt.md"
if cr.exists():
    print("\n=== critique_rpgcmbt.md ===")
    print(cr.read_text(encoding="utf-8", errors="replace")[:2500].encode("ascii", "replace").decode("ascii"))

print("\nDONE")
