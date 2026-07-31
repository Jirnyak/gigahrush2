# Coordination — Zhirnyak / game-agent

**Date:** 2026-07-31 ~16:38 Samara
**HEAD game-agent:** 7462e6e AIMEM GREEN | your padic/render: f7aca13 + merge 75f71c7

Zhirnyak — we do not stop. Parallel domains. Correcting earlier framing + **visual bug package on YOUR padic**.

## Corrections (from your 16:29–16:30)

1. **Padic is not private zone.** Floor module / engine stress sample. Game-agent exercises it hard via `--floor`.
2. **Door seed:** you removed `kDoorSeed` (my old debt). One source = `streamer.floor_seed_of`. I do not reintroduce it.

## Practical split (files, not themes)

| Who | Prefer touch | Prefer avoid while other is hot |
|-----|----------------|----------------------------------|
| **Zhirnyak** | `src/render/**`, padic **gen/mesh** quality, sub-voxel, UV/material, tex path | random drive-by on AI/combat main tick |
| **Game-agent** | `src/app/main.cpp` game systems, `src/game/**`, combat/status/corps/AI, shot harness, **gameplay on padic via `--floor`** | `src/render/**` mesher internals, shaders/** |

## VISUAL BUGS ON PADIC — your lane (show, not thrash)

Shot taken from **repo root cwd** so textures actually load (first bad shot was cwd=hades → 0/6 albedo; ignore that).

### Proof shot
- **PNG:** `shots/shot_padic.png` (2.7 MiB)
- **JPEG for eyes:** `shots/shot_padic.jpg` (137 KB, 1280x720) — **open this**
- Cmd: `gigahrush2.exe --shot shots/shot_padic.png --frames 500 --floor 4` from `C:\hades\gigahrush2`
- stderr: `shots/shot_padic_stderr.txt`
- Result: `shot: saved ... (floor 4, 501 frames)` | instances **897588** | gpu world **~38 ms** | doors built **14742** | floor label **Padic**

### What the screenshot shows (user + game-agent eyes)

1. **Textures all in stripes (полосками)** — right wall + floor: hard yellow/green **diagonal stripe bands**, not continuous metal/paint. Looks like wrong UV scale, triplanar fail, material-id striping, or face-axis UV bug after sub-voxel greedy. Left wall darker but still banded corrugated. **This is the main complaint.**
2. **Ghost / void meshes (меши-призраки)** — thin railing floats in near-black void; large empty dark volume; geometry feels sparse/wrong occlusion vs solid dorm interior expectation.
3. **White dots** — sparse bright specks in dark void (sparkle/noise or 1-px prop/light debris). Harder on this exposure; still present as single-pixel glints.
4. **Perf stress (your listed tail)** — world GPU ~38–40 ms @ 897k instances; door count 14742 on one floor (~5x class problem you already named).

### TEX load from same run (partial — content hole, may worsen PBR look)
```
OK: painted_metal_shutter + normal + roughness
OK: rubber_tiles + normal ; MISSING rubber_tiles_roughness.ktx2
OK: factory_wall + normal + roughness
OK: metal_grate_rusty + normal + roughness
OK: rusty_metal_03 + normal ; MISSING rusty_metal_03_roughness.ktx2
OK: rusty_corrugated_iron + normal ; MISSING rusty_corrugated_iron_roughness.ktx2
```
Missing 3 roughness = BACKLOG TEX1 (game-agent content). **Stripes are worse than missing roughness** — albedo is loading and still stripes → mesher/UV/material assignment more likely than missing file alone.

### Not claiming ownership of fix
I will **not** thrash `src/render/**` / shaders while you are hot on mesher. Filing evidence + paths. If you want a shared API (e.g. debug overlay material id), say so.

## My cycle
1. **AIMEM CLOSED** 7462e6e — AiMemory → ai_step; ai_release leave/unload; PROOF=GREEN
2. This note + padic visual package for you
3. Next non-render: TEX1 roughness files if real sources exist / CNT1 status.csv port / padic **gameplay** stress (step-assist co-own if controller lands)

## Rule
Feature without live gameplay proof = DECLINED. Padic preferred proof floor when geometry stress matters. Both on main. Regular pull-push-commit. No force. Never stage shaders/**.

**Look at `shots/shot_padic.jpg` first.**
