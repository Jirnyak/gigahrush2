from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
out = []

bl = root / ".agents/worker_game_audit/BACKLOG.md"
text = bl.read_text(encoding="utf-8", errors="replace")
out.append(f"BACKLOG lines {len(text.splitlines())}")
for i, l in enumerate(text.splitlines(), 1):
    u = l.upper()
    if any(k in u for k in ["OPEN", "TODO", "WIRE", "GAP", "MISSING", "UNWIRED", "NEXT", "FIXME", "LANE"]):
        out.append(f"{i}:{l[:180]}")

for name in [
    "shots/_audit_unwired.md",
    "shots/_probe_unwired_live_out.txt",
    "shots/_probe_next_gap_out.txt",
    "shots/_probe_next_gap2_out.txt",
    "shots/_probe_gap_deep_out.txt",
    "shots/_qkill_done_note.py",
    ".agents/worker_game_audit/progress.md",
]:
    p = root / name
    out.append(f"\n==== {name} exists={p.exists()} ====")
    if p.exists():
        t = p.read_text(encoding="utf-8", errors="replace")
        out.append(t[:3500])

# main.cpp quest hooks
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
out.append(f"\nquest_on_kill count={main.count('quest_on_kill')}")
out.append(f"quest_on_giver_died count={main.count('quest_on_giver_died')}")
out.append(f"contract_on_kill count={main.count('contract_on_kill')}")

# Look for common unwired APIs in game headers vs main
game_h = list((root / "src/game").glob("*.h"))
apis = []
for h in game_h:
    for line in h.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s.startswith("void ") or s.startswith("bool ") or s.startswith("int "):
            if "(" in s and not s.startswith("//"):
                name = s.split("(")[0].split()[-1]
                if name.startswith("quest_") or name.startswith("contract_") or name.startswith("save_") or name.startswith("stat_"):
                    apis.append((h.name, name))

out.append("\n==== selected game APIs vs main ====")
for hname, name in apis:
    c = main.count(name)
    if c == 0:
        # also check other app files
        app_hits = 0
        for f in (root / "src/app").rglob("*.cpp"):
            app_hits += f.read_text(encoding="utf-8", errors="replace").count(name)
        for f in (root / "src").rglob("*.cpp"):
            if "test" in f.name:
                continue
        out.append(f"UNWIRED? {hname}::{name} main={c} app_scan_later")
    else:
        out.append(f"ok {hname}::{name} main={c}")

Path(r"C:/hades/gigahrush2/shots/_probe_open_now_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
