from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
out = []

def read(p):
    p = Path(p)
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""

# 1) quest_grant_item usage + docs
qh = read(root / "src/game/quest.h")
qc = read(root / "src/game/quest.cpp")
main = read(root / "src/app/main.cpp")
out.append("==== quest_grant_item ====")
for i, line in enumerate(qh.splitlines(), 1):
    if "grant" in line.lower() or "objective_text" in line or "time_text" in line or "quest_log" in line:
        out.append(f"h{i}:{line[:180]}")
for i, line in enumerate(qc.splitlines(), 1):
    if "grant" in line.lower() or "objective_text" in line or "time_text" in line or "quest_log" in line:
        out.append(f"c{i}:{line[:180]}")

# 2) suite_quest grant / log tests
sq = read(root / "tests/suite_quest.inl")
out.append("\n==== suite_quest grant/log/hud ====")
for i, line in enumerate(sq.splitlines(), 1):
    if any(k in line for k in ["grant", "objective_text", "time_text", "quest_log", "log_write", "log_read"]):
        out.append(f"{i}:{line[:180]}")

# 3) game_test hang: suite order after vendorammo
gt = read(root / "tests/game_test.cpp")
out.append("\n==== main suite order (last 80 calls) ====")
# find int main and list test_ calls
in_main = False
calls = []
for i, line in enumerate(gt.splitlines(), 1):
    if re.search(r"\bint\s+main\s*\(", line):
        in_main = True
    if in_main and re.search(r"\btest_\w+\s*\(", line):
        calls.append((i, line.strip()[:120]))
out.append(f"total test_ calls in main: {len(calls)}")
for i, c in calls[-40:]:
    out.append(f"{i}:{c}")

# locate vendorammo index
out.append("\n==== around vendorammo in call list ====")
for idx, (i, c) in enumerate(calls):
    if "vendor" in c.lower() or "npcpool" in c.lower() or "npc_pool" in c.lower():
        for j in range(max(0, idx - 2), min(len(calls), idx + 8)):
            out.append(f"  {calls[j][0]}:{calls[j][1]}")
        out.append("---")

# 4) find which .inl defines test after vendorammo
out.append("\n==== find test function defs ====")
for p in sorted((root / "tests").glob("*.inl")):
    t = read(p)
    if "test_vendorammo" in t or "test_npcpool" in t or "void test_" in t:
        # list void test_ names
        names = re.findall(r"void\s+(test_\w+)\s*\(", t)
        if names:
            out.append(f"{p.name}: {', '.join(names[:30])}")

# 5) BACKLOG OPEN section specifically
bl = read(root / ".agents/worker_game_audit/BACKLOG.md")
out.append("\n==== BACKLOG sections with OPEN ====")
cur = None
for i, line in enumerate(bl.splitlines(), 1):
    if line.startswith("#") or line.startswith("##"):
        cur = line
    if "OPEN" in line.upper() or line.strip().startswith("- [ ]"):
        out.append(f"{i}|{cur}|{line[:160]}")

# 6) manifesto bans still in code?
out.append("\n==== manifesto ban scan (sample) ====")
bans = ["std::string", "std::vector", "new ", "shared_ptr", "unique_ptr", "dynamic_cast"]
for ban in bans:
    hits = 0
    samples = []
    for p in (root / "src").rglob("*"):
        if p.suffix.lower() not in {".h", ".hpp", ".c", ".cpp", ".inl"}:
            continue
        if "third" in str(p).lower() or "external" in str(p).lower():
            continue
        t = read(p)
        if ban in t:
            # count non-comment rough
            for ln in t.splitlines():
                if ban in ln and not ln.strip().startswith("//"):
                    hits += 1
                    if len(samples) < 3:
                        samples.append(f"{p.relative_to(root)}:{ln.strip()[:100]}")
    out.append(f"{ban}: hits~{hits}")
    for s in samples:
        out.append(f"  {s}")

# 7) quest_log not in save - is that intentional?
out.append("\n==== save path includes ====")
for i, line in enumerate(read(root/"src/game/save.cpp").splitlines(), 1):
    if "write_" in line or "read_" in line or "kSaveVersion" in line or "quest" in line.lower():
        if i < 200 or "quest" in line.lower() or "Version" in line:
            out.append(f"{i}:{line[:160]}")

Path(r"C:/hades/gigahrush2/shots/_probe_real_gap_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
