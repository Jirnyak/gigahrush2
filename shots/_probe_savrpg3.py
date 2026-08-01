"""Deep probe visit_player, F9, craft/rpg live, suite for SAVRPG."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = []

def log(s=""):
    out.append(s)

# visit_player + helpers in save.cpp
sc = (root / "src/game/save.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
log("=== save.cpp visit_* hits ===")
for i, l in enumerate(sc, 1):
    if any(k in l for k in (
        "visit_player", "visit_needs", "visit_inv", "visit_ledger",
        "visit_book", "visit_key", "visit_header", "kPlayerWire", "kRpg",
        "craft_write", "craft_read", "RpgStats", "CraftingState",
    )):
        log(f"{i}: {l[:180]}")

log("=== save.cpp lines 200-340 (visitors) ===")
for i in range(200, min(340, len(sc))):
    log(f"{i+1}: {sc[i][:180]}")

# F9 load body
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
log("=== main F9 3400-3600 ===")
for i in range(3399, min(3600, len(main))):
    log(f"{i+1}: {main[i][:180]}")

log("=== main craft/rpg/runState live hits ===")
for i, l in enumerate(main, 1):
    if any(k in l for k in (
        "CraftingState", "craftState", "craft_", "RpgStats",
        "fresh_rpg", "try_get<game::RpgStats", "emplace<game::RpgStats",
        "emplace_or_replace<game::RpgStats", "spend_attr",
        "runState.", "apply_player_snapshot",
    )):
        log(f"{i}: {l[:180]}")

# suite fill + equality + test list
sl = (root / "tests/suite_saveload.inl").read_text(encoding="utf-8", errors="replace").splitlines()
log("=== suite_saveload first 250 ===")
for i in range(min(250, len(sl))):
    log(f"{i+1}: {sl[i][:180]}")

log("=== suite test names + end ===")
for i, l in enumerate(sl, 1):
    if "static void test_" in l or "test_saveload_all" in l:
        log(f"{i}: {l[:180]}")
for i in range(max(0, len(sl) - 40), len(sl)):
    log(f"{i+1}: {sl[i][:180]}")

# craft write/read
ch = (root / "src/game/craft.cpp").read_text(encoding="utf-8", errors="replace").splitlines()
log("=== craft_write/read body ===")
for i in range(350, min(400, len(ch))):
    log(f"{i+1}: {ch[i][:180]}")

# includes in save.cpp / save.h
log("=== save.cpp includes ===")
for i, l in enumerate(sc[:40], 1):
    log(f"{i}: {l[:180]}")

# CMake pin
cm = (root / "CMakeLists.txt").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(cm.splitlines(), 1):
    if "PASS_REGULAR" in l or "game_test" in l and "checks" in l:
        log(f"CMake {i}: {l[:160]}")

# BACKLOG SAVRPG
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
log("=== BACKLOG SAVRPG ===")
for i, l in enumerate(bl.splitlines(), 1):
    if "SAVRPG" in l or "ATTR1" in l or "NEXT" in l.upper()[:20]:
        log(f"{i}: {l[:160]}")

(root / "shots/_probe_savrpg3.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
print("OK lines", len(out))
