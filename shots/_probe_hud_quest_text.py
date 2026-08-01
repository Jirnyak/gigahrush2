from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
out = []

qh = (root / "src/game/quest.h").read_text(encoding="utf-8", errors="replace")
qc = (root / "src/game/quest.cpp").read_text(encoding="utf-8", errors="replace")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
sq = (root / "tests/suite_quest.inl").read_text(encoding="utf-8", errors="replace")

# API docs + impl
for label, t in [("quest.h", qh), ("quest.cpp", qc)]:
    out.append(f"==== {label} objective/time/line ====")
    lines = t.splitlines()
    for i, line in enumerate(lines):
        if any(k in line for k in ["objective_text", "time_text", "quest_line", "quest_offer_text"]):
            lo, hi = max(0, i - 25), min(len(lines), i + 20)
            out.append(f"-- {i+1} --")
            for j in range(lo, hi):
                out.append(f"{j+1}:{lines[j][:180]}")
            out.append("---")

# HUD block full
out.append("==== main HUD quest block ====")
lines = main.splitlines()
for i, line in enumerate(lines):
    if "qActive" in line or ("QUEST" in line and "draw" in line.lower()):
        lo, hi = max(0, i - 5), min(len(lines), i + 80)
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j][:180]}")
        break

# suite tests for objective/time
out.append("\n==== suite_quest objective/time tests ====")
for i, line in enumerate(sq.splitlines(), 1):
    if "objective" in line.lower() or "time_text" in line or "quest_line" in line:
        out.append(f"{i}:{line[:180]}")

# contract HUD for parity
out.append("\n==== contract HUD parity ====")
for i, line in enumerate(lines):
    if "contract_line" in line or "cActive" in line or "contract_objective" in line:
        out.append(f"{i+1}:{line[:180]}")

# game_test stderr buffering
gt = (root / "tests/game_test.cpp").read_text(encoding="utf-8", errors="replace")
out.append("\n==== game_test.cpp main start ====")
for i, line in enumerate(gt.splitlines()[:60], 1):
    out.append(f"{i}:{line[:160]}")

# gt progress
for f in ["_gt_long_err.txt", "_gt_long_rc.txt"]:
    p = root / "shots" / f
    out.append(f"\n{f} size={p.stat().st_size if p.exists() else 0}")
    if p.exists() and p.stat().st_size:
        out.append(p.read_text(encoding="utf-8", errors="replace")[-500:])

Path(r"C:/hades/gigahrush2/shots/_probe_hud_quest_text_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
