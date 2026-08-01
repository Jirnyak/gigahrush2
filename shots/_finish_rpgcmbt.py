"""Bump CMake pin, append BACKLOG RPGCMBT CLOSED, write commit msg."""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

# --- CMake pin ---
cm = root / "CMakeLists.txt"
txt = cm.read_text(encoding="utf-8")
old = 'PASS_REGULAR_EXPRESSION "game_test: 219387 checks, 0 failures"'
new = 'PASS_REGULAR_EXPRESSION "game_test: 219409 checks, 0 failures"'
if old not in txt:
    # try find current pin
    m = re.search(r'PASS_REGULAR_EXPRESSION "game_test: (\d+) checks, 0 failures"', txt)
    print("CURRENT_PIN", m.group(1) if m else None)
    if m and m.group(1) == "219409":
        print("PIN_ALREADY_219409")
    else:
        raise SystemExit(f"pin pattern not found: {old!r}")
else:
    cm.write_text(txt.replace(old, new), encoding="utf-8")
    print("PIN_BUMPED 219387 -> 219409")

# --- BACKLOG ---
bl = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
bt = bl.read_text(encoding="utf-8")
block = """
## RPGCMBT CLOSED (2026-07-31) — combat formulas live

**Commit target:** combat.cpp + suite_rpg.inl + CMake pin 219409

### What shipped
- `player_melee_step`: when body has `RpgStats`, damage = `melee_damage(*rs, heldWeapon, wp->dmg)`;
  CD = `(base * agi_attack_speed_mult_e3 * str_heavy_weapon_speed_mult_e3) / 1e6` clamped [1,65535].
- `player_ranged_step`: spread *= `agi_ranged_spread_mult_e3/1000`; CD *= `agi_attack_speed_mult_e3/1000`.
- **Identity path:** no `RpgStats` → raw table dmg/CD/spread (keeps `test_player_shoots` green).
- Unit pin `test_rpg_combat_wire` in `suite_rpg.inl`: bare fists no-RPG, high STR/AGI melee,
  ranged no-RPG, high-AGI ranged CD. **game_test: 219409 checks, 0 failures** (was 219387, +22).

### Live spawn
- `embody_as_player` attaches `random_rpg` — primary boot path has sheet.
- XP-on-kill already wired via `award_xp` in `finalize_deaths`.
- Voluntary possess still naked (no sheet) — separate follow-up.

### NOT this commit (next OPEN)
1. **ATTR1** — `spend_attr_point` zero callers from main; HUD teases points; keys 1/2/3 needed.
2. **AGIMV** — `agi_move_speed_mult_e3` unused on walk.
3. **SAVRPG** — F5/F9 drops RpgStats + craft known-bits.
4. **RPGCMBT-SHOT** — live `--action attack` proof with forced high STR + `[rpgcmbt]` log line
   (scale is currently silent; HUD weapon dmg still prints table raw).
5. MAGSHOT still deferred.

### Critique notes (subagent)
- Ranged *damage* still raw `def->dmg` (no gun-dmg formula in rpg.h) — OK defer.
- Same-tick death+kill can drop XP from carriedRpg snapshot — latent, not this pin.

"""

if "RPGCMBT CLOSED" in bt:
    print("BACKLOG_ALREADY_HAS_RPGCMBT")
else:
    # insert after first heading or append
    if "## Next OPEN" in bt:
        bt = bt.replace("## Next OPEN", block + "\n## Next OPEN", 1)
    else:
        bt = bt.rstrip() + "\n" + block
    # refresh Next OPEN note
    if "Next OPEN" in bt:
        pass
    bl.write_text(bt, encoding="utf-8")
    print("BACKLOG_UPDATED")

# ensure Next OPEN lists ATTR1 etc
bt2 = bl.read_text(encoding="utf-8")
if "ATTR1" not in bt2.split("RPGCMBT CLOSED")[-1] if "RPGCMBT CLOSED" in bt2 else True:
    pass  # already in block

msg = root / "shots" / "_rpgcmbt_commit_msg.txt"
msg.write_text(
    "RPGCMBT: wire RPG melee/ranged formulas into combat (+22 checks)\n"
    "\n"
    "player_melee_step uses melee_damage + AGI/STR CD mults when RpgStats present;\n"
    "player_ranged_step scales spread/CD by AGI. Identity path keeps table values\n"
    "when the body has no sheet. test_rpg_combat_wire pins bare/high-attr paths.\n"
    "game_test pin 219387 -> 219409. Live proof shot + ATTR1/AGIMV/SAVRPG next.\n",
    encoding="utf-8",
)
print("COMMIT_MSG_WRITTEN")
print("DONE")
