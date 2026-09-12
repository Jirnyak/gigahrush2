# Fields — Runtime typed scalar fields

The design pillar: a field is *just* a 128³ array of some POD type, keyed by
name and **created on demand**. "We wanted temperature, so we made a 128³ field"
is literally the API.

- **Code:** [src/world/field.h](src/world/field.h)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L1

## Model

```cpp
auto& temp = world.fields().get_or_create<float>("temperature", 20.0f);
temp.at(x, y, z) = 21.5f;          // toroidal accessors, mirror the grid
```

- `Field<T>` — dense `kMacroCells` (128³) vector of `T`, with toroidal `at()`
  matching the macro grid so field and cell coordinates always line up.
- `FieldRegistry` — type-erased ownership so fields of different `T` coexist,
  keyed by name. `find<T>` returns `nullptr` if absent **or** if `T` mismatches
  the stored element type — it never reinterprets memory.

## No RTTI

The core is built `-fno-rtti`, so type identity uses `type_tag<T>()` (the
address of a per-type `static` byte) instead of `typeid`. Comparing tags is a
pointer compare and catches wrong-`T` access exactly as `typeid` would. Do not
reintroduce `<typeinfo>`.

## Why this exists

No schema, no codegen, no recompile to add a world quantity. Any system —
fluid, temperature, light, pheromones, pressure, ownership — registers its own
field and gets a flat, cache-friendly 128³ array. Fields are the extensible
data plane over the fixed occupancy grid ([voxels.md](voxels.md)).

## Dense is the point — cost & the sparse temptation

A field is deliberately **dense**: every one of the 2 M cells is stored. The
memory is small and the access pattern is ideal. One `128³` field costs:

| Element `T` | Bytes/cell | Field size |
|-------------|-----------|-----------|
| `uint8_t`   | 1 | **2 MB** |
| `float`     | 4 | **8 MB** |
| `float`×4   | 16 | 32 MB |

With ~8 GB of RAM ([performance.md](performance.md)) you can afford *hundreds* of
dense fields. So resist the web-era instinct to store "only the interesting
cells" in a hash map: a dense field is branch-free, cache-friendly,
parallelizable, and serializes with the world verbatim. Use dense by default;
only sparsify if a specific field genuinely blows the RAM budget.

**Dense at macro res only.** Everything above is the *macro* grid (128³, 2 M
cells). A dense field at *sub-voxel* resolution is a different animal: 128³ × 8³ =
1024³ ≈ 1.07 **billion** cells — ~1 GB per byte-field, hundreds of ms per pass.
That is the real budget wall ([performance.md](performance.md) §The compute
split). Fields live on the macro grid; the 8³ sub-voxel layer stays a *sparse*
occupancy mask, never a second dense simulation field.

**The sanctioned exception: `SubField<T>`** (`world/subfield.h`,
[destruct.md](destruct.md)). When a field genuinely needs the 0.25 m atom —
per-sub-voxel *materials* are the canonical case — it goes through the paged
sparse registry `world.subfields()`, never a hand-rolled dense array. Uniform
cells cost nothing beyond an 8 MB page table; a mixed cell costs one 8³ page;
and the worst case degrades *exactly* to the dense bound above (2 GiB for a
`uint16` field), linearly, with flat-vector storage and two-load reads the
whole way. Dense-at-sub-res stays forbidden; sparse-with-a-dense-ceiling is
the engine's shape for it.

**Blood/urine/stains** are the canonical example. The 2D reference lazily
allocated a 16×16 RGBA buffer per painted cell (sparse — it ran in a browser).
Here the elegant form is a **dense field on the _macro_ grid** (128³): uniform,
O(1) read/write, universal, and it saves with everything else. No allocation, no
presence checks, one code path. **Do not** make it a dense *sub-voxel* field — at
1024³ that is ~1 GB per byte-field and hundreds of ms/pass (the wall above);
under-a-cell stain detail, if ever wanted, is a *sparse* GPU-resident render
layer, not a second dense grid.

## Where fields run — GPU async compute

A field is host-side dense memory, but a *cellular* field's per-step evolution
(diffusion, flow, heat, pressure, light, destruction propagation) is a stencil
over the whole grid, and **belongs** on the GPU as async compute rather than on
the CPU agent tick ([performance.md](performance.md) §The compute split).
**Сверка 2026-08-23: такой пасс ЕСТЬ** — `shaders/gas_sim.comp` +
`src/render/gpu_gas_pass.h` (`record_sim`) и есть field stencil (газ, 4 канала,
изотропный downStep, probe-ридбек); `cloth_sim`/`wire_sim` при этом слиты в
`verlet_sim.comp`. Остальные CPU-солверы (fluid, diffusion) — референсы;
CANON S16 (мир-автомат) забирает газ и жидкость в единый GPU-автомат над
субвокселями, поля становятся агрегатами-потребителями. The CPU uploads
only the cells it dirtied and reads back the sparse subset the agents must sense.
Static overlays the CPU merely reads (e.g. a baked light map) need no such pass.

## Connections

[fluid.md](fluid.md) stores liquid as a `float` field named `"fluid"`. The cube
pass reads that field to tint cells ([render.md](render.md)). A game adds
whatever fields its [monsters.md](monsters.md) / [macrosim.md](macrosim.md)
systems need.
