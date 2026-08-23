# Worldgen — DELETED (2026-08-02)

> **Сверка 2026-08-23:** геометрических модулей теперь ДВА — padic и blame
> (`floors/blame/blame_module.cpp:13`, этаж 5); «no module seeds standing
> water» устарело — `padic_gen` сеет `kFluidField`. Флаг `--no-crt` добавился
> (`main.cpp:1806`). Как надгробие старого worldgen — док годен.

**This system no longer exists.** `src/app/worldgen.{cpp,h}` were removed with the
legacy meshers, and the two launch modes this file used to document —
`gigahrush2 maze` and `gigahrush2 floors` — are gone with them:
[src/app/main.cpp](src/app/main.cpp) parses only flags (`--shot`, `--frames`,
`--ride`, `--floor`, `--pos`, `--yaw`, `--pitch`, `--orbit`, `--action`,
`--no-hud`, `--mirror-verify`) and has no positional world-mode argument at all.

The document is kept as a tombstone rather than deleted because
[ARCHITECTURE.md](ARCHITECTURE.md) and older commit messages link to it, and a
dangling link reads as "the doc was lost" rather than "the system was cut".

## What replaced it

Geometry is a **floor module**: a folder under `src/game/floors/<name>/` claimed
by the floor catalog. See [floors.md](floors.md) for the module contract and
[src/game/floor_gen.h](src/game/floor_gen.h) for the dispatch seam. The only
registered geometric module today is **padic**
([src/game/floors/padic](src/game/floors/padic)) — a dormitory tower of 3-cell
storeys on a two-slab sandwich, with BSP apartments and real stair shafts.

## What survived the deletion, and where it lives now

- **Cell scale** — one macro cell is ~2 m (`kCellSize = 2.0`,
  [src/world/types.h](src/world/types.h)), so a sub-voxel is 0.25 m and the
  128-cell torus is **256 m** across (`kWorldExtent`). Unchanged.
- **Determinism** — the ONE-FLOOR-ONE-SEED law. A floor's geometry is a pure
  function of `(seed, floor number, FloorSpec)`, which is what lets a
  streamed-out floor be regenerated bit-for-bit on return instead of persisted.
  See [floors.md](floors.md).
- **The maze's purpose** — proving isotropy and the torus visually — is now
  served by the isotropy tests (`test_antourage_isotropy`, `test_gravity_frames`)
  rather than by a launchable world.

## What did NOT survive, and is a real gap

The old FloorStack mode seeded a little `fluid` field near spawn so the fluid
sim had something to move. **No floor module seeds standing water today**, which
is why `fluid_step` is not called from the frame loop at all
([src/app/main.cpp](src/app/main.cpp) says so at the call site). See
[problems.md](problems.md) §13.
