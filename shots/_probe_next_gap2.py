import re
import pathlib

root = pathlib.Path(r"C:\hades\gigahrush2")
out = []


def pr(*a):
    out.append(" ".join(str(x) for x in a))


main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
lines = main.splitlines()
pr("main.cpp lines=%d bytes=%d" % (len(lines), len(main.encode())))
for pat, name in [
    ("place_body_safely", "PBS"),
    ("ai_release", "ai_release"),
    ("runState.status", "runState.status"),
    ("playerStatus = runState.status", "F9 status"),
    ("runState.status = playerStatus", "F5 status"),
    ("status_step", "status_step"),
    ("combatCarves", "combatCarves"),
    ("transfer_player_progression", "POSRPG"),
    ("spend_attr_point", "ATTR1"),
    ("agi_move_speed", "AGIMV"),
    ("%u/%u mag", "HUD mag literal"),
    ("magCount", "magCount"),
]:
    hits = [i + 1 for i, l in enumerate(lines) if pat in l]
    pr("%s: count=%d lines=%s" % (name, len(hits), hits[:12]))

for i, l in enumerate(lines):
    low = l.lower()
    if "gun:" in low or ("%u/%u mag" in l) or (" mag" in l and "ImGui" in l):
        pr("HUD@%d: %s" % (i + 1, l.strip()[:140]))

pr("--- sound/audio game+app ---")
for folder in ["src/game", "src/app"]:
    for pth in (root / folder).rglob("*"):
        if pth.suffix.lower() not in (".h", ".hpp", ".c", ".cpp", ".inl"):
            continue
        try:
            t = pth.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if re.search(r"sound|audio|sfx|Mix_|OpenAL|FMOD|miniaudio|SoLoud", t, re.I):
            n = len(re.findall(r"sound|audio|sfx", t, re.I))
            pr(" ", pth.relative_to(root), "hits~", n)

pr("--- src/game headers ---")
for pth in sorted((root / "src/game").glob("*.h")):
    pr(" ", pth.name)

pr("--- door delta ---")
door = (root / "src/game/door.cpp").read_text(encoding="utf-8", errors="replace")
pr("door.cpp lines", len(door.splitlines()))
door_h = (root / "src/game/door.h").read_text(encoding="utf-8", errors="replace")
pr("door.h lines", len(door_h.splitlines()))
for i, l in enumerate(door_h.splitlines()):
    if any(k in l for k in ("TODO", "FIXME", "new", "freeze", "tick")):
        pr("door.h@%d: %s" % (i + 1, l.strip()[:120]))

pr("--- CMake game_test pin ---")
cm = (root / "CMakeLists.txt").read_text(encoding="utf-8", errors="replace")
for l in cm.splitlines():
    if "checks" in l or "PASS_REGULAR" in l or "2197" in l or "game_test:" in l:
        pr(l.strip()[:180])

pr("--- ARCHITECTURE snips ---")
arch = root / "ARCHITECTURE.md"
if arch.exists():
    t = arch.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines()):
        if re.search(
            r"TODO|FIXME|OPEN|gap|unwired|missing|not yet|deferred|sound|audio|weapon|balance|game agent|worker_game",
            l,
            re.I,
        ):
            if len(l) < 220:
                pr("%d: %s" % (i + 1, l[:180]))

pr("--- critique_rpgcmbt ---")
cr = root / "shots/_critique_rpgcmbt.md"
if cr.exists():
    pr(cr.read_text(encoding="utf-8", errors="replace")[:2000])

pr("--- gap_deep out ---")
gd = root / "shots/_probe_next_gap_out.txt"
if gd.exists():
    pr(gd.read_text(encoding="utf-8", errors="replace")[:2500])

pr("--- audit_unwired ---")
au = root / "shots/_audit_unwired.md"
if au.exists():
    pr(au.read_text(encoding="utf-8", errors="replace")[:2500])

pr("--- suite_doors new pins ---")
sd = root / "tests/suite_doors.inl"
if sd.exists():
    t = sd.read_text(encoding="utf-8", errors="replace")
    pr("suite_doors lines", len(t.splitlines()))
    # tail
    for l in t.splitlines()[-40:]:
        pr(l[:160])

text = "\n".join(out)
(root / "shots/_probe_next_gap2_out.txt").write_text(text, encoding="utf-8")
print(text)
