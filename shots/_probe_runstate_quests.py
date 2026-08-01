from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
save_h = (root / "src/game/save.h").read_text(encoding="utf-8", errors="replace")
out = []

out.append("==== SaveState fields ====")
in_ss = False
for i, line in enumerate(save_h.splitlines(), 1):
    if "struct SaveState" in line:
        in_ss = True
    if in_ss:
        out.append(f"{i}:{line[:180]}")
        if line.strip() == "};":
            break

out.append("\n==== runState. assignments in main ====")
for i, line in enumerate(main.splitlines(), 1):
    if "runState." in line or "SaveState runState" in line or "QuestLog quests" in line or "quests =" in line:
        if any(k in line for k in ["runState", "QuestLog", "quests", "contracts", "ledger"]):
            out.append(f"{i}:{line.rstrip()[:180]}")

out.append("\n==== save_run_now full lambda ====")
lines = main.splitlines()
# find auto save_run_now
start = None
for i, line in enumerate(lines):
    if "auto save_run_now" in line:
        start = i
        break
if start is not None:
    # print until "};" at same indent roughly 200 lines max
    for j in range(start, min(len(lines), start + 120)):
        out.append(f"{j+1}:{lines[j].rstrip()[:180]}")
        if j > start and lines[j].strip() == "};":
            break

out.append("\n==== F9 / load path quests restore ====")
for i, line in enumerate(lines):
    if any(k in line for k in ["loadWanted", "runState.quests", "quests =", "st.quests", ".quests"]):
        out.append(f"{i+1}:{line.rstrip()[:180]}")

# worker m2_2 request
m2 = root / ".agents/worker_m2_2/ORIGINAL_REQUEST.md"
if m2.exists():
    out.append("\n==== M2_2 request ====")
    out.append(m2.read_text(encoding="utf-8", errors="replace")[:3000])

Path(r"C:/hades/gigahrush2/shots/_probe_runstate_quests_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
