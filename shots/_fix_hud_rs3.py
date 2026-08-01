# Fix HUD shownDmg: rs out of scope + std::max MSVC issues
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
main = ROOT / "src/app/main.cpp"
mt = main.read_text(encoding="utf-8")

old = """                    {
                        std::uint16_t shownDmg = md->dmg;
                        if (rs)
                            shownDmg = static_cast<std::uint16_t>(
                                std::max<std::int16_t>(
                                    1, game::melee_damage(
                                           *rs, wpn,
                                           static_cast<std::int16_t>(md->dmg))));
                        ImGui::Text("weapon: %s (%u dmg) | armour: %s",
                                    wpn == game::kInvalidItem ? "fists"
                                                              : game::item_name(wpn),
                                    shownDmg,
                                arm == game::kInvalidItem ? "none"
                                                          : game::item_name(arm));
                    }"""

new = """                    {
                        // rs above is scoped to the character-sheet if; re-fetch
                        // here so melee HUD shows RPG-scaled damage (RPGCMBT).
                        std::uint16_t shownDmg = md->dmg;
                        if (const auto* rsHud =
                                reg.try_get<game::RpgStats>(player)) {
                            const std::int16_t scaled = game::melee_damage(
                                *rsHud, wpn,
                                static_cast<std::int16_t>(md->dmg));
                            shownDmg = static_cast<std::uint16_t>(
                                scaled > 1 ? scaled : std::int16_t{1});
                        }
                        ImGui::Text("weapon: %s (%u dmg) | armour: %s",
                                    wpn == game::kInvalidItem ? "fists"
                                                              : game::item_name(wpn),
                                    shownDmg,
                                arm == game::kInvalidItem ? "none"
                                                          : game::item_name(arm));
                    }"""

if old not in mt:
    print("FAIL exact block not found")
    # try to locate shownDmg region
    idx = mt.find("shownDmg")
    if idx < 0:
        print("no shownDmg at all")
    else:
        print(repr(mt[idx - 50 : idx + 450]))
    raise SystemExit(1)

mt = mt.replace(old, new, 1)
main.write_text(mt, encoding="utf-8", newline="\n")
print("OK fixed shownDmg HUD block")

# Verify no bare `if (rs)` near shownDmg
idx = mt.find("shownDmg")
chunk = mt[idx : idx + 400]
if "if (rs)" in chunk:
    print("WARN still has if (rs)")
else:
    print("OK no bare if (rs)")
if "rsHud" in chunk:
    print("OK rsHud present")

# CMake note for ATTR1 if missing
cm = ROOT / "CMakeLists.txt"
ct = cm.read_text(encoding="utf-8")
if "219409 -> 219422" not in ct and 'game_test: 219422 checks' in ct:
    pin = '        PASS_REGULAR_EXPRESSION "game_test: 219422 checks, 0 failures")\n'
    note = (
        "    # 219409 -> 219422 (+13) on 2026-07-31: ATTR1 keybind/console spend +\n"
        "    # AGIMV move mult live; suite_console +9, suite_keybind +4.\n"
    )
    if pin in ct:
        ct = ct.replace(pin, note + pin, 1)
        cm.write_text(ct, encoding="utf-8", newline="\n")
        print("OK CMake changelog note added")
    else:
        print("WARN pin line format mismatch for note")
else:
    print("OK CMake note present or pin absent")
