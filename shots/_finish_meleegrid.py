# MELEEGRID ship: CMake pin 219615 -> 219621, BACKLOG CLOSED, commit msg.
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")

# --- CMake pin ---
cm = root / "CMakeLists.txt"
t = cm.read_text(encoding="utf-8")
old = 'PASS_REGULAR_EXPRESSION "game_test: 219615 checks, 0 failures"'
new = 'PASS_REGULAR_EXPRESSION "game_test: 219621 checks, 0 failures"'
if old not in t:
    # try find current pin
    import re
    m = re.search(r'PASS_REGULAR_EXPRESSION "game_test: (\d+) checks, 0 failures"', t)
    raise SystemExit(f"CMake pin not found: {old!r}; current={m.group(1) if m else None}")
cm.write_text(t.replace(old, new, 1), encoding="utf-8", newline="\n")
print("CMake pin -> 219621")

# --- BACKLOG ---
blp = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
b = blp.read_text(encoding="utf-8")

closed_row = (
    "| MELEEGRID | player_melee_step forwards grid to apply_damage so WallBrace "
    "(Panelnik) soaks player melee like projectiles/mob swings | "
    "**unit GREEN:** game_test **219621 checks, 0 failures** "
    "(+6 MELEEGRID braced/open) | this commit |\n"
)
marker = "|----|------|-------|--------|\n"
if "| MELEEGRID |" not in b.split("## OPEN")[0] if "## OPEN" in b else b:
    if marker in b:
        b = b.replace(marker, marker + closed_row, 1)
        print("BACKLOG CLOSED table row added")
    else:
        # try insert after first CLOSED table header line
        alt = "|----|"
        idx = b.find("|----")
        if idx < 0:
            print("WARN: no CLOSED table marker")
        else:
            # find end of header separator line
            eol = b.find("\n", idx)
            b = b[: eol + 1] + closed_row + b[eol + 1 :]
            print("BACKLOG CLOSED row via alt insert")
else:
    print("BACKLOG CLOSED MELEEGRID already present")

# OPEN note
if "| P3 | MELEEGRID |" not in b and "MELEEGRID | CLOSED" not in b:
    mag = "| P3 | MAGSHOT |"
    open_row = (
        "| P3 | MELEEGRID | CLOSED 2026-08-01 — player_melee forwards grid "
        "(WallBrace soak) | src/game/combat.cpp + suite_behaviours §18 | "
        "see CLOSED MELEEGRID |\n"
    )
    if mag in b:
        b = b.replace(mag, open_row + mag, 1)
        print("BACKLOG OPEN MELEEGRID CLOSED note added")
    else:
        print("WARN: MAGSHOT row not found")

# Next OPEN lines
for old_n, new_n in [
    (
        "Next OPEN: MAGSHOT deferred (POSRPG CLOSED); stay off src/render/**.",
        "Next OPEN: MAGSHOT deferred (MELEEGRID CLOSED); stay off src/render/**.",
    ),
    (
        "Next OPEN: MAGSHOT deferred (POSRPG CLOSED)",
        "Next OPEN: MAGSHOT deferred (MELEEGRID CLOSED)",
    ),
]:
    if old_n in b:
        b = b.replace(old_n, new_n)
        print("updated Next OPEN line")

# CLOSED section
if "## CLOSED 2026-08-01 MELEEGRID" not in b:
    section = """
## CLOSED 2026-08-01 MELEEGRID — player_melee forwards grid (WallBrace)
```
Hole: player_melee_step had MacroGrid* for wall-chip carves but forgot to pass
      it into apply_damage. WallBrace (Panelnik) soaked bullets (projectile_step)
      and mob swings (mob_attack_step) but took full fist damage from the player.
Fix:  apply_damage(..., self, grid);  // was missing 7th arg
Pin:  suite_behaviours §18 MELEEGRID
      braced: player 109.2,100 → pan 110,100 (wall 56,50); fist 3 → applied 2 @ x0.58
      open:   player 100,109.2 → pan 100,110; applied == 3
game_test: 219621 checks, 0 failures (was 219615; +6)
pathspec: src/game/combat.cpp tests/suite_behaviours.inl
          CMakeLists.txt .agents/worker_game_audit/BACKLOG.md
```
Next OPEN: MAGSHOT deferred; stay off src/render/**.
"""
    b = b.rstrip() + "\n" + section
    print("BACKLOG CLOSED section appended")

blp.write_text(b, encoding="utf-8", newline="\n")
print("BACKLOG written")

# --- commit message ---
msg = root / "shots" / "_meleegrid_commit_msg.txt"
msg.write_text(
    "MELEEGRID: player_melee_step forwards grid so WallBrace soaks fists\n"
    "\n"
    "player_melee_step already took MacroGrid* for wall-chip carves but forgot\n"
    "to pass it into apply_damage. WallBrace (Panelnik) soaked projectiles and\n"
    "mob swings; player fists hit for full damage. One-arg fix + suite_behaviours\n"
    "section 18 (braced applied=2 @ x0.58, open applied=3).\n"
    "\n"
    "game_test: 219621 checks, 0 failures (was 219615; +6)\n",
    encoding="utf-8",
    newline="\n",
)
print("commit msg written", msg)
