# SAVSTAT wire pattern + award_xp INT + status_melee in combat
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")

# award_xp body
print("=== award_xp ===")
rc = (root/"src/game/rpg.cpp").read_text(encoding="utf-8")
lines = rc.splitlines()
for i,l in enumerate(lines):
    if "award_xp" in l and ("void" in l or "{" in l or "(" in l):
        # print function
        if i > 0 and ("void" in lines[i] or "void" in lines[i-1] or "bool" in lines[i]):
            start = i-1 if "void" in lines[i-1] else i
            for j in range(start, min(start+60, len(lines))):
                print(f"L{j+1}: {lines[j][:140]}")
                if j > start and lines[j].strip() == "}" and lines[j].startswith("}"):
                    break
            break

# status_melee in combat
print("\n=== status_melee / status_ in combat ===")
cc = (root/"src/game/combat.cpp").read_text(encoding="utf-8")
for i,l in enumerate(cc.splitlines(),1):
    if "status_" in l or "StatusSet" in l or "melee_mult" in l:
        print(f"L{i}: {l.rstrip()[:140]}")

# main status usage
print("\n=== main status_ / playerStatus key lines ===")
main = (root/"src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
for i,l in enumerate(main.splitlines(),1):
    if re.search(r"playerStatus|status_step|status_apply|status_move|status_melee|status_aim|status_is_rooted|status_heal|status_water", l):
        print(f"L{i}: {l.rstrip()[:140]}".encode("ascii","replace").decode("ascii"))

# save path pattern SAVMAG - visit_ranged etc
print("\n=== save.cpp visit / write order around combat ===")
sc = (root/"src/game/save.cpp").read_text(encoding="utf-8", errors="replace")
for i,l in enumerate(sc.splitlines(),1):
    if re.search(r"visit_|craft_|ranged|kills|kRpg|kCombat|kSaveFixed|write_run|read_run|player\.|hasRanged", l):
        if i < 500 or "visit" in l or "craft" in l or "ranged" in l or "kills" in l or "Fixed" in l:
            print(f"L{i}: {l.rstrip()[:140]}".encode("ascii","replace").decode("ascii"))

# suite_saveload wire_layout pins
print("\n=== suite_saveload wire pins ===")
sl = (root/"tests/suite_saveload.inl").read_text(encoding="utf-8", errors="replace")
for i,l in enumerate(sl.splitlines(),1):
    if re.search(r"kSaveFixed|kSaveVersion|850|950|965|829|929|944|hasRanged|kills|wire_layout|kRpgWire|kCombat", l):
        print(f"L{i}: {l.rstrip()[:140]}")

# sizeof StatusSet estimate
print("\n=== StatusSet wire calc ===")
# remainMs 6*4=24, intensityE3 6*2=12, alt 6*1=6 → 42; with pad maybe 44
print("raw field bytes: 24+12+6 = 42")
print("kSaveFixedWire currently need to see value")
sh = (root/"src/game/save.h").read_text(encoding="utf-8")
for i,l in enumerate(sh.splitlines(),1):
    if "kSaveFixedWire" in l or "kCombatSave" in l or "kPlayerWire" in l or "kLedger" in l or "kBook" in l:
        print(f"L{i}: {l.rstrip()[:140]}")
        # next few
        for j in range(i, min(i+5, len(sh.splitlines()))):
            if j!=i: print(f"L{j+1}: {sh.splitlines()[j].rstrip()[:140]}")

# F5/F9 capture in main
print("\n=== main F5 save_run / F9 load status-ish ===")
for i,l in enumerate(main.splitlines(),1):
    if re.search(r"runState\.(rpg|craft|ranged|kills|hasRanged)|save_run_now|playerStatus", l):
        print(f"L{i}: {l.rstrip()[:140]}".encode("ascii","replace").decode("ascii"))

# int_xp in award?
print("\n=== int_xp_mult in rpg.cpp ===")
for i,l in enumerate(rc.splitlines(),1):
    if "int_xp" in l or "award_xp" in l:
        print(f"L{i}: {l.rstrip()[:140]}")

# slow_step in main
print("\n=== slow_step in main ===")
for i,l in enumerate(main.splitlines(),1):
    if "slow_step" in l:
        print(f"L{i}: {l.rstrip()[:140]}")

print("DONE")
