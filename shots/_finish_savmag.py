# Finish SAVMAG: pin CMake, BACKLOG CLOSED entry, commit message.
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")

# --- CMake pin 219546 -> 219586 ---
cm = root / "CMakeLists.txt"
t = cm.read_text(encoding="utf-8")
old = 'PASS_REGULAR_EXPRESSION "game_test: 219546 checks, 0 failures"'
new = 'PASS_REGULAR_EXPRESSION "game_test: 219586 checks, 0 failures"'
if old not in t:
    raise SystemExit(f"CMake pin not found: {old!r}")
cm.write_text(t.replace(old, new, 1), encoding="utf-8", newline="\n")
print("CMake pin -> 219586")

# --- BACKLOG ---
bl = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
b = bl.read_text(encoding="utf-8")

# table row under CLOSED this session
row = (
    "| SAVMAG | F5/F9 persist PlayerRanged + melee kills; kSaveVersion 7->8; "
    "wire +21 combat (850/950/965) | **unit GREEN:** game_test **219586 checks, "
    "0 failures** (+40 saveload) | this commit |\n"
)
marker = "| SAVRPG |"
if "| SAVMAG |" not in b:
    b = b.replace(marker, row + marker, 1)
    print("BACKLOG table row added")
else:
    print("BACKLOG table row already present")

# follow-up line
b = b.replace(
    "3. ~~**SAVRPG**~~ CLOSED — kSaveVersion 7, RpgStats+CraftingState on F5/F9",
    "3. ~~**SAVRPG**~~ CLOSED — kSaveVersion 7, RpgStats+CraftingState on F5/F9\n"
    "3b. ~~**SAVMAG**~~ CLOSED — kSaveVersion 8, PlayerRanged+kills on F5/F9",
    1,
)

# next open lines
b = b.replace(
    "Next OPEN: MAGSHOT deferred (SAVRPG CLOSED)",
    "Next OPEN: MAGSHOT deferred (SAVMAG CLOSED)",
)
b = b.replace(
    "Next OPEN: MAGSHOT deferred; stay off src/render/**.",
    "Next OPEN: MAGSHOT deferred / POSRPG deferred; stay off src/render/**.\n",
)

# CLOSED block at end
if "## CLOSED 2026-07-31 SAVMAG" not in b:
    block = """
## CLOSED 2026-07-31 SAVMAG — F5/F9 PlayerRanged + melee kills
```
kSaveVersion 7 -> 8
wire: hasRanged u8 + visit_ranged (16 B) + kills u32 = kCombatSaveWire 21
  after craft; before opened keys
kSaveFixedWire 829 -> 850; empty 950; busy 3-opened 965
F5: hasRanged from try_get<PlayerRanged>; kills from local tally
F9: hasRanged -> emplace PlayerRanged; kills -> PlayerMelee{0,kills} + local
hasRanged keeps lazy-attach honest (elevator rule — no invented chamber)
suite_saveload: busy_run non-default mag/kills; same_run 8 CHECKs; wire_layout
game_test: 219586 checks, 0 failures (was 219546; +40)
pathspec: src/game/save.h src/game/save.cpp src/app/main.cpp
          tests/suite_saveload.inl CMakeLists.txt BACKLOG.md
```
Next OPEN: MAGSHOT deferred / POSRPG deferred; stay off src/render/**.
"""
    b = b.rstrip() + "\n" + block
    print("BACKLOG CLOSED block appended")
else:
    print("BACKLOG CLOSED block already present")

bl.write_text(b, encoding="utf-8", newline="\n")

# --- commit message ---
msg = root / "shots" / "_savmag_commit_msg.txt"
msg.write_text(
    """SAVMAG: F5/F9 persist chambered mag + kill tally (save v8)

Ammo already debited into PlayerRanged.magCount vanished on F9 because the
run save stopped at craft. kills already survive death-possession and the
elevator but not a process restart. kSaveVersion 7->8 adds hasRanged +
PlayerRanged (16 B field-by-field) + kills u32 after craft (+21 wire).

kSaveFixedWire 829->850; empty 950; busy 3-opened 965.
hasRanged mirrors the elevator lazy-attach rule.
game_test: 219586 checks, 0 failures (was 219546; +40).
""",
    encoding="utf-8",
    newline="\n",
)
print("commit msg written")
print("OK")
