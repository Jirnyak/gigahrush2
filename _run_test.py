import os, subprocess, sys, time
root = r"C:\hades\gigahrush2"
exe = os.path.join(root, "build-win", "Release", "game_test.exe")
outp = os.path.join(root, "_test_out.txt")

# Kill leftovers
subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)

# Discover CLI help quickly
help_out = os.path.join(root, "_test_help.txt")
# Try --help with short timeout
for args in [["--help"], ["-h"], ["help"], []]:
    try:
        r = subprocess.run([exe] + args, capture_output=True, text=True, timeout=3, cwd=root)
        open(help_out, "w", encoding="utf-8", errors="replace").write(
            f"args={args}\nrc={r.returncode}\nSTDOUT:\n{r.stdout[:4000]}\nSTDERR:\n{r.stderr[:2000]}\n"
        )
        if r.stdout or r.stderr:
            break
    except subprocess.TimeoutExpired as e:
        open(help_out, "w", encoding="utf-8", errors="replace").write(
            f"args={args} TIMEOUT\nout={(e.stdout or b'')[:2000]!r}\n"
        )
        # kill
        subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)
        break

# Read game_test.cpp for filter keywords
gt = open(os.path.join(root, "tests", "game_test.cpp"), encoding="utf-8", errors="replace").read()
keys = []
for line in gt.splitlines():
    if any(k in line.lower() for k in ("argv", "filter", "argc", "getenv", "suite", "props", "console")):
        keys.append(line)
open(os.path.join(root, "_test_cli.txt"), "w", encoding="utf-8").write("\n".join(keys[:80]))
print("help/cli written")
