# -*- coding: utf-8 -*-
"""Close CARVE in BACKLOG + progress; write diagnostics to stdout."""
from pathlib import Path
import re

root = Path(r"C:\hades\gigahrush2")
bp = root / ".agents" / "worker_game_audit" / "BACKLOG.md"
pp = root / ".agents" / "worker_game_audit" / "progress.md"

t = bp.read_text(encoding="utf-8")
print("BACKLOG len", len(t), "CARVE count", t.count("CARVE"))

# Fix blank line in OPEN table if still present
t = t.replace(
    "| P2 | CNT1 | Content expand status/craft from old giga | data/*.csv + tables | thin: status.csv (~6 rows); port real rows from C:\\hades\\gigahrush |\n\n| P2 | PAR1 |",
    "| P2 | CNT1 | Content expand status/craft from old giga | data/*.csv + tables | thin: status.csv (~6 rows); port real rows from C:\\hades\\gigahrush |\n| P2 | PAR1 |",
)

if "## Gameplay proof (CARVE)" not in t:
    carve_block = """
## Gameplay proof (CARVE) — 2026-07-31 ~16:10
```
runner: python C:\\hades\\gigahrush2\\shots\\_run_carve_proof.py
exe: build-win/Release/gigahrush2.exe --shot shots/shot_carve.png --frames 1200 --ride 0 --action wall
exit=0 elapsed=33.2s png=2.7MiB jpg=111027
stderr: [wall] melee toward solid d=6.32 floor=0 frozen=0 fly=0
        [carve] COMBAT removed=8 power=44 r=0.55 at (88.0,66.0,3.0)
        [wall] melee toward solid d=2.00 ... (closed gap)
        [carve] COMBAT removed=1/3/1 power=44 r=0.55 (follow-up hits)
Wire:
  combat.h: CarveProposal / CarveProposalQueue POD; carve_power_from_dmg
  combat.cpp: Hit.onWall+impactPos; projectile wall enqueue; player_melee wall ray 8-step
  main: combatCarves queue; drain carve_sphere behind !doors.frozen; [carve] COMBAT log
  main: --action wall early face+wishDir AFTER input.apply BEFORE controller_step; ctl->fly=false
  harness: shots/_run_carve_proof.py GREEN iff [carve] COMBAT removed>0 + PNG
Design: combat NEVER mutates grid — only proposes; app owns carve_sphere (same as console)
```

Feature without gameplay = DECLINED. CARVE CLOSED 2026-07-31 ~16:10 — real-game proof GREEN.
"""
    t = t.rstrip() + "\n" + carve_block
    print("appended CARVE proof block")

old_arch = """## Architect answers (STATUS close cycle)
- **Least confident:** SporeHaze gasmask gate uses `gate != 0` not kInvalidItem — OK if ItemId 0 is never a real gate. WEB dual-apply only when body==playerEntity (player hit by web).
- **Biggest missing:** CARVE still console-only; AIMEM floor-leave; TEX1 roughness; CNT1 status.csv thin.
- **Don't realize:** move_e3 stacks multiplicatively (zh 820 × web 540 = 443; with root → 180 path). Slowed CAP and StatusSet mults coexist by design.
- **Implemented-not-integrated:** combat→carve; optional AiMemory floor-leave release; drop_mob_loot debug path.
- **Next execute:** pathspec commit STATUS → pull --rebase → push origin main → CARVE combat path (stay off src/render/** — Zhirnyak submesh)."""

new_arch = """## Architect answers (CARVE close cycle)
- **Least confident:** melee wall ray uses 8 steps along camera_forward within reach; solid contact may miss thin props.
- **Biggest missing:** AIMEM floor-leave release; TEX1 roughness; CNT1 status.csv thin.
- **Don't realize:** aim_player starts fly=true — wall walk proof MUST force ctl->fly=false or gap never closes.
- **Implemented-not-integrated:** optional AiMemory floor-leave release; drop_mob_loot debug path.
- **Next execute:** pathspec commit CARVE → pull --ff-only → push origin main → AIMEM (stay off src/render/** — Zhirnyak)."""

if old_arch in t:
    t = t.replace(old_arch, new_arch)
    print("replaced STATUS architect with CARVE architect")
elif "## Architect answers (CARVE close cycle)" not in t:
    t = t.rstrip() + "\n\n" + new_arch + "\n"
    print("appended CARVE architect")

if "CARVE CLOSED 2026-07-31 ~16:10" not in t:
    t = t.replace(
        "STATUS CLOSED 2026-07-31 ~15:07 — real-game proof GREEN.",
        "STATUS CLOSED 2026-07-31 ~15:07 — real-game proof GREEN.\nCARVE CLOSED 2026-07-31 ~16:10 — real-game proof GREEN.",
    )

bp.write_text(t, encoding="utf-8")
print("BACKLOG written; has proof", "## Gameplay proof (CARVE)" in t)

# --- progress ---
p = pp.read_text(encoding="utf-8")
print("progress len before", len(p))

add_checked = (
    "- [x] CARVE: CarveProposalQueue POD in combat.h; wall/melee/bullet enqueue\n"
    "- [x] CARVE: main drain carve_sphere + [carve] COMBAT stderr\n"
    "- [x] CARVE: --action wall early fly=false + wishDir post-input.apply\n"
    "- [x] CARVE real-game PROOF=GREEN (carve_diag.txt; removed=8 power=44 r=0.55; d=6.32->2.00 fly=0)\n"
)
if "CARVE real-game PROOF=GREEN" not in p:
    # try several anchors (unicode arrow variants)
    anchors = [
        "- [x] STATUS real-game PROOF=GREEN (status_diag.txt; move_e3=180 rooted=1 → 820)\n",
        "- [x] STATUS real-game PROOF=GREEN (status_diag.txt; move_e3=180 rooted=1 -> 820)\n",
    ]
    placed = False
    for a in anchors:
        if a in p:
            p = p.replace(a, a + add_checked)
            placed = True
            print("inserted CARVE checked after STATUS via exact anchor")
            break
    if not placed:
        # fuzzy: find STATUS real-game line
        m = re.search(r"- \[x\] STATUS real-game PROOF=GREEN[^\n]*\n", p)
        if m:
            p = p[: m.end()] + add_checked + p[m.end() :]
            print("inserted CARVE checked via regex")
        else:
            # append under Checked section end before In flight
            m2 = re.search(r"\n## In flight\n", p)
            if m2:
                p = p[: m2.start()] + "\n" + add_checked + p[m2.start() :]
                print("inserted CARVE checked before In flight")
            else:
                print("WARN could not place CARVE checked items")

new_inflight = """## In flight
- [ ] pathspec commit CARVE + docs (main.cpp, combat.h/cpp, shots/_run_carve_proof.py, BACKLOG, progress) — no shaders, no scratch
- [ ] pull --ff-only origin main + push origin main (no force)
- [ ] AIMEM: ai_release on floor leave / memory seam audit
- [ ] TEX1 blocked: 3 missing roughness ktx2 — no sources, do not mock
- [ ] CNT1 content thin (status.csv ~6 rows) — port from old gigahrush
- [ ] optional RPG1 RpgStats across elevator; optional MAGSHOT HUD mag across --ride

"""
p2, n = re.subn(
    r"## In flight\n.*?(?=\n## Do not)",
    new_inflight,
    p,
    count=1,
    flags=re.S,
)
if n:
    p = p2
    print("replaced In flight section")
else:
    print("WARN In flight replace failed")

p = p.replace(
    "**ALLOWED this cycle pathspec:** src/app/main.cpp, src/game/combat.h, src/game/combat.cpp, shots/_run_status_proof.py, .agents/worker_game_audit/BACKLOG.md, .agents/worker_game_audit/progress.md",
    "**ALLOWED this cycle pathspec:** src/app/main.cpp, src/game/combat.h, src/game/combat.cpp, shots/_run_carve_proof.py, .agents/worker_game_audit/BACKLOG.md, .agents/worker_game_audit/progress.md",
)

carve_report = """## Cycle report (2026-07-31 ~16:10) — CARVE CLOSED
→ CARVE | closed: combat proposals → carve_sphere; --action wall PROOF=GREEN;
[carve] COMBAT removed=8 power=44 r=0.55; fly=0 d=6.32→2.00; shot_carve.png |
runner shots/_run_carve_proof.py 1200f ride0 | residual OPEN: AIMEM P1, TEX1, CNT1 |
blockers: shaders/** dirty foreign — never stage; stay off src/render/** (Zhirnyak)

"""
if "CARVE CLOSED" not in p:
    if "## Cycle report (2026-07-31 ~15:07) — STATUS CLOSED" in p:
        p = p.replace(
            "## Cycle report (2026-07-31 ~15:07) — STATUS CLOSED",
            carve_report + "## Cycle report (2026-07-31 ~15:07) — STATUS CLOSED",
        )
        print("inserted CARVE cycle report")
    else:
        # insert before first Cycle report
        m = re.search(r"\n## Cycle report", p)
        if m:
            p = p[: m.start()] + "\n" + carve_report + p[m.start() + 1 :]
            print("inserted CARVE cycle report before first cycle")
        else:
            p = p.rstrip() + "\n\n" + carve_report
            print("appended CARVE cycle report")

p = p.replace(
    "- **Biggest missing:** CARVE combat path; AIMEM floor-leave; TEX1; CNT1.",
    "- **Biggest missing:** AIMEM floor-leave; TEX1; CNT1. (CARVE CLOSED)",
)

pp.write_text(p, encoding="utf-8")
print("progress written len", len(p))
print("CARVE real-game", "CARVE real-game PROOF=GREEN" in p)
print("CARVE CLOSED in progress", "CARVE CLOSED" in p)
print("DONE")
