from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

main = Path(r"C:/hades/gigahrush2/src/app/main.cpp").read_text(encoding="utf-8", errors="replace")

# find argv parsing
for needle in ['"--shot"', '"--action"', '"--ride"', '"--frames"', "shotAction", "argv[i]"]:
    starts = []
    idx = 0
    while len(starts) < 15:
        i = main.find(needle, idx)
        if i < 0:
            break
        starts.append(i)
        idx = i + 1
    print(f"\n==== {needle} count={len(starts)} first={starts[:5]}")
    for i in starts[:5]:
        print(main[max(0,i-100):i+200])
        print("---")

# also look at how rpgcmbt was run
for f in Path(r"C:/hades/gigahrush2/shots").glob("*rpgcmbt*"):
    if f.suffix in (".py", ".txt", ".md"):
        t = f.read_text(encoding="utf-8", errors="replace")
        if "gigahrush2" in t or "--action" in t or "shot" in t.lower():
            print(f"\nFILE {f.name}")
            for L in t.splitlines():
                if "gigahrush" in L.lower() or "--action" in L or "--shot" in L or "ride" in L:
                    print(" ", L[:200])
