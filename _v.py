import os, re
p = r"C:\hades\gigahrush2"
log = open(os.path.join(p, "_vlog.txt"), "w", encoding="utf-8")

def pr(*a):
    s = " ".join(str(x) for x in a)
    log.write(s + "\n")
    log.flush()
    print(s)

files = [
    "src/game/console.cpp",
    "src/game/prop_system.cpp",
    "src/game/floors/padic/padic_module.cpp",
    "tests/suite_console.inl",
    "tests/suite_props_game.inl",
    "CMakeLists.txt",
]
for f in files:
    fp = os.path.join(p, f)
    t = open(fp, encoding="utf-8", errors="replace").read()
    pr("===", f, "len", len(t))
    if "console.cpp" in f:
        pr(" DynamicBodyTag", "DynamicBodyTag" in t)
    if "prop_system" in f:
        pr(" z-1", "z - 1" in t)
        pr(" z+1", "z + 1" in t)
        pr(" GpuHandoff", "GpuHandoff" in t)
    if "padic_module" in f:
        pr(" sy by+1", "by + 1" in t)
        pr(" honest", "no honest solid" in t)
    if "suite_console" in f:
        pr(" DynamicBodyTag", "DynamicBodyTag" in t)
    if "suite_props" in f:
        pr(" zFloor", "zFloor" in t)
        pr(" p.z", "p.z >" in t)
        pr(" padic_gen", "generate_padic_floor" in t)
    if "CMake" in f:
        m = re.search(r"game_test: (\d+) checks", t)
        pr(" pin", m.group(0) if m else "NONE")

for b in ["build", "build-win"]:
    bp = os.path.join(p, b)
    if not os.path.isdir(bp):
        continue
    pr("DIR", b)
    for root, dirs, files in os.walk(bp):
        for fn in files:
            if fn.lower() in ("game_test.exe", "game_test"):
                pr(" FOUND", os.path.join(root, fn))

for t in ["_p.py", "_patch_log.txt", "_fail.txt", "_probe.txt", "_console_snip.txt"]:
    pr("temp", t, os.path.isfile(os.path.join(p, t)))

log.close()
pr("DONE")
