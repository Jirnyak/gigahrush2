"""Deep probe SaveState serialize + suite_saveload for SAVRPG."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out_lines = []

def log(s=""):
    out_lines.append(s)
    print(s, flush=True)

# save.cpp write/read body
sc = (root / "src/game/save.cpp").read_text(encoding="utf-8", errors="replace")
log("=== save.cpp lines 340-650 ===")
for i, l in enumerate(sc.splitlines(), 1):
    if 340 <= i <= 650:
        log(f"{i}: {l.rstrip()}")

log("\n=== save.h kSaveVersion + PlayerSnapshot + SaveState comments ===")
sh = (root / "src/game/save.h").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(sh.splitlines(), 1):
    if 70 <= i <= 100 or 320 <= i <= 380 or any(
        k in l for k in ("save_bytes_for", "kPlayerWire", "kSaveHeader", "CraftingState", "RpgStats")
    ):
        log(f"{i}: {l.rstrip()[:160]}")

log("\n=== craft.h wire section ===")
ch = (root / "src/game/craft.h").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(ch.splitlines(), 1):
    if 370 <= i <= 413 or "craft_write" in l or "craft_read" in l or "kCraftingWire" in l:
        log(f"{i}: {l.rstrip()[:160]}")

log("\n=== rpg.h RpgStats layout ===")
rh = (root / "src/game/rpg.h").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(rh.splitlines(), 1):
    if 90 <= i <= 115:
        log(f"{i}: {l.rstrip()}")

log("\n=== suite_saveload.inl key tests ===")
sl = (root / "tests/suite_saveload.inl").read_text(encoding="utf-8", errors="replace")
log(f"size={len(sl)} lines={sl.count(chr(10))}")
for i, l in enumerate(sl.splitlines(), 1):
    if any(k in l for k in ("TEST", "void test_", "CHECK", "version", "Rpg", "craft", "Craft", "player.", "kSaveVersion", "round_trip", "macro")):
        if i < 200 or "Rpg" in l or "craft" in l.lower() or "version" in l.lower() or "void test_" in l:
            log(f"{i}: {l.rstrip()[:160]}")

# main capture of player into SaveState
log("\n=== main.cpp save_run_now body ===")
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
for i, l in enumerate(main.splitlines(), 1):
    if 1810 <= i <= 1920 or 3400 <= i <= 3550:
        log(f"{i}: {l.rstrip()[:160]}")

(root / "shots/_probe_savrpg2.txt").write_text("\n".join(out_lines) + "\n", encoding="utf-8")
log("wrote shots/_probe_savrpg2.txt")
