from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

def read(p):
    p = Path(p)
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""

save_h = read(root / "src/game/save.h")
save_cpp = read(root / "src/game/save.cpp")
quest_h = read(root / "src/game/quest.h")
quest_cpp = read(root / "src/game/quest.cpp")
main = read(root / "src/app/main.cpp")
sl = read(root / "tests/suite_saveload.inl")
sq = read(root / "tests/suite_quest.inl")

out.append("==== quest_log API in quest.h/cpp ====")
for label, t in [("h", quest_h), ("c", quest_cpp)]:
    for i, line in enumerate(t.splitlines(), 1):
        if "quest_log" in line or "kQuestLog" in line or "LogBytes" in line:
            out.append(f"{label}{i}:{line[:180]}")

out.append("\n==== save_write/read signatures and body outline ====")
for i, line in enumerate(save_h.splitlines(), 1):
    if "save_write" in line or "save_read" in line or "kSaveVersion" in line or "struct Save" in line:
        out.append(f"h{i}:{line[:180]}")

# find save_write function body markers
out.append("\n==== save.cpp structure ====")
for i, line in enumerate(save_cpp.splitlines(), 1):
    if re.search(r"^(bool|void|int|std::|static|namespace|// ---|// ==)", line.strip()) or "save_write" in line or "save_read" in line or "kSaveVersion" in line:
        if any(k in line for k in ["save_write", "save_read", "kSaveVersion", "write_", "read_", "return", "bool save", "namespace", "contract", "quest", "player", "inventory", "floor"]):
            out.append(f"{i}:{line[:180]}")

out.append("\n==== main F5/F9 save_run args ====")
lines = main.splitlines()
for i, line in enumerate(lines):
    if "save_write(" in line or "save_read(" in line or "save_run" in line:
        lo, hi = max(0, i-8), min(len(lines), i+15)
        for j in range(lo, hi):
            out.append(f"{j+1}:{lines[j][:180]}")
        out.append("---")

out.append("\n==== suite_saveload quest mentions ====")
for i, line in enumerate(sl.splitlines(), 1):
    if "quest" in line.lower():
        out.append(f"{i}:{line[:180]}")

out.append("\n==== suite_quest log roundtrip ====")
for i, line in enumerate(sq.splitlines(), 1):
    if "quest_log" in line or "log_write" in line or "log_read" in line or "round" in line.lower():
        out.append(f"{i}:{line[:180]}")

# contract save?
out.append("\n==== contract save API ====")
ch = read(root / "src/game/contract.h")
for i, line in enumerate(ch.splitlines(), 1):
    if "log" in line.lower() or "write" in line or "read" in line or "save" in line.lower():
        out.append(f"{i}:{line[:180]}")

out.append("\n==== contract in save.cpp/main ====")
out.append(f"save_cpp contract: {save_cpp.lower().count('contract')}")
out.append(f"main contract_log: {main.count('contract_log')}")
for p in [root/"src/game/save.cpp", root/"src/app/main.cpp"]:
    t = read(p)
    for i, line in enumerate(t.splitlines(), 1):
        if "contract_log" in line or ("quest_log" in line):
            out.append(f"{p.name}:{i}:{line[:160]}")

# docs about quest persistence
out.append("\n==== docs quest save ====")
for p in root.rglob("*.md"):
    if "build" in p.parts or ".git" in p.parts:
        continue
    t = read(p)
    if "quest_log" in t or ("quest" in t.lower() and "save" in t.lower() and "persist" in t.lower()):
        rel = str(p.relative_to(root))
        if t.count("quest") < 5 and "quest_log" not in t:
            continue
        out.append(f"FILE {rel}")
        for i, line in enumerate(t.splitlines(), 1):
            if "quest_log" in line or ("quest" in line.lower() and "save" in line.lower()):
                out.append(f"  {i}:{line[:160]}")

Path(r"C:/hades/gigahrush2/shots/_probe_quest_save_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
