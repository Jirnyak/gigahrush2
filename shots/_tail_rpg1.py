from pathlib import Path
p = Path(r"C:\hades\gigahrush2\shots\_rpg1_test_out.txt")
t = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
print("size", len(t))
print(t[-3000:])
for line in t.splitlines():
    if "game_test:" in line or line.startswith("EXIT=") or line.startswith("FAIL"):
        print("HIT:", line)
