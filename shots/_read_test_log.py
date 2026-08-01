from pathlib import Path

for name in ["_game_test_attr1.txt", "_poll_test_out.txt", "_wait_test_out.txt"]:
    p = Path("shots") / name
    if not p.exists():
        print(f"MISSING {name}")
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    print(f"===== {name} size={len(t)} =====")
    lines = t.splitlines()
    hits = []
    for l in lines:
        low = l.lower()
        if any(x in low for x in ("fail", "check", "error", "assert", "attr", "keybind", "console", "exit")):
            hits.append(l)
    print(f"hits={len(hits)}")
    for l in hits[:80]:
        print(l)
    print("---TAIL40---")
    print("\n".join(lines[-40:]))
    print()
