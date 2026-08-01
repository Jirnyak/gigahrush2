import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# combat.h signatures
t = pathlib.Path("src/game/combat.h").read_text(encoding="utf-8", errors="replace")
for pat in ["bool player_melee_step", "player_ranged_step(Registry"]:
    i = t.find(pat)
    print("===", pat, "===", t[:i].count("\n") + 1 if i >= 0 else "MISS")
    if i >= 0:
        print(t[i : i + 450])

# find unarmed_melee
print("=== unarmed_melee search ===")
for p in pathlib.Path("src").rglob("*"):
    if p.suffix.lower() not in {".h", ".hpp", ".cpp", ".inl"}:
        continue
    try:
        txt = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    if "unarmed_melee" in txt or "melee_for_item" in txt:
        for j, line in enumerate(txt.splitlines(), 1):
            if "unarmed_melee" in line or "melee_for_item" in line:
                print(f"{p}:{j}:{line}")

# suite_rpg includes at top
print("=== suite_rpg head ===")
sr = pathlib.Path("tests/suite_rpg.inl").read_text(encoding="utf-8", errors="replace")
print("\n".join(f"{i}|{l}" for i, l in enumerate(sr.splitlines()[:40], 1)))

# combat.cpp includes for melee helpers
print("=== combat.cpp includes / unarmed ===")
cc = pathlib.Path("src/game/combat.cpp").read_text(encoding="utf-8", errors="replace")
for j, line in enumerate(cc.splitlines()[:80], 1):
    if "#include" in line or "unarmed" in line:
        print(f"{j}|{line}")

# BACKLOG ascii-safe
print("=== BACKLOG ===")
bl = pathlib.Path(".agents/worker_game_audit/BACKLOG.md").read_text(
    encoding="utf-8", errors="replace"
)
safe = bl.encode("ascii", "replace").decode("ascii")
print(safe[:2200])
print("---TAIL---")
print(safe[-2000:])
