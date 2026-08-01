# Fix HUD shownDmg block: rs undeclared + std::max brace mess
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
main = ROOT / "src/app/main.cpp"
mt = main.read_text(encoding="utf-8")
lines = mt.splitlines()

# Print context around shownDmg
for i, l in enumerate(lines, 1):
    if "shownDmg" in l or (3900 <= i <= 3980 and ("rs" in l or "RpgStats" in l or "weapon:" in l or "melee_damage" in l)):
        if 3880 <= i <= 4000:
            print(f"{i}|{l}")

print("---INCLUDES---")
for i, l in enumerate(lines[:80], 1):
    if "include" in l and ("algorithm" in l or "rpg" in l or "combat" in l):
        print(f"{i}|{l}")

print("---PIN---")
cm = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
for i, l in enumerate(cm.splitlines(), 1):
    if "2194" in l or "game_test:" in l:
        print(f"{i}|{l}")

# Find the broken HUD block. Expected broken pattern from patch:
# {
#     std::uint16_t shownDmg = md->dmg;
#     if (rs)
#         shownDmg = static_cast<std::uint16_t>(
#             std::max<std::int16_t>(
#                 1, game::melee_damage(
#                        *rs, wpn,
#                        static_cast<std::int16_t>(md->dmg))));
#     ImGui::Text("weapon: %s (%u dmg) | armour: %s",
#                 ...

# Need to find where rs should come from. Search nearby for try_get RpgStats
idx = mt.find("shownDmg")
print("---CONTEXT 800 chars before shownDmg---")
print(mt[max(0, idx - 800) : idx + 600])
