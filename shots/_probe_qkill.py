import re
import pathlib

root = pathlib.Path(r"C:\hades\gigahrush2")
out = []


def pr(*a):
    out.append(" ".join(str(x) for x in a))


# quest.cpp implementations
qc = (root / "src/game/quest.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
pr("quest.cpp lines", len(qc))
for i, l in enumerate(qc):
    if "quest_on_kill" in l or "quest_on_giver_died" in l or "Hunt" in l:
        lo = max(0, i - 2)
        hi = min(len(qc), i + 15)
        for j in range(lo, hi):
            mark = ">" if j == i else " "
            pr("%s%5d|%s" % (mark, j + 1, qc[j][:140]))
        pr("---")

# suite_quest references
for rel in ["tests/suite_quest.inl", "tests/suite_contract.inl", "tests/game_test.cpp"]:
    p = root / rel
    if not p.exists():
        pr("missing", rel)
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    pr("===", rel, "on_kill counts", t.count("quest_on_kill"), "giver", t.count("quest_on_giver"), "lines", len(t.splitlines()))
    lines = t.splitlines()
    for i, l in enumerate(lines):
        if "quest_on_kill" in l or "quest_on_giver" in l or "Hunt" in l and "CHECK" in l:
            pr("%5d|%s" % (i + 1, l[:140]))

# main includes quest.h?
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
pr("\nmain includes quest.h", '#include "game/quest.h"' in main or "quest.h" in main)
pr("main quest_on_kill", "quest_on_kill" in main)
pr("main quest_on_giver_died", "quest_on_giver_died" in main)
pr("main contract_on_kill", "contract_on_kill" in main)
pr("main contract_on_giver_died", "contract_on_giver_died" in main)

# quest log var name in main
for i, l in enumerate(main.splitlines()):
    if "QuestLog" in l or "quests" in l and ("=" in l or "Quest" in l):
        if i < 1800 or "QuestLog" in l:
            pr("main@%d: %s" % (i + 1, l.strip()[:120]))

# CMake pin exact
cm = (root / "CMakeLists.txt").read_text(encoding="utf-8", errors="replace")
for l in cm.splitlines():
    if "2197" in l or "game_test:" in l:
        pr("CMAKE:", l.strip())

# door_open_noise - is it defined?
nh = (root / "src/game/noise.h").read_text(encoding="utf-8", errors="replace")
pr("door_open_noise in noise.h", "door_open_noise" in nh)
nc = (root / "src/game/noise.cpp").read_text(encoding="utf-8", errors="replace")
pr("door_open_noise in noise.cpp", "door_open_noise" in nc)

text = "\n".join(out)
(root / "shots/_probe_qkill_out.txt").write_text(text, encoding="utf-8")
print("WROTE", len(text))
