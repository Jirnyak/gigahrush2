from pathlib import Path
import os

root = Path(r"C:\hades\gigahrush2")
# find game_test.exe and CMakeCache
for p in root.rglob("game_test.exe"):
    print("EXE", p)
for p in root.rglob("CMakeCache.txt"):
    print("CACHE", p)
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
        for line in t.splitlines():
            if any(k in line for k in (
                "CMAKE_GENERATOR:", "CMAKE_BUILD_TYPE:",
                "CMAKE_CXX_COMPILER:", "CMAKE_C_COMPILER:",
                "CMAKE_PROJECT_NAME:",
            )):
                print(" ", line)
    except Exception as e:
        print("  err", e)

# prior run scripts
for name in ("_finish_posrpg.py", "_run_game_test_savrpg.py", "_await_game_test.py",
             "_finish_savmag.py", "_run_rpgcmbt_test.py"):
    p = root / "shots" / name
    if p.exists():
        print("===", name, "===")
        print(p.read_text(encoding="utf-8", errors="replace")[:2500])
