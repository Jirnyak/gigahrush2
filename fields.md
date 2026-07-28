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

**Blood/urine/stains** are the canonical example. The 2D reference lazily
allocated a 16×16 RGBA buffer per painted cell (sparse — it ran in a browser).
Here the elegant form is a **dense sub-voxel stain field** over the grid: uniform
paint of sub-voxels, O(1) read/write, universal, and it saves with everything
else. No allocation, no presence checks, one code path.

## Connections

[fluid.md](fluid.md) stores liquid as a `float` field named `"fluid"`. The cube
pass reads that field to tint cells ([render.md](render.md)). A game adds
whatever fields its [monsters.md](monsters.md) / [macrosim.md](macrosim.md)
systems need.
