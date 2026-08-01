from pathlib import Path
import os

for name in ["_mag_live_err.txt", "_mag_live_out.txt", "_mag_live_rc.txt"]:
    p = Path(r"C:/hades/gigahrush2/shots") / name
    print("===", name, "size", p.stat().st_size if p.exists() else "MISSING", "===")
    if p.exists():
        t = p.read_text(encoding="utf-8", errors="replace")
        print("lines", t.count("\n"), "chars", len(t))
        # print first/last
        lines = t.splitlines()
        for L in lines[:80]:
            print(L)
        if len(lines) > 80:
            print("... (%d more) ..." % (len(lines) - 100))
            for L in lines[-20:]:
                print(L)

# shot png?
png = Path(r"C:/hades/gigahrush2/shots/shot_mag.png")
print("png exists", png.exists(), "size", png.stat().st_size if png.exists() else 0)

# how shotAction is parsed
main = Path(r"C:/hades/gigahrush2/src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
for key in ["shotAction", "--action", "ride", "shotRideDone", "rpgcmbt"]:
    idx = 0
    n = 0
    while n < 8:
        i = main.find(key, idx)
        if i < 0:
            break
        line_start = main.rfind("\n", 0, i) + 1
        line_end = main.find("\n", i)
        # get a few lines of context
        ctx_s = main.rfind("\n", 0, max(0, i - 120)) + 1
        ctx_e = main.find("\n", i + 80)
        print(f"\n-- hit {key} @{i} --")
        print(main[ctx_s:ctx_e])
        idx = i + len(key)
        n += 1

# prior successful shot logs
for f in ["_rpgcmbt_shot_log.txt", "shot_rpgcmbt.jpg"]:
    p = Path(r"C:/hades/gigahrush2/shots") / f
    print("prior", f, p.exists(), p.stat().st_size if p.exists() else 0)
