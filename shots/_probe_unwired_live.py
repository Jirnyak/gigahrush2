# Live unwired audit — which game systems exist but are not called from main.
import re
import pathlib

root = pathlib.Path(r"C:\hades\gigahrush2")
main_t = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
out = []


def pr(*a):
    out.append(" ".join(str(x) for x in a))


# Public-ish free functions / types from each game header
hdr_dir = root / "src/game"
interesting = [
    "contract", "economy", "extraction", "hunt", "investigate", "macro_sim",
    "needs", "population", "quest", "rumour", "samosbor", "speech", "vendor",
    "event_bus", "noise", "wander", "container", "player_command", "craft",
    "rpg", "status", "loot", "faction", "elevator", "embody", "door",
    "weapon_table", "ranged_table", "monster_traits", "mob_behaviour",
]

# For each module: count mentions in main.cpp and list key symbols from .h
for mod in interesting:
    h = hdr_dir / f"{mod}.h"
    c = hdr_dir / f"{mod}.cpp"
    if not h.exists():
        pr("MISSING_H", mod)
        continue
    ht = h.read_text(encoding="utf-8", errors="replace")
    # free function names roughly: return-type name(
    funcs = re.findall(
        r"^(?:inline\s+)?(?:static\s+)?(?:void|bool|int|float|double|std::\w+|std::uint\d+_t|std::int\d+_t|[\w:]+)\s+(\w+)\s*\(",
        ht,
        re.M,
    )
    # also bare names ending _step _apply etc
    funcs += re.findall(r"\b([a-z][a-z0-9_]*(?:_step|_apply|_tick|_init|_reset|_emit|_post|_drain|_write|_read))\s*\(", ht)
    funcs = sorted(set(funcs))
    # filter noise
    skip = {"if", "for", "while", "switch", "return", "sizeof", "static_assert", "CHECK"}
    funcs = [f for f in funcs if f not in skip and not f.startswith("operator")]
    main_hits = main_t.count(mod)
    # which funcs appear in main
    wired = [f for f in funcs if f in main_t]
    unwired = [f for f in funcs if f not in main_t]
    cpp_exists = c.exists()
    pr("===", mod, "cpp=" + str(cpp_exists), "main_mod_mentions=", main_hits)
    pr("  funcs", len(funcs), "wired", len(wired), "unwired", len(unwired))
    if wired:
        pr("  WIRED:", ", ".join(wired[:20]))
    if unwired:
        pr("  UNWIRED:", ", ".join(unwired[:25]))

# rpg helpers specifically
pr("\n=== rpg helper call sites in main+combat ===")
rpg_h = (hdr_dir / "rpg.h").read_text(encoding="utf-8", errors="replace")
helpers = re.findall(r"\b((?:agi|str|int|melee|ranged|xp|award|spend|fresh|random)_[a-z0-9_]+)\s*\(", rpg_h)
helpers = sorted(set(helpers))
combat_t = (hdr_dir / "combat.cpp").read_text(encoding="utf-8", errors="replace")
for hname in helpers:
    m = main_t.count(hname)
    c = combat_t.count(hname)
    flag = "WIRED" if (m + c) > 0 else "DEAD"
    if flag == "DEAD" or m + c > 0:
        pr(" ", flag, hname, "main=", m, "combat=", c)

# weapon / ranged tables — balance surface
pr("\n=== weapon_table / ranged_table surface ===")
for mod in ("weapon_table", "ranged_table"):
    h = (hdr_dir / f"{mod}.h").read_text(encoding="utf-8", errors="replace")
    pr(mod, "lines", len(h.splitlines()))
    for i, l in enumerate(h.splitlines()[:80]):
        if any(k in l for k in ("struct", "dmg", "cooldown", "spread", "mag", "kWeapon", "kRanged", "TODO")):
            pr(" ", i + 1, l.strip()[:120])

# event_bus usage
pr("\n=== event_bus ===")
eb = hdr_dir / "event_bus.h"
if eb.exists():
    t = eb.read_text(encoding="utf-8", errors="replace")
    pr("lines", len(t.splitlines()))
    pr(t[:1500])

# samosbor
pr("\n=== samosbor ===")
sh = hdr_dir / "samosbor.h"
if sh.exists():
    t = sh.read_text(encoding="utf-8", errors="replace")
    pr("lines", len(t.splitlines()))
    for i, l in enumerate(t.splitlines()):
        if re.search(r"void |bool |struct |TODO|step|tick", l) and len(l) < 140:
            pr("%d: %s" % (i + 1, l.strip()[:130]))
    pr("main mentions samosbor:", main_t.lower().count("samosbor"))

# needs
pr("\n=== needs ===")
nh = hdr_dir / "needs.h"
if nh.exists():
    t = nh.read_text(encoding="utf-8", errors="replace")
    for i, l in enumerate(t.splitlines()):
        if re.search(r"^\s*(struct|void|bool|float|inline)", l) and len(l) < 140:
            pr("%d: %s" % (i + 1, l.strip()[:130]))
    for name in ("needs_step", "NeedsState", "speedScale", "psi"):
        pr(" main", name, main_t.count(name))

# quest/contract/vendor quick
for mod in ("quest", "contract", "vendor", "extraction", "rumour", "hunt", "investigate", "population", "macro_sim", "economy", "speech", "container"):
    pr("\nmain count", mod, "=", main_t.count(mod), "and", mod + "_", "=", len(re.findall(r"\b" + mod + r"_\w+", main_t)))

text = "\n".join(out)
(root / "shots/_probe_unwired_live_out.txt").write_text(text, encoding="utf-8")
print("WROTE", len(text), "chars")
