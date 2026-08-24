// Universal destruction — the ONE way world geometry loses sub-voxels.
//
// Every consumer — pickaxe, bullet, explosive charge, samosbor, a monster
// chewing a wall — expresses itself as a CARVE: "apply `power` in this shape,
// with this deterministic seed". The carve consults the material of each
// sub-voxel it touches ([material_props.h]) and rolls removal; it never knows
// WHO hit. Context (what shape, what power, what happens to the debris) stays
// with the tool; physics of resistance stays here. That is the whole design.
//
// THE ROLL IS STATELESS AND DETERMINISTIC. Removal probability is
// power/hardness, decided by an integer hash of (seed, cell, sub-voxel) — no
// RNG stream, no stored HP. The server is the source of truth
// ([netcode-seam]): it picks the seed (e.g. tick ^ actor), carves, and the
// same op with the same seed reproduces bit-identically on any machine — so
// replays and late-joining clients replay carves instead of shipping masks.
// A hit below full hardness may need several swings (each swing = new seed =
// new roll), which reads as "chipping away" without a damage field.
//
// LAYERED MATERIALS. A cell is uniform (its CellType) until something paints
// or reveals layers; then the "sub_material" SubField ([subfield.h]) carries a
// per-sub-voxel id. Paint over concrete over iron is three hardness rows: a
// blast strips the paint everywhere (hardness 32 vs 256), pockmarks the
// concrete, and exposes what it cannot break.
//
// DETACHMENT. After removal, any 6-connected component of ≤ op.detachLimit
// solid sub-voxels left with no connection to a larger structure is deleted
// from the grid and returned in CarveResult::detached. That list is the
// HANDOFF SEAM to the render layer: simulation's contract ends at "these
// voxels, these materials, are no longer world" — the renderer fakes their
// fall/shatter however it likes ([render.md] one-way flow; it gets data, it
// owes nothing back). The bound matters on a torus: there is no "ground"
// component to anchor to, so "attached" is defined operationally as "the
// bounded flood-fill overflows the limit". Large undermined slabs therefore
// stay standing — their fate would belong to structural-collapse rules if the
// engine grows any (the sandpile module once named here was deleted 2026-08-10
// as dead code), not to a carve.
//
// NO REBAKE HAPPENS HERE. Deliberately. Collision is live (physics reads the
// masks), but every baked overlay goes stale by exactly the cells listed in
// CarveResult::dirtyCells. The CALLER owes, per the existing contracts:
//   * diffusion_mark_cell per dirty cell (O(1) patches);
//   * cubePass.invalidate() once, if anything was removed;
//   * RebakeScheduler::patch_carved_cells — the O(1) walk-bit patches that
//     keep the next background snapshot honest ([game/rebake.h]); the flow
//     fields themselves stay stale only until that scheduler's next
//     rebake-and-swap.
// Carving WHILE a bake is in flight is LEGAL: the worker reads a 256 KiB
// bitset snapshot, never these masks — doors.frozen and its gates are dead
// ([game/rebake.h]).
#pragma once
#include <cstdint>
#include <vector>

#include "world/material_props.h"
#include "world/subfield.h"
#include "world/world.h"

namespace giga {

// The sub-voxel material field's registry name. Resolve once per op/build, not
// per voxel ([jirnyak.md] §7 — no string lookups in hot paths).
inline constexpr const char* kSubMaterialName = "sub_material";

// Absolute sub-voxel grid: 128 cells x 8 = 1024 per axis, a power of two, so
// toroidal wrap is a mask.
inline constexpr int kSubGridDim = kMacroDim * kSubDim;
inline constexpr int kSubGridMask = kSubGridDim - 1;

// One removed sub-voxel: packed cell index + sub bit, and the material it was.
// 8 bytes; `cell` is the flat macro_index, `bit` the sub_bit.
struct CarvedVoxel {
    std::uint32_t cell;
    std::uint16_t bit;
    CellType mat;
};

struct CarveOp {
    float x = 0, y = 0, z = 0; // centre, world metres (toroidal)
    float radius = 0;          // metres; power falls off quadratically to 0 here
    std::uint16_t power = 0;   // applied power at the centre (hardness scale)
    std::uint32_t seed = 0;    // deterministic stream id — server's choice
    std::int32_t detachLimit = kSubVoxels; // max component handed to render
};

struct CarveResult {
    std::vector<CarvedVoxel> destroyed;    // removed by the hit itself
    std::vector<CarvedVoxel> detached;     // removed as disconnected debris
    std::vector<std::uint32_t> dirtyCells; // unique macro cells whose mask changed
    void clear() {
        destroyed.clear();
        detached.clear();
        dirtyCells.clear();
    }
};

// Reusable flood-fill scratch so repeated carves allocate nothing after warmup
// (flat open-addressing table + queue; no unordered_map). `runs` parallels
// `slots`: which BFS run first visited a key, so a later run touching it knows
// it hit an already-judged (supported) region rather than its own frontier.
struct CarveScratch {
    std::vector<std::uint32_t> slots; // open addressing, stores key+1, 0=empty
    std::vector<std::uint32_t> runs;  // run id per slot (valid where slots!=0)
    std::vector<std::uint32_t> used;  // occupied slot indices, for cheap wipe
    std::vector<std::uint32_t> queue; // BFS worklist of packed keys
    std::vector<std::uint32_t> comp;  // current component's packed keys
};

// The deterministic per-sub-voxel roll hash. Public so tests and future
// consumers (e.g. a client-side predictor) can reproduce the server's rolls.
std::uint32_t carve_hash(std::uint32_t seed, std::uint32_t cell,
                         std::uint32_t bit);

// Does a hit at `power` remove a sub-voxel of `hardness`, given roll hash `h`?
// Pure integer math: removes iff (h & 0xFFFF) * hardness < power << 16, i.e.
// probability min(1, power/hardness). kHardnessUnbreakable never removes.
bool carve_roll(std::uint32_t h, std::uint16_t power, std::uint16_t hardness);

// Material of one sub-voxel: the sub_material page if the cell is mixed, else
// the cell's uniform CellType.
CellType sub_material_at(const World& w, int cx, int cy, int cz, int sx,
                         int sy, int sz);

// Раскрыть страницу материалов клетки ЧЕСТНО по S16.1 (материал — истина):
// под битом маски — CellType клетки, без бита — ВОЗДУХ (у однородной клетки
// материи сред — её материал: вода остаётся водой). Старый ensure_page(base)
// заливал базой и дыры: воздух у стен читался «бетоном» — вода не могла
// втечь в клетку со стеной (пустые швы, фидбек владельца 2026-08-24), а
// карв-дыры несли фантомную материю. Возвращает страницу (уже раскрытая
// клетка не трогается).
CellType* materialize_sub_page(World& w, std::size_t ci);

// Paint one sub-voxel's material (generator/tool side of layering). Pages the
// cell on first divergence from its CellType; folds back into a plain cell
// type if the write leaves the cell uniform again.
void set_sub_material(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
                      CellType mat);

// Carve a sphere: roll every solid sub-voxel whose centre lies inside, with
// power scaled by quadratic falloff (power * (r^2 - d^2) / r^2), then run the
// detachment sweep around everything removed. Appends into `out` (cleared
// first); returns total sub-voxels removed (destroyed + detached).
std::int32_t carve_sphere(World& w, const CarveOp& op, CarveScratch& scratch,
                          CarveResult& out);

// Carve a single sub-voxel (the pickaxe primitive): one roll at full power,
// then the same detachment sweep. Returns true if the voxel was removed.
bool carve_at(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
              std::uint16_t power, std::uint32_t seed, CarveScratch& scratch,
              CarveResult& out);

// ОДИН ЗАКОН СВЯЗНОСТИ НА ВСЕХ ПИСАТЕЛЕЙ (решение владельца 2026-08-24):
// проверка от ЗАПИСИ, не от разрушения — нарисованная в воздухе сфера
// бетона обязана осесть. seed — любой атом свежей записи; если его
// компонент связности не больше limit и не дотягивается до опоры, ВЕСЬ
// компонент конвертируется в рыхлого двойника (kMatRubbleOf) на месте —
// дальше его роняет автомат, как при детаче карва. Возвращает число
// конвертированных атомов; dirtyCells — задетые клетки (маски не меняются).
std::int32_t detach_scan(World& w, int cx, int cy, int cz, int sx, int sy,
                         int sz, std::int32_t limit, CarveScratch& scratch,
                         CarveResult& out);

} // namespace giga
