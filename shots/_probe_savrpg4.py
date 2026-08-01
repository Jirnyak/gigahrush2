"""Round_trip + carriedRpg + quest checks for SAVRPG."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
out = []

def dump(path, ranges, tag):
    t = (root / path).read_text(encoding="utf-8", errors="replace").splitlines()
    out.append(f"=== {tag} ===")
    for lo, hi in ranges:
        for i in range(lo - 1, min(hi, len(t))):
            out.append(f"{i+1}: {t[i][:180]}")

t = (root / "tests/suite_saveload.inl").read_text(encoding="utf-8", errors="replace").splitlines()
out.append("=== suite hits ===")
for i, l in enumerate(t, 1):
    if any(k in l for k in ("round_trip", "st.quests", "quest_log", "same_run", "busy_run",
                            "kSaveFixed", "save_bytes_for", "bytes.size() == 839",
                            "kQuestLogWire")):
        out.append(f"{i}: {l[:180]}")

out.append("=== suite 250-340 ===")
for i in range(250, min(340, len(t))):
    out.append(f"{i+1}: {t[i][:180]}")

m = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
out.append("=== main carriedRpg block 1670-1730 ===")
for i in range(1670, min(1730, len(m))):
    out.append(f"{i+1}: {m[i][:180]}")
out.append("=== main death/rpg 3720-3780 ===")
for i in range(3720, min(3785, len(m))):
    out.append(f"{i+1}: {m[i][:180]}")
out.append("=== main includes craft/rpg ===")
for i, l in enumerate(m[:120], 1):
    if "craft" in l.lower() or "rpg" in l.lower() or "save.h" in l:
        out.append(f"{i}: {l[:180]}")

# quest_log_write signature
qh = (root / "src/game/quest.h").read_text(encoding="utf-8", errors="replace").splitlines()
out.append("=== quest wire ===")
for i, l in enumerate(qh, 1):
    if "kQuestLogWire" in l or "quest_log_write" in l or "quest_log_read" in l:
        out.append(f"{i}: {l[:180]}")

(root / "shots/_probe_savrpg4.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
print("OK", len(out))
