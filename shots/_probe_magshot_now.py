import re
import pathlib

root = pathlib.Path(r"C:/hades/gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
out = []
out.append("lines=%d" % (main.count("\n") + 1))
out.append("quest_on_kill=%d" % main.count("quest_on_kill"))
out.append("quest_on_giver_died=%d" % main.count("quest_on_giver_died"))
out.append("contract_on_kill=%d" % main.count("contract_on_kill"))
acts = re.findall(r'shotAction\s*==\s*"([^"]+)"', main)
out.append("actions=" + str(acts))
out.append("shotAction_count=%d" % main.count("shotAction"))
out.append("--- mag/PlayerRanged ---")
for i, line in enumerate(main.splitlines(), 1):
    if "magCount" in line or "PlayerRanged" in line or '"mag"' in line:
        out.append("%d:%s" % (i, line.strip()[:140]))
out.append("--- shotAction blocks ---")
for i, line in enumerate(main.splitlines(), 1):
    if "shotAction" in line:
        out.append("%d:%s" % (i, line.strip()[:140]))
gt = (root / "tests/game_test.cpp").read_text(encoding="utf-8", errors="replace")
out.append("setvbuf in game_test=%s" % ("setvbuf" in gt))
# find main() start
for i, line in enumerate(gt.splitlines(), 1):
    if re.match(r"\s*int\s+main\s*\(", line):
        out.append("game_test main at %d: %s" % (i, line.strip()))
        for j in range(i, min(i + 15, len(gt.splitlines()) + 1)):
            out.append("  %d:%s" % (j, gt.splitlines()[j - 1].rstrip()[:120]))
        break
cm = (root / "CMakeLists.txt").read_text(encoding="utf-8", errors="replace")
m = re.search(r'PASS_REGULAR_EXPRESSION "([^"]+)"', cm)
out.append("pin=" + (m.group(1) if m else "?"))
el = (root / "src/game/elevator.cpp").read_text(encoding="utf-8", errors="replace")
out.append("elevator hadRanged=%d" % el.count("hadRanged"))
out.append("elevator magCount=%d" % el.count("magCount"))
# rpgcmbt pattern for copy
out.append("--- rpgcmbt context ---")
for i, line in enumerate(main.splitlines(), 1):
    if "rpgcmbt" in line.lower():
        out.append("%d:%s" % (i, line.strip()[:140]))
path = root / "shots/_probe_magshot_now_out.txt"
path.write_text("\n".join(out), encoding="utf-8")
print("WROTE", path, "bytes", path.stat().st_size)
