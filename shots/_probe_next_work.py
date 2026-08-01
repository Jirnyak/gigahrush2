from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

def read(p):
    p = Path(p)
    if not p.exists():
        return ""
    return p.read_text(encoding="utf-8", errors="replace")

main = read(root / "src/app/main.cpp")
save_h = read(root / "src/game/save.h")
save_cpp = read(root / "src/game/save.cpp")
quest_h = read(root / "src/game/quest.h")
quest_cpp = read(root / "src/game/quest.cpp")

for name in [
    "quest_log_write", "quest_log_read", "quest_grant_item", "quest_objective_text",
    "quest_time_text", "quest_eligible", "quest_state", "quest_line", "quest_accept",
    "quest_turn_in", "quest_on_kill", "quest_on_giver_died", "quest_tick",
]:
    out.append(
        f"{name}: main={main.count(name)} save_h={save_h.count(name)} "
        f"save_cpp={save_cpp.count(name)} quest_h={quest_h.count(name)} "
        f"quest_cpp={quest_cpp.count(name)}"
    )

out.append("\n==== quest.h API surface ====")
for i, line in enumerate(quest_h.splitlines(), 1):
    s = line.strip()
    if s.startswith("//") or not s:
        continue
    if any(k in s for k in ["quest_", "QuestLog", "struct Quest", "kQuest", "enum class"]):
        out.append(f"{i}:{line}")

out.append("\n==== save.h/cpp quest + version ====")
for label, t in [("save.h", save_h), ("save.cpp", save_cpp)]:
    out.append(f"-- {label} --")
    for i, line in enumerate(t.splitlines(), 1):
        if any(k in line for k in ["quest", "Quest", "kSaveVersion", "kSaveFixed", "WireBytes", "save_write", "save_read"]):
            out.append(f"{i}:{line[:180]}")

out.append("\n==== main save_run body markers ====")
for i, line in enumerate(main.splitlines(), 1):
    if any(k in line for k in ["save_write", "save_read", "save_run", "F5", "F9", "QuestLog", "quests"]):
        if any(k in line for k in ["save_", "F5", "F9", "quest_log", "QuestLog quests", "quests)"]):
            out.append(f"{i}:{line[:180]}")

# who calls quest_log_*
out.append("\n==== repo-wide quest_log_* ====")
for p in root.rglob("*"):
    if p.suffix.lower() not in {".h", ".hpp", ".c", ".cpp", ".inl", ".md"}:
        continue
    if "build" in p.parts or ".git" in p.parts:
        continue
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    if "quest_log_" in t:
        out.append(f"{p.relative_to(root)}")
        for i, line in enumerate(t.splitlines(), 1):
            if "quest_log_" in line:
                out.append(f"  {i}:{line[:160]}")

# suite after vendorammo
out.append("\n==== game_test around vendorammo ====")
gt = read(root / "tests/game_test.cpp")
lines = gt.splitlines()
for i, line in enumerate(lines):
    if "vendorammo" in line.lower() or "npcpool" in line.lower() or "test_npc" in line:
        out.append(f"{i+1}:{line.strip()[:160]}")

# list tests inl
out.append("\n==== tests dir ====")
for p in sorted((root / "tests").glob("*")):
    out.append(p.name)

# suite_saveload quest
out.append("\n==== saveload/quest tests ====")
for p in sorted((root / "tests").glob("*")):
    t = read(p)
    if "quest_log" in t or ("quest" in t.lower() and "save" in p.name.lower()):
        out.append(f"FILE {p.name}")
        for i, line in enumerate(t.splitlines(), 1):
            if "quest" in line.lower():
                out.append(f"  {i}:{line[:160]}")

# AIMEM in main
out.append("\n==== AIMEM main sites ====")
for i, line in enumerate(main.splitlines(), 1):
    if "ai_release" in line or "AiMemory" in line or "ai_memory" in line:
        out.append(f"{i}:{line[:180]}")

Path(r"C:/hades/gigahrush2/shots/_probe_next_work_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
