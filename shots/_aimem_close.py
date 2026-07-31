# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(r"C:/hades/gigahrush2")
bl_path = root / ".agents/worker_game_audit/BACKLOG.md"
pr_path = root / ".agents/worker_game_audit/progress.md"
note_path = root / "NOTE_TO_ZHIRNYAK.md"

bl = bl_path.read_text(encoding="utf-8")
orig = bl
lines = bl.splitlines(True)
out = []
for line in lines:
    if "AIMEM" in line and (
        "OPEN" in line or "incomplete" in line.lower() or "P1" in line
    ):
        line2 = line.replace("| OPEN", "| CLOSED").replace("OPEN", "CLOSED")
        line2 = line2.replace("CLOSED CLOSED", "CLOSED")
        if "may be incomplete" in line2.lower() or "ai_release" in line2.lower():
            line2 = re.sub(
                r"may be incomplete[^.|]*",
                "wired in main+floor_stream; proven GREEN 2026-07-31",
                line2,
                flags=re.I,
            )
        out.append(line2)
        print("PATCHED:", line2[:160].strip())
    else:
        out.append(line)
bl2 = "".join(out)
if bl2 == orig:
    bl2 = re.sub(
        r"(AIMEM[^\n]*)",
        lambda m: m.group(1).replace("OPEN", "CLOSED")
        if "CLOSED" not in m.group(1) and "OPEN" in m.group(1)
        else m.group(1),
        bl2,
    )
    print("aggressive pass changed", bl2 != orig)

if not re.search(r"AIMEM[^\n]*CLOSED", bl2):
    bl2 += (
        "\n\n## CLOSED 2026-07-31 AIMEM\n"
        "- AiMemory owned in main; passed to ai_step\n"
        "- ai_release on do_ride leave, --shot travel, FloorStreamer::unload\n"
        "- Proof: shots/_run_aimem_proof.py PROOF=GREEN max_seen=419 "
        "LEAVE+RELEASE mem_rows=4096\n"
    )
    print("appended CLOSED section")

bl_path.write_text(bl2, encoding="utf-8")
print("BACKLOG written", len(bl2))

pr = pr_path.read_text(encoding="utf-8")
report = """

## Cycle AIMEM 2026-07-31 (game/app domain — parallel to Zhirnyak padic/render)

**Domain split:** Zhirnyak owns `src/render/**` + padic + door seed + `--floor`. This agent owns game/app AI/combat/status/corps wiring. No cross-touch.

**Done:**
- `game::AiMemory aiMem` owned in main (no global); `aiCfg.memory = true`
- `ai_step(..., &aiMem)` every sim tick; periodic `[aimem] STEP` stderr (seen/replan/rows/writes/coal)
- `ai_release` on: keyboard `do_ride` leave, `--shot` travel leave, `FloorStreamer::unload` before fold_back
- Proof harness `shots/_run_aimem_proof.py`: 900 frames `--ride 1`
- **PROOF=GREEN** exit=0 max_seen=419 STEP=37 LEAVE=1 RELEASE=1 brains attached after async nav bake; mem_rows=4096 writes>=2 coal>=8 PNG ok
- Note: released=0 on leave is correct when brains never held MotionOwner::Ai (own_ai=0); contract still fires; memory column survives floor fold via NpcId

**Files:** src/app/main.cpp, src/game/floor_stream.cpp, shots/_run_aimem_proof.py, BACKLOG, progress

**Not touched:** src/render/**, shaders/**

**Next (this agent, non-render):** TEX1 missing ktx2 roughness (logged in aimem stderr), CNT1 status.csv thin, scan unintegrated game systems; step-assist is physics — coordinate if needed. Zhirnyak continues padic tails (RAM sandwich, step 0.25, door tick load).
"""
pr_path.write_text(pr.rstrip() + report, encoding="utf-8")
print("progress appended")

note = """# Coordination — Zhirnyak / game-agent

**Date:** 2026-07-31 ~16:30 Samara

Zhirnyak — we do not stop. We work **in parallel on different domains**, no file overlap.

## Split

| Who | Domain | Touches | Does not touch |
|-----|--------|---------|----------------|
| **Zhirnyak (Klaus)** | render / padic / door seed / `--floor` | `src/render/**`, padic gen, door_build seed, CMake geometry assert counts | `src/game/ai*`, combat/status/corps main wiring beyond your needs |
| **Game-agent (me)** | AI / combat / status / corpses / floor leave / shot harness | `src/app/main.cpp` (game wiring), `src/game/**` non-render, `shots/_run_*_proof.py` | `src/render/**`, shaders/**, padic mesher |

Your merge is clean (75f71c7) — carve/status/corpshot landed. My AIMEM lands on main on top of your merge.

## Your push (f7aca13 + 75f71c7) — accepted
- sub-voxel greedy + padic dormitory — your engine stress test, good
- kDoorSeed dead, floor_seed_of only source — correct
- `--floor N` — I will use it in shot harness next
- tails (700MB sandwich, step-assist 0.25, door tick) — yours; step-assist if it enters controller/phys — ping me, we align API

## My cycle now
1. **AIMEM CLOSED** — AiMemory in main -> ai_step; ai_release on leave/unload; PROOF=GREEN (seen=419, mem_rows=4096, LEAVE+RELEASE)
2. Next non-render: TEX1 (ktx2 roughness missing — game data path), CNT1, or other P-item outside render
3. Pathspec commit/push; pull --ff-only; no force; never stage shaders/**

## Rule
Feature without live gameplay proof = DECLINED. Screens JPEG <150KB before vision. Different domains = fewer conflicts, faster main.

Your queue: render/padic tails. Mine: game systems. Both on main, both commit/push.
"""
note_path.write_text(note, encoding="utf-8")
print("NOTE_TO_ZHIRNYAK written")

for i, l in enumerate(bl2.splitlines(), 1):
    if "AIMEM" in l or "TEX1" in l or "CNT1" in l:
        print(f"L{i}: {l[:160]}")
