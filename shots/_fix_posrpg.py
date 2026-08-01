# -*- coding: utf-8 -*-
"""Fix ranged lazy-attach edge + verify suite_rpg includes embody."""
from pathlib import Path
import sys
ROOT = Path(r"C:\hades\gigahrush2")

# Fix combat.cpp: do not invent empty PlayerRanged on dest when shots=hits=0
cc = ROOT / "src/game/combat.cpp"
text = cc.read_text(encoding="utf-8")
old = """    if (PlayerRanged* pr = reg.try_get<PlayerRanged>(from)) {
        const std::uint32_t shots = pr->shots;
        const std::uint32_t hits = pr->hits;
        pr->shots = 0;
        pr->hits = 0;
        // Mag/weapon/cooldowns remain on `from`. New body only needs the
        // cumulative counters so the next lazy attach does not invent zeros.
        if (shots != 0 || hits != 0 || reg.all_of<PlayerRanged>(to)) {
            PlayerRanged dst{};
            if (PlayerRanged* existing = reg.try_get<PlayerRanged>(to)) {
                dst = *existing;
            }
            dst.shots = shots;
            dst.hits = hits;
            // Do not overwrite a chamber the destination already holds.
            reg.emplace_or_replace<PlayerRanged>(to, dst);
        } else {
            PlayerRanged dst{};
            dst.shots = shots;
            dst.hits = hits;
            reg.emplace_or_replace<PlayerRanged>(to, dst);
        }
    }
"""
new = """    if (PlayerRanged* pr = reg.try_get<PlayerRanged>(from)) {
        const std::uint32_t shots = pr->shots;
        const std::uint32_t hits = pr->hits;
        pr->shots = 0;
        pr->hits = 0;
        // Mag/weapon/cooldowns remain on `from`. Move only the cumulative
        // counters; do not invent PlayerRanged on a body that never fired and
        // has nothing to carry (lazy attach stays lazy).
        if (shots == 0 && hits == 0 && !reg.all_of<PlayerRanged>(to))
            return; // kills/rpg already handled above
        PlayerRanged dst{};
        if (PlayerRanged* existing = reg.try_get<PlayerRanged>(to))
            dst = *existing;
        dst.shots = shots;
        dst.hits = hits;
        reg.emplace_or_replace<PlayerRanged>(to, dst);
    }
"""
if old not in text:
    print("FAIL fix block not found")
    sys.exit(1)
cc.write_text(text.replace(old, new), encoding="utf-8")
print("OK combat.cpp lazy ranged fix")

# suite_rpg includes
sr = (ROOT / "tests/suite_rpg.inl").read_text(encoding="utf-8")
# game_test.cpp includes before suite_rpg
gt = (ROOT / "tests/game_test.cpp").read_text(encoding="utf-8").splitlines()
print("--- game_test includes before suite_rpg ---")
for i, ln in enumerate(gt[:120], 1):
    if "include" in ln or "suite_" in ln:
        print(f"{i}|{ln}")

# verify transfer present
for p in ["src/game/combat.h", "src/game/combat.cpp", "src/app/main.cpp", "tests/suite_rpg.inl"]:
    t = (ROOT / p).read_text(encoding="utf-8")
    print(f"{p}: transfer={('transfer_player_progression' in t)}  POSRPG={('POSRPG' in t)}")
