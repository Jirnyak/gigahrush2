# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"C:\hades\gigahrush2\.agents\worker_game_audit\BACKLOG.md")
t = p.read_text(encoding="utf-8")
add = """
## NOTE 2026-07-31 ~16:38 padic visual package for Zhirnyak
- NOTE_TO_ZHIRNYAK.md updated with stripes/ghost/white-dots + shot paths
- shots/shot_padic.jpg 137KB floor 4 (cwd=repo root; textures load; 3 roughness missing TEX1)
- stripes with albedo loaded => UV/mesher more likely than missing ktx2 alone
- game-agent does NOT thrash src/render/**; evidence only
"""
marker = "## CLOSED 2026-07-31 AIMEM"
if "padic visual package for Zhirnyak" not in t:
    if marker in t:
        # append after AIMEM block end
        idx = t.find(marker)
        # find end of that short block (next blank line after mem_rows or EOF)
        rest = t[idx:]
        # insert after the closed aimem section
        end = t.find("\n\n", idx)
        if end < 0:
            t = t.rstrip() + "\n" + add
        else:
            # find last line of aimem closed block
            lines = t.splitlines(keepends=True)
            out = []
            inserted = False
            in_aimem = False
            for i, line in enumerate(lines):
                out.append(line)
                if line.startswith("## CLOSED 2026-07-31 AIMEM"):
                    in_aimem = True
                elif in_aimem and line.startswith("## "):
                    out.insert(-1, add if not add.endswith("\n") else add)
                    inserted = True
                    in_aimem = False
                elif in_aimem and line.strip() == "" and i + 1 < len(lines) and not lines[i + 1].startswith("-"):
                    out.append(add)
                    inserted = True
                    in_aimem = False
            if in_aimem and not inserted:
                out.append(add)
                inserted = True
            if not inserted:
                out.append(add)
            t = "".join(out)
    else:
        t = t.rstrip() + "\n" + add
    p.write_text(t, encoding="utf-8", newline="\n")
    print("backlog updated", len(t))
else:
    print("backlog already has note")
