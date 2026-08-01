import re
import pathlib

root = pathlib.Path(r"C:\hades\gigahrush2")
out = []


def pr(*a):
    out.append(" ".join(str(x) for x in a))


def show_file(rel, patterns, ctx=2, limit=40):
    p = root / rel
    if not p.exists():
        pr("MISSING", rel)
        return
    lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    pr("===", rel, "lines", len(lines))
    n = 0
    for i, l in enumerate(lines):
        if any(re.search(pat, l) for pat in patterns):
            lo = max(0, i - ctx)
            hi = min(len(lines), i + ctx + 1)
            for j in range(lo, hi):
                mark = ">" if j == i else " "
                pr("%s%5d|%s" % (mark, j + 1, lines[j][:140]))
            pr("---")
            n += 1
            if n >= limit:
                break


# noise API
show_file(
    "src/game/noise.h",
    [r"weapon_fire", r"body_fall", r"door_open", r"noise_publish", r"struct Noise", r"enum"],
    ctx=3,
    limit=60,
)

# who calls noise_publish / weapon_fire / body_fall / door_open across src
pr("\n=== call sites across src+tests ===")
for folder in ["src", "tests"]:
    for p in (root / folder).rglob("*"):
        if p.suffix.lower() not in (".h", ".hpp", ".c", ".cpp", ".inl"):
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        for key in (
            "noise_publish",
            "weapon_fire_noise",
            "body_fall_noise",
            "door_open_noise",
            "noise_audible",
            "noise_step",
            "noise_clear",
        ):
            if key in t:
                cnt = t.count(key)
                # skip def in noise itself for publish helpers count interest
                pr(" ", p.relative_to(root), key, cnt)

# combat fire / melee / death noise?
show_file(
    "src/game/combat.cpp",
    [r"noise", r"weapon_fire", r"body_fall", r"publish"],
    ctx=2,
    limit=30,
)

show_file(
    "src/game/door.cpp",
    [r"noise", r"door_open"],
    ctx=2,
    limit=20,
)

# main noise usage
show_file(
    "src/app/main.cpp",
    [r"noise_"],
    ctx=1,
    limit=40,
)

# quest_on_kill vs contract_on_kill
pr("\n=== quest kill hooks ===")
show_file(
    "src/game/quest.h",
    [r"quest_on_kill", r"quest_on_giver", r"quest_step", r"struct Quest"],
    ctx=4,
    limit=40,
)
show_file(
    "src/app/main.cpp",
    [r"quest_on_kill", r"contract_on_kill", r"quest_step", r"contract_step"],
    ctx=2,
    limit=30,
)

# investigate_hear
show_file(
    "src/game/investigate.h",
    [r"investigate_hear", r"investigate_step"],
    ctx=5,
    limit=20,
)

# player_command
show_file(
    "src/game/player_command.h",
    [r"."],
    ctx=0,
    limit=80,
)

# status_water_drain / heal mult callers
pr("\n=== status mult dead helpers ===")
for key in ("status_water_drain_e3", "status_heal_mult_e3", "status_melee_mult_e3"):
    for folder in ["src", "tests"]:
        for p in (root / folder).rglob("*"):
            if p.suffix.lower() not in (".h", ".hpp", ".c", ".cpp", ".inl"):
                continue
            t = p.read_text(encoding="utf-8", errors="replace")
            if key in t:
                pr(key, p.relative_to(root), t.count(key))

# ARCHITECTURE gap section around perks/weight - lines 300-340
arch = (root / "ARCHITECTURE.md").read_text(encoding="utf-8", errors="replace").splitlines()
pr("\n=== ARCHITECTURE 280-360 ===")
for i in range(279, min(360, len(arch))):
    pr("%d: %s" % (i + 1, arch[i][:160]))

text = "\n".join(out)
(root / "shots/_probe_noise_quest_out.txt").write_text(text, encoding="utf-8")
print("WROTE", len(text))
