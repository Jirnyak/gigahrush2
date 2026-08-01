from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
out = []

# scan agent handoffs / original requests for remaining work
keys = ("OPEN", "TODO", "unwired", "not wired", "missing", "gap", "NEXT", "blocked", "fail", "hang")
for d in sorted((root / ".agents").iterdir()):
    if not d.is_dir():
        continue
    hits = []
    for name in ["handoff.md", "ORIGINAL_REQUEST.md", "progress.md", "BACKLOG.md", "status.md", "FINDINGS.md"]:
        p = d / name
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        for i, line in enumerate(t.splitlines(), 1):
            low = line.lower()
            if any(k.lower() in low for k in keys) or line.strip().startswith("- [ ]"):
                hits.append(f"{name}:{i}:{line.strip()[:140]}")
    if hits:
        out.append(f"\n==== {d.name} ({len(hits)} hits) ====")
        out.extend(hits[:40])

# victory + orchestrator full short files
for name in ["victory_auditor", "orchestrator", "orchestrator_7", "sentinel", "worker_game_audit"]:
    out.append(f"\n######## {name} ########")
    d = root / ".agents" / name
    if not d.exists():
        continue
    for p in sorted(d.glob("*.md")):
        t = p.read_text(encoding="utf-8", errors="replace")
        out.append(f"--- {p.name} ({len(t)} bytes) ---")
        out.append(t[:2500])

# gt status
for f in ["_gt_long_err.txt", "_gt_long_out.txt", "_gt_long_rc.txt"]:
    p = root / "shots" / f
    out.append(f"\nGT {f} exists={p.exists()} size={p.stat().st_size if p.exists() else 0}")
    if p.exists():
        t = p.read_text(encoding="utf-8", errors="replace")
        out.append(t[-1500:])

Path(r"C:/hades/gigahrush2/shots/_probe_orchestrator_open_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
