#include "world/destruct.h"
#include "world/gravity.h"
#include "world/material_props.h"
#include "world/subfield.h"
#include "world/world.h"

#include <algorithm>
#include <chrono>
#include <cmath>

namespace giga {

// Key packing now uses dynamic bitshifts derived from kSubDim (types.h).
// kSubDim can be changed (e.g. to 16) without breaking these bitwise operations,
// provided kSubDim is a power of 2.
static_assert(std::has_single_bit(static_cast<unsigned>(kSubDim)),
              "kSubDim must be a power of 2 for bitwise math in destruct.cpp");

namespace {

// --- packed sub-voxel keys ---------------------------------------------------
// key = macro cell index (21 bits) << 9 | sub bit (9 bits). Fits 30 bits.
// The 9/511 packing below (and the >>/& splits in unpack_key/key_at) is written
// for kSubDim == 8 and ONLY 8 — types.h calls flipping kSubDim a one-line
// change, and for the masks it is, but not here. Pinned so a flip is a compile
// error at the guilty file instead of a silently corrupted carve. [voxels.md]
static_assert(kSubDim == 8,
              "pack_key/unpack_key/key_at hardcode the 8^3 sub-voxel packing");
inline std::uint32_t pack_key(std::uint32_t ci, std::uint32_t bit) {
    return (ci << kSubVoxelsShift) | bit;
}

struct SubCoord {
    int cx, cy, cz; // macro cell, canonical range
    int sx, sy, sz; // sub-voxel inside the cell
};

inline SubCoord unpack_key(std::uint32_t key) {
    const std::uint32_t ci = key >> kSubVoxelsShift, bit = key & kSubVoxelsMask;
    SubCoord c;
    c.cx = static_cast<int>(ci & 127u);
    c.cy = static_cast<int>((ci >> 7) & 127u);
    c.cz = static_cast<int>(ci >> 14);
    c.sx = static_cast<int>(bit & kSubDimMask);
    c.sy = static_cast<int>((bit >> kSubDimShift) & 7u);
    c.sz = static_cast<int>(bit >> (kSubDimShift * 2));
    return c;
}

// Key from ABSOLUTE sub-voxel coordinates; wraps on the 1024^3 sub torus with
// a mask (power of two).
inline std::uint32_t key_at(int ax, int ay, int az) {
    ax &= kSubGridMask;
    ay &= kSubGridMask;
    az &= kSubGridMask;
    const std::uint32_t ci = static_cast<std::uint32_t>(
        macro_index(ax >> kSubDimShift, ay >> kSubDimShift, az >> kSubDimShift));
    const std::uint32_t bit =
        static_cast<std::uint32_t>(sub_bit(ax & kSubDimMask, ay & kSubDimMask, az & kSubDimMask));
    return pack_key(ci, bit);
}

inline bool solid_key(const MacroGrid& g, std::uint32_t key) {
    return g.masks()[key >> kSubVoxelsShift].test(static_cast<int>(key & kSubVoxelsMask));
}

inline CellType mat_key(const World& w, const SubField<CellType>* mats,
                        std::uint32_t key) {
    const std::size_t ci = key >> kSubVoxelsShift;
    const CellType base = w.grid().types()[ci];
    return mats ? mats->at(ci, static_cast<int>(key & kSubVoxelsMask), base) : base;
}

// Clear one sub-voxel and keep every invariant: an emptied cell reverts to air
// and sheds its material page; the touched cell is recorded for the caller's
// dirty marks.
inline void remove_key(World& w, SubField<CellType>* mats, std::uint32_t key,
                       std::vector<std::uint32_t>& dirty) {
    const std::uint32_t ci = key >> kSubVoxelsShift;
    const SubCoord c = unpack_key(key);
    SubMask& m = w.grid().mask(c.cx, c.cy, c.cz);
    m.clear(static_cast<int>(key & kSubVoxelsMask));
    dirty.push_back(ci);
    if (m.empty()) {
        w.grid().set_cell(c.cx, c.cy, c.cz, kCellAir);
        if (mats) mats->drop_page(ci);
    }
}

// --- visited set over CarveScratch ------------------------------------------
// Flat open addressing (linear probing) on key+1, with a parallel run id so a
// BFS can tell "my own frontier" from "a region an earlier run already judged
// supported". Grows by doubling; wipes only the slots it used, so reuse across
// carves costs O(previous population), not O(table).
class VisitedSet {
public:
    VisitedSet(CarveScratch& s, std::size_t hint) : s_(s) {
        std::size_t want = 64;
        while (want < hint * 4) want <<= 1;
        if (s_.slots.size() < want) {
            s_.slots.assign(want, 0);
            s_.runs.assign(want, 0);
            s_.used.clear();
        } else {
            for (std::uint32_t i : s_.used) s_.slots[i] = 0;
            s_.used.clear();
        }
        mask_ = static_cast<std::uint32_t>(s_.slots.size() - 1);
    }

    // 1 = newly inserted for `run`; 0 = already present with the SAME run;
    // -1 = present from another run (an already-judged, supported region).
    int probe(std::uint32_t key, std::uint32_t run) {
        if ((s_.used.size() + 1) * 2 > s_.slots.size()) grow();
        const std::uint32_t v = key + 1;
        std::uint32_t i = mix(key) & mask_;
        while (true) {
            const std::uint32_t cur = s_.slots[i];
            if (cur == 0) {
                s_.slots[i] = v;
                s_.runs[i] = run;
                s_.used.push_back(i);
                return 1;
            }
            if (cur == v) return s_.runs[i] == run ? 0 : -1;
            i = (i + 1) & mask_;
        }
    }

private:
    static std::uint32_t mix(std::uint32_t k) {
        k *= 0x9E3779B9u;
        k ^= k >> 16;
        return k;
    }
    void grow() {
        std::vector<std::uint32_t> keys, runs;
        keys.reserve(s_.used.size());
        runs.reserve(s_.used.size());
        for (std::uint32_t i : s_.used) {
            keys.push_back(s_.slots[i] - 1);
            runs.push_back(s_.runs[i]);
        }
        const std::size_t n = s_.slots.size() * 2;
        s_.slots.assign(n, 0);
        s_.runs.assign(n, 0);
        s_.used.clear();
        mask_ = static_cast<std::uint32_t>(n - 1);
        for (std::size_t j = 0; j < keys.size(); ++j) {
            std::uint32_t i = mix(keys[j]) & mask_;
            while (s_.slots[i]) i = (i + 1) & mask_;
            s_.slots[i] = keys[j] + 1;
            s_.runs[i] = runs[j];
            s_.used.push_back(i);
        }
    }

    CarveScratch& s_;
    std::uint32_t mask_ = 0;
};

const int kDir6[6][3] = {{1, 0, 0},  {-1, 0, 0}, {0, 1, 0},
                         {0, -1, 0}, {0, 0, 1},  {0, 0, -1}};

// Enumerate the 6-connected solid component containing `seedKey`, giving up —
// and thereby ruling it SUPPORTED — as soon as it either exceeds `limit` or
// touches a region a previous run already judged. Returns true iff the
// component was fully enumerated (it dead-ended within the limit), i.e. it is
// genuinely detached: nothing else in the world holds it. The component's keys
// are left in scratch.comp.
bool flood_component(const MacroGrid& g, const Field<std::uint8_t>* anchors, VisitedSet& vis, CarveScratch& s,
                     std::uint32_t seedKey, std::uint32_t run,
                     std::int32_t limit) {
    s.comp.clear();
    s.queue.clear();
    if (vis.probe(seedKey, run) != 1) return false;
    s.comp.push_back(seedKey);
    s.queue.push_back(seedKey);
    std::size_t head = 0;
    while (head < s.queue.size()) {
        const SubCoord c = unpack_key(s.queue[head++]);
        const int ax = c.cx * kSubDim + c.sx;
        const int ay = c.cy * kSubDim + c.sy;
        const int az = c.cz * kSubDim + c.sz;
        for (const auto& d : kDir6) {
            const std::uint32_t nk = key_at(ax + d[0], ay + d[1], az + d[2]);
            if (!solid_key(g, nk)) continue;
            const int r = vis.probe(nk, run);
            if (r == 0) continue;       // our own frontier, already queued
            if (r < 0) return false;    // merged into a supported region
            if (anchors && anchors->data()[nk >> kSubVoxelsShift] != 0) return false; // anchored
            s.comp.push_back(nk);
            s.queue.push_back(nk);
            if (static_cast<std::int32_t>(s.comp.size()) > limit)
                return false;           // too big to be loose ([destruct.h])
        }
    }
    return true;
}

// The detachment sweep: seed a bounded flood-fill from every solid neighbour
// of every sub-voxel the carve removed; delete each fully-enumerated (loose)
// component into out.detached. Runs AFTER all direct removals so a component
// severed by the joint effect of many removed voxels is judged once, against
// the final geometry.
void detach_sweep(World& w, SubField<CellType>* mats, std::int32_t limit,
                  CarveScratch& s, CarveResult& out) {
    const Field<std::uint8_t>* anchors = w.fields().find<std::uint8_t>(kAnchorFieldName);
    if (out.destroyed.empty() || limit <= 0) return;
    VisitedSet vis(s, static_cast<std::size_t>(limit) * 2 +
                          out.destroyed.size());
    std::uint32_t run = 0;
    const std::size_t nSeeds = out.destroyed.size();
    for (std::size_t i = 0; i < nSeeds; ++i) {
        const SubCoord c = unpack_key(
            pack_key(out.destroyed[i].cell, out.destroyed[i].bit));
        const int ax = c.cx * kSubDim + c.sx;
        const int ay = c.cy * kSubDim + c.sy;
        const int az = c.cz * kSubDim + c.sz;
        for (const auto& d : kDir6) {
            const std::uint32_t nk = key_at(ax + d[0], ay + d[1], az + d[2]);
            // May have gone air already — as part of the carve or of an
            // earlier detached component.
            if (!solid_key(w.grid(), nk)) continue;
            ++run;
            if (!flood_component(w.grid(), anchors, vis, s, nk, run, limit)) continue;
            for (std::uint32_t k : s.comp) {
                out.detached.push_back(CarvedVoxel{
                    k >> kSubVoxelsShift, static_cast<std::uint16_t>(k & kSubVoxelsMask),
                    mat_key(w, mats, k)});
                remove_key(w, mats, k, out.dirtyCells);
            }
        }
    }
}

void finalize_dirty(CarveResult& out) {
    std::sort(out.dirtyCells.begin(), out.dirtyCells.end());
    out.dirtyCells.erase(
        std::unique(out.dirtyCells.begin(), out.dirtyCells.end()),
        out.dirtyCells.end());
}

} // namespace

std::uint32_t carve_hash(std::uint32_t seed, std::uint32_t cell,
                         std::uint32_t bit) {
    std::uint32_t h = seed * 0x9E3779B9u;
    h ^= cell + 0x7F4A7C15u + (h << 6) + (h >> 2);
    h *= 0x85EBCA6Bu;
    h ^= bit + (h << 6) + (h >> 2);
    h *= 0xC2B2AE35u;
    h ^= h >> 16;
    return h;
}

bool carve_roll(std::uint32_t h, std::uint16_t power, std::uint16_t hardness) {
    if (hardness == kHardnessUnbreakable) return false;
    if (hardness == 0) return true;
    // P(remove) = min(1, power / hardness), decided against a 16-bit slice of
    // the hash. power == hardness makes the inequality unconditionally true.
    return static_cast<std::uint64_t>(h & 0xFFFFu) * hardness <
           (static_cast<std::uint64_t>(power) << 16);
}

CellType sub_material_at(const World& w, int cx, int cy, int cz, int sx,
                         int sy, int sz) {
    const std::size_t ci =
        macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
    const CellType base = w.grid().types()[ci];
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    return f ? f->at(ci, sub_bit(sx, sy, sz), base) : base;
}

void set_sub_material(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
                      CellType mat) {
    cx = wrap_macro(cx);
    cy = wrap_macro(cy);
    cz = wrap_macro(cz);
    const std::size_t ci = macro_index(cx, cy, cz);
    const CellType base = w.grid().types()[ci];
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    if (!f.paged(ci) && mat == base) return; // still uniform, nothing to page
    CellType* pg = f.ensure_page(ci, base);
    pg[sub_bit(sx, sy, sz)] = mat;
    CellType uniform;
    // If the write left the whole cell one material again, fold it back into
    // the plain per-cell type and shed the page.
    if (f.collapse_if_uniform(ci, &uniform))
        w.grid().set_cell(cx, cy, cz, uniform);
}

std::int32_t carve_sphere(World& w, const CarveOp& op, CarveScratch& scratch,
                          CarveResult& out,
                          const std::vector<std::uint64_t>* sealedMask) {
    out.clear();
    if (op.radius <= 0.0f || op.power == 0) return 0;
    SubField<CellType>* mats = w.subfields().find<CellType>(kSubMaterialName);

    // Work in sub-voxel units. The unwrapped distance inside the iteration box
    // is exact as long as the sphere fits inside a half-torus; clamp far below
    // that (a quarter world = 64 m radius) so the box never self-overlaps.
    const float inv = 1.0f / kVoxelSize;
    const float cx = op.x * inv, cy = op.y * inv, cz = op.z * inv;
    const float r =
        std::min(op.radius * inv, static_cast<float>(kSubGridDim) * 0.25f);
    const float r2 = r * r;
    const int lo[3] = {static_cast<int>(std::floor(cx - r)),
                       static_cast<int>(std::floor(cy - r)),
                       static_cast<int>(std::floor(cz - r))};
    const int hi[3] = {static_cast<int>(std::ceil(cx + r)),
                       static_cast<int>(std::ceil(cy + r)),
                       static_cast<int>(std::ceil(cz + r))};

    for (int az = lo[2]; az <= hi[2]; ++az) {
        const float dz = (static_cast<float>(az) + 0.5f) - cz;
        for (int ay = lo[1]; ay <= hi[1]; ++ay) {
            const float dy = (static_cast<float>(ay) + 0.5f) - cy;
            for (int ax = lo[0]; ax <= hi[0]; ++ax) {
                const float dx = (static_cast<float>(ax) + 0.5f) - cx;
                const float d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= r2) continue;
                const std::uint32_t key = key_at(ax, ay, az);
                if (!solid_key(w.grid(), key)) continue;
                const CellType mat = mat_key(w, mats, key);
                const std::uint16_t hardness = material_hardness(mat);
                if (hardness == kHardnessUnbreakable) continue;
                // Quadratic falloff: full power at the centre, zero at the
                // rim. Stays within uint16 because the scale factor is <= 1.
                const std::uint16_t peff = static_cast<std::uint16_t>(
                    static_cast<float>(op.power) * (r2 - d2) / r2);
                if (peff == 0) continue;
                const std::uint32_t ci = key >> kSubVoxelsShift;
                if (sealedMask && !sealedMask->empty() && ((*sealedMask)[ci / 64] & (1ull << (ci % 64)))) continue;
                if (!carve_roll(carve_hash(op.seed, ci, key & kSubVoxelsMask), peff,
                                hardness))
                    continue;
                out.destroyed.push_back(CarvedVoxel{
                    ci, static_cast<std::uint16_t>(key & kSubVoxelsMask), mat});
                remove_key(w, mats, key, out.dirtyCells);
            }
        }
    }

    detach_sweep(w, mats, op.detachLimit, scratch, out);
    finalize_dirty(out);
    return static_cast<std::int32_t>(out.destroyed.size() +
                                     out.detached.size());
}

bool carve_at(World& w, int cx, int cy, int cz, int sx, int sy, int sz,
              std::uint16_t power, std::uint32_t seed, CarveScratch& scratch,
              CarveResult& out,
              const std::vector<std::uint64_t>* sealedMask) {
    out.clear();
    const std::uint32_t ci = static_cast<std::uint32_t>(
        macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz)));
    const std::uint32_t bit =
        static_cast<std::uint32_t>(sub_bit(sx, sy, sz));
    const std::uint32_t key = pack_key(ci, bit);
    if (sealedMask && !sealedMask->empty() && ((*sealedMask)[ci / 64] & (1ull << (ci % 64)))) return false;
    if (!solid_key(w.grid(), key)) return false;
    SubField<CellType>* mats = w.subfields().find<CellType>(kSubMaterialName);
    const CellType mat = mat_key(w, mats, key);
    if (!carve_roll(carve_hash(seed, ci, bit), power, material_hardness(mat)))
        return false;
    out.destroyed.push_back(
        CarvedVoxel{ci, static_cast<std::uint16_t>(bit), mat});
    remove_key(w, mats, key, out.dirtyCells);
    detach_sweep(w, mats, kSubVoxels, scratch, out);
    finalize_dirty(out);
    return true;
}

void bake_stress(World& world, const StressParams& params, Field<float>& out_stress) {
    auto t0 = std::chrono::high_resolution_clock::now();
    const Field<std::uint8_t>* anchors = world.fields().find<std::uint8_t>(kAnchorFieldName);
    
    // Step 1: anchors hold infinity, air holds 0
    for (int cy = 0; cy < kMacroDim; ++cy) {
        for (int cx = 0; cx < kMacroDim; ++cx) {
            for (int cz = 0; cz < kMacroDim; ++cz) {
                std::size_t ci = macro_index(cx, cy, cz);
                bool solid = world.grid().types()[ci] != 0; 
                if (anchors && anchors->at(cx, cy, cz) != 0) {
                    out_stress.data()[ci] = 1e9f;
                } else if (!solid) {
                    out_stress.data()[ci] = 0.0f;
                } else {
                    out_stress.data()[ci] = -1.0f;
                }
            }
        }
    }
    
    // Step 2: relax from support
    CellStep down = regime_down(world.gravity().regime);
    
    for (int iter = 0; iter < params.relaxIters; ++iter) {
        for (int cy = 0; cy < kMacroDim; ++cy) {
            for (int cx = 0; cx < kMacroDim; ++cx) {
                for (int cz = 0; cz < kMacroDim; ++cz) {
                    std::size_t ci = macro_index(cx, cy, cz);
                    if (out_stress.data()[ci] == 1e9f || out_stress.data()[ci] == 0.0f) continue;
                    
                    int sx = wrap_macro(cx - down.x);
                    int sy = wrap_macro(cy - down.y);
                    int sz = wrap_macro(cz - down.z);
                    std::size_t si = macro_index(sx, sy, sz);
                    
                    float support = out_stress.data()[si];
                    if (support > 0.0f) {
                        float cellHardness = material_hardness(world.grid().types()[ci]);
                        out_stress.data()[ci] = std::min(support * 0.9f, cellHardness * params.carryPerHardness);
                    }
                }
            }
        }
    }
    
    auto t1 = std::chrono::high_resolution_clock::now();
    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    std::fprintf(stderr, "[bake] stress field computed in %.2f ms\n", ms);
}

void find_structural_collapses(const World& w, const CarveResult& res, std::vector<std::size_t>& out_collapses) {
    const Field<float>* stress = w.fields().find<float>("stress");
    if (!stress) return;
    
    for (std::uint32_t cell : res.dirtyCells) {
        int cx = static_cast<int>(cell) & 127;
        int cy = (static_cast<int>(cell) >> 7) & 127;
        int cz = (static_cast<int>(cell) >> 14) & 127;
        
        for (const auto& d : kDir6) {
            int nx = (cx + d[0]) & 127;
            int ny = (cy + d[1]) & 127;
            int nz = (cz + d[2]) & 127;
            std::size_t ni = static_cast<std::size_t>(nx | (ny << 7) | (nz << 14));
            
            if (w.grid().types()[ni] != 0 && stress->data()[ni] <= 0.0f) {
                out_collapses.push_back(ni);
            }
        }
    }
    
    if (!out_collapses.empty()) {
        std::sort(out_collapses.begin(), out_collapses.end());
        out_collapses.erase(std::unique(out_collapses.begin(), out_collapses.end()), out_collapses.end());
    }
}

} // namespace giga
