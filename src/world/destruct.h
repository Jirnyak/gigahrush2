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
// stay standing — their fate belongs to the sandpile rules ([sim/cellular.h]),
// not to a carve.
//
// NO REBAKE HAPPENS HERE. Deliberately. Collision is live (physics reads the
// masks), but every baked overlay goes stale by exactly the cells listed in
// CarveResult::dirtyCells. The CALLER owes, per the existing contracts:
//   * diffusion_mark_cell / cellular_mark_cell per dirty cell (O(1) patches);
//   * cubePass.invalidate() once, if anything was removed;
//   * nothing for nav — flow fields stay stale until the next full bake, the
//     same accepted debt door.cpp already carries ([sim/cellular.h] §"stale").
// And like every grid mutator, DO NOT carve while a nav bake is in flight
// (doors.frozen is the app's existing gate).
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

// Anchor field name for structural stress calculations. Cells marked in this
// field are anchors that hold load and never collapse.
inline constexpr const char* kAnchorFieldName = "anchor";

struct StressParams {
    float carryPerHardness = 1.0f; // how much weight 1 hardness can carry
    float collapseAt = 1.0f;       // threshold for collapse
    int   relaxIters = 4;          // relaxation iterations
};

// Absolute sub-voxel grid: 128 cells x 8 = 1024 per axis, a power of two, so
// toroidal wrap is a mask.


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

// Paint one sub-voxel's material (generator/tool side of layering). Pages the
// cell on first divergence from its CellType; folds back into a plain cell
// type if the write leaves the cell uniform again.
void set_sub_material(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
                      CellType mat);

// Carve a sphere: roll every solid sub-voxel whose centre lies inside, with
// power scaled by quadratic falloff (power * (r^2 - d^2) / r^2), then run the
// detachment sweep around everything removed. Appends into `out` (cleared
// first); returns total sub-voxels removed (destroyed + detached).
// If `sealedMask` is provided, sub-voxels in sealed cells (macro index) are unbreakable.
std::int32_t carve_sphere(World& w, const CarveOp& op, CarveScratch& scratch,
                          CarveResult& out,
                          const std::vector<std::uint64_t>* sealedMask = nullptr);

// Carve a single sub-voxel (the pickaxe primitive): one roll at full power,
// then the same detachment sweep. Returns true if the voxel was removed.
// If `sealedMask` is provided, sub-voxels in sealed cells are unbreakable.
bool carve_at(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
              std::uint16_t power, std::uint32_t seed, CarveScratch& scratch,
              CarveResult& out,
              const std::vector<std::uint64_t>* sealedMask = nullptr);

// Bake stress field (macro cells) based on structural support.
// Anchors hold infinite load. Gravity drives support direction.
void bake_stress(World& world, const StressParams& params, Field<float>& out_stress);

// Find unsupported solid neighbors (stress <= 0) of carved cells to trigger cascading collapse.
// Appends macro cell indices to out_collapses.
void find_structural_collapses(const World& w, const CarveResult& res, std::vector<std::size_t>& out_collapses);

} // namespace giga
