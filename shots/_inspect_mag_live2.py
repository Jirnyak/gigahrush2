from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

out_lines = []
def p(*a):
    s = " ".join(str(x) for x in a)
    out_lines.append(s)
    print(s)

for name in ["_mag_live_err.txt", "_mag_live_out.txt", "_mag_live_rc.txt"]:
    path = Path(r"C:/hades/gigahrush2/shots") / name
    p("===", name, "size", path.stat().st_size if path.exists() else "MISSING", "===")
    if path.exists():
        raw = path.read_bytes()
        p("raw_hex", raw[:200].hex())
        t = raw.decode("utf-8", errors="replace")
        p("text:")
        p(t)

png = Path(r"C:/hades/gigahrush2/shots/shot_mag.png")
p("png", png.exists(), png.stat().st_size if png.exists() else 0)

# How prior rpgcmbt was invoked
log = Path(r"C:/hades/gigahrush2/shots/_rpgcmbt_shot_log.txt")
if log.exists():
    t = log.read_text(encoding="utf-8", errors="replace")
    p("rpgcmbt log size", len(t))
    for L in t.splitlines()[:40]:
        p("R:", L)

# Parse argv handling around --action / --shot
main = Path(r"C:/hades/gigahrush2/src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
# find main argv loop
for needle in ['strcmp(argv[i], "--action")', 'strcmp(argv[i], "--shot")', 'strcmp(argv[i], "--ride")', 'shotPath', 'shotFrames', 'shotRide']:
    i = main.find(needle)
    p(f"\nneedle {needle!r} at {i}")
    if i >= 0:
        p(main[i-200:i+400])

# Check if exe exists and run from correct cwd - maybe needs assets
exe = Path(r"C:/hades/gigahrush2/build-win/Release/gigahrush2.exe")
p("exe", exe.exists(), exe.stat().st_size if exe.exists() else 0)
# list nearby
rel = Path(r"C:/hades/gigahrush2/build-win/Release")
for f in sorted(rel.iterdir())[:30]:
    p("rel", f.name, f.stat().st_size)

Path(r"C:/hades/gigahrush2/shots/_inspect_mag_live2_out.txt").write_text("\n".join(out_lines), encoding="utf-8")
