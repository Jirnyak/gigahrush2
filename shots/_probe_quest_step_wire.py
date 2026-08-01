from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
out = []

names = [
    "quest_step", "quest_offer", "quest_accept", "quest_grant_item",
    "quest_objective_text", "quest_time_text", "quest_offer_text",
    "quest_line", "quest_active_count", "quest_eligible", "quest_on_kill",
    "quest_on_giver_died", "contract_step", "contract_on_kill",
]
for n in names:
    out.append(f"{n}: {main.count(n)}")

out.append("\n==== main quest_* call sites ====")
for i, line in enumerate(main.splitlines(), 1):
    if "quest_" in line and not line.strip().startswith("//"):
        out.append(f"{i}:{line.rstrip()[:180]}")

out.append("\n==== main contract_step sites ====")
for i, line in enumerate(main.splitlines(), 1):
    if "contract_step" in line or "contract_tick" in line:
        out.append(f"{i}:{line.rstrip()[:180]}")

# How contracts step is wired - template for quest_step
out.append("\n==== contract step context ====")
lines = main.splitlines()
for i, line in enumerate(lines):
    if "contract_step" in line:
        lo = max(0, i - 15)
        hi = min(len(lines), i + 20)
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j].rstrip()[:180]}")
        out.append("---")

# quest_step signature from header
qh = (root / "src/game/quest.h").read_text(encoding="utf-8", errors="replace")
out.append("\n==== quest_step docs ====")
ql = qh.splitlines()
for i, line in enumerate(ql):
    if "quest_step" in line:
        for j in range(max(0, i - 40), min(len(ql), i + 15)):
            out.append(f"{j+1}:{ql[j].rstrip()[:180]}")
        break

# HUD quest block
out.append("\n==== HUD quest block ====")
for i, line in enumerate(lines):
    if "qActive" in line or "quest_line" in line or "quest_active" in line or "QUEST" in line:
        out.append(f"{i+1}:{line.rstrip()[:180]}")

Path(r"C:/hades/gigahrush2/shots/_probe_quest_step_wire_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
