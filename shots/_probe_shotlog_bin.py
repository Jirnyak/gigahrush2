#!/usr/bin/env python3
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
for name in ("build-win/Release/giga_game.lib", "build-win/Release/gigahrush2.exe"):
    p = ROOT / name
    b = p.read_bytes()
    print(name, "size", len(b))
    for s in (b"[place] MOVE", b"[place] REFUSE", b"no standable cell", b"place_body"):
        print(" ", s.decode(), "->", b.find(s))
