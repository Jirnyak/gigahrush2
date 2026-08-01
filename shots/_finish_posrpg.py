"""POSRPG ship: pin CMake 219615, BACKLOG CLOSED, commit msg."""
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")

# --- CMake pin ---
cm_path = root / "CMakeLists.txt"
cm = cm_path.read_text(encoding="utf-8")
old_pin = 'PASS_REGULAR_EXPRESSION "game_test: 219586 checks, 0 failures"'
new_pin = 'PASS_REGULAR_EXPRESSION "game_test: 219615 checks, 0 failures"'
if old_pin not in cm:
    raise SystemExit(f"pin not found: {old_pin!r}")
cm = cm.replace(old_pin, new_pin, 1)
cm_path.write_text(cm, encoding="utf-8", newline="\n")
print("CMAKE pin -> 219615")

# --- BACKLOG ---
bl_path = root / ".agents/worker_game_audit/BACKLOG.md"
bl = bl_path.read_text(encoding="utf-8")

# timestamp
bl = bl.replace(
    "Updated: 2026-07-31 ~19:28 Samara",
    "Updated: 2026-08-01 ~00:45 Samara",
    1,
)

# CLOSED this session row at top of table (after header separator)
closed_row = (
    "| POSRPG | voluntary P-possess carries RpgStats+kills+shots/hits via "
    "transfer_player_progression; mag stays on abandoned body | "
    "**unit GREEN:** game_test **219615 checks, 0 failures** "
    "(+29 possess transfer) | this commit |\n"
)
marker = "|----|------|-------|--------|\n"
if marker not in bl:
    raise SystemExit("CLOSED table marker missing")
if "| POSRPG |" not in bl.split("## OPEN")[0]:
    bl = bl.replace(marker, marker + closed_row, 1)
    print("BACKLOG CLOSED row added")
else:
    print("BACKLOG CLOSED row already present")

# OPEN table: add POSRPG closed note near MAGSHOT if not there
if "| P3 | POSRPG |" not in bl:
    mag = "| P3 | MAGSHOT |"
    pos_row = (
        "| P3 | POSRPG | CLOSED 2026-08-01 — voluntary possess carries "
        "RpgStats+kills+shots/hits | src/game/combat.* + main possess | "
        "see CLOSED POSRPG |\n"
    )
    if mag in bl:
        bl = bl.replace(mag, pos_row + mag, 1)
        print("BACKLOG OPEN POSRPG CLOSED row added")
    else:
        print("WARN: MAGSHOT row not found for OPEN insert")

# SAVMAG footer Next OPEN lines
bl = bl.replace(
    "Next OPEN: MAGSHOT deferred / POSRPG deferred; stay off src/render/**.",
    "Next OPEN: MAGSHOT deferred (POSRPG CLOSED); stay off src/render/**.",
)

# Append POSRPG CLOSED section if missing
if "## CLOSED 2026-08-01 POSRPG" not in bl and "## CLOSED 2026-07-31 POSRPG" not in bl:
    section = """
## CLOSED 2026-08-01 POSRPG — voluntary possess carries progression
```
Hole: possess_nearest_survivor was camera-only (CameraTag/Controller swap).
Death path and elevator already kept RpgStats + kills (+ shots/hits); P-key hop
dropped the person sheet and reset kill/shot tallies on the new body.

transfer_player_progression(reg, from, to) in combat.cpp:
  * RpgStats: COPY from -> to
  * PlayerMelee::kills: MOVE (zero from, stamp to)
  * PlayerRanged shots/hits: MOVE; mag/weapon/cooldowns STAY on from
  * lazy: no empty PlayerRanged invented on to when shots=hits=0 and to has none
  * no-op if from==to or invalid handles

Wire:
  possess_nearest_survivor: after set_player, transfer(oldPlayer, chosen)
  possessWanted site: refresh local kills + carriedRpg after hop
  death comment: fresh sheet wrong for death AND voluntary possess

test_rpg_possess_transfer in suite_rpg.inl (~29 CHECKs):
  two NPCs, mutate sheet/kills/ranged, transfer, pin sheet/kills moved,
  mag stays, shots/hits moved, idempotent + null no-op

game_test: 219615 checks, 0 failures (was 219586; +29)
pathspec: src/game/combat.h src/game/combat.cpp src/app/main.cpp
          tests/suite_rpg.inl CMakeLists.txt BACKLOG.md
```
Next OPEN: MAGSHOT deferred (POSRPG CLOSED); stay off src/render/**.
"""
    bl = bl.rstrip() + "\n" + section
    print("BACKLOG CLOSED section appended")
else:
    print("BACKLOG CLOSED section already present")

bl_path.write_text(bl, encoding="utf-8", newline="\n")
print("BACKLOG written")

# commit message
msg = root / "shots/_posrpg_commit_msg.txt"
msg.write_text(
    "POSRPG: voluntary possess carries RpgStats+kills+shots/hits\n"
    "\n"
    "possess_nearest_survivor was camera-only; death and elevator already kept\n"
    "progression. Add transfer_player_progression: copy RpgStats, move kills and\n"
    "ranged shots/hits; mag stays on the abandoned body. Unit pin 219615 (+29).\n",
    encoding="utf-8",
    newline="\n",
)
print("commit msg written")
print("OK")
