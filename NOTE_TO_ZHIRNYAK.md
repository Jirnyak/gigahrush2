# Coordination — Zhirnyak / game-agent

**Date:** 2026-07-31 ~16:31 Samara

Zhirnyak — we do not stop. Parallel domains, no file thrash on `src/render/**` while you own mesher. Correcting my earlier framing:

## Corrections (from your 16:29–16:30)

1. **Padic is not "your private zone".** It is a **floor module** — the reference stress-test for the whole engine. Anyone can / should exercise it hard (gameplay, doors, AI, save, step-assist, shots with `--floor`). Your render/mesher work made that possible; game-agent will **use padic as the sample floor** for proofs, not avoid it.
2. **Door seed:** you **removed** `kDoorSeed` (my old debt). One source = `streamer.floor_seed_of`. I do not reintroduce a global door seed. Credit/fix is yours; I only consume the API.

## Practical split (files, not themes)

| Who | Prefer touch | Prefer avoid while other is hot |
|-----|----------------|----------------------------------|
| **Zhirnyak** | `src/render/**`, padic **gen/mesh** quality, sub-voxel, door_build seed wiring you already fixed | random drive-by on AI/combat main tick without need |
| **Game-agent** | `src/app/main.cpp` game systems, `src/game/ai*`, combat/status/corps, floor leave, shot harness, **gameplay on padic via `--floor`** | `src/render/**` mesher internals, shaders/** |

Themes (doors, padic playfeel, step-assist) are **shared product** — we coordinate on API, not "don't touch padic".

## Your push (f7aca13 + 75f71c7) — accepted
- sub-voxel greedy + dormitory padic — engine stress sample, good
- kDoorSeed dead — correct
- `--floor N` — I use it for padic/gameplay proofs
- tails you listed (RAM sandwich, 0.25 step, door tick load) — still open; step-assist if it lands in controller I can co-own

## My cycle now
1. **AIMEM CLOSED** — AiMemory in main → ai_step; ai_release on leave/unload; PROOF=GREEN pre-merge; rebuild+reproof after your merge
2. Next: pathspec commit/push AIMEM; then non-render P2 (TEX1 / CNT1) **and** live padic gameplay shots (`--floor`) as stress sample
3. Pathspec only; pull --ff-only; no force; never stage shaders/**

## Rule
Feature without live gameplay proof = DECLINED. Padic is the preferred proof floor when geometry stress matters.

Both on main. Both commit/push. Different files when possible; same product.
